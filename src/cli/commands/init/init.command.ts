import { CommandDefinition, FileCreation } from '#src/cli/cli.model';
import { InitFile, InitFolder, InitOutput } from '#src/cli/commands/init/init.model';
import { renderFolderIsFile, renderFolderNotEmpty, renderInit, renderNoFolder, renderTooManyFolders } from '#src/cli/commands/init/init.render';
import { defineCommand } from '#src/cli/define-command';
import { EXIT_INIT_WRITE_FAILED, EXIT_OK, EXIT_TEMPLATE_UNAVAILABLE, EXIT_USAGE } from '#src/cli/exit-codes';
import { err, ok } from '#src/core/common/result';

const DESCRIPTION = `Creates a new Boilerlift project in folder, from the Project template of this version of
lift: the tag v<version> of the boilerlift-template repository, fetched with git, so git must be
installed. The folder is created when it is missing; one that exists must be empty, or hold
only .git. init never writes into a folder that holds anything else: to bring an existing
project to a new version, create a new one and move your files into it (docs/migration.md).

The project holds boilerlift.config.ts with one target, dev, read from N8N_URL and
N8N_API_KEY, an example workflow in workflows/ with its tested Code node function in code/,
package.json with npm run verify (ESLint, tsc, Vitest) and npm run n8n (one call to the n8n
public API), and the Agent kit: AGENTS.md with its docs, the BOILERLIFT: skills in
.claude/skills/, and the Claude Code guardrails in .claude/.

init only writes files: it never runs git init or npm install, and never writes .env. It
prints the commands that finish the setup.`;

export const initCommand: CommandDefinition = defineCommand({
  name: 'init',
  summary: 'Create a Boilerlift project in a new folder',
  help: {
    positionals: '<folder>',
    description: DESCRIPTION,
    exitCodes: [
      [EXIT_OK, 'Every file is created'],
      [EXIT_USAGE, 'Usage error: no folder, or folder is a file or a folder that is not empty. Nothing is written'],
      [EXIT_INIT_WRITE_FAILED, 'At least one file could not be written; the others were'],
      [EXIT_TEMPLATE_UNAVAILABLE, 'Could not get the Project template: git not found, network down, or no tag for this version. Nothing is written'],
    ],
  },
  allowPositionals: true,
  options: {
    json: { type: 'boolean', description: 'Print the result as JSON', format: true },
  },
  needs: ['version', 'readPath', 'fetchProjectTemplate', 'createFile'],
  prepare: async ({ positionals, format }, { readPath }) => {
    const [path, ...others] = positionals;
    if (path === undefined) {
      return err(renderNoFolder(format));
    }
    if (others.length > 0) {
      return err(renderTooManyFolders(positionals, format));
    }
    const contents = await readPath(path);
    switch (contents.kind) {
    case 'missing':
      return ok<InitFolder>({ path, hasGit: false });
    case 'file':
      return err(renderFolderIsFile(path, format));
    case 'folder':
      if (contents.entries.some((entry) => entry !== '.git')) {
        return err(renderFolderNotEmpty(path, format));
      }
      return ok<InitFolder>({ path, hasGit: contents.entries.includes('.git') });
    }
  },
  modes: {},
  default: async (folder, { version, fetchProjectTemplate, createFile }): Promise<InitOutput> => {
    // The whole template first: a failed fetch leaves no folder and no file behind.
    const template = await fetchProjectTemplate(version);
    if (!template.ok) {
      return { kind: 'template-unavailable', error: template.error };
    }
    const files: InitFile[] = [];
    // One at a time, so a failed write never stops the others.
    for (const { path, text } of [...template.value].sort((a, b) => a.path.localeCompare(b.path))) {
      files.push(initFile(path, await createFile(inFolder(folder.path, path), text)));
    }
    return { kind: 'written', files };
  },
  render: (output, { format, prepared }) => renderInit(output, prepared, format),
});

/** `path` of the project, relative to the current folder. */
function inFolder(folder: string, path: string): string {
  return folder === '.' ? path : `${folder.replace(/\/+$/, '')}/${path}`;
}

/** The folder was empty, so a file already there means something else wrote it meanwhile: init did not write it. */
function initFile(path: string, creation: FileCreation): InitFile {
  switch (creation.status) {
  case 'created':
    return { path, status: 'created' };
  case 'exists':
    return { path, status: 'failed', reason: 'a file is already there' };
  case 'failed':
    return { path, status: 'failed', reason: creation.reason };
  }
}
