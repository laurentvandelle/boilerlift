import { CommandContext, CommandDefinition } from '#src/cli/cli.model';
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
import { WorkflowFile } from '#src/core/compile/workflow.model';
import { loadWorkflows } from '#src/core/compile/load-workflows';
import { ProjectConfig, Target } from '#src/core/config/config.model';
import { CONFIG_FILE, checkWorkflowFolders, targetsToRun } from '#src/core/config/project-config';
import { planToReport } from '#src/core/deliver/apply-plan';
import { deploy } from '#src/core/deliver/deploy';
import { LOCK_FILE, lockWriter, managedIds, parseLockFile } from '#src/core/deliver/lock-file';
import { planDeploy } from '#src/core/deliver/plan-deploy';
import { findSharedEntries } from '#src/core/deliver/shared-entries';
import { MIN_N8N_VERSION } from '#src/core/n8n/n8n-api';
import { createN8nClient } from '#src/services/n8n/n8n-client';

const USAGE = `lift deploy [--target <name> | --all] [--dry-run] [--json]

Delivers every workflow in the workflows folder of a target of ./${CONFIG_FILE}
(*.workflow.ts with a default export, or *.json), pasted from an n8n export, to its n8n instance:
  new workflows are created (never published) and their n8n ids recorded in ./${LOCK_FILE},
  changed workflows are updated as drafts: the published version keeps running,
  unchanged workflows are skipped,
  workflows deleted (archived) in the n8n editor are restored as unpublished drafts.
The stable name is the file name without .workflow.ts / .json: 1 to 64 of a-z, 0-9 and -.

${LOCK_FILE} records, for each instance (the url of a target), the n8n id of each stable name. Deploy finds
your workflows by these ids only: never by name or tag, and it never touches a workflow it does
not record. Commit the file after each deploy that changes it, so the next deploy, from any
machine, updates the same workflows. A recorded id that n8n no longer has (deleted for good)
is created again from code, and the new id recorded.

Nothing is written until the instance proves it saves drafts (n8n ${MIN_N8N_VERSION} or later).
A failure on one workflow fails only that workflow; the others are still delivered.
Reads the targets and their API keys like lift ping. With one target declared, deploy runs on it.
With several, name one with --target, or deploy to every one in turn with --all: every target is
checked first (config, API key, folder), and if one is broken nothing is written. Then a failed
target does not stop the next ones. Two targets on the same instance whose folders hold the same
stable name would share one entry of ${LOCK_FILE}: deploy refuses them before writing.

--dry-run reads the instance and shows what deploy would create, update, restore, skip or fail,
and any blocker, without writing anything. It exits with the same codes as a real deploy.

Exit codes:
  0  Every workflow delivered, or nothing to deploy
  1  Usage error, missing or invalid ${CONFIG_FILE}, unknown target, missing API key or
     workflows folder, targets sharing a workflow on one instance, or invalid workflow files
  3  The n8n instance cannot be reached
  4  The API key is rejected
  5  At least one workflow failed; the others were delivered
  6  The instance is older than n8n ${MIN_N8N_VERSION}: nothing was written
  7  A workflow was created but ${LOCK_FILE} could not be written: the run stopped there
With --all, the exit code is the highest of the targets.`;

export const deployCommand: CommandDefinition = defineCommand({
  name: 'deploy',
  summary: 'Deliver your workflows to your n8n instance as drafts',
  usage: USAGE,
  allowPositionals: false,
  targets: true,
  options: {
    'dry-run': { type: 'boolean', description: 'Show what deploy would do; write nothing' },
    json: { type: 'boolean', description: 'Print the report as JSON' },
  },
  run: async (input, ctx) => {
    const format = { json: input.options.flag('json'), all: input.target.kind === 'all', dryRun: input.options.flag('dry-run') };
    const resolved = targetsToRun(await ctx.loadProjectConfig(), input.target);
    if (!resolved.ok) {
      return renderConfigError(resolved.error, format);
    }
    const { config, targets } = resolved.value;
    const folders = await checkWorkflowFolders(config, targets, (path) => ctx.isDirectory(path));
    if (!folders.ok) {
      return renderConfigError(folders.error, format);
    }
    const files = await loadDeclaredFiles(config, ctx);
    const shared = findSharedEntries(
      targets.map(({ name }) => name),
      config.targets.map((target) => ({ target: target.name, instance: target.url, paths: (files.get(target.workflows) ?? []).map(({ path }) => path) })),
    );
    if (shared.length > 0) {
      return renderSharedEntries(shared, format);
    }
    const runs: TargetRun[] = [];
    for (const target of targets) {
      runs.push(await deployTarget(target, files.get(target.workflows) ?? [], format, ctx));
    }
    return renderTargets(runs, format);
  },
});

/** The workflow files of every declared target, by folder, each folder read once. A missing folder reads as empty. */
async function loadDeclaredFiles(config: ProjectConfig, ctx: CommandContext): Promise<Map<string, WorkflowFile[]>> {
  const files = new Map<string, WorkflowFile[]>();
  for (const { workflows } of config.targets) {
    if (!files.has(workflows)) {
      files.set(workflows, await ctx.loadWorkflowFiles(workflows));
    }
  }
  return files;
}

/** Deploys, or plans with --dry-run, the files of one target. The lock file is read again for each target. */
async function deployTarget(target: Target, files: WorkflowFile[], format: DeployFormat, ctx: CommandContext): Promise<TargetRun> {
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
  const lock = parseLockFile(await ctx.readLockFile(LOCK_FILE));
  if (!lock.ok) {
    return renderInvalidLockFile(where, lock.error);
  }
  const client = createN8nClient({ config: target.connection, fetch: ctx.fetch });
  const deployInput = { workflows, client, managed: managedIds(lock.value, instance) };
  const writer = lockWriter(lock.value, instance, (text) => ctx.writeLockFile(LOCK_FILE, text));
  const report = format.dryRun ? planToReport(await planDeploy(deployInput)) : await deploy(deployInput, writer);
  return renderReport(where, report, format);
}
