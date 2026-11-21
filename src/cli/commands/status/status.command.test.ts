import { describe, expect, test } from 'vitest';
import { CommandContext } from '#src/cli/cli.model';
import {
  FAKE_DEV_URL as DEV_URL,
  FakeLockFile,
  fakeContext,
  fakeLockFile,
  fakeProjectConfig,
  fakeSingleTarget,
  fakeTwoTargets,
} from '#src/cli/cli.fake';
import { statusCommand } from '#src/cli/commands/status/status.command';
import { fakeLocalWorkflow, fakeNode, fakeWorkflowFile } from '#src/core/compile/workflow.fake';
import { fakeLockText } from '#src/core/deliver/lock-file.fake';
import { FakeN8n, fakeN8n, fakeN8nByOrigin, fakeN8nWorkflow, httpError, unreachable } from '#src/core/n8n/n8n.fake';

const TEXT = { positionals: [], values: {} };
const JSON_INPUT = { positionals: [], values: { json: true } };

const CRM = fakeLocalWorkflow('crm-import', { path: 'workflows/crm-import.json', name: 'CRM import' });
const REPORT = fakeLocalWorkflow('daily-report', { path: 'workflows/daily-report.workflow.ts', name: 'Daily report' });
const INVOICE = fakeLocalWorkflow('invoice-sync', { path: 'workflows/invoice-sync.workflow.ts', name: 'Invoice sync' });
const WEEKLY = fakeLocalWorkflow('weekly', { path: 'workflows/weekly.json', name: 'Weekly' });
const HAND_MADE = fakeLocalWorkflow('hand-made', { name: 'Hand made' });
const OLD_HAND_MADE = fakeLocalWorkflow('old-hand-made', { name: 'Old hand made' });
const FILES = [CRM, REPORT, INVOICE, WEEKLY].map(fakeWorkflowFile);

/** CRM differs, REPORT is a draft not yet published, WEEKLY is archived, INVOICE is not recorded; two hand-made workflows, one archived. */
function mixedInstance(): FakeN8n {
  return fakeN8n({
    workflows: [
      fakeN8nWorkflow(CRM, { id: 'crm1', nodes: [fakeNode({ name: 'Changed in n8n' })] }),
      fakeN8nWorkflow(REPORT, { id: 'rep1', versionId: 'v2', activeVersionId: 'v1' }),
      fakeN8nWorkflow(WEEKLY, { id: 'wk1', isArchived: true }),
      fakeN8nWorkflow(HAND_MADE, { id: 'h1' }),
      fakeN8nWorkflow(OLD_HAND_MADE, { id: 'h2', isArchived: true }),
    ],
  });
}

function mixedLock(): FakeLockFile {
  return fakeLockFile({ text: fakeLockText({ 'crm-import': 'crm1', 'daily-report': 'rep1', weekly: 'wk1' }) });
}

function context(n8n: FakeN8n, overrides: Partial<CommandContext> = {}, lock: FakeLockFile = mixedLock()): CommandContext {
  return fakeContext({
    registry: [statusCommand],
    loadProjectConfig: fakeSingleTarget(),
    loadWorkflowFiles: () => Promise.resolve(FILES),
    fetch: n8n.fetch,
    ...lock.context,
    ...overrides,
  });
}

