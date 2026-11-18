/** Where a value of the connection config was read: the project config file. */
export type ConfigSource = 'boilerlift.config.ts';

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
 * One target as `boilerlift.config.ts` declares it, inside `defineConfig`. `url` and `apiKey` may be read from the
 * environment (`process.env.N8N_URL`), under names the user picks: `undefined` or blank is reported as missing.
 */
export interface TargetConfig {
  /** Root URL of the n8n instance, `http://` or `https://`. Boilerlift adds the API path itself. */
  url: string | undefined;
  /** The n8n API key of the instance (n8n → Settings → n8n API). Never write it in the file: read it from the environment. */
  apiKey: string | undefined;
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
  /** Not blank. */
  apiKey: string;
  workflows: string;
}

/** The project config: its targets, in declaration order. Never empty. */
export interface ProjectConfig {
  targets: DeclaredTarget[];
}

/** A selected target, ready to connect to. */
export interface Target {
  name: string;
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
 * - `missing-api-key`: the `apiKey` of the target is blank or `undefined`, as when the variable it reads is not set.
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
  | { kind: 'missing-api-key'; target: string; available: string[] }
  | { kind: 'missing-workflows'; target: string; workflows: string; available: string[] };
