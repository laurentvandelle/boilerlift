import { UNKNOWN_CREDENTIAL_TYPE, findCredentialUses } from '#src/core/compile/credential';
import { credentialsFilePath } from '#src/core/compile/credential-lists';
import { CredentialEntry, MissingCredential } from '#src/core/compile/credential.model';
import {
  EXIT_API_KEY_REJECTED,
  EXIT_CREDENTIALS_MISSING,
  EXIT_CREDENTIALS_WRITE_FAILED,
  EXIT_CREDENTIAL_SCOPE_MISSING,
  EXIT_OK,
  EXIT_UNREACHABLE,
  FailureExitCode,
} from '#src/cli/exit-codes';
import { CredentialsWriter, SyncError, SyncInput, SyncReport } from '#src/core/credentials/credentials.model';
import { CREDENTIAL_LIST_SCOPE } from '#src/core/n8n/n8n-api';
import { ApiFailure, N8nCredential } from '#src/core/n8n/n8n.model';

const EXIT_CODES: Record<SyncError['kind'], FailureExitCode> = {
  unreachable: EXIT_UNREACHABLE,
  'key-rejected': EXIT_API_KEY_REJECTED,
  'scope-missing': EXIT_CREDENTIAL_SCOPE_MISSING,
  'write-failed': EXIT_CREDENTIALS_WRITE_FAILED,
};

/**
 * Lists the credentials of the instance of a target (reads only: nothing is written to n8n), writes them to
 * `credentials/<target>.ts`, then reports each `credential()` key that the workflows of the target use and that the
 * list does not have. Missing keys still leave the list written, and exit EXIT_CREDENTIALS_MISSING. A failed read
 * leaves the file as it was.
 */
export async function syncCredentials(input: SyncInput, write: CredentialsWriter): Promise<SyncReport> {
  const listed = await input.client.listCredentials();
  if (!listed.ok) {
    return failed(describeFailure(listed.error));
  }
  const credentials = withKeys(listed.value.body);
  const file = credentialsFilePath(input.target);
  const written = await write(file, credentialsFileText(input.target, credentials));
  if (!written.ok) {
    return failed({
      kind: 'write-failed',
      path: file,
      detail: written.error.reason,
      hint: `Check that ${file} can be written, then run lift creds sync again`,
    });
  }
  const missing = missingCredentials(input, new Set(credentials.map(({ key }) => key)));
  return { status: 'synced', file, credentials, missing, exitCode: missing.length === 0 ? EXIT_OK : EXIT_CREDENTIALS_MISSING };
}

function failed(error: SyncError): SyncReport {
  return { status: 'failed', error, exitCode: EXIT_CODES[error.kind] };
}

function describeFailure(failure: ApiFailure): SyncError {
  const ping = 'Run lift ping to check the url and the API key of the target, then run lift creds sync again';
  switch (failure.kind) {
  case 'unreachable':
    return { kind: 'unreachable', call: failure.call, detail: `unreachable: ${failure.reason}`, hint: ping };
  case 'invalid-response':
    return { kind: 'unreachable', call: failure.call, detail: `unexpected answer (HTTP ${failure.status}): ${failure.detail}`, hint: ping };
  case 'http-error': {
    const detail = `HTTP ${failure.status}${failure.message === undefined ? '' : `: ${failure.message}`}`;
    if (failure.status === 403) {
      return {
        kind: 'scope-missing',
        call: failure.call,
        detail: `${detail}: the API key lacks the ${CREDENTIAL_LIST_SCOPE} scope`,
        hint: `Give the API key of the target the ${CREDENTIAL_LIST_SCOPE} scope in n8n → Settings → n8n API, or create a key that has it, then run lift creds sync again`,
      };
    }
    return { kind: failure.status === 401 ? 'key-rejected' : 'unreachable', call: failure.call, detail, hint: ping };
  }
  }
}

/**
 * The credentials with their keys, sorted by key. A key is the kebab-case slug of the name. Credentials whose names
 * give one slug keep it in the order of their n8n ids: the first one has it as is, the next ones `-2`, `-3`…, skipping
 * a key that another name already gives.
 */
function withKeys(credentials: readonly N8nCredential[]): CredentialEntry[] {
  const byId = [...credentials].sort((a, b) => compare(a.id, b.id));
  const taken = new Set(byId.map(({ name }) => slugOf(name)));
  const given = new Set<string>();
  const entries = byId.map(({ id, name, type }): CredentialEntry => {
    const slug = slugOf(name);
    let key = slug;
    let suffix = 1;
    while (given.has(key) || (key !== slug && taken.has(key))) {
      suffix += 1;
      key = `${slug}-${suffix}`;
    }
    given.add(key);
    return { key, name, type, id };
  });
  return entries.sort((a, b) => compare(a.key, b.key));
}

/** The kebab-case slug of a credential name: lowercase a-z and 0-9, accents dropped, dashes between words. */
function slugOf(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? 'credential' : slug;
}

/** A comparison that does not depend on the locale, so the file reads the same on every machine. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The keys that the workflows of the target use and that `listed` does not have, with their types and workflows. */
function missingCredentials({ files, knownTypes }: SyncInput, listed: ReadonlySet<string>): MissingCredential[] {
  const missing = new Map<string, MissingCredential>();
  for (const use of findCredentialUses(files)) {
    if (listed.has(use.key)) {
      continue;
    }
    const entry = missing.get(use.key) ?? {
      key: use.key,
      type: knownTypes.get(use.key) ?? (use.type === UNKNOWN_CREDENTIAL_TYPE ? undefined : use.type),
      workflows: [],
    };
    if (!entry.workflows.includes(use.workflow)) {
      entry.workflows.push(use.workflow);
    }
    missing.set(use.key, entry);
  }
  return [...missing.values()]
    .map((entry) => ({ ...entry, workflows: [...entry.workflows].sort(compare) }))
    .sort((a, b) => compare(a.key, b.key));
}

/**
 * The text of `credentials/<target>.ts`: the list, registered with `defineCredentials`, and the declaration that adds
 * the target to `CredentialLists`, so `credential()` offers its keys. The same list always gives the same text.
 */
function credentialsFileText(target: string, credentials: readonly CredentialEntry[]): string {
  const entries = credentials.map(
    ({ key, name, type, id }) =>
      `  { key: ${JSON.stringify(key)}, name: ${JSON.stringify(name)}, type: ${JSON.stringify(type)}, id: ${JSON.stringify(id)} },`,
  );
  const list = entries.length === 0 ? '[]' : `[\n${entries.join('\n')}\n]`;
  return `// Generated by \`lift creds sync\` from the n8n instance of target ${JSON.stringify(target)}. Do not edit: run it again.
// It holds no secret: only the key, name, type and n8n id of each credential. Commit it with the project.
import { defineCredentials } from 'boilerlift';

export const credentials = defineCredentials(${list});

export default credentials;

declare module 'boilerlift' {
  interface CredentialLists {
    ${JSON.stringify(target)}: typeof credentials;
  }
}
`;
}
