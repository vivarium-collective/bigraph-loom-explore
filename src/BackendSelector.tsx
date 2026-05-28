// Persistent header strip rendered alongside the tab bar.
// Lets the user pick a compute backend and probe its connectivity inline.
import { useBackend } from './BackendContext';
import type { BackendStatus } from './api';

function statusColor(s: BackendStatus | null | undefined): { fg: string; bg: string; text: string } {
  if (s === undefined) return { fg: '#6b7280', bg: '#f3f4f6', text: '—' };
  if (s === null)      return { fg: '#6b7280', bg: '#f3f4f6', text: 'checking…' };
  if (s.ok)            return { fg: '#065f46', bg: '#d1fae5', text: '● connected' };
  return                       { fg: '#991b1b', bg: '#fee2e2', text: '● unreachable' };
}

export function BackendSelector() {
  const { backends, selectedId, setSelectedId, statusById, loading, loadError, refreshStatus } = useBackend();
  const status = selectedId ? statusById[selectedId] : undefined;
  const inFlight = status === null;
  const { fg, bg, text } = statusColor(status);

  if (loading) {
    return (
      <div style={{ fontSize: 12, color: '#6b7280' }}>Loading compute backends…</div>
    );
  }
  if (loadError) {
    return (
      <div style={{ fontSize: 12, color: '#991b1b' }}>
        Backend list failed: {loadError}
      </div>
    );
  }
  if (!backends.length) {
    return (
      <div style={{ fontSize: 12, color: '#6b7280' }}>No compute backends configured.</div>
    );
  }

  // Compose tooltip with extra detail when the probe failed (esp. for HPC
  // backends where the dashboard reports `missing_fields` for misconfigured
  // hpc.env). Keeps the chip itself compact.
  const tooltip = (() => {
    if (!status || status === null) return undefined;
    if (status.ok) return status.message || 'connected';
    if (status.missing_fields?.length) {
      return `${status.message}\nMissing: ${status.missing_fields.join(', ')}`;
    }
    return status.message || 'unreachable';
  })();

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
      <label htmlFor="backend-select" style={{ color: '#6b7280' }}>
        Compute backend
      </label>
      <select
        id="backend-select"
        value={selectedId ?? ''}
        onChange={(e) => setSelectedId(e.target.value || null)}
        style={{
          padding: '4px 6px', fontSize: 12,
          border: '1px solid #d1d5db', borderRadius: 4, background: '#fff',
        }}
      >
        {backends.map((b) => (
          <option key={b.id} value={b.id}>{b.label}</option>
        ))}
      </select>
      <span
        title={tooltip}
        style={{
          padding: '2px 8px', borderRadius: 999,
          fontSize: 11, fontWeight: 600,
          color: fg, background: bg,
        }}
      >
        {text}
      </span>
      <button
        type="button"
        disabled={!selectedId || inFlight}
        onClick={() => selectedId && refreshStatus(selectedId)}
        title="Re-probe the selected backend's connectivity"
        style={{
          padding: '3px 8px', fontSize: 11,
          background: '#fff', border: '1px solid #d1d5db', borderRadius: 4,
          color: '#374151',
          cursor: (!selectedId || inFlight) ? 'default' : 'pointer',
          opacity: (!selectedId || inFlight) ? 0.5 : 1,
        }}
      >
        {inFlight ? '…' : '↻ Test'}
      </button>
    </div>
  );
}
