import { Check, CheckConnectionInput, CheckName, ConnectionReport, FailedCheck } from '#src/core/connection/connection.model';
import { EXIT_API_KEY_REJECTED, EXIT_NODE_TOO_OLD, EXIT_OK, EXIT_UNREACHABLE } from '#src/core/exit/exit-codes';
import { API_KEY_HINT, API_PATH, classifyHttpError } from '#src/core/n8n/n8n-api';

/** The oldest Node.js that n8nlift runs on (`engines` in package.json). */
export const MIN_NODE_VERSION = '22.18.0';

/** MIN_NODE_VERSION as hints and usage texts write it, without a `.0` patch: `22.18`. */
export const MIN_NODE_VERSION_SHORT = MIN_NODE_VERSION.replace(/\.0$/, '');

export const CHECK_LABELS: Record<CheckName, string> = { node: 'Node', url: 'URL', apiKey: 'API key' };

type Step = () => Promise<Check>;

/** Runs the checks in order. After the first failure, the remaining checks are skipped. Read-only. */
export async function checkConnection({ nodeVersion, config, client }: CheckConnectionInput): Promise<ConnectionReport> {
  const steps: [CheckName, Step][] = [
    ['node', (): Promise<Check> => Promise.resolve(checkNode(nodeVersion))],
    ['url', (): Promise<Check> => checkUrl(client)],
    ['apiKey', (): Promise<Check> => checkApiKey(client)],
  ];
  const checks: Check[] = [];
  let failed: FailedCheck | undefined;
  for (const [name, step] of steps) {
    if (failed !== undefined) {
      checks.push({ name, status: 'skipped', detail: `skipped because the ${CHECK_LABELS[failed.name]} check failed` });
      continue;
    }
    const check = await step();
    checks.push(check);
    if (check.status === 'failed') {
      failed = check;
    }
  }
  return { checks, warnings: warningsFor(config.url.value), exitCode: failed?.exitCode ?? EXIT_OK };
}

function checkNode(nodeVersion: string): Check {
  if (compareVersions(nodeVersion, MIN_NODE_VERSION) >= 0) {
    return { name: 'node', status: 'ok', detail: `${nodeVersion} (requires ≥ ${MIN_NODE_VERSION})` };
  }
  return {
    name: 'node',
    status: 'failed',
    detail: `${nodeVersion} is too old (requires ≥ ${MIN_NODE_VERSION})`,
    hint: `Install Node ${MIN_NODE_VERSION_SHORT} or later`,
    exitCode: EXIT_NODE_TOO_OLD,
  };
}

async function checkUrl(client: CheckConnectionInput['client']): Promise<Check> {
  const result = await client.checkHealth();
  const hint = 'Check N8N_URL: it must be the root URL of your n8n instance, for example https://your-n8n.example.com';
  if (result.ok) {
    return { name: 'url', status: 'ok', detail: `reachable (${result.value.call} → ${result.value.status})` };
  }
  const failure = result.error;
  switch (failure.kind) {
  case 'unreachable':
    return { name: 'url', status: 'failed', detail: `unreachable: ${failure.reason}`, hint, exitCode: EXIT_UNREACHABLE };
  case 'http-error':
    return {
      name: 'url',
      status: 'failed',
      detail: `not healthy (${failure.call} → ${failure.status})`,
      hint,
      exitCode: EXIT_UNREACHABLE,
    };
  }
}

async function checkApiKey(client: CheckConnectionInput['client']): Promise<Check> {
  const result = await client.checkApiKey();
  if (result.ok) {
    return { name: 'apiKey', status: 'ok', detail: `accepted (${result.value.call} → ${result.value.status})` };
  }
  const failure = result.error;
  if (failure.kind === 'unreachable') {
    return {
      name: 'apiKey',
      status: 'failed',
      detail: `unreachable: ${failure.reason}`,
      hint: 'Check N8N_URL and your network, then run ping again',
      exitCode: EXIT_UNREACHABLE,
    };
  }
  const call = `${failure.call} → ${failure.status}`;
  switch (classifyHttpError(failure.status)) {
  case 'key-rejected':
    return { name: 'apiKey', status: 'failed', detail: `rejected (${call})`, hint: API_KEY_HINT, exitCode: EXIT_API_KEY_REJECTED };
  case 'not-found':
    return {
      name: 'apiKey',
      status: 'failed',
      detail: `public API not found at ${API_PATH} (${call})`,
      hint: 'Check N8N_URL, or whether the public API is enabled on the instance',
      exitCode: EXIT_UNREACHABLE,
    };
  case 'other':
    return {
      name: 'apiKey',
      status: 'failed',
      detail: `unexpected answer (${call})`,
      hint: 'Check that N8N_URL points to an n8n instance and that it is running',
      exitCode: EXIT_UNREACHABLE,
    };
  }
}

function warningsFor(url: string): string[] {
  if (url.toLowerCase().startsWith('http://')) {
    return ['N8N_URL uses http://: the API key is sent unencrypted. Use https:// outside local development.'];
  }
  return [];
}

/** Compares two `x.y.z` versions (a leading `v` and any pre-release suffix are ignored). */
function compareVersions(left: string, right: string): number {
  const parse = (version: string): number[] => {
    const [core = ''] = version.replace(/^v/, '').split(/[-+]/);
    return core.split('.').map((part) => Number.parseInt(part, 10) || 0);
  };
  const [a, b] = [parse(left), parse(right)];
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) {
      return Math.sign(difference);
    }
  }
  return 0;
}
