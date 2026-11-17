import { Result } from '#src/core/common/result';

export type HttpMethod = 'GET' | 'POST' | 'PUT';

export interface HttpRequest {
  method: HttpMethod;
  url: string;
  /** Names the request in answers and failures, for example `GET /healthz`. */
  call: string;
  headers?: Record<string, string>;
  /** Sent as JSON, with its `content-type`. Leave it out for a request without a body. */
  body?: unknown;
}

/** An answer with a success status, with its body as text. */
export interface HttpAnswer {
  call: string;
  status: number;
  body: string;
}

/**
 * Why a request failed.
 * - `unreachable`: no answer, or a network error, described for a person in `reason`.
 * - `http-error`: an error status, with the body as text.
 */
export type HttpFailure =
  | { kind: 'unreachable'; call: string; reason: string }
  | { kind: 'http-error'; call: string; status: number; body: string };

export type HttpResult = Result<HttpAnswer, HttpFailure>;

export interface HttpOptions {
  fetch: typeof fetch;
  timeoutMs?: number;
}

/** Sends JSON requests over HTTP. It knows nothing of the service behind the URL. */
export interface Http {
  send: (request: HttpRequest) => Promise<HttpResult>;
}
