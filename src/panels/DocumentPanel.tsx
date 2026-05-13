export interface DocumentPanelProps {
  state: any;
}

export function DocumentPanel(props: DocumentPanelProps) {
  if (!props.state) {
    return <p style={{ padding: 16, color: '#888' }}>No composite loaded.</p>;
  }
  return (
    <div style={{ padding: 16 }}>
      <h3 style={{ marginTop: 0 }}>Resolved document</h3>
      <pre style={{
        background: '#f8f8f8',
        padding: 12,
        borderRadius: 4,
        overflow: 'auto',
        fontSize: 12,
        maxHeight: 'calc(100vh - 120px)',
      }}>
        {JSON.stringify(props.state, null, 2)}
      </pre>
    </div>
  );
}
