import { isRecord } from '#src/core/common/is-record';
import { API_PATH } from '#src/core/n8n/n8n-api';
import { isTagId, isWorkflowId } from '#src/core/n8n/n8n-ids';
import {
  ApiAnswer,
  ApiFailure,
  N8nClient,
  N8nCredential,
  N8nListedWorkflow,
  N8nTag,
  N8nWorkflow,
  N8nWorkflowBody,
  ProbeAnswer,
  ProbeFailure,
  TagId,
  WorkflowId,
} from '#src/core/n8n/n8n.model';
import { Result, err, ok } from '#src/core/common/result';

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
  /**
   * The workflows on the instance (build them with fakeN8nWorkflow). `GET /workflows/{id}` returns each one, archived
   * ones included with `isArchived`, and answers 404 for any other id.
   */
  workflows?: N8nWorkflow[];
  /** More tags of the instance, that `GET /tags` lists. The tags of the seed workflows are listed too. */
  tags?: FakeTag[];
  /** The credentials of the instance, that `GET /credentials` lists (build them with fakeCredential). */
  credentials?: N8nCredential[];
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
  /** The tags the instance holds now. */
  tags: N8nTag[];
  /** The credentials the instance holds now: a test may change them between two calls. */
  credentials: N8nCredential[];
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

/** A credential of the instance: its type defaults to `httpHeaderAuth`, its id to `<name>-id`. */
export function fakeCredential(name: string, overrides: Partial<N8nCredential> = {}): N8nCredential {
  return { id: `${name}-id`, name, type: 'httpHeaderAuth', ...overrides };
}

/** A tag as the instance holds it. */
export function fakeTag({ id, name }: FakeTag): N8nTag {
  return { id: fakeTagId(id), name };
}

