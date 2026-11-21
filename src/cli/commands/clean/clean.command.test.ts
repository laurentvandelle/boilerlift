import { describe, expect, test } from 'vitest';
import { CommandContext, CommandInput } from '#src/cli/cli.model';
import { FakeLockFile, fakeAnswer, fakeContext, fakeLockFile, fakeProjectConfig, fakeSingleTarget } from '#src/cli/cli.fake';
import { cleanCommand } from '#src/cli/commands/clean/clean.command';
import { fakeLocalWorkflow, fakeWorkflowFile } from '#src/core/compile/workflow.fake';
import { fakeLockText } from '#src/core/deliver/lock-file.fake';
import { FakeN8n, fakeN8n, fakeN8nWorkflow, httpError, unreachable } from '#src/core/n8n/n8n.fake';

const TEXT: CommandInput = { positionals: [], values: {} };
const YES: CommandInput = { positionals: [], values: { yes: true } };

const CRM = fakeLocalWorkflow('crm-import', { path: 'workflows/crm-import.json', name: 'CRM import' });
const NEW = fakeLocalWorkflow('invoice-sync', { path: 'workflows/invoice-sync.json', name: 'Invoice sync' });
const OLD = fakeLocalWorkflow('old-report', { name: 'Old report' });
const LEGACY = fakeLocalWorkflow('legacy', { name: 'Legacy' });
const HAND_MADE = fakeLocalWorkflow('hand-made', { name: 'Hand made' });

/** CRM is deployed, OLD and LEGACY were removed from the project (LEGACY is archived), one hand-made workflow. */
function instance(): FakeN8n {
  return fakeN8n({
    workflows: [
      fakeN8nWorkflow(CRM, { id: 'crm1' }),
      fakeN8nWorkflow(OLD, { id: 'old1' }),
      fakeN8nWorkflow(LEGACY, { id: 'leg1', isArchived: true }),
      fakeN8nWorkflow(HAND_MADE, { id: 'h1' }),
    ],
  });
}

function lockFile(): FakeLockFile {
  return fakeLockFile({ text: fakeLockText({ 'crm-import': 'crm1', 'old-report': 'old1', legacy: 'leg1' }) });
}

function context(n8n: FakeN8n, lock: FakeLockFile = lockFile(), overrides: Partial<CommandContext> = {}): CommandContext {
  return fakeContext({
    registry: [cleanCommand],
    loadProjectConfig: fakeSingleTarget(),
    loadWorkflowFiles: () => Promise.resolve([CRM, NEW].map(fakeWorkflowFile)),
    fetch: n8n.fetch,
    ...lock.context,
    ...overrides,
  });
}

function archives(n8n: FakeN8n): string[] {
  return n8n.calls.filter((call) => call.endsWith('/archive'));
}

function deletes(n8n: FakeN8n): string[] {
  return n8n.calls.filter((call) => call.startsWith('DELETE '));
}

const DELETE: CommandInput = { positionals: [], values: { delete: true } };
const DELETE_YES: CommandInput = { positionals: [], values: { delete: true, yes: true } };

