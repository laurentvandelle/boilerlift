import { ConfigError, ConfigKey } from '#src/core/config/config.model';

const EXAMPLE_LINES: Record<ConfigKey, string> = {
  N8N_URL: 'N8N_URL=https://your-n8n.example.com',
  N8N_API_KEY: 'N8N_API_KEY=your-n8n-api-key',
};

/** The message for a connection config that cannot be used, with the lines to fix in `.env`. Ends with a newline. */
export function describeConfigError(error: ConfigError): string {
  switch (error.kind) {
  case 'missing':
    return describeMissing(error.keys);
  case 'invalid-url': {
    const where = error.url.source === 'env' ? 'your environment' : '.env';
    return `Invalid N8N_URL "${error.url.value}" (from ${error.url.source}): it must be an http:// or https:// URL.\nFix it in ${where}, for example:\n  ${EXAMPLE_LINES.N8N_URL}\n`;
  }
  }
}

function describeMissing(missing: ConfigKey[]): string {
  const lines = missing.map((key) => `  ${EXAMPLE_LINES[key]}`).join('\n');
  const one = missing.length === 1;
  return `Missing ${missing.join(' and ')}.\nAdd ${one ? 'this line' : 'these lines'} to .env, or set ${one ? 'it' : 'them'} in your environment:\n${lines}\n`;
}