/**
 * The instance's copy of a delivered local workflow: the same content, with server-side node ids and a server
 * default setting. It carries no tag unless the test gives some, and its draft is the published version
 * (`<stableName>-v1`) unless the test gives other version ids.
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
    tags: (tags ?? []).map(fakeTag),
    isArchived: false,
    versionId: `${workflow.stableName}-v1`,
    activeVersionId: `${workflow.stableName}-v1`,
    ...overrides,
  };
}

export function fakeN8n({
  workflows: seed = [],
  tags: tagSeed = [],
  credentials: credentialSeed = [],
  spec = DRAFT_SPEC,
  failures = [],
}: FakeN8nOptions = {}): FakeN8n {
  const workflows = structuredClone(seed);
  const credentials = structuredClone(credentialSeed);
  const tags: N8nTag[] = [];
  for (const tag of [...tagSeed.map(fakeTag), ...workflows.flatMap((workflow) => workflow.tags)]) {
    if (!tags.some(({ id }) => id === tag.id)) {
      tags.push(structuredClone(tag));
    }
  }
  const calls: string[] = [];
  const requests: string[] = [];
  let lastId = 0;
  let lastVersion = 0;
  const newId = (prefix: string): string => `${prefix}${(lastId += 1)}`;
  const newVersion = (): string => `v${(lastVersion += 1)}`;
  const failureOf = (call: string): ApiFailure | undefined => failures.find((failure) => failure.call === call);

  /** Records the call, then answers it with its configured failure, or with what `perform` returns. */
  const answer = <T>(call: string, perform: (call: string) => Result<ApiAnswer<T>, ApiFailure>): Promise<Result<ApiAnswer<T>, ApiFailure>> => {
    calls.push(call);
    const failure = failureOf(call);
    return Promise.resolve(failure === undefined ? perform(call) : err(failure));
  };
  const onWorkflow = <T>(call: string, id: WorkflowId, perform: (workflow: N8nWorkflow) => T): Promise<Result<ApiAnswer<T>, ApiFailure>> =>
    answer(call, () => {
      const workflow = workflows.find((candidate) => candidate.id === id);
      return workflow === undefined ? err(httpError(call, 404, 'Not Found')) : answered(call, perform(workflow));
    });
  const probe = (call: string): Promise<Result<ProbeAnswer, ProbeFailure>> => {
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
    listWorkflows: () => answer(`GET ${API_PATH}/workflows`, (call) => answered(call, workflows.map(listed))),
    getWorkflow: (id) => onWorkflow(`GET ${API_PATH}/workflows/${id}`, id, (workflow) => structuredClone(workflow)),
    createWorkflow: (body) =>
      answer(`POST ${API_PATH}/workflows`, (call) => {
        // A new workflow is never published.
        const workflow: N8nWorkflow = {
          ...structuredClone(body),
          id: fakeWorkflowId(newId('w')),
          tags: [],
          isArchived: false,
          versionId: newVersion(),
          activeVersionId: null,
        };
        workflows.push(workflow);
        return answered(call, structuredClone(workflow));
      }),
    updateWorkflow: (id, body) =>
      // The change lands as a new draft version: the published version stays as it was.
      onWorkflow(`PUT ${API_PATH}/workflows/${id}`, id, (workflow) =>
        structuredClone(Object.assign(workflow, structuredClone(body), { versionId: newVersion() })),
      ),
    publishWorkflow: (id) =>
      // The current draft becomes the published version.
      onWorkflow(`POST ${API_PATH}/workflows/${id}/activate`, id, (workflow) => {
        workflow.activeVersionId = workflow.versionId;
        return structuredClone(workflow);
      }),
    archiveWorkflow: (id) =>
      onWorkflow(`POST ${API_PATH}/workflows/${id}/archive`, id, (workflow) => {
        workflow.isArchived = true;
        return structuredClone(workflow);
      }),
    unarchiveWorkflow: (id) =>
      onWorkflow(`POST ${API_PATH}/workflows/${id}/unarchive`, id, (workflow) => {
        workflow.isArchived = false;
        return structuredClone(workflow);
      }),
    deleteWorkflow: (id) =>
      // Gone for good: the next call on this id answers 404.
      onWorkflow(`DELETE ${API_PATH}/workflows/${id}`, id, (workflow) => {
        workflows.splice(workflows.indexOf(workflow), 1);
        return structuredClone(workflow);
      }),
    listCredentials: () => answer(`GET ${API_PATH}/credentials`, (call) => answered(call, structuredClone(credentials))),
    listTags: () => answer(`GET ${API_PATH}/tags`, (call) => answered(call, structuredClone(tags))),
    createTag: (name) =>
      answer(`POST ${API_PATH}/tags`, (call) => {
        if (tags.some((tag) => tag.name === name)) {
          return err(httpError(call, 409, 'Tag already exists'));
        }
        const tag: N8nTag = { id: fakeTagId(newId('t')), name };
        tags.push(tag);
        return answered(call, structuredClone(tag));
      }),
    updateWorkflowTags: (id, tagIds) => {
      const call = `PUT ${API_PATH}/workflows/${id}/tags`;
      return answer(call, () => {
        const workflow = workflows.find((candidate) => candidate.id === id);
        const chosen = tagIds.map((tagId) => tags.find((tag) => tag.id === tagId));
        if (workflow === undefined || chosen.some((tag) => tag === undefined)) {
          return err(httpError(call, 404, 'Not Found'));
        }
        workflow.tags = chosen.filter((tag): tag is N8nTag => tag !== undefined);
        return answered(call, structuredClone(workflow.tags));
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
    case 'POST workflows/{id}/activate':
      return respond(await client.publishWorkflow(id));
    case 'POST workflows/{id}/archive':
      return respond(await client.archiveWorkflow(id));
    case 'POST workflows/{id}/unarchive':
      return respond(await client.unarchiveWorkflow(id));
    case 'DELETE workflows/{id}':
      return respond(await client.deleteWorkflow(id));
    case 'PUT workflows/{id}/tags':
      return isTagIdList(body) ? respond(await client.updateWorkflowTags(id, body.map((tag) => tag.id))) : invalidBody();
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
      // The key check asks for one workflow and reads the status, never the body. Any other limit lists them.
      return url.searchParams.get('limit') === '1' ? respondToProbe(await client.checkApiKey()) : respondPage(await client.listWorkflows(), url);
    case 'POST workflows':
      return isWorkflowBody(body) ? respond(await client.createWorkflow(body)) : invalidBody();
    case 'GET credentials':
      return respondPage(await client.listCredentials(), url);
    case 'GET tags':
      // One page holds every tag: nextCursor is null.
      return respond(await client.listTags(), 'page');
    case 'POST tags':
      return isRecord(body) && typeof body.name === 'string' ? respond(await client.createTag(body.name)) : invalidBody();
    default:
      return noRoute(method, url);
    }
  };

  return { client, fetch: answerHttp, workflows, tags, credentials, calls, requests };
}

function answered<T>(call: string, body: T): Result<ApiAnswer<T>, ApiFailure> {
  return ok({ call, status: 200, body });
}

/**
 * An answer as n8n sends it: JSON, or a `{ data, nextCursor }` page of one. Unreachable becomes a network error, and
 * an invalid response a body that is not JSON.
 */
function respond<T>(result: Result<ApiAnswer<T>, ApiFailure>, shape: 'json' | 'page' = 'json'): Response {
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

/** One page of a list, as n8n pages it: `limit` items from the offset in `cursor`, then the cursor of the next page. */
function respondPage<T>(result: Result<ApiAnswer<T[]>, ApiFailure>, url: URL): Response {
  if (!result.ok) {
    return respond(result);
  }
  const { body, status } = result.value;
  const limit = Number(url.searchParams.get('limit') ?? '100');
  const offset = Number(url.searchParams.get('cursor') ?? '0');
  const next = offset + limit;
  return new Response(JSON.stringify({ data: body.slice(offset, next), nextCursor: next < body.length ? String(next) : null }), { status });
}

/** A workflow as the list shows it: without its content. */
function listed({ id, name, tags, isArchived, versionId, activeVersionId }: N8nWorkflow): N8nListedWorkflow {
  return structuredClone({ id, name, tags, isArchived, versionId, activeVersionId });
}

function respondToProbe(result: Result<ProbeAnswer, ProbeFailure>): Response {
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

/** The body of `PUT /workflows/{id}/tags`: a list of `{ id }`. */
function isTagIdList(value: unknown): value is { id: TagId }[] {
  return Array.isArray(value) && value.every((entry: unknown) => isRecord(entry) && isTagId(entry.id));
}

/**
 * A `fetch` for several instances at once: each request goes to the `fakeN8n` of its origin (`https://dev.example.com`).
 * A request to another origin is a bug in the test, so it throws.
 */
export function fakeN8nByOrigin(instances: Record<string, FakeN8n>): typeof fetch {
  return (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const { origin } = new URL(input instanceof Request ? input.url : input);
    const instance = instances[origin];
    if (instance === undefined) {
      return Promise.reject(new Error(`no fake n8n instance at ${origin}`));
    }
    return instance.fetch(input, init);
  };
}
