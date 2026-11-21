import { ConnectedTarget, CommandDefinition, Deps } from '#src/cli/cli.model';
import {
  DeployFormat,
  renderInvalidFiles,
  renderInvalidLockFile,
  renderNothingToDeploy,
  renderReport,
  renderSharedEntries,
} from '#src/cli/commands/deploy/deploy.render';
import { defineCommand } from '#src/cli/define-command';
import { TargetRun, renderConfigError, renderTargets } from '#src/cli/targets.render';
import { CREDENTIALS_DIR, credentialsFilePath, targetCredentials } from '#src/core/compile/credential-lists';
import { CredentialEntry, CredentialsFile } from '#src/core/compile/credential.model';
import { WorkflowFile } from '#src/core/compile/workflow.model';
import { loadWorkflows } from '#src/core/compile/load-workflows';
import {
  EXIT_API_KEY_REJECTED,
  EXIT_CREDENTIALS_MISSING,
  EXIT_CREDENTIAL_SCOPE_MISSING,
  EXIT_DRAFTS_UNSUPPORTED,
  EXIT_LOCK_WRITE_FAILED,
  EXIT_OK,
  EXIT_PARTIAL_FAILURE,
  EXIT_UNREACHABLE,
  EXIT_USAGE,
} from '#src/core/common/exit-codes';
import { err, ok } from '#src/core/common/result';
import { ProjectConfig } from '#src/core/config/config.model';
import { CONFIG_FILE, checkWorkflowFolders, targetTagName } from '#src/core/config/project-config';
import { deploy, previewDeploy } from '#src/core/deliver/deploy';
import { DeployInput, DeployReport } from '#src/core/deliver/deploy.model';
import { LOCK_FILE, lockWriter, managedIds, parseLockFile } from '#src/core/deliver/lock-file';
import { LockWriter } from '#src/core/deliver/lock-file.model';
import { findSharedEntries } from '#src/core/deliver/shared-entries';
import { CREDENTIAL_LIST_SCOPE, MIN_N8N_VERSION } from '#src/core/n8n/n8n-api';

const DESCRIPTION = `Delivers every workflow in the workflows folder of a target of ./${CONFIG_FILE}
(*.workflow.ts with a default export, or *.json), pasted from an n8n export, to its n8n instance:
  new workflows are created (never published) and their n8n ids recorded in ./${LOCK_FILE},
  changed workflows are updated as drafts: the published version keeps running until
  lift publish publishes them,
  unchanged workflows are skipped,
  workflows deleted (archived) in the n8n editor are restored as unpublished drafts.
The stable name is the file name without .workflow.ts / .json: 1 to 64 of a-z, 0-9 and -.
Each delivered workflow also gets the tag boilerlift:<target>, for display in n8n only; set
tag: false on the target in ./${CONFIG_FILE} to turn it off. A tag failure is only a warning.

${LOCK_FILE} records, for each instance (the url of a target), the n8n id of each stable name. Deploy finds
your workflows by these ids only: never by name or tag, and it never touches a workflow it does
not record. Commit the file after each deploy that changes it, so the next deploy, from any
machine, updates the same workflows. A recorded id that n8n no longer has (deleted for good)
is created again from code, and the new id recorded.

Nothing is written until the instance proves it saves drafts (n8n ${MIN_N8N_VERSION} or later).
A failure on one workflow fails only that workflow; the others are still delivered.
With --all, every target is checked first (config, API key, folder), and if one is broken nothing
is written. Then a failed target does not stop the next ones. Two targets on the same instance
whose folders hold the same stable name would share one entry of ${LOCK_FILE}: deploy refuses
them before writing.

A node that picks a credential with credential('key') gets the n8n id and name of that key in
./${credentialsFilePath('<target>')}, the list lift creds sync writes for the target deployed to.
Before writing, deploy checks each id on the instance. A key the list lacks, an id gone from the
instance or a type changed there stops that target before anything is written: run
lift creds sync on the target, or create the credential in n8n. A credential renamed in n8n
still resolves. Only the key, name, type and id are read, never a secret.

--dry-run reads the instance and shows what deploy would create, update, restore, skip or fail,
and any blocker, without writing anything. It exits with the same codes as a real deploy.`;

