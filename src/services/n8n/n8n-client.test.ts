import { describe, expect, test } from 'vitest';
import { ConnectionConfig } from '#src/core/config/config.model';
import { createN8nClient } from '#src/services/n8n/n8n-client';
import { fakeTagId, fakeWorkflowId } from '#src/core/n8n/n8n.fake';

const CONFIG: ConnectionConfig = {
  url: { value: 'https://n8n.example.com', source: 'boilerlift.config.ts' },
  apiKey: { value: 'secret', source: 'boilerlift.config.ts' },
};

interface Call {
  url: string;
  init: RequestInit | undefined;
}

function fakeFetch(answer: () => Promise<Response>): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ url: input instanceof Request ? input.url : input.toString(), init });
    return answer();
  };
  return { fetch, calls };
}

/** The JSON body of a recorded call, parsed. */
function sentBody(call: Call | undefined): unknown {
  const body = call?.init?.body;
  return typeof body === 'string' ? JSON.parse(body) : undefined;
}

const ABC = fakeWorkflowId('abc');

function networkError(code: string): Error {
  return new TypeError('fetch failed', { cause: Object.assign(new Error(code), { code }) });
}

describe('createN8nClient', () => {
  test('Should call GET /healthz without the API key when it checks health', async () => {
    const { fetch, calls } = fakeFetch(() => Promise.resolve(new Response('{}', { status: 200 })));
    const client = createN8nClient({ config: CONFIG, fetch });

    const result = await client.checkHealth();

    expect(result).toEqual({ ok: true, value: { call: 'GET /healthz', status: 200 } });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://n8n.example.com/healthz');
    expect(calls[0]?.init?.method).toBe('GET');
    expect(calls[0]?.init?.headers).not.toHaveProperty('X-N8N-API-KEY');
  });

  test('Should send the API key to the workflows endpoint when it checks the key', async () => {
    const { fetch, calls } = fakeFetch(() => Promise.resolve(new Response('{"data":[]}', { status: 200 })));
    const client = createN8nClient({ config: CONFIG, fetch });

    const result = await client.checkApiKey();

    expect(result).toEqual({ ok: true, value: { call: 'GET /api/v1/workflows', status: 200 } });
    expect(calls[0]?.url).toBe('https://n8n.example.com/api/v1/workflows?limit=1');
    expect(calls[0]?.init?.method).toBe('GET');
    expect(calls[0]?.init?.headers).toMatchObject({ 'X-N8N-API-KEY': 'secret' });
    expect(calls[0]?.init?.signal).toBeInstanceOf(AbortSignal);
  });

  test.each([[401], [404], [500]])('Should report an http-error when the key check gets HTTP %s', async (status) => {
    const { fetch } = fakeFetch(() => Promise.resolve(new Response('', { status })));
    const client = createN8nClient({ config: CONFIG, fetch });

    const result = await client.checkApiKey();

    expect(result).toEqual({ ok: false, error: { kind: 'http-error', call: 'GET /api/v1/workflows', status } });
  });

  test('Should report the instance unreachable when no answer comes before its timeout', async () => {
    const fetch = (_input: string | URL | Request, init?: RequestInit): Promise<Response> =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const reason: unknown = init.signal?.reason;
          reject(reason instanceof Error ? reason : new Error(String(reason)));
        });
      });
    const client = createN8nClient({ config: CONFIG, fetch, timeoutMs: 5 });

    const result = await client.checkHealth();

    expect(result).toEqual({
      ok: false,
      error: { kind: 'unreachable', call: 'GET /healthz', reason: 'no answer after 0.005 s (timeout)' },
    });
  });
});