describe('statusCommand', () => {
  test('Should show each workflow with its state and next step when it runs on the only target', async () => {
    const ctx = context(mixedInstance());

    const result = await statusCommand.run(TEXT, ctx);

    expect(result).toEqual({
      exitCode: 0,
      stdout: [
        'lift status · dev (https://n8n.example.com)',
        '',
        '~ crm-import    differs from n8n — next deploy overwrites the n8n draft',
        '  → lift deploy',
        '^ daily-report  draft not yet published',
        '  → lift publish daily-report',
        '+ invoice-sync  missing on the instance (workflows/invoice-sync.workflow.ts)',
        '  → lift deploy',
        '↺ weekly        archived in n8n — next deploy restores it',
        '  → lift deploy',
        '· Hand made     not in my project (h1)',
        '',
        '1 missing, 1 archived, 1 differ, 1 draft not yet published, 0 up to date, 0 removed, 1 not in my project.',
        '',
      ].join('\n'),
      stderr: '',
    });
  });

  test('Should show a lock entry with no workflow file as removed, with lift clean next, when its file was deleted', async () => {
    const lock = fakeLockFile({ text: fakeLockText({ weekly: 'wk1', 'old-report': 'old1' }) });
    const ctx = context(fakeN8n({ workflows: [fakeN8nWorkflow(WEEKLY, { id: 'wk1' })] }), { loadWorkflowFiles: () => Promise.resolve([fakeWorkflowFile(WEEKLY)]) }, lock);

    const result = await statusCommand.run({ positionals: [], values: { managed: 'true' } }, ctx);

    expect(result.stdout).toBe(
      [
        'lift status · dev (https://n8n.example.com)',
        '',
        '= weekly      up to date',
        '- old-report  removed from the project — lift clean archives it (old1)',
        '  → lift clean',
        '',
        '0 missing, 0 archived, 0 differ, 0 draft not yet published, 1 up to date, 1 removed, 0 not in my project.',
        '',
      ].join('\n'),
    );
  });

  test('Should not show a workflow as removed when another target on the same instance still has its file', async () => {
    const lock = fakeLockFile({ text: fakeLockText({ weekly: 'wk1' }) });
    const ctx = context(fakeN8n({ workflows: [fakeN8nWorkflow(WEEKLY, { id: 'wk1' })] }), {
      loadProjectConfig: fakeProjectConfig({
        targets: {
          dev: { url: 'https://n8n.example.com', apiKey: 'secret', workflows: './dev' },
          staging: { url: 'https://n8n.example.com', apiKey: 'secret', workflows: './staging' },
        },
      }),
      loadWorkflowFiles: (dir) => Promise.resolve(dir === './staging' ? [fakeWorkflowFile(WEEKLY)] : []),
    }, lock);

    const result = await statusCommand.run({ positionals: [], values: { json: true, target: 'dev' } }, ctx);

    expect(JSON.parse(result.stdout)).toMatchObject({ summary: { removed: 0 } });
  });

  test('Should give each workflow its state and the command to run next when --json is given', async () => {
    const ctx = context(mixedInstance());

    const result = await statusCommand.run(JSON_INPUT, ctx);

    expect(JSON.parse(result.stdout)).toMatchObject({
      target: 'dev',
      instance: 'https://n8n.example.com',
      message: null,
      workflows: [
        { state: 'differs', stableName: 'crm-import', path: 'workflows/crm-import.json', name: 'CRM import', id: 'crm1', next: 'lift deploy' },
        { state: 'draft-pending', stableName: 'daily-report', id: 'rep1', next: 'lift publish daily-report' },
        { state: 'missing', stableName: 'invoice-sync', id: null, next: 'lift deploy' },
        { state: 'archived', stableName: 'weekly', id: 'wk1', next: 'lift deploy' },
        { state: 'unmanaged', stableName: null, path: null, name: 'Hand made', id: 'h1', isArchived: false, next: null },
      ],
      error: null,
      exitCode: 0,
    });
  });

  test('Should add --target to the next command when a target is named', async () => {
    const ctx = context(mixedInstance());

    const result = await statusCommand.run({ positionals: [], values: { json: true, target: 'dev' } }, ctx);

    expect(JSON.parse(result.stdout)).toMatchObject({
      workflows: [
        { stableName: 'crm-import', next: 'lift deploy --target dev' },
        { stableName: 'daily-report', next: 'lift publish daily-report --target dev' },
        {},
        {},
        {},
      ],
    });
  });

  test('Should show the up to date workflows with no next step when the published version holds the local file', async () => {
    const n8n = fakeN8n({ workflows: [fakeN8nWorkflow(CRM, { id: 'crm1' })] });
    const ctx = context(n8n, { loadWorkflowFiles: () => Promise.resolve([fakeWorkflowFile(CRM)]) }, fakeLockFile({ text: fakeLockText({ 'crm-import': 'crm1' }) }));

    const result = await statusCommand.run(TEXT, ctx);

    expect(result.stdout).toBe(
      'lift status · dev (https://n8n.example.com)\n\n= crm-import  up to date\n\n0 missing, 0 archived, 0 differ, 0 draft not yet published, 1 up to date, 0 removed, 0 not in my project.\n',
    );
  });

  test('Should list the archived workflows that are not in the project when --archived is given', async () => {
    const ctx = context(mixedInstance());

    const result = await statusCommand.run({ positionals: [], values: { archived: true } }, ctx);

    expect(result.stdout).toContain('· Old hand made  not in my project (h2, archived)');
  });

  test('Should show only the workflows of the project when --managed=true is given', async () => {
    const n8n = mixedInstance();
    const ctx = context(n8n);

    const result = await statusCommand.run({ positionals: [], values: { managed: 'true' } }, ctx);

    expect(result.stdout).not.toContain('not in my project (');
    expect(n8n.requests.some((request) => request.includes('/api/v1/workflows?'))).toBe(false);
  });

  test('Should show only the workflows that are not in the project when --managed=false is given', async () => {
    const ctx = context(mixedInstance());

    const result = await statusCommand.run({ positionals: [], values: { managed: 'false', json: true } }, ctx);

    expect(JSON.parse(result.stdout)).toMatchObject({ workflows: [{ state: 'unmanaged', id: 'h1' }] });
  });

  test('Should exit 1 when --managed is neither true nor false', async () => {
    const ctx = context(mixedInstance());

    const result = await statusCommand.run({ positionals: [], values: { managed: 'yes' } }, ctx);

    expect(result).toEqual({ exitCode: 1, stdout: '', stderr: '--managed takes true or false, found "yes".\n' });
  });

  test('Should show the empty message and still list the instance workflows when the project has no workflow file', async () => {
    const n8n = fakeN8n({ workflows: [fakeN8nWorkflow(HAND_MADE, { id: 'h1' })] });
    const ctx = context(n8n, { loadWorkflowFiles: () => Promise.resolve([]) }, fakeLockFile());

    const result = await statusCommand.run(TEXT, ctx);

    expect(result).toEqual({
      exitCode: 0,
      stdout: [
        'lift status · dev (https://n8n.example.com)',
        '',
        '· Hand made  not in my project (h1)',
        '',
        'No workflow yet in ./workflows. Add a workflow file there, then run lift deploy.',
        '0 missing, 0 archived, 0 differ, 0 draft not yet published, 0 up to date, 0 removed, 1 not in my project.',
        '',
      ].join('\n'),
      stderr: '',
    });
  });

  test('Should tell the user to run lift ping and exit 3 when the instance cannot be reached', async () => {
    const n8n = fakeN8n({ failures: [unreachable('GET /api/v1/workflows/crm1', 'connection refused')] });
    const ctx = context(n8n);

    const result = await statusCommand.run(TEXT, ctx);

    expect(result).toEqual({
      exitCode: 3,
      stdout: 'lift status · dev (https://n8n.example.com)\n',
      stderr: '✗ GET /api/v1/workflows/crm1 : unreachable: connection refused\n  → lift ping\n',
    });
  });

  test('Should tell the user to run lift ping on the named target and exit 4 when the API key is rejected', async () => {
    const n8n = fakeN8n({ failures: [httpError('GET /api/v1/workflows/crm1', 401)] });
    const ctx = context(n8n);

    const result = await statusCommand.run({ positionals: [], values: { json: true, target: 'dev' } }, ctx);

    expect(result.exitCode).toBe(4);
    expect(JSON.parse(result.stdout)).toMatchObject({
      error: { kind: 'key-rejected', call: 'GET /api/v1/workflows/crm1', detail: 'HTTP 401', next: 'lift ping --target dev' },
      exitCode: 4,
    });
  });

  test('Should exit 1 when the lock file is invalid', async () => {
    const ctx = context(mixedInstance(), {}, fakeLockFile({ text: '{' }));

    const result = await statusCommand.run(TEXT, ctx);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Invalid boilerlift.lock.json.');
  });

  test('Should exit 1 when a workflow file does not load', async () => {
    const ctx = context(mixedInstance(), { loadWorkflowFiles: () => Promise.resolve([{ path: 'workflows/Bad Name.json', content: {} }]) });

    const result = await statusCommand.run(TEXT, ctx);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Invalid workflow files.');
  });

  test('Should change nothing on the instance or in the lock file when it runs', async () => {
    const n8n = mixedInstance();
    const lock = mixedLock();
    const ctx = context(n8n, {}, lock);

    await statusCommand.run(TEXT, ctx);

    expect(n8n.requests.every((request) => request.startsWith('GET '))).toBe(true);
    expect(lock.writes).toEqual([]);
  });

  test('Should show one block per target with --target in each next step when --all is given', async () => {
    const dev = fakeN8n();
    const prod = fakeN8n();
    const ctx = fakeContext({
      registry: [statusCommand],
      loadProjectConfig: fakeTwoTargets(),
      loadWorkflowFiles: (dir) => Promise.resolve(dir === './dev' ? [fakeWorkflowFile(CRM)] : []),
      fetch: fakeN8nByOrigin({ [DEV_URL]: dev, 'https://prod.example.com': prod }),
    });

    const result = await statusCommand.run({ positionals: [], values: { all: true } }, ctx);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('── dev (https://dev.example.com)\nlift status · dev (https://dev.example.com)\n\n+ crm-import');
    expect(result.stdout).toContain('  → lift deploy --target dev');
    expect(result.stdout).toContain('No workflow yet in ./prod. Add a workflow file there, then run lift deploy.');
  });
});
