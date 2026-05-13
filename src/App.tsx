import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ReactFlow, Background, Controls, ReactFlowProvider,
  useNodesState, useEdgesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

// ProcessNode and StoreNode are default exports from the loom node modules
import ProcessNode from './nodes/ProcessNode';
import StoreNode from './nodes/StoreNode';
import { applyLayout } from './layout';
import { stateToReactFlow } from './convert';
import { InspectorPanel } from './panels/InspectorPanel';
import { RunPanel } from './panels/RunPanel';
import { DocumentPanel } from './panels/DocumentPanel';
import { EmitContext } from './EmitContext';
import {
  postReady, postInspect, postEmitChanged, onCompositeLoad, decodeUrlComposite,
} from './api';
import type { ExploreInspectMsg } from './api';

// applyLayout(nodes, edges) → Node[] (returns nodes array directly)
const NODE_TYPES = { process: ProcessNode, store: StoreNode };

type TabId = 'view' | 'run' | 'document';

export default function App() {
  const [state, setState] = useState<any | null>(decodeUrlComposite());
  const [selection, setSelection] = useState<Omit<ExploreInspectMsg, 'type'> | null>(null);
  // Collapsed group-node ids — children of these nodes are filtered out of the graph.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // Explicit-emit store paths (joined by '/'). Descendants inherit emission.
  const [emitSet, setEmitSet] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<TabId>('view');
  const [compositeId, setCompositeId] = useState<string | null>(() => {
    // Bootstrap from URL query if present (for popups deep-linked with ?id=)
    const p = new URLSearchParams(window.location.search);
    return p.get('id');
  });
  const [runContext, setRunContext] = useState<string>('');
  const readyFiredRef = useRef(false);

  // Use React Flow's controlled-state hooks so drag changes persist across
  // re-renders. Without these, every parent re-render would reset positions
  // to the auto-layout output.
  const [nodes, setNodes, onNodesChange] = useNodesState<any>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<any>([]);

  // Wire postMessage protocol. Use a ref guard so StrictMode's double-effect
  // doesn't fire `explore:ready` twice during dev.
  useEffect(() => {
    const off = onCompositeLoad((msg) => {
      setState(msg.state);
      setCollapsed(new Set());  // reset folding when a new composite loads
      setEmitSet(new Set());    // reset emit selection when a new composite loads
      if (msg.metadata?.id) setCompositeId(msg.metadata.id);
      setRunContext(msg.metadata?.context || '');
    });
    if (!readyFiredRef.current) {
      readyFiredRef.current = true;
      postReady();
    }
    return off;
  }, []);

  // Popout fallback: if the URL has ?id=<ref>, fetch state directly from the
  // server. This avoids any postMessage race with the opener — the popup
  // self-hydrates as soon as the API responds. The opener's postMessage
  // (which arrives later) is harmless because the state is already loaded.
  useEffect(() => {
    if (!compositeId || state) return;
    let cancelled = false;
    fetch('/api/composite-state?ref=' + encodeURIComponent(compositeId))
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.state && !state) setState(data.state);
      })
      .catch(() => { /* fall through to postMessage path */ });
    return () => { cancelled = true; };
  }, [compositeId, state]);

  // (Re)generate nodes + edges whenever the composite state OR the set of
  // collapsed groups changes. This DOES reset any manual drag positions on
  // the affected branch, which is acceptable for v1.
  useEffect(() => {
    if (!state) {
      setNodes([]);
      setEdges([]);
      return;
    }
    const raw = stateToReactFlow(state);

    const isHidden = (n: any) => {
      const path: string[] = n.data?.path ?? [];
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
    setNodes(laidNodes as any);
    setEdges(visibleEdges as any);
  }, [state, collapsed, setNodes, setEdges]);

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

  const handleEmitToggle = useCallback((path: string[], on: boolean) => {
    setEmitSet((prev) => {
      const next = new Set(prev);
      const key = path.join('/');
      if (on) next.add(key);
      else next.delete(key);
      // Notify the embedding dashboard. Send a sorted list for deterministic
      // ordering on the receiving side.
      postEmitChanged(Array.from(next).sort());
      return next;
    });
  }, []);

  if (!state) {
    return (
      <div style={{ padding: 24, fontFamily: 'system-ui' }}>
        <h3>bigraph-loom-explore</h3>
        <p style={{ color: '#666' }}>
          {compositeId ? `Loading composite "${compositeId}"…` : 'Waiting for composite data…'}
        </p>
        {compositeId && (
          <p style={{ color: '#888', fontSize: 12 }}>
            Fetching from <code>/api/composite-state?ref={compositeId}</code>.
            If this hangs, the dashboard server may be unreachable.
          </p>
        )}
        {!compositeId && (
          <p style={{ color: '#888', fontSize: 12 }}>
            Embed this page and post a <code>composite:load</code> message,
            or open with <code>?id=&lt;ref&gt;</code>.
          </p>
        )}
      </div>
    );
  }

  const tabs: TabId[] = ['view', 'run', 'document'];

  return (
    <ReactFlowProvider>
      <div style={{ display: 'flex', flexDirection: 'column', width: '100vw', height: '100vh' }}>
        <nav style={{
          display: 'flex', gap: 24, alignItems: 'center',
          padding: '8px 16px',
          borderBottom: '1px solid #e5e7eb',
          background: '#fff',
          flex: '0 0 auto',
        }}>
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                background: 'transparent', border: 0,
                padding: '6px 0', fontSize: 14,
                borderBottom: '2px solid ' + (tab === t ? '#2563eb' : 'transparent'),
                color: tab === t ? '#2563eb' : '#6b7280',
                fontWeight: tab === t ? 600 : 400,
                cursor: 'pointer', textTransform: 'capitalize',
              }}
            >
              {t}
            </button>
          ))}
        </nav>

        <div style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
          {/* The View tab must always be rendered so ReactFlow doesn't lose
              its node-position state on tab switches; we hide it instead. */}
          <div style={{
            position: 'absolute', inset: 0,
            display: tab === 'view' ? 'block' : 'none',
          }}>
            <EmitContext.Provider value={emitSet}>
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
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
              <InspectorPanel
                selection={selection}
                emitSet={emitSet}
                onEmitToggle={handleEmitToggle}
              />
            </EmitContext.Provider>
          </div>
          {tab === 'run' && (
            <RunPanel
              compositeId={compositeId}
              emitSet={emitSet}
              runContext={runContext}
            />
          )}
          {tab === 'document' && (
            <DocumentPanel state={state} compositeId={compositeId} />
          )}
        </div>
      </div>
    </ReactFlowProvider>
  );
}