export const deployCommand: CommandDefinition = defineCommand({
  name: 'deploy',
  summary: 'Deliver your workflows to your n8n instance as drafts',
  help: {
    description: DESCRIPTION,
    exitCodes: [
      [EXIT_OK, 'Every workflow delivered, or nothing to deploy'],
      [
        EXIT_USAGE,
        `Usage error, missing or invalid ${CONFIG_FILE}, unknown target, missing API key or workflows folder, targets sharing a workflow on one instance, or invalid workflow files`,
      ],
      [EXIT_UNREACHABLE, 'The n8n instance cannot be reached'],
      [EXIT_API_KEY_REJECTED, 'The API key is rejected'],
      [EXIT_PARTIAL_FAILURE, 'At least one workflow failed; the others were delivered'],
      [EXIT_DRAFTS_UNSUPPORTED, `The instance is older than n8n ${MIN_N8N_VERSION}: nothing was written`],
      [EXIT_LOCK_WRITE_FAILED, `A workflow was created but ${LOCK_FILE} could not be written: the run stopped there`],
      [EXIT_CREDENTIALS_MISSING, 'Workflows use credentials the target does not provide: nothing was written to it'],
      [EXIT_CREDENTIAL_SCOPE_MISSING, `Workflows use credential(), and the API key lacks the ${CREDENTIAL_LIST_SCOPE} scope: nothing was written to the target`],
    ],
  },
  allowPositionals: false,
  options: {
    'dry-run': { type: 'boolean', description: 'Show what deploy would do; write nothing', mode: true },
    json: { type: 'boolean', description: 'Print the report as JSON', format: true },
  },
  needs: ['targets', 'isDirectory', 'loadCredentialsFiles', 'loadWorkflowFiles', 'readLockFile', 'writeLockFile'],
  prepare: async ({ format }, { targets: { config, selected }, isDirectory, loadCredentialsFiles, loadWorkflowFiles }) => {
    const folders = await checkWorkflowFolders(config, [...selected], isDirectory);
    if (!folders.ok) {
      return err(renderConfigError(folders.error, format));
    }
    // The lists first: importing them gives credential() its types when the workflow files run it.
    const credentials = await loadCredentialsFiles(CREDENTIALS_DIR);
    const files = await loadDeclaredFiles(config, loadWorkflowFiles);
    const shared = findSharedEntries(
      selected.map(({ name }) => name),
      config.targets.map((target) => ({ target: target.name, instance: target.url, paths: (files.get(target.workflows) ?? []).map(({ path }) => path) })),
    );
    return shared.length > 0 ? err(renderSharedEntries(shared, format)) : ok({ files, credentials });
  },
  modes: {
    'dry-run': (project, deps, { target }) =>
      eachTarget(project, deps, { dryRun: true, named: target.kind !== 'default' }, previewDeploy),
  },
  default: (project, deps, { target }) => eachTarget(project, deps, { dryRun: false, named: target.kind !== 'default' }, deploy),
  render: (runs, { format, target }) => renderTargets(runs, { json: format.json, all: target.kind === 'all' }),
});

/** The workflow files of every declared target, by folder, each folder read once. A missing folder reads as empty. */
async function loadDeclaredFiles(
  config: ProjectConfig,
  loadWorkflowFiles: (dir: string) => Promise<WorkflowFile[]>,
): Promise<Map<string, WorkflowFile[]>> {
  const files = new Map<string, WorkflowFile[]>();
  for (const { workflows } of config.targets) {
    if (!files.has(workflows)) {
      files.set(workflows, await loadWorkflowFiles(workflows));
    }
  }
  return files;
}

type TargetDeps = Deps<'targets' | 'readLockFile' | 'writeLockFile'>;

/** What prepare read: the workflow files of every declared target, by folder, and the credential lists of the project. */
interface Project {
  files: Map<string, WorkflowFile[]>;
  credentials: CredentialsFile[];
}

/** Runs `run` (a deploy, or a dry run) on each selected target in turn; a failed target does not stop the next ones. */
async function eachTarget(
  { files, credentials }: Project,
  deps: TargetDeps,
  format: DeployFormat,
  run: (input: DeployInput, writer: LockWriter) => Promise<DeployReport>,
): Promise<TargetRun[]> {
  const runs: TargetRun[] = [];
  for (const target of deps.targets.selected) {
    runs.push(await deployTarget(target, files.get(target.workflows) ?? [], targetCredentials(credentials, target.name), deps, format, run));
  }
  return runs;
}

/**
 * Deploys, or plans, the files of one target, resolving their credential() markers through `credentials`, the list of
 * the target. The lock file is read again for each target.
 */
async function deployTarget(
  target: ConnectedTarget,
  files: WorkflowFile[],
  credentials: CredentialEntry[],
  { readLockFile, writeLockFile }: TargetDeps,
  format: DeployFormat,
  run: (input: DeployInput, writer: LockWriter) => Promise<DeployReport>,
): Promise<TargetRun> {
  const instance = target.connection.url.value;
  const where = { name: target.name, instance };
  const loaded = loadWorkflows(files);
  if (!loaded.ok) {
    return renderInvalidFiles(where, loaded.error);
  }
  const workflows = loaded.value;
  if (workflows.length === 0) {
    return renderNothingToDeploy(where, target.workflows, format);
  }
  const lock = parseLockFile(await readLockFile(LOCK_FILE));
  if (!lock.ok) {
    return renderInvalidLockFile(where, lock.error);
  }
  const input: DeployInput = {
    workflows,
    client: target.client,
    managed: managedIds(lock.value, instance),
    target: target.name,
    credentials,
    ...(target.tag ? { targetTag: targetTagName(target.name) } : {}),
  };
  return renderReport(where, await run(input, lockWriter(lock.value, instance, (text) => writeLockFile(LOCK_FILE, text))), format);
}
