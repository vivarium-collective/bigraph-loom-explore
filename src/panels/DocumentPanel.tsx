import { useState } from 'react';

export interface DocumentPanelProps {
  state: any;
  compositeId?: string | null;
}

function _downloadFilename(id?: string | null): string {
  const slug = (id || 'composite')
    .replace(/[^a-zA-Z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `${slug || 'composite'}.json`;
}

/** Heuristic: how should a collection node display by default?
 * Top-level dicts expand. Long arrays start collapsed. Deeply nested
 * arrays-of-arrays (numpy-array-style) start collapsed to keep the view light.
 */
function _defaultOpen(value: unknown, depth: number): boolean {
  if (depth === 0) return true;
  if (Array.isArray(value)) return value.length <= 6 && depth < 2;
  if (value && typeof value === 'object') return depth < 1;
  return false;
}

function _previewLeaf(v: unknown): string {
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number' || typeof v === 'boolean' || v == null) return String(v);
  return String(v);
}

function _arrayPreview(arr: any[]): string {
  // Cheap shape hint, e.g., "list[5]" or "list[3 × 4]" for nested arrays
  if (arr.length === 0) return 'list[0]';
  const first = arr[0];
  if (Array.isArray(first)) {
    const rows = arr.length;
    const cols = first.length;
    const allSameLen = arr.every((r) => Array.isArray(r) && r.length === cols);
    if (allSameLen) return `list[${rows} × ${cols}]`;
    return `list[${rows}] (ragged)`;
  }
  return `list[${arr.length}]`;
}

interface NodeProps {
  k: string;
  value: unknown;
  depth: number;
  path: string;
}

function JsonNode({ k, value, depth, path }: NodeProps) {
  const isCollection = (value !== null) && (typeof value === 'object');
  const [open, setOpen] = useState(_defaultOpen(value, depth));

  const indent = depth * 14;
  const rowStyle: React.CSSProperties = {
    paddingLeft: indent,
    fontFamily: 'ui-monospace, Menlo, monospace',
    fontSize: 12.5,
    lineHeight: 1.45,
  };

  if (!isCollection) {
    return (
      <div style={rowStyle}>
        <span style={{ color: '#7c3aed' }}>{k}</span>
        <span style={{ color: '#6b7280' }}>: </span>
        <span style={
          typeof value === 'string' ? { color: '#059669' }
          : typeof value === 'number' ? { color: '#2563eb' }
          : typeof value === 'boolean' ? { color: '#d97706' }
          : { color: '#6b7280' }
        }>{_previewLeaf(value)}</span>
      </div>
    );
  }

  const isArray = Array.isArray(value);
  const entries: [string, unknown][] = isArray
    ? (value as any[]).map((v, i) => [String(i), v])
    : Object.entries(value as Record<string, unknown>);

  const summary = isArray
    ? _arrayPreview(value as any[])
    : `{${entries.length} key${entries.length === 1 ? '' : 's'}}`;

  return (
    <div>
      <div
        style={{ ...rowStyle, cursor: 'pointer', userSelect: 'none' }}
        onClick={() => setOpen((o) => !o)}
      >
        <span style={{ color: '#6b7280', display: 'inline-block', width: 12 }}>
          {open ? '▾' : '▸'}
        </span>
        <span style={{ color: '#7c3aed' }}>{k}</span>
        <span style={{ color: '#6b7280' }}>: </span>
        <span style={{ color: '#9ca3af' }}>{summary}</span>
      </div>
      {open && (
        <div>
          {entries.map(([childK, childV]) => (
            <JsonNode
              key={path + '/' + childK}
              k={childK}
              value={childV}
              depth={depth + 1}
              path={path + '/' + childK}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function DocumentPanel(props: DocumentPanelProps) {
  const [mode, setMode] = useState<'tree' | 'raw'>('tree');

  if (!props.state) {
    return <p style={{ padding: 16, color: '#888' }}>No composite loaded.</p>;
  }

  const json = JSON.stringify(props.state, null, 2);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(json);
    } catch {
      // Clipboard access can fail in sandboxed iframes; silently ignore.
    }
  }

  function handleDownload() {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = _downloadFilename(props.compositeId);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const btnStyle: React.CSSProperties = {
    padding: '4px 10px', fontSize: 13,
    background: '#fff', border: '1px solid #d1d5db',
    borderRadius: 4, cursor: 'pointer',
  };
  const btnStylePrimary: React.CSSProperties = {
    ...btnStyle,
    background: '#2563eb', color: '#fff', border: '1px solid #2563eb',
  };
  const segStyle = (active: boolean): React.CSSProperties => ({
    padding: '4px 10px', fontSize: 13,
    background: active ? '#eff6ff' : '#fff',
    border: '1px solid ' + (active ? '#2563eb' : '#d1d5db'),
    borderRadius: 4, cursor: 'pointer',
    color: active ? '#1e40af' : '#1f2937',
    fontWeight: active ? 600 : 400,
  });

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, flex: 1 }}>Resolved document</h3>
        <div style={{ display: 'inline-flex', gap: 4 }}>
          <button onClick={() => setMode('tree')} style={segStyle(mode === 'tree')}>Tree</button>
          <button onClick={() => setMode('raw')}  style={segStyle(mode === 'raw')}>Raw</button>
        </div>
        <button onClick={handleCopy} style={btnStyle}>Copy</button>
        <button onClick={handleDownload} style={btnStylePrimary}>Download JSON ↓</button>
      </div>

      {mode === 'tree' ? (
        <div style={{
          background: '#fafafa',
          border: '1px solid #e5e7eb',
          borderRadius: 4,
          padding: '10px 14px',
          overflow: 'auto',
          maxHeight: 'calc(100vh - 140px)',
        }}>
          {Object.entries(props.state as Record<string, unknown>).map(([k, v]) => (
            <JsonNode key={k} k={k} value={v} depth={0} path={k} />
          ))}
        </div>
      ) : (
        <pre style={{
          background: '#f8f8f8',
          padding: 12,
          borderRadius: 4,
          overflow: 'auto',
          fontSize: 12,
          maxHeight: 'calc(100vh - 140px)',
          margin: 0,
        }}>
          {json}
        </pre>
      )}
    </div>
  );
}
