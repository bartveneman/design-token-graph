import {
  ERROR_CODES,
  EXTENSION_CONTRAST_WITH,
  EXTENSION_RESOLVED_FROM,
  SKIP,
  StrictThemeSchema,
  compareContrast,
  excludeParentKeys,
  extractRef,
  getExtension,
  isRef,
  isValueObject,
  parseColor,
  preprocessThemeStrict,
  walkColors,
  walkObject,
  type ThemeValidationIssue,
} from '@nl-design-system-community/design-tokens-schema';

export interface TokenInfo {
  /** Unique node id: `layer:path.to.token` or `path.to.token` */
  nodeId: string;
  /** Reference id as used inside `{…}`, i.e. without the layer */
  id: string;
  layer?: string;
  type?: string;
  /** Authored value (may contain references) */
  value: unknown;
  /** Final value after following references, if it's a primitive */
  resolved?: string;
  /** Raw reference ids found in `$value` */
  refs: string[];
  /** nodeIds this token references */
  references: string[];
  /** nodeIds of tokens referencing this token */
  usedBy: string[];
  /** Refs that could not be resolved */
  unresolved: string[];
  /** Whether this token is in a layer where "never used" matters (basis / common/*) */
  checkUnused: boolean;
  unused: boolean;
  /** Theme validation errors for this token */
  issues: string[];
  /** Colors this token must have enough contrast with (both directions of a `contrast-with` pair) */
  contrast: ContrastPair[];
}

export interface ContrastPair {
  nodeId: string;
  expectedRatio: number;
  /** WCAG 2.1 ratio of the resolved colors, if both could be parsed */
  ratio?: number;
}

export interface TokenGraph {
  layered: boolean;
  tokens: Map<string, TokenInfo>;
  edges: { source: string; target: string }[];
  /** Theme validation errors that could not be attributed to a token */
  issues: string[];
}

type RawToken = Record<string, unknown> & { $value: unknown };

