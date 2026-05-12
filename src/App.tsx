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
  const readyFiredRef = useRef(false);

  // Wire postMessage protocol. Use a ref guard so StrictMode's double-effect
  // doesn't fire `explore:ready` twice during dev.
  useEffect(() => {
    const off = onCompositeLoad((msg) => setState(msg.state));
    if (!readyFiredRef.current) {
      readyFiredRef.current = true;
      postReady();
    }
    return off;
  }, []);

  // Convert composite state → React Flow nodes + edges, then auto-layout.
  // applyLayout(nodes, edges) returns Node[] (not {nodes, edges}).
  const { nodes, edges } = useMemo(() => {
    if (!state) return { nodes: [], edges: [] };
    const raw = stateToReactFlow(state);
    const laidNodes = applyLayout(raw.nodes as any, raw.edges as any);
    return { nodes: laidNodes, edges: raw.edges };
  }, [state]);

  const handleNodeClick = useCallback((_: any, node: any) => {
    const payload = {
      path: node.data?.path ?? [],
      kind: node.type as 'store' | 'process',
      details: node.data ?? {},
    };
    setSelection(payload);
    postInspect(payload);
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
          fitView
        >
          <Background />
          <Controls />
        </ReactFlow>
        <InspectorPanel selection={selection} />
      </div>
    </ReactFlowProvider>
  );
}
