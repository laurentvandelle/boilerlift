import { CommandDefinition } from '#src/cli/cli.model';
import { StatusFormat, renderInvalidManaged, renderTargetStatus } from '#src/cli/commands/status/status.render';
import { defineCommand } from '#src/cli/define-command';
import { renderConfigError, renderTargets } from '#src/cli/targets.render';
import { EXIT_API_KEY_REJECTED, EXIT_OK, EXIT_UNREACHABLE, EXIT_USAGE } from '#src/core/common/exit-codes';
import { err, ok } from '#src/core/common/result';
import { CONFIG_FILE, checkWorkflowFolders, targetsOnInstance } from '#src/core/config/project-config';
import { LOCK_FILE } from '#src/core/lock/lock-file';
import { readStatusTargets } from '#src/core/status/status-targets';
import { StatusFilter } from '#src/core/status/status.model';

const DESCRIPTION = `Shows where each workflow of a target stands on its n8n instance, and the next step:
  missing on the instance: ./${LOCK_FILE} records no id for it, or n8n no longer has that id,
  archived in n8n: it was deleted in the n8n editor; the next deploy restores it,
  differs from n8n: the local file and the n8n draft differ; the next deploy overwrites the draft,
  draft not yet published: the n8n draft holds the local file, but it is not the published version;
    lift publish <name> publishes it,
  up to date: the published version holds the local file,
  removed from the project: ./${LOCK_FILE} records it, but no workflow file of any target on
    the instance has its name any more; lift clean archives it,
  not in my project: a workflow of the instance that ./${LOCK_FILE} does not record.
A workflow of the project gets the first of these states that holds, in this order. Status cannot
tell whether the local file or the n8n draft changed: both show as "differs from n8n".

Status only reads: it changes nothing on the instance or in ./${LOCK_FILE}. Your workflows are found
by the ids ./${LOCK_FILE} records, never by name or tag. By default it lists every workflow of the
instance that is not archived; --archived adds the archived ones that are not in the project.
--managed=true keeps only the workflows of the project, --managed=false only the others.
--json gives each workflow its state and "next", the command to run, or null.`;

export const statusCommand: CommandDefinition = defineCommand({
  name: 'status',
  summary: 'Show where each workflow stands on your n8n instance',
  help: {
    description: DESCRIPTION,
    exitCodes: [
      [EXIT_OK, 'Status read every workflow, whatever their states'],
      [
        EXIT_USAGE,
        `Usage error, missing or invalid ${CONFIG_FILE} or ${LOCK_FILE}, unknown target, missing API key or workflows folder, or invalid workflow files`,
      ],
      [EXIT_UNREACHABLE, 'The n8n instance cannot be reached, or a read failed'],
      [EXIT_API_KEY_REJECTED, 'The API key is rejected'],
    ],
  },
  allowPositionals: false,
  options: {
    archived: { type: 'boolean', description: 'Also list the archived workflows that are not in the project' },
    managed: {
      type: 'string',
      valueName: 'true|false',
      description: 'true: only the workflows of the project; false: only the others',
    },
    json: { type: 'boolean', description: 'Print the status as JSON', format: true },
  },
  needs: ['targets', 'isDirectory', 'loadWorkflowFiles', 'readLockFile'],
  prepare: async ({ format, options }, { targets: { config, selected }, isDirectory }) => {
    const managed = options.text('managed');
    if (managed !== undefined && managed !== 'true' && managed !== 'false') {
      return err(renderInvalidManaged(managed, format));
    }
    // Every folder on the instance of a selected target: a missing one would show its workflows as removed.
    const onInstances = selected.flatMap((target) => targetsOnInstance(config, target.connection.url.value));
    const folders = await checkWorkflowFolders(config, [...selected, ...onInstances], isDirectory);
    if (!folders.ok) {
      return err(renderConfigError(folders.error, format));
    }
    const filter: StatusFilter = { managed: managed !== 'false', unmanaged: managed !== 'true', archived: options.flag('archived') };
    return ok(filter);
  },
  modes: {},
  default: async (filter, { targets, loadWorkflowFiles, readLockFile }, { target: selection }) => {
    const format: StatusFormat = { named: selection.kind !== 'default', managed: filter.managed };
    const statuses = await readStatusTargets({ config: targets.config, targets: targets.selected, filter }, { loadWorkflowFiles, lock: { read: () => readLockFile(LOCK_FILE) } });
    return statuses.map((status) => renderTargetStatus(status, format));
  },
  render: (runs, { format, target }) => renderTargets(runs, { json: format.json, all: target.kind === 'all' }),
});
