import { describe, expect, test } from 'vitest';
import { CommandContext } from '#src/cli/cli.model';
import {
  FAKE_DEV_URL as DEV_URL,
  FAKE_PROD_URL as PROD_URL,
  FAKE_TARGET_KEYS as TWO_KEYS,
  fakeContext,
  fakeSingleTarget,
  fakeTwoTargets,
} from '#src/cli/cli.fake';
import { pingCommand } from '#src/cli/commands/ping/ping.command';
import { fakeN8n, fakeN8nByOrigin, httpError, unreachable } from '#src/core/n8n/n8n.fake';

const INPUT = { positionals: [], values: {} };
const JSON_INPUT = { positionals: [], values: { json: true } };
const ALL = { positionals: [], values: { all: true } };
const API_KEY = 'super-secret-key';
const ENV = { N8N_API_KEY: API_KEY };


/** A ping context on the single target `dev` at https://n8n.example.com, its key in N8N_API_KEY. */
function context(overrides: Partial<CommandContext>): CommandContext {
  return fakeContext({ registry: [pingCommand], nodeVersion: '24.1.0', env: ENV, loadProjectConfig: fakeSingleTarget(), ...overrides });
}

describe('pingCommand', () => {
  test('Should exit 1 and print a starter config to copy when there is no boilerlift.config.ts', async () => {
    const ctx = context({ loadProjectConfig: () => Promise.resolve({ kind: 'missing' }) });

    const result = await pingCommand.run(INPUT, ctx);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain("export default defineConfig({\n  targets: {\n    dev: {\n      url: 'https://your-n8n.example.com',");
  });

  test('Should exit 1 and name the variable to set when the API key of the target is missing', async () => {
    const ctx = context({ env: {} });

    const result = await pingCommand.run(INPUT, ctx);

    expect(result).toEqual({
      exitCode: 1,
      stdout: '',
      stderr:
        'Missing N8N_API_KEY, the API key of target "dev" (its apiKeyEnv in boilerlift.config.ts).\n' +
        'Add this line to .env, or set it in your environment:\n' +
        '  N8N_API_KEY=your-n8n-api-key\n',
    });
  });

  test('Should exit 0 and print every check when the instance accepts the key', async () => {
    const n8n = fakeN8n();
    const ctx = context({ fetch: n8n.fetch });

    const result = await pingCommand.run(INPUT, ctx);

    expect(result).toEqual({
      exitCode: 0,
      stderr: '',
      stdout: `lift ping → dev
  URL      https://n8n.example.com (from boilerlift.config.ts)
  API key  •••• (N8N_API_KEY, from env)

✓ Node     24.1.0 (requires ≥ 22.18.0)
✓ URL      reachable (GET /healthz → 200)
✓ API key  accepted (GET /api/v1/workflows → 200)

All checks passed.
`,
    });
  });

  test('Should check the health, then the key, at the url of the target when it pings', async () => {
    const n8n = fakeN8n();
    const ctx = context({ fetch: n8n.fetch });

    await pingCommand.run(INPUT, ctx);

    expect(n8n.requests).toEqual(['GET https://n8n.example.com/healthz', 'GET https://n8n.example.com/api/v1/workflows?limit=1']);
  });

  test('Should never print the API key when the key is rejected', async () => {
    const n8n = fakeN8n({ failures: [httpError('GET /api/v1/workflows', 401)] });
    const ctx = context({ fetch: n8n.fetch });

    const result = await pingCommand.run(INPUT, ctx);

    expect(result.stdout).not.toContain(API_KEY);
    expect(result.stderr).not.toContain(API_KEY);
    expect(result.stdout).toContain('API key  •••• (N8N_API_KEY, from env)');
  });

  test('Should read the API key from .env when the environment does not set it', async () => {
    const n8n = fakeN8n();
    const ctx = context({ env: {}, dotEnv: 'N8N_API_KEY=from-file\n', fetch: n8n.fetch });

    const result = await pingCommand.run(INPUT, ctx);

    expect(result.stdout).toContain('API key  •••• (N8N_API_KEY, from .env)');
  });

  test('Should exit 2 and show the failed Node check when Node is too old', async () => {
    const n8n = fakeN8n();
    const ctx = context({ fetch: n8n.fetch, nodeVersion: '20.11.0' });

    const result = await pingCommand.run(INPUT, ctx);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain('✗ Node     20.11.0 is too old (requires ≥ 22.18.0)');
  });

  test('Should skip the URL check without a call when Node is too old', async () => {
    const n8n = fakeN8n();
    const ctx = context({ fetch: n8n.fetch, nodeVersion: '20.11.0' });

    const result = await pingCommand.run(INPUT, ctx);

    expect(result.stdout).toContain('– URL      skipped because the Node check failed');
    expect(n8n.requests).toEqual([]);
  });

  test('Should exit 3 with the next step when the URL is unreachable', async () => {
    const n8n = fakeN8n({ failures: [unreachable('GET /healthz', 'connection refused')] });
    const ctx = context({ fetch: n8n.fetch });

    const result = await pingCommand.run(INPUT, ctx);

    expect(result.exitCode).toBe(3);
    expect(result.stdout).toContain('✗ URL      unreachable: connection refused');
    expect(result.stdout).toContain('           → Check the url of the target in boilerlift.config.ts');
    expect(result.stderr).toBe('1 check failed. Exit code 3.\n');
  });

  test('Should skip the API key check when the URL is unreachable', async () => {
    const n8n = fakeN8n({ failures: [unreachable('GET /healthz', 'connection refused')] });
    const ctx = context({ fetch: n8n.fetch });

    const result = await pingCommand.run(INPUT, ctx);

    expect(result.stdout).toContain('– API key  skipped because the URL check failed');
  });

  test('Should warn about http:// when the url of the target uses it', async () => {
    const n8n = fakeN8n();
    const ctx = context({ loadProjectConfig: fakeSingleTarget('http://localhost:5678'), fetch: n8n.fetch });

    const result = await pingCommand.run(INPUT, ctx);

    expect(result.stdout).toContain('  ! The url uses http://');
  });

  test('Should exit 4 with a next step when the API key is rejected', async () => {
    const n8n = fakeN8n({ failures: [httpError('GET /api/v1/workflows', 401)] });
    const ctx = context({ fetch: n8n.fetch });

    const result = await pingCommand.run(INPUT, ctx);

    expect(result.exitCode).toBe(4);
    expect(result.stdout).toContain('✗ API key  rejected (GET /api/v1/workflows → 401)');
    expect(result.stdout).toContain(
      '           → Create a key in n8n → Settings → n8n API, then set it in the variable that apiKeyEnv names, in .env or your environment',
    );
    expect(result.stderr).toBe('1 check failed. Exit code 4.\n');
  });

  test('Should exit 1 with the problem, and call nothing, when the url of the target has no scheme', async () => {
    const ctx = context({ loadProjectConfig: fakeSingleTarget('n8n.example.com') });

    const result = await pingCommand.run(INPUT, ctx);

    expect(result).toEqual({
      exitCode: 1,
      stdout: '',
      stderr: 'Invalid boilerlift.config.ts:\n  ✗ target "dev": "url" must be an http:// or https:// URL, found "n8n.example.com"\n',
    });
  });

  test('Should print the checks of the target as JSON, without the key, when --json is set', async () => {
    const n8n = fakeN8n();
    const ctx = context({ fetch: n8n.fetch });

    const result = await pingCommand.run(JSON_INPUT, ctx);

    expect(JSON.parse(result.stdout)).toEqual({
      target: 'dev',
      url: 'https://n8n.example.com',
      apiKey: { env: 'N8N_API_KEY', source: 'env' },
      checks: [
        { name: 'node', status: 'ok', detail: '24.1.0 (requires ≥ 22.18.0)' },
        { name: 'url', status: 'ok', detail: 'reachable (GET /healthz → 200)' },
        { name: 'apiKey', status: 'ok', detail: 'accepted (GET /api/v1/workflows → 200)' },
      ],
      warnings: [],
      exitCode: 0,
    });
  });

  test('Should exit 1, call nothing and list the targets when several are declared and none is named', async () => {
    const n8n = fakeN8n();
    const ctx = context({ loadProjectConfig: fakeTwoTargets(), env: TWO_KEYS, fetch: n8n.fetch });

    const result = await pingCommand.run(INPUT, ctx);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Available targets: dev, prod\n');
    expect(n8n.requests).toEqual([]);
  });

  test('Should ping only the target --target names when several are declared', async () => {
    const dev = fakeN8n();
    const prod = fakeN8n();
    const ctx = context({ loadProjectConfig: fakeTwoTargets(), env: TWO_KEYS, fetch: fakeN8nByOrigin({ [DEV_URL]: dev, [PROD_URL]: prod }) });

    const result = await pingCommand.run({ positionals: [], values: { target: 'prod' } }, ctx);

    expect(result.stdout).toContain('lift ping → prod\n  URL      https://prod.example.com');
    expect(dev.requests).toEqual([]);
  });

  test('Should ping every target, recap each one and exit with the worst code when --all is set', async () => {
    const dev = fakeN8n();
    const prod = fakeN8n({ failures: [httpError('GET /api/v1/workflows', 401)] });
    const ctx = context({ loadProjectConfig: fakeTwoTargets(), env: TWO_KEYS, fetch: fakeN8nByOrigin({ [DEV_URL]: dev, [PROD_URL]: prod }) });

    const result = await pingCommand.run(ALL, ctx);

    expect(result.exitCode).toBe(4);
    expect(result.stdout).toContain(
      'Targets:\n' +
        '  ✓ dev   https://dev.example.com   All checks passed.\n' +
        '  ✗ prod  https://prod.example.com  1 check failed. Exit code 4.\n',
    );
    expect(result.stderr).toBe('── prod (https://prod.example.com)\n1 check failed. Exit code 4.\n');
  });

  test('Should print one entry per target when --all --json is set', async () => {
    const ctx = context({
      loadProjectConfig: fakeTwoTargets(),
      env: TWO_KEYS,
      fetch: fakeN8nByOrigin({ [DEV_URL]: fakeN8n(), [PROD_URL]: fakeN8n() }),
    });

    const result = await pingCommand.run({ positionals: [], values: { all: true, json: true } }, ctx);

    expect(JSON.parse(result.stdout)).toMatchObject({
      targets: [
        { target: 'dev', url: DEV_URL, exitCode: 0 },
        { target: 'prod', url: PROD_URL, exitCode: 0 },
      ],
      exitCode: 0,
    });
  });
});
