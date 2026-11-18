import { describe, expect, test } from 'vitest';
import { ConnectionConfig } from '#src/core/config/config.model';
import { checkConnection } from '#src/core/connection/check-connection';
import { fakeN8n, httpError, unreachable } from '#src/core/n8n/n8n.fake';
import { ApiFailure } from '#src/core/n8n/n8n.model';

const HTTPS_CONFIG: ConnectionConfig = {
  url: { value: 'https://n8n.example.com', source: 'env' },
  apiKey: { value: 'secret', source: 'env' },
};

describe('checkConnection', () => {
  test('Should pass every check and exit 0 when the instance accepts the key', async () => {
    const n8n = fakeN8n();

    const report = await checkConnection({ nodeVersion: '24.1.0', config: HTTPS_CONFIG, client: n8n.client });

    expect(report.exitCode).toBe(0);
    expect(report.checks.map(({ name, status }) => [name, status])).toEqual([
      ['node', 'ok'],
      ['url', 'ok'],
      ['apiKey', 'ok'],
    ]);
  });

  test('Should name the health call and its status when the URL is reachable', async () => {
    const n8n = fakeN8n();

    const report = await checkConnection({ nodeVersion: '24.1.0', config: HTTPS_CONFIG, client: n8n.client });

    expect(report.checks[1]?.detail).toBe('reachable (GET /healthz → 200)');
  });

  test.each([['22.18.0'], ['22.18.1'], ['v24.0.0'], ['23.0.0-nightly']])('Should pass the Node check when Node is %s', async (nodeVersion) => {
    const n8n = fakeN8n();

    const report = await checkConnection({ nodeVersion, config: HTTPS_CONFIG, client: n8n.client });

    expect(report.checks[0]).toMatchObject({ name: 'node', status: 'ok' });
  });

  test.each([['22.17.1'], ['22.9.0']])('Should fail the Node check with exit 2 and the install hint when Node is %s', async (nodeVersion) => {
    const n8n = fakeN8n();

    const report = await checkConnection({ nodeVersion, config: HTTPS_CONFIG, client: n8n.client });

    expect(report.exitCode).toBe(2);
    expect(report.checks[0]).toMatchObject({ status: 'failed', hint: 'Install Node 22.18 or later' });
  });

  test('Should skip the URL and API key checks without a call when Node is too old', async () => {
    const n8n = fakeN8n();

    const report = await checkConnection({ nodeVersion: '22.17.1', config: HTTPS_CONFIG, client: n8n.client });

    expect(report.checks[1]).toMatchObject({ status: 'skipped', detail: 'skipped because the Node check failed' });
    expect(report.checks[2]).toMatchObject({ status: 'skipped' });
    expect(n8n.calls).toEqual([]);
  });

  test('Should fail with exit 3 and the url hint when the URL is unreachable', async () => {
    const n8n = fakeN8n({ failures: [unreachable('GET /healthz', 'connection refused')] });

    const report = await checkConnection({ nodeVersion: '24.1.0', config: HTTPS_CONFIG, client: n8n.client });

    expect(report.exitCode).toBe(3);
    const check = report.checks[1];
    expect(check).toMatchObject({ status: 'failed', detail: 'unreachable: connection refused' });
    expect(check?.status === 'failed' ? check.hint : '').toContain('Check the url of the target');
  });

  test('Should skip the API key check when the URL is unreachable', async () => {
    const n8n = fakeN8n({ failures: [unreachable('GET /healthz', 'connection refused')] });

    const report = await checkConnection({ nodeVersion: '24.1.0', config: HTTPS_CONFIG, client: n8n.client });

    expect(report.checks[2]).toMatchObject({ status: 'skipped', detail: 'skipped because the URL check failed' });
    expect(n8n.calls).toEqual(['GET /healthz']);
  });

  test('Should fail with exit 3 when /healthz answers with an error status', async () => {
    const n8n = fakeN8n({ failures: [httpError('GET /healthz', 503)] });

    const report = await checkConnection({ nodeVersion: '24.1.0', config: HTTPS_CONFIG, client: n8n.client });

    expect(report.exitCode).toBe(3);
    expect(report.checks[1]?.detail).toBe('not healthy (GET /healthz → 503)');
  });

  test.each([[401], [403]])('Should fail with exit 4 when the API key check gets %s', async (status) => {
    const n8n = fakeN8n({ failures: [httpError('GET /api/v1/workflows', status)] });

    const report = await checkConnection({ nodeVersion: '24.1.0', config: HTTPS_CONFIG, client: n8n.client });

    expect(report.exitCode).toBe(4);
    expect(report.checks[2]).toMatchObject({
      status: 'failed',
      detail: `rejected (GET /api/v1/workflows → ${status})`,
      hint: 'Create a key in n8n → Settings → n8n API, then set it in the variable that apiKeyEnv names, in .env or your environment',
    });
  });

  test('Should fail with exit 3 when the public API is not found', async () => {
    const n8n = fakeN8n({ failures: [httpError('GET /api/v1/workflows', 404)] });

    const report = await checkConnection({ nodeVersion: '24.1.0', config: HTTPS_CONFIG, client: n8n.client });

    expect(report.exitCode).toBe(3);
    expect(report.checks[2]?.detail).toBe('public API not found at /api/v1 (GET /api/v1/workflows → 404)');
    const check = report.checks[2];
    expect(check?.status === 'failed' ? check.hint : '').toContain('public API is enabled');
  });

  test.each<[string, ApiFailure]>([
    ['answered 500', httpError('GET /api/v1/workflows', 500)],
    ['unreachable', unreachable('GET /api/v1/workflows', 'connection reset')],
  ])('Should fail with exit 3 when the API key check is %s', async (_condition, failure) => {
    const n8n = fakeN8n({ failures: [failure] });

    const report = await checkConnection({ nodeVersion: '24.1.0', config: HTTPS_CONFIG, client: n8n.client });

    expect(report.exitCode).toBe(3);
    expect(report.checks[2]?.status).toBe('failed');
  });

  test('Should warn without failing when the URL uses http://', async () => {
    const config: ConnectionConfig = { ...HTTPS_CONFIG, url: { value: 'http://localhost:5678', source: '.env' } };

    const report = await checkConnection({ nodeVersion: '24.1.0', config, client: fakeN8n().client });

    expect(report.exitCode).toBe(0);
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]).toContain('http://');
  });

  test('Should not warn when the URL uses https://', async () => {
    const n8n = fakeN8n();

    const report = await checkConnection({ nodeVersion: '24.1.0', config: HTTPS_CONFIG, client: n8n.client });

    expect(report.warnings).toEqual([]);
  });
});
