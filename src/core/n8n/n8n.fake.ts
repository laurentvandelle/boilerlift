import { isRecord } from '#src/core/common/is-record';
import { API_PATH } from '#src/core/n8n/n8n-api';
import { isTagId, isWorkflowId } from '#src/core/n8n/n8n-ids';
import {
  ApiFailure,
  ApiResult,
  N8nClient,
  N8nTag,
  N8nWorkflow,
  N8nWorkflowBody,
  ProbeResult,
  TagId,
  WorkflowId,
} from '#src/core/n8n/n8n.model';
import { err, ok } from '#src/core/common/result';

/** An API spec that lists `publishIfActive`: the instance saves drafts (MIN_N8N_VERSION or later). */
const DRAFT_SPEC = 'paths:\n  /workflows/{id}:\n    put:\n      parameters:\n        - name: publishIfActive\n';

/** A tag as a test writes it: plain string ids, which the fake turns into `TagId`s. */
export interface FakeTag {
  id: string;
  name: string;
}

/** What a test overrides on an instance workflow: plain string ids, which the fake turns into branded ids. */
export type FakeWorkflowOverrides = Partial<Omit<N8nWorkflow, 'id' | 'tags'>> & { id?: string; tags?: FakeTag[] };

export interface FakeN8nOptions {
  /** The workflows on the instance (build them with fakeN8nWorkflow). The tags they carry are on its tag list too. */
  workflows?: N8nWorkflow[];
  /** Tags on the instance's tag list that no workflow carries. */
  tags?: FakeTag[];
  /** The API spec the instance serves. The default one supports drafts. */
  spec?: string;
  /**
   * Calls that fail every time they are made, each named by its `call` (build them with httpError, unreachable or
   * invalidResponse). Through `fetch`, an invalid response is a 2xx answer whose body is not JSON.
   */
  failures?: ApiFailure[];
}

/** An in-memory n8n instance with two doors onto one store: an `N8nClient` and a `fetch`. */
export interface FakeN8n {
  /** The instance behind the `N8nClient` port, for core tests. */
  client: N8nClient;
  /** The same instance behind HTTP, answering like the n8n public API, for command tests (`ctx.fetch`). */
  fetch: typeof fetch;
  /** The workflows the instance holds now. */
  workflows: N8nWorkflow[];
  /** The instance's tag list now. */
  tags: N8nTag[];
  /** Every call made through either door, named like `ApiFailure.call`: `PUT /api/v1/workflows/abc`. */
  calls: string[];
  /** Every request `fetch` received, as `METHOD URL` with the query string: `GET https://…/healthz`. */
  requests: string[];
}

/** A call that the instance answers with an HTTP error, optionally with an n8n error message. */
export function httpError(call: string, status: number, message?: string): ApiFailure {
  return { kind: 'http-error', call, status, ...(message === undefined ? {} : { message }) };
}

/** A call that never reaches the instance. `reason` is what the client reports, for example `connection refused`. */
export function unreachable(call: string, reason: string): ApiFailure {
  return { kind: 'unreachable', call, reason };
}

/** A call that the instance answers with a success status and a body that is not what n8n sends. */
export function invalidResponse(call: string, detail = 'the body is not JSON'): ApiFailure {
  return { kind: 'invalid-response', call, status: 200, detail };
}

/** `value` as a workflow id, through the same guard as the client's response parsing. Throws on an empty string. */
export function fakeWorkflowId(value: string): WorkflowId {
  if (!isWorkflowId(value)) {
    throw new Error(`"${value}" is not a workflow id`);
  }
  return value;
}

/** `value` as a tag id, through the same guard as the client's response parsing. Throws on an empty string. */
export function fakeTagId(value: string): TagId {
  if (!isTagId(value)) {
    throw new Error(`"${value}" is not a tag id`);
  }
  return value;
}

/** A tag as the instance holds it. */
export function fakeTag({ id, name }: FakeTag): N8nTag {
  return { id: fakeTagId(id), name };
}

/** The tag `n8nlift:{stableName}`, which identifies a workflow on the instance. */
export function fakeStableTag(stableName: string): N8nTag {
  return fakeTag({ id: `tag-${stableName}`, name: `n8nlift:${stableName}` });
}

/**
 * The instance's copy of a delivered local workflow: the same content, with server-side node ids and a server
 * default setting, tagged with its stable name.
 */
export function fakeN8nWorkflow(
  workflow: N8nWorkflowBody & { stableName: string },
  { id, tags, ...overrides }: FakeWorkflowOverrides = {},
): N8nWorkflow {
  return {
    id: fakeWorkflowId(id ?? `${workflow.stableName}-id`),
    name: workflow.name,
    nodes: workflow.nodes.map((node, index) => (isRecord(node) ? { ...node, id: `server-${index + 1}` } : node)),
    connections: structuredClone(workflow.connections),
    settings: { ...workflow.settings, redactionPolicy: 'none' },
    tags: tags === undefined ? [fakeStableTag(workflow.stableName)] : tags.map(fakeTag),
    isArchived: false,
    ...overrides,
  };
}

