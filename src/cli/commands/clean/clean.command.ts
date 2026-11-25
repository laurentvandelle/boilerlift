import { CommandDefinition, Deps } from '#src/cli/cli.model';
import {
  CleanFormat,
  CleanOutput,
  ListingStage,
  placeOf,
  plannedOf,
  renderConfirmation,
  renderDeclined,
  renderHeldBackPlan,
  renderInvalidLockFile,
  renderListing,
  renderReport,
} from '#src/cli/commands/clean/clean.render';
import { defineCommand } from '#src/cli/define-command';
import { renderConfigError, renderTargets } from '#src/cli/targets.render';
import { applyCleanTargets, isCleanConfirmed, planCleanTargets } from '#src/core/clean/clean-targets';
import {
  EXIT_API_KEY_REJECTED,
  EXIT_CONFIRMATION_NEEDED,
  EXIT_OK,
  EXIT_PARTIAL_FAILURE,
  EXIT_UNREACHABLE,
  EXIT_USAGE,
} from '#src/core/common/exit-codes';
import { err, ok } from '#src/core/common/result';
import { CONFIG_FILE, checkWorkflowFolders, targetsOnInstance } from '#src/core/config/project-config';
import { LOCK_FILE } from '#src/core/lock/lock-file';
import { LockStore } from '#src/core/lock/lock-file.model';
import { RemovalMode } from '#src/core/removal/removal.model';

const DESCRIPTION = `Archives, on the n8n instance of a target, the workflows you removed from the project: the
workflows ./${LOCK_FILE} records for that instance whose file is gone from the folder of every
target on it. A workflow another target on the same instance still has a file for is kept.
Archiving is what a delete in the n8n editor does: the workflow can be unarchived. Without
--delete, clean never deletes a workflow for good.
Clean lists three groups: the removed workflows, which it archives; the files not deployed yet,
with lift deploy next; and the workflows of the instance that ./${LOCK_FILE} does not record,
which it never touches. Your workflows are found by the ids of ./${LOCK_FILE} only, never by
name or tag.

Before archiving, clean lists the removed workflows of every selected target and asks once, on
stderr: y or yes archives; Enter, any other answer, or a closed stdin archives nothing. -y or -f
skips the question. Without a terminal, or with --json, clean never asks: unless -y or -f is
given, it lists them, archives nothing and exits ${EXIT_CONFIRMATION_NEEDED}, with lift clean --yes as the next step.

Each archived workflow, and each one already archived or no longer in n8n, loses its entry in
./${LOCK_FILE}: commit the file. A workflow n8n refuses to archive keeps its entry; the others
are still cleaned. With --all, every target is read first; if one has a problem, nothing is
archived.

--delete deletes the removed workflows for good instead: it cannot be undone. Each one is
archived first, when it is not archived yet, then deleted, so a failed delete leaves it archived
and recoverable; it keeps its entry, and the next lift clean --delete deletes it. A removed
workflow already archived in n8n is deleted too. The question says the deletion is permanent,
and the next step without a terminal is lift clean --delete --yes.

--dry-run lists what clean would archive (or delete, with --delete), asks nothing and changes
nothing.`;

