import { describe, expect, test } from 'vitest';
import { resolveConnectionConfig } from '#src/core/config/connection-config';

describe('resolveConnectionConfig', () => {
  test('Should read both values from the environment when both are set there', () => {
    const env = { N8N_URL: 'https://n8n.example.com', N8N_API_KEY: 'secret' };

    const result = resolveConnectionConfig(env, undefined);

    expect(result).toEqual({
      ok: true,
      value: {
        url: { value: 'https://n8n.example.com', source: 'env' },
        apiKey: { value: 'secret', source: 'env' },
      },
    });
  });

  test('Should read both values from .env when the environment has neither', () => {
    const dotEnv = 'N8N_URL=https://n8n.example.com\n# a comment\nN8N_API_KEY="secret"\n';

    const result = resolveConnectionConfig({}, dotEnv);

    expect(result).toEqual({
      ok: true,
      value: {
        url: { value: 'https://n8n.example.com', source: '.env' },
        apiKey: { value: 'secret', source: '.env' },
      },
    });
  });

  test('Should prefer the environment over .env when a value is set in both', () => {
    const env = { N8N_URL: 'https://from-env.example.com' };
    const dotEnv = 'N8N_URL=https://from-file.example.com\nN8N_API_KEY=secret';

    const result = resolveConnectionConfig(env, dotEnv);

    expect(result).toEqual({
      ok: true,
      value: {
        url: { value: 'https://from-env.example.com', source: 'env' },
        apiKey: { value: 'secret', source: '.env' },
      },
    });
  });

  test('Should fall back to .env when the environment value is empty', () => {
    const env = { N8N_URL: '', N8N_API_KEY: 'secret' };
    const dotEnv = 'N8N_URL=https://n8n.example.com';

    const result = resolveConnectionConfig(env, dotEnv);

    expect(result).toMatchObject({ ok: true, value: { url: { value: 'https://n8n.example.com', source: '.env' } } });
  });

  test('Should strip trailing slashes when the URL ends with them', () => {
    const env = { N8N_URL: 'https://n8n.example.com//', N8N_API_KEY: 'secret' };

    const result = resolveConnectionConfig(env, undefined);

    expect(result).toMatchObject({ ok: true, value: { url: { value: 'https://n8n.example.com' } } });
  });

  test('Should list every missing value when they are blank or absent', () => {
    const env = { N8N_URL: '  ' };

    const result = resolveConnectionConfig(env, 'OTHER=1');

    expect(result).toEqual({ ok: false, error: { kind: 'missing', keys: ['N8N_URL', 'N8N_API_KEY'] } });
  });

  test.each([
    ['has no scheme', 'n8n.example.com'],
    ['uses another scheme', 'ftp://n8n.example.com'],
  ])('Should fail as an invalid URL when N8N_URL %s', (_condition, url) => {
    const dotEnv = `N8N_URL=${url}\nN8N_API_KEY=secret`;

    const result = resolveConnectionConfig({}, dotEnv);

    expect(result).toEqual({ ok: false, error: { kind: 'invalid-url', url: { value: url, source: '.env' } } });
  });
});
