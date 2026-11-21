import { UNKNOWN_CREDENTIAL_TYPE, findCredentialUses, isCredentialMarker } from '#src/core/compile/credential';
import { credentialsFilePath } from '#src/core/compile/credential-lists';
import { CredentialEntry, CredentialUse } from '#src/core/compile/credential.model';
import { LocalWorkflow, WorkflowNode } from '#src/core/compile/workflow.model';
import { isRecord } from '#src/core/common/is-record';
import { Result, err, ok } from '#src/core/common/result';
import { describeFailure } from '#src/core/deliver/deploy-failure';
import { DeployError, DeployInput, UnresolvedCredential } from '#src/core/deliver/deploy.model';
import { CREDENTIAL_LIST_SCOPE } from '#src/core/n8n/n8n-api';
import { N8nCredential } from '#src/core/n8n/n8n.model';

/**
 * The workflows with each `credential('key')` marker replaced by the n8n `{ id, name }` of `key` in the credential
 * list of the target, under the type that list gives it. Reads only. When no workflow uses a marker, it makes no call.
 * Otherwise it lists the credentials of the instance once (every page), and fails before any write when the API key
 * cannot list them (403), or when a key is missing on the target: not in its list, its id gone from the instance, or
 * its type changed there. A credential renamed in n8n keeps its id: it resolves, under its current name.
 */
export async function resolveCredentials({ workflows, client, target, credentials }: DeployInput): Promise<Result<LocalWorkflow[], DeployError>> {
  const uses = findCredentialUses(workflows.map((workflow) => ({ path: workflow.path, content: workflow })));
  if (uses.length === 0) {
    return ok(workflows);
  }
  const listed = await client.listCredentials();
  if (!listed.ok) {
    const failure = listed.error;
    if (failure.kind === 'http-error' && failure.status === 403) {
      return err({
        kind: 'credential-scope-missing',
        call: failure.call,
        detail: `HTTP 403${failure.message === undefined ? '' : `: ${failure.message}`}: the API key lacks the ${CREDENTIAL_LIST_SCOPE} scope`,
        hint: `Give the API key of the target the ${CREDENTIAL_LIST_SCOPE} scope in n8n → Settings → n8n API, or create a key that has it, then run deploy again`,
      });
    }
    return err(describeFailure(failure));
  }
  const live = new Map(listed.value.body.map((credential) => [credential.id, credential]));
  const byKey = new Map(credentials.map((entry) => [entry.key, entry]));
  const missing = unresolved(uses, byKey, live);
  if (missing.length > 0) {
    const file = credentialsFilePath(target);
    return err({
      kind: 'credentials-missing',
      call: listed.value.call,
      detail: `${missing.length} ${missing.length === 1 ? 'credential' : 'credentials'} missing on target ${target}: ${missing.map(({ key }) => key).join(', ')}`,
      hint: `Run lift creds sync --target ${target} to update ${file}, or create the missing credentials in n8n first, then run deploy again`,
      missing,
    });
  }
  return ok(workflows.map((workflow) => ({ ...workflow, nodes: workflow.nodes.map((node) => resolveNode(node, byKey, live)) })));
}

/** The credential of `entry` on the instance, when the instance still has its id under the same type. */
function liveOf(entry: CredentialEntry, live: ReadonlyMap<string, N8nCredential>): N8nCredential | undefined {
  const credential = live.get(entry.id);
  return credential !== undefined && credential.type === entry.type ? credential : undefined;
}

/** Each key the uses pick that does not resolve, with its type, its reason and the workflows that use it, sorted by key. */
function unresolved(
  uses: readonly CredentialUse[],
  byKey: ReadonlyMap<string, CredentialEntry>,
  live: ReadonlyMap<string, N8nCredential>,
): UnresolvedCredential[] {
  const missing = new Map<string, UnresolvedCredential>();
  for (const use of uses) {
    const entry = byKey.get(use.key);
    if (entry !== undefined && liveOf(entry, live) !== undefined) {
      continue;
    }
    const found = missing.get(use.key) ?? describeMissing(use, entry, live);
    if (!found.workflows.includes(use.workflow)) {
      found.workflows.push(use.workflow);
    }
    missing.set(use.key, found);
  }
  return [...missing.values()]
    .map((entry) => ({ ...entry, workflows: [...entry.workflows].sort(compare) }))
    .sort((a, b) => compare(a.key, b.key));
}

function describeMissing(use: CredentialUse, entry: CredentialEntry | undefined, live: ReadonlyMap<string, N8nCredential>): UnresolvedCredential {
  if (entry === undefined) {
    return { key: use.key, type: use.type === UNKNOWN_CREDENTIAL_TYPE ? undefined : use.type, workflows: [], reason: 'not-listed' };
  }
  return { key: use.key, type: entry.type, id: entry.id, workflows: [], reason: live.has(entry.id) ? 'type-changed' : 'gone' };
}

/** The node with each marker of its `credentials` replaced by `{ [type]: { id, name } }`. Other entries are kept. */
function resolveNode(node: WorkflowNode, byKey: ReadonlyMap<string, CredentialEntry>, live: ReadonlyMap<string, N8nCredential>): WorkflowNode {
  if (!isRecord(node.credentials)) {
    return node;
  }
  const entries = Object.entries(node.credentials).map(([type, value]): [string, unknown] => {
    const entry = isCredentialMarker(value) ? byKey.get(value.key) : undefined;
    const credential = entry === undefined ? undefined : liveOf(entry, live);
    return credential === undefined ? [type, value] : [credential.type, { id: credential.id, name: credential.name }];
  });
  return { ...node, credentials: Object.fromEntries(entries) };
}

/** A comparison that does not depend on the locale, so the report reads the same on every machine. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
