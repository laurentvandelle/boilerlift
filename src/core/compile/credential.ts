import {
  CredentialEntry,
  CredentialKey,
  CredentialMarker,
  CredentialSlot,
  CredentialUse,
} from '#src/core/compile/credential.model';
import { baseNameOf } from '#src/core/compile/load-workflows';
import { WorkflowFile } from '#src/core/compile/workflow.model';
import { isRecord } from '#src/core/common/is-record';

/** The type a marker is stored under when no list loaded in this process holds its key. */
export const UNKNOWN_CREDENTIAL_TYPE = 'unknown';

/**
 * The type of each key, from the lists `defineCredentials` registered in this process. The CLI imports the generated
 * `credentials/*.ts` files before the workflow files, so `credential()` finds the type when a workflow file runs it.
 */
const registeredTypes = new Map<string, string>();

/**
 * Registers the credential list of a target and returns it unchanged. Only the files `lift creds sync` generates
 * call it. When two lists hold one key, the first one registered gives its type.
 */
export function defineCredentials<const List extends readonly CredentialEntry[]>(list: List): List {
  for (const { key, type } of list) {
    if (!registeredTypes.has(key)) {
      registeredTypes.set(key, type);
    }
  }
  return list;
}

/**
 * The `credentials` entry of a node, picked by its key in `credentials/<target>.ts`: `{ [type]: marker }`.
 * The editor offers the keys of every target's list.
 *
 * ```ts
 * import { credential, defineWorkflow } from 'boilerlift';
 * nodes: [{ name: 'Send', type: 'n8n-nodes-base.gmail', …, credentials: credential('gmail-sales') }]
 * ```
 *
 * Deploy resolves the marker to the n8n `{ id, name }` of the key in the list of the target it deploys to, under the
 * type that list gives it, and checks the id on the instance first.
 */
export function credential<const Key extends CredentialKey>(key: Key): CredentialSlot<Key>;
export function credential(key: string): Record<string, CredentialMarker> {
  return { [registeredTypes.get(key) ?? UNKNOWN_CREDENTIAL_TYPE]: { boilerlift: 'credential', key } };
}

/** True when `value` is what `credential()` stores in a node. */
export function isCredentialMarker(value: unknown): value is CredentialMarker {
  return isRecord(value) && value.boilerlift === 'credential' && typeof value.key === 'string';
}

/**
 * Every `credential()` use in the nodes of `files`, in file order then node order. A file that cannot be read, or
 * that holds no list of nodes, has none.
 */
export function findCredentialUses(files: readonly WorkflowFile[]): CredentialUse[] {
  return files.flatMap((file) => {
    if ('error' in file || !isRecord(file.content) || !Array.isArray(file.content.nodes)) {
      return [];
    }
    const nodes: unknown[] = file.content.nodes;
    return nodes.flatMap((node) => {
      if (!isRecord(node) || !isRecord(node.credentials)) {
        return [];
      }
      const name = typeof node.name === 'string' ? node.name : '';
      return Object.entries(node.credentials).flatMap(([type, value]) =>
        isCredentialMarker(value) ? [{ path: file.path, workflow: baseNameOf(file.path), node: name, key: value.key, type }] : [],
      );
    });
  });
}
