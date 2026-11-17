import { describe, expect, test } from 'vitest';
import { CommandContext } from '#src/cli/cli.model';
import { fakeContext } from '#src/cli/cli.fake';
import { pingCommand } from '#src/cli/commands/ping/ping.command';
import { fakeN8n, httpError, unreachable } from '#src/core/n8n/n8n.fake';

const INPUT = { positionals: [], values: {} };
const API_KEY = 'super-secret-key';
const ENV = { N8N_URL: 'https://n8n.example.com', N8N_API_KEY: API_KEY };

function context(overrides: Partial<CommandContext>): CommandContext {
  return fakeContext({ registry: [pingCommand], nodeVersion: '24.1.0', ...overrides });
}

describe('pingCommand', () => {
  test('Should exit 1 and print the lines to add when both values are missing', async () => {
    const ctx = context({});

    const result = await pingCommand.run(INPUT, ctx);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Missing N8N_URL and N8N_API_KEY.');
    expect(result.stderr).toContain('  N8N_URL=https://your-n8n.example.com\n');
    expect(result.stderr).toContain('  N8N_API_KEY=your-n8n-api-key\n');
  });

  test('Should exit 1 and name only the missing value when the other one is set', async () => {
    const ctx = context({ dotEnv: 'N8N_URL=https://n8n.example.com\n' });

    const result = await pingCommand.run(INPUT, ctx);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Missing N8N_API_KEY.');
    expect(result.stderr).not.toContain('N8N_URL=');
  });

  test('Should exit 0 and print every check when the instance accepts the key', async () => {
    const n8n = fakeN8n();
    const ctx = context({ env: ENV, fetch: n8n.fetch });

    const result = await pingCommand.run(INPUT, ctx);

    expect(result).toEqual({
      exitCode: 0,
      stderr: '',
      stdout: `n8nlift ping
  URL      https://n8n.example.com (from env)
  API key  •••• (set, from env)

✓ Node     24.1.0 (requires ≥ 22.18.0)
✓ URL      reachable (GET /healthz → 200)
✓ API key  accepted (GET /api/v1/workflows → 200)

All checks passed.
`,
    });
  });

  test('Should check the health, then the key, at N8N_URL when it pings', async () => {
    const n8n = fakeN8n();
    const ctx = context({ env: ENV, fetch: n8n.fetch });

    await pingCommand.run(INPUT, ctx);

    expect(n8n.requests).toEqual(['GET https://n8n.example.com/healthz', 'GET https://n8n.example.com/api/v1/workflows?limit=1']);
  });

  test('Should never print the API key when the key is rejected', async () => {
    const n8n = fakeN8n({ failures: [httpError('GET /api/v1/workflows', 401)] });
    const ctx = context({ env: ENV, fetch: n8n.fetch });

    const result = await pingCommand.run(INPUT, ctx);

    expect(result.stdout).not.toContain(API_KEY);
    expect(result.stderr).not.toContain(API_KEY);
    expect(result.stdout).toContain('API key  •••• (set, from env)');
  });

  test('Should show where each value comes from when they come from env and .env', async () => {
    const n8n = fakeN8n();
    const ctx = context({
      env: { N8N_API_KEY: API_KEY },
      dotEnv: 'N8N_URL=https://from-file.example.com\nN8N_API_KEY=other',
      fetch: n8n.fetch,
    });

    const result = await pingCommand.run(INPUT, ctx);

    expect(result.stdout).toContain('URL      https://from-file.example.com (from .env)');
    expect(result.stdout).toContain('API key  •••• (set, from env)');
  });

  test('Should exit 2 and show the failed Node check when Node is too old', async () => {
    const n8n = fakeN8n();
    const ctx = context({ env: ENV, fetch: n8n.fetch, nodeVersion: '20.11.0' });

    const result = await pingCommand.run(INPUT, ctx);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain('✗ Node     20.11.0 is too old (requires ≥ 22.18.0)');
  });

  test('Should skip the URL check without a call when Node is too old', async () => {
    const n8n = fakeN8n();
    const ctx = context({ env: ENV, fetch: n8n.fetch, nodeVersion: '20.11.0' });

    const result = await pingCommand.run(INPUT, ctx);

    expect(result.stdout).toContain('– URL      skipped because the Node check failed');
    expect(n8n.requests).toEqual([]);
  });

  test('Should exit 3 with the next step when the URL is unreachable', async () => {
    const n8n = fakeN8n({ failures: [unreachable('GET /healthz', 'connection refused')] });
    const ctx = context({ env: ENV, fetch: n8n.fetch });

    const result = await pingCommand.run(INPUT, ctx);

    expect(result.exitCode).toBe(3);
    expect(result.stdout).toContain('✗ URL      unreachable: connection refused');
    expect(result.stdout).toContain('           → Check N8N_URL');
    expect(result.stderr).toBe('1 check failed. Exit code 3.\n');
  });

  test('Should skip the API key check when the URL is unreachable', async () => {
    const n8n = fakeN8n({ failures: [unreachable('GET /healthz', 'connection refused')] });
    const ctx = context({ env: ENV, fetch: n8n.fetch });

    const result = await pingCommand.run(INPUT, ctx);

    expect(result.stdout).toContain('– API key  skipped because the URL check failed');
  });

  test('Should warn about http:// when N8N_URL uses it', async () => {
    const n8n = fakeN8n();
    const ctx = context({ env: { ...ENV, N8N_URL: 'http://localhost:5678' }, fetch: n8n.fetch });

    const result = await pingCommand.run(INPUT, ctx);

    expect(result.stdout).toContain('  ! N8N_URL uses http://');
  });

  test('Should exit 4 with a next step when the API key is rejected', async () => {
    const n8n = fakeN8n({ failures: [httpError('GET /api/v1/workflows', 401)] });
    const ctx = context({ env: ENV, fetch: n8n.fetch });

    const result = await pingCommand.run(INPUT, ctx);

    expect(result.exitCode).toBe(4);
    expect(result.stdout).toContain('✗ API key  rejected (GET /api/v1/workflows → 401)');
    expect(result.stdout).toContain(
      '           → Create a key in n8n → Settings → n8n API, then set N8N_API_KEY in .env',
    );
    expect(result.stdout).toContain('1 check failed. Exit code 4.');
    expect(result.stderr).toBe('1 check failed. Exit code 4.\n');
  });

  test('Should exit 1 with the line to fix, and call nothing, when N8N_URL has no scheme', async () => {
    const ctx = context({ dotEnv: 'N8N_URL=n8n.example.com\nN8N_API_KEY=secret\n' });

    const result = await pingCommand.run(INPUT, ctx);

    expect(result).toEqual({
      exitCode: 1,
      stdout: '',
      stderr:
        'Invalid N8N_URL "n8n.example.com" (from .env): it must be an http:// or https:// URL.\n' +
        'Fix it in .env, for example:\n' +
        '  N8N_URL=https://your-n8n.example.com\n',
    });
  });
});
