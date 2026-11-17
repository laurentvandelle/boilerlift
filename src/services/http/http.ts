import { isRecord } from '#src/core/common/is-record';
import { Result, err, ok } from '#src/core/common/result';
import {
  BodyReader,
  Http,
  HttpAnswer,
  HttpFailure,
  HttpMethod,
  HttpOptions,
  JsonParser,
  SendOptions,
} from '#src/services/http/http.model';

export const DEFAULT_TIMEOUT_MS = 10_000;

/** Keeps the body as text, for an answer that is not JSON or whose body does not matter. */
export const textBody: BodyReader<string> = (text) => ok(text);

/** Reads a JSON body and checks it with `parser`. An empty body is the value `undefined`. */
export function jsonBody<T>(parser: JsonParser<T>): BodyReader<T> {
  return (text) => {
    const json = parseJson(text);
    if (!json.ok) {
      return err('the body is not JSON');
    }
    const value = parser.parse(json.value);
    return value === undefined ? err(`the body is not ${parser.expected}`) : ok(value);
  };
}

/**
 * The HTTP transport: one `fetch` per request, cut off after `timeoutMs`. A success answer comes back with its body
 * read by `response`, an error status with the `message` of its body, and a network error with a reason a person can
 * act on.
 */
export function createHttp({ fetch, timeoutMs = DEFAULT_TIMEOUT_MS }: HttpOptions): Http {
  const send = async <T>(method: HttpMethod, url: string, { headers = {}, body, response: read }: SendOptions<T>): Promise<Result<HttpAnswer<T>, HttpFailure>> => {
    const call = `${method} ${URL.canParse(url) ? new URL(url).pathname : url}`;
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
      const status = response.status;
      if (!response.ok) {
        const message = errorMessage(text);
        return err({ kind: 'http-error', call, status, ...(message === undefined ? {} : { message }) });
      }
      const value = read(text);
      return value.ok ? ok({ call, status, body: value.value }) : err({ kind: 'invalid-response', call, status, detail: value.error });
    } catch (error) {
      return err({ kind: 'unreachable', call, reason: describeNetworkError(error, timeoutMs) });
    }
  };

  return {
    getRequest: (url, options) => send('GET', url, options),
    postRequest: (url, options) => send('POST', url, options),
    putRequest: (url, options) => send('PUT', url, options),
  };
}

/** The JSON value of a body, or an error when it is not JSON. An empty body is `undefined`. */
function parseJson(text: string): Result<unknown, 'not-json'> {
  if (text === '') {
    return ok(undefined);
  }
  try {
    const value: unknown = JSON.parse(text);
    return ok(value);
  } catch {
    return err('not-json');
  }
}

/** The `message` field of a JSON error body, when there is one. */
function errorMessage(text: string): string | undefined {
  const body = parseJson(text);
  if (body.ok && isRecord(body.value) && typeof body.value.message === 'string') {
    return body.value.message;
  }
  return undefined;
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
