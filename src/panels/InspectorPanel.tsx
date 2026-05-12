import type React from 'react';
import type { ExploreInspectMsg } from '../api';

export function InspectorPanel(props: { selection: Omit<ExploreInspectMsg, 'type'> | null }) {
  const sel = props.selection;
  const panelStyle: React.CSSProperties = {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 280,
    background: '#fff',
    border: '1px solid #ddd',
    borderRadius: 4,
    padding: 10,
    boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
    zIndex: 10,
    fontFamily: 'system-ui, sans-serif',
  };

  if (!sel) {
    return (
      <div style={panelStyle}>
        <h4 style={{ margin: 0, fontSize: 14 }}>Inspector</h4>
        <p style={{ color: '#888', fontSize: 12 }}>Click a node to inspect.</p>
      </div>
    );
  }
  return (
    <div style={panelStyle}>
      <h4 style={{ margin: 0, fontSize: 14, textTransform: 'capitalize' }}>{sel.kind}</h4>
      <p style={{ fontFamily: 'monospace', fontSize: 12, margin: '4px 0' }}>
        {sel.path.length ? sel.path.join('.') : '<root>'}
      </p>
      <pre style={{
        fontSize: 11, background: '#f7f7f7', padding: 6,
        overflow: 'auto', maxHeight: 280, margin: 0,
      }}>
        {JSON.stringify(sel.details, null, 2)}
      </pre>
    </div>
  );
}