describe('createN8nClient public API calls', () => {
  function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status });
  }

  test('Should read the API spec as text without the API key when the instance serves it', async () => {
    const spec = 'openapi: 3.0.0\npaths: {}\n';
    const { fetch, calls } = fakeFetch(() => Promise.resolve(new Response(spec, { status: 200 })));
    const client = createN8nClient({ config: CONFIG, fetch });

    const result = await client.readApiSpec();

    expect(result).toEqual({ ok: true, value: { call: 'GET /api/v1/openapi.yml', status: 200, body: spec } });
    expect(calls[0]?.url).toBe('https://n8n.example.com/api/v1/openapi.yml');
    expect(calls[0]?.init?.method).toBe('GET');
    expect(calls[0]?.init?.headers).not.toHaveProperty('X-N8N-API-KEY');
  });

  test('Should report an http-error when the API spec is missing', async () => {
    const { fetch } = fakeFetch(() => Promise.resolve(new Response('Not Found', { status: 404 })));
    const client = createN8nClient({ config: CONFIG, fetch });

    const result = await client.readApiSpec();

    expect(result).toEqual({ ok: false, error: { kind: 'http-error', call: 'GET /api/v1/openapi.yml', status: 404 } });
  });

  test('Should POST with the API key and no body when it unarchives a workflow', async () => {
    const { fetch, calls } = fakeFetch(() => Promise.resolve(json({ id: 'abc', name: 'A', isArchived: false })));
    const client = createN8nClient({ config: CONFIG, fetch });

    const result = await client.unarchiveWorkflow(ABC);

    expect(result).toMatchObject({ ok: true, value: { body: { id: 'abc', name: 'A', tags: [], isArchived: false } } });
    expect(calls[0]?.url).toBe('https://n8n.example.com/api/v1/workflows/abc/unarchive');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(calls[0]?.init?.headers).toMatchObject({ 'X-N8N-API-KEY': 'secret' });
    expect(calls[0]?.init?.body).toBeUndefined();
  });

  test('Should send the update as a draft with publishIfActive=false when it updates a workflow', async () => {
    const { fetch, calls } = fakeFetch(() => Promise.resolve(json({ id: 'abc', name: 'A' })));
    const client = createN8nClient({ config: CONFIG, fetch });
    const body = { name: 'A', nodes: [], connections: {}, settings: {} };

    const result = await client.updateWorkflow(ABC, body);

    expect(result).toMatchObject({ ok: true, value: { call: 'PUT /api/v1/workflows/abc', body: { id: 'abc' } } });
    expect(calls[0]?.url).toBe('https://n8n.example.com/api/v1/workflows/abc?publishIfActive=false');
    expect(calls[0]?.init?.method).toBe('PUT');
    expect(calls[0]?.init?.headers).toMatchObject({ 'X-N8N-API-KEY': 'secret', 'content-type': 'application/json' });
    expect(sentBody(calls[0])).toEqual(body);
  });

  test('Should name the call and keep the n8n message when the instance answers an HTTP error', async () => {
    const { fetch } = fakeFetch(() => Promise.resolve(json({ message: 'request/body must have name' }, 400)));
    const client = createN8nClient({ config: CONFIG, fetch });

    const result = await client.createWorkflow({ name: '', nodes: [], connections: {}, settings: {} });

    expect(result).toEqual({
      ok: false,
      error: { kind: 'http-error', call: 'POST /api/v1/workflows', status: 400, message: 'request/body must have name' },
    });
  });

  test('Should name the call when the instance is unreachable', async () => {
    const { fetch } = fakeFetch(() => Promise.reject(networkError('ECONNREFUSED')));
    const client = createN8nClient({ config: CONFIG, fetch });

    const result = await client.getWorkflow(ABC);

    expect(result).toEqual({ ok: false, error: { kind: 'unreachable', call: 'GET /api/v1/workflows/abc', reason: 'connection refused' } });
  });

  test('Should default tags, isArchived and settings when a fetched workflow has none', async () => {
    const { fetch } = fakeFetch(() => Promise.resolve(json({ id: 'abc', name: 'A', nodes: [], connections: {} })));
    const client = createN8nClient({ config: CONFIG, fetch });

    const result = await client.getWorkflow(ABC);

    expect(result).toEqual({
      ok: true,
      value: {
        call: 'GET /api/v1/workflows/abc',
        status: 200,
        body: { id: 'abc', name: 'A', tags: [], isArchived: false, nodes: [], connections: {}, settings: {} },
      },
    });
  });

  test('Should report an invalid response when a success answer is not JSON', async () => {
    const { fetch } = fakeFetch(() => Promise.resolve(new Response('<html>Sign in to the proxy</html>', { status: 200 })));
    const client = createN8nClient({ config: CONFIG, fetch });

    const result = await client.getWorkflow(ABC);

    expect(result).toEqual({
      ok: false,
      error: { kind: 'invalid-response', call: 'GET /api/v1/workflows/abc', status: 200, detail: 'the body is not JSON' },
    });
  });

  test('Should report an http-error 404 when the instance does not know the workflow id', async () => {
    const { fetch } = fakeFetch(() => Promise.resolve(json({ message: 'Not Found' }, 404)));
    const client = createN8nClient({ config: CONFIG, fetch });

    const result = await client.getWorkflow(ABC);

    expect(result).toEqual({
      ok: false,
      error: { kind: 'http-error', call: 'GET /api/v1/workflows/abc', status: 404, message: 'Not Found' },
    });
  });

  test.each([
    ['has no id', { name: 'A', nodes: [], connections: {} }],
    ['has no nodes', { id: 'abc', name: 'A', connections: {} }],
    ['has a tag without an id', { id: 'abc', name: 'A', nodes: [], connections: {}, tags: [{ name: 'x' }] }],
  ])('Should report an invalid response when a fetched workflow %s', async (_condition, body) => {
    const { fetch } = fakeFetch(() => Promise.resolve(json(body)));
    const client = createN8nClient({ config: CONFIG, fetch });

    const result = await client.getWorkflow(ABC);

    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'invalid-response',
        call: 'GET /api/v1/workflows/abc',
        status: 200,
        detail: 'the body is not a workflow (id, name, nodes, connections)',
      },
    });
  });

  test('Should report an invalid response when a created workflow comes back without an id', async () => {
    const { fetch } = fakeFetch(() => Promise.resolve(json({ name: 'A' })));
    const client = createN8nClient({ config: CONFIG, fetch });

    const result = await client.createWorkflow({ name: 'A', nodes: [], connections: {}, settings: {} });

    expect(result).toMatchObject({ ok: false, error: { kind: 'invalid-response', call: 'POST /api/v1/workflows' } });
  });

  test('Should follow nextCursor and return every tag when it lists the tags', async () => {
    const pages = [
      { data: [{ id: 't1', name: 'dev', createdAt: '2026-01-01' }], nextCursor: 'next page' },
      { data: [{ id: 't2', name: 'prod' }], nextCursor: null },
    ];
    let page = 0;
    const { fetch, calls } = fakeFetch(() => Promise.resolve(json(pages[page++])));
    const client = createN8nClient({ config: CONFIG, fetch });

    const result = await client.listTags();

    expect(result).toEqual({
      ok: true,
      value: { call: 'GET /api/v1/tags', status: 200, body: [{ id: 't1', name: 'dev' }, { id: 't2', name: 'prod' }] },
    });
    expect(calls.map(({ url }) => url)).toEqual([
      'https://n8n.example.com/api/v1/tags?limit=250',
      'https://n8n.example.com/api/v1/tags?limit=250&cursor=next%20page',
    ]);
    expect(calls[0]?.init?.headers).toMatchObject({ 'X-N8N-API-KEY': 'secret' });
  });

  test('Should fail as an invalid response when a tag page has no data list', async () => {
    const { fetch } = fakeFetch(() => Promise.resolve(json({ nextCursor: null })));
    const client = createN8nClient({ config: CONFIG, fetch });

    const result = await client.listTags();

    expect(result).toMatchObject({ ok: false, error: { kind: 'invalid-response', call: 'GET /api/v1/tags' } });
  });

  test('Should post the name when it creates a tag', async () => {
    const { fetch, calls } = fakeFetch(() => Promise.resolve(json({ id: 't1', name: 'dev' }, 201)));
    const client = createN8nClient({ config: CONFIG, fetch });

    const result = await client.createTag('dev');

    expect(result).toEqual({ ok: true, value: { call: 'POST /api/v1/tags', status: 201, body: { id: 't1', name: 'dev' } } });
    expect(calls[0]?.url).toBe('https://n8n.example.com/api/v1/tags');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(sentBody(calls[0])).toEqual({ name: 'dev' });
  });

  test('Should put the list of tag ids when it sets the tags of a workflow', async () => {
    const { fetch, calls } = fakeFetch(() => Promise.resolve(json([{ id: 'h', name: 'hand-added' }, { id: 't1', name: 'dev' }])));
    const client = createN8nClient({ config: CONFIG, fetch });

    const result = await client.updateWorkflowTags(ABC, [fakeTagId('h'), fakeTagId('t1')]);

    expect(result).toEqual({
      ok: true,
      value: { call: 'PUT /api/v1/workflows/abc/tags', status: 200, body: [{ id: 'h', name: 'hand-added' }, { id: 't1', name: 'dev' }] },
    });
    expect(calls[0]?.url).toBe('https://n8n.example.com/api/v1/workflows/abc/tags');
    expect(calls[0]?.init?.method).toBe('PUT');
    expect(sentBody(calls[0])).toEqual([{ id: 'h' }, { id: 't1' }]);
  });
});
