// The targets `npm start` deploys to. Point `url` at a test instance, and set the key `apiKeyEnv` names in debug/.env.
// Local n8n: docker run -it --rm -p 5678:5678 n8nio/n8n
import { defineConfig } from 'boilerlift';

export default defineConfig({
  targets: {
    dev: {
      url: 'http://localhost:5678',
      apiKeyEnv: 'N8N_API_KEY',
      workflows: './workflows',
    },
  },
});
