import { describe, expect, test } from 'vitest';
import { ProjectConfigFile } from '#src/core/config/config.model';
import { defineConfig, targetsToRun } from '#src/core/config/project-config';

const DEV = { url: 'https://dev.example.com', apiKeyEnv: 'DEV_KEY', workflows: './workflows' };
const PROD = { url: 'https://prod.example.com/', apiKeyEnv: 'PROD_KEY', workflows: './prod' };
const KEYS = { DEV_KEY: 'dev-secret', PROD_KEY: 'prod-secret' };

function loaded(content: unknown): ProjectConfigFile {
  return { kind: 'loaded', content };
}

describe('targetsToRun', () => {
  test('Should run on the only target when the config declares one and none is named', () => {
    const file = loaded({ targets: { dev: DEV } });

    const result = targetsToRun(file, { kind: 'default' }, KEYS, undefined);

    expect(result).toMatchObject({
      ok: true,
      value: {
        targets: [
          {
            name: 'dev',
            apiKeyEnv: 'DEV_KEY',
            workflows: './workflows',
            connection: {
              url: { value: 'https://dev.example.com', source: 'boilerlift.config.ts' },
              apiKey: { value: 'dev-secret', source: 'env' },
            },
          },
        ],
      },
    });
  });

  test('Should accept the name of the only target when --target names it', () => {
    const file = loaded({ targets: { dev: DEV } });

    const result = targetsToRun(file, { kind: 'one', name: 'dev' }, KEYS, undefined);

    expect(result.ok).toBe(true);
  });

  test('Should keep the declaration order and drop trailing slashes when --all selects every target', () => {
    const file = loaded({ targets: { prod: PROD, dev: DEV } });

    const result = targetsToRun(file, { kind: 'all' }, KEYS, undefined);

    expect(result.ok ? result.value.targets.map((target) => [target.name, target.connection.url.value]) : []).toEqual([
      ['prod', 'https://prod.example.com'],
      ['dev', 'https://dev.example.com'],
    ]);
  });

  test('Should fail with the available targets when several are declared and none is named', () => {
    const file = loaded({ targets: { dev: DEV, prod: PROD } });

    const result = targetsToRun(file, { kind: 'default' }, KEYS, undefined);

    expect(result).toEqual({ ok: false, error: { kind: 'target-required', available: ['dev', 'prod'] } });
  });

  test('Should fail with the available targets when --target names an undeclared target', () => {
    const file = loaded({ targets: { dev: DEV, prod: PROD } });

    const result = targetsToRun(file, { kind: 'one', name: 'staging' }, KEYS, undefined);

    expect(result).toEqual({ ok: false, error: { kind: 'unknown-target', name: 'staging', available: ['dev', 'prod'] } });
  });

  test('Should read the API key from .env when the environment does not set it', () => {
    const file = loaded({ targets: { dev: DEV } });

    const result = targetsToRun(file, { kind: 'default' }, { DEV_KEY: '  ' }, 'DEV_KEY="from-file"\n');

    expect(result).toMatchObject({ ok: true, value: { targets: [{ connection: { apiKey: { value: 'from-file', source: '.env' } } }] } });
  });

  test('Should prefer the environment over .env when both set the API key', () => {
    const file = loaded({ targets: { dev: DEV } });

    const result = targetsToRun(file, { kind: 'default' }, KEYS, 'DEV_KEY=from-file\n');

    expect(result).toMatchObject({ ok: true, value: { targets: [{ connection: { apiKey: { source: 'env' } } }] } });
  });

  test('Should fail on the first target without a key when --all selects every target', () => {
    const file = loaded({ targets: { dev: DEV, prod: PROD } });

    const result = targetsToRun(file, { kind: 'all' }, { DEV_KEY: 'dev-secret' }, undefined);

    expect(result).toEqual({
      ok: false,
      error: { kind: 'missing-api-key', target: 'prod', apiKeyEnv: 'PROD_KEY', available: ['dev', 'prod'] },
    });
  });

  test('Should fail as missing when there is no config file', () => {
    const result = targetsToRun({ kind: 'missing' }, { kind: 'default' }, KEYS, undefined);

    expect(result).toEqual({ ok: false, error: { kind: 'no-config-file' } });
  });

  test('Should list every problem of every target when the config is invalid', () => {
    const file = loaded({ targets: { Dev: DEV, prod: { url: 'ftp://prod.example.com', apiKeyEnv: 'not a name', workflows: '' } } });

    const result = targetsToRun(file, { kind: 'all' }, KEYS, undefined);

    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'invalid-config',
        problems: [
          'target "Dev": a target name must be 1 to 64 lowercase letters, digits or dashes',
          'target "prod": "url" must be an http:// or https:// URL, found "ftp://prod.example.com"',
          `target "prod": "apiKeyEnv" must name an environment variable, such as 'N8N_API_KEY'`,
          `target "prod": "workflows" must be the folder of its workflow files, such as './workflows'`,
        ],
      },
    });
  });

  test.each([
    ['is not an object', 'targets'],
    ['has no targets', {}],
    ['declares no target', { targets: {} }],
  ])('Should fail as an invalid config when the default export %s', (_condition, content) => {
    const result = targetsToRun(loaded(content), { kind: 'default' }, KEYS, undefined);

    expect(result).toMatchObject({ ok: false, error: { kind: 'invalid-config' } });
  });
});

describe('defineConfig', () => {
  test('Should return the config unchanged when a config file calls it', () => {
    const config = { targets: { dev: DEV } };

    const result = defineConfig(config);

    expect(result).toBe(config);
  });
});
