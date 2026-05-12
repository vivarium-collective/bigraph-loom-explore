import { useEffect, useState } from 'react';

export default function App() {
  const [status, setStatus] = useState<'waiting' | 'ready'>('waiting');

  useEffect(() => {
    window.parent.postMessage({ type: 'explore:ready' }, '*');
    setStatus('ready');
  }, []);

  return (
    <div style={{ padding: 24, fontFamily: 'system-ui' }}>
      <h2>bigraph-loom-explore</h2>
      <p>status: {status}</p>
      <p style={{ color: '#666' }}>(canvas mount point — Task 3 wires React Flow here)</p>
    </div>
  );
}
