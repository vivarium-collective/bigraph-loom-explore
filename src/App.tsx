import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, Background, Controls, ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

// ProcessNode and StoreNode are default exports from the loom node modules
import ProcessNode from './nodes/ProcessNode';
import StoreNode from './nodes/StoreNode';
import { applyLayout } from './layout';
import { stateToReactFlow } from './convert';
import { InspectorPanel } from './panels/InspectorPanel';
import {
  postReady, postInspect, onCompositeLoad, decodeUrlComposite,
} from './api';
import type { ExploreInspectMsg } from './api';

// applyLayout(nodes, edges) → Node[] (returns nodes array directly)
const NODE_TYPES = { process: ProcessNode, store: StoreNode };

export default function App() {
  const [state, setState] = useState<any | null>(decodeUrlComposite());
  const [selection, setSelection] = useState<Omit<ExploreInspectMsg, 'type'> | null>(null);
  // Collapsed group-node ids — children of these nodes are filtered out of the graph.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const readyFiredRef = useRef(false);

  // Wire postMessage protocol. Use a ref guard so StrictMode's double-effect
  // doesn't fire `explore:ready` twice during dev.
  useEffect(() => {
    const off = onCompositeLoad((msg) => {
      setState(msg.state);
      setCollapsed(new Set());  // reset folding when a new composite loads
    });
    if (!readyFiredRef.current) {
      readyFiredRef.current = true;
      postReady();
    }
    return off;
  }, []);

  // Convert composite state → React Flow nodes + edges; hide descendants of
  // any collapsed group; mark the collapsed groups themselves so StoreNode
  // renders the ▶ indicator. Then auto-layout.
  const { nodes, edges } = useMemo(() => {
    if (!state) return { nodes: [], edges: [] };
    const raw = stateToReactFlow(state);

    const isHidden = (n: any) => {
      const path: string[] = n.data?.path ?? [];
      // hide if any STRICT ancestor (not the node itself) is collapsed
      for (let i = 1; i < path.length; i++) {
        if (collapsed.has(path.slice(0, i).join('.'))) return true;
      }
      return false;
    };

    const visibleNodes = raw.nodes.filter((n) => !isHidden(n)).map((n) => {
      if (collapsed.has(n.id)) {
        return { ...n, data: { ...n.data, isCollapsed: true } as any };
      }
      return n;
    });
    const visibleIds = new Set(visibleNodes.map((n) => n.id));
    const visibleEdges = raw.edges.filter(
      (e) => visibleIds.has(e.source) && visibleIds.has(e.target),
    );
    const laidNodes = applyLayout(visibleNodes as any, visibleEdges as any);
    return { nodes: laidNodes, edges: visibleEdges };
  }, [state, collapsed]);

  const handleNodeClick = useCallback((_: any, node: any) => {
    const payload = {
      path: node.data?.path ?? [],
      kind: node.type as 'store' | 'process',
      details: node.data ?? {},
    };
    setSelection(payload);
    postInspect(payload);
  }, []);

  const handleNodeDoubleClick = useCallback((_: any, node: any) => {
    // Only group stores (synthesized container nodes) can be collapsed.
    if (!(node.data as any)?.isGroup) return;
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(node.id)) next.delete(node.id);
      else next.add(node.id);
      return next;
    });
  }, []);

  if (!state) {
    return (
      <div style={{ padding: 24, fontFamily: 'system-ui' }}>
        <h3>bigraph-loom-explore</h3>
        <p style={{ color: '#666' }}>Waiting for composite data…</p>
        <p style={{ color: '#888', fontSize: 12 }}>
          Embed this page and post a <code>composite:load</code> message,
          or open with <code>?composite=&lt;base64-json&gt;</code>.
        </p>
      </div>
    );
  }

  return (
    <ReactFlowProvider>
      <div style={{ width: '100vw', height: '100vh', position: 'relative' }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodeClick={handleNodeClick}
          onNodeDoubleClick={handleNodeDoubleClick}
          fitView
          /* Read-only viewer for wiring/structure, but users CAN rearrange
             node positions by dragging individual nodes. What's forbidden:
             new edges, edge reconnects, and any delete. */
          nodesDraggable
          nodesConnectable={false}
          edgesReconnectable={false}
          connectOnClick={false}
          deleteKeyCode={null}
        >
          <Background />
          <Controls />
        </ReactFlow>
        <InspectorPanel selection={selection} />
      </div>
    </ReactFlowProvider>
  );
}
