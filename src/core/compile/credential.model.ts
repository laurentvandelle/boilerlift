/** One credential of a target, as `lift creds sync` writes it in `credentials/<target>.ts`. Never a secret. */
export interface CredentialEntry {
  /** Unique within the list of the target: the kebab-case slug of `name`, `-2`, `-3`… on a collision. */
  key: string;
  /** The name of the credential in n8n. */
  name: string;
  /** The n8n credential type, for example `gmailOAuth2`: the key of the entry in a node's `credentials`. */
  type: string;
  /** The id of the credential on the instance of the target. */
  id: string;
}

/**
 * The credential lists of the project, by target name. Each generated `credentials/<target>.ts` adds its target here
 * (`declare module 'boilerlift'`), so `credential()` takes the keys of every list. Empty until the first sync.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- declaration merging: the generated files add the targets.
export interface CredentialLists {}

/** Every entry of every list of `CredentialLists`. */
type ListedCredential = {
  [Target in keyof CredentialLists]: CredentialLists[Target] extends readonly (infer Entry)[] ? Entry : never;
}[keyof CredentialLists];

/** What `credential()` takes: a key of one of the lists, or any string before the first sync. */
export type CredentialKey = [keyof CredentialLists] extends [never] ? string : ListedCredential extends { key: infer Key extends string } ? Key : never;

/** The n8n credential type of `Key`, from the lists that hold it. */
export type CredentialTypeOf<Key extends string> = [keyof CredentialLists] extends [never]
  ? string
  : Extract<ListedCredential, { key: Key }> extends { type: infer Type extends string }
    ? Type
    : never;

/** What `credential()` stores in a node, in place of the n8n `{ id, name }`, until deploy resolves it. */
export interface CredentialMarker<Key extends string = string> {
  readonly boilerlift: 'credential';
  readonly key: Key;
}

/** The `credentials` entry of a node: `{ [type]: marker }`. */
export type CredentialSlot<Key extends string> = { [Type in CredentialTypeOf<Key>]: CredentialMarker<Key> };

/** One use of `credential()` in a workflow file. */
export interface CredentialUse {
  /** The path of the workflow file. */
  path: string;
  /** The file base name without `.workflow.ts` / `.json`. */
  workflow: string;
  node: string;
  key: string;
  /** The type the entry is stored under in the node. */
  type: string;
}

/** One `credentials/<target>.ts` file found in the project: its default export, or why it could not be imported. */
export type CredentialsFile = { path: string; content: unknown } | { path: string; error: string };

/** A key that workflows of a target use and that the target does not provide. */
export interface MissingCredential {
  key: string;
  /** The type of the key, from a list of the project; `undefined` when no list ever held it. */
  type: string | undefined;
  /** The workflows that use it, by stable name, sorted. */
  workflows: string[];
}
