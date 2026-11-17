import { describe, expect, test } from 'vitest';
import { isRecord } from '#src/core/common/is-record';
import { createHttp, jsonBody, textBody } from '#src/services/http/http';
import { JsonParser } from '#src/services/http/http.model';

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

function answering(body: string, status = 200): { fetch: typeof fetch; calls: Call[] } {
  return fakeFetch(() => Promise.resolve(new Response(body, { status })));
}

function networkError(code: string): Error {
  return new TypeError('fetch failed', { cause: Object.assign(new Error(code), { code }) });
}

const ITEMS_URL = 'https://example.com/items?limit=1';

const itemParser: JsonParser<{ a: number }> = {
  expected: 'an item',
  parse: (value) => (isRecord(value) && typeof value.a === 'number' ? { a: value.a } : undefined),
};

describe('createHttp', () => {
  test('Should send a GET with the given headers and name the call by its path when it gets a URL', async () => {
    const { fetch, calls } = answering('ok');

    const result = await createHttp({ fetch }).getRequest(ITEMS_URL, { headers: { 'x-key': 'k' }, response: textBody });

    expect(result).toEqual({ ok: true, value: { call: 'GET /items', status: 200, body: 'ok' } });
    expect(calls[0]?.url).toBe(ITEMS_URL);
    expect(calls[0]?.init?.method).toBe('GET');
    expect(calls[0]?.init?.headers).toEqual({ accept: 'application/json', 'x-key': 'k' });
    expect(calls[0]?.init?.signal).toBeInstanceOf(AbortSignal);
  });

  test('Should send the body as JSON with its content type when it posts a body', async () => {
    const { fetch, calls } = answering('', 201);

    await createHttp({ fetch }).postRequest('https://example.com/items', { body: { name: 'a' }, response: textBody });

    expect(calls[0]?.init?.method).toBe('POST');
    expect(calls[0]?.init?.headers).toEqual({ accept: 'application/json', 'content-type': 'application/json' });
    expect(calls[0]?.init?.body).toBe('{"name":"a"}');
  });

  test('Should send a PUT without a content type when it puts no body', async () => {
    const { fetch, calls } = answering('');

    const result = await createHttp({ fetch }).putRequest('https://example.com/items/1', { response: textBody });

    expect(result).toEqual({ ok: true, value: { call: 'PUT /items/1', status: 200, body: '' } });
    expect(calls[0]?.init?.headers).toEqual({ accept: 'application/json' });
    expect(calls[0]?.init?.body).toBeUndefined();
  });

  test('Should return the parsed body when a JSON answer matches its parser', async () => {
    const { fetch } = answering('{"a":1}');

    const result = await createHttp({ fetch }).getRequest(ITEMS_URL, { response: jsonBody(itemParser) });

    expect(result).toEqual({ ok: true, value: { call: 'GET /items', status: 200, body: { a: 1 } } });
  });

  test('Should report an invalid response when a success answer is not JSON', async () => {
    const { fetch } = answering('<html>');

    const result = await createHttp({ fetch }).getRequest(ITEMS_URL, { response: jsonBody(itemParser) });

    expect(result).toEqual({
      ok: false,
      error: { kind: 'invalid-response', call: 'GET /items', status: 200, detail: 'the body is not JSON' },
    });
  });

  test('Should report an invalid response naming what it expects when the JSON does not match its parser', async () => {
    const { fetch } = answering('42');

    const result = await createHttp({ fetch }).getRequest(ITEMS_URL, { response: jsonBody(itemParser) });

    expect(result).toEqual({
      ok: false,
      error: { kind: 'invalid-response', call: 'GET /items', status: 200, detail: 'the body is not an item' },
    });
  });

  test('Should keep the message of the body when the answer has an error status', async () => {
    const { fetch } = answering('{"message":"nope"}', 404);

    const result = await createHttp({ fetch }).getRequest(ITEMS_URL, { response: textBody });

    expect(result).toEqual({ ok: false, error: { kind: 'http-error', call: 'GET /items', status: 404, message: 'nope' } });
  });

  test('Should report an http-error without a message when the error body has none', async () => {
    const { fetch } = answering('', 500);

    const result = await createHttp({ fetch }).getRequest(ITEMS_URL, { response: textBody });

    expect(result).toEqual({ ok: false, error: { kind: 'http-error', call: 'GET /items', status: 500 } });
  });

  test.each([
    ['ENOTFOUND', 'host not found (DNS)'],
    ['ECONNREFUSED', 'connection refused'],
    ['ECONNRESET', 'connection reset'],
    ['SELF_SIGNED_CERT_IN_CHAIN', 'TLS error (SELF_SIGNED_CERT_IN_CHAIN)'],
    ['EPIPE', 'network error (EPIPE)'],
  ])('Should report the host unreachable when fetch fails with %s', async (code, reason) => {
    const { fetch } = fakeFetch(() => Promise.reject(networkError(code)));

    const result = await createHttp({ fetch }).getRequest(ITEMS_URL, { response: textBody });

    expect(result).toEqual({ ok: false, error: { kind: 'unreachable', call: 'GET /items', reason } });
  });

  test('Should report the cause when a network error has no code', async () => {
    const { fetch } = fakeFetch(() => Promise.reject(new TypeError('fetch failed', { cause: new Error('bad port') })));

    const result = await createHttp({ fetch }).getRequest(ITEMS_URL, { response: textBody });

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

    const result = await createHttp({ fetch, timeoutMs: 5 }).getRequest(ITEMS_URL, { response: textBody });

    expect(result).toEqual({ ok: false, error: { kind: 'unreachable', call: 'GET /items', reason: 'no answer after 0.005 s (timeout)' } });
  });
});
