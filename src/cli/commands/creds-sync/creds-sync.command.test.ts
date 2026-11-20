import { describe, expect, test } from 'vitest';
import { CommandContext, WorkflowFile } from '#src/cli/cli.model';
import {
  FAKE_DEV_URL as DEV_URL,
  FAKE_PROD_URL as PROD_URL,
  fakeContext,
  fakeCredentialsFolder,
  fakeSingleTarget,
  fakeTwoTargets,
} from '#src/cli/cli.fake';
import { credsSyncCommand } from '#src/cli/commands/creds-sync/creds-sync.command';
import { fakeWorkflowFileUsing } from '#src/core/compile/credential.fake';
import { fakeCredential, fakeN8n, fakeN8nByOrigin, httpError, unreachable } from '#src/core/n8n/n8n.fake';

const INPUT = { positionals: [], values: {} };
const JSON_INPUT = { positionals: [], values: { json: true } };
const LIST_CALL = 'GET /api/v1/credentials';

/** The workflow files of each folder, by folder. */
function workflowFolders(folders: Record<string, WorkflowFile[]>): CommandContext['loadWorkflowFiles'] {
  return (dir) => Promise.resolve(folders[dir] ?? []);
}

/** A creds sync context on the single target `dev`, its workflows in ./workflows, and an empty credentials folder. */
function context(overrides: Partial<CommandContext> = {}): CommandContext {
  return fakeContext({ registry: [credsSyncCommand], loadProjectConfig: fakeSingleTarget(), ...fakeCredentialsFolder().context, ...overrides });
}

