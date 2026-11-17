import { CliResult } from '#src/cli/cli.model';
import { EXIT_OK } from '#src/core/common/exit-codes';

/** The n8nlift version, alone on stdout. */
export function renderVersion(version: string): CliResult {
  return { exitCode: EXIT_OK, stdout: `${version}\n`, stderr: '' };
}
