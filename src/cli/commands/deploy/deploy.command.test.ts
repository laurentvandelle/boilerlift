import { describe, expect, test } from 'vitest';
import { CommandContext, WorkflowFile } from '#src/cli/cli.model';
import { fakeContext } from '#src/cli/cli.fake';
import { deployCommand } from '#src/cli/commands/deploy/deploy.command';

const TEXT = { positionals: [], values: {} };
const JSON_INPUT = { positionals: [], values: { json: true } };
const DRY_RUN = { positionals: [], values: { 'dry-run': true } };
const DRY_RUN_JSON = { positionals: [], values: { 'dry-run': true, json: true } };
const ENV = { N8N_URL: 'https://n8n.example.com', N8N_API_KEY: 'secret' };

interface Stored {
  id: string;
  name: string;
  nodes: unknown[];
  connections: Record<string, unknown>;
  settings: Record<string, unknown>;
  tags: { id: string; name: string }[];
  isArchived?: boolean;
}

const DRAFT_SPEC = 'paths:\n  /workflows/{id}:\n    put:\n      parameters:\n        - name: publishIfActive\n';

/** A `fetch` that answers like the n8n public API, backed by an in-memory instance. */
function fakeN8n(
  options: { workflows?: Stored[]; failOn?: { call: string; status: number }; spec?: string | { status: number } } = {},
): {
  fetch: typeof fetch;
  calls: string[];
  workflows: Stored[];
} {
  const workflows = structuredClone(options.workflows ?? []);
  const tags = workflows.flatMap((workflow) => workflow.tags);
  const calls: string[] = [];
  let nextId = 100;
  const json = (body: unknown, status = 200): Promise<Response> =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));
  const fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const method = init?.method ?? 'GET';
    const call = `${method} ${url.pathname}`;
    calls.push(`${call}${url.search}`);
    if (options.failOn?.call === call) {
      return json({ message: 'boom' }, options.failOn.status);
    }
    const body = init?.body === undefined ? undefined : (JSON.parse(init.body as string) as Record<string, unknown>);
    const [, , , resource, id, sub] = url.pathname.split('/');
    if (resource === 'openapi.yml') {
      const spec = options.spec ?? DRAFT_SPEC;
      return typeof spec === 'string'
        ? Promise.resolve(new Response(spec, { status: 200 }))
        : json({ message: 'not found' }, spec.status);
    }
    const find = (): Stored | undefined => workflows.find((workflow) => workflow.id === id);
    if (resource === 'tags') {
      if (method === 'GET') return json({ data: tags, nextCursor: null });
      const tag = { id: `t${nextId++}`, name: body?.name as string };
      tags.push(tag);
      return json(tag);
    }
    if (id === undefined) {
      if (method === 'GET') return json({ data: workflows, nextCursor: null });
      const created = { ...(body as unknown as Stored), id: `w${nextId++}`, tags: [] };
      workflows.push(created);
      return json(created);
    }
    const workflow = find();
    if (workflow === undefined) return json({ message: 'not found' }, 404);
    if (sub === 'unarchive') {
      workflow.isArchived = false;
      return json(workflow);
    }
    if (sub === 'tags') {
      workflow.tags = (body as unknown as { id: string }[]).map(({ id: tagId }) => tags.find((t) => t.id === tagId)!);
      return json(workflow.tags);
    }
    if (method === 'PUT') Object.assign(workflow, body);
    return json(workflow);
  };
  return { fetch, calls, workflows };
}

const NODE = { id: 'n1', name: 'Start', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} };

function file(path: string, name: string, extra: Record<string, unknown> = {}): WorkflowFile {
  return { path, content: { name, nodes: [NODE], connections: {}, settings: { executionOrder: 'v1' }, ...extra } };
}

