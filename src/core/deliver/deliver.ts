import { CREDENTIALS_DIR, targetCredentials } from '#src/core/compile/credential-lists';
import { loadWorkflows } from '#src/core/compile/load-workflows';
import { WorkflowFile } from '#src/core/compile/workflow.model';
import { Result, err, ok } from '#src/core/common/result';
import { ProjectConfig } from '#src/core/config/config.model';
import { targetTagName } from '#src/core/config/project-config';
import { DeliverInput, DeliverPorts, DeliverySourcePorts, DeliverySources, TargetDelivery } from '#src/core/deliver/deliver.model';
import { deploy, previewDeploy } from '#src/core/deliver/deploy';
import { DeployInput } from '#src/core/deliver/deploy.model';
import { SharedEntry, findSharedEntries } from '#src/core/deliver/shared-entries';
import { lockWriter, managedIds, readLock } from '#src/core/lock/lock-file';
import { ConnectedTarget } from '#src/core/n8n/n8n.model';

/**
 * Reads what deploy needs before any target runs: the credential lists first (importing them gives `credential()` its
 * types when the workflow files run it), then the workflow files of every declared target, each folder read once. Two
 * targets on one instance whose folders hold the same stable name would share one lock entry: deploy refuses them
 * before writing, when one of the two is selected.
 */
export async function loadDeliverySources(
  config: ProjectConfig,
  selected: readonly Pick<ConnectedTarget, 'name'>[],
  { loadCredentialsFiles, loadWorkflowFiles }: DeliverySourcePorts,
): Promise<Result<DeliverySources, SharedEntry[]>> {
  const credentials = await loadCredentialsFiles(CREDENTIALS_DIR);
  const files = new Map<string, WorkflowFile[]>();
  for (const { workflows } of config.targets) {
    if (!files.has(workflows)) {
      files.set(workflows, await loadWorkflowFiles(workflows));
    }
  }
  const shared = findSharedEntries(
    selected.map(({ name }) => name),
    config.targets.map((target) => ({ target: target.name, instance: target.url, paths: (files.get(target.workflows) ?? []).map(({ path }) => path) })),
  );
  return shared.length > 0 ? err(shared) : ok({ files, credentials });
}

/**
 * Deploys, or plans in `dry-run` mode, the files of each selected target in turn; a failed target does not stop the
 * next ones. Each target's `credential()` markers resolve through its own list, and the lock file is read again for each
 * target, so a target sees the ids the one before it recorded.
 */
export async function deliverTargets({ sources, targets, mode }: DeliverInput, ports: DeliverPorts): Promise<TargetDelivery[]> {
  const deliveries: TargetDelivery[] = [];
  for (const target of targets) {
    deliveries.push(await deliverTarget(target, sources, mode === 'dry-run', ports));
  }
  return deliveries;
}

async function deliverTarget(target: ConnectedTarget, { files, credentials }: DeliverySources, dryRun: boolean, { lock: store }: DeliverPorts): Promise<TargetDelivery> {
  const instance = target.connection.url.value;
  const loaded = loadWorkflows(files.get(target.workflows) ?? []);
  if (!loaded.ok) {
    return { kind: 'invalid-files', target, problems: loaded.error };
  }
  const workflows = loaded.value;
  if (workflows.length === 0) {
    return { kind: 'nothing-to-deploy', target };
  }
  const lock = await readLock(store);
  if (!lock.ok) {
    return { kind: 'invalid-lock-file', target, error: lock.error };
  }
  const input: DeployInput = {
    workflows,
    client: target.client,
    managed: managedIds(lock.value, instance),
    target: target.name,
    credentials: targetCredentials(credentials, target.name),
    ...(target.tag ? { targetTag: targetTagName(target.name) } : {}),
  };
  const report = dryRun ? await previewDeploy(input) : await deploy(input, lockWriter(lock.value, instance, (text) => store.write(text)));
  return { kind: 'report', target, report };
}
