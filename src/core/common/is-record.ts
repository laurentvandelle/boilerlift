/** True when `value` is an object whose keys can be read: not null and not an array. An Error counts. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  // eslint-disable-next-line no-restricted-syntax -- the one typeof-object check of src/: every other file calls isRecord
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
