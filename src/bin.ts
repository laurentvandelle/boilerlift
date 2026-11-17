#!/usr/bin/env node
import { CliResult } from '#src/cli/cli.model';
import { nodeContext } from '#src/cli/node-context';
import { crashResult, runCli } from '#src/cli/run-cli';

/** Runs the CLI. The edge: an error that escapes a command is printed with its stack, and exits non-zero. */
async function main(): Promise<void> {
  let result: CliResult;
  try {
    result = await runCli(process.argv.slice(2), nodeContext(process.cwd()));
  } catch (error) {
    result = crashResult(error);
  }
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}

void main();
