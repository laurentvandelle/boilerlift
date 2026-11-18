import { Result } from '#src/core/common/result';

/** A workflow id on the instance. Only the client's response parsing (isWorkflowId in n8n-ids.ts) produces one. */
export type WorkflowId = string & { readonly __brand: 'WorkflowId' };

/** A tag id on the instance. Only the client's response parsing (isTagId in n8n-ids.ts) produces one. */
export type TagId = string & { readonly __brand: 'TagId' };

/** A read-only check that went through. `call` names it, for example `GET /healthz`. */
export interface ProbeAnswer {
  call: string;
  status: number;
}

export type ProbeFailure =
  | { kind: 'unreachable'; call: string; reason: string }
  | { kind: 'http-error'; call: string; status: number };

/** A public API call that went through, with its parsed body. `call` names it, for example `PUT /api/v1/workflows/abc`. */
export interface ApiAnswer<T> {
  call: string;
  status: number;
  body: T;
}

/**
 * Why a public API call failed.
 * - `unreachable`: no answer, or a network error.
 * - `http-error`: an error status, with the n8n `message` when the body has one.
 * - `invalid-response`: a success status whose body is not what the n8n public API sends (not JSON, or another shape).
 */
export type ApiFailure =
  | { kind: 'unreachable'; call: string; reason: string }
  | { kind: 'http-error'; call: string; status: number; message?: string }
  | { kind: 'invalid-response'; call: string; status: number; detail: string };

export interface N8nTag {
  id: TagId;
  name: string;
}

/** A workflow as the public API returns it. The client defaults omitted `tags` to `[]` and `isArchived` to false. */
export interface N8nWorkflowSummary {
  id: WorkflowId;
  name: string;
  tags: N8nTag[];
  /** A workflow deleted in the editor is only archived: `GET /workflows/{id}` still returns it. */
  isArchived: boolean;
}

/** A workflow as `GET /api/v1/workflows/{id}` returns it: the top-level fields are the current draft. Omitted `settings` default to `{}`. */
export interface N8nWorkflow extends N8nWorkflowSummary {
  nodes: unknown[];
  connections: Record<string, unknown>;
  settings: Record<string, unknown>;
}

/** The fields Boilerlift writes on create and update. */
export interface N8nWorkflowBody {
  name: string;
  nodes: unknown[];
  connections: Record<string, unknown>;
  settings: Record<string, unknown>;
}

export interface N8nClient {
  /** `GET /healthz`: is the instance up and reachable? */
  checkHealth(): Promise<Result<ProbeAnswer, ProbeFailure>>;
  /** `GET /api/v1/workflows?limit=1` with `X-N8N-API-KEY`: does the public API accept the key? */
  checkApiKey(): Promise<Result<ProbeAnswer, ProbeFailure>>;
  /** `GET /api/v1/openapi.yml`, without the API key: the public API spec the instance serves, as text. */
  readApiSpec(): Promise<Result<ApiAnswer<string>, ApiFailure>>;
  /** `GET /api/v1/workflows/{id}`: the workflow and its current draft. An id the instance does not know answers 404. */
  getWorkflow(id: WorkflowId): Promise<Result<ApiAnswer<N8nWorkflow>, ApiFailure>>;
  /** `POST /api/v1/workflows`: the new workflow is never published. */
  createWorkflow(body: N8nWorkflowBody): Promise<Result<ApiAnswer<N8nWorkflowSummary>, ApiFailure>>;
  /** `PUT /api/v1/workflows/{id}?publishIfActive=false`: the change lands as a draft. */
  updateWorkflow(id: WorkflowId, body: N8nWorkflowBody): Promise<Result<ApiAnswer<N8nWorkflowSummary>, ApiFailure>>;
  /** `POST /api/v1/workflows/{id}/unarchive`: brings back an archived workflow. Needs the `workflow:delete` scope. */
  unarchiveWorkflow(id: WorkflowId): Promise<Result<ApiAnswer<N8nWorkflowSummary>, ApiFailure>>;
}
