import { describe, expect, test } from 'vitest';
import { CommandContext, CommandInput } from '#src/cli/cli.model';
import { FAKE_DEV_URL, FAKE_PROD_URL, fakeAnswer, fakeContext, fakeLockFile, fakeSingleTarget, fakeTwoTargets } from '#src/cli/cli.fake';
import { publishCommand } from '#src/cli/commands/publish/publish.command';
import { fakeLocalWorkflow, fakeNode, fakeWorkflowFile } from '#src/core/compile/workflow.fake';
import { fakeLockText } from '#src/core/deliver/lock-file.fake';
import { FakeN8n, fakeN8n, fakeN8nByOrigin, fakeN8nWorkflow, httpError } from '#src/core/n8n/n8n.fake';

const TEXT: CommandInput = { positionals: [], values: {} };
const YES: CommandInput = { positionals: [], values: { yes: true } };

const CRM = fakeLocalWorkflow('crm-import', { path: 'workflows/crm-import.json', name: 'CRM import' });
const REPORT = fakeLocalWorkflow('daily-report', { path: 'workflows/daily-report.json', name: 'Daily report' });
const WEEKLY = fakeLocalWorkflow('weekly', { path: 'workflows/weekly.json', name: 'Weekly' });
const NEW = fakeLocalWorkflow('invoice-sync', { path: 'workflows/invoice-sync.json', name: 'Invoice sync' });
const FILES = [CRM, REPORT, WEEKLY, NEW].map(fakeWorkflowFile);

/** CRM differs, REPORT is a draft not yet published, WEEKLY is up to date, NEW is not deployed. */
function instance(): FakeN8n {
  return fakeN8n({
    workflows: [
      fakeN8nWorkflow(CRM, { id: 'crm1', nodes: [fakeNode({ name: 'Changed in n8n' })] }),
      fakeN8nWorkflow(REPORT, { id: 'rep1', versionId: 'v2', activeVersionId: 'v1' }),
      fakeN8nWorkflow(WEEKLY, { id: 'wk1' }),
    ],
  });
}

function context(n8n: FakeN8n, overrides: Partial<CommandContext> = {}): CommandContext {
  return fakeContext({
    registry: [publishCommand],
    loadProjectConfig: fakeSingleTarget(),
    loadWorkflowFiles: () => Promise.resolve(FILES),
    fetch: n8n.fetch,
    ...fakeLockFile({ text: fakeLockText({ 'crm-import': 'crm1', 'daily-report': 'rep1', weekly: 'wk1' }) }).context,
    ...overrides,
  });
}

function published(n8n: FakeN8n): string[] {
  return n8n.calls.filter((call) => call.endsWith('/activate'));
}

