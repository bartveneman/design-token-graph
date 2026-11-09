<script lang="ts">
  import { getContext } from 'svelte';
  import { Handle, Position, type NodeProps, type Node } from '@xyflow/svelte';
  import type { TokenInfo } from './tokens';

  type TokenNodeType = Node<{ token: TokenInfo }, 'token'>;
  let { data }: NodeProps<TokenNodeType> = $props();
  const showUnused = getContext<{ current: boolean }>('showUnused');
  let token = $derived(data.token);
  let unused = $derived(showUnused.current && token.unused);
  let display = $derived(
    typeof token.value === 'string' ? token.value : JSON.stringify(token.value),
  );
</script>

<div class="token" class:deprecated={token.deprecated} class:unused class:broken={token.unresolved.length > 0} class:invalid={token.issues.length > 0}>
  <Handle type="target" position={Position.Left} isConnectable={false} />
  <div class="row">
    {#if token.type === 'color' && token.resolved}
      <span class="swatch" style:background={token.resolved}></span>
    {/if}
    <span class="id" title={token.nodeId}>{token.id}</span>
  </div>
  <div class="row meta">
    {#if token.layer}<span class="layer">{token.layer}</span>{/if}
    {#if token.type}<span class="type">{token.type}</span>{/if}
    <span class="value" title={display}>{display}</span>
    {#if token.deprecated}
      <span class="badge deprecated" title={token.deprecated === true ? 'Deprecated' : token.deprecated}>deprecated</span>
    {/if}
    {#if unused}<span class="badge">unused</span>{/if}
    {#if token.issues.length}
      <span class="badge error" title={token.issues.join('\n')}>{token.issues.length === 1 ? 'error' : `${token.issues.length} errors`}</span>
    {/if}
  </div>
  <Handle type="source" position={Position.Right} isConnectable={false} />
</div>

<style>
  .token {
    box-sizing: border-box;
    width: 300px;
    height: 56px;
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--node-bg);
    font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
    display: grid;
    gap: 2px;
    align-content: center;
  }
  .unused {
    border-color: var(--unused);
    background: var(--unused-bg);
  }
  .invalid {
    border-color: var(--invalid);
    background: var(--invalid-bg);
  }
  .deprecated {
    background-image: repeating-linear-gradient(
      -45deg,
      transparent 0 6px,
      var(--deprecated-stripe) 6px 12px
    );
  }
  .deprecated .id {
    text-decoration: line-through;
    color: var(--muted);
  }
  .broken {
    border-style: dashed;
  }
  .row {
    display: flex;
    gap: 6px;
    align-items: center;
    min-width: 0;
  }
  .id {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    color: var(--muted);
    font-size: 11px;
  }
  .value {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }
  .layer,
  .type {
    flex: none;
    padding: 0 4px;
    border-radius: 3px;
    background: var(--chip);
  }
  .swatch {
    flex: none;
    width: 14px;
    height: 14px;
    border-radius: 3px;
    border: 1px solid var(--border);
  }
  .badge {
    flex: none;
    padding: 0 5px;
    border-radius: 3px;
    background: var(--unused);
    color: white;
    font-weight: 600;
  }
  .badge.deprecated {
    background: var(--muted);
  }
  .badge.error {
    background: var(--invalid);
  }
</style>
