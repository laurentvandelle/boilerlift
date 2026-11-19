import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

import { MIN_N8N_VERSION } from '#src/core/n8n/n8n-api';

const README = join(__dirname, '..', '..', '..', 'README.md');

describe('MIN_N8N_VERSION', () => {
  test('Should match the n8n version of the README badge when the minimum n8n version changes', () => {
    const readme = readFileSync(README, 'utf8');

    const badge = /img\.shields\.io\/badge\/n8n-%3E%3D([0-9.]+)-/.exec(readme);

    expect(badge?.[1]).toBe(MIN_N8N_VERSION);
  });
});
