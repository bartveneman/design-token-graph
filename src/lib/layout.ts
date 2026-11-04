import type { TokenGraph } from './tokens';

export const NODE_WIDTH = 300;
export const NODE_HEIGHT = 56;
export const COL_GAP = 160;
export const ROW_GAP = 12;

/**
 * Layered layout, left → right:
 * - column = longest chain of references below a token (raw values in column 0)
 * - order within a column = average row of the tokens it references (barycenter), then by id
 * Tokens without any connection go in a grid below.
 * Linear-ish in the number of tokens + edges, unlike dagre which takes ~a minute on 3k nodes.
 */
export function layoutTokens(graph: TokenGraph): Map<string, { x: number; y: number }> {
  const { tokens } = graph;
  const connected = new Set(graph.edges.flatMap((e) => [e.source, e.target]));

  const rank = new Map<string, number>();
  const visiting = new Set<string>();
  const rankOf = (id: string): number => {
    const known = rank.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0; // reference cycle
    visiting.add(id);
    let r = 0;
    for (const ref of tokens.get(id)!.references) r = Math.max(r, rankOf(ref) + 1);
    visiting.delete(id);
    rank.set(id, r);
    return r;
  };

  const columns: string[][] = [];
  for (const id of connected) (columns[rankOf(id)] ??= []).push(id);

  const row = new Map<string, number>();
  const positions = new Map<string, { x: number; y: number }>();
  let maxY = 0;

  columns.forEach((column = [], c) => {
    const bary = (id: string) => {
      const refs = tokens.get(id)!.references.filter((r) => row.has(r));
      return refs.length ? refs.reduce((sum, r) => sum + row.get(r)!, 0) / refs.length : Infinity;
    };
    const keyed = column.map((id) => ({ id, b: c === 0 ? 0 : bary(id) }));
    keyed.sort((a, b) => a.b - b.b || a.id.localeCompare(b.id));
    keyed.forEach(({ id }, i) => {
      row.set(id, i);
      const y = i * (NODE_HEIGHT + ROW_GAP);
      positions.set(id, { x: c * (NODE_WIDTH + COL_GAP), y });
      maxY = Math.max(maxY, y + NODE_HEIGHT);
    });
  });

  const isolated = [...tokens.keys()].filter((id) => !connected.has(id)).sort();
  const width = Math.max(4, columns.length) * (NODE_WIDTH + COL_GAP);
  const cols = Math.max(1, Math.floor(width / (NODE_WIDTH + 20)));
  const top = connected.size ? maxY + 240 : 0;
  isolated.forEach((id, i) => {
    positions.set(id, {
      x: (i % cols) * (NODE_WIDTH + 20),
      y: top + Math.floor(i / cols) * (NODE_HEIGHT + ROW_GAP),
    });
  });

  return positions;
}
