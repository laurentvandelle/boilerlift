import { describe, expect, test } from 'vitest';
import { CommandContext, CommandInput } from '#src/cli/cli.model';
import { FakeLockFile, fakeContext, fakeLockFile } from '#src/cli/cli.fake';
import { deployCommand } from '#src/cli/commands/deploy/deploy.command';
import { fakeLocalWorkflow, fakeWorkflowFile } from '#src/core/compile/workflow.fake';
import { fakeLockText } from '#src/core/deliver/lock-file.fake';
import { FakeN8n, fakeN8n, fakeN8nWorkflow, httpError, invalidResponse } from '#src/core/n8n/n8n.fake';

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

/** A deploy context on ENV's instance, with `lock` as the lock file: an empty one unless the test seeds it. */
function context(overrides: Partial<CommandContext>, lock: FakeLockFile = fakeLockFile()): CommandContext {
  return fakeContext({ registry: [deployCommand], env: ENV, ...lock.context, ...overrides });
}

/** A lock file that records `entries` (stable name → n8n id) for ENV's instance. */
function recorded(entries: Record<string, string>): FakeLockFile {
  return fakeLockFile({ text: fakeLockText(entries) });
}

/** The lock file of mixedInstance: it records CRM and REPORT. */
function mixedLock(): FakeLockFile {
  return recorded({ 'crm-import': 'crm1', 'daily-report': 'rep1' });
}

/** Deploying FILES here, with mixedLock, updates CRM (which also carries a hand-added tag), skips REPORT and creates INVOICE. */
function mixedInstance(): FakeN8n {
  return fakeN8n({
    workflows: [
      fakeN8nWorkflow(CRM, { id: 'crm1', name: 'CRM import (old)', tags: [HAND_ADDED] }),
      fakeN8nWorkflow(REPORT, { id: 'rep1' }),
    ],
  });
}

/** Deploying FILES here, with the lock file recording CRM only, fails CRM's update with HTTP 500, and creates the other two. */
function failingUpdateInstance(): FakeN8n {
  return fakeN8n({
    workflows: [fakeN8nWorkflow(CRM, { id: 'crm1', name: 'CRM import (old)' })],
    failures: [httpError('PUT /api/v1/workflows/crm1', 500, 'boom')],
  });
}

