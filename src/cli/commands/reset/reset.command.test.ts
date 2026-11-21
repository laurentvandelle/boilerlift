import { describe, expect, test } from 'vitest';
import { CommandContext, CommandInput } from '#src/cli/cli.model';
import { FakeLockFile, fakeAnswer, fakeContext, fakeLockFile, fakeProjectConfig, fakeSingleTarget } from '#src/cli/cli.fake';
import { resetCommand } from '#src/cli/commands/reset/reset.command';
import { fakeLocalWorkflow, fakeWorkflowFile } from '#src/core/compile/workflow.fake';
import { fakeLockText } from '#src/core/deliver/lock-file.fake';
import { FakeN8n, fakeN8n, fakeN8nWorkflow, httpError, unreachable } from '#src/core/n8n/n8n.fake';

const DEV: CommandInput = { positionals: [], values: { target: 'dev' } };
const DEV_YES: CommandInput = { positionals: [], values: { target: 'dev', yes: true } };

const CRM = fakeLocalWorkflow('crm-import', { path: 'dev/crm-import.json', name: 'CRM import' });
const REPORT = fakeLocalWorkflow('daily-report', { path: 'staging/daily-report.json', name: 'Daily report' });
const OLD = fakeLocalWorkflow('old-report', { name: 'Old report' });
const HAND_MADE = fakeLocalWorkflow('hand-made', { name: 'Hand made' });

/** CRM is dev's, REPORT is staging's, OLD has no file any more (removed), and one hand-made workflow. */
function instance(): FakeN8n {
  return fakeN8n({
    workflows: [
      fakeN8nWorkflow(CRM, { id: 'crm1' }),
      fakeN8nWorkflow(REPORT, { id: 'rep1' }),
      fakeN8nWorkflow(OLD, { id: 'old1', isArchived: true }),
      fakeN8nWorkflow(HAND_MADE, { id: 'h1' }),
    ],
  });
}

const ENTRIES = { 'crm-import': 'crm1', 'daily-report': 'rep1', 'old-report': 'old1' };

function lockFile(entries: Record<string, string> = ENTRIES): FakeLockFile {
  return fakeLockFile({ text: fakeLockText(entries) });
}

/** dev and staging share one instance, with their files in ./dev and ./staging. */
function context(n8n: FakeN8n, lock: FakeLockFile = lockFile(), overrides: Partial<CommandContext> = {}): CommandContext {
  return fakeContext({
    registry: [resetCommand],
    loadProjectConfig: fakeProjectConfig({
      targets: {
        dev: { url: 'https://n8n.example.com', apiKey: 'secret', workflows: './dev' },
        staging: { url: 'https://n8n.example.com', apiKey: 'secret', workflows: './staging' },
      },
    }),
    loadWorkflowFiles: (dir) => Promise.resolve((dir === './staging' ? [REPORT] : [CRM]).map(fakeWorkflowFile)),
    fetch: n8n.fetch,
    ...lock.context,
    ...overrides,
  });
}

function writes(n8n: FakeN8n): string[] {
  return n8n.calls.filter((call) => !call.startsWith('GET '));
}