describe('cleanCommand', () => {
  test('Should list the three groups and ask once before archiving when a person runs it in a terminal', async () => {
    const n8n = instance();
    const stdin = fakeAnswer('y');

    await cleanCommand.run(TEXT, context(n8n, lockFile(), { isInteractive: true, ask: stdin.ask }));

    expect(stdin.prompts).toEqual([
      [
        'lift clean · dev (https://n8n.example.com)',
        '',
        '= legacy      Legacy (leg1): already archived in n8n: its entry will be dropped from boilerlift.lock.json',
        '- old-report  Old report (old1): will be archived',
        '',
        'Clean 2 removed workflows? They are archived in n8n and dropped from boilerlift.lock.json. [y/N] ',
      ].join('\n'),
    ]);
  });

  test('Should archive the removed workflows, drop their entries and report each one when the answer is yes', async () => {
    const n8n = instance();
    const lock = lockFile();

    const result = await cleanCommand.run(TEXT, context(n8n, lock, { isInteractive: true, ask: fakeAnswer('yes').ask }));

    expect(result).toEqual({
      exitCode: 0,
      stdout: [
        'lift clean · dev (https://n8n.example.com)',
        '',
        '= legacy      already archived  Legacy (leg1), entry dropped from boilerlift.lock.json',
        '- old-report  archived  Old report (old1)',
        '',
        'Not deployed yet:',
        '+ invoice-sync  workflows/invoice-sync.json',
        '',
        'Not in my project (clean never touches them):',
        '· Hand made (h1)',
        '',
        '1 archived, 1 already archived, 0 not found, 0 failed.',
        '',
        '→ commit boilerlift.lock.json  it was updated',
        '→ lift deploy  deploys the files not deployed yet',
        '',
      ].join('\n'),
      stderr: '',
    });
    expect(lock.text()).toBe(fakeLockText({ 'crm-import': 'crm1' }));
    expect(archives(n8n)).toEqual(['POST /api/v1/workflows/old1/archive']);
  });

  test('Should archive nothing and exit 0 with "Nothing archived." when the answer is not yes', async () => {
    const n8n = instance();
    const lock = lockFile();

    const result = await cleanCommand.run(TEXT, context(n8n, lock, { isInteractive: true, ask: fakeAnswer('').ask }));

    expect(result).toEqual({ exitCode: 0, stdout: 'Nothing archived.\n', stderr: '' });
    expect(archives(n8n)).toEqual([]);
    expect(lock.writes).toEqual([]);
  });

  test('Should archive without asking when --force is given', async () => {
    const n8n = instance();

    const result = await cleanCommand.run({ positionals: [], values: { force: true } }, context(n8n));

    expect(result.exitCode).toBe(0);
    expect(archives(n8n)).toEqual(['POST /api/v1/workflows/old1/archive']);
  });

  test('Should list, archive nothing and exit 11 with lift clean --yes next when there is no terminal', async () => {
    const n8n = instance();
    const lock = lockFile();

    const result = await cleanCommand.run(TEXT, context(n8n, lock));

    expect(result).toEqual({
      exitCode: 11,
      stdout: [
        'lift clean · dev (https://n8n.example.com)',
        '',
        'Removed from the project:',
        '= legacy      Legacy (leg1): already archived in n8n: its entry will be dropped from boilerlift.lock.json',
        '- old-report  Old report (old1): will be archived',
        '',
        'Not deployed yet:',
        '+ invoice-sync  workflows/invoice-sync.json',
        '',
        'Not in my project (clean never touches them):',
        '· Hand made (h1)',
        '',
        'Confirmation needed: nothing was archived.',
        '',
        '→ lift clean --yes  archives the 2 removed workflows',
        '→ lift deploy  deploys the files not deployed yet',
        '',
      ].join('\n'),
      stderr: 'Confirmation needed: nothing was archived.\n\n→ lift clean --yes\n',
    });
    expect(archives(n8n)).toEqual([]);
    expect(lock.writes).toEqual([]);
  });

  test('Should never ask and give lift clean --yes as next for each removed workflow when --json is given', async () => {
    const n8n = instance();

    const result = await cleanCommand.run({ positionals: [], values: { json: true } }, context(n8n, lockFile(), { isInteractive: true }));

    expect(result.exitCode).toBe(11);
    expect(JSON.parse(result.stdout)).toEqual({
      target: 'dev',
      instance: 'https://n8n.example.com',
      stage: 'confirmation-needed',
      message: 'Confirmation needed: nothing was archived. lift clean --yes archives the 2 removed workflows.',
      removed: [
        { stableName: 'legacy', id: 'leg1', name: 'Legacy', state: 'already-archived', next: 'lift clean --yes' },
        { stableName: 'old-report', id: 'old1', name: 'Old report', state: 'to-archive', next: 'lift clean --yes' },
      ],
      notDeployed: [{ stableName: 'invoice-sync', path: 'workflows/invoice-sync.json', next: 'lift deploy' }],
      unmanaged: [{ id: 'h1', name: 'Hand made', next: null }],
      exitCode: 11,
    });
  });

  test('Should give each result its action and next step when --json --yes is given', async () => {
    const n8n = instance();

    const result = await cleanCommand.run({ positionals: [], values: { json: true, yes: true } }, context(n8n));

    expect(JSON.parse(result.stdout)).toMatchObject({
      stage: 'cleaned',
      results: [
        { stableName: 'legacy', id: 'leg1', name: 'Legacy', action: 'already-archived', next: null },
        { stableName: 'old-report', id: 'old1', name: 'Old report', action: 'archived', next: null },
      ],
      summary: { archived: 1, alreadyArchived: 1, notFound: 0, failed: 0 },
      lockFileUpdated: true,
      exitCode: 0,
    });
  });

  test('Should list what it would archive, ask nothing and change nothing when --dry-run is given', async () => {
    const n8n = instance();
    const lock = lockFile();

    const result = await cleanCommand.run({ positionals: [], values: { 'dry-run': true } }, context(n8n, lock));

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Dry run: nothing was archived.\n\n→ lift clean  archives the 2 removed workflows\n');
    expect(archives(n8n)).toEqual([]);
    expect(lock.writes).toEqual([]);
  });

  test('Should say there is nothing to clean and exit 0 without asking when every recorded workflow has its file', async () => {
    const n8n = instance();
    const lock = fakeLockFile({ text: fakeLockText({ 'crm-import': 'crm1' }) });

    const result = await cleanCommand.run(TEXT, context(n8n, lock));

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Nothing to clean: every workflow boilerlift.lock.json records still has its file.\n');
  });

  test('Should not propose a workflow when another target on the same instance still has its file', async () => {
    const n8n = instance();
    const ctx = context(n8n, lockFile(), {
      loadProjectConfig: fakeProjectConfig({
        targets: {
          dev: { url: 'https://n8n.example.com', apiKey: 'secret', workflows: './dev' },
          staging: { url: 'https://n8n.example.com', apiKey: 'secret', workflows: './staging' },
        },
      }),
      loadWorkflowFiles: (dir) => Promise.resolve((dir === './staging' ? [OLD] : [CRM]).map(fakeWorkflowFile)),
    });

    const result = await cleanCommand.run({ positionals: [], values: { json: true, target: 'dev' } }, ctx);

    expect(JSON.parse(result.stdout)).toMatchObject({ removed: [{ stableName: 'legacy' }] });
  });

  test('Should keep the failed entry, clean the others and exit 5 with a next step when one archive is refused', async () => {
    const n8n = fakeN8n({
      workflows: [fakeN8nWorkflow(OLD, { id: 'old1' }), fakeN8nWorkflow(LEGACY, { id: 'leg1' })],
      failures: [httpError('POST /api/v1/workflows/leg1/archive', 403, 'Forbidden')],
    });
    const lock = lockFile();

    const result = await cleanCommand.run(YES, context(n8n, lock));

    expect(result).toMatchObject({
      exitCode: 5,
      stderr: 'Not cleaned: legacy.\n\n→ lift clean  once the step under each line is done\n',
    });
    expect(result.stdout).toContain(
      [
        '✗ legacy      failed',
        '  POST /api/v1/workflows/leg1/archive : HTTP 403: Forbidden',
        '  → Give the API key the workflow:delete scope (n8n → Settings → n8n API), then run lift clean again',
      ].join('\n'),
    );
    expect(lock.text()).toBe(fakeLockText({ 'crm-import': 'crm1', legacy: 'leg1' }));
  });

  test('Should archive nothing and exit 3 with lift ping next when the instance cannot be reached', async () => {
    const n8n = fakeN8n({ failures: [unreachable('GET /api/v1/workflows/leg1', 'connection refused')] });

    const result = await cleanCommand.run(YES, context(n8n));

    expect(result).toEqual({
      exitCode: 3,
      stdout: '',
      stderr: '✗ GET /api/v1/workflows/leg1 : unreachable: connection refused\n  → lift ping\n\nNothing was archived.\n',
    });
  });

  test('Should exit 1 and archive nothing when the lock file is invalid', async () => {
    const n8n = instance();

    const result = await cleanCommand.run(YES, context(n8n, fakeLockFile({ text: '{' })));

    expect(result.exitCode).toBe(1);
    expect(n8n.calls).toEqual([]);
  });

  test('Should ask once, saying the deletion is permanent, before deleting when --delete is given in a terminal', async () => {
    const n8n = instance();
    const stdin = fakeAnswer('n');

    await cleanCommand.run(DELETE, context(n8n, lockFile(), { isInteractive: true, ask: stdin.ask }));

    expect(stdin.prompts).toEqual([
      [
        'lift clean · dev (https://n8n.example.com)',
        '',
        '- legacy      Legacy (leg1): will be deleted for good',
        '- old-report  Old report (old1): will be deleted for good',
        '',
        'Delete these 2 workflows for good? This cannot be undone. [y/N] ',
      ].join('\n'),
    ]);
  });

  test('Should delete nothing, archive nothing and exit 0 with "Nothing deleted." when the --delete answer is not yes', async () => {
    const n8n = instance();
    const lock = lockFile();

    const result = await cleanCommand.run(DELETE, context(n8n, lock, { isInteractive: true, ask: fakeAnswer('no').ask }));

    expect(result).toEqual({ exitCode: 0, stdout: 'Nothing deleted.\n', stderr: '' });
    expect(n8n.calls.every((call) => call.startsWith('GET '))).toBe(true);
    expect(lock.writes).toEqual([]);
  });

  test('Should archive then delete each removed workflow, already archived ones too, and drop their entries when --delete --yes is given', async () => {
    const n8n = instance();
    const lock = lockFile();

    const result = await cleanCommand.run(DELETE_YES, context(n8n, lock));

    expect(result).toMatchObject({ exitCode: 0, stderr: '' });
    expect(result.stdout).toContain(
      [
        '- legacy      deleted  Legacy (leg1)',
        '- old-report  deleted  Old report (old1)',
        '',
        'Not deployed yet:',
        '+ invoice-sync  workflows/invoice-sync.json',
        '',
        'Not in my project (clean never touches them):',
        '· Hand made (h1)',
        '',
        '2 deleted, 0 not found, 0 failed.',
        '',
        '→ commit boilerlift.lock.json  it was updated',
      ].join('\n'),
    );
    expect(archives(n8n)).toEqual(['POST /api/v1/workflows/old1/archive']);
    expect(deletes(n8n)).toEqual(['DELETE /api/v1/workflows/leg1', 'DELETE /api/v1/workflows/old1']);
    expect(lock.text()).toBe(fakeLockText({ 'crm-import': 'crm1' }));
  });

  test('Should list, delete nothing and exit 11 with lift clean --delete --yes next when --delete is given without a terminal', async () => {
    const n8n = instance();
    const lock = lockFile();

    const result = await cleanCommand.run(DELETE, context(n8n, lock));

    expect(result).toMatchObject({ exitCode: 11, stderr: 'Confirmation needed: nothing was deleted.\n\n→ lift clean --delete --yes\n' });
    expect(result.stdout).toContain('Confirmation needed: nothing was deleted.\n\n→ lift clean --delete --yes  deletes the 2 removed workflows for good\n');
    expect(n8n.calls.every((call) => call.startsWith('GET '))).toBe(true);
    expect(lock.writes).toEqual([]);
  });

  test('Should plan each removed workflow as to-delete with lift clean --delete --yes next when --delete --json is given', async () => {
    const n8n = instance();

    const result = await cleanCommand.run({ positionals: [], values: { delete: true, json: true } }, context(n8n, lockFile(), { isInteractive: true }));

    expect(result.exitCode).toBe(11);
    expect(JSON.parse(result.stdout)).toMatchObject({
      stage: 'confirmation-needed',
      removed: [
        { stableName: 'legacy', state: 'to-delete', next: 'lift clean --delete --yes' },
        { stableName: 'old-report', state: 'to-delete', next: 'lift clean --delete --yes' },
      ],
    });
  });

  test('Should give each result the deleted action and a summary with deleted when --delete --json --yes is given', async () => {
    const n8n = instance();

    const result = await cleanCommand.run({ positionals: [], values: { delete: true, json: true, yes: true } }, context(n8n));

    expect(JSON.parse(result.stdout)).toMatchObject({
      stage: 'cleaned',
      results: [
        { stableName: 'legacy', action: 'deleted', next: null },
        { stableName: 'old-report', action: 'deleted', next: null },
      ],
      summary: { deleted: 2, notFound: 0, failed: 0 },
      lockFileUpdated: true,
      exitCode: 0,
    });
  });

  test('Should list what it would delete and change nothing on the instance when --dry-run --delete is given', async () => {
    const n8n = instance();
    const lock = lockFile();

    const result = await cleanCommand.run({ positionals: [], values: { delete: true, 'dry-run': true } }, context(n8n, lock));

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('- old-report  Old report (old1): will be deleted for good\n');
    expect(result.stdout).toContain('Dry run: nothing was deleted.\n\n→ lift clean --delete --yes  deletes the 2 removed workflows for good\n');
    expect(n8n.calls.every((call) => call.startsWith('GET '))).toBe(true);
    expect(lock.writes).toEqual([]);
  });

  test('Should keep the entry, exit 5 and give lift clean --delete next when the delete fails after the archive', async () => {
    const n8n = fakeN8n({
      workflows: [fakeN8nWorkflow(OLD, { id: 'old1' }), fakeN8nWorkflow(LEGACY, { id: 'leg1', isArchived: true })],
      failures: [httpError('DELETE /api/v1/workflows/old1', 500, 'Internal error')],
    });
    const lock = lockFile();

    const result = await cleanCommand.run({ positionals: [], values: { delete: true, yes: true, json: true } }, context(n8n, lock));

    expect(JSON.parse(result.stdout)).toMatchObject({
      results: [
        { stableName: 'legacy', action: 'deleted' },
        { stableName: 'old-report', action: 'failed', error: { kind: 'delete-failed', cause: 'rejected' }, next: 'lift clean --delete' },
      ],
      exitCode: 5,
    });
    expect(n8n.workflows.find(({ id }) => id === 'old1')).toMatchObject({ isArchived: true });
    expect(lock.text()).toBe(fakeLockText({ 'crm-import': 'crm1', 'old-report': 'old1' }));
  });

  test('Should name the workflow:delete scope under the line when a delete is refused with 403', async () => {
    const n8n = fakeN8n({
      workflows: [fakeN8nWorkflow(OLD, { id: 'old1', isArchived: true })],
      failures: [httpError('DELETE /api/v1/workflows/old1', 403, 'Forbidden')],
    });

    const result = await cleanCommand.run(DELETE_YES, context(n8n));

    expect(result).toMatchObject({ exitCode: 5, stderr: 'Not cleaned: old-report.\n\n→ lift clean --delete  once the step under each line is done\n' });
    expect(result.stdout).toContain(
      [
        '✗ old-report  failed',
        '  DELETE /api/v1/workflows/old1 : HTTP 403: Forbidden',
        '  → The workflow stays archived. Give the API key the workflow:delete scope (n8n → Settings → n8n API), then run lift clean --delete again',
      ].join('\n'),
    );
  });
});
