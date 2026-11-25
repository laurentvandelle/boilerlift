import { isStableName } from '#src/core/compile/load-workflows';
import { StableName } from '#src/core/compile/workflow.model';
import { isRecord } from '#src/core/common/is-record';
import { Result, err, ok } from '#src/core/common/result';
import { DeployError } from '#src/core/deliver/deploy.model';
import { LockEntry, LockFile, LockFileError, LockRemover, LockWriter } from '#src/core/deliver/lock-file.model';
import { isWorkflowId } from '#src/core/n8n/n8n-ids';
import { WorkflowId } from '#src/core/n8n/n8n.model';

/** The lock file, at the project root (the current folder). */
export const LOCK_FILE = 'boilerlift.lock.json';

const VERSION = 1;

/** A lock file that records nothing yet: what a missing file stands for. */
export function emptyLockFile(): LockFile {
  return { version: VERSION, instances: new Map() };
}

/** Reads the text of the lock file. `undefined` (no file) is an empty lock file. Nothing is trusted unchecked. */
export function parseLockFile(text: string | undefined): Result<LockFile, LockFileError> {
  if (text === undefined) {
    return ok(emptyLockFile());
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return err({ kind: 'invalid-json', detail: `not valid JSON: ${error instanceof Error ? error.message : String(error)}` });
  }
  if (!isRecord(raw)) {
    return err({ kind: 'invalid-shape', detail: 'the file must hold a JSON object' });
  }
  if (raw.version !== VERSION) {
    return err({ kind: 'invalid-version', detail: `"version" must be ${VERSION}, found ${JSON.stringify(raw.version) ?? 'nothing'}` });
  }
  if (!isRecord(raw.instances)) {
    return err({ kind: 'invalid-shape', detail: '"instances" must be an object' });
  }
  const instances = new Map<string, Map<StableName, LockEntry>>();
  for (const [instance, rawEntries] of Object.entries(raw.instances)) {
    if (!isRecord(rawEntries)) {
      return err({ kind: 'invalid-shape', detail: `instance "${instance}" must be an object` });
    }
    const entries = new Map<StableName, LockEntry>();
    for (const [name, rawEntry] of Object.entries(rawEntries)) {
      if (!isStableName(name)) {
        return err({
          kind: 'invalid-stable-name',
          detail: `"${name}" under "${instance}" is not a stable name: 1 to 64 lowercase letters, digits or dashes`,
        });
      }
      if (!isRecord(rawEntry)) {
        return err({ kind: 'invalid-shape', detail: `"${name}" under "${instance}" must be an object with an "n8nId"` });
      }
      const { n8nId } = rawEntry;
      if (!isWorkflowId(n8nId)) {
        return err({ kind: 'invalid-id', detail: `"${name}" under "${instance}" must have a non-empty string "n8nId"` });
      }
      entries.set(name, { n8nId });
    }
    instances.set(instance, entries);
  }
  return ok({ version: VERSION, instances });
}

/** The ids deploy manages on `instance`, by stable name. The only source of the managed ids. */
export function managedIds(lock: LockFile, instance: string): Map<StableName, WorkflowId> {
  const entries = lock.instances.get(instance) ?? new Map<StableName, LockEntry>();
  return new Map([...entries].map(([name, { n8nId }]): [StableName, WorkflowId] => [name, n8nId]));
}

/** `lock` with `stableName` on `instance` set to `id`. `lock` itself is left unchanged. */
export function withEntry(lock: LockFile, instance: string, stableName: StableName, id: WorkflowId): LockFile {
  const instances = new Map(lock.instances);
  const entries = new Map(instances.get(instance));
  entries.set(stableName, { n8nId: id });
  instances.set(instance, entries);
  return { version: lock.version, instances };
}

/**
 * The entries of `instance` that no workflow file points to any more: `present` holds the stable names of the files of
 * every target on that instance, in all their folders. These are the removed workflows, by stable name.
 */
export function removedEntries(lock: LockFile, instance: string, present: ReadonlySet<string>): Map<StableName, WorkflowId> {
  return new Map([...managedIds(lock, instance)].filter(([name]) => !present.has(name)));
}

/**
 * `lock` without `stableName` on `instance`; an instance left with no entry is dropped. `lock` itself is left unchanged.
 */
export function withoutEntry(lock: LockFile, instance: string, stableName: StableName): LockFile {
  const instances = new Map(lock.instances);
  const entries = new Map(instances.get(instance));
  entries.delete(stableName);
  if (entries.size === 0) {
    instances.delete(instance);
  } else {
    instances.set(instance, entries);
  }
  return { version: lock.version, instances };
}

/** The text of the lock file: keys sorted, 2-space JSON and a trailing newline, so the same record gives the same text. */
export function serializeLockFile(lock: LockFile): string {
  const instances = Object.fromEntries(
    sortedEntries(lock.instances).map(([instance, entries]) => [
      instance,
      Object.fromEntries(sortedEntries(entries).map(([name, { n8nId }]) => [name, { n8nId }])),
    ]),
  );
  return `${JSON.stringify({ version: lock.version, instances }, null, 2)}\n`;
}

/**
 * A `LockWriter` that records each id under `instance` in `lock`, and saves the whole file with `save` on each call.
 * A save that fails stops the run (`lock-write-failed`): the error names the created id and how to record it by hand.
 */
export function lockWriter(
  lock: LockFile,
  instance: string,
  save: (text: string) => Promise<Result<void, { reason: string }>>,
): LockWriter {
  let current = lock;
  return {
    record: async (stableName, id): Promise<Result<void, DeployError>> => {
      const next = withEntry(current, instance, stableName, id);
      const saved = await save(serializeLockFile(next));
      if (!saved.ok) {
        return err({
          kind: 'lock-write-failed',
          call: `write ${LOCK_FILE}`,
          detail: `workflow ${id} was created for ${stableName}, but ${LOCK_FILE} could not be written: ${saved.error.reason}`,
          hint: `Add "${stableName}": { "n8nId": "${id}" } under "${instance}" in ${LOCK_FILE} by hand and commit it, then run deploy again`,
        });
      }
      current = next;
      return ok(undefined);
    },
  };
}

/**
 * A `LockRemover` over `lock`, for every instance: each call drops one entry and saves the whole file with `save`. A
 * save that fails leaves the entry in the record it holds, so the next call does not save it either.
 */
export function lockRemover(lock: LockFile, save: (text: string) => Promise<Result<void, { reason: string }>>): LockRemover {
  let current = lock;
  return {
    remove: async (instance, stableName): Promise<Result<void, { reason: string }>> => {
      const next = withoutEntry(current, instance, stableName);
      const saved = await save(serializeLockFile(next));
      if (!saved.ok) {
        return saved;
      }
      current = next;
      return ok(undefined);
    },
  };
}

function sortedEntries<K extends string, V>(map: Map<K, V>): [K, V][] {
  return [...map].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}
