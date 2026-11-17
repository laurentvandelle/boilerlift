import { isRecord } from '#src/core/common/is-record';
import { Result, err, ok } from '#src/core/common/result';
import { API_PATH, DRAFT_PARAM } from '#src/core/n8n/n8n-api';
import { ApiAnswer, ApiFailure, ApiResult, N8nClient, ProbeResult, WorkflowId } from '#src/core/n8n/n8n.model';
import { createHttp } from '#src/services/http/http';
import { HttpMethod } from '#src/services/http/http.model';
import { N8nClientOptions } from '#src/services/n8n/n8n-client.model';
import {
  BodyParser,
  Page,
  pageParser,
  tagParser,
  tagsParser,
  workflowParser,
  workflowSummaryParser,
} from '#src/services/n8n/n8n-response';

const HEALTH_PATH = '/healthz';
const API_KEY_PATH = `${API_PATH}/workflows?limit=1`;
const SPEC_PATH = `${API_PATH}/openapi.yml`;

const PAGE_LIMIT = 250;

/** What can go wrong before a body is parsed. */
type TransportFailure = Exclude<ApiFailure, { kind: 'invalid-response' }>;

/**
 * A minimal client for the n8n instance and its public API, over the HTTP transport of `services/http/`. Every JSON
 * body is parsed once, here: a success status whose body does not match comes back as an `invalid-response` failure.
 */
export function createN8nClient({ config, fetch, timeoutMs }: N8nClientOptions): N8nClient {
  const http = createHttp({ fetch, ...(timeoutMs === undefined ? {} : { timeoutMs }) });

  /** Sends one request to the instance. A success status comes back with the raw body text. */
  const request = async (
    method: HttpMethod,
    path: string,
    { body, auth = true }: { body?: unknown; auth?: boolean } = {},
  ): Promise<Result<ApiAnswer<string>, TransportFailure>> => {
    const result = await http.send({
      method,
      url: `${config.url.value}${path}`,
      call: `${method} ${path.split('?')[0] ?? path}`,
      headers: auth ? { 'X-N8N-API-KEY': config.apiKey.value } : {},
      ...(body === undefined ? {} : { body }),
    });
    if (result.ok) {
      return result;
    }
    const failure = result.error;
    switch (failure.kind) {
    case 'unreachable':
      return err(failure);
    case 'http-error': {
      const message = errorMessage(failure.body);
      return err({ kind: 'http-error', call: failure.call, status: failure.status, ...(message === undefined ? {} : { message }) });
    }
    }
  };

  /** Sends one request and parses its JSON body with `parser`. */
  const requestJson = async <T>(
    method: HttpMethod,
    path: string,
    parser: BodyParser<T>,
    options: { body?: unknown } = {},
  ): Promise<ApiResult<T>> => {
    const result = await request(method, path, options);
    if (!result.ok) {
      return result;
    }
    const { call, status, body: text } = result.value;
    const json = parseJson(text);
    const body = json.ok ? parser.parse(json.value) : undefined;
    if (body === undefined) {
      const detail = json.ok ? `the body is not ${parser.expected}` : 'the body is not JSON';
      return err({ kind: 'invalid-response', call, status, detail });
    }
    return ok({ call, status, body });
  };

  const probe = async (path: string, auth: boolean): Promise<ProbeResult> => {
    const result = await request('GET', path, { auth });
    if (result.ok) {
      return ok({ call: result.value.call, status: result.value.status });
    }
    const failure = result.error;
    switch (failure.kind) {
    case 'http-error':
      return err({ kind: 'http-error', call: failure.call, status: failure.status });
    case 'unreachable':
      return err(failure);
    }
  };

  const listAll = async <T>(path: string, item: BodyParser<T>): Promise<ApiResult<T[]>> => {
    const parser = pageParser(item);
    const items: T[] = [];
    let cursor: string | undefined;
    let last: { call: string; status: number };
    do {
      const separator = path.includes('?') ? '&' : '?';
      const page: ApiResult<Page<T>> = await requestJson(
        'GET',
        `${path}${separator}limit=${PAGE_LIMIT}${cursor === undefined ? '' : `&cursor=${encodeURIComponent(cursor)}`}`,
        parser,
      );
      if (!page.ok) {
        return page;
      }
      last = page.value;
      items.push(...page.value.body.data);
      cursor = page.value.body.nextCursor;
    } while (cursor !== undefined && cursor !== '');
    return ok({ call: last.call, status: last.status, body: items });
  };

  const workflowPath = (id: WorkflowId): string => `${API_PATH}/workflows/${encodeURIComponent(id)}`;

  return {
    checkHealth: () => probe(HEALTH_PATH, false),
    checkApiKey: () => probe(API_KEY_PATH, true),
    // The spec is YAML: it stays text.
    readApiSpec: () => request('GET', SPEC_PATH, { auth: false }),
    listWorkflows: () => listAll(`${API_PATH}/workflows?excludePinnedData=true`, workflowSummaryParser),
    getWorkflow: (id) => requestJson('GET', workflowPath(id), workflowParser),
    createWorkflow: (body) => requestJson('POST', `${API_PATH}/workflows`, workflowSummaryParser, { body }),
    updateWorkflow: (id, body) =>
      requestJson('PUT', `${workflowPath(id)}?${DRAFT_PARAM}=false`, workflowSummaryParser, { body }),
    unarchiveWorkflow: (id) => requestJson('POST', `${workflowPath(id)}/unarchive`, workflowSummaryParser),
    listTags: () => listAll(`${API_PATH}/tags`, tagParser),
    createTag: (name) => requestJson('POST', `${API_PATH}/tags`, tagParser, { body: { name } }),
    setWorkflowTags: (id, tagIds) =>
      requestJson('PUT', `${workflowPath(id)}/tags`, tagsParser, { body: tagIds.map((tagId) => ({ id: tagId })) }),
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

/** The `message` field of an n8n error body, when there is one. */
function errorMessage(text: string): string | undefined {
  const body = parseJson(text);
  if (body.ok && isRecord(body.value) && typeof body.value.message === 'string') {
    return body.value.message;
  }
  return undefined;
}
