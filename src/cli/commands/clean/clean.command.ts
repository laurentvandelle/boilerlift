import { CommandDefinition, ConnectedTarget, Deps } from '#src/cli/cli.model';
import {
  CleanFormat,
  CleanOutput,
  CleanTarget,
  ListingStage,
  PlannedTarget,
  renderConfirmation,
  renderDeclined,
  renderHeldBack,
  renderInvalidLockFile,
  renderListing,
  renderReport,
  renderStopped,
} from '#src/cli/commands/clean/clean.render';
import { defineCommand } from '#src/cli/define-command';
import { TargetRun, renderConfigError, renderTargets } from '#src/cli/targets.render';
import { applyClean, planClean } from '#src/core/clean/clean';
import { stableNamesOf } from '#src/core/compile/load-workflows';
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
import { LOCK_FILE, lockRemover, managedIds, parseLockFile, removedEntries } from '#src/core/deliver/lock-file';
import { LockFile } from '#src/core/deliver/lock-file.model';

const DESCRIPTION = `Archives, on the n8n instance of a target, the workflows you removed from the project: the
workflows ./${LOCK_FILE} records for that instance whose file is gone from the folder of every
target on it. A workflow another target on the same instance still has a file for is kept.
Archiving is what a delete in the n8n editor does: the workflow can be unarchived. Clean never
deletes a workflow for good.
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

--dry-run lists what clean would archive, asks nothing and archives nothing.`;

export const cleanCommand: CommandDefinition = defineCommand({
  name: 'clean',
  summary: 'Archive the workflows you removed from the project',
  help: {
    description: DESCRIPTION,
    exitCodes: [
      [EXIT_OK, 'Every removed workflow cleaned, nothing to clean, a dry run, or the confirmation was not yes'],
      [EXIT_USAGE, `Usage error, missing or invalid ${CONFIG_FILE} or ${LOCK_FILE}, unknown target, missing API key or workflows folder`],
      [EXIT_UNREACHABLE, 'The n8n instance cannot be reached, or a read failed: nothing was archived'],
      [EXIT_API_KEY_REJECTED, 'The API key is rejected: nothing was archived'],
      [EXIT_PARTIAL_FAILURE, 'At least one workflow was not cleaned and keeps its entry; the others were'],
      [EXIT_CONFIRMATION_NEEDED, 'Workflows to archive, but no terminal (or --json) to confirm, and no --yes: nothing was archived'],
    ],
  },
  allowPositionals: false,
  options: {
    yes: { type: 'boolean', short: 'y', description: 'Archive without asking for confirmation' },
    force: { type: 'boolean', short: 'f', description: 'Same as --yes' },
    'dry-run': { type: 'boolean', description: 'List what clean would archive; change nothing', mode: true },
    json: { type: 'boolean', description: 'Print the result as JSON', format: true },
  },
  needs: ['targets', 'isDirectory', 'loadWorkflowFiles', 'readLockFile', 'writeLockFile', 'ask', 'isInteractive'],
  prepare: async ({ format }, { targets: { config, selected }, isDirectory, readLockFile }) => {
    // Every folder on the instance of a selected target: a missing one would make its workflows look removed.
    const onInstances = selected.flatMap((target) => targetsOnInstance(config, target.connection.url.value));
    const folders = await checkWorkflowFolders(config, [...selected, ...onInstances], isDirectory);
    if (!folders.ok) {
      return err(renderConfigError(folders.error, format));
    }
    const lock = parseLockFile(await readLockFile(LOCK_FILE));
    if (!lock.ok) {
      const runs = selected.map((target) => renderInvalidLockFile(where(target), lock.error));
      return err(renderTargets(runs, { json: format.json, all: selected.length > 1 }));
    }
    return ok(lock.value);
  },
  modes: {
    'dry-run': (lock, deps, input) =>
      run(lock, deps, { dryRun: true, yes: false, json: input.format.json, named: input.target.kind !== 'default' }),
  },
  default: (lock, deps, { options, format, target }) =>
    run(lock, deps, { dryRun: false, yes: options.flag('yes') || options.flag('force'), json: format.json, named: target.kind !== 'default' }),
  render: (output, { format, target }) =>
    output.kind === 'declined' ? renderDeclined() : renderTargets(output.runs, { json: format.json, all: target.kind === 'all' }),
});

