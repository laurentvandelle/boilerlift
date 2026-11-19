import { CommandDefinition, ConnectedTarget, Deps } from '#src/cli/cli.model';
import {
  PublishFormat,
  PublishOutput,
  PublishTarget,
  ReadyTarget,
  renderConfirmation,
  renderDeclined,
  renderHeldBack,
  renderInvalidFiles,
  renderInvalidLockFile,
  renderNotReady,
  renderReport,
} from '#src/cli/commands/publish/publish.render';
import { defineCommand } from '#src/cli/define-command';
import { TargetRun, renderConfigError, renderTargets } from '#src/cli/targets.render';
import { loadWorkflows } from '#src/core/compile/load-workflows';
import { EXIT_API_KEY_REJECTED, EXIT_OK, EXIT_PARTIAL_FAILURE, EXIT_UNREACHABLE, EXIT_USAGE } from '#src/core/common/exit-codes';
import { err, ok } from '#src/core/common/result';
import { CONFIG_FILE, checkWorkflowFolders } from '#src/core/config/project-config';
import { LOCK_FILE, managedIds, parseLockFile } from '#src/core/deliver/lock-file';
import { applyPublish, planPublish } from '#src/core/publish/publish';

const DESCRIPTION = `Publishes deployed drafts on the n8n instance of a target: the draft becomes the published
version, and the workflow runs it on its triggers.
  With names, publishes only those workflows. Without names, publishes every workflow whose
  draft is waiting to be published (the "draft not yet published" state of lift status).
Before publishing, publish lists the workflows of every selected target, then asks once, on
stderr, and reads the answer from stdin, TTY or not. Only y or yes publishes; any other answer,
an empty one, or a closed stdin publishes nothing. -y or -f skips the question.

A name that matches no workflow file, no id in ./${LOCK_FILE}, or an archived workflow is unknown:
nothing is published, on any target. A named workflow whose local file differs from the n8n draft
is not published: run lift deploy first; the others are still published. A named workflow
already published is skipped. Your workflows are found by the ids of ./${LOCK_FILE} only, never
by name or tag. With --all, every target is read first; if one has a problem, nothing is published.`;

export const publishCommand: CommandDefinition = defineCommand({
  name: 'publish',
  summary: 'Publish your deployed drafts on your n8n instance',
  help: {
    positionals: '[names...]',
    description: DESCRIPTION,
    exitCodes: [
      [EXIT_OK, 'Every workflow published, already published, or nothing to publish'],
      [
        EXIT_USAGE,
        `Usage error, missing or invalid ${CONFIG_FILE} or ${LOCK_FILE}, unknown target or workflow name, missing API key or workflows folder, invalid workflow files, or the confirmation was not yes`,
      ],
      [EXIT_UNREACHABLE, 'The n8n instance cannot be reached, or a read failed: nothing was published'],
      [EXIT_API_KEY_REJECTED, 'The API key is rejected: nothing was published'],
      [EXIT_PARTIAL_FAILURE, 'At least one workflow was not published (differs from n8n, or n8n refused it); the others were'],
    ],
  },
  allowPositionals: true,
  options: {
    yes: { type: 'boolean', short: 'y', description: 'Publish without asking for confirmation' },
    force: { type: 'boolean', short: 'f', description: 'Same as --yes' },
    json: { type: 'boolean', description: 'Print the result as JSON', format: true },
  },
  needs: ['targets', 'isDirectory', 'loadWorkflowFiles', 'readLockFile', 'ask'],
  prepare: async ({ format }, { targets: { config, selected }, isDirectory }) => {
    const folders = await checkWorkflowFolders(config, [...selected], isDirectory);
    return folders.ok ? ok(undefined) : err(renderConfigError(folders.error, format));
  },
  modes: {},
  default: async (_prepared, deps, { positionals: names, options, target: selection }): Promise<PublishOutput> => {
    const format: PublishFormat = { named: selection.kind !== 'default' };
    const plans: TargetPlan[] = [];
    for (const target of deps.targets.selected) {
      plans.push(await planTarget(target, names, deps, format));
    }
    const ready = plans.flatMap((plan) => (plan.kind === 'ready' ? [plan] : []));
    if (ready.length < plans.length) {
      return { kind: 'runs', runs: plans.map((plan) => (plan.kind === 'ready' ? renderHeldBack(plan.target) : plan.run)) };
    }
    const waiting = ready.some(({ workflows }) => workflows.some(({ action }) => action === 'to-publish'));
    if (waiting && !options.flag('yes') && !options.flag('force') && !isYes(await deps.ask(renderConfirmation(ready, format)))) {
      return { kind: 'declined', names };
    }
    const runs: TargetRun[] = [];
    for (const { target, client, workflows } of ready) {
      runs.push(renderReport(target, await applyPublish(workflows, client), format, names.length > 0));
    }
    return { kind: 'runs', runs };
  },
  render: (output, { format, target }) =>
    output.kind === 'declined'
      ? renderDeclined(output.names, target, format)
      : renderTargets(output.runs, { json: format.json, all: target.kind === 'all' }),
});

/** One target after its reads: ready to publish, or the run that says why it is not. */
type TargetPlan = (ReadyTarget & { kind: 'ready'; client: ConnectedTarget['client'] }) | { kind: 'problem'; run: TargetRun };

/** Reads the files, the lock file and the instance of one target, and works out what publish would do there. */
async function planTarget(
  target: ConnectedTarget,
  names: string[],
  { loadWorkflowFiles, readLockFile }: Deps<'loadWorkflowFiles' | 'readLockFile'>,
  format: PublishFormat,
): Promise<TargetPlan> {
  const instance = target.connection.url.value;
  const where: PublishTarget = { name: target.name, instance, folder: target.workflows };
  const loaded = loadWorkflows(await loadWorkflowFiles(target.workflows));
  if (!loaded.ok) {
    return { kind: 'problem', run: renderInvalidFiles(where, loaded.error) };
  }
  const lock = parseLockFile(await readLockFile(LOCK_FILE));
  if (!lock.ok) {
    return { kind: 'problem', run: renderInvalidLockFile(where, lock.error) };
  }
  const plan = await planPublish({ workflows: loaded.value, client: target.client, managed: managedIds(lock.value, instance), names });
  if (plan.kind !== 'ready') {
    return { kind: 'problem', run: renderNotReady(where, plan, format) };
  }
  return { kind: 'ready', target: where, client: target.client, workflows: plan.workflows };
}

/** Only an explicit yes publishes: `y` or `yes`, in any case. An empty answer or a closed stdin is a no. */
function isYes(answer: string | undefined): boolean {
  const word = answer?.trim().toLowerCase();
  return word === 'y' || word === 'yes';
}