function crmLock(): FakeLockFile {
  return recorded({ 'crm-import': 'crm1' });
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
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve(FILES) }, mixedLock());

    const result = await deployCommand.run(TEXT, ctx);

    expect(result).toEqual({
      exitCode: 0,
      stderr: '',
      stdout: `lift deploy → https://n8n.example.com
~ updated        crm-import     workflows/crm/crm-import.json (draft; published version still running)
= skipped        daily-report   unchanged
+ created        invoice-sync   workflows/invoice-sync.workflow.ts
1 created, 1 updated, 0 restored, 1 skipped, 0 failed. Drafts are not live until you publish them.
boilerlift.lock.json updated — commit it
`,
    });
  });

  test('Should update a changed workflow as a draft when the instance saves drafts', async () => {
    const n8n = mixedInstance();
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve(FILES) }, mixedLock());

    await deployCommand.run(TEXT, ctx);

    expect(n8n.calls).toContain('GET /api/v1/openapi.yml');
    expect(n8n.requests).toContain('PUT https://n8n.example.com/api/v1/workflows/crm1?publishIfActive=false');
  });

  test('Should not update an unchanged workflow when its draft matches the file', async () => {
    const n8n = mixedInstance();
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve(FILES) }, mixedLock());

    await deployCommand.run(TEXT, ctx);

    expect(n8n.calls).not.toContain('PUT /api/v1/workflows/rep1');
  });

  test('Should keep a hand-added tag when it updates a workflow', async () => {
    const n8n = mixedInstance();
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve(FILES) }, mixedLock());

    await deployCommand.run(TEXT, ctx);

    expect(n8n.workflows.find((workflow) => workflow.id === 'crm1')?.tags).toEqual([HAND_ADDED]);
    expect(n8n.calls).not.toContain('PUT /api/v1/workflows/crm1/tags');
  });

  test('Should make no write when it deploys the same files again', async () => {
    const n8n = fakeN8n();
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve(FILES) }, fakeLockFile());
    await deployCommand.run(TEXT, ctx);
    n8n.calls.length = 0;

    const result = await deployCommand.run(TEXT, ctx);

    expect(result.stdout).toContain('0 created, 0 updated, 0 restored, 3 skipped, 0 failed.\n');
    expect(n8n.calls.every((call) => call.startsWith('GET '))).toBe(true);
  });

  test('Should print a stable JSON report when --json is set', async () => {
    const n8n = fakeN8n({ workflows: [fakeN8nWorkflow(REPORT, { id: 'rep1' })] });
    const ctx = context(
      { fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve([REPORT, NEW].map(fakeWorkflowFile)) },
      recorded({ 'daily-report': 'rep1' }),
    );

    const result = await deployCommand.run(JSON_INPUT, ctx);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      instance: 'https://n8n.example.com',
      dryRun: false,
      results: [
        { stableName: 'daily-report', path: 'workflows/daily-report.json', action: 'skipped', id: 'rep1', name: 'Daily report' },
        { stableName: 'new', path: 'workflows/new.json', action: 'created', id: 'w1', name: 'New' },
      ],
      summary: { created: 1, recreated: 0, updated: 0, restored: 0, skipped: 1, failed: 0, notProcessed: 0 },
      warnings: [],
      lockFile: { path: 'boilerlift.lock.json', changed: true },
      error: null,
      exitCode: 0,
    });
  });

  test('Should show the failure with its hint in place, deliver the others and exit 5 when one workflow fails', async () => {
    const n8n = failingUpdateInstance();
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve(FILES) }, crmLock());

    const result = await deployCommand.run(TEXT, ctx);

    expect(result.exitCode).toBe(5);
    expect(result.stdout).toBe(`lift deploy → https://n8n.example.com
✗ failed         crm-import     PUT /api/v1/workflows/crm1 → HTTP 500: boom
                 → ${RETRY_HINT}
+ created        daily-report   workflows/daily-report.json
+ created        invoice-sync   workflows/invoice-sync.workflow.ts
2 created, 0 updated, 0 restored, 0 skipped, 1 failed. Drafts are not live until you publish them.
boilerlift.lock.json updated — commit it
`);
  });

  test('Should recap the failed workflow on stderr when one workflow fails', async () => {
    const n8n = failingUpdateInstance();
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve(FILES) }, crmLock());

    const result = await deployCommand.run(TEXT, ctx);

    expect(result.stderr).toBe(`Failed: crm-import.
Next: fix each failure with the hint under its line, then run deploy again.
`);
  });

  test('Should report the failed workflow and its error in JSON when one workflow fails', async () => {
    const n8n = failingUpdateInstance();
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve(FILES) }, crmLock());

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
    expect(result.stdout).toBe(`lift deploy → https://n8n.example.com
✗ failed         crm-import     POST /api/v1/workflows → HTTP 401: boom
                 → ${KEY_HINT}
- not-processed  daily-report   not processed
- not-processed  invoice-sync   not processed
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
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve(FILES) }, crmLock());

    const result = await deployCommand.run(TEXT, ctx);

    expect(result).toEqual({
      exitCode: 6,
      stdout: 'lift deploy → https://n8n.example.com\n',
      stderr: `✗ GET /api/v1/openapi.yml → HTTP 404: n8n 2.35.0 or later is required
  → Upgrade the instance to n8n 2.35.0 or later, then run deploy again
Nothing was written to n8n.
`,
    });
  });

  test('Should write nothing when the instance cannot save drafts', async () => {
    const n8n = noDraftsInstance();
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve(FILES) }, crmLock());

    await deployCommand.run(TEXT, ctx);

    expect(n8n.calls.every((call) => call.startsWith('GET '))).toBe(true);
  });

  test('Should report the blocker in JSON when the instance cannot save drafts', async () => {
    const n8n = noDraftsInstance();
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve(FILES) }, crmLock());

    const result = await deployCommand.run(JSON_INPUT, ctx);

    expect(JSON.parse(result.stdout)).toEqual({
      instance: 'https://n8n.example.com',
      dryRun: false,
      results: [],
      summary: { created: 0, recreated: 0, updated: 0, restored: 0, skipped: 0, failed: 0, notProcessed: 0 },
      warnings: [],
      lockFile: { path: 'boilerlift.lock.json', changed: false },
      error: {
        call: 'GET /api/v1/openapi.yml',
        detail: 'HTTP 404: n8n 2.35.0 or later is required',
        hint: 'Upgrade the instance to n8n 2.35.0 or later, then run deploy again',
      },
      exitCode: 6,
    });
  });

  test('Should print the restore and its warning when the recorded workflow is archived', async () => {
    const n8n = fakeN8n({ workflows: [fakeN8nWorkflow(REPORT, { id: 'rep1', name: 'Daily report (old)', isArchived: true })] });
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve([fakeWorkflowFile(REPORT)]) }, recorded({ 'daily-report': 'rep1' }));

    const result = await deployCommand.run(TEXT, ctx);

    expect(result).toEqual({
      exitCode: 0,
      stderr: '',
      stdout: `lift deploy → https://n8n.example.com
! restored       daily-report   workflows/daily-report.json (unpublished draft)
⚠ daily-report: workflow rep1 was archived in n8n; it is back as an unpublished draft
0 created, 0 updated, 1 restored, 0 skipped, 0 failed. Drafts are not live until you publish them.
`,
    });
  });

  test('Should unarchive, then update as a draft when it restores a workflow', async () => {
    const n8n = fakeN8n({ workflows: [fakeN8nWorkflow(REPORT, { id: 'rep1', name: 'Daily report (old)', isArchived: true })] });
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve([fakeWorkflowFile(REPORT)]) }, recorded({ 'daily-report': 'rep1' }));

    await deployCommand.run(TEXT, ctx);

    expect(n8n.requests).toContain('POST https://n8n.example.com/api/v1/workflows/rep1/unarchive');
    expect(n8n.requests).toContain('PUT https://n8n.example.com/api/v1/workflows/rep1?publishIfActive=false');
    expect(n8n.workflows[0]?.isArchived).toBe(false);
  });

  test('Should exit 4 with the key hint when the first keyed call is rejected', async () => {
    const n8n = fakeN8n({ workflows: [fakeN8nWorkflow(CRM, { id: 'crm1' })], failures: [httpError('GET /api/v1/workflows/crm1', 401, 'boom')] });
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve(FILES) }, crmLock());

    const result = await deployCommand.run(TEXT, ctx);

    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain('Stopped: GET /api/v1/workflows/crm1 → HTTP 401: boom');
    expect(result.stderr).toContain('Next: Create a key in n8n → Settings → n8n API');
  });

  test('Should make no other call when the first keyed call is rejected', async () => {
    const n8n = fakeN8n({ workflows: [fakeN8nWorkflow(CRM, { id: 'crm1' })], failures: [httpError('GET /api/v1/workflows/crm1', 401, 'boom')] });
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve(FILES) }, crmLock());

    await deployCommand.run(TEXT, ctx);

    expect(n8n.requests).toEqual(['GET https://n8n.example.com/api/v1/openapi.yml', 'GET https://n8n.example.com/api/v1/workflows/crm1']);
  });

  test('Should say there is nothing to deploy and exit 0 when ./workflows is empty', async () => {
    const ctx = context({});

    const result = await deployCommand.run(TEXT, ctx);

    expect(result).toEqual({ exitCode: 0, stdout: 'Nothing to deploy: no workflow in ./workflows.\n', stderr: '' });
  });

  test('Should exit 1 and send nothing when a stable name is invalid or duplicated', async () => {
    const files = [
      fakeWorkflowFile(fakeLocalWorkflow('bad', { path: 'workflows/Bad_Name.json', name: 'Bad' })),
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
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve(FILES) }, mixedLock());

    const result = await deployCommand.run(DRY_RUN, ctx);

    expect(result).toEqual({
      exitCode: 0,
      stderr: '',
      stdout: `lift deploy --dry-run → https://n8n.example.com
~ would update   crm-import     workflows/crm/crm-import.json (draft; published version still running)
= would skip     daily-report   unchanged
+ would create   invoice-sync   workflows/invoice-sync.workflow.ts
Would: 1 create, 1 update, 0 restore, 1 skip, 0 fail.
Dry run: nothing was written. Run lift deploy to apply.
n8n can still reject a write; this preview covers what reads can show.
boilerlift.lock.json would update — commit it after lift deploy
`,
    });
  });

  test.each<[string, CommandInput]>([
    ['--dry-run', DRY_RUN],
    ['--dry-run --json', DRY_RUN_JSON],
  ])('Should write nothing when it runs with %s', async (_flags, input) => {
    const seed = [fakeN8nWorkflow(CRM, { id: 'crm1', name: 'CRM import (old)' }), fakeN8nWorkflow(REPORT, { id: 'rep1', isArchived: true })];
    const n8n = fakeN8n({ workflows: seed });
    const lock = recorded({ 'crm-import': 'crm1', 'daily-report': 'rep1', 'invoice-sync': 'gone' });
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve(FILES) }, lock);

    await deployCommand.run(input, ctx);

    expect({ readOnly: n8n.calls.every((call) => call.startsWith('GET ')), workflows: n8n.workflows, lockWrites: lock.writes }).toEqual({
      readOnly: true,
      workflows: seed,
      lockWrites: [],
    });
  });

  test('Should print the JSON report with dryRun true when --dry-run and --json are set', async () => {
    const n8n = fakeN8n({ workflows: [fakeN8nWorkflow(REPORT, { id: 'rep1', isArchived: true })] });
    const ctx = context(
      { fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve([REPORT, NEW].map(fakeWorkflowFile)) },
      recorded({ 'daily-report': 'rep1' }),
    );

    const result = await deployCommand.run(DRY_RUN_JSON, ctx);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      instance: 'https://n8n.example.com',
      dryRun: true,
      results: [
        { stableName: 'daily-report', path: 'workflows/daily-report.json', action: 'restored', id: 'rep1', name: 'Daily report' },
        { stableName: 'new', path: 'workflows/new.json', action: 'created', id: null, name: 'New' },
      ],
      summary: { created: 1, recreated: 0, updated: 0, restored: 1, skipped: 0, failed: 0, notProcessed: 0 },
      warnings: ['daily-report: workflow rep1 was archived in n8n; deploy would bring it back as an unpublished draft'],
      lockFile: { path: 'boilerlift.lock.json', changed: true },
      error: null,
      exitCode: 0,
    });
  });

  test('Should show the blocker and exit 6 when --dry-run meets an instance that cannot save drafts', async () => {
    const n8n = noDraftsInstance();
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve(FILES) }, crmLock());

    const result = await deployCommand.run(DRY_RUN, ctx);

    expect(result.exitCode).toBe(6);
    expect(result.stdout).toBe('lift deploy --dry-run → https://n8n.example.com\n');
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

    expect(usage).toContain('lift deploy [--dry-run] [--json]');
    expect(usage).toContain('It exits with the same codes as a real deploy.');
    expect(dryRun).toEqual({ type: 'boolean', description: 'Show what deploy would do; write nothing' });
  });

  test('Should exit 1 and send nothing when N8N_URL uses another scheme than http or https', async () => {
    const ctx = context({ env: { N8N_URL: 'ftp://n8n.example.com', N8N_API_KEY: 'secret' }, loadWorkflowFiles: () => Promise.resolve(FILES) });

    const result = await deployCommand.run(TEXT, ctx);

    expect(result).toEqual({
      exitCode: 1,
      stdout: '',
      stderr:
        'Invalid N8N_URL "ftp://n8n.example.com" (from env): it must be an http:// or https:// URL.\n' +
        'Fix it in your environment, for example:\n' +
        '  N8N_URL=https://your-n8n.example.com\n',
    });
  });

  test('Should stop with exit 3 and name the unexpected answer when the instance answers a page that is not the n8n API', async () => {
    const n8n = fakeN8n({ workflows: [fakeN8nWorkflow(CRM, { id: 'crm1' })], failures: [invalidResponse('GET /api/v1/workflows/crm1')] });
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve(FILES) }, crmLock());

    const result = await deployCommand.run(TEXT, ctx);

    expect(result.exitCode).toBe(3);
    expect(result.stderr).toBe(
      'Failed: crm-import.\n' +
        'Stopped: GET /api/v1/workflows/crm1 → unexpected answer (HTTP 200): the body is not JSON\n' +
        'Not processed: daily-report, invoice-sync.\n' +
        'Next: Check that N8N_URL points to an n8n instance (n8n 2.35.0 or later), then run deploy again.\n',
    );
  });
  test('Should update a recorded workflow by its id when it was renamed in n8n', async () => {
    const n8n = fakeN8n({ workflows: [fakeN8nWorkflow(CRM, { id: 'crm1', name: 'Renamed in n8n' })] });
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve([fakeWorkflowFile(CRM)]) }, crmLock());

    const result = await deployCommand.run(TEXT, ctx);

    expect(result.stdout).toContain('~ updated        crm-import   workflows/crm/crm-import.json (draft; published version still running)\n');
    expect(n8n.workflows).toEqual([expect.objectContaining({ id: 'crm1', name: 'CRM import' })]);
  });

  test('Should never call or change a workflow on the instance when the lock file does not record it', async () => {
    const unmanaged = fakeN8nWorkflow(CRM, { id: 'other', name: 'CRM import' });
    const n8n = fakeN8n({ workflows: [unmanaged] });
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve([fakeWorkflowFile(CRM)]) });

    await deployCommand.run(TEXT, ctx);

    expect({ requests: n8n.requests.filter((request) => request.includes('/other')), workflow: n8n.workflows[0] }).toEqual({
      requests: [],
      workflow: unmanaged,
    });
  });

  test('Should record a new workflow under the instance URL when it creates it', async () => {
    const n8n = mixedInstance();
    const lock = mixedLock();
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve(FILES) }, lock);

    await deployCommand.run(TEXT, ctx);

    expect(lock.text()).toBe(fakeLockText({ 'crm-import': 'crm1', 'daily-report': 'rep1', 'invoice-sync': 'w1' }));
  });

  test('Should tell the user to commit the lock file when deploy created a workflow', async () => {
    const n8n = fakeN8n();
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve([fakeWorkflowFile(NEW)]) });

    const result = await deployCommand.run(TEXT, ctx);

    expect(result.stdout).toMatch(/failed\. Drafts are not live until you publish them\.\nboilerlift\.lock\.json updated — commit it\n$/);
  });

  test('Should not write the lock file when only recorded workflows changed', async () => {
    const n8n = fakeN8n({ workflows: [fakeN8nWorkflow(CRM, { id: 'crm1', name: 'CRM import (old)' })] });
    const lock = crmLock();
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve([fakeWorkflowFile(CRM)]) }, lock);

    const result = await deployCommand.run(JSON_INPUT, ctx);

    expect(lock.writes).toEqual([]);
    expect(JSON.parse(result.stdout)).toMatchObject({ lockFile: { path: 'boilerlift.lock.json', changed: false } });
  });

  test('Should not mention the lock file in the text report when it did not change', async () => {
    const n8n = fakeN8n({ workflows: [fakeN8nWorkflow(CRM, { id: 'crm1', name: 'CRM import (old)' })] });
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve([fakeWorkflowFile(CRM)]) }, crmLock());

    const result = await deployCommand.run(TEXT, ctx);

    expect(result.stdout).not.toContain('boilerlift.lock.json');
  });

  test('Should recreate the workflow and record its new id when the recorded id answers 404', async () => {
    const n8n = fakeN8n();
    const lock = recorded({ 'crm-import': 'gone' });
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve([fakeWorkflowFile(CRM)]) }, lock);

    const result = await deployCommand.run(TEXT, ctx);

    expect({ stdout: result.stdout, lock: lock.text() }).toEqual({
      stdout: `lift deploy → https://n8n.example.com
* recreated      crm-import   workflows/crm/crm-import.json (n8n no longer has the recorded workflow gone)
0 created, 1 recreated, 0 updated, 0 restored, 0 skipped, 0 failed. Drafts are not live until you publish them.
boilerlift.lock.json updated — commit it
`,
      lock: fakeLockText({ 'crm-import': 'w1' }),
    });
  });

  test('Should report the recreated workflow with its previous and new ids when --json is set', async () => {
    const n8n = fakeN8n();
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve([fakeWorkflowFile(CRM)]) }, recorded({ 'crm-import': 'gone' }));

    const result = await deployCommand.run(JSON_INPUT, ctx);

    expect(JSON.parse(result.stdout)).toMatchObject({
      results: [{ stableName: 'crm-import', action: 'recreated', id: 'w1', previousId: 'gone' }],
      summary: { created: 0, recreated: 1 },
      lockFile: { path: 'boilerlift.lock.json', changed: true },
    });
  });

  test('Should show what it would recreate and that the lock file would change when --dry-run meets a recorded id that answers 404', async () => {
    const n8n = fakeN8n();
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve([fakeWorkflowFile(CRM)]) }, recorded({ 'crm-import': 'gone' }));

    const result = await deployCommand.run(DRY_RUN, ctx);

    expect(result.stdout).toBe(`lift deploy --dry-run → https://n8n.example.com
* would recreate crm-import   workflows/crm/crm-import.json (n8n no longer has the recorded workflow gone)
Would: 0 create, 1 recreate, 0 update, 0 restore, 0 skip, 0 fail.
Dry run: nothing was written. Run lift deploy to apply.
n8n can still reject a write; this preview covers what reads can show.
boilerlift.lock.json would update — commit it after lift deploy
`);
  });

  test('Should call no tag endpoint when it deploys to an instance with no tag', async () => {
    const n8n = fakeN8n({ workflows: [fakeN8nWorkflow(CRM, { id: 'crm1', name: 'CRM import (old)' }), fakeN8nWorkflow(REPORT, { id: 'rep1' })] });
    const lock = recorded({ 'crm-import': 'crm1', 'daily-report': 'rep1', 'invoice-sync': 'gone' });
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve([...FILES, fakeWorkflowFile(NEW)]) }, lock);

    const result = await deployCommand.run(TEXT, ctx);

    expect({ exitCode: result.exitCode, tagRequests: n8n.requests.filter((request) => request.includes('/tags')) }).toEqual({
      exitCode: 0,
      tagRequests: [],
    });
  });

  test('Should leave the lock file untouched when it restores an archived workflow', async () => {
    const n8n = fakeN8n({ workflows: [fakeN8nWorkflow(REPORT, { id: 'rep1', name: 'Daily report (old)', isArchived: true })] });
    const lock = recorded({ 'daily-report': 'rep1' });
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve([fakeWorkflowFile(REPORT)]) }, lock);

    await deployCommand.run(TEXT, ctx);

    expect(lock.writes).toEqual([]);
  });

  test('Should stop with exit 7 and name the created id when the lock file cannot be written', async () => {
    const n8n = fakeN8n();
    const lock = fakeLockFile({ writeFailure: 'EACCES: permission denied' });
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve(FILES) }, lock);

    const result = await deployCommand.run(TEXT, ctx);

    expect(result).toEqual({
      exitCode: 7,
      stdout: `lift deploy → https://n8n.example.com
✗ failed         crm-import     write boilerlift.lock.json → workflow w1 was created for crm-import, but boilerlift.lock.json could not be written: EACCES: permission denied
                 → Add "crm-import": { "n8nId": "w1" } under "https://n8n.example.com" in boilerlift.lock.json by hand and commit it, then run deploy again
- not-processed  daily-report   not processed
- not-processed  invoice-sync   not processed
0 created, 0 updated, 0 restored, 0 skipped, 1 failed.
`,
      stderr: `Failed: crm-import.
Stopped: write boilerlift.lock.json → workflow w1 was created for crm-import, but boilerlift.lock.json could not be written: EACCES: permission denied
Not processed: daily-report, invoice-sync.
Next: Add "crm-import": { "n8nId": "w1" } under "https://n8n.example.com" in boilerlift.lock.json by hand and commit it, then run deploy again.
`,
    });
  });

  test('Should not process the remaining workflows when the lock file cannot be written after a create', async () => {
    const n8n = fakeN8n();
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve(FILES) }, fakeLockFile({ writeFailure: 'EACCES: permission denied' }));

    await deployCommand.run(TEXT, ctx);

    expect(n8n.workflows.map((workflow) => workflow.name)).toEqual(['CRM import']);
  });

  test('Should exit 1 and send nothing when the lock file is invalid', async () => {
    const ctx = context({ loadWorkflowFiles: () => Promise.resolve(FILES) }, fakeLockFile({ text: '{ "version": 2, "instances": {} }' }));

    const result = await deployCommand.run(TEXT, ctx);

    expect(result).toEqual({
      exitCode: 1,
      stdout: '',
      stderr: `Invalid boilerlift.lock.json. Nothing was sent to n8n.
✗ boilerlift.lock.json  "version" must be 1, found 2
  → Fix the file, or restore it from version control, then run deploy again.
`,
    });
  });

  test('Should explain the lock file, the recreate rule, the 64-character names and exit code 7 when the help is generated from the usage', () => {
    const { usage } = deployCommand;

    const lines = [
      'Commit the file after each deploy that changes it',
      'is created again from code, and the new id recorded.',
      '1 to 64 of a-z, 0-9 and -.',
      '7  A workflow was created but boilerlift.lock.json could not be written',
    ];

    expect(lines.filter((line) => !usage.includes(line))).toEqual([]);
    expect(usage).not.toContain('boilerlift:');
  });
});