export function fakeN8n({ workflows: seed = [], tags: extraTags = [], spec = DRAFT_SPEC, failures = [] }: FakeN8nOptions = {}): FakeN8n {
  const workflows = structuredClone(seed);
  const allTags = [...workflows.flatMap((workflow) => workflow.tags), ...extraTags.map(fakeTag)];
  const tags = [...new Map(allTags.map((tag): [TagId, N8nTag] => [tag.id, tag])).values()];
  const calls: string[] = [];
  const requests: string[] = [];
  let lastId = 0;
  const newId = (prefix: string): string => `${prefix}${(lastId += 1)}`;
  const failureOf = (call: string): ApiFailure | undefined => failures.find((failure) => failure.call === call);

  /** Records the call, then answers it with its configured failure, or with what `perform` returns. */
  const answer = <T>(call: string, perform: (call: string) => ApiResult<T>): Promise<ApiResult<T>> => {
    calls.push(call);
    const failure = failureOf(call);
    return Promise.resolve(failure === undefined ? perform(call) : err(failure));
  };
  const onWorkflow = <T>(call: string, id: WorkflowId, perform: (workflow: N8nWorkflow) => T): Promise<ApiResult<T>> =>
    answer(call, () => {
      const workflow = workflows.find((candidate) => candidate.id === id);
      return workflow === undefined ? err(httpError(call, 404, 'Not Found')) : answered(call, perform(workflow));
    });
  const probe = (call: string): Promise<ProbeResult> => {
    calls.push(call);
    const failure = failureOf(call);
    switch (failure?.kind) {
    case undefined:
    case 'invalid-response':
      // A probe never reads the body.
      return Promise.resolve(ok({ call, status: 200 }));
    case 'http-error':
      return Promise.resolve(err({ kind: 'http-error', call, status: failure.status }));
    case 'unreachable':
      return Promise.resolve(err(failure));
    }
  };

  const client: N8nClient = {
    checkHealth: () => probe('GET /healthz'),
    checkApiKey: () => probe(`GET ${API_PATH}/workflows`),
    readApiSpec: () => answer(`GET ${API_PATH}/openapi.yml`, (call) => answered(call, spec)),
    listWorkflows: () =>
      answer(`GET ${API_PATH}/workflows`, (call) =>
        answered(call, workflows.map(({ id, name, tags: workflowTags, isArchived }) => ({ id, name, tags: structuredClone(workflowTags), isArchived }))),
      ),
    getWorkflow: (id) => onWorkflow(`GET ${API_PATH}/workflows/${id}`, id, (workflow) => structuredClone(workflow)),
    createWorkflow: (body) =>
      answer(`POST ${API_PATH}/workflows`, (call) => {
        const workflow: N8nWorkflow = { ...structuredClone(body), id: fakeWorkflowId(newId('w')), tags: [], isArchived: false };
        workflows.push(workflow);
        return answered(call, structuredClone(workflow));
      }),
    updateWorkflow: (id, body) =>
      onWorkflow(`PUT ${API_PATH}/workflows/${id}`, id, (workflow) => structuredClone(Object.assign(workflow, structuredClone(body)))),
    unarchiveWorkflow: (id) =>
      onWorkflow(`POST ${API_PATH}/workflows/${id}/unarchive`, id, (workflow) => {
        workflow.isArchived = false;
        return structuredClone(workflow);
      }),
    listTags: () => answer(`GET ${API_PATH}/tags`, (call) => answered(call, structuredClone(tags))),
    createTag: (name) =>
      answer(`POST ${API_PATH}/tags`, (call) => {
        if (tags.some((tag) => tag.name === name)) {
          return err(httpError(call, 409, 'Tag already exists'));
        }
        const tag = { id: fakeTagId(newId('t')), name };
        tags.push(tag);
        return answered(call, { ...tag });
      }),
    setWorkflowTags: (id, tagIds) => {
      const call = `PUT ${API_PATH}/workflows/${id}/tags`;
      const found = tagIds.flatMap((tagId) => tags.filter((tag) => tag.id === tagId));
      if (found.length !== tagIds.length) {
        return answer<N8nTag[]>(call, () => err(httpError(call, 404, 'Tag not found')));
      }
      return onWorkflow(call, id, (workflow) => {
        workflow.tags = found;
        return structuredClone(found);
      });
    },
  };

  /** Routes one HTTP request to the client door, then renders its answer as n8n would. */
  const answerHttp = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input);
    const method = init?.method ?? 'GET';
    requests.push(`${method} ${url.href}`);
    if (url.pathname === '/healthz') {
      return respondToProbe(await client.checkHealth());
    }
    if (!url.pathname.startsWith(`${API_PATH}/`)) {
      return noRoute(method, url);
    }
    const [resource = '', rawId = '', sub = '', ...rest] = url.pathname.slice(API_PATH.length + 1).split('/').map(decodeURIComponent);
    if (rest.length > 0) {
      return noRoute(method, url);
    }
    const id = isWorkflowId(rawId) ? rawId : undefined;
    const body = parseBody(init);
    if (id === undefined) {
      return answerCollection(`${method} ${resource}${sub === '' ? '' : `/${sub}`}`, body, method, url);
    }
    switch (`${method} ${resource}/{id}${sub === '' ? '' : `/${sub}`}`) {
    case 'GET workflows/{id}':
      return respond(await client.getWorkflow(id));
    case 'PUT workflows/{id}':
      return isWorkflowBody(body) ? respond(await client.updateWorkflow(id, body)) : invalidBody();
    case 'POST workflows/{id}/unarchive':
      return respond(await client.unarchiveWorkflow(id));
    case 'PUT workflows/{id}/tags':
      return respond(await client.setWorkflowTags(id, tagIdsOf(body)));
    default:
      return noRoute(method, url);
    }
  };

  /** Routes a request with no workflow id in its path. */
  const answerCollection = async (route: string, body: unknown, method: string, url: URL): Promise<Response> => {
    switch (route) {
    case 'GET openapi.yml': {
      const spec = await client.readApiSpec();
      return spec.ok ? new Response(spec.value.body, { status: spec.value.status }) : respond(spec);
    }
    case 'GET workflows':
      return respond(await client.listWorkflows(), 'page');
    case 'POST workflows':
      return isWorkflowBody(body) ? respond(await client.createWorkflow(body)) : invalidBody();
    case 'GET tags':
      return respond(await client.listTags(), 'page');
    case 'POST tags':
      return isRecord(body) && typeof body.name === 'string' ? respond(await client.createTag(body.name)) : invalidBody();
    default:
      return noRoute(method, url);
    }
  };

  return { client, fetch: answerHttp, workflows, tags, calls, requests };
}

