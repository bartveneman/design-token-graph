<script lang="ts">
  import { SvelteFlow, Background, Controls, useSvelteFlow, type Node, type Edge } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';
  import TokenNode from './TokenNode.svelte';
  import { relatedTo, subgraph, type TokenGraph, type TokenInfo } from './tokens';
  import { layoutTokens, COL_GAP, NODE_HEIGHT, NODE_WIDTH, ROW_GAP } from './layout';

  interface Props {
    graph: TokenGraph;
    /** nodeId of the focused token; only its reference chain is drawn */
    focus: string;
    onselect: (nodeId: string) => void;
  }
  let { graph, focus, onselect }: Props = $props();

  const nodeTypes = { token: TokenNode };
  const { fitView } = useSvelteFlow();

  let chain = $derived(subgraph(graph, relatedTo(graph, focus)));

  let nodes = $state.raw<Node<{ token: TokenInfo }>[]>([]);
  let edges = $state.raw<Edge[]>([]);

  $effect(() => {
    const positions = layoutTokens(chain);
    const toNode = (token: TokenInfo, position: { x: number; y: number }): Node<{ token: TokenInfo }> => ({
      id: token.nodeId,
      type: 'token',
      position,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      data: { token },
      class: token.nodeId === focus ? 'focus' : '',
    });
    // the original tokens, not the subgraph copies with trimmed references
    const nextNodes = [...chain.tokens.keys()].map((id) => toNode(graph.tokens.get(id)!, positions.get(id)!));
    const nextEdges: Edge[] = chain.edges.map(({ source, target }) => ({ id: `${source}->${target}`, source, target }));

    // Contrast partners of the focused token; those outside the chain get their own column on the left
    const focusPos = positions.get(focus)!;
    const left = Math.min(...[...positions.values()].map((p) => p.x)) - NODE_WIDTH - COL_GAP;
    let row = 0;
    for (const pair of graph.tokens.get(focus)!.contrast) {
      if (!nextNodes.some((n) => n.id === pair.nodeId)) {
        const position = { x: left, y: focusPos.y + row++ * (NODE_HEIGHT + ROW_GAP) };
        nextNodes.push(toNode(graph.tokens.get(pair.nodeId)!, position));
      }
      const failing = pair.ratio !== undefined && pair.ratio < pair.expectedRatio;
      nextEdges.push({
        id: `contrast:${pair.nodeId}`,
        source: pair.nodeId,
        target: focus,
        label: pair.ratio === undefined ? `≥ ${pair.expectedRatio}:1` : `${pair.ratio.toFixed(2)}:1`,
        class: failing ? 'contrast failing' : 'contrast',
      });
    }
    nodes = nextNodes;
    edges = nextEdges;
    // wait a frame so the new nodes are rendered
    requestAnimationFrame(() => fitView({ duration: 400, padding: 0.15, maxZoom: 1.2 }));
  });
</script>

<SvelteFlow
  bind:nodes
  bind:edges
  {nodeTypes}
  fitView
  minZoom={0.05}
  maxZoom={2}
  nodesDraggable={false}
  nodesConnectable={false}
  elementsSelectable={false}
  colorMode="system"
  onnodeclick={({ node }) => onselect(node.id)}
>
  <Background />
  <Controls showLock={false} />
</SvelteFlow>

<style>
  :global(.svelte-flow__edge .svelte-flow__edge-path) {
    stroke: var(--accent);
  }
  :global(.svelte-flow__edge.contrast .svelte-flow__edge-path) {
    stroke: var(--muted);
    stroke-dasharray: 6 4;
  }
  :global(.svelte-flow__edge.contrast.failing .svelte-flow__edge-path) {
    stroke: var(--invalid);
  }
  :global(.svelte-flow__edge-label) {
    font: 11px ui-monospace, monospace;
  }
  :global(.svelte-flow__node.focus > .token) {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }
</style>
