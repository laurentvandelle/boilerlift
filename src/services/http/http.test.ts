import { describe, expect, test } from 'vitest';
import { createHttp } from '#src/services/http/http';
import { HttpRequest } from '#src/services/http/http.model';

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

function networkError(code: string): Error {
  return new TypeError('fetch failed', { cause: Object.assign(new Error(code), { code }) });
}

const GET: HttpRequest = { method: 'GET', url: 'https://example.com/items?limit=1', call: 'GET /items' };

describe('createHttp', () => {
  test('Should return the status and body text when the answer has a success status', async () => {
    const { fetch, calls } = fakeFetch(() => Promise.resolve(new Response('{"a":1}', { status: 200 })));

    const result = await createHttp({ fetch }).send(GET);

    expect(result).toEqual({ ok: true, value: { call: 'GET /items', status: 200, body: '{"a":1}' } });
    expect(calls[0]?.url).toBe('https://example.com/items?limit=1');
    expect(calls[0]?.init?.headers).toEqual({ accept: 'application/json' });
    expect(calls[0]?.init?.signal).toBeInstanceOf(AbortSignal);
  });

  test('Should send the body as JSON with its content type when the request has a body', async () => {
    const { fetch, calls } = fakeFetch(() => Promise.resolve(new Response('', { status: 201 })));

    await createHttp({ fetch }).send({ method: 'POST', url: 'https://example.com/items', call: 'POST /items', headers: { 'x-key': 'k' }, body: { name: 'a' } });

    expect(calls[0]?.init?.method).toBe('POST');
    expect(calls[0]?.init?.headers).toEqual({ accept: 'application/json', 'x-key': 'k', 'content-type': 'application/json' });
    expect(calls[0]?.init?.body).toBe('{"name":"a"}');
  });

  test('Should return an http-error with the body text when the answer has an error status', async () => {
    const { fetch } = fakeFetch(() => Promise.resolve(new Response('{"message":"nope"}', { status: 404 })));

    const result = await createHttp({ fetch }).send(GET);

    expect(result).toEqual({ ok: false, error: { kind: 'http-error', call: 'GET /items', status: 404, body: '{"message":"nope"}' } });
  });

  test.each([
    ['ENOTFOUND', 'host not found (DNS)'],
    ['ECONNREFUSED', 'connection refused'],
    ['ECONNRESET', 'connection reset'],
    ['SELF_SIGNED_CERT_IN_CHAIN', 'TLS error (SELF_SIGNED_CERT_IN_CHAIN)'],
    ['EPIPE', 'network error (EPIPE)'],
  ])('Should report the host unreachable when fetch fails with %s', async (code, reason) => {
    const { fetch } = fakeFetch(() => Promise.reject(networkError(code)));

    const result = await createHttp({ fetch }).send(GET);

    expect(result).toEqual({ ok: false, error: { kind: 'unreachable', call: 'GET /items', reason } });
  });

  test('Should report the cause when a network error has no code', async () => {
    const { fetch } = fakeFetch(() => Promise.reject(new TypeError('fetch failed', { cause: new Error('bad port') })));

    const result = await createHttp({ fetch }).send(GET);

    expect(result).toEqual({ ok: false, error: { kind: 'unreachable', call: 'GET /items', reason: 'fetch failed: bad port' } });
  });

  test('Should report the host unreachable when no answer comes before the timeout', async () => {
    const fetch = (_input: string | URL | Request, init?: RequestInit): Promise<Response> =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const reason: unknown = init.signal?.reason;
          reject(reason instanceof Error ? reason : new Error(String(reason)));
        });
      });

    const result = await createHttp({ fetch, timeoutMs: 5 }).send(GET);

    expect(result).toEqual({ ok: false, error: { kind: 'unreachable', call: 'GET /items', reason: 'no answer after 0.005 s (timeout)' } });
  });
});
