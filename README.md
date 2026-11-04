# token-graph

Single-page app that visualizes a design tokens file as a graph with [Svelte Flow](https://svelteflow.dev) (xyflow).

```sh
pnpm install
pnpm dev
```

## What it does

- Load any `tokens.json` (file picker), or one of the two bundled `start` examples.
- Supports tokens at the root (`basis.color…`) and tokens one layer deep in token sets (`common`, `components/button/nl`, …).
  The shape is detected by checking which interpretation resolves more references.
- References are read from `$value`, or from `original.$value` for Style Dictionary output (where `$value` is already resolved).
  Whole-value refs, refs embedded in strings and refs inside composite values (e.g. shadows) are all picked up.
- Edges point from the referenced token to the token that uses it; columns = depth of the reference chain.
- Tokens in `basis` (root files) or in a `basis` / `common` / `common/*` layer are marked **unused** when nothing references them.
- Search box: type an exact path (`basis.color.default.bg-default`, or `layer:path`) to focus it and its full reference chain.
  Partial input highlights matches; Enter focuses the first one, Escape clears.
- "only related" re-lays out just the focused chain. Click any node or sidebar link to refocus.

## Files

- `src/lib/tokens.ts` – parsing, reference resolution, unused detection (uses `@nl-design-system-community/design-tokens-schema` helpers)
- `src/lib/layout.ts` – layered layout (dagre took ~50 s on 3.4k tokens; this takes ~20 ms)
- `src/lib/Graph.svelte`, `src/lib/TokenNode.svelte` – Svelte Flow canvas and node
- `src/App.svelte` – file input, search, sidebar
