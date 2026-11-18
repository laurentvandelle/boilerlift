import { parseEnv } from 'node:util';
import {
  BoilerliftConfig,
  ConfigError,
  ConfigValue,
  DeclaredTarget,
  ProjectConfig,
  ProjectConfigFile,
  Target,
  TargetSelection,
} from '#src/core/config/config.model';
import { isRecord } from '#src/core/common/is-record';
import { Result, err, ok } from '#src/core/common/result';

/** The project config file, in the current folder. */
export const CONFIG_FILE = 'boilerlift.config.ts';

/** A target name: 1 to 64 of a-z, 0-9 and -, like a stable name. */
const TARGET_NAME_PATTERN = /^[a-z0-9-]{1,64}$/;

/** An environment variable name: a letter or `_`, then letters, digits or `_`. */
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

const URL_PROTOCOLS = ['http:', 'https:'];

/**
 * Types the default export of `boilerlift.config.ts` in the editor and returns it unchanged. The CLI checks it again
 * when it loads the file.
 */
export function defineConfig<const Config extends BoilerliftConfig>(config: Config): Config {
  return config;
}

/**
 * Checks the default export of the config file. Every problem is listed at once. The targets keep the order of the
 * object keys; each url loses its trailing slashes.
 */
function parseProjectConfig(file: ProjectConfigFile): Result<ProjectConfig, ConfigError> {
  switch (file.kind) {
  case 'missing':
    return err({ kind: 'no-config-file' });
  case 'unreadable':
    return err({ kind: 'unreadable-config', reason: file.reason });
  case 'loaded':
    return parseContent(file.content);
  }
}

function parseContent(content: unknown): Result<ProjectConfig, ConfigError> {
  if (!isRecord(content)) {
    return err({ kind: 'invalid-config', problems: ['the default export must be defineConfig({ targets: { … } })'] });
  }
  if (!isRecord(content.targets) || Object.keys(content.targets).length === 0) {
    return err({ kind: 'invalid-config', problems: ['"targets" must be an object that declares at least one target'] });
  }
  const problems: string[] = [];
  const targets: DeclaredTarget[] = [];
  for (const [name, raw] of Object.entries(content.targets)) {
    const target = parseTarget(name, raw);
    if (target.ok) {
      targets.push(target.value);
    } else {
      problems.push(...target.error);
    }
  }
  return problems.length > 0 ? err({ kind: 'invalid-config', problems }) : ok({ targets });
}

function parseTarget(name: string, raw: unknown): Result<DeclaredTarget, string[]> {
  const where = `target "${name}"`;
  if (!TARGET_NAME_PATTERN.test(name)) {
    return err([`${where}: a target name must be 1 to 64 lowercase letters, digits or dashes`]);
  }
  if (!isRecord(raw)) {
    return err([`${where} must be an object with url, apiKeyEnv and workflows`]);
  }
  const problems: string[] = [];
  const url = typeof raw.url === 'string' ? raw.url.trim() : '';
  if (!isHttpUrl(url)) {
    problems.push(`${where}: "url" must be an http:// or https:// URL, found ${JSON.stringify(raw.url) ?? 'nothing'}`);
  }
  const apiKeyEnv = typeof raw.apiKeyEnv === 'string' ? raw.apiKeyEnv.trim() : '';
  if (!ENV_NAME_PATTERN.test(apiKeyEnv)) {
    problems.push(`${where}: "apiKeyEnv" must name an environment variable, such as 'N8N_API_KEY'`);
  }
  const workflows = typeof raw.workflows === 'string' ? raw.workflows.trim() : '';
  if (workflows === '') {
    problems.push(`${where}: "workflows" must be the folder of its workflow files, such as './workflows'`);
  }
  if (problems.length > 0) {
    return err(problems);
  }
  return ok({ name, url: url.replace(/\/+$/, ''), apiKeyEnv, workflows });
}

function isHttpUrl(value: string): boolean {
  return URL.canParse(value) && URL_PROTOCOLS.includes(new URL(value).protocol);
}

