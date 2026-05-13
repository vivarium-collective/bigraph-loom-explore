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

export function DocumentPanel(props: DocumentPanelProps) {
  if (!props.state) {
    return <p style={{ padding: 16, color: '#888' }}>No composite loaded.</p>;
  }

  const json = JSON.stringify(props.state, null, 2);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(json);
    } catch {
      // Clipboard access can fail in sandboxed iframes; ignore.
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

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <h3 style={{ margin: 0, flex: 1 }}>Resolved document</h3>
        <button
          onClick={handleCopy}
          style={{
            padding: '4px 10px', fontSize: 13,
            background: '#fff', border: '1px solid #d1d5db',
            borderRadius: 4, cursor: 'pointer',
          }}
        >
          Copy
        </button>
        <button
          onClick={handleDownload}
          style={{
            padding: '4px 10px', fontSize: 13,
            background: '#2563eb', color: '#fff', border: '1px solid #2563eb',
            borderRadius: 4, cursor: 'pointer',
          }}
        >
          Download JSON ↓
        </button>
      </div>
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
    </div>
  );
}