const EMBEDDED_REF = /\{([^{}\s"]+)\}/g;

const isRawToken = (data: unknown, path: string[]): data is RawToken =>
  isValueObject(data) && Object.hasOwn(data, '$value') && !path.some((p) => p.startsWith('$'));

/** Style Dictionary output keeps the authored value (with refs) in `original.$value`. */
const authoredValue = (token: RawToken): unknown => {
  const original = token['original'];
  return isValueObject(original) && Object.hasOwn(original, '$value') ? original['$value'] : token.$value;
};

/** Collect every `{ref}` in a value: whole-string refs, refs embedded in strings, and refs in composite values. */
const collectRefs = (value: unknown, out: string[] = []): string[] => {
  if (typeof value === 'string') {
    if (isRef(value) && !value.slice(1, -1).includes('{')) out.push(extractRef(value));
    else for (const m of value.matchAll(EMBEDDED_REF)) out.push(m[1]);
  } else if (Array.isArray(value)) {
    value.forEach((v) => collectRefs(v, out));
  } else if (isValueObject(value)) {
    Object.values(value).forEach((v) => collectRefs(v, out));
  }
  return out;
};

/** DTCG allows `$type` on groups, inherited by descendants. */
const inheritedType = (root: Record<string, unknown>, path: string[]): string | undefined => {
  let node: unknown = root;
  let type: string | undefined;
  for (const segment of path) {
    if (!isValueObject(node)) break;
    if (typeof node['$type'] === 'string') type = node['$type'];
    node = node[segment];
  }
  if (isValueObject(node) && typeof node['$type'] === 'string') type = node['$type'];
  return type;
};

const isCheckedLayer = (layer: string) => layer === 'basis' || layer === 'common' || layer.startsWith('common/');

export function parseTokens(root: unknown): TokenGraph {
  if (!isValueObject(root)) throw new Error('Expected a JSON object at the root of the tokens file');

  const raw: { path: string[]; token: RawToken }[] = [];
  walkObject<RawToken>(root, isRawToken, (token, path) => {
    raw.push({ path, token });
    return SKIP; // don't descend into `original`, `$extensions`, etc.
  });

  const allRefs = raw.map(({ token }) => collectRefs(authoredValue(token)));

  // Decide whether top-level keys are layers (token sets) by checking which interpretation resolves more refs.
  const rootIds = new Set(raw.map(({ path }) => path.join('.')));
  const layeredIds = new Set(raw.filter(({ path }) => path.length > 1).map(({ path }) => path.slice(1).join('.')));
  const score = (ids: Set<string>) => allRefs.flat().filter((r) => ids.has(r)).length;
  const rootScore = score(rootIds);
  const layeredScore = score(layeredIds);
  const layered =
    layeredScore > rootScore || (layeredScore === rootScore && Object.keys(root).some((k) => k.includes('/')));

  const tokens = new Map<string, TokenInfo>();
  const byId = new Map<string, string[]>();

  raw.forEach(({ path, token }, i) => {
    if (layered && path.length < 2) return;
    const layer = layered ? path[0] : undefined;
    const id = (layered ? path.slice(1) : path).join('.');
    const nodeId = layer ? `${layer}:${id}` : id;
    tokens.set(nodeId, {
      nodeId,
      id,
      layer,
      type: typeof token['$type'] === 'string' ? token['$type'] : inheritedType(root, path),
      value: authoredValue(token),
      refs: [...new Set(allRefs[i])],
      references: [],
      usedBy: [],
      unresolved: [],
      checkUnused: layer ? isCheckedLayer(layer) : path[0] === 'basis',
      unused: false,
      issues: [],
      contrast: [],
    });
    byId.set(id, [...(byId.get(id) ?? []), nodeId]);
  });

  const edges: TokenGraph['edges'] = [];
  for (const token of tokens.values()) {
    for (const ref of token.refs) {
      const targets = byId.get(ref);
      if (!targets) {
        token.unresolved.push(ref);
        continue;
      }
      for (const target of targets) {
        if (target === token.nodeId) continue;
        token.references.push(target);
        tokens.get(target)!.usedBy.push(token.nodeId);
        edges.push({ source: target, target: token.nodeId });
      }
    }
  }

  const resolve = (token: TokenInfo, seen = new Set<string>()): string | undefined => {
    if (typeof token.value !== 'object' && token.refs.length === 0) return String(token.value);
    if (isRef(token.value) && token.references.length > 0 && !seen.has(token.nodeId)) {
      seen.add(token.nodeId);
      return resolve(tokens.get(token.references[0])!, seen);
    }
    return undefined;
  };

  for (const token of tokens.values()) {
    token.unused = token.checkUnused && token.usedBy.length === 0;
    token.resolved = resolve(token);
  }

  const issues: string[] = [];
  // Layers are merged before validating, later layers overriding earlier ones, so an issue belongs to the last layer defining the token
  const lookup = (id: string) => byId.get(id)?.at(-1);
  for (const issue of validateTheme(layered ? excludeParentKeys(root) : root)) {
    const path = (issue.path ?? []).map(String);
    const end = path.findIndex((p) => p.startsWith('$'));
    const tokenPath = end === -1 ? path : path.slice(0, end);
    // the issue may point inside a composite value, so try the longest path that is a token
    let nodeId: string | undefined;
    for (let i = tokenPath.length; i > 0 && !nodeId; i--) nodeId = lookup(tokenPath.slice(0, i).join('.'));
    if (nodeId) tokens.get(nodeId)!.issues.push(describe(issue));
    else issues.push(`${path.join('.') || '(root)'}: ${describe(issue)}`);
  }

  // Pair per layer: a merged layered theme only holds the last layer's colors, so pair each foreground with the
  // background from its own layer (or the last one defining it) and compute the ratio from our own resolved values
  for (const { foreground, background, expectedRatio } of contrastPairs(layered ? excludeParentKeys(root) : root)) {
    const backgrounds = byId.get(background) ?? [];
    for (const fgId of byId.get(foreground) ?? []) {
      const fg = tokens.get(fgId)!;
      const bgId = backgrounds.find((id) => tokens.get(id)!.layer === fg.layer) ?? backgrounds.at(-1);
      if (!bgId || bgId === fgId || fg.contrast.some((p) => p.nodeId === bgId)) continue;
      const bg = tokens.get(bgId)!;
      const ratio = contrastRatio(fg.resolved, bg.resolved);
      fg.contrast.push({ nodeId: bgId, expectedRatio, ratio });
      bg.contrast.push({ nodeId: fgId, expectedRatio, ratio });
    }
  }

  return { layered, tokens, edges, issues };
}

/** `contrast-with` pairs, both authored ones and the ones the schema adds for known basis/component colors. */
function contrastPairs(theme: unknown) {
  const pairs: { foreground: string; background: string; expectedRatio: number }[] = [];
  let preprocessed: unknown;
  try {
    preprocessed = preprocessThemeStrict(theme);
  } catch {
    return pairs; // not a theme the schema understands
  }
  walkColors(preprocessed, (token, path) => {
    for (const { color, expectedRatio } of getExtension(token, EXTENSION_CONTRAST_WITH) ?? []) {
      const from = getExtension(color, EXTENSION_RESOLVED_FROM);
      if (from) pairs.push({ foreground: path.join('.'), background: extractRef(from), expectedRatio });
    }
  });
  return pairs;
}

function contrastRatio(a: string | undefined, b: string | undefined): number | undefined {
  if (!a || !b) return undefined;
  try {
    return compareContrast(parseColor(a), parseColor(b));
  } catch {
    return undefined;
  }
}

function validateTheme(theme: unknown): ThemeValidationIssue[] {
  const result = StrictThemeSchema.safeParse(theme);
  return result.success ? [] : (result.error.issues as ThemeValidationIssue[]);
}

function describe(issue: ThemeValidationIssue): string {
  if (issue.ERROR_CODE === ERROR_CODES.INSUFFICIENT_CONTRAST && 'tokens' in issue) {
    return `Insufficient contrast ${issue.actual.toFixed(2)}:1 (minimum ${issue.minimum}:1) with ${issue.tokens.join(' / ')}`;
  }
  return issue.message ?? issue.code;
}

/** A copy of the graph restricted to the given nodeIds (for laying out a subset). */
export function subgraph(graph: TokenGraph, ids: Set<string>): TokenGraph {
  const tokens = new Map<string, TokenInfo>();
  for (const id of ids) {
    const token = graph.tokens.get(id);
    if (!token) continue;
    tokens.set(id, {
      ...token,
      references: token.references.filter((r) => ids.has(r)),
      usedBy: token.usedBy.filter((u) => ids.has(u)),
    });
  }
  const edges = graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
  return { layered: graph.layered, tokens, edges, issues: graph.issues };
}

/** Every nodeId transitively connected (both directions) to the given node. */
export function relatedTo(graph: TokenGraph, nodeId: string): Set<string> {
  const result = new Set<string>([nodeId]);
  for (const key of ['references', 'usedBy'] as const) {
    const seen = new Set<string>([nodeId]);
    const stack = [nodeId];
    while (stack.length) {
      for (const next of graph.tokens.get(stack.pop()!)?.[key] ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        result.add(next);
        stack.push(next);
      }
    }
  }
  return result;
}
