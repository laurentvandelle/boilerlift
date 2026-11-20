// The targets `npm start` deploys to. Set N8N_URL to a test instance and N8N_API_KEY to its key, in debug/.env.
// dev and prod share that instance: prod deploys ./workflows-prod, whose workflow picks a credential with
// credential(), from the list `npm start -- creds sync --target prod` writes to credentials/prod.ts.
// Local n8n: docker run -it --rm -p 5678:5678 n8nio/n8n
import { defineConfig } from 'boilerlift';

export default defineConfig({
  targets: {
    dev: {
      url: process.env.N8N_URL,
      apiKey: process.env.N8N_API_KEY,
      workflows: './workflows',
    },
    prod: {
      url: process.env.N8N_URL,
      apiKey: process.env.N8N_API_KEY,
      workflows: './workflows-prod',
    },
  },
});