function stored(id: string, stableName: string, name: string, extra: Partial<Stored> = {}): Stored {
  return {
    id,
    name,
    nodes: [{ ...NODE, id: 'server' }],
    connections: {},
    settings: { executionOrder: 'v1', redactionPolicy: 'none' },
    tags: [{ id: `tag-${stableName}`, name: `n8nlift:${stableName}` }],
    ...extra,
  };
}

const FILES: WorkflowFile[] = [
  file('workflows/invoice-sync.workflow.ts', 'Invoice sync'),
  file('workflows/crm/crm-import.json', 'CRM import'),
  file('workflows/daily-report.json', 'Daily report'),
];

function context(overrides: Partial<CommandContext>): CommandContext {
  return fakeContext({ registry: [deployCommand], env: ENV, ...overrides });
}

describe('deployCommand', () => {
  test('Should create, update as a draft and skip, then print the summary', async () => {
    // Given
    const n8n = fakeN8n({
      workflows: [
        stored('crm1', 'crm-import', 'CRM import (old)', { tags: [{ id: 'tag-crm-import', name: 'n8nlift:crm-import' }, { id: 'h', name: 'hand-added' }] }),
        stored('rep1', 'daily-report', 'Daily report'),
      ],
    });
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve(FILES) });

    // When
    const result = await deployCommand.run(TEXT, ctx);

    // Then
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(`n8nlift deploy → https://n8n.example.com
~ updated       crm-import     workflows/crm/crm-import.json (draft; published version still running)
= skipped       daily-report   unchanged
+ created       invoice-sync   workflows/invoice-sync.workflow.ts
1 created, 1 updated, 0 restored, 1 skipped, 0 failed. Drafts are not live until you publish them.
`);
    expect(n8n.calls).toContain('GET /api/v1/openapi.yml');
    expect(n8n.calls).toContain('PUT /api/v1/workflows/crm1?publishIfActive=false');
    expect(n8n.calls).not.toContain('PUT /api/v1/workflows/rep1?publishIfActive=false');
    expect(n8n.calls).toContain('POST /api/v1/workflows');
    expect(n8n.calls.filter((call) => call.startsWith('PUT /api/v1/workflows/crm1/tags'))).toEqual([]);
    expect(n8n.workflows.find((w) => w.id === 'crm1')?.tags.map((t) => t.name)).toEqual(['n8nlift:crm-import', 'hand-added']);
    expect(n8n.workflows.find((w) => w.name === 'Invoice sync')?.tags.map((t) => t.name)).toEqual(['n8nlift:invoice-sync']);
  });

  test('Should make no write on a rerun', async () => {
    // Given
    const n8n = fakeN8n();
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve(FILES) });
    await deployCommand.run(TEXT, ctx);
    n8n.calls.length = 0;

    // When
    const result = await deployCommand.run(TEXT, ctx);

    // Then
    expect(result.stdout).toContain('0 created, 0 updated, 0 restored, 3 skipped, 0 failed.\n');
    expect(n8n.calls.every((call) => call.startsWith('GET '))).toBe(true);
  });

  test('Should print a stable JSON report with --json', async () => {
    // Given
    const n8n = fakeN8n({ workflows: [stored('rep1', 'daily-report', 'Daily report')] });
    const files = [file('workflows/daily-report.json', 'Daily report'), file('workflows/new.json', 'New')];
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve(files) });

    // When
    const result = await deployCommand.run(JSON_INPUT, ctx);

    // Then
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      instance: 'https://n8n.example.com',
      dryRun: false,
      results: [
        { stableName: 'daily-report', path: 'workflows/daily-report.json', action: 'skipped', id: 'rep1', name: 'Daily report' },
        { stableName: 'new', path: 'workflows/new.json', action: 'created', id: 'w100', name: 'New' },
      ],
      summary: { created: 1, updated: 0, restored: 0, skipped: 1, failed: 0, notProcessed: 0 },
      warnings: [],
      error: null,
      exitCode: 0,
    });
  });

  test('Should keep going after one failed workflow, show its hint in place, recap it and exit 5', async () => {
    // Given
    const n8n = fakeN8n({
      workflows: [stored('crm1', 'crm-import', 'CRM import (old)')],
      failOn: { call: 'PUT /api/v1/workflows/crm1', status: 500 },
    });
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve(FILES) });

    // When
    const text = await deployCommand.run(TEXT, ctx);
    const json = await deployCommand.run(JSON_INPUT, ctx);

    // Then
    expect(text.exitCode).toBe(5);
    expect(text.stdout).toBe(`n8nlift deploy → https://n8n.example.com
✗ failed        crm-import     PUT /api/v1/workflows/crm1 → HTTP 500: boom
                → Check the workflow file and the n8n instance (n8n 2.35.0 or later), then run deploy again
+ created       daily-report   workflows/daily-report.json
+ created       invoice-sync   workflows/invoice-sync.workflow.ts
2 created, 0 updated, 0 restored, 0 skipped, 1 failed. Drafts are not live until you publish them.
`);
    expect(text.stderr).toBe(`Failed: crm-import.
Next: fix each failure with the hint under its line, then run deploy again.
`);
    expect(json.exitCode).toBe(5);
    expect(JSON.parse(json.stdout)).toMatchObject({
      results: [
        {
          stableName: 'crm-import',
          action: 'failed',
          id: 'crm1',
          error: {
            call: 'PUT /api/v1/workflows/crm1',
            detail: 'HTTP 500: boom',
            hint: 'Check the workflow file and the n8n instance (n8n 2.35.0 or later), then run deploy again',
          },
        },
        { stableName: 'daily-report', action: 'skipped' },
        { stableName: 'invoice-sync', action: 'skipped' },
      ],
      summary: { failed: 1, skipped: 2 },
      error: null,
      exitCode: 5,
    });
  });

  test('Should list the workflows not processed and exit 4 when the key is rejected mid-run', async () => {
    // Given
    const n8n = fakeN8n({ failOn: { call: 'POST /api/v1/workflows', status: 401 } });
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve(FILES) });

    // When
    const text = await deployCommand.run(TEXT, ctx);
    const json = await deployCommand.run(JSON_INPUT, ctx);

    // Then
    expect(text.exitCode).toBe(4);
    expect(text.stdout).toBe(`n8nlift deploy → https://n8n.example.com
✗ failed        crm-import     POST /api/v1/workflows → HTTP 401: boom
                → Create a key in n8n → Settings → n8n API, then set N8N_API_KEY in .env
- not-processed daily-report   not processed
- not-processed invoice-sync   not processed
0 created, 0 updated, 0 restored, 0 skipped, 1 failed.
`);
    expect(text.stderr).toBe(`Failed: crm-import.
Stopped: POST /api/v1/workflows → HTTP 401: boom
Not processed: daily-report, invoice-sync.
Next: Create a key in n8n → Settings → n8n API, then set N8N_API_KEY in .env.
`);
    expect(JSON.parse(json.stdout)).toMatchObject({
      summary: { failed: 1, notProcessed: 2 },
      error: { call: 'POST /api/v1/workflows', detail: 'HTTP 401: boom' },
      exitCode: 4,
    });
  });

  test('Should write nothing, name n8n 2.35.0 and exit 6 when the instance cannot save drafts', async () => {
    // Given
    const n8n = fakeN8n({ workflows: [stored('crm1', 'crm-import', 'CRM import (old)')], spec: { status: 404 } });
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve(FILES) });

    // When
    const text = await deployCommand.run(TEXT, ctx);
    const json = await deployCommand.run(JSON_INPUT, ctx);

    // Then
    expect(text.exitCode).toBe(6);
    expect(text.stdout).toBe('n8nlift deploy → https://n8n.example.com\n');
    expect(text.stderr).toBe(`✗ GET /api/v1/openapi.yml → HTTP 404: n8n 2.35.0 or later is required
  → Upgrade the instance to n8n 2.35.0 or later, then run deploy again
Nothing was written to n8n.
`);
    expect(n8n.calls.every((call) => call.startsWith('GET '))).toBe(true);
    expect(JSON.parse(json.stdout)).toEqual({
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

  test('Should restore an archived workflow as a draft and warn about it', async () => {
    // Given
    const n8n = fakeN8n({ workflows: [stored('rep1', 'daily-report', 'Daily report (old)', { isArchived: true })] });
    const files = [file('workflows/daily-report.json', 'Daily report')];
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve(files) });

    // When
    const text = await deployCommand.run(TEXT, ctx);

    // Then
    expect(text.exitCode).toBe(0);
    expect(text.stdout).toBe(`n8nlift deploy → https://n8n.example.com
! restored      daily-report   workflows/daily-report.json (unpublished draft)
⚠ daily-report: workflow rep1 was archived in n8n; it is back as an unpublished draft
0 created, 0 updated, 1 restored, 0 skipped, 0 failed. Drafts are not live until you publish them.
`);
    expect(text.stderr).toBe('');
    expect(n8n.calls).toContain('POST /api/v1/workflows/rep1/unarchive');
    expect(n8n.calls).toContain('PUT /api/v1/workflows/rep1?publishIfActive=false');
    expect(n8n.workflows[0]?.isArchived).toBe(false);
  });

  test('Should exit 4 and write nothing when the API key is rejected on the first call', async () => {
    // Given
    const n8n = fakeN8n({ failOn: { call: 'GET /api/v1/workflows', status: 401 } });
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve(FILES) });

    // When
    const result = await deployCommand.run(TEXT, ctx);

    // Then
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain('✗ GET /api/v1/workflows → HTTP 401: boom');
    expect(result.stderr).toContain('→ Create a key in n8n → Settings → n8n API');
    expect(n8n.calls).toEqual(['GET /api/v1/workflows?excludePinnedData=true&limit=250']);
  });

  test('Should say there is nothing to deploy and exit 0 when ./workflows is empty', async () => {
    // Given
    const ctx = context({});

    // When
    const result = await deployCommand.run(TEXT, ctx);

    // Then
    expect(result).toEqual({ exitCode: 0, stdout: 'Nothing to deploy: no workflow in ./workflows.\n', stderr: '' });
  });

  test('Should exit 1 and send nothing when a stable name is invalid or duplicated', async () => {
    // Given
    const files = [
      file('workflows/Bad_Name.json', 'Bad'),
      file('workflows/a/sync.json', 'Sync'),
      file('workflows/sync.workflow.ts', 'Sync again'),
    ];
    const ctx = context({ loadWorkflowFiles: () => Promise.resolve(files) });

    // When
    const result = await deployCommand.run(TEXT, ctx);

    // Then
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Invalid workflow files. Nothing was sent to n8n.');
    expect(result.stderr).toContain('✗ workflows/Bad_Name.json  stable name "Bad_Name"');
    expect(result.stderr).toContain(
      '✗ workflows/sync.workflow.ts  stable name "sync" is also used by workflows/a/sync.json',
    );
  });

  test('Should exit 1 with the same message as ping when the configuration is missing', async () => {
    // Given
    const ctx = context({ env: {}, loadWorkflowFiles: () => Promise.resolve(FILES) });

    // When
    const result = await deployCommand.run(TEXT, ctx);

    // Then
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Missing N8N_URL and N8N_API_KEY.');
    expect(result.stderr).toContain('  N8N_URL=https://your-n8n.example.com\n');
  });

  test('Should show what deploy would do and write nothing with --dry-run', async () => {
    // Given
    const n8n = fakeN8n({
      workflows: [
        stored('crm1', 'crm-import', 'CRM import (old)'),
        stored('rep1', 'daily-report', 'Daily report'),
      ],
    });
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve(FILES) });

    // When
    const result = await deployCommand.run(DRY_RUN, ctx);

    // Then
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(`n8nlift deploy --dry-run → https://n8n.example.com
~ would update  crm-import     workflows/crm/crm-import.json (draft; published version still running)
= would skip    daily-report   unchanged
+ would create  invoice-sync   workflows/invoice-sync.workflow.ts
Would: 1 create, 1 update, 0 restore, 1 skip, 0 fail.
Dry run: nothing was written. Run n8nlift deploy to apply.
n8n can still reject a write; this preview covers what reads can show.
`);
    expect(n8n.calls.every((call) => call.startsWith('GET '))).toBe(true);
    expect(n8n.workflows.map(({ id, name }) => [id, name])).toEqual([
      ['crm1', 'CRM import (old)'],
      ['rep1', 'Daily report'],
    ]);
  });

  test('Should print the same JSON report with dryRun true under --dry-run --json', async () => {
    // Given
    const n8n = fakeN8n({ workflows: [stored('rep1', 'daily-report', 'Daily report', { isArchived: true })] });
    const files = [file('workflows/daily-report.json', 'Daily report'), file('workflows/new.json', 'New')];
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve(files) });

    // When
    const result = await deployCommand.run(DRY_RUN_JSON, ctx);

    // Then
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
    expect(n8n.calls.every((call) => call.startsWith('GET '))).toBe(true);
  });

  test('Should exit 5 under --dry-run when a workflow would fail', async () => {
    // Given
    const n8n = fakeN8n({
      workflows: [stored('a', 'daily-report', 'Daily report'), stored('b', 'daily-report', 'Daily report')],
    });
    const files = [file('workflows/daily-report.json', 'Daily report')];
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve(files) });

    // When
    const result = await deployCommand.run(DRY_RUN, ctx);

    // Then
    expect(result.exitCode).toBe(5);
    expect(result.stdout).toContain('✗ would fail    daily-report   GET /api/v1/workflows → workflows a and b both carry the tag n8nlift:daily-report\n');
    expect(result.stdout).toContain('Would: 0 create, 0 update, 0 restore, 0 skip, 1 fail.\n');
    expect(result.stderr).toBe(`Would fail: daily-report.
Next: fix each failure with the hint under its line, then run deploy again.
`);
  });

  test('Should exit 6 and show the blocker under --dry-run when the instance cannot save drafts', async () => {
    // Given
    const n8n = fakeN8n({ spec: { status: 404 } });
    const ctx = context({ fetch: n8n.fetch, loadWorkflowFiles: () => Promise.resolve(FILES) });

    // When
    const result = await deployCommand.run(DRY_RUN, ctx);

    // Then
    expect(result.exitCode).toBe(6);
    expect(result.stdout).toBe('n8nlift deploy --dry-run → https://n8n.example.com\n');
    expect(result.stderr).toContain('✗ GET /api/v1/openapi.yml → HTTP 404: n8n 2.35.0 or later is required');
    expect(result.stderr).toContain('Nothing was written to n8n.');
  });

  test('Should say there is nothing to deploy under --dry-run when ./workflows is empty', async () => {
    // Given
    const ctx = context({});

    // When
    const text = await deployCommand.run(DRY_RUN, ctx);
    const json = await deployCommand.run(DRY_RUN_JSON, ctx);

    // Then
    expect(text).toEqual({ exitCode: 0, stdout: 'Nothing to deploy: no workflow in ./workflows.\n', stderr: '' });
    expect(JSON.parse(json.stdout)).toMatchObject({ dryRun: true, results: [], exitCode: 0 });
  });

  test('Should list --dry-run in the usage and options the help is generated from', () => {
    // Given
    const { usage, options } = deployCommand;

    // When
    const dryRun = options['dry-run'];

    // Then
    expect(usage).toContain('n8nlift deploy [--dry-run] [--json]');
    expect(usage).toContain('It exits with the same codes as a real deploy.');
    expect(dryRun).toEqual({ type: 'boolean', description: 'Show what deploy would do; write nothing' });
  });
});