function answered<T>(call: string, body: T): ApiResult<T> {
  return ok({ call, status: 200, body });
}

/**
 * An answer as n8n sends it: JSON, or a `{ data, nextCursor }` page of one. Unreachable becomes a network error, and
 * an invalid response a body that is not JSON.
 */
function respond<T>(result: ApiResult<T>, shape: 'json' | 'page' = 'json'): Response {
  if (result.ok) {
    const { body, status } = result.value;
    return new Response(JSON.stringify(shape === 'page' ? { data: body, nextCursor: null } : body), { status });
  }
  const failure = result.error;
  switch (failure.kind) {
  case 'http-error':
    return new Response(failure.message === undefined ? '' : JSON.stringify({ message: failure.message }), { status: failure.status });
  case 'invalid-response':
    return new Response('<html>not the n8n API</html>', { status: failure.status });
  case 'unreachable':
    // A plain Error: the client reports its message as the reason, so `reason` comes back unchanged.
    throw new Error(failure.reason);
  }
}

function respondToProbe(result: ProbeResult): Response {
  if (result.ok) {
    return new Response('{"status":"ok"}', { status: result.value.status });
  }
  const failure = result.error;
  switch (failure.kind) {
  case 'http-error':
    return new Response('', { status: failure.status });
  case 'unreachable':
    throw new Error(failure.reason);
  }
}

function noRoute(method: string, url: URL): Response {
  return new Response(JSON.stringify({ message: `The fake n8n has no route for ${method} ${url.pathname}` }), { status: 404 });
}

function invalidBody(): Response {
  return new Response(JSON.stringify({ message: 'request/body is invalid' }), { status: 400 });
}

function parseBody(init: RequestInit | undefined): unknown {
  if (typeof init?.body !== 'string') {
    return undefined;
  }
  const parsed: unknown = JSON.parse(init.body);
  return parsed;
}

function isWorkflowBody(value: unknown): value is N8nWorkflowBody {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    Array.isArray(value.nodes) &&
    isRecord(value.connections) &&
    isRecord(value.settings)
  );
}

/** The ids of a `PUT /workflows/{id}/tags` body, `[{ id }]`. */
function tagIdsOf(body: unknown): TagId[] {
  const items: unknown[] = Array.isArray(body) ? body : [];
  return items.flatMap((item) => {
    const id = isRecord(item) ? item.id : undefined;
    return isTagId(id) ? [id] : [];
  });
}
