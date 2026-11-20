# My n8n workflows

Workflows as code, delivered to n8n with [Boilerlift](https://github.com/laurentvandelle/boilerlift).

## Next steps

1. Install the dependencies:

   ```sh
   npm install
   ```

2. Copy `.env.example` to `.env`, then fill in `N8N_URL` (the root URL of your n8n instance) and `N8N_API_KEY` (n8n → Settings → n8n API).

3. Check the connection:

   ```sh
   npx lift ping
   ```

4. Preview, then deploy the example workflow `workflows/hello.workflow.ts`:

   ```sh
   npx lift deploy --dry-run
   npx lift deploy
   ```

`npx lift help` lists every command. The scripts of `package.json` run them too: `npm run ping`, `npm run check`, `npm run deploy`.

## Files

| File | What it is |
| --- | --- |
| `boilerlift.config.ts` | The targets: each n8n instance, its API key, and its workflows folder |
| `workflows/` | One workflow per `.workflow.ts` or `.json` file. The file name is its stable name |
| `.env.example` | The variables to copy into `.env`. Never commit `.env` |
| `AGENTS.md` | Instructions for AI agents working in this project (`CLAUDE.md` points to it) |
