import { Result, err, ok } from '#src/core/common/result';
import { API_PATH, DRAFT_PARAM } from '#src/core/n8n/n8n-api';
import { N8nClient, ProbeAnswer, ProbeFailure, WorkflowId } from '#src/core/n8n/n8n.model';
import { createHttp, jsonBody, textBody } from '#src/services/http/http';
import { HttpAnswer, HttpFailure } from '#src/services/http/http.model';
import { N8nClientOptions } from '#src/services/n8n/n8n-client.model';
import { workflowParser, workflowSummaryParser } from '#src/services/n8n/n8n-response';

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

  const workflowUrl = (id: WorkflowId): string => `${api}/workflows/${encodeURIComponent(id)}`;

  return {
    checkHealth: () => probe(http.getRequest(`${root}/healthz`, { response: textBody })),
    checkApiKey: () => probe(http.getRequest(`${api}/workflows?limit=1`, { headers: auth, response: textBody })),
    // The spec is YAML: it stays text.
    readApiSpec: () => http.getRequest(`${api}/openapi.yml`, { response: textBody }),
    getWorkflow: (id) => http.getRequest(workflowUrl(id), { headers: auth, response: jsonBody(workflowParser) }),
    createWorkflow: (body) =>
      http.postRequest(`${api}/workflows`, { headers: auth, body, response: jsonBody(workflowSummaryParser) }),
    updateWorkflow: (id, body) =>
      http.putRequest(`${workflowUrl(id)}?${DRAFT_PARAM}=false`, { headers: auth, body, response: jsonBody(workflowSummaryParser) }),
    unarchiveWorkflow: (id) =>
      http.postRequest(`${workflowUrl(id)}/unarchive`, { headers: auth, response: jsonBody(workflowSummaryParser) }),
  };
}
