import { describe, expect, test } from 'vitest';
import { CommandContext, CommandInput } from '#src/cli/cli.model';
import {
  FAKE_DEV_URL as DEV_URL,
  FAKE_PROD_URL as PROD_URL,
  FakeLockFile,
  fakeContext,
  fakeCredentialsFolder,
  fakeLockFile,
  fakeProjectConfig,
  fakeSingleTarget,
  fakeTwoTargets,
} from '#src/cli/cli.fake';
import { deployCommand } from '#src/cli/commands/deploy/deploy.command';
import { fakeCredentialEntry, fakeWorkflowFileUsing } from '#src/core/compile/credential.fake';
import { fakeLocalWorkflow, fakeWorkflowFile } from '#src/core/compile/workflow.fake';
import { fakeLockText } from '#src/core/lock/lock-file.fake';
import { FakeN8n, fakeCredential, fakeN8n, fakeN8nByOrigin, fakeN8nWorkflow, httpError, invalidResponse, unreachable } from '#src/core/n8n/n8n.fake';

const TEXT = { positionals: [], values: {} };
const JSON_INPUT = { positionals: [], values: { json: true } };
const DRY_RUN = { positionals: [], values: { 'dry-run': true } };
const DRY_RUN_JSON = { positionals: [], values: { 'dry-run': true, json: true } };

const INVOICE = fakeLocalWorkflow('invoice-sync', { path: 'workflows/invoice-sync.workflow.ts', name: 'Invoice sync' });
const CRM = fakeLocalWorkflow('crm-import', { path: 'workflows/crm/crm-import.json', name: 'CRM import' });
const REPORT = fakeLocalWorkflow('daily-report', { name: 'Daily report' });
const NEW = fakeLocalWorkflow('new', { name: 'New' });
const FILES = [INVOICE, CRM, REPORT].map(fakeWorkflowFile);
const HAND_ADDED = { id: 'h', name: 'hand-added' };

const KEY_HINT = 'Create a key in n8n → Settings → n8n API, then set it as the apiKey of the target in boilerlift.config.ts, through the environment variable it reads';
const RETRY_HINT = 'Check the workflow file and the n8n instance (n8n 2.35.0 or later), then run deploy again';

/** A deploy context on the single target `dev`, with `lock` as the lock file: an empty one unless the test seeds it. */
function context(overrides: Partial<CommandContext>, lock: FakeLockFile = fakeLockFile()): CommandContext {
  return fakeContext({ registry: [deployCommand], loadProjectConfig: fakeSingleTarget(), ...lock.context, ...overrides });
}

/** The single target `dev` of fakeSingleTarget, with `tag: false`. */
function untaggedTarget(): CommandContext['loadProjectConfig'] {
  return fakeProjectConfig({ targets: { dev: { url: 'https://n8n.example.com', apiKey: 'secret', workflows: './workflows', tag: false } } });
}

