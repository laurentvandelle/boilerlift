import { CommandDefinition, ConnectedTarget, Deps } from '#src/cli/cli.model';
import {
  ListingStage,
  PlannedReset,
  ResetOutput,
  ResetTarget,
  renderConfirmation,
  renderDeclined,
  renderInvalidLockFile,
  renderListing,
  renderReport,
  renderStopped,
  renderTargetNotNamed,
} from '#src/cli/commands/reset/reset.render';
import { defineCommand } from '#src/cli/define-command';
import { renderConfigError, renderTargets } from '#src/cli/targets.render';
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
import { LOCK_FILE, lockRemover, managedIds, parseLockFile } from '#src/core/lock/lock-file';
import { LockFile } from '#src/core/lock/lock-file.model';
import { applyRemoval } from '#src/core/removal/removal';
import { RemovalMode } from '#src/core/removal/removal.model';
import { OtherTarget } from '#src/core/reset/reset.model';
import { planReset } from '#src/core/reset/reset';

const DESCRIPTION = `Removes, on the n8n instance of one target, every workflow ./${LOCK_FILE} records as
deployed there: the workflows of the target's folder, still in the project or not, and the
entries no target on that instance has a file for any more. It leaves a test server clean, or
undoes a deploy to the wrong environment. A workflow whose file is in the folder of another
target on the same instance is kept: reset never touches another target's deploys. Your
workflows are found by the ids of ./${LOCK_FILE} only, never by name or tag; a workflow
Boilerlift never deployed is never touched, nor are credentials or the project's files.

Reset archives by default: the workflow can be unarchived in n8n. Each workflow archived, already
archived, or no longer in n8n loses its entry in ./${LOCK_FILE}: commit the file. lift status
then shows the project's workflows as not deployed yet, and lift deploy deploys them again. A
workflow n8n refuses to archive keeps its entry; the others are still removed.

Before removing, reset lists the workflows and asks, on stderr, for the target name: only the
exact name, case-sensitive, goes on; any other answer, or a closed stdin, removes nothing. -y or
-f skips the question. Without a terminal, or with --json, reset never asks: unless -y or -f is
given, it lists them, removes nothing and exits ${EXIT_CONFIRMATION_NEEDED}, with lift reset --target <name> --yes next.

--delete deletes the workflows for good instead: it cannot be undone. Each one is archived first,
when it is not archived yet, then deleted, so a failed delete leaves it archived and keeps its
entry. The question says the deletion is permanent.

--dry-run lists what reset would archive (or delete, with --delete), asks nothing and changes
nothing.`;

