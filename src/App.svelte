<script lang="ts">
  import { setContext } from 'svelte';
  import { SvelteFlowProvider } from '@xyflow/svelte';
  import Graph from './lib/Graph.svelte';
  import { parseTokens, type TokenGraph } from './lib/tokens';
  import startDistUrl from '@nl-design-system-unstable/start-design-tokens/dist/tokens.json?url';
  import startFigmaUrl from '@nl-design-system-unstable/start-design-tokens/figma/start.tokens.json?url';

  let graph = $state.raw<TokenGraph | null>(null);
  let fileName = $state('');
  let error = $state('');
  let query = $state('');
  let focus = $state<string | null>(null);
  let showUnused = $state(false);
  setContext('showUnused', { get current() { return showUnused; } });

  let tokens = $derived(graph ? [...graph.tokens.values()] : []);
  let unused = $derived(tokens.filter((t) => t.unused));
  let invalid = $derived(tokens.filter((t) => t.issues.length > 0));
  let issueCount = $derived(invalid.reduce((n, t) => n + t.issues.length, 0) + (graph?.issues.length ?? 0));
  let searchIds = $derived([...new Set(tokens.map((t) => t.id))].sort());
  let focused = $derived(focus ? graph?.tokens.get(focus) : undefined);

  // A few thousand <option>s make every keystroke slow, so only offer the first matches
  let suggestions = $derived.by(() => {
    const q = query.trim();
    return q.length < 2 ? [] : searchIds.filter((id) => id.includes(q)).slice(0, 50);
  });

  const MAX_MATCHES = 200;
  let matches = $derived.by(() => {
    const q = query.trim();
    if (!graph || q.length < 2 || focus) return [];
    return tokens.filter((t) => t.nodeId.includes(q)).map((t) => t.nodeId);
  });

  const URL_PARAM = 'token';

  /** Keep the focused token in the URL so it survives reloads and can be shared. */
  function writeUrl(nodeId: string | null) {
    const url = new URL(location.href);
    if (nodeId) url.searchParams.set(URL_PARAM, nodeId);
    else url.searchParams.delete(URL_PARAM);
    if (url.href !== location.href) history.replaceState(history.state, '', url);
  }

  function load(json: unknown, name: string) {
    try {
      graph = parseTokens(json);
      fileName = name;
      error = '';
      // Restore the token from the URL if this file has it; otherwise leave the URL alone so it still works for the next file
      const fromUrl = new URL(location.href).searchParams.get(URL_PARAM);
      focus = (fromUrl && findExact(fromUrl)?.nodeId) || null;
      query = focus ? graph.tokens.get(focus)!.id : '';
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  async function onfile(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      load(JSON.parse(await file.text()), file.name);
    } catch (e) {
      error = `Could not read ${file.name}: ${e instanceof Error ? e.message : e}`;
    }
  }

  async function loadExample(url: string, name: string) {
    load(await (await fetch(url)).json(), name);
  }

  /** Exact path → focus it. `layer:path` also works for layered files. */
  function findExact(q: string) {
    return graph?.tokens.get(q) ?? [...(graph?.tokens.values() ?? [])].find((t) => t.id === q);
  }

  function oninput() {
    focus = findExact(query.trim())?.nodeId ?? null;
    if (focus) writeUrl(focus);
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !focus && matches.length > 0) select(matches[0]);
    if (event.key === 'Escape') select(null);
  }

  function select(nodeId: string | null) {
    focus = nodeId;
    query = nodeId ? graph!.tokens.get(nodeId)!.id : '';
    writeUrl(nodeId);
  }

  const show = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2));
</script>

