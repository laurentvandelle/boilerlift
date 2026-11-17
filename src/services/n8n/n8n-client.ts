import { err, ok } from '#src/core/common/result';
import { API_PATH, DRAFT_PARAM } from '#src/core/n8n/n8n-api';
import { ApiResult, N8nClient, ProbeResult, WorkflowId } from '#src/core/n8n/n8n.model';
import { createHttp, jsonBody, textBody } from '#src/services/http/http';
import { HttpResult, JsonParser } from '#src/services/http/http.model';
import { N8nClientOptions } from '#src/services/n8n/n8n-client.model';
import {
  Page,
  pageParser,
  tagParser,
  tagsParser,
  workflowParser,
  workflowSummaryParser,
} from '#src/services/n8n/n8n-response';

const PAGE_LIMIT = 250;

/**
 * A minimal client for the n8n instance and its public API, over the HTTP transport of `services/http/`. Every JSON
 * body is read once, with the parsers of `n8n-response.ts`: a success status whose body does not match comes back as
 * an `invalid-response` failure.
 */
export function createN8nClient({ config, fetch, timeoutMs }: N8nClientOptions): N8nClient {
  const http = createHttp({ fetch, ...(timeoutMs === undefined ? {} : { timeoutMs }) });
  const root = config.url.value;
  const api = `${root}${API_PATH}`;
  const auth = { 'X-N8N-API-KEY': config.apiKey.value };

  /** A probe reads no body: any success status is an answer, whatever its body. */
  const probe = async (answer: Promise<HttpResult<string>>): Promise<ProbeResult> => {
    const result = await answer;
    if (result.ok) {
      return ok({ call: result.value.call, status: result.value.status });
    }
    const failure = result.error;
    switch (failure.kind) {
    case 'unreachable':
      return err(failure);
    case 'http-error':
      return err({ kind: 'http-error', call: failure.call, status: failure.status });
    case 'invalid-response':
      return ok({ call: failure.call, status: failure.status });
    }
  };

  const listAll = async <T>(url: string, item: JsonParser<T>): Promise<ApiResult<T[]>> => {
    const response = jsonBody(pageParser(item));
    const items: T[] = [];
    let cursor: string | undefined;
    let last: { call: string; status: number };
    do {
      const separator = url.includes('?') ? '&' : '?';
      const page: ApiResult<Page<T>> = await http.getRequest(
        `${url}${separator}limit=${PAGE_LIMIT}${cursor === undefined ? '' : `&cursor=${encodeURIComponent(cursor)}`}`,
        { headers: auth, response },
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

  const workflowUrl = (id: WorkflowId): string => `${api}/workflows/${encodeURIComponent(id)}`;

  return {
    checkHealth: () => probe(http.getRequest(`${root}/healthz`, { response: textBody })),
    checkApiKey: () => probe(http.getRequest(`${api}/workflows?limit=1`, { headers: auth, response: textBody })),
    // The spec is YAML: it stays text.
    readApiSpec: () => http.getRequest(`${api}/openapi.yml`, { response: textBody }),
    listWorkflows: () => listAll(`${api}/workflows?excludePinnedData=true`, workflowSummaryParser),
    getWorkflow: (id) => http.getRequest(workflowUrl(id), { headers: auth, response: jsonBody(workflowParser) }),
    createWorkflow: (body) =>
      http.postRequest(`${api}/workflows`, { headers: auth, body, response: jsonBody(workflowSummaryParser) }),
    updateWorkflow: (id, body) =>
      http.putRequest(`${workflowUrl(id)}?${DRAFT_PARAM}=false`, { headers: auth, body, response: jsonBody(workflowSummaryParser) }),
    unarchiveWorkflow: (id) =>
      http.postRequest(`${workflowUrl(id)}/unarchive`, { headers: auth, response: jsonBody(workflowSummaryParser) }),
    listTags: () => listAll(`${api}/tags`, tagParser),
    createTag: (name) => http.postRequest(`${api}/tags`, { headers: auth, body: { name }, response: jsonBody(tagParser) }),
    setWorkflowTags: (id, tagIds) =>
      http.putRequest(`${workflowUrl(id)}/tags`, {
        headers: auth,
        body: tagIds.map((tagId) => ({ id: tagId })),
        response: jsonBody(tagsParser),
      }),
  };
}