/**
 * The declared targets a command runs on. With no name, the config must declare a single target; `--all` takes
 * every one, in declaration order.
 */
function selectTargets(config: ProjectConfig, selection: TargetSelection): Result<DeclaredTarget[], ConfigError> {
  const available = targetNames(config);
  switch (selection.kind) {
  case 'all':
    return ok(config.targets);
  case 'default':
    return config.targets.length === 1 ? ok(config.targets) : err({ kind: 'target-required', available });
  case 'one': {
    const target = config.targets.find(({ name }) => name === selection.name);
    return target === undefined ? err({ kind: 'unknown-target', name: selection.name, available }) : ok([target]);
  }
  }
}

/**
 * Reads the API key of each target from the environment, then from the text of `./.env`: a real environment variable
 * wins over `.env`, and a blank value counts as missing. The first target whose key is missing fails them all, so
 * nothing runs while one is broken.
 */
function resolveTargets(
  targets: DeclaredTarget[],
  available: string[],
  env: Readonly<Record<string, string | undefined>>,
  dotEnvText: string | undefined,
): Result<Target[], ConfigError> {
  const dotEnv = dotEnvText === undefined ? {} : parseEnv(dotEnvText);
  const resolved: Target[] = [];
  for (const target of targets) {
    const apiKey = pick(target.apiKeyEnv, env, dotEnv);
    if (apiKey === undefined) {
      return err({ kind: 'missing-api-key', target: target.name, apiKeyEnv: target.apiKeyEnv, available });
    }
    resolved.push({
      name: target.name,
      apiKeyEnv: target.apiKeyEnv,
      workflows: target.workflows,
      connection: { url: { value: target.url, source: CONFIG_FILE }, apiKey },
    });
  }
  return ok(resolved);
}

/**
 * The targets a command runs on, from the config file, the selection and the environment: the config is parsed, the
 * targets selected, then every API key read. Any failure stops before a target runs.
 */
export function targetsToRun(
  file: ProjectConfigFile,
  selection: TargetSelection,
  env: Readonly<Record<string, string | undefined>>,
  dotEnvText: string | undefined,
): Result<{ config: ProjectConfig; targets: Target[] }, ConfigError> {
  const config = parseProjectConfig(file);
  if (!config.ok) {
    return config;
  }
  const selected = selectTargets(config.value, selection);
  if (!selected.ok) {
    return selected;
  }
  const available = targetNames(config.value);
  const targets = resolveTargets(selected.value, available, env, dotEnvText);
  return targets.ok ? ok({ config: config.value, targets: targets.value }) : targets;
}

/**
 * Fails on the first target whose workflows folder does not exist, so a command that reads the folders runs nothing
 * while one is missing. `isDirectory` answers for a path relative to the current folder.
 */
export async function checkWorkflowFolders(
  config: ProjectConfig,
  targets: Target[],
  isDirectory: (path: string) => Promise<boolean>,
): Promise<Result<void, ConfigError>> {
  for (const target of targets) {
    if (!(await isDirectory(target.workflows))) {
      return err({ kind: 'missing-workflows', target: target.name, workflows: target.workflows, available: targetNames(config) });
    }
  }
  return ok(undefined);
}

function targetNames(config: ProjectConfig): string[] {
  return config.targets.map(({ name }) => name);
}

/** The names of the targets the config declares, when the error carries them; `[]` otherwise. */
export function availableTargets(error: ConfigError): string[] {
  return 'available' in error ? error.available : [];
}

function pick(
  key: string,
  env: Readonly<Record<string, string | undefined>>,
  dotEnv: Readonly<Record<string, string | undefined>>,
): ConfigValue | undefined {
  const fromEnv = env[key]?.trim();
  if (fromEnv !== undefined && fromEnv !== '') {
    return { value: fromEnv, source: 'env' };
  }
  const fromDotEnv = dotEnv[key]?.trim();
  if (fromDotEnv !== undefined && fromDotEnv !== '') {
    return { value: fromDotEnv, source: '.env' };
  }
  return undefined;
}
