import { CommandDefinition } from '#src/cli/cli.model';
import { renderSync } from '#src/cli/commands/creds-sync/creds-sync.render';
import { defineCommand } from '#src/cli/define-command';
import { TargetRun, renderConfigError, renderTargets } from '#src/cli/targets.render';
import {
  EXIT_API_KEY_REJECTED,
  EXIT_CREDENTIALS_MISSING,
  EXIT_CREDENTIALS_WRITE_FAILED,
  EXIT_CREDENTIAL_SCOPE_MISSING,
  EXIT_OK,
  EXIT_UNREACHABLE,
  EXIT_USAGE,
} from '#src/core/common/exit-codes';
import { err, ok } from '#src/core/common/result';
import { CONFIG_FILE, checkWorkflowFolders } from '#src/core/config/project-config';
import { CREDENTIALS_DIR, CREDENTIAL_LIST_SCOPE, knownCredentialTypes, syncCredentials } from '#src/core/credentials/sync-credentials';

const DESCRIPTION = `Lists the credentials of the n8n instance of each target it runs on, and writes them to
./${CREDENTIALS_DIR}/<target>.ts: the key, name, type and n8n id of each one, never a secret. Commit
the file: a workflow then picks a credential by its key, with credentials: credential('key'),
and the editor offers the keys of every target.

A key is the name of the credential in kebab-case. Two credentials whose names give the same key
get -2, -3… in the order of their n8n ids. A credential renamed in n8n gets a new key; one deleted
leaves the list at the next sync.

Then it reports each key that the workflows of the target use and that its list does not have,
with its type and the workflows that use it. The list is written all the same.

creds sync only reads the instance: it never changes a credential there. Deploy does not resolve
credential() yet: it refuses a workflow that uses it.`;

export const credsSyncCommand: CommandDefinition = defineCommand({
  name: 'creds sync',
  summary: 'Write the credentials of your n8n instance to your project',
  help: {
    description: DESCRIPTION,
    exitCodes: [
      [EXIT_OK, 'The list is written, and the workflows use no missing credential'],
      [EXIT_USAGE, `Usage error, missing or invalid ${CONFIG_FILE}, unknown target, missing API key or workflows folder`],
      [EXIT_UNREACHABLE, 'The n8n instance cannot be reached: the list was left as it was'],
      [EXIT_API_KEY_REJECTED, 'The API key is rejected: the list was left as it was'],
      [EXIT_CREDENTIALS_MISSING, 'The list is written, but workflows use credentials it does not have'],
      [EXIT_CREDENTIAL_SCOPE_MISSING, `The API key lacks the ${CREDENTIAL_LIST_SCOPE} scope: the list was left as it was`],
      [EXIT_CREDENTIALS_WRITE_FAILED, `./${CREDENTIALS_DIR}/<target>.ts could not be written`],
    ],
  },
  allowPositionals: false,
  options: {
    json: { type: 'boolean', description: 'Print the report as JSON', format: true },
  },
  needs: ['targets', 'isDirectory', 'loadCredentialsFiles', 'loadWorkflowFiles', 'writeCredentialsFile'],
  prepare: async ({ format }, { targets: { config, selected }, isDirectory }) => {
    const folders = await checkWorkflowFolders(config, [...selected], isDirectory);
    return folders.ok ? ok(undefined) : err(renderConfigError(folders.error, format));
  },
  modes: {},
  default: async (_prepared, { targets, loadCredentialsFiles, loadWorkflowFiles, writeCredentialsFile }) => {
    // The lists first: importing them gives credential() its types when the workflow files run it.
    const knownTypes = knownCredentialTypes(await loadCredentialsFiles(CREDENTIALS_DIR));
    const runs: TargetRun[] = [];
    for (const target of targets.selected) {
      const files = await loadWorkflowFiles(target.workflows);
      const report = await syncCredentials({ target: target.name, client: target.client, files, knownTypes }, writeCredentialsFile);
      runs.push(renderSync({ name: target.name, instance: target.connection.url.value }, report));
    }
    return runs;
  },
  render: (runs, { format, target }) => renderTargets(runs, { json: format.json, all: target.kind === 'all' }),
});
