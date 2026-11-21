import { Result } from '#src/core/common/result';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

/** Reads the text of a success answer into a value, or says why it cannot (the `invalid-response` detail). */
export type BodyReader<T> = (text: string) => Result<T, string>;

/** Checks one JSON value, and says what it expects so that a mismatch can be reported. */
export interface JsonParser<T> {
  /** What the value should be, for the `invalid-response` detail: `a workflow`. */
  expected: string;
  parse: (value: unknown) => T | undefined;
}

export interface GetOptions<T> {
  headers?: Record<string, string>;
  /** Reads the answer body: `jsonBody(parser)` or `textBody`. */
  response: BodyReader<T>;
}

export interface SendOptions<T> extends GetOptions<T> {
  /** Sent as JSON, with its `content-type`. Leave it out for a request without a body. */
  body?: unknown;
}

/** An answer with a success status, with its body read. `call` names the request: `GET /healthz`. */
export interface HttpAnswer<T> {
  call: string;
  status: number;
  body: T;
}

/**
 * Why a request failed.
 * - `unreachable`: no answer, or a network error, described for a person in `reason`.
 * - `http-error`: an error status, with the `message` field of a JSON error body when there is one.
 * - `invalid-response`: a success status whose body the reader rejected.
 */
export type HttpFailure =
  | { kind: 'unreachable'; call: string; reason: string }
  | { kind: 'http-error'; call: string; status: number; message?: string }
  | { kind: 'invalid-response'; call: string; status: number; detail: string };

export interface HttpOptions {
  fetch: typeof fetch;
  timeoutMs?: number;
}

/** Sends requests over HTTP and reads their answers. It knows nothing of the service behind the URL. */
export interface Http {
  getRequest: <T>(url: string, options: GetOptions<T>) => Promise<Result<HttpAnswer<T>, HttpFailure>>;
  postRequest: <T>(url: string, options: SendOptions<T>) => Promise<Result<HttpAnswer<T>, HttpFailure>>;
  putRequest: <T>(url: string, options: SendOptions<T>) => Promise<Result<HttpAnswer<T>, HttpFailure>>;
  deleteRequest: <T>(url: string, options: GetOptions<T>) => Promise<Result<HttpAnswer<T>, HttpFailure>>;
}