<div class="app">
  <header>
    <label class="file">
      <span>tokens.json</span>
      <input type="file" accept=".json,application/json" onchange={onfile} />
    </label>
    <span class="examples">
      or try
      <button type="button" onclick={() => loadExample(startDistUrl, 'start (dist)')}>start (dist)</button>
      <button type="button" onclick={() => loadExample(startFigmaUrl, 'start (figma.json)')}>start (figma.json)</button>
    </span>

    <input
      class="search"
      type="search"
      placeholder="basis.color.default.bg-default"
      list="token-ids"
      bind:value={query}
      {oninput}
      {onkeydown}
      disabled={!graph}
      aria-label="Token path"
    />
    <datalist id="token-ids">
      {#each suggestions as id (id)}<option value={id}></option>{/each}
    </datalist>

    <label class="toggle">
      <input type="checkbox" bind:checked={showUnused} disabled={!graph} />
      show unused
    </label>

    {#if graph}
      <span class="stats">
        {fileName} · {tokens.length} tokens · {graph.edges.length} refs ·
        {graph.layered ? 'layered' : 'root'}
        · {#if issueCount}<strong class="invalid-count">{issueCount} {issueCount === 1 ? 'error' : 'errors'}</strong>{:else}valid{/if}
        {#if showUnused}· <strong class="unused-count">{unused.length} unused</strong>{/if}
        {#if matches.length}· {matches.length} matches{/if}
      </span>
    {/if}
  </header>

  {#if error}<p class="error" role="alert">{error}</p>{/if}

  <main>
    {#if graph}
      <div class="canvas">
        {#if focus}
          <SvelteFlowProvider>
            <Graph {graph} {focus} onselect={select} />
          </SvelteFlowProvider>
        {:else}
          <p class="empty">Search for a token to see its reference chain.</p>
        {/if}
      </div>
      <aside>
        {#if focused}
          <h2 class:deprecated={focused.deprecated}>{focused.id}</h2>
          {#if focused.deprecated}
            <p class="deprecation" role="note">
              <strong>Deprecated</strong>{#if focused.deprecated !== true}: {focused.deprecated}{/if}
            </p>
          {/if}
          {#if focused.description}<p class="description">{focused.description}</p>{/if}
          <dl>
            {#if focused.layer}<dt>Layer</dt><dd>{focused.layer}</dd>{/if}
            <dt>Type</dt><dd>{focused.type ?? '—'}</dd>
            <dt>$value</dt><dd><pre>{show(focused.value)}</pre></dd>
            {#if focused.resolved && focused.resolved !== focused.value}
              <dt>Resolved</dt><dd><code>{focused.resolved}</code></dd>
            {/if}
            {#if showUnused && focused.checkUnused}
              <dt>Used</dt><dd class:warn={focused.unused}>{focused.unused ? 'never referenced' : `${focused.usedBy.length}×`}</dd>
            {/if}
          </dl>
          {#if focused.issues.length}
            <h3>Errors</h3>
            <ul>{#each focused.issues as issue, i (i)}<li class="invalid">{issue}</li>{/each}</ul>
          {/if}
          {#if focused.contrast.length}
            <h3>Contrast with ({focused.contrast.length})</h3>
            <ul>
              {#each focused.contrast as pair (pair.nodeId)}
                <li>
                  <button type="button" onclick={() => select(pair.nodeId)}>{pair.nodeId}</button>
                  <span class:invalid={pair.ratio !== undefined && pair.ratio < pair.expectedRatio}>
                    {pair.ratio === undefined ? '?' : pair.ratio.toFixed(2)}:1 (min {pair.expectedRatio}:1)
                  </span>
                </li>
              {/each}
            </ul>
          {/if}
          {#if focused.unresolved.length}
            <h3>Unresolved refs</h3>
            <ul>{#each focused.unresolved as ref (ref)}<li class="warn">{ref}</li>{/each}</ul>
          {/if}
          {#if focused.references.length}
            <h3>References ({focused.references.length})</h3>
            <ul>{#each focused.references as id (id)}<li><button type="button" onclick={() => select(id)}>{id}</button></li>{/each}</ul>
          {/if}
          {#if focused.usedBy.length}
            <h3>Referenced by ({focused.usedBy.length})</h3>
            <ul>{#each focused.usedBy as id (id)}<li><button type="button" onclick={() => select(id)}>{id}</button></li>{/each}</ul>
          {/if}
        {:else if matches.length}
          <h3>Matches ({matches.length})</h3>
          <ul>{#each matches.slice(0, MAX_MATCHES) as id (id)}<li><button type="button" onclick={() => select(id)}>{id}</button></li>{/each}</ul>
          {#if matches.length > MAX_MATCHES}<p class="hint">…and {matches.length - MAX_MATCHES} more, keep typing to narrow down.</p>{/if}
        {:else}
          {#if issueCount}
            <h3 class="invalid">Errors ({issueCount})</h3>
            <ul>
              {#each graph.issues as issue, i (i)}<li class="invalid">{issue}</li>{/each}
              {#each invalid as t (t.nodeId)}
                <li><button type="button" onclick={() => select(t.nodeId)}>{t.nodeId}</button> <span class="invalid">{t.issues.join('; ')}</span></li>
              {/each}
            </ul>
          {/if}
          {#if showUnused}
            <details open={unused.length > 0}>
              <summary>Unused basis tokens ({unused.length})</summary>
              <ul>{#each unused as t (t.nodeId)}<li><button type="button" onclick={() => select(t.nodeId)}>{t.nodeId}</button></li>{/each}</ul>
            </details>
          {:else if !issueCount}
            <p class="hint">Type part of a token path to find it.</p>
          {/if}
        {/if}
      </aside>
    {:else}
      <p class="empty">Select a tokens.json file to visualize it.</p>
    {/if}
  </main>
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100dvh;
  }
  header {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 16px;
    align-items: center;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
  }
  .file input {
    margin-inline-start: 6px;
  }
  .examples {
    color: var(--muted);
  }
  .search {
    flex: 1 1 320px;
    font: inherit;
    font-family: ui-monospace, monospace;
    padding: 6px 8px;
  }
  .stats {
    color: var(--muted);
    font-size: 13px;
  }
  .unused-count {
    color: var(--unused);
  }
  .invalid-count,
  .invalid {
    color: var(--invalid);
  }
  .error {
    margin: 0;
    padding: 8px 12px;
    background: var(--unused-bg);
    color: var(--unused);
  }
  main {
    flex: 1;
    display: grid;
    grid-template-columns: 1fr 340px;
    min-height: 0;
  }
  .canvas {
    display: grid;
    min-height: 0;
  }
  aside {
    overflow: auto;
    padding: 12px;
    border-inline-start: 1px solid var(--border);
    font-size: 13px;
  }
  aside h2 {
    font: 600 14px ui-monospace, monospace;
    word-break: break-all;
    margin: 0 0 8px;
  }
  aside h3 {
    font-size: 13px;
    margin: 16px 0 4px;
  }
  aside h2.deprecated {
    text-decoration: line-through;
    color: var(--muted);
  }
  .deprecation {
    margin: 0 0 8px;
    padding: 6px 8px;
    border-inline-start: 3px solid var(--unused);
    background: var(--unused-bg);
  }
  .description {
    margin: 0 0 12px;
    white-space: pre-line;
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 12px;
    margin: 0;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
    min-width: 0;
  }
  pre {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-all;
  }
  ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  li button {
    all: unset;
    cursor: pointer;
    font: 12px ui-monospace, monospace;
    word-break: break-all;
    color: var(--accent);
  }
  li button:hover,
  li button:focus-visible {
    text-decoration: underline;
  }
  .warn {
    color: var(--unused);
  }
  .hint {
    margin: 0;
    color: var(--muted);
  }
  .empty {
    grid-column: 1 / -1;
    place-self: center;
    color: var(--muted);
  }
</style>
