import { describe, expect, test } from 'vitest';
import { CommandContext, CommandInput } from '#src/cli/cli.model';
import { fakeContext } from '#src/cli/cli.fake';
import { deployCommand } from '#src/cli/commands/deploy/deploy.command';
import { fakeLocalWorkflow, fakeWorkflowFile } from '#src/core/compile/workflow.fake';
import { FakeN8n, fakeN8n, fakeN8nWorkflow, fakeStableTag, httpError } from '#src/core/n8n/n8n.fake';

const TEXT = { positionals: [], values: {} };
const JSON_INPUT = { positionals: [], values: { json: true } };
const DRY_RUN = { positionals: [], values: { 'dry-run': true } };
const DRY_RUN_JSON = { positionals: [], values: { 'dry-run': true, json: true } };
const ENV = { N8N_URL: 'https://n8n.example.com', N8N_API_KEY: 'secret' };

const INVOICE = fakeLocalWorkflow('invoice-sync', { path: 'workflows/invoice-sync.workflow.ts', name: 'Invoice sync' });
const CRM = fakeLocalWorkflow('crm-import', { path: 'workflows/crm/crm-import.json', name: 'CRM import' });
const REPORT = fakeLocalWorkflow('daily-report', { name: 'Daily report' });
const NEW = fakeLocalWorkflow('new', { name: 'New' });
const FILES = [INVOICE, CRM, REPORT].map(fakeWorkflowFile);
const HAND_ADDED = { id: 'h', name: 'hand-added' };

const KEY_HINT = 'Create a key in n8n → Settings → n8n API, then set N8N_API_KEY in .env';
const RETRY_HINT = 'Check the workflow file and the n8n instance (n8n 2.35.0 or later), then run deploy again';

function context(overrides: Partial<CommandContext>): CommandContext {
  return fakeContext({ registry: [deployCommand], env: ENV, ...overrides });
}

/** Deploying FILES here updates CRM (which also carries a hand-added tag), skips REPORT and creates INVOICE. */
function mixedInstance(): FakeN8n {
  return fakeN8n({
    workflows: [
      fakeN8nWorkflow(CRM, { id: 'crm1', name: 'CRM import (old)', tags: [fakeStableTag('crm-import'), HAND_ADDED] }),
      fakeN8nWorkflow(REPORT, { id: 'rep1' }),
    ],
  });
}

/** Deploying FILES here fails CRM's update with HTTP 500, and creates the other two. */
function failingUpdateInstance(): FakeN8n {
  return fakeN8n({
    workflows: [fakeN8nWorkflow(CRM, { id: 'crm1', name: 'CRM import (old)' })],
    failures: [httpError('PUT /api/v1/workflows/crm1', 500, 'boom')],
  });
}

/** Deploying FILES here stops on the first create: the instance rejects the API key with HTTP 401. */
function keyRejectedOnCreateInstance(): FakeN8n {
  return fakeN8n({ failures: [httpError('POST /api/v1/workflows', 401, 'boom')] });
}

/** An instance older than n8n 2.35.0: its API spec is not found. */
function noDraftsInstance(): FakeN8n {
  return fakeN8n({
    workflows: [fakeN8nWorkflow(CRM, { id: 'crm1', name: 'CRM import (old)' })],
    failures: [httpError('GET /api/v1/openapi.yml', 404)],
  });
}

