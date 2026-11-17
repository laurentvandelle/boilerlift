/** Joins ids for a sentence: `a`, `a and b`, `a, b and c`. */
export function formatList(items: string[]): string {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1) ?? ''}`;
}