describe('credsSyncCommand', () => {
  test('Should print the synced count and the file written, and exit 0, when no workflow misses a credential', async () => {
    const folder = fakeCredentialsFolder();
    const ctx = context({ fetch: fakeN8n({ credentials: [fakeCredential('Slack'), fakeCredential('Gmail')] }).fetch, ...folder.context });

    const result = await credsSyncCommand.run(INPUT, ctx);

    expect(result).toEqual({ exitCode: 0, stdout: 'Synced 2 credentials from dev.\nWrote credentials/dev.ts.\n', stderr: '' });
  });

  test('Should write the list of the target to credentials/<target>.ts when it syncs', async () => {
    const folder = fakeCredentialsFolder();
    const ctx = context({ fetch: fakeN8n({ credentials: [fakeCredential('Slack', { type: 'slackApi', id: '7' })] }).fetch, ...folder.context });

    await credsSyncCommand.run(INPUT, ctx);

    expect(folder.text('credentials/dev.ts')).toContain('  { key: "slack", name: "Slack", type: "slackApi", id: "7" },\n');
  });

  test('Should print one line per missing key, with its type and workflows, and exit 8, when workflows use keys the list lacks', async () => {
    const ctx = context({
      fetch: fakeN8n({ credentials: [fakeCredential('Slack')] }).fetch,
      loadWorkflowFiles: workflowFolders({
        './workflows': [
          fakeWorkflowFileUsing('workflows/invoice-sync.workflow.ts', ['gmail-sales'], 'gmailOAuth2'),
          fakeWorkflowFileUsing('workflows/crm-import.json', ['gmail-sales', 'slack'], 'gmailOAuth2'),
        ],
      }),
    });

    const result = await credsSyncCommand.run(INPUT, ctx);

    expect(result).toEqual({
      exitCode: 8,
      stdout:
        'Synced 1 credentials from dev.\nWrote credentials/dev.ts.\n' +
        'Missing on dev: gmail-sales (gmailOAuth2), used by: crm-import, invoice-sync\n',
      stderr: '1 missing on dev. Exit code 8.\n',
    });
  });

  test('Should take the type of a missing key from the lists of the project when the instance no longer has it', async () => {
    const folder = fakeCredentialsFolder({
      files: [{ path: 'credentials/dev.ts', content: [{ key: 'gmail-sales', name: 'Gmail sales', type: 'gmailOAuth2', id: '1' }] }],
    });
    const ctx = context({
      fetch: fakeN8n().fetch,
      loadWorkflowFiles: workflowFolders({ './workflows': [fakeWorkflowFileUsing('workflows/invoice-sync.json', ['gmail-sales'], 'unknown')] }),
      ...folder.context,
    });

    const result = await credsSyncCommand.run(INPUT, ctx);

    expect(result.stdout).toContain('Missing on dev: gmail-sales (gmailOAuth2), used by: invoice-sync\n');
  });

  test('Should say the instance is empty and exit 0 when it has no credentials', async () => {
    const ctx = context({ fetch: fakeN8n().fetch });

    const result = await credsSyncCommand.run(INPUT, ctx);

    expect(result).toEqual({
      exitCode: 0,
      stdout: 'Synced 0 credentials from dev.\nThe instance of dev has no credentials.\nWrote credentials/dev.ts.\n',
      stderr: '',
    });
  });

  test('Should scan only the workflows folder of the target when several targets are declared', async () => {
    const ctx = context({
      loadProjectConfig: fakeTwoTargets(),
      fetch: fakeN8nByOrigin({ [DEV_URL]: fakeN8n(), [PROD_URL]: fakeN8n() }),
      loadWorkflowFiles: workflowFolders({ './dev': [], './prod': [fakeWorkflowFileUsing('prod/billing.json', ['stripe'])] }),
    });

    const result = await credsSyncCommand.run({ positionals: [], values: { target: 'dev' } }, ctx);

    expect(result.exitCode).toBe(0);
  });

  test('Should print the list and the missing keys of the target as JSON when --json is set', async () => {
    const ctx = context({
      fetch: fakeN8n({ credentials: [fakeCredential('Slack', { id: '7', type: 'slackApi' })] }).fetch,
      loadWorkflowFiles: workflowFolders({ './workflows': [fakeWorkflowFileUsing('workflows/a.json', ['ghost'], 'unknown')] }),
    });

    const result = await credsSyncCommand.run(JSON_INPUT, ctx);

    expect(JSON.parse(result.stdout)).toEqual({
      target: 'dev',
      url: 'https://n8n.example.com',
      file: 'credentials/dev.ts',
      credentials: [{ key: 'slack', name: 'Slack', type: 'slackApi', id: '7' }],
      missing: [{ key: 'ghost', type: null, workflows: ['a'] }],
      exitCode: 8,
    });
  });

  test('Should name the credential:list scope, exit 9 and write nothing when the instance answers 403', async () => {
    const folder = fakeCredentialsFolder();
    const ctx = context({ fetch: fakeN8n({ failures: [httpError(LIST_CALL, 403)] }).fetch, ...folder.context });

    const result = await credsSyncCommand.run(INPUT, ctx);

    expect(result).toEqual({
      exitCode: 9,
      stdout: '',
      stderr:
        'Cannot sync the credentials of dev: GET /api/v1/credentials → HTTP 403: the API key lacks the credential:list scope\n' +
        '  → Give the API key of the target the credential:list scope in n8n → Settings → n8n API, or create a key that has it, then run lift creds sync again\n',
    });
    expect(folder.writes).toEqual([]);
  });

  test('Should tell to run lift ping, exit 4 and write nothing when the instance rejects the key', async () => {
    const folder = fakeCredentialsFolder();
    const ctx = context({ fetch: fakeN8n({ failures: [httpError(LIST_CALL, 401)] }).fetch, ...folder.context });

    const result = await credsSyncCommand.run(INPUT, ctx);

    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain('→ Run lift ping');
    expect(folder.writes).toEqual([]);
  });

  test('Should tell to run lift ping and exit 3 when the instance is unreachable', async () => {
    const ctx = context({ fetch: fakeN8n({ failures: [unreachable(LIST_CALL, 'connection refused')] }).fetch });

    const result = await credsSyncCommand.run(INPUT, ctx);

    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain('→ Run lift ping');
  });

  test('Should exit 10 with the reason when the file cannot be written', async () => {
    const folder = fakeCredentialsFolder({ writeFailure: 'EACCES: permission denied' });
    const ctx = context({ fetch: fakeN8n().fetch, ...folder.context });

    const result = await credsSyncCommand.run(INPUT, ctx);

    expect(result.exitCode).toBe(10);
    expect(result.stderr).toContain('credentials/dev.ts → EACCES: permission denied');
  });

  test('Should sync every target into its own file and exit with the worst code when --all is set', async () => {
    const folder = fakeCredentialsFolder();
    const ctx = context({
      loadProjectConfig: fakeTwoTargets(),
      fetch: fakeN8nByOrigin({ [DEV_URL]: fakeN8n(), [PROD_URL]: fakeN8n({ failures: [httpError(LIST_CALL, 403)] }) }),
      ...folder.context,
    });

    const result = await credsSyncCommand.run({ positionals: [], values: { all: true } }, ctx);

    expect(result.exitCode).toBe(9);
    expect(folder.writes).toEqual(['credentials/dev.ts']);
  });

  test('Should load the credential lists before the workflow files when it syncs', async () => {
    const order: string[] = [];
    const ctx = context({
      fetch: fakeN8n().fetch,
      loadCredentialsFiles: (dir) => {
        order.push(`lists ${dir}`);
        return Promise.resolve([]);
      },
      loadWorkflowFiles: (dir) => {
        order.push(`workflows ${dir}`);
        return Promise.resolve([]);
      },
    });

    await credsSyncCommand.run(INPUT, ctx);

    expect(order).toEqual(['lists credentials', 'workflows ./workflows']);
  });
});
