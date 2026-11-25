import { fakeStableName } from '#src/core/compile/workflow.fake';
import { StableName } from '#src/core/compile/workflow.model';
import { Result, err, ok } from '#src/core/common/result';
import { emptyLockFile, lockWriter, managedIds, parseLockFile } from '#src/core/lock/lock-file';
import { LockStore, LockWriter } from '#src/core/lock/lock-file.model';
import { fakeWorkflowId } from '#src/core/n8n/n8n.fake';
import { WorkflowId } from '#src/core/n8n/n8n.model';

/** The instance the fake lock file records for, as `parseProjectConfig` cleans up the url of a target. */
export const FAKE_INSTANCE = 'https://n8n.example.com';

/** Managed ids as a test writes them, `{ 'crm-import': 'abc' }`, through the same guards as the code. */
export function fakeManaged(entries: Record<string, string> = {}): Map<StableName, WorkflowId> {
  return new Map(Object.entries(entries).map(([name, id]): [StableName, WorkflowId] => [fakeStableName(name), fakeWorkflowId(id)]));
}

/** The text of a lock file that records `entries` for FAKE_INSTANCE. */
export function fakeLockText(entries: Record<string, string>, instance = FAKE_INSTANCE): string {
  const records = Object.fromEntries(Object.entries(entries).map(([name, id]) => [name, { n8nId: id }]));
  return `${JSON.stringify({ version: 1, instances: { [instance]: records } }, null, 2)}\n`;
}

export interface FakeLockWriter {
  /** The real `lockWriter`, saving to memory. */
  writer: LockWriter;
  /** The ids the saved file records for FAKE_INSTANCE now, as plain strings. */
  recorded(): Record<string, string>;
  /** The ids the saved file records for FAKE_INSTANCE now, ready to hand to the next deploy. */
  managed(): Map<StableName, WorkflowId>;
  /** How many times the file was saved. */
  saves(): number;
}

/**
 * The real `lockWriter` for FAKE_INSTANCE over an in-memory file that starts with `entries`. With `failWith`, every
 * save fails with that reason.
 */
export function fakeLockWriter({ entries = {}, failWith }: { entries?: Record<string, string>; failWith?: string } = {}): FakeLockWriter {
  const start = parseLockFile(Object.keys(entries).length === 0 ? undefined : fakeLockText(entries));
  let text: string | undefined;
  let saves = 0;
  const writer = lockWriter(start.ok ? start.value : emptyLockFile(), FAKE_INSTANCE, (next) => {
    saves += 1;
    if (failWith !== undefined) {
      return Promise.resolve(err({ reason: failWith }));
    }
    text = next;
    return Promise.resolve(ok(undefined));
  });
  const managed = (): Map<StableName, WorkflowId> => {
    const saved = parseLockFile(text ?? fakeLockText(entries));
    return saved.ok ? managedIds(saved.value, FAKE_INSTANCE) : new Map<StableName, WorkflowId>();
  };
  return {
    writer,
    managed,
    recorded: () => Object.fromEntries(managed()),
    saves: () => saves,
  };
}

/** An in-memory lock file behind the `LockStore` port: seed it, read back what was saved, or make its saves fail. */
export interface FakeLockStore {
  store: LockStore;
  /** The text the file holds now, or `undefined` when there is none. */
  text(): string | undefined;
  /** The ids the file records now for `instance` (FAKE_INSTANCE by default), as plain strings. */
  recorded(instance?: string): Record<string, string>;
  /** How many times the file was saved. */
  saves(): number;
}

/** A `LockStore` over an in-memory file that starts as `text` (no file when `undefined`). With `failWith`, every save fails. */
export function fakeLockStore({ text: seed, failWith }: { text?: string; failWith?: string } = {}): FakeLockStore {
  let text = seed;
  let saves = 0;
  return {
    store: {
      read: () => Promise.resolve(text),
      write: (next): Promise<Result<void, { reason: string }>> => {
        saves += 1;
        if (failWith !== undefined) {
          return Promise.resolve(err({ reason: failWith }));
        }
        text = next;
        return Promise.resolve(ok(undefined));
      },
    },
    text: () => text,
    recorded: (instance = FAKE_INSTANCE): Record<string, string> => {
      const lock = parseLockFile(text);
      return lock.ok ? Object.fromEntries(managedIds(lock.value, instance)) : {};
    },
    saves: () => saves,
  };
}
