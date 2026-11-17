export type ConfigSource = 'env' | '.env';

export type ConfigKey = 'N8N_URL' | 'N8N_API_KEY';

export interface ConfigValue {
  value: string;
  source: ConfigSource;
}

export interface ConnectionConfig {
  /** An http: or https: URL, without trailing slash. */
  url: ConfigValue;
  apiKey: ConfigValue;
}

/**
 * Why the connection config cannot be used. Each one exits 1, with the `.env` lines to fix.
 * - `missing`: the values that are absent or blank.
 * - `invalid-url`: N8N_URL is set but is not an http: or https: URL.
 */
export type ConfigError = { kind: 'missing'; keys: ConfigKey[] } | { kind: 'invalid-url'; url: ConfigValue };
