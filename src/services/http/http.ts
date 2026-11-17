import { isRecord } from '#src/core/common/is-record';
import { err, ok } from '#src/core/common/result';
import { Http, HttpOptions, HttpRequest, HttpResult } from '#src/services/http/http.model';

export const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * The HTTP transport: one `fetch` per request, cut off after `timeoutMs`. An error status comes back with its body
 * text, and a network error with a reason a person can act on.
 */
export function createHttp({ fetch, timeoutMs = DEFAULT_TIMEOUT_MS }: HttpOptions): Http {
  const send = async ({ method, url, call, headers = {}, body }: HttpRequest): Promise<HttpResult> => {
    try {
      const response = await fetch(url, {
        method,
        headers: {
          accept: 'application/json',
          ...headers,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await response.text();
      if (response.ok) {
        return ok({ call, status: response.status, body: text });
      }
      return err({ kind: 'http-error', call, status: response.status, body: text });
    } catch (error) {
      return err({ kind: 'unreachable', call, reason: describeNetworkError(error, timeoutMs) });
    }
  };
  return { send };
}

function describeNetworkError(error: unknown, timeoutMs: number): string {
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return `no answer after ${timeoutMs / 1000} s (timeout)`;
  }
  const code = errorCode(error);
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return 'host not found (DNS)';
  }
  if (code === 'ECONNREFUSED') {
    return 'connection refused';
  }
  if (code === 'ECONNRESET') {
    return 'connection reset';
  }
  if (code !== undefined && /^(CERT_|UNABLE_TO_|DEPTH_ZERO|SELF_SIGNED|ERR_TLS)/.test(code)) {
    return `TLS error (${code})`;
  }
  if (code !== undefined) {
    return `network error (${code})`;
  }
  if (error instanceof Error && error.cause instanceof Error && error.cause.message !== '') {
    return `${error.message}: ${error.cause.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

/** `fetch` wraps the system error in `cause`; read its `code` when there is one. */
function errorCode(error: unknown): string | undefined {
  const cause = error instanceof Error ? error.cause : undefined;
  for (const candidate of [cause, error]) {
    if (isRecord(candidate) && typeof candidate.code === 'string') {
      return candidate.code;
    }
  }
  return undefined;
}