type CleanDeps = Deps<'targets' | 'loadWorkflowFiles' | 'writeLockFile' | 'ask' | 'isInteractive'>;
/** What the command line asks of a run: list only, archive without asking, print JSON, write `--target` in next steps. */
interface RunOptions {
  dryRun: boolean;
  yes: boolean;
  json: boolean;
  named: boolean;
}

/** One target after its reads: ready, with its groups, or the run that says why it is not. */
type TargetPlan = (PlannedTarget & { kind: 'ready'; client: ConnectedTarget['client'] }) | { kind: 'problem'; run: TargetRun };

function where(target: ConnectedTarget): CleanTarget {
  return { name: target.name, instance: target.connection.url.value, folder: target.workflows };
}

/** Reads every target, then lists, asks or archives, by the options and whether a person can answer. */
async function run(lock: LockFile, deps: CleanDeps, { dryRun, yes, json, named }: RunOptions): Promise<CleanOutput> {
  const format: CleanFormat = { named };
  const plans: TargetPlan[] = [];
  for (const target of deps.targets.selected) {
    plans.push(await planTarget(target, lock, deps, format));
  }
  const ready = plans.flatMap((plan) => (plan.kind === 'ready' ? [plan] : []));
  if (ready.length < plans.length) {
    return { kind: 'runs', runs: plans.map((plan) => (plan.kind === 'ready' ? renderHeldBack(plan.target) : plan.run)) };
  }
  const listing = (stage: ListingStage): CleanOutput => ({ kind: 'runs', runs: ready.map((plan) => renderListing(plan, stage, format)) });
  if (dryRun || ready.every(({ groups }) => groups.removed.length === 0)) {
    return listing('dry-run');
  }
  if (!yes) {
    if (json || !deps.isInteractive) {
      return listing('confirmation-needed');
    }
    if (!isYes(await deps.ask(renderConfirmation(ready)))) {
      return { kind: 'declined' };
    }
  }
  const remover = lockRemover(lock, (text) => deps.writeLockFile(LOCK_FILE, text));
  const runs: TargetRun[] = [];
  for (const plan of ready) {
    runs.push(renderReport(plan, await applyClean(plan.groups.removed, plan.client, plan.target.instance, remover), format));
  }
  return { kind: 'runs', runs };
}

/** Reads the files of every folder on the instance of `target`, and the instance, and works out its three groups. */
async function planTarget(target: ConnectedTarget, lock: LockFile, { targets, loadWorkflowFiles }: CleanDeps, format: CleanFormat): Promise<TargetPlan> {
  const place = where(target);
  const present = new Set<string>();
  for (const { workflows: folder } of targetsOnInstance(targets.config, place.instance)) {
    stableNamesOf((await loadWorkflowFiles(folder)).map(({ path }) => path)).forEach((name) => present.add(name));
  }
  const files = (await loadWorkflowFiles(target.workflows)).map(({ path }) => path);
  const plan = await planClean({
    client: target.client,
    managed: managedIds(lock, place.instance),
    removed: removedEntries(lock, place.instance, present),
    files,
  });
  if (plan.kind === 'stopped') {
    return { kind: 'problem', run: renderStopped(place, plan, format) };
  }
  return { kind: 'ready', target: place, client: target.client, groups: plan };
}

/** `y` or `yes`, in any case, archives. Enter, any other answer, or a closed stdin, is a no: the default is no. */
function isYes(answer: string | undefined): boolean {
  const word = answer?.trim().toLowerCase();
  return word === 'y' || word === 'yes';
}
