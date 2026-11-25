import { CommandDefinition } from '#src/cli/cli.model';
import {
  PublishFormat,
  PublishOutput,
  renderConfirmation,
  renderDeclined,
  renderHeldBackPlan,
  renderReport,
} from '#src/cli/commands/publish/publish.render';
import { defineCommand } from '#src/cli/define-command';
import { renderConfigError, renderTargets } from '#src/cli/targets.render';
import { EXIT_API_KEY_REJECTED, EXIT_OK, EXIT_PARTIAL_FAILURE, EXIT_UNREACHABLE, EXIT_USAGE } from '#src/cli/exit-codes';
import { err, ok } from '#src/core/common/result';
import { CONFIG_FILE, checkWorkflowFolders } from '#src/core/config/project-config';
import { LOCK_FILE } from '#src/core/lock/lock-file';
import { applyPublishTargets, isPublishConfirmed, planPublishTargets } from '#src/core/publish/publish-targets';

const DESCRIPTION = `Publishes deployed drafts on the n8n instance of a target: the draft becomes the published
version, and the workflow runs it on its triggers.
  With names, publishes only those workflows. Without names, publishes every workflow whose
  draft is waiting to be published (the "draft not yet published" state of lift status), and
  lists the workflows that differ from n8n, such as after a change in the n8n editor, without
  publishing them.
Before publishing, publish lists the workflows of every selected target, then asks once, on
stderr, and reads the answer from stdin, TTY or not. Enter, y or yes publishes; any other answer,
or a closed stdin, publishes nothing. -y or -f skips the question.

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
  default: async (_prepared, { targets, loadWorkflowFiles, readLockFile, ask }, { positionals: names, options, target: selection }): Promise<PublishOutput> => {
    const format: PublishFormat = { named: selection.kind !== 'default' };
    const run = await planPublishTargets({ targets: targets.selected, names }, { loadWorkflowFiles, lock: { read: () => readLockFile(LOCK_FILE) } });
    if (run.kind === 'held-back') {
      return { kind: 'runs', runs: run.plans.map((plan) => renderHeldBackPlan(plan, format)) };
    }
    const yes = options.flag('yes') || options.flag('force');
    if (run.kind === 'needs-confirmation' && !yes && !isPublishConfirmed(await ask(renderConfirmation(run.ready, format)))) {
      return { kind: 'declined', names };
    }
    const published = await applyPublishTargets(run.ready);
    return { kind: 'runs', runs: published.map((target) => renderReport(target, format, names.length > 0)) };
  },
  render: (output, { format, target }) =>
    output.kind === 'declined'
      ? renderDeclined(output.names, target, format)
      : renderTargets(output.runs, { json: format.json, all: target.kind === 'all' }),
});
