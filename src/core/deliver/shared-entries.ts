import { baseNameOf, isStableName } from '#src/core/compile/load-workflows';

/** The workflow files of one declared target, and the instance its lock entries are recorded under. */
export interface TargetFiles {
  target: string;
  /** The url of the target, without trailing slash: its key in the lock file. */
  instance: string;
  paths: string[];
}

/** Two targets that would record the same stable name under the same instance in the lock file. */
export interface SharedEntry {
  stableName: string;
  instance: string;
  first: { target: string; path: string };
  second: { target: string; path: string };
}

/**
 * Every pair of targets on the same instance whose folders hold a workflow of the same stable name, when one of the
 * two is in `selected`. Both would record it under one entry of the lock file and overwrite each other's workflow.
 * Pairs come in declaration order; a path that is not a valid stable name is left to the loader.
 */
export function findSharedEntries(selected: readonly string[], targets: readonly TargetFiles[]): SharedEntry[] {
  const shared: SharedEntry[] = [];
  targets.forEach((first, index) => {
    for (const second of targets.slice(index + 1)) {
      if (first.instance !== second.instance || !(selected.includes(first.target) || selected.includes(second.target))) {
        continue;
      }
      const secondPaths = new Map(second.paths.map((path) => [baseNameOf(path), path]));
      for (const path of first.paths) {
        const stableName = baseNameOf(path);
        const other = secondPaths.get(stableName);
        if (other !== undefined && isStableName(stableName)) {
          shared.push({
            stableName,
            instance: first.instance,
            first: { target: first.target, path },
            second: { target: second.target, path: other },
          });
        }
      }
    }
  });
  return shared;
}
