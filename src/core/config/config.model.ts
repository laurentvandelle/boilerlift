/** Where a value of the connection config was read: the environment, `./.env`, or the project config file. */
export type ConfigSource = 'env' | '.env' | 'boilerlift.config.ts';

export interface ConfigValue {
  value: string;
  source: ConfigSource;
}

export interface ConnectionConfig {
  /** An http: or https: URL, without trailing slash. */
  url: ConfigValue;
  apiKey: ConfigValue;
}

/** One target as `boilerlift.config.ts` declares it, inside `defineConfig`. */
export interface TargetConfig {
  /** Root URL of the n8n instance, `http://` or `https://`. Boilerlift adds the API path itself. */
  url: string;
  /** The name of the environment variable that holds the API key. Its value is read from the environment, then `.env`. */
  apiKeyEnv: string;
  /** The folder of the workflow files to deploy to this target, from the folder of the config file. */
  workflows: string;
}

/** What `boilerlift.config.ts` exports by default: the targets, by name, in the order they are listed and run. */
export interface BoilerliftConfig {
  targets: Record<string, TargetConfig>;
}

/** A target of the project config that passed every check of its shape, its name included. */
export interface DeclaredTarget {
  name: string;
  /** Without trailing slash. */
  url: string;
  apiKeyEnv: string;
  workflows: string;
}

/** The project config: its targets, in declaration order. Never empty. */
export interface ProjectConfig {
  targets: DeclaredTarget[];
}

/** A declared target with its API key read: ready to connect to. */
export interface Target {
  name: string;
  apiKeyEnv: string;
  workflows: string;
  connection: ConnectionConfig;
}

/** Which targets a command runs on: the one target of the config, the one named by `--target`, or every one (`--all`). */
export type TargetSelection = { kind: 'default' } | { kind: 'one'; name: string } | { kind: 'all' };

/** What the CLI found at `./boilerlift.config.ts`: no file, its default export, or why it could not be imported. */
export type ProjectConfigFile = { kind: 'missing' } | { kind: 'loaded'; content: unknown } | { kind: 'unreadable'; reason: string };

/**
 * Why the targets cannot be used. Each one exits 1 before anything is sent.
 * - `no-config-file`: there is no `boilerlift.config.ts` in the current folder.
 * - `unreadable-config`: the file cannot be imported.
 * - `invalid-config`: its default export is not a valid config; one problem per line.
 * - `target-required`: several targets, and the command names none.
 * - `unknown-target`: `--target` names a target the config does not declare.
 * - `missing-api-key`: the variable `apiKeyEnv` names is blank or absent.
 * - `missing-workflows`: the workflows folder of the target does not exist.
 *
 * `available` lists the declared targets, when the config could be read.
 */
export type ConfigError =
  | { kind: 'no-config-file' }
  | { kind: 'unreadable-config'; reason: string }
  | { kind: 'invalid-config'; problems: string[] }
  | { kind: 'target-required'; available: string[] }
  | { kind: 'unknown-target'; name: string; available: string[] }
  | { kind: 'missing-api-key'; target: string; apiKeyEnv: string; available: string[] }
  | { kind: 'missing-workflows'; target: string; workflows: string; available: string[] };
