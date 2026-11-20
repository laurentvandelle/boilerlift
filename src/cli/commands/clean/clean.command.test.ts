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

describe('cleanCommand', () => {
  test('Should list the three groups and ask once before archiving when a person runs it in a terminal', async () => {
    const n8n = instance();
    const stdin = fakeAnswer('y');

    await cleanCommand.run(TEXT, context(n8n, lockFile(), { isInteractive: true, ask: stdin.ask }));

    expect(stdin.prompts).toEqual([
      [
        'lift clean → dev (https://n8n.example.com)',
        '  - legacy      Legacy (leg1): already archived in n8n: its entry will be dropped from boilerlift.lock.json',
        '  - old-report  Old report (old1): will be archived',
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
        'lift clean → dev (https://n8n.example.com)',
        '= already archived legacy      Legacy (leg1), entry dropped from boilerlift.lock.json',
        '- archived         old-report  Old report (old1)',
        '1 archived, 1 already archived, 0 not found, 0 failed.',
        'boilerlift.lock.json updated — commit it.',
        'Not deployed yet:',
        '  + invoice-sync  workflows/invoice-sync.json',
        '    → lift deploy',
        'Not in my project (clean never touches them):',
        '  · Hand made (h1)',
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
        'lift clean → dev (https://n8n.example.com)',
        'Removed from the project:',
        '  - legacy      Legacy (leg1): already archived in n8n: its entry will be dropped from boilerlift.lock.json',
        '  - old-report  Old report (old1): will be archived',
        'Not deployed yet:',
        '  + invoice-sync  workflows/invoice-sync.json',
        '    → lift deploy',
        'Not in my project (clean never touches them):',
        '  · Hand made (h1)',
        'Confirmation needed: nothing was archived. lift clean --yes archives the 2 removed workflows.',
        '',
      ].join('\n'),
      stderr: 'Confirmation needed: nothing was archived.\nNext: lift clean --yes\n',
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
    expect(result.stdout).toContain('Dry run: nothing was archived. lift clean archives the 2 removed workflows.\n');
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
      stderr: 'Not cleaned: legacy.\nNext: follow the step under each line, then run lift clean again.\n',
    });
    expect(result.stdout).toContain(
      [
        '✗ failed           legacy      POST /api/v1/workflows/leg1/archive → HTTP 403: Forbidden',
        '                   → Give the API key the workflow:delete scope (n8n → Settings → n8n API), then run lift clean again',
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
      stderr: '✗ GET /api/v1/workflows/leg1 → unreachable: connection refused\n  → lift ping\nNothing was archived.\n',
    });
  });

  test('Should exit 1 and archive nothing when the lock file is invalid', async () => {
    const n8n = instance();

    const result = await cleanCommand.run(YES, context(n8n, fakeLockFile({ text: '{' })));

    expect(result.exitCode).toBe(1);
    expect(n8n.calls).toEqual([]);
  });
});
