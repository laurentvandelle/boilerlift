import { CliResult, CommandContext, SelectedTargets, TargetSelection } from '#src/cli/cli.model';
import { renderConfigError } from '#src/cli/targets.render';
import { Result, err, ok } from '#src/core/common/result';
import { targetsToRun } from '#src/core/config/project-config';
import { createN8nClient } from '#src/services/n8n/n8n-client';

/**
 * The `'targets'` need: the targets of `./boilerlift.config.ts` that `selection` picks, each with a client built on
 * `ctx.fetch`. A config that cannot be used is the CliResult that ends the command: exit 1, the fix on stderr, and
 * the error with the available targets on stdout when `json` is set.
 */
export async function resolveTargets(
  ctx: CommandContext,
  selection: TargetSelection,
  json: boolean,
): Promise<Result<SelectedTargets, CliResult>> {
  const resolved = targetsToRun(await ctx.loadProjectConfig(), selection);
  if (!resolved.ok) {
    return err(renderConfigError(resolved.error, { json }));
  }
  const { config, targets } = resolved.value;
  return ok({
    config,
    selected: targets.map((target) => ({ ...target, client: createN8nClient({ config: target.connection, fetch: ctx.fetch }) })),
  });
}
