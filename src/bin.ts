#!/usr/bin/env node
import { nodeContext } from '#src/cli/node-context';
import { runCli } from '#src/cli/run-cli';

async function main(): Promise<void> {
  const result = await runCli(process.argv.slice(2), nodeContext(process.cwd()));

  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}

void main();
