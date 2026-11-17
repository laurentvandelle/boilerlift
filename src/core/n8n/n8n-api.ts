// What Boilerlift relies on in the n8n public API: where it lives, how an update lands as a draft and since which n8n
// version (ADR 0003), and what its error statuses mean.

/** Where the public API lives on the instance. */
export const API_PATH = '/api/v1';

/** The query parameter that makes an update land as a draft. Its presence in the API spec means drafts are supported. */
export const DRAFT_PARAM = 'publishIfActive';

/** The first n8n version whose public API takes DRAFT_PARAM. */
export const MIN_N8N_VERSION = '2.35.0';

/** The next step when the instance rejects the API key. */
export const API_KEY_HINT = 'Create a key in n8n → Settings → n8n API, then set N8N_API_KEY in .env';

/** What an HTTP error from the public API means: the API key is rejected (401, 403), nothing is there (404), or other. */
export function classifyHttpError(status: number): 'key-rejected' | 'not-found' | 'other' {
  if (status === 401 || status === 403) {
    return 'key-rejected';
  }
  return status === 404 ? 'not-found' : 'other';
}