describe('resetCommand', () => {
  test('Should refuse with exit 1 and read nothing when --target is not given, even with a single target', async () => {
    const n8n = instance();

    const result = await resetCommand.run({ positionals: [], values: {} }, context(n8n, lockFile(), { loadProjectConfig: fakeSingleTarget() }));

    expect(result).toEqual({
      exitCode: 1,
      stdout: '',
      stderr: 'lift reset needs --target <name>, even with a single target declared: it resets one named target, never --all.\n',
    });
    expect(n8n.calls).toEqual([]);
  });

  test('Should refuse with exit 1 and read nothing when --all is given', async () => {
    const n8n = instance();

    const result = await resetCommand.run({ positionals: [], values: { all: true } }, context(n8n));

    expect(result.exitCode).toBe(1);
    expect(n8n.calls).toEqual([]);
  });

  test('Should list the workflows of the target and the removed ones, and ask for the target name, when a person runs it', async () => {
    const n8n = instance();
    const stdin = fakeAnswer('dev');

    await resetCommand.run(DEV, context(n8n, lockFile(), { isInteractive: true, ask: stdin.ask }));

    expect(stdin.prompts).toEqual([
      [
        'lift reset · dev (https://n8n.example.com)',
        '',
        '- crm-import  CRM import (crm1): will be archived',
        '= old-report  Old report (old1): already archived in n8n: its entry will be dropped from boilerlift.lock.json',
        '',
        '1 workflows of target staging kept',
        '',
        'Reset dev? The 2 workflows are archived in n8n and dropped from boilerlift.lock.json.',
        'Type the target name (dev) to confirm: ',
      ].join('\n'),
    ]);
  });

  test('Should archive the workflows, drop their entries and keep the other target\'s when the typed name matches', async () => {
    const n8n = instance();
    const lock = lockFile();

    const result = await resetCommand.run(DEV, context(n8n, lock, { isInteractive: true, ask: fakeAnswer('  dev \n').ask }));

    expect(result).toEqual({
      exitCode: 0,
      stdout: [
        'lift reset · dev (https://n8n.example.com)',
        '',
        '- crm-import  archived  CRM import (crm1)',
        '= old-report  already archived  Old report (old1), entry dropped from boilerlift.lock.json',
        '',
        '1 archived, 1 already archived, 0 not found, 0 failed.',
        '1 workflows of target staging kept',
        '',
        '→ commit boilerlift.lock.json  it was updated',
        '',
      ].join('\n'),
      stderr: '',
    });
    expect(writes(n8n)).toEqual(['POST /api/v1/workflows/crm1/archive']);
    expect(lock.text()).toBe(fakeLockText({ 'daily-report': 'rep1' }));
  });

  test('Should change nothing and exit 0 when the typed name differs in case', async () => {
    const n8n = instance();
    const lock = lockFile();

    const result = await resetCommand.run(DEV, context(n8n, lock, { isInteractive: true, ask: fakeAnswer('Dev').ask }));

    expect(result).toEqual({ exitCode: 0, stdout: 'Nothing archived.\n', stderr: '' });
    expect(writes(n8n)).toEqual([]);
    expect(lock.writes).toEqual([]);
  });

  test('Should change nothing and exit 0 when stdin closes without an answer', async () => {
    const n8n = instance();

    const result = await resetCommand.run(DEV, context(n8n, lockFile(), { isInteractive: true, ask: fakeAnswer(undefined).ask }));

    expect(result.exitCode).toBe(0);
    expect(writes(n8n)).toEqual([]);
  });

  test('Should remove without asking when --force is given', async () => {
    const n8n = instance();

    const result = await resetCommand.run({ positionals: [], values: { target: 'dev', force: true } }, context(n8n));

    expect(result.exitCode).toBe(0);
    expect(writes(n8n)).toEqual(['POST /api/v1/workflows/crm1/archive']);
  });

  test('Should list, change nothing and exit 11 with the next step when there is no terminal and no --yes', async () => {
    const n8n = instance();

    const result = await resetCommand.run(DEV, context(n8n));

    expect(result).toMatchObject({ exitCode: 11, stderr: 'Confirmation needed: nothing was archived.\n\n→ lift reset --target dev --yes\n' });
    expect(writes(n8n)).toEqual([]);
  });

  test('Should print the workflows and the kept entries as JSON and exit 11 when --json is given without --yes', async () => {
    const n8n = instance();

    const result = await resetCommand.run({ positionals: [], values: { target: 'dev', json: true } }, context(n8n, lockFile(), { isInteractive: true }));

    expect(result.exitCode).toBe(11);
    expect(JSON.parse(result.stdout)).toMatchObject({
      target: 'dev',
      stage: 'confirmation-needed',
      workflows: [
        { stableName: 'crm-import', id: 'crm1', state: 'to-archive', next: 'lift reset --target dev --yes' },
        { stableName: 'old-report', id: 'old1', state: 'already-archived' },
      ],
      kept: [{ target: 'staging', count: 1 }],
      exitCode: 11,
    });
  });

  test('Should say there is nothing to remove, ask nothing and exit 0 when no entry matches the target', async () => {
    const n8n = instance();

    const result = await resetCommand.run(DEV, context(n8n, lockFile({ 'daily-report': 'rep1' }), { isInteractive: true }));

    expect(result).toEqual({
      exitCode: 0,
      stdout: 'lift reset · dev (https://n8n.example.com)\n\nNothing to remove on dev.\n1 workflows of target staging kept\n',
      stderr: '',
    });
  });

  test('Should return an empty list as JSON when there is nothing to remove', async () => {
    const n8n = instance();

    const result = await resetCommand.run({ positionals: [], values: { target: 'dev', json: true } }, context(n8n, lockFile({})));

    expect(JSON.parse(result.stdout)).toMatchObject({ stage: 'nothing-to-remove', workflows: [], exitCode: 0 });
  });

  test('Should list what it would archive, ask nothing and only read when --dry-run is given', async () => {
    const n8n = instance();

    const result = await resetCommand.run({ positionals: [], values: { target: 'dev', 'dry-run': true } }, context(n8n));

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Dry run: nothing was archived.\n\n→ lift reset --target dev  archives the 2 workflows\n');
    expect(writes(n8n)).toEqual([]);
  });

  test('Should say the deletion is permanent in the question when --delete is given', async () => {
    const n8n = instance();
    const stdin = fakeAnswer('no');

    await resetCommand.run({ positionals: [], values: { target: 'dev', delete: true } }, context(n8n, lockFile(), { isInteractive: true, ask: stdin.ask }));

    expect(stdin.prompts[0]).toContain('Reset dev? The 2 workflows are deleted for good: this cannot be undone.\nType the target name (dev) to confirm: ');
  });

  test('Should archive then delete each workflow and drop its entry when --delete --yes is given', async () => {
    const n8n = instance();
    const lock = lockFile();

    const result = await resetCommand.run({ positionals: [], values: { target: 'dev', delete: true, yes: true } }, context(n8n, lock));

    expect(result.stdout).toContain('2 deleted, 0 not found, 0 failed.\n');
    expect(writes(n8n)).toEqual(['POST /api/v1/workflows/crm1/archive', 'DELETE /api/v1/workflows/crm1', 'DELETE /api/v1/workflows/old1']);
    expect(lock.text()).toBe(fakeLockText({ 'daily-report': 'rep1' }));
  });

  test('Should count a workflow as removed and drop its entry when it is gone from the instance', async () => {
    const n8n = fakeN8n();
    const lock = lockFile({ 'crm-import': 'crm1' });

    const result = await resetCommand.run(DEV_YES, context(n8n, lock));

    expect(result.stdout).toContain('? crm-import  not found  crm1 is not in n8n, entry dropped from boilerlift.lock.json\n');
    expect(JSON.parse(lock.text() ?? '')).toEqual({ version: 1, instances: {} });
  });

  test('Should keep the entry, remove the others and exit 5 when the key lacks the workflow:delete scope for one', async () => {
    const n8n = fakeN8n({
      workflows: [fakeN8nWorkflow(CRM, { id: 'crm1' }), fakeN8nWorkflow(OLD, { id: 'old1' })],
      failures: [httpError('POST /api/v1/workflows/crm1/archive', 403, 'Forbidden')],
    });
    const lock = lockFile({ 'crm-import': 'crm1', 'old-report': 'old1' });

    const result = await resetCommand.run(DEV_YES, context(n8n, lock));

    expect(result).toMatchObject({
      exitCode: 5,
      stderr: 'Not reset: crm-import.\n\n→ lift reset --target dev  once the step under each line is done\n',
    });
    expect(result.stdout).toContain(
      '  → Give the API key the workflow:delete scope (n8n → Settings → n8n API), then run lift reset --target dev again',
    );
    expect(lock.text()).toBe(fakeLockText({ 'crm-import': 'crm1' }));
  });

  test('Should remove nothing and exit 3 with lift ping next when the instance cannot be reached', async () => {
    const n8n = fakeN8n({ failures: [unreachable('GET /api/v1/workflows/crm1', 'connection refused')] });

    const result = await resetCommand.run(DEV_YES, context(n8n));

    expect(result).toEqual({
      exitCode: 3,
      stdout: '',
      stderr: '✗ GET /api/v1/workflows/crm1 : unreachable: connection refused\n  → lift ping --target dev\n\nNothing was archived.\n',
    });
  });

  test('Should exit 1 and read nothing when the folder of another target on the instance is missing', async () => {
    const n8n = instance();

    const result = await resetCommand.run(DEV_YES, context(n8n, lockFile(), { isDirectory: (path) => Promise.resolve(path !== './staging') }));

    expect(result.exitCode).toBe(1);
    expect(n8n.calls).toEqual([]);
  });
});