describe('publishCommand', () => {
  test('Should list the drafts waiting and ask before publishing when no name is given', async () => {
    const n8n = instance();
    const stdin = fakeAnswer('y');

    const result = await publishCommand.run(TEXT, context(n8n, { ask: stdin.ask }));

    expect(stdin.prompts).toEqual([
      [
        'lift publish · dev (https://n8n.example.com)',
        '',
        '✗ crm-import    differs from n8n, not published',
        '  → lift deploy  first',
        '^ daily-report  draft not yet published, will be published',
        '',
        'Publish 1 workflow? [Y/n] ',
      ].join('\n'),
    ]);
    expect(result).toEqual({
      exitCode: 0,
      stdout: [
        'lift publish · dev (https://n8n.example.com)',
        '',
        '✗ crm-import    not published  differs from n8n: the local file and the n8n draft differ  https://n8n.example.com/workflow/crm1',
        '  → Run lift deploy first (it replaces any change made in the n8n editor), then lift publish crm-import',
        '^ daily-report  published  https://n8n.example.com/workflow/rep1 (the workflow now runs this version)',
        '',
        '1 published, 1 to deploy first, 0 failed.',
        '',
      ].join('\n'),
      stderr: '',
    });
    expect(n8n.workflows.find(({ id }) => id === 'rep1')).toMatchObject({ activeVersionId: 'v2' });
  });

  test('Should colour the question like the result when colour is on', async () => {
    const n8n = instance();
    const stdin = fakeAnswer('n');

    await publishCommand.run(TEXT, context(n8n, { ask: stdin.ask, color: true }));

    expect(stdin.prompts[0]).toContain('\u001b[31m✗\u001b[39m crm-import    differs from n8n, not published\n  \u001b[36m→ lift deploy\u001b[39m  first\n');
  });

  test('Should publish when the answer is empty (Enter)', async () => {
    const n8n = instance();

    const result = await publishCommand.run(TEXT, context(n8n, { ask: fakeAnswer('').ask }));

    expect(result.exitCode).toBe(0);
    expect(published(n8n)).toEqual(['POST /api/v1/workflows/rep1/activate']);
  });

  test('Should publish nothing and exit 1 with "Nothing published." when the answer is not yes', async () => {
    const n8n = instance();

    const result = await publishCommand.run(TEXT, context(n8n, { ask: fakeAnswer('n').ask }));

    expect(result).toEqual({ exitCode: 1, stdout: '', stderr: 'Nothing published.\n' });
    expect(published(n8n)).toEqual([]);
  });

  test('Should publish nothing and exit 1 when stdin closes before an answer', async () => {
    const n8n = instance();

    const result = await publishCommand.run(TEXT, context(n8n, { ask: fakeAnswer(undefined).ask }));

    expect(result.exitCode).toBe(1);
    expect(published(n8n)).toEqual([]);
  });

  test('Should give the command to run with --yes in the JSON when the confirmation is declined', async () => {
    const n8n = instance();

    const result = await publishCommand.run({ positionals: ['daily-report'], values: { json: true } }, context(n8n, { ask: fakeAnswer('n').ask }));

    expect(JSON.parse(result.stdout)).toEqual({ published: false, message: 'Nothing published.', next: 'lift publish daily-report --yes', exitCode: 1 });
  });

  test('Should publish without asking when --yes or --force is given', async () => {
    const n8n = instance();

    const result = await publishCommand.run({ positionals: [], values: { force: true } }, context(n8n));

    expect(result.exitCode).toBe(0);
    expect(published(n8n)).toEqual(['POST /api/v1/workflows/rep1/activate']);
  });

  test('Should print "Nothing to publish" without asking when no draft is waiting', async () => {
    const n8n = fakeN8n({ workflows: [fakeN8nWorkflow(WEEKLY, { id: 'wk1' })] });

    const result = await publishCommand.run(TEXT, context(n8n));

    expect(result).toEqual({
      exitCode: 0,
      stdout: 'lift publish · dev (https://n8n.example.com)\n\nNothing to publish: no draft is waiting to be published.\n',
      stderr: '',
    });
  });

  test('Should report the differing workflows under "Nothing to publish" and exit 0 when no draft is waiting', async () => {
    const n8n = fakeN8n({ workflows: [fakeN8nWorkflow(CRM, { id: 'crm1', nodes: [fakeNode({ name: 'Changed in n8n' })] }), fakeN8nWorkflow(WEEKLY, { id: 'wk1' })] });

    const result = await publishCommand.run(TEXT, context(n8n));

    expect(result).toEqual({
      exitCode: 0,
      stdout: [
        'lift publish · dev (https://n8n.example.com)',
        '',
        '✗ crm-import  not published  differs from n8n: the local file and the n8n draft differ  https://n8n.example.com/workflow/crm1',
        '  → Run lift deploy first (it replaces any change made in the n8n editor), then lift publish crm-import',
        '',
        'Nothing to publish: no draft is waiting to be published.',
        '',
      ].join('\n'),
      stderr: '',
    });
    expect(published(n8n)).toEqual([]);
  });

  test('Should report an up-to-date named workflow as already published and exit 0 when it is the only one named', async () => {
    const n8n = instance();

    const result = await publishCommand.run({ positionals: ['weekly'], values: {} }, context(n8n));

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('= weekly  already published  the published version holds the local file');
    expect(published(n8n)).toEqual([]);
  });

  test('Should refuse the differing workflow, publish the others and exit 5 when a named workflow differs from n8n', async () => {
    const n8n = instance();

    const result = await publishCommand.run({ positionals: ['crm-import', 'daily-report'], values: { yes: true } }, context(n8n));

    expect(result.exitCode).toBe(5);
    expect(result.stdout).toContain(
      '✗ crm-import    not published  differs from n8n: the local file and the n8n draft differ  https://n8n.example.com/workflow/crm1\n' +
        '  → Run lift deploy first (it replaces any change made in the n8n editor), then lift publish crm-import\n',
    );
    expect(result.stderr).toBe('Not published: crm-import.\n\n→ lift publish  once the step under each line is done\n');
    expect(published(n8n)).toEqual(['POST /api/v1/workflows/rep1/activate']);
  });

  test('Should publish nothing, ask nothing and exit 1 when a name is unknown', async () => {
    const n8n = instance();

    const result = await publishCommand.run({ positionals: ['daily-report', 'invoice-sync', 'nope'], values: {} }, context(n8n));

    expect(result).toEqual({
      exitCode: 1,
      stdout: '',
      stderr: [
        '✗ invoice-sync  not deployed to this instance: boilerlift.lock.json records no id for it, or n8n no longer has that id',
        '  → lift deploy',
        '✗ nope          no workflow file with this name in ./workflows',
        '  → lift status',
        '',
        'Unknown workflow names. Nothing was published.',
        '',
      ].join('\n'),
    });
    expect(published(n8n)).toEqual([]);
  });

  test('Should give each result and its next command in the JSON when --json is given', async () => {
    const n8n = instance();

    const result = await publishCommand.run({ positionals: ['crm-import', 'daily-report'], values: { yes: true, json: true } }, context(n8n));

    expect(JSON.parse(result.stdout)).toEqual({
      target: 'dev',
      instance: 'https://n8n.example.com',
      message: null,
      results: [
        { stableName: 'crm-import', path: 'workflows/crm-import.json', name: 'CRM import', id: 'crm1', url: 'https://n8n.example.com/workflow/crm1', action: 'refused', next: 'lift deploy' },
        { stableName: 'daily-report', path: 'workflows/daily-report.json', name: 'Daily report', id: 'rep1', url: 'https://n8n.example.com/workflow/rep1', action: 'published', next: null },
      ],
      summary: { published: 1, alreadyPublished: 0, refused: 1, differs: 0, failed: 0 },
      exitCode: 5,
    });
  });

  test('Should keep publishing the others and exit 5 when n8n refuses to publish one workflow', async () => {
    const other = fakeLocalWorkflow('other', { path: 'workflows/other.json' });
    const n8n = fakeN8n({
      workflows: [
        fakeN8nWorkflow(REPORT, { id: 'rep1', versionId: 'v2', activeVersionId: 'v1' }),
        fakeN8nWorkflow(other, { id: 'oth1', versionId: 'v2', activeVersionId: null }),
      ],
      failures: [httpError('POST /api/v1/workflows/oth1/activate', 400, 'Workflow has no node to start the workflow')],
    });
    const ctx = context(n8n, {
      loadWorkflowFiles: () => Promise.resolve([REPORT, other].map(fakeWorkflowFile)),
      ...fakeLockFile({ text: fakeLockText({ 'daily-report': 'rep1', other: 'oth1' }) }).context,
    });

    const result = await publishCommand.run(YES, ctx);

    expect(result.exitCode).toBe(5);
    expect(result.stdout).toContain(
      '✗ other         failed\n' +
        '  POST /api/v1/workflows/oth1/activate : HTTP 400: Workflow has no node to start the workflow\n' +
        '  → Fix the workflow in the n8n editor, then run lift publish other\n',
    );
    expect(n8n.workflows.find(({ id }) => id === 'rep1')).toMatchObject({ activeVersionId: 'v2' });
  });

  test('Should give a failed workflow no url in the JSON when n8n refuses to publish it', async () => {
    const n8n = fakeN8n({
      workflows: [fakeN8nWorkflow(REPORT, { id: 'rep1', versionId: 'v2', activeVersionId: 'v1' })],
      failures: [httpError('POST /api/v1/workflows/rep1/activate', 400, 'Workflow has no node to start the workflow')],
    });
    const ctx = context(n8n, { loadWorkflowFiles: () => Promise.resolve([fakeWorkflowFile(REPORT)]) });

    const result = await publishCommand.run({ positionals: [], values: { yes: true, json: true } }, ctx);

    expect(JSON.parse(result.stdout)).toMatchObject({ results: [{ stableName: 'daily-report', action: 'failed', url: null }] });
  });

  test('Should indent each line of a multi-line n8n message under the result, above the step, when n8n refuses to publish', async () => {
    const message = 'Cannot publish workflow: 1 node have configuration issues:\n\nNode "Webhook":\n  - Missing required credential: httpHeaderAuth';
    const n8n = fakeN8n({
      workflows: [fakeN8nWorkflow(REPORT, { id: 'rep1', versionId: 'v2', activeVersionId: 'v1' })],
      failures: [httpError('POST /api/v1/workflows/rep1/activate', 400, message)],
    });

    const result = await publishCommand.run(YES, context(n8n, { loadWorkflowFiles: () => Promise.resolve([fakeWorkflowFile(REPORT)]) }));

    expect(result.stdout).toContain(
      [
        '✗ daily-report  failed',
        '  POST /api/v1/workflows/rep1/activate : HTTP 400: Cannot publish workflow: 1 node have configuration issues:',
        '  Node "Webhook":',
        '    - Missing required credential: httpHeaderAuth',
        '  → Fix the workflow in the n8n editor, then run lift publish daily-report',
        '',
        '0 published, 1 failed.',
        '',
      ].join('\n'),
    );
  });
});