export const resetCommand: CommandDefinition = defineCommand({
  name: 'reset',
  summary: 'Remove every workflow Boilerlift deployed on one target',
  help: {
    description: DESCRIPTION,
    exitCodes: [
      [EXIT_OK, 'Every workflow removed, nothing to remove, a dry run, or the typed name was not the target'],
      [
        EXIT_USAGE,
        `Usage error, no --target or --all given, missing or invalid ${CONFIG_FILE} or ${LOCK_FILE}, unknown target, missing API key or workflows folder`,
      ],
      [EXIT_UNREACHABLE, 'The n8n instance cannot be reached, or a read failed: nothing was archived or deleted'],
      [EXIT_API_KEY_REJECTED, 'The API key is rejected: nothing was archived or deleted'],
      [EXIT_PARTIAL_FAILURE, 'At least one workflow was not removed and keeps its entry; the others were'],
      [EXIT_CONFIRMATION_NEEDED, 'Workflows to remove, but no terminal (or --json) to confirm, and no --yes: nothing changed'],
    ],
  },
  allowPositionals: false,
  options: {
    yes: { type: 'boolean', short: 'y', description: 'Remove without asking for confirmation' },
    force: { type: 'boolean', short: 'f', description: 'Same as --yes' },
    delete: { type: 'boolean', description: 'Delete the workflows for good instead of archiving them' },
    'dry-run': { type: 'boolean', description: 'List what reset would archive or delete; change nothing', mode: true },
    json: { type: 'boolean', description: 'Print the result as JSON', format: true },
  },
  needs: ['targets', 'isDirectory', 'loadWorkflowFiles', 'readLockFile', 'writeLockFile', 'ask', 'isInteractive'],
  prepare: async ({ format, target: selection }, { targets: { config, selected }, isDirectory, readLockFile }) => {
    const [target] = selected;
    if (selection.kind !== 'one' || target === undefined) {
      return err(renderTargetNotNamed(format));
    }
    // Every folder on the instance: a missing one would make another target's workflows look like this one's.
    const onInstance = targetsOnInstance(config, target.connection.url.value);
    const folders = await checkWorkflowFolders(config, [target, ...onInstance], isDirectory);
    if (!folders.ok) {
      return err(renderConfigError(folders.error, format));
    }
    const lock = parseLockFile(await readLockFile(LOCK_FILE));
    if (!lock.ok) {
      return err(renderTargets([renderInvalidLockFile(where(target), lock.error)], { json: format.json, all: false }));
    }
    return ok({ target, lock: lock.value });
  },
  modes: {
    'dry-run': (prepared, deps, { options, format }) => run(prepared, deps, { dryRun: true, yes: false, json: format.json, mode: modeOf(options.flag('delete')) }),
  },
  default: (prepared, deps, { options, format }) =>
    run(prepared, deps, {
      dryRun: false,
      yes: options.flag('yes') || options.flag('force'),
      json: format.json,
      mode: modeOf(options.flag('delete')),
    }),
  render: (output, { format }) => (output.kind === 'declined' ? renderDeclined(output.mode) : renderTargets([output.run], { json: format.json, all: false })),
});

type ResetDeps = Deps<'targets' | 'loadWorkflowFiles' | 'writeLockFile' | 'ask' | 'isInteractive'>;

/** What `prepare` hands the handlers: the one named target and the lock file. */
interface Prepared {
  target: ConnectedTarget;
  lock: LockFile;
}

/** What the command line asks of a run: list only, remove without asking, print JSON, and archive or delete for good. */
interface RunOptions {
  dryRun: boolean;
  yes: boolean;
  json: boolean;
  mode: RemovalMode;
}

function modeOf(deleteFlag: boolean): RemovalMode {
  return deleteFlag ? 'delete' : 'archive';
}

function where(target: ConnectedTarget): ResetTarget {
  return { name: target.name, instance: target.connection.url.value, folder: target.workflows };
}

/** Reads the target, then lists, asks, archives or deletes, by the options and whether a person can answer. */
async function run({ target, lock }: Prepared, deps: ResetDeps, { dryRun, yes, json, mode }: RunOptions): Promise<ResetOutput> {
  const place = where(target);
  const others: OtherTarget[] = [];
  for (const other of targetsOnInstance(deps.targets.config, place.instance)) {
    if (other.name !== target.name) {
      others.push({ name: other.name, stableNames: stableNamesOf((await deps.loadWorkflowFiles(other.workflows)).map(({ path }) => path)) });
    }
  }
  const plan = await planReset({ client: target.client, managed: managedIds(lock, place.instance), others, mode });
  if (plan.kind === 'stopped') {
    return { kind: 'run', run: renderStopped(place, plan, mode) };
  }
  const planned: PlannedReset = { target: place, plan };
  const listing = (stage: ListingStage): ResetOutput => ({ kind: 'run', run: renderListing(planned, stage, mode) });
  if (dryRun || plan.workflows.length === 0) {
    return listing('dry-run');
  }
  if (!yes) {
    if (json || !deps.isInteractive) {
      return listing('confirmation-needed');
    }
    if ((await deps.ask(renderConfirmation(planned, mode)))?.trim() !== target.name) {
      return { kind: 'declined', mode };
    }
  }
  const remover = lockRemover(lock, (text) => deps.writeLockFile(LOCK_FILE, text));
  return { kind: 'run', run: renderReport(planned, await applyRemoval(plan.workflows, target.client, place.instance, remover), mode) };
}
