import { Result, err, ok } from '#src/core/common/result';
import { API_PATH, DRAFT_PARAM } from '#src/core/n8n/n8n-api';
import { ApiAnswer, ApiFailure, N8nClient, N8nCredential, N8nListedWorkflow, N8nTag, ProbeAnswer, ProbeFailure, WorkflowId } from '#src/core/n8n/n8n.model';
import { createHttp, jsonBody, textBody } from '#src/services/http/http';
import { HttpAnswer, HttpFailure } from '#src/services/http/http.model';
import { N8nClientOptions } from '#src/services/n8n/n8n-client.model';
import {
  credentialPageParser,
  tagListParser,
  tagPageParser,
  tagParser,
  workflowPageParser,
  workflowParser,
  workflowSummaryParser,
} from '#src/services/n8n/n8n-response';

/** The largest page `GET /api/v1/workflows` serves. */
export const LIST_PAGE_SIZE = 250;

/** The largest page `GET /tags` returns. */
const TAG_PAGE_LIMIT = 250;

/** The largest page `GET /credentials` returns. */
const CREDENTIAL_PAGE_LIMIT = 250;

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
  const probe = async (answer: Promise<Result<HttpAnswer<string>, HttpFailure>>): Promise<Result<ProbeAnswer, ProbeFailure>> => {
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

  /** Every page of `GET /workflows`, following `nextCursor`. Pinned data is left out: status reads no content there. */
  const listWorkflows = async (): Promise<Result<ApiAnswer<N8nListedWorkflow[]>, ApiFailure>> => {
    const workflows: N8nListedWorkflow[] = [];
    let cursor: string | null = null;
    for (;;) {
      const query = new URLSearchParams({ limit: String(LIST_PAGE_SIZE), excludePinnedData: 'true' });
      if (cursor !== null) {
        query.set('cursor', cursor);
      }
      const page = await http.getRequest(`${api}/workflows?${query.toString()}`, { headers: auth, response: jsonBody(workflowPageParser) });
      if (!page.ok) {
        return page;
      }
      workflows.push(...page.value.body.data);
      cursor = page.value.body.nextCursor;
      if (cursor === null) {
        return ok({ call: page.value.call, status: page.value.status, body: workflows });
      }
    }
  };

  const workflowUrl = (id: WorkflowId): string => `${api}/workflows/${encodeURIComponent(id)}`;

  /** Reads `GET /tags` page by page, following `nextCursor`. The first failure stops it. */
  const listTags = async (): Promise<Result<ApiAnswer<N8nTag[]>, ApiFailure>> => {
    const tags: N8nTag[] = [];
    let cursor: string | null = null;
    for (;;) {
      const query: string = `limit=${TAG_PAGE_LIMIT}${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`;
      const page = await http.getRequest(`${api}/tags?${query}`, { headers: auth, response: jsonBody(tagPageParser) });
      if (!page.ok) {
        return page;
      }
      tags.push(...page.value.body.data);
      cursor = page.value.body.nextCursor;
      if (cursor === null) {
        return ok({ call: page.value.call, status: page.value.status, body: tags });
      }
    }
  };

  /** Reads `GET /credentials` page by page, following `nextCursor`. The first failure stops it. */
  const listCredentials = async (): Promise<Result<ApiAnswer<N8nCredential[]>, ApiFailure>> => {
    const credentials: N8nCredential[] = [];
    let cursor: string | null = null;
    for (;;) {
      const query: string = `limit=${CREDENTIAL_PAGE_LIMIT}${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`;
      const page = await http.getRequest(`${api}/credentials?${query}`, { headers: auth, response: jsonBody(credentialPageParser) });
      if (!page.ok) {
        return page;
      }
      credentials.push(...page.value.body.data);
      cursor = page.value.body.nextCursor;
      if (cursor === null) {
        return ok({ call: page.value.call, status: page.value.status, body: credentials });
      }
    }
  };

  return {
    checkHealth: () => probe(http.getRequest(`${root}/healthz`, { response: textBody })),
    checkApiKey: () => probe(http.getRequest(`${api}/workflows?limit=1`, { headers: auth, response: textBody })),
    // The spec is YAML: it stays text.
    readApiSpec: () => http.getRequest(`${api}/openapi.yml`, { response: textBody }),
    listWorkflows,
    getWorkflow: (id) => http.getRequest(workflowUrl(id), { headers: auth, response: jsonBody(workflowParser) }),
    createWorkflow: (body) =>
      http.postRequest(`${api}/workflows`, { headers: auth, body, response: jsonBody(workflowSummaryParser) }),
    updateWorkflow: (id, body) =>
      http.putRequest(`${workflowUrl(id)}?${DRAFT_PARAM}=false`, { headers: auth, body, response: jsonBody(workflowSummaryParser) }),
    publishWorkflow: (id) =>
      http.postRequest(`${workflowUrl(id)}/activate`, { headers: auth, response: jsonBody(workflowSummaryParser) }),
    archiveWorkflow: (id) =>
      http.postRequest(`${workflowUrl(id)}/archive`, { headers: auth, response: jsonBody(workflowSummaryParser) }),
    unarchiveWorkflow: (id) =>
      http.postRequest(`${workflowUrl(id)}/unarchive`, { headers: auth, response: jsonBody(workflowSummaryParser) }),
    listCredentials,
    listTags,
    createTag: (name) => http.postRequest(`${api}/tags`, { headers: auth, body: { name }, response: jsonBody(tagParser) }),
    updateWorkflowTags: (id, tags) =>
      http.putRequest(`${workflowUrl(id)}/tags`, {
        headers: auth,
        body: tags.map((tagId) => ({ id: tagId })),
        response: jsonBody(tagListParser),
      }),
  };
}