export const cleanCommand: CommandDefinition = defineCommand({
  name: 'clean',
  summary: 'Archive the workflows you removed from the project',
  help: {
    description: DESCRIPTION,
    exitCodes: [
      [EXIT_OK, 'Every removed workflow cleaned, nothing to clean, a dry run, or the confirmation was not yes'],
      [EXIT_USAGE, `Usage error, missing or invalid ${CONFIG_FILE} or ${LOCK_FILE}, unknown target, missing API key or workflows folder`],
      [EXIT_UNREACHABLE, 'The n8n instance cannot be reached, or a read failed: nothing was archived or deleted'],
      [EXIT_API_KEY_REJECTED, 'The API key is rejected: nothing was archived or deleted'],
      [EXIT_PARTIAL_FAILURE, 'At least one workflow was not cleaned and keeps its entry; the others were'],
      [EXIT_CONFIRMATION_NEEDED, 'Workflows to archive or delete, but no terminal (or --json) to confirm, and no --yes: nothing changed'],
    ],
  },
  allowPositionals: false,
  options: {
    yes: { type: 'boolean', short: 'y', description: 'Archive without asking for confirmation' },
    force: { type: 'boolean', short: 'f', description: 'Same as --yes' },
    delete: { type: 'boolean', description: 'Delete the removed workflows for good instead of archiving them' },
    'dry-run': { type: 'boolean', description: 'List what clean would archive or delete; change nothing', mode: true },
    json: { type: 'boolean', description: 'Print the result as JSON', format: true },
  },
  needs: ['targets', 'isDirectory', 'loadWorkflowFiles', 'readLockFile', 'writeLockFile', 'ask', 'isInteractive'],
  prepare: async ({ format }, { targets: { config, selected }, isDirectory }) => {
    // Every folder on the instance of a selected target: a missing one would make its workflows look removed.
    const onInstances = selected.flatMap((target) => targetsOnInstance(config, target.connection.url.value));
    const folders = await checkWorkflowFolders(config, [...selected, ...onInstances], isDirectory);
    return folders.ok ? ok(undefined) : err(renderConfigError(folders.error, format));
  },
  modes: {
    'dry-run': (_prepared, deps, { options, format, target }) =>
      run(deps, { dryRun: true, yes: false, json: format.json, named: target.kind !== 'default', mode: modeOf(options.flag('delete')) }),
  },
  default: (_prepared, deps, { options, format, target }) =>
    run(deps, {
      dryRun: false,
      yes: options.flag('yes') || options.flag('force'),
      json: format.json,
      named: target.kind !== 'default',
      mode: modeOf(options.flag('delete')),
    }),
  render: (output, { format, target }) => {
    switch (output.kind) {
    case 'declined':
      return renderDeclined(output.mode);
    case 'invalid-lock-file':
      // As before any target is read: one block per selected target, laid out as --all only when there are several.
      return renderTargets(output.runs, { json: format.json, all: output.runs.length > 1 });
    case 'runs':
      return renderTargets(output.runs, { json: format.json, all: target.kind === 'all' });
    }
  },
});

type CleanDeps = Deps<'targets' | 'loadWorkflowFiles' | 'readLockFile' | 'writeLockFile' | 'ask' | 'isInteractive'>;
/**
 * What the command line asks of a run: list only, clean without asking, print JSON, write `--target` in next steps, and
 * archive or delete for good.
 */
interface RunOptions {
  dryRun: boolean;
  yes: boolean;
  json: boolean;
  named: boolean;
  mode: RemovalMode;
}

function modeOf(deleteFlag: boolean): RemovalMode {
  return deleteFlag ? 'delete' : 'archive';
}

/** Reads every target, then lists, asks, archives or deletes, by the options and whether a person can answer. */
async function run({ targets, loadWorkflowFiles, readLockFile, writeLockFile, ask, isInteractive }: CleanDeps, { dryRun, yes, json, named, mode }: RunOptions): Promise<CleanOutput> {
  const format: CleanFormat = { named, mode };
  const lock: LockStore = { read: () => readLockFile(LOCK_FILE), write: (text) => writeLockFile(LOCK_FILE, text) };
  const plan = await planCleanTargets({ config: targets.config, targets: targets.selected, mode }, { loadWorkflowFiles, lock });
  switch (plan.kind) {
  case 'invalid-lock-file':
    return { kind: 'invalid-lock-file', runs: targets.selected.map((target) => renderInvalidLockFile(placeOf(target), plan.error)) };
  case 'held-back':
    return { kind: 'runs', runs: plan.plans.map((target) => renderHeldBackPlan(target, format)) };
  case 'nothing-to-remove':
  case 'needs-confirmation':
    break;
  }
  const listing = (stage: ListingStage): CleanOutput => ({ kind: 'runs', runs: plan.ready.map((ready) => renderListing(plannedOf(ready), stage, format)) });
  if (dryRun || plan.kind === 'nothing-to-remove') {
    return listing('dry-run');
  }
  if (!yes) {
    if (json || !isInteractive) {
      return listing('confirmation-needed');
    }
    if (!isCleanConfirmed(await ask(renderConfirmation(plan.ready.map(plannedOf), mode)))) {
      return { kind: 'declined', mode };
    }
  }
  const cleaned = await applyCleanTargets(plan, lock);
  return { kind: 'runs', runs: cleaned.map(({ plan: ready, report }) => renderReport(plannedOf(ready), report, format)) };
}
