import { CredentialEntry, CredentialsFile } from '#src/core/compile/credential.model';
import { isRecord } from '#src/core/common/is-record';

/** The folder of the generated credential lists, next to `boilerlift.config.ts`. */
export const CREDENTIALS_DIR = 'credentials';

/** The file of the credential list of `target`: `credentials/<target>.ts`. */
export function credentialsFilePath(target: string): string {
  return `${CREDENTIALS_DIR}/${target}.ts`;
}

/**
 * The type of each key in the credential lists the project holds now, from the files `lift creds sync` generated.
 * A file that cannot be imported, or that holds no list, adds nothing. When two lists hold one key, the first wins.
 */
export function knownCredentialTypes(files: readonly CredentialsFile[]): Map<string, string> {
  const types = new Map<string, string>();
  for (const { key, type } of files.flatMap(entriesOf)) {
    if (!types.has(key)) {
      types.set(key, type);
    }
  }
  return types;
}

/**
 * The credential list of `target`: the entries of `credentials/<target>.ts`. Empty when the project has no such
 * file, or when it cannot be imported or holds no list. An entry without a string key, name, type and id is left out.
 */
export function targetCredentials(files: readonly CredentialsFile[], target: string): CredentialEntry[] {
  const path = credentialsFilePath(target);
  return files.filter((file) => file.path === path).flatMap(entriesOf);
}

function entriesOf(file: CredentialsFile): CredentialEntry[] {
  if ('error' in file || !Array.isArray(file.content)) {
    return [];
  }
  const entries: unknown[] = file.content;
  return entries.flatMap((entry) =>
    isRecord(entry) && typeof entry.key === 'string' && typeof entry.name === 'string' && typeof entry.type === 'string' && typeof entry.id === 'string'
      ? [{ key: entry.key, name: entry.name, type: entry.type, id: entry.id }]
      : [],
  );
}
