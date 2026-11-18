import { ConfigError } from '#src/core/config/config.model';
import { CONFIG_FILE } from '#src/core/config/project-config';

/** The config to paste into a new `boilerlift.config.ts`: one target, the API key in N8N_API_KEY, the files in ./workflows. */
export const STARTER_CONFIG = `import { defineConfig } from 'boilerlift';

export default defineConfig({
  targets: {
    dev: {
      url: 'https://your-n8n.example.com',
      apiKeyEnv: 'N8N_API_KEY',
      workflows: './workflows',
    },
  },
});
`;

/** The message for targets that cannot be used, with what to fix in the config file or the environment. Ends with a newline. */
export function describeConfigError(error: ConfigError): string {
  switch (error.kind) {
  case 'no-config-file':
    return `No ${CONFIG_FILE} in this folder.\nCreate it with your n8n instance, for example:\n\n${STARTER_CONFIG}\nThen set N8N_API_KEY in your environment or in .env.\n`;
  case 'unreadable-config':
    return `Cannot read ${CONFIG_FILE}: ${error.reason}\n`;
  case 'invalid-config':
    return `Invalid ${CONFIG_FILE}:\n${error.problems.map((problem) => `  ✗ ${problem}`).join('\n')}\n`;
  case 'target-required':
    return `${CONFIG_FILE} declares several targets, and the command names none.\n${availableLine(error.available)}`;
  case 'unknown-target':
    return `Unknown target "${error.name}": ${CONFIG_FILE} does not declare it.\n${availableLine(error.available)}`;
  case 'missing-api-key':
    return `Missing ${error.apiKeyEnv}, the API key of target "${error.target}" (its apiKeyEnv in ${CONFIG_FILE}).\nAdd this line to .env, or set it in your environment:\n  ${error.apiKeyEnv}=your-n8n-api-key\n`;
  case 'missing-workflows':
    return `The workflows folder of target "${error.target}", ${error.workflows}, does not exist.\nCreate it, or fix "workflows" for this target in ${CONFIG_FILE}.\n${availableLine(error.available)}`;
  }
}

function availableLine(available: string[]): string {
  return `Available targets: ${available.join(', ')}\n`;
}
