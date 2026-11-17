import { ApiFailure, ApiResult, N8nClient, N8nTag, N8nWorkflow, N8nWorkflowBody, ProbeResult } from '#src/core/n8n/n8n.model';

/** An API spec that lists `publishIfActive`: the instance saves drafts (n8n 2.35.0 or later). */
const DRAFT_SPEC = 'paths:\n  /workflows/{id}:\n    put:\n      parameters:\n        - name: publishIfActive\n';

export interface FakeN8nOptions {
  /** The workflows on the instance. The tags they carry are on its tag list too. */
  workflows?: N8nWorkflow[];
  /** Tags on the instance's tag list that no workflow carries. */
  tags?: N8nTag[];
  /** The API spec the instance serves. The default one supports drafts. */
  spec?: string;
  /** Calls that fail every time they are made, each named by its `call` (build them with httpError or unreachable). */
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

/** The tag `n8nlift:{stableName}`, which identifies a workflow on the instance. */
export function fakeStableTag(stableName: string): N8nTag {
  return { id: `tag-${stableName}`, name: `n8nlift:${stableName}` };
}

/**
 * The instance's copy of a delivered local workflow: the same content, with server-side node ids and a server
 * default setting, tagged with its stable name.
 */
export function fakeN8nWorkflow(
  workflow: N8nWorkflowBody & { stableName: string },
  overrides: Partial<N8nWorkflow> = {},
): N8nWorkflow {
  return {
    id: `${workflow.stableName}-id`,
    name: workflow.name,
    nodes: workflow.nodes.map((node, index) => (isRecord(node) ? { ...node, id: `server-${index + 1}` } : node)),
    connections: structuredClone(workflow.connections),
    settings: { ...workflow.settings, redactionPolicy: 'none' },
    tags: [fakeStableTag(workflow.stableName)],
    isArchived: false,
    ...overrides,
  };
}

export function fakeN8n({ workflows: seed = [], tags: extraTags = [], spec = DRAFT_SPEC, failures = [] }: FakeN8nOptions = {}): FakeN8n {
  const workflows = structuredClone(seed);
  const allTags = [...workflows.flatMap((workflow) => workflow.tags), ...structuredClone(extraTags)];
  const tags = [...new Map(allTags.map((tag): [string, N8nTag] => [tag.id, tag])).values()];
  const calls: string[] = [];
  const requests: string[] = [];
  let lastId = 0;
  const newId = (prefix: string): string => `${prefix}${(lastId += 1)}`;

  const answer = <T>(call: string, perform: () => ApiResult<T>): Promise<ApiResult<T>> => {
    calls.push(call);
    return Promise.resolve(failures.find((failure) => failure.call === call) ?? perform());
  };
  const onWorkflow = <T>(call: string, id: string, perform: (workflow: N8nWorkflow) => T): Promise<ApiResult<T>> =>
    answer(call, () => {
      const workflow = workflows.find((candidate) => candidate.id === id);
      return workflow === undefined ? httpError(call, 404, 'Not Found') : ok(perform(workflow));
    });
  const probe = async (call: string): Promise<ProbeResult> => {
    const result = await answer(call, () => ok(undefined));
    switch (result.kind) {
    case 'ok':
      return { kind: 'ok', status: result.status };
    case 'http-error':
      return { kind: 'http-error', status: result.status };
    case 'unreachable':
      return { kind: 'unreachable', reason: result.reason };
    }
  };

  const client: N8nClient = {
    checkHealth: () => probe('GET /healthz'),
    checkApiKey: () => probe('GET /api/v1/workflows'),
    readApiSpec: () => answer('GET /api/v1/openapi.yml', () => ok(spec)),
    listWorkflows: () =>
      answer('GET /api/v1/workflows', () =>
        ok(workflows.map(({ id, name, tags: workflowTags, isArchived }) => ({ id, name, tags: structuredClone(workflowTags), isArchived }))),
      ),
    getWorkflow: (id) => onWorkflow(`GET /api/v1/workflows/${id}`, id, (workflow) => structuredClone(workflow)),
    createWorkflow: (body) =>
      answer('POST /api/v1/workflows', () => {
        const workflow: N8nWorkflow = { ...structuredClone(body), id: newId('w'), tags: [], isArchived: false };
        workflows.push(workflow);
        return ok(structuredClone(workflow));
      }),
    updateWorkflow: (id, body) =>
      onWorkflow(`PUT /api/v1/workflows/${id}`, id, (workflow) => structuredClone(Object.assign(workflow, structuredClone(body)))),
    unarchiveWorkflow: (id) =>
      onWorkflow(`POST /api/v1/workflows/${id}/unarchive`, id, (workflow) => {
        workflow.isArchived = false;
        return structuredClone(workflow);
      }),
    listTags: () => answer('GET /api/v1/tags', () => ok(structuredClone(tags))),
    createTag: (name) =>
      answer('POST /api/v1/tags', () => {
        if (tags.some((tag) => tag.name === name)) {
          return httpError('POST /api/v1/tags', 409, 'Tag already exists');
        }
        const tag = { id: newId('t'), name };
        tags.push(tag);
        return ok({ ...tag });
      }),
    setWorkflowTags: (id, tagIds) => {
      const call = `PUT /api/v1/workflows/${id}/tags`;
      const found = tagIds.flatMap((tagId) => tags.filter((tag) => tag.id === tagId));
      if (found.length !== tagIds.length) {
        return answer<N8nTag[]>(call, () => httpError(call, 404, 'Tag not found'));
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
    const [api = '', version = '', resource = '', id = '', sub = '', ...rest] = url.pathname.split('/').slice(1).map(decodeURIComponent);
    if (api !== 'api' || version !== 'v1' || rest.length > 0) {
      return noRoute(method, url);
    }
    const body = parseBody(init);
    const route = `${method} ${resource}${id === '' ? '' : '/{id}'}${sub === '' ? '' : `/${sub}`}`;
    switch (route) {
    case 'GET openapi.yml': {
      const spec = await client.readApiSpec();
      return spec.kind === 'ok' ? new Response(spec.body, { status: spec.status }) : respond(spec);
    }
    case 'GET workflows':
      return respond(await client.listWorkflows(), 'page');
    case 'POST workflows':
      return isWorkflowBody(body) ? respond(await client.createWorkflow(body)) : invalidBody();
    case 'GET workflows/{id}':
      return respond(await client.getWorkflow(id));
    case 'PUT workflows/{id}':
      return isWorkflowBody(body) ? respond(await client.updateWorkflow(id, body)) : invalidBody();
    case 'POST workflows/{id}/unarchive':
      return respond(await client.unarchiveWorkflow(id));
    case 'PUT workflows/{id}/tags':
      return respond(await client.setWorkflowTags(id, tagIdsOf(body)));
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

function ok<T>(body: T): ApiResult<T> {
  return { kind: 'ok', status: 200, body };
}

/** An answer as n8n sends it: JSON, or a `{ data, nextCursor }` page of one. Unreachable becomes a network error. */
function respond<T>(result: ApiResult<T>, shape: 'json' | 'page' = 'json'): Response {
  switch (result.kind) {
  case 'ok':
    return new Response(JSON.stringify(shape === 'page' ? { data: result.body, nextCursor: null } : result.body), {
      status: result.status,
    });
  case 'http-error':
    return new Response(result.message === undefined ? '' : JSON.stringify({ message: result.message }), { status: result.status });
  case 'unreachable':
    // A plain Error: the client reports its message as the reason, so `reason` comes back unchanged.
    throw new Error(result.reason);
  }
}

function respondToProbe(result: ProbeResult): Response {
  switch (result.kind) {
  case 'ok':
    return new Response('{"status":"ok"}', { status: result.status });
  case 'http-error':
    return new Response('', { status: result.status });
  case 'unreachable':
    throw new Error(result.reason);
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
function tagIdsOf(body: unknown): string[] {
  const items: unknown[] = Array.isArray(body) ? body : [];
  return items.flatMap((item) => (isRecord(item) && typeof item.id === 'string' ? [item.id] : []));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
