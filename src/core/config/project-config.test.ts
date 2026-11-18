import { describe, expect, test } from 'vitest';
import { ProjectConfigFile } from '#src/core/config/config.model';
import { defineConfig, targetsToRun } from '#src/core/config/project-config';

const DEV = { url: 'https://dev.example.com', apiKey: 'dev-secret', workflows: './workflows' };
const PROD = { url: 'https://prod.example.com/', apiKey: 'prod-secret', workflows: './prod' };

function loaded(content: unknown): ProjectConfigFile {
  return { kind: 'loaded', content };
}

describe('targetsToRun', () => {
  test('Should run on the only target when the config declares one and none is named', () => {
    const file = loaded({ targets: { dev: DEV } });

    const result = targetsToRun(file, { kind: 'default' });

    expect(result).toMatchObject({
      ok: true,
      value: {
        targets: [
          {
            name: 'dev',
            workflows: './workflows',
            connection: {
              url: { value: 'https://dev.example.com', source: 'boilerlift.config.ts' },
              apiKey: { value: 'dev-secret', source: 'boilerlift.config.ts' },
            },
          },
        ],
      },
    });
  });

  test('Should accept the name of the only target when --target names it', () => {
    const file = loaded({ targets: { dev: DEV } });

    const result = targetsToRun(file, { kind: 'one', name: 'dev' });

    expect(result.ok).toBe(true);
  });

  test('Should keep the declaration order and drop trailing slashes when --all selects every target', () => {
    const file = loaded({ targets: { prod: PROD, dev: DEV } });

    const result = targetsToRun(file, { kind: 'all' });

    expect(result.ok ? result.value.targets.map((target) => [target.name, target.connection.url.value]) : []).toEqual([
      ['prod', 'https://prod.example.com'],
      ['dev', 'https://dev.example.com'],
    ]);
  });

  test('Should fail with the available targets when several are declared and none is named', () => {
    const file = loaded({ targets: { dev: DEV, prod: PROD } });

    const result = targetsToRun(file, { kind: 'default' });

    expect(result).toEqual({ ok: false, error: { kind: 'target-required', available: ['dev', 'prod'] } });
  });

  test('Should fail with the available targets when --target names an undeclared target', () => {
    const file = loaded({ targets: { dev: DEV, prod: PROD } });

    const result = targetsToRun(file, { kind: 'one', name: 'staging' });

    expect(result).toEqual({ ok: false, error: { kind: 'unknown-target', name: 'staging', available: ['dev', 'prod'] } });
  });

  test.each([
    ['is undefined, as an unset environment variable reads', undefined],
    ['is blank', '  '],
  ])('Should fail as a missing API key when the apiKey of a selected target %s', (_condition, apiKey) => {
    const file = loaded({ targets: { dev: DEV, prod: { ...PROD, apiKey } } });

    const result = targetsToRun(file, { kind: 'all' });

    expect(result).toEqual({ ok: false, error: { kind: 'missing-api-key', target: 'prod', available: ['dev', 'prod'] } });
  });

  test('Should run on a target when another target, not selected, has no API key', () => {
    const file = loaded({ targets: { dev: DEV, prod: { ...PROD, apiKey: undefined } } });

    const result = targetsToRun(file, { kind: 'one', name: 'dev' });

    expect(result.ok).toBe(true);
  });

  test('Should fail as missing when there is no config file', () => {
    const result = targetsToRun({ kind: 'missing' }, { kind: 'default' });

    expect(result).toEqual({ ok: false, error: { kind: 'no-config-file' } });
  });

  test('Should list every problem of every target when the config is invalid', () => {
    const file = loaded({
      targets: { Dev: DEV, prod: { url: 'ftp://prod.example.com', apiKey: 42, workflows: '' }, qa: { ...DEV, url: undefined } },
    });

    const result = targetsToRun(file, { kind: 'all' });

    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'invalid-config',
        problems: [
          'target "Dev": a target name must be 1 to 64 lowercase letters, digits or dashes',
          'target "prod": "url" must be an http:// or https:// URL, found "ftp://prod.example.com"',
          'target "prod": "apiKey" must be a string, such as process.env.N8N_API_KEY',
          `target "prod": "workflows" must be the folder of its workflow files, such as './workflows'`,
          'target "qa": "url" is empty: set it, or the environment variable it reads, to the root URL of your n8n instance',
        ],
      },
    });
  });

  test('Should never show the API key when it reports the problems of a target', () => {
    const file = loaded({ targets: { dev: { url: 'nope', apiKey: 'top-secret', workflows: '' } } });

    const result = targetsToRun(file, { kind: 'default' });

    expect(JSON.stringify(result)).not.toContain('top-secret');
  });

  test.each([
    ['is not an object', 'targets'],
    ['has no targets', {}],
    ['declares no target', { targets: {} }],
  ])('Should fail as an invalid config when the default export %s', (_condition, content) => {
    const result = targetsToRun(loaded(content), { kind: 'default' });

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