/** A lock file that records `entries` (stable name → n8n id) for the instance of the single target. */
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
      stdout: `lift deploy · dev (https://n8n.example.com)

~ crm-import    updated  https://n8n.example.com/workflow/crm1 (draft; published version still running)
= daily-report  skipped  unchanged  https://n8n.example.com/workflow/rep1
+ invoice-sync  created  https://n8n.example.com/workflow/w1

1 created, 1 updated, 0 restored, 1 skipped, 0 failed.
Tag boilerlift:dev added to 3 workflows

→ lift publish  publishes the drafts
→ commit boilerlift.lock.json  it was updated
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

  test('Should keep a hand-added tag when it adds the target tag to an updated workflow', async () => {
    const n8n = mixedInstance();
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve(FILES) }, mixedLock());

    await deployCommand.run(TEXT, ctx);

    expect(n8n.workflows.find((workflow) => workflow.id === 'crm1')?.tags).toEqual([HAND_ADDED, { id: 't2', name: 'boilerlift:dev' }]);
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

  test('Should name the target in the publish command when -t picks the target', async () => {
    const n8n = fakeN8n();
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve([NEW].map(fakeWorkflowFile)) });

    const result = await deployCommand.run({ positionals: [], values: { target: 'dev', json: true } }, ctx);

    expect(JSON.parse(result.stdout)).toMatchObject({ next: 'lift publish --target dev', exitCode: 0 });
  });

  test('Should give no publish command in the JSON when nothing was delivered as a draft', async () => {
    const n8n = fakeN8n({ workflows: [fakeN8nWorkflow(REPORT, { id: 'rep1' })] });
    const ctx = context(
      { fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve([REPORT].map(fakeWorkflowFile)) },
      recorded({ 'daily-report': 'rep1' }),
    );

    const result = await deployCommand.run(JSON_INPUT, ctx);

    expect(JSON.parse(result.stdout)).toMatchObject({ next: null, exitCode: 0 });
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
      target: 'dev',
      instance: 'https://n8n.example.com',
      dryRun: false,
      results: [
        { stableName: 'daily-report', path: 'workflows/daily-report.json', action: 'skipped', id: 'rep1', name: 'Daily report', url: 'https://n8n.example.com/workflow/rep1' },
        { stableName: 'new', path: 'workflows/new.json', action: 'created', id: 'w1', name: 'New', url: 'https://n8n.example.com/workflow/w1' },
      ],
      summary: { created: 1, recreated: 0, updated: 0, restored: 0, skipped: 1, failed: 0, notProcessed: 0 },
      warnings: [],
      lockFile: { path: 'boilerlift.lock.json', changed: true },
      tag: { name: 'boilerlift:dev', added: 2 },
      error: null,
      next: 'lift publish',
      exitCode: 0,
    });
  });

  test('Should show the failure with its hint in place, deliver the others and exit 5 when one workflow fails', async () => {
    const n8n = failingUpdateInstance();
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve(FILES) }, crmLock());

    const result = await deployCommand.run(TEXT, ctx);

    expect(result.exitCode).toBe(5);
    expect(result.stdout).toBe(`lift deploy · dev (https://n8n.example.com)

✗ crm-import    failed
  PUT /api/v1/workflows/crm1 : HTTP 500: boom
  → ${RETRY_HINT}
+ daily-report  created  https://n8n.example.com/workflow/w1
+ invoice-sync  created  https://n8n.example.com/workflow/w2

2 created, 0 updated, 0 restored, 0 skipped, 1 failed.
Tag boilerlift:dev added to 2 workflows

→ lift publish  publishes the drafts
→ commit boilerlift.lock.json  it was updated
`);
  });

  test('Should colour the failure red, the new workflows green and the next steps cyan when colour is on', async () => {
    const n8n = failingUpdateInstance();
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve(FILES), color: true }, crmLock());

    const result = await deployCommand.run(TEXT, ctx);

    expect(result.stdout).toBe(`lift deploy · dev \u001b[90m(https://n8n.example.com)\u001b[39m

\u001b[31m✗\u001b[39m crm-import    failed
  \u001b[31mPUT /api/v1/workflows/crm1 : HTTP 500: boom\u001b[39m
  \u001b[36m→ ${RETRY_HINT}\u001b[39m
\u001b[32m+\u001b[39m daily-report  created  \u001b[90mhttps://n8n.example.com/workflow/w1\u001b[39m
\u001b[32m+\u001b[39m invoice-sync  created  \u001b[90mhttps://n8n.example.com/workflow/w2\u001b[39m

2 created, 0 updated, 0 restored, 0 skipped, 1 failed.
Tag boilerlift:dev added to 2 workflows

\u001b[36m→ lift publish\u001b[39m  publishes the drafts
\u001b[36m→ commit boilerlift.lock.json\u001b[39m  it was updated
`);
  });

  test('Should print the JSON report without colour when colour is on', async () => {
    const n8n = failingUpdateInstance();
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve(FILES), color: true }, crmLock());

    const result = await deployCommand.run(JSON_INPUT, ctx);

    expect(result.stdout).not.toContain('\u001b[');
  });

  test('Should recap the failed workflow on stderr when one workflow fails', async () => {
    const n8n = failingUpdateInstance();
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve(FILES) }, crmLock());

    const result = await deployCommand.run(TEXT, ctx);

    expect(result.stderr).toBe(`Failed: crm-import.

→ lift deploy  once each failure is fixed with the step under its line
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
    expect(result.stdout).toBe(`lift deploy · dev (https://n8n.example.com)

✗ crm-import    failed
  POST /api/v1/workflows : HTTP 401: boom
  → ${KEY_HINT}
– daily-report  not processed
– invoice-sync  not processed

0 created, 0 updated, 0 restored, 0 skipped, 1 failed.
`);
  });

  test('Should recap the stop and the next step on stderr when the key is rejected mid-run', async () => {
    const n8n = keyRejectedOnCreateInstance();
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve(FILES) });

    const result = await deployCommand.run(TEXT, ctx);

    expect(result.stderr).toBe(`Failed: crm-import.
Stopped: POST /api/v1/workflows : HTTP 401: boom
Not processed: daily-report, invoice-sync.

→ ${KEY_HINT}
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
      stdout: 'lift deploy · dev (https://n8n.example.com)\n',
      stderr: `✗ GET /api/v1/openapi.yml : HTTP 404: n8n 2.35.0 or later is required
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
      target: 'dev',
      instance: 'https://n8n.example.com',
      dryRun: false,
      results: [],
      summary: { created: 0, recreated: 0, updated: 0, restored: 0, skipped: 0, failed: 0, notProcessed: 0 },
      warnings: [],
      lockFile: { path: 'boilerlift.lock.json', changed: false },
      tag: { name: 'boilerlift:dev', added: 0 },
      error: {
        call: 'GET /api/v1/openapi.yml',
        detail: 'HTTP 404: n8n 2.35.0 or later is required',
        hint: 'Upgrade the instance to n8n 2.35.0 or later, then run deploy again',
      },
      next: null,
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
      stdout: `lift deploy · dev (https://n8n.example.com)

↺ daily-report  restored  https://n8n.example.com/workflow/rep1 (unpublished draft)
! daily-report: workflow rep1 was archived in n8n; it is back as an unpublished draft

0 created, 0 updated, 1 restored, 0 skipped, 0 failed.
Tag boilerlift:dev added to 1 workflows

→ lift publish  publishes the drafts
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
    expect(result.stderr).toContain('Stopped: GET /api/v1/workflows/crm1 : HTTP 401: boom');
    expect(result.stderr).toContain('→ Create a key in n8n → Settings → n8n API');
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

    expect(result).toEqual({
      exitCode: 0,
      stdout: 'lift deploy · dev (https://n8n.example.com)\n\nNothing to deploy: no workflow in ./workflows.\n',
      stderr: '',
    });
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
    expect(result.stderr).toContain('✗ workflows/Bad_Name.json     stable name "Bad_Name"');
    expect(result.stderr).toContain(
      '✗ workflows/sync.workflow.ts  stable name "sync" is also used by workflows/a/sync.json',
    );
  });

  test('Should exit 1 and name the target when its API key is missing', async () => {
    const ctx = context({ loadProjectConfig: fakeSingleTarget('https://n8n.example.com', ''), loadWorkflowFiles: () => Promise.resolve(FILES) });

    const result = await deployCommand.run(TEXT, ctx);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Missing the API key of target "dev": its "apiKey" in boilerlift.config.ts is empty.');
  });

  test('Should show what deploy would do when --dry-run is set', async () => {
    const n8n = mixedInstance();
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve(FILES) }, mixedLock());

    const result = await deployCommand.run(DRY_RUN, ctx);

    expect(result).toEqual({
      exitCode: 0,
      stderr: '',
      stdout: `lift deploy --dry-run · dev (https://n8n.example.com)

~ crm-import    would update  https://n8n.example.com/workflow/crm1 (draft; published version still running)
= daily-report  would skip  unchanged  https://n8n.example.com/workflow/rep1
+ invoice-sync  would create  workflows/invoice-sync.workflow.ts

Would: 1 create, 1 update, 0 restore, 1 skip, 0 fail.
Tag boilerlift:dev would be added to 3 workflows
Dry run: nothing was written.
n8n can still reject a write; this preview covers what reads can show.

→ lift deploy  applies it
→ commit boilerlift.lock.json after lift deploy  it would update
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
      target: 'dev',
      instance: 'https://n8n.example.com',
      dryRun: true,
      results: [
        { stableName: 'daily-report', path: 'workflows/daily-report.json', action: 'restored', id: 'rep1', name: 'Daily report', url: 'https://n8n.example.com/workflow/rep1' },
        { stableName: 'new', path: 'workflows/new.json', action: 'created', id: null, name: 'New', url: null },
      ],
      summary: { created: 1, recreated: 0, updated: 0, restored: 1, skipped: 0, failed: 0, notProcessed: 0 },
      warnings: ['daily-report: workflow rep1 was archived in n8n; deploy would bring it back as an unpublished draft'],
      lockFile: { path: 'boilerlift.lock.json', changed: true },
      tag: { name: 'boilerlift:dev', added: 2 },
      error: null,
      next: null,
      exitCode: 0,
    });
  });

  test('Should show the blocker and exit 6 when --dry-run meets an instance that cannot save drafts', async () => {
    const n8n = noDraftsInstance();
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve(FILES) }, crmLock());

    const result = await deployCommand.run(DRY_RUN, ctx);

    expect(result.exitCode).toBe(6);
    expect(result.stdout).toBe('lift deploy --dry-run · dev (https://n8n.example.com)\n');
    expect(result.stderr).toContain('✗ GET /api/v1/openapi.yml : HTTP 404: n8n 2.35.0 or later is required');
    expect(result.stderr).toContain('Nothing was written to n8n.');
  });

  test('Should say there is nothing to deploy when --dry-run finds ./workflows empty', async () => {
    const ctx = context({});

    const result = await deployCommand.run(DRY_RUN, ctx);

    expect(result).toEqual({
      exitCode: 0,
      stdout: 'lift deploy --dry-run · dev (https://n8n.example.com)\n\nNothing to deploy: no workflow in ./workflows.\n',
      stderr: '',
    });
  });

  test('Should print an empty JSON report with dryRun true when --dry-run --json finds ./workflows empty', async () => {
    const ctx = context({});

    const result = await deployCommand.run(DRY_RUN_JSON, ctx);

    expect(JSON.parse(result.stdout)).toMatchObject({ dryRun: true, results: [], exitCode: 0 });
  });

  test('Should declare --dry-run as a mode and --json as a format when the help is generated from the options', () => {
    const { options, modes, help } = deployCommand;

    const declared = [options['dry-run'], options.json];

    expect(declared).toEqual([
      { type: 'boolean', description: 'Show what deploy would do; write nothing', mode: true },
      { type: 'boolean', description: 'Print the report as JSON', format: true },
    ]);
    expect(modes).toEqual(['dry-run']);
    expect(help.description).toContain('It exits with the same codes as a real deploy.');
    expect(deployCommand.targets).toBe(true);
  });

  test('Should exit 1 and send nothing when the url of the target uses another scheme than http or https', async () => {
    const ctx = context({ loadProjectConfig: fakeSingleTarget('ftp://n8n.example.com'), loadWorkflowFiles: () => Promise.resolve(FILES) });

    const result = await deployCommand.run(TEXT, ctx);

    expect(result).toEqual({
      exitCode: 1,
      stdout: '',
      stderr:
        'Invalid boilerlift.config.ts:\n' +
        '  ✗ target "dev": "url" must be an http:// or https:// URL, found "ftp://n8n.example.com"\n',
    });
  });

  test('Should stop with exit 3 and name the unexpected answer when the instance answers a page that is not the n8n API', async () => {
    const n8n = fakeN8n({ workflows: [fakeN8nWorkflow(CRM, { id: 'crm1' })], failures: [invalidResponse('GET /api/v1/workflows/crm1')] });
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve(FILES) }, crmLock());

    const result = await deployCommand.run(TEXT, ctx);

    expect(result.exitCode).toBe(3);
    expect(result.stderr).toBe(
      'Failed: crm-import.\n' +
        'Stopped: GET /api/v1/workflows/crm1 : unexpected answer (HTTP 200): the body is not JSON\n' +
        'Not processed: daily-report, invoice-sync.\n' +
        '\n' +
        '→ Check that the url of the target points to an n8n instance (n8n 2.35.0 or later), then run deploy again\n',
    );
  });
  test('Should update a recorded workflow by its id when it was renamed in n8n', async () => {
    const n8n = fakeN8n({ workflows: [fakeN8nWorkflow(CRM, { id: 'crm1', name: 'Renamed in n8n' })] });
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve([fakeWorkflowFile(CRM)]) }, crmLock());

    const result = await deployCommand.run(TEXT, ctx);

    expect(result.stdout).toContain('~ crm-import  updated  https://n8n.example.com/workflow/crm1 (draft; published version still running)\n');
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

    expect(result.stdout).toMatch(/\n→ commit boilerlift\.lock\.json {2}it was updated\n$/);
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
      stdout: `lift deploy · dev (https://n8n.example.com)

* crm-import  recreated  https://n8n.example.com/workflow/w1 (n8n no longer has the recorded workflow gone)

0 created, 1 recreated, 0 updated, 0 restored, 0 skipped, 0 failed.
Tag boilerlift:dev added to 1 workflows

→ lift publish  publishes the drafts
→ commit boilerlift.lock.json  it was updated
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

    expect(result.stdout).toBe(`lift deploy --dry-run · dev (https://n8n.example.com)

* crm-import  would recreate  workflows/crm/crm-import.json (n8n no longer has the recorded workflow gone)

Would: 0 create, 1 recreate, 0 update, 0 restore, 0 skip, 0 fail.
Tag boilerlift:dev would be added to 1 workflows
Dry run: nothing was written.
n8n can still reject a write; this preview covers what reads can show.

→ lift deploy  applies it
→ commit boilerlift.lock.json after lift deploy  it would update
`);
  });

  test('Should call no tag endpoint when the target turns the tag off', async () => {
    const n8n = fakeN8n({ workflows: [fakeN8nWorkflow(CRM, { id: 'crm1', name: 'CRM import (old)' }), fakeN8nWorkflow(REPORT, { id: 'rep1' })] });
    const lock = recorded({ 'crm-import': 'crm1', 'daily-report': 'rep1', 'invoice-sync': 'gone' });
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve([...FILES, fakeWorkflowFile(NEW)]), loadProjectConfig: untaggedTarget() }, lock);

    const result = await deployCommand.run(TEXT, ctx);

    expect({ exitCode: result.exitCode, tagRequests: n8n.requests.filter((request) => request.includes('/tags')) }).toEqual({
      exitCode: 0,
      tagRequests: [],
    });
  });

  test('Should warn with the workflow and the error, and keep exit 0, when the tag cannot be added', async () => {
    const n8n = fakeN8n({ workflows: [fakeN8nWorkflow(REPORT, { id: 'rep1' })], failures: [httpError('PUT /api/v1/workflows/rep1/tags', 403, 'Forbidden')] });
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve([fakeWorkflowFile(REPORT)]) }, recorded({ 'daily-report': 'rep1' }));

    const result = await deployCommand.run(TEXT, ctx);

    expect(result).toEqual({
      exitCode: 0,
      stderr: '',
      stdout: `lift deploy · dev (https://n8n.example.com)

= daily-report  skipped  unchanged  https://n8n.example.com/workflow/rep1
! daily-report: tag boilerlift:dev not added (PUT /api/v1/workflows/rep1/tags : HTTP 403: Forbidden); the workflow is deployed without it

0 created, 0 updated, 0 restored, 1 skipped, 0 failed.
`,
    });
  });

  test('Should print no tag line when every workflow already has the target tag', async () => {
    const n8n = fakeN8n({ workflows: [fakeN8nWorkflow(REPORT, { id: 'rep1', tags: [{ id: 't', name: 'boilerlift:dev' }] })] });
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve([fakeWorkflowFile(REPORT)]) }, recorded({ 'daily-report': 'rep1' }));

    const result = await deployCommand.run(TEXT, ctx);

    expect(result.stdout).not.toContain('Tag boilerlift:dev');
  });

  test('Should report a null tag in JSON when the target turns the tag off', async () => {
    const n8n = fakeN8n();
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve([fakeWorkflowFile(NEW)]), loadProjectConfig: untaggedTarget() });

    const result = await deployCommand.run(JSON_INPUT, ctx);

    expect(JSON.parse(result.stdout)).toMatchObject({ tag: null, exitCode: 0 });
  });

  test('Should exit 1 and send nothing when a target name is longer than 13 characters', async () => {
    const n8n = fakeN8n();
    const config = fakeProjectConfig({ targets: { 'fourteen-chars': { url: 'https://n8n.example.com', apiKey: 'secret', workflows: './workflows' } } });
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve([fakeWorkflowFile(NEW)]), loadProjectConfig: config });

    const result = await deployCommand.run(TEXT, ctx);

    expect({ exitCode: result.exitCode, requests: n8n.requests }).toEqual({ exitCode: 1, requests: [] });
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
      stdout: `lift deploy · dev (https://n8n.example.com)

✗ crm-import    failed
  write boilerlift.lock.json : workflow w1 was created for crm-import, but boilerlift.lock.json could not be written: EACCES: permission denied
  → Add "crm-import": { "n8nId": "w1" } under "https://n8n.example.com" in boilerlift.lock.json by hand and commit it, then run deploy again
– daily-report  not processed
– invoice-sync  not processed

0 created, 0 updated, 0 restored, 0 skipped, 1 failed.
`,
      stderr: `Failed: crm-import.
Stopped: write boilerlift.lock.json : workflow w1 was created for crm-import, but boilerlift.lock.json could not be written: EACCES: permission denied
Not processed: daily-report, invoice-sync.

→ Add "crm-import": { "n8nId": "w1" } under "https://n8n.example.com" in boilerlift.lock.json by hand and commit it, then run deploy again
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
      stderr: `✗ boilerlift.lock.json  "version" must be 1, found 2
  → Fix the file, or restore it from version control, then run deploy again.

Invalid boilerlift.lock.json. Nothing was sent to n8n.
`,
    });
  });

  test('Should explain the lock file, the recreate rule, the 64-character names and exit code 7 when the help is generated from its fields', () => {
    const { description = '', exitCodes } = deployCommand.help;
    const usage = [description, ...exitCodes.map(([code, meaning]) => `${code}  ${meaning}`)].join('\n');

    const lines = [
      'Commit the file after each deploy that changes it',
      'is created again from code, and the new id recorded.',
      '1 to 64 of a-z, 0-9 and -.',
      '7  A workflow was created but boilerlift.lock.json could not be written',
    ];

    expect(lines.filter((line) => !usage.includes(line))).toEqual([]);
    expect(usage).not.toMatch(/boilerlift:(?!<target>)/);
  });
});

const DEV_FILES = [fakeWorkflowFile(fakeLocalWorkflow('invoice-sync', { path: 'dev/invoice-sync.workflow.ts' }))];
const PROD_FILES = [fakeWorkflowFile(fakeLocalWorkflow('crm-import', { path: 'prod/crm-import.json' }))];

/** The files of `./dev` and `./prod`, by folder. */
function twoFolders(dir: string): Promise<ReturnType<typeof fakeWorkflowFile>[]> {
  return Promise.resolve(dir === './dev' ? DEV_FILES : dir === './prod' ? PROD_FILES : []);
}

function targetsContext(overrides: Partial<CommandContext>, lock: FakeLockFile = fakeLockFile()): CommandContext {
  return context({ loadProjectConfig: fakeTwoTargets(), loadWorkflowFiles: twoFolders, ...overrides }, lock);
}

const ALL: CommandInput = { positionals: [], values: { all: true } };
const ALL_JSON: CommandInput = { positionals: [], values: { all: true, json: true } };

describe('deployCommand targets', () => {
  test('Should exit 1 and print a starter config to copy when there is no boilerlift.config.ts', async () => {
    const ctx = context({ loadProjectConfig: () => Promise.resolve({ kind: 'missing' }) });

    const result = await deployCommand.run(TEXT, ctx);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('No boilerlift.config.ts in this folder.');
    expect(result.stderr).toContain("import { defineConfig } from 'boilerlift';");
    expect(result.stderr).toContain('      url: process.env.N8N_URL,\n      apiKey: process.env.N8N_API_KEY,\n      workflows: \'./workflows\',');
  });

  test('Should exit 1, send nothing and list the targets when several are declared and none is named', async () => {
    const n8n = fakeN8n();
    const ctx = targetsContext({ fetch: n8n.fetch });

    const result = await deployCommand.run(TEXT, ctx);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('declares several targets, and the command names none.\nAvailable targets: dev, prod\nName one with --target <name>, or run on every one with --all.\n');
    expect(result.stderr).toContain('Available targets: dev, prod\n');
    expect(n8n.requests).toEqual([]);
  });

  test('Should list the available targets in the JSON when --json names an unknown target', async () => {
    const ctx = targetsContext({});

    const result = await deployCommand.run({ positionals: [], values: { target: 'staging', json: true } }, ctx);

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ error: { kind: 'unknown-target' }, availableTargets: ['dev', 'prod'], exitCode: 1 });
  });

  test('Should deploy only to the instance of the target --target names when several are declared', async () => {
    const dev = fakeN8n();
    const prod = fakeN8n();
    const ctx = targetsContext({ fetch: fakeN8nByOrigin({ [DEV_URL]: dev, [PROD_URL]: prod }) });

    const result = await deployCommand.run({ positionals: [], values: { target: 'prod' } }, ctx);

    expect(result.exitCode).toBe(0);
    expect(prod.workflows.map(({ name }) => name)).toEqual(['Workflow crm-import']);
    expect(dev.requests).toEqual([]);
  });

  test('Should exit 1 and send nothing when the workflows folder of the target does not exist', async () => {
    const n8n = fakeN8n();
    const ctx = context({ fetch: n8n.fetch, isDirectory: () => Promise.resolve(false) });

    const result = await deployCommand.run(TEXT, ctx);

    expect(result).toEqual({
      exitCode: 1,
      stdout: '',
      stderr:
        'The workflows folder of target "dev", ./workflows, does not exist.\n' +
        'Create it, or fix "workflows" for this target in boilerlift.config.ts.\n' +
        'Available targets: dev\n',
    });
    expect(n8n.requests).toEqual([]);
  });

  test('Should exit 1 and send nothing to any target when --all meets a target whose API key is missing', async () => {
    const dev = fakeN8n();
    const config = fakeProjectConfig({
      targets: {
        dev: { url: DEV_URL, apiKey: 'dev-secret', workflows: './dev' },
        prod: { url: PROD_URL, apiKey: undefined, workflows: './prod' },
      },
    });
    const ctx = targetsContext({ loadProjectConfig: config, fetch: dev.fetch });

    const result = await deployCommand.run(ALL, ctx);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Missing the API key of target "prod"');
    expect(dev.requests).toEqual([]);
  });

  test('Should print one block per target, then a recap line per target, when --all deploys every target', async () => {
    const ctx = targetsContext({ fetch: fakeN8nByOrigin({ [DEV_URL]: fakeN8n(), [PROD_URL]: fakeN8n() }) });

    const result = await deployCommand.run(ALL, ctx);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('── dev (https://dev.example.com)\nlift deploy · dev (https://dev.example.com)\n\n+ invoice-sync  created');
    expect(result.stdout).toContain('── prod (https://prod.example.com)\nlift deploy · prod (https://prod.example.com)\n\n+ crm-import  created');
    expect(result.stdout).toContain(
      'Targets:\n' +
        '  ✓ dev   https://dev.example.com   1 created, 0 updated, 0 restored, 0 skipped, 0 failed.  → lift publish --target dev\n' +
        '  ✓ prod  https://prod.example.com  1 created, 0 updated, 0 restored, 0 skipped, 0 failed.  → lift publish --target prod\n',
    );
  });

  test('Should go on to the next target and exit with the worst code when --all meets an unreachable target', async () => {
    const dev = fakeN8n({ failures: [unreachable('GET /api/v1/openapi.yml', 'connection refused')] });
    const prod = fakeN8n();
    const ctx = targetsContext({ fetch: fakeN8nByOrigin({ [DEV_URL]: dev, [PROD_URL]: prod }) });

    const result = await deployCommand.run(ALL, ctx);

    expect(result.exitCode).toBe(3);
    expect(prod.workflows.map(({ name }) => name)).toEqual(['Workflow crm-import']);
    expect(result.stdout).toContain('  ✗ dev   https://dev.example.com   stopped: GET /api/v1/openapi.yml : unreachable: connection refused');
    expect(result.stderr).toContain('── dev (https://dev.example.com)\n✗ GET /api/v1/openapi.yml : unreachable: connection refused');
  });

  test('Should print one entry per target and the worst exit code when --all --json deploys', async () => {
    const ctx = targetsContext({ fetch: fakeN8nByOrigin({ [DEV_URL]: fakeN8n(), [PROD_URL]: fakeN8n() }) });

    const result = await deployCommand.run(ALL_JSON, ctx);

    expect(JSON.parse(result.stdout)).toMatchObject({
      targets: [
        { target: 'dev', instance: DEV_URL, results: [{ stableName: 'invoice-sync', action: 'created' }], exitCode: 0 },
        { target: 'prod', instance: PROD_URL, results: [{ stableName: 'crm-import', action: 'created' }], exitCode: 0 },
      ],
      exitCode: 0,
    });
  });

  test('Should exit 1, send nothing and name both targets and the file when two targets on one url hold the same stable name', async () => {
    const n8n = fakeN8n();
    const config = fakeProjectConfig({
      targets: {
        dev: { url: DEV_URL, apiKey: 'dev-secret', workflows: './dev' },
        demo: { url: `${DEV_URL}/`, apiKey: 'dev-secret', workflows: './demo' },
      },
    });
    const demoFiles = [fakeWorkflowFile(fakeLocalWorkflow('invoice-sync', { path: 'demo/invoice-sync.json' }))];
    const loadWorkflowFiles = (dir: string): Promise<ReturnType<typeof fakeWorkflowFile>[]> => Promise.resolve(dir === './dev' ? DEV_FILES : demoFiles);
    const ctx = targetsContext({ loadProjectConfig: config, loadWorkflowFiles, fetch: n8n.fetch });

    const result = await deployCommand.run({ positionals: [], values: { target: 'dev' } }, ctx);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      '✗ invoice-sync  targets dev (dev/invoice-sync.workflow.ts) and demo (demo/invoice-sync.json) both deploy it to https://dev.example.com',
    );
    expect(n8n.requests).toEqual([]);
  });

  test('Should stop before any write, exit 8 and name each missing key with its type and workflows when the target lacks a credential', async () => {
    const n8n = fakeN8n();
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve([fakeWorkflowFileUsing('workflows/invoice-sync.workflow.ts', ['gmail-sales'])]) });

    const result = await deployCommand.run(TEXT, ctx);

    expect(result).toEqual({
      exitCode: 8,
      stdout: 'lift deploy · dev (https://n8n.example.com)\n',
      stderr:
        '✗ GET /api/v1/credentials : 1 credential missing on target dev: gmail-sales\n' +
        '  gmail-sales (httpHeaderAuth)  not in credentials/dev.ts; used by invoice-sync\n' +
        '  → Run lift creds sync --target dev to update credentials/dev.ts, or create the missing credentials in n8n first, then run deploy again\n' +
        '\n' +
        'Nothing was written to n8n.\n',
    });
    expect(n8n.requests.filter((request) => !request.startsWith('GET'))).toEqual([]);
  });

  test('Should list each missing credential in the JSON error when the target lacks a credential', async () => {
    const n8n = fakeN8n({ credentials: [fakeCredential('slack', { id: 'other-id' })] });
    const folder = fakeCredentialsFolder({ files: [{ path: 'credentials/dev.ts', content: [fakeCredentialEntry('slack')] }] });
    const ctx = context({ fetch: n8n.fetch, ...folder.context, loadWorkflowFiles: () => Promise.resolve([fakeWorkflowFileUsing('workflows/a.json', ['slack'])]) });

    const result = await deployCommand.run(JSON_INPUT, ctx);

    expect(JSON.parse(result.stdout)).toMatchObject({
      exitCode: 8,
      error: { kind: 'credentials-missing', missing: [{ key: 'slack', type: 'httpHeaderAuth', reason: 'gone', id: 'slack-id', workflows: ['a'] }] },
    });
  });

  test('Should exit 8 and write nothing when a dry run finds a credential the target lacks', async () => {
    const n8n = fakeN8n();
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve([fakeWorkflowFileUsing('workflows/a.json', ['slack'])]) });

    const result = await deployCommand.run(DRY_RUN, ctx);

    expect([result.exitCode, n8n.requests.filter((request) => !request.startsWith('GET'))]).toEqual([8, []]);
  });

  test('Should stop before any write and exit 9 when workflows use credential() and the API key lacks the credential:list scope', async () => {
    const n8n = fakeN8n({ failures: [httpError('GET /api/v1/credentials', 403, 'Forbidden')] });
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve([fakeWorkflowFileUsing('workflows/a.json', ['slack'])]) });

    const result = await deployCommand.run(TEXT, ctx);

    expect([result.exitCode, n8n.workflows.length]).toEqual([9, 0]);
  });
});