describe('deployCommand', () => {
  test('Should print one line per workflow and the summary when it creates, updates and skips', async () => {
    const n8n = mixedInstance();
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve(FILES) });

    const result = await deployCommand.run(TEXT, ctx);

    expect(result).toEqual({
      exitCode: 0,
      stderr: '',
      stdout: `n8nlift deploy → https://n8n.example.com
~ updated       crm-import     workflows/crm/crm-import.json (draft; published version still running)
= skipped       daily-report   unchanged
+ created       invoice-sync   workflows/invoice-sync.workflow.ts
1 created, 1 updated, 0 restored, 1 skipped, 0 failed. Drafts are not live until you publish them.
`,
    });
  });

  test('Should update a changed workflow as a draft when the instance saves drafts', async () => {
    const n8n = mixedInstance();
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve(FILES) });

    await deployCommand.run(TEXT, ctx);

    expect(n8n.calls).toContain('GET /api/v1/openapi.yml');
    expect(n8n.requests).toContain('PUT https://n8n.example.com/api/v1/workflows/crm1?publishIfActive=false');
  });

  test('Should not update an unchanged workflow when its draft matches the file', async () => {
    const n8n = mixedInstance();
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve(FILES) });

    await deployCommand.run(TEXT, ctx);

    expect(n8n.calls).not.toContain('PUT /api/v1/workflows/rep1');
  });

  test('Should create a new workflow with its stable tag when no workflow carries the tag', async () => {
    const n8n = mixedInstance();
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve(FILES) });

    await deployCommand.run(TEXT, ctx);

    expect(n8n.workflows.find((workflow) => workflow.name === 'Invoice sync')?.tags.map((tag) => tag.name)).toEqual([
      'n8nlift:invoice-sync',
    ]);
  });

  test('Should keep a hand-added tag when it updates a workflow', async () => {
    const n8n = mixedInstance();
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve(FILES) });

    await deployCommand.run(TEXT, ctx);

    expect(n8n.workflows.find((workflow) => workflow.id === 'crm1')?.tags).toEqual([fakeStableTag('crm-import'), HAND_ADDED]);
    expect(n8n.calls).not.toContain('PUT /api/v1/workflows/crm1/tags');
  });

  test('Should make no write when it deploys the same files again', async () => {
    const n8n = fakeN8n();
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve(FILES) });
    await deployCommand.run(TEXT, ctx);
    n8n.calls.length = 0;

    const result = await deployCommand.run(TEXT, ctx);

    expect(result.stdout).toContain('0 created, 0 updated, 0 restored, 3 skipped, 0 failed.\n');
    expect(n8n.calls.every((call) => call.startsWith('GET '))).toBe(true);
  });

  test('Should print a stable JSON report when --json is set', async () => {
    const n8n = fakeN8n({ workflows: [fakeN8nWorkflow(REPORT, { id: 'rep1' })] });
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve([REPORT, NEW].map(fakeWorkflowFile)) });

    const result = await deployCommand.run(JSON_INPUT, ctx);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      instance: 'https://n8n.example.com',
      dryRun: false,
      results: [
        { stableName: 'daily-report', path: 'workflows/daily-report.json', action: 'skipped', id: 'rep1', name: 'Daily report' },
        { stableName: 'new', path: 'workflows/new.json', action: 'created', id: 'w1', name: 'New' },
      ],
      summary: { created: 1, updated: 0, restored: 0, skipped: 1, failed: 0, notProcessed: 0 },
      warnings: [],
      error: null,
      exitCode: 0,
    });
  });

  test('Should show the failure with its hint in place, deliver the others and exit 5 when one workflow fails', async () => {
    const n8n = failingUpdateInstance();
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve(FILES) });

    const result = await deployCommand.run(TEXT, ctx);

    expect(result.exitCode).toBe(5);
    expect(result.stdout).toBe(`n8nlift deploy → https://n8n.example.com
✗ failed        crm-import     PUT /api/v1/workflows/crm1 → HTTP 500: boom
                → ${RETRY_HINT}
+ created       daily-report   workflows/daily-report.json
+ created       invoice-sync   workflows/invoice-sync.workflow.ts
2 created, 0 updated, 0 restored, 0 skipped, 1 failed. Drafts are not live until you publish them.
`);
  });

  test('Should recap the failed workflow on stderr when one workflow fails', async () => {
    const n8n = failingUpdateInstance();
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve(FILES) });

    const result = await deployCommand.run(TEXT, ctx);

    expect(result.stderr).toBe(`Failed: crm-import.
Next: fix each failure with the hint under its line, then run deploy again.
`);
  });

  test('Should report the failed workflow and its error in JSON when one workflow fails', async () => {
    const n8n = failingUpdateInstance();
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve(FILES) });

    const result = await deployCommand.run(JSON_INPUT, ctx);

    expect(result.exitCode).toBe(5);
    expect(JSON.parse(result.stdout)).toMatchObject({
      results: [
        {
          stableName: 'crm-import',
          action: 'failed',
          id: 'crm1',
          error: { call: 'PUT /api/v1/workflows/crm1', detail: 'HTTP 500: boom', hint: RETRY_HINT },
        },
        { stableName: 'daily-report', action: 'created' },
        { stableName: 'invoice-sync', action: 'created' },
      ],
      summary: { failed: 1, created: 2 },
      error: null,
      exitCode: 5,
    });
  });

  test('Should list the workflows not processed and exit 4 when the key is rejected mid-run', async () => {
    const n8n = keyRejectedOnCreateInstance();
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve(FILES) });

    const result = await deployCommand.run(TEXT, ctx);

    expect(result.exitCode).toBe(4);
    expect(result.stdout).toBe(`n8nlift deploy → https://n8n.example.com
✗ failed        crm-import     POST /api/v1/workflows → HTTP 401: boom
                → ${KEY_HINT}
- not-processed daily-report   not processed
- not-processed invoice-sync   not processed
0 created, 0 updated, 0 restored, 0 skipped, 1 failed.
`);
  });

  test('Should recap the stop and the next step on stderr when the key is rejected mid-run', async () => {
    const n8n = keyRejectedOnCreateInstance();
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve(FILES) });

    const result = await deployCommand.run(TEXT, ctx);

    expect(result.stderr).toBe(`Failed: crm-import.
Stopped: POST /api/v1/workflows → HTTP 401: boom
Not processed: daily-report, invoice-sync.
Next: ${KEY_HINT}.
`);
  });

  test('Should report the stop in JSON when the key is rejected mid-run', async () => {
    const n8n = keyRejectedOnCreateInstance();
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve(FILES) });

    const result = await deployCommand.run(JSON_INPUT, ctx);

    expect(JSON.parse(result.stdout)).toMatchObject({
      summary: { failed: 1, notProcessed: 2 },
      error: { call: 'POST /api/v1/workflows', detail: 'HTTP 401: boom' },
      exitCode: 4,
    });
  });

  test('Should name n8n 2.35.0 and exit 6 when the instance cannot save drafts', async () => {
    const n8n = noDraftsInstance();
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve(FILES) });

    const result = await deployCommand.run(TEXT, ctx);

    expect(result).toEqual({
      exitCode: 6,
      stdout: 'n8nlift deploy → https://n8n.example.com\n',
      stderr: `✗ GET /api/v1/openapi.yml → HTTP 404: n8n 2.35.0 or later is required
  → Upgrade the instance to n8n 2.35.0 or later, then run deploy again
Nothing was written to n8n.
`,
    });
  });

  test('Should write nothing when the instance cannot save drafts', async () => {
    const n8n = noDraftsInstance();
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve(FILES) });

    await deployCommand.run(TEXT, ctx);

    expect(n8n.calls.every((call) => call.startsWith('GET '))).toBe(true);
  });

  test('Should report the blocker in JSON when the instance cannot save drafts', async () => {
    const n8n = noDraftsInstance();
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve(FILES) });

    const result = await deployCommand.run(JSON_INPUT, ctx);

    expect(JSON.parse(result.stdout)).toEqual({
      instance: 'https://n8n.example.com',
      dryRun: false,
      results: [],
      summary: { created: 0, updated: 0, restored: 0, skipped: 0, failed: 0, notProcessed: 0 },
      warnings: [],
      error: {
        call: 'GET /api/v1/openapi.yml',
        detail: 'HTTP 404: n8n 2.35.0 or later is required',
        hint: 'Upgrade the instance to n8n 2.35.0 or later, then run deploy again',
      },
      exitCode: 6,
    });
  });

  test('Should print the restore and its warning when only an archived workflow carries the stable tag', async () => {
    const n8n = fakeN8n({ workflows: [fakeN8nWorkflow(REPORT, { id: 'rep1', name: 'Daily report (old)', isArchived: true })] });
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve([fakeWorkflowFile(REPORT)]) });

    const result = await deployCommand.run(TEXT, ctx);

    expect(result).toEqual({
      exitCode: 0,
      stderr: '',
      stdout: `n8nlift deploy → https://n8n.example.com
! restored      daily-report   workflows/daily-report.json (unpublished draft)
⚠ daily-report: workflow rep1 was archived in n8n; it is back as an unpublished draft
0 created, 0 updated, 1 restored, 0 skipped, 0 failed. Drafts are not live until you publish them.
`,
    });
  });

  test('Should unarchive, then update as a draft when it restores a workflow', async () => {
    const n8n = fakeN8n({ workflows: [fakeN8nWorkflow(REPORT, { id: 'rep1', name: 'Daily report (old)', isArchived: true })] });
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve([fakeWorkflowFile(REPORT)]) });

    await deployCommand.run(TEXT, ctx);

    expect(n8n.requests).toContain('POST https://n8n.example.com/api/v1/workflows/rep1/unarchive');
    expect(n8n.requests).toContain('PUT https://n8n.example.com/api/v1/workflows/rep1?publishIfActive=false');
    expect(n8n.workflows[0]?.isArchived).toBe(false);
  });

  test('Should exit 4 with the key hint when the first call is rejected', async () => {
    const n8n = fakeN8n({ failures: [httpError('GET /api/v1/workflows', 401, 'boom')] });
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve(FILES) });

    const result = await deployCommand.run(TEXT, ctx);

    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain('✗ GET /api/v1/workflows → HTTP 401: boom');
    expect(result.stderr).toContain('→ Create a key in n8n → Settings → n8n API');
  });

  test('Should make no other call when the first call is rejected', async () => {
    const n8n = fakeN8n({ failures: [httpError('GET /api/v1/workflows', 401, 'boom')] });
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve(FILES) });

    await deployCommand.run(TEXT, ctx);

    expect(n8n.requests).toEqual(['GET https://n8n.example.com/api/v1/workflows?excludePinnedData=true&limit=250']);
  });

  test('Should say there is nothing to deploy and exit 0 when ./workflows is empty', async () => {
    const ctx = context({});

    const result = await deployCommand.run(TEXT, ctx);

    expect(result).toEqual({ exitCode: 0, stdout: 'Nothing to deploy: no workflow in ./workflows.\n', stderr: '' });
  });

  test('Should exit 1 and send nothing when a stable name is invalid or duplicated', async () => {
    const files = [
      fakeWorkflowFile(fakeLocalWorkflow('Bad_Name', { name: 'Bad' })),
      fakeWorkflowFile(fakeLocalWorkflow('sync', { path: 'workflows/a/sync.json', name: 'Sync' })),
      fakeWorkflowFile(fakeLocalWorkflow('sync', { path: 'workflows/sync.workflow.ts', name: 'Sync again' })),
    ];
    const ctx = context({ loadWorkflowFiles: () => Promise.resolve(files) });

    const result = await deployCommand.run(TEXT, ctx);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Invalid workflow files. Nothing was sent to n8n.');
    expect(result.stderr).toContain('✗ workflows/Bad_Name.json  stable name "Bad_Name"');
    expect(result.stderr).toContain(
      '✗ workflows/sync.workflow.ts  stable name "sync" is also used by workflows/a/sync.json',
    );
  });

  test('Should exit 1 with the same message as ping when the configuration is missing', async () => {
    const ctx = context({ env: {}, loadWorkflowFiles: () => Promise.resolve(FILES) });

    const result = await deployCommand.run(TEXT, ctx);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Missing N8N_URL and N8N_API_KEY.');
    expect(result.stderr).toContain('  N8N_URL=https://your-n8n.example.com\n');
  });

  test('Should show what deploy would do when --dry-run is set', async () => {
    const n8n = mixedInstance();
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve(FILES) });

    const result = await deployCommand.run(DRY_RUN, ctx);

    expect(result).toEqual({
      exitCode: 0,
      stderr: '',
      stdout: `n8nlift deploy --dry-run → https://n8n.example.com
~ would update  crm-import     workflows/crm/crm-import.json (draft; published version still running)
= would skip    daily-report   unchanged
+ would create  invoice-sync   workflows/invoice-sync.workflow.ts
Would: 1 create, 1 update, 0 restore, 1 skip, 0 fail.
Dry run: nothing was written. Run n8nlift deploy to apply.
n8n can still reject a write; this preview covers what reads can show.
`,
    });
  });

  test.each<[string, CommandInput]>([
    ['--dry-run', DRY_RUN],
    ['--dry-run --json', DRY_RUN_JSON],
  ])('Should write nothing when it runs with %s', async (_flags, input) => {
    const seed = [fakeN8nWorkflow(CRM, { id: 'crm1', name: 'CRM import (old)' }), fakeN8nWorkflow(REPORT, { id: 'rep1', isArchived: true })];
    const n8n = fakeN8n({ workflows: seed });
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve(FILES) });

    await deployCommand.run(input, ctx);

    expect(n8n.calls.every((call) => call.startsWith('GET '))).toBe(true);
    expect(n8n.workflows).toEqual(seed);
  });

  test('Should print the JSON report with dryRun true when --dry-run and --json are set', async () => {
    const n8n = fakeN8n({ workflows: [fakeN8nWorkflow(REPORT, { id: 'rep1', isArchived: true })] });
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve([REPORT, NEW].map(fakeWorkflowFile)) });

    const result = await deployCommand.run(DRY_RUN_JSON, ctx);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      instance: 'https://n8n.example.com',
      dryRun: true,
      results: [
        { stableName: 'daily-report', path: 'workflows/daily-report.json', action: 'restored', id: 'rep1', name: 'Daily report' },
        { stableName: 'new', path: 'workflows/new.json', action: 'created', id: null, name: 'New' },
      ],
      summary: { created: 1, updated: 0, restored: 1, skipped: 0, failed: 0, notProcessed: 0 },
      warnings: ['daily-report: workflow rep1 was archived in n8n; deploy would bring it back as an unpublished draft'],
      error: null,
      exitCode: 0,
    });
  });

  test('Should show the failure it would hit and exit 5 when --dry-run meets a duplicate stable tag', async () => {
    const n8n = fakeN8n({ workflows: [fakeN8nWorkflow(REPORT, { id: 'a' }), fakeN8nWorkflow(REPORT, { id: 'b' })] });
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve([fakeWorkflowFile(REPORT)]) });

    const result = await deployCommand.run(DRY_RUN, ctx);

    expect(result.exitCode).toBe(5);
    expect(result.stdout).toContain('✗ would fail    daily-report   GET /api/v1/workflows → workflows a and b both carry the tag n8nlift:daily-report\n');
    expect(result.stdout).toContain('Would: 0 create, 0 update, 0 restore, 0 skip, 1 fail.\n');
  });

  test('Should recap the workflow that would fail on stderr when --dry-run meets a duplicate stable tag', async () => {
    const n8n = fakeN8n({ workflows: [fakeN8nWorkflow(REPORT, { id: 'a' }), fakeN8nWorkflow(REPORT, { id: 'b' })] });
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve([fakeWorkflowFile(REPORT)]) });

    const result = await deployCommand.run(DRY_RUN, ctx);

    expect(result.stderr).toBe(`Would fail: daily-report.
Next: fix each failure with the hint under its line, then run deploy again.
`);
  });

  test('Should show the blocker and exit 6 when --dry-run meets an instance that cannot save drafts', async () => {
    const n8n = noDraftsInstance();
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve(FILES) });

    const result = await deployCommand.run(DRY_RUN, ctx);

    expect(result.exitCode).toBe(6);
    expect(result.stdout).toBe('n8nlift deploy --dry-run → https://n8n.example.com\n');
    expect(result.stderr).toContain('✗ GET /api/v1/openapi.yml → HTTP 404: n8n 2.35.0 or later is required');
    expect(result.stderr).toContain('Nothing was written to n8n.');
  });

  test('Should say there is nothing to deploy when --dry-run finds ./workflows empty', async () => {
    const ctx = context({});

    const result = await deployCommand.run(DRY_RUN, ctx);

    expect(result).toEqual({ exitCode: 0, stdout: 'Nothing to deploy: no workflow in ./workflows.\n', stderr: '' });
  });

  test('Should print an empty JSON report with dryRun true when --dry-run --json finds ./workflows empty', async () => {
    const ctx = context({});

    const result = await deployCommand.run(DRY_RUN_JSON, ctx);

    expect(JSON.parse(result.stdout)).toMatchObject({ dryRun: true, results: [], exitCode: 0 });
  });

  test('Should list --dry-run in the usage and options when the help is generated from them', () => {
    const { usage, options } = deployCommand;

    const dryRun = options['dry-run'];

    expect(usage).toContain('n8nlift deploy [--dry-run] [--json]');
    expect(usage).toContain('It exits with the same codes as a real deploy.');
    expect(dryRun).toEqual({ type: 'boolean', description: 'Show what deploy would do; write nothing' });
  });
});