describe('publishCommand targets', () => {
  function twoTargets(dev: FakeN8n, prod: FakeN8n, overrides: Partial<CommandContext> = {}): CommandContext {
    const lock = {
      version: 1,
      instances: { [FAKE_DEV_URL]: { 'daily-report': { n8nId: 'rep1' } }, [FAKE_PROD_URL]: { 'daily-report': { n8nId: 'rep2' } } },
    };
    return context(dev, {
      loadProjectConfig: fakeTwoTargets(),
      fetch: fakeN8nByOrigin({ [FAKE_DEV_URL]: dev, [FAKE_PROD_URL]: prod }),
      loadWorkflowFiles: () => Promise.resolve([fakeWorkflowFile(REPORT)]),
      ...fakeLockFile({ text: `${JSON.stringify(lock, null, 2)}\n` }).context,
      ...overrides,
    });
  }

  test('Should ask once with one listing grouped by target, then publish on each target, when --all is given', async () => {
    const dev = fakeN8n({ workflows: [fakeN8nWorkflow(REPORT, { id: 'rep1', versionId: 'v2', activeVersionId: 'v1' })] });
    const prod = fakeN8n({ workflows: [fakeN8nWorkflow(REPORT, { id: 'rep2', versionId: 'v2', activeVersionId: 'v1' })] });
    const stdin = fakeAnswer('yes');

    const result = await publishCommand.run({ positionals: [], values: { all: true } }, twoTargets(dev, prod, { ask: stdin.ask }));

    expect(stdin.prompts).toEqual([
      [
        `lift publish · dev (${FAKE_DEV_URL})`,
        '',
        '^ daily-report  draft not yet published, will be published',
        '',
        `lift publish · prod (${FAKE_PROD_URL})`,
        '',
        '^ daily-report  draft not yet published, will be published',
        '',
        'Publish 2 workflows on 2 targets? [Y/n] ',
      ].join('\n'),
    ]);
    expect(result.exitCode).toBe(0);
    expect([published(dev), published(prod)]).toEqual([['POST /api/v1/workflows/rep1/activate'], ['POST /api/v1/workflows/rep2/activate']]);
  });

  test('Should publish nothing on any target when a name is unknown on one of them', async () => {
    const dev = fakeN8n({ workflows: [fakeN8nWorkflow(REPORT, { id: 'rep1', versionId: 'v2', activeVersionId: 'v1' })] });
    const prod = fakeN8n();

    const result = await publishCommand.run({ positionals: ['daily-report'], values: { all: true, yes: true } }, twoTargets(dev, prod));

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('Nothing published: another target has a problem.');
    expect(result.stderr).toContain('  → lift deploy --target prod');
    expect([published(dev), published(prod)]).toEqual([[], []]);
  });
});
