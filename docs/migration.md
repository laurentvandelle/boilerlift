# Move a project to a new version

`lift init` only creates new projects: it never writes into a folder that already holds one. To bring an existing project to the Project template of a new version of Boilerlift:

1. Create a new project with the new version, in a new folder:

   ```sh
   npx boilerlift@latest init my-new-project
   ```

2. Move your workflows into it: the `workflows/` folder, and `code/` for the functions of your Code nodes.
3. Move your configuration into it: your targets in `boilerlift.config.ts`, `credentials/`, `boilerlift.lock.json` (so deploy keeps updating the same workflows on n8n) and `.env`.
4. Run `npm install`, then `npm run verify` and `npx lift deploy --dry-run` to check that nothing changes on n8n.

This guide is a first draft: a later version will cover each file in detail.
