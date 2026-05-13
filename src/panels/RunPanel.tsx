import { useState } from 'react';
import type React from 'react';

export interface RunPanelProps {
  compositeId: string | null;
  emitSet: Set<string>;
  /** Optional context hint from composite:load metadata (e.g. 'investigation:foo').
   *  When the context begins with 'investigation:' the Run flow is disabled here —
   *  investigation-scoped composites run via the Study's own controls. */
  runContext?: string;
}

interface RunResult {
  simulation_id?: string;
  steps?: number;
  results?: Record<string, any[]>;
  error?: string;
}

export function RunPanel(props: RunPanelProps) {
  const [steps, setSteps] = useState(5);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);

  const inInvestigation = !!(props.runContext && props.runContext.startsWith('investigation:'));
  const canRun = !!props.compositeId && !inInvestigation;

  async function handleRun() {
    if (!props.compositeId) {
      setResult({ error: 'No composite id — pop-out windows need ?id=<dotted-ref> in the URL, or the embedding dashboard must include it in the composite:load metadata.' });
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const r = await fetch('/api/composite-test-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: props.compositeId,
          steps,
          emit_paths: Array.from(props.emitSet),
        }),
      });
      const body = await r.json();
      if (!r.ok) {
        setResult({ error: body.error || `HTTP ${r.status}` });
      } else {
        setResult(body);
      }
    } catch (e: any) {
      setResult({ error: 'Network error: ' + String(e) });
    } finally {
      setBusy(false);
    }
  }

  const wrapStyle: React.CSSProperties = { padding: 16, fontFamily: 'system-ui, sans-serif' };

  if (inInvestigation) {
    return (
      <div style={wrapStyle}>
        <h3 style={{ marginTop: 0 }}>Run</h3>
        <p style={{ color: '#6b7280' }}>
          Use the Study&apos;s Run controls to run with this investigation&apos;s emitters.
        </p>
      </div>
    );
  }

  return (
    <div style={wrapStyle}>
      <h3 style={{ marginTop: 0 }}>Run</h3>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
        <label>
          Steps{' '}
          <input
            type="number"
            min={1}
            max={100}
            value={steps}
            onChange={(e) => setSteps(parseInt(e.target.value) || 1)}
            style={{ width: 70 }}
          />
        </label>
        <button onClick={handleRun} disabled={busy || !canRun}>
          {busy ? 'Running…' : 'Run'}
        </button>
        <small style={{ color: '#666' }}>
          Emit selections:{' '}
          {props.emitSet.size === 0 ? (
            <em>none — pick stores in the View tab</em>
          ) : (
            Array.from(props.emitSet).join(', ')
          )}
        </small>
      </div>

      {props.emitSet.size === 0 && !result && (
        <p style={{ color: '#888', fontSize: 13 }}>
          Tip — click a store in the View tab and check &ldquo;Emit this store&rdquo; to capture its values.
        </p>
      )}

      {!result && (
        <p style={{ color: '#888' }}>
          Click <strong>Run</strong> to execute the composite for the chosen number of steps.
        </p>
      )}

      {result?.error && (
        <p style={{ color: '#c00' }}>Run failed: {result.error}</p>
      )}

      {result?.results && (
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f3f4f6' }}>
              <th style={{ textAlign: 'left', padding: '6px 8px' }}>Observable</th>
              <th style={{ textAlign: 'left', padding: '6px 8px' }}>Steps</th>
              <th style={{ textAlign: 'left', padding: '6px 8px' }}>Final value</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(result.results).sort().map(([k, entries]) => {
              const last = (entries[entries.length - 1] || {}) as Record<string, unknown>;
              const preview = Object.entries(last)
                .filter(([f]) => f !== 'time' && !f.startsWith('_'))
                .slice(0, 1)
                .map(([_, v]) => JSON.stringify(v))[0] || '—';
              return (
                <tr key={k} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '6px 8px' }}><code>{k}</code></td>
                  <td style={{ padding: '6px 8px' }}>{entries.length}</td>
                  <td style={{ padding: '6px 8px', fontFamily: 'monospace', fontSize: 12 }}>{preview}</td>
                </tr>
              );
            })}
            {!Object.keys(result.results).length && (
              <tr><td colSpan={3} style={{ padding: 12, color: '#666' }}>
                Run complete — no observables emitted. Toggle stores in the View tab to capture their values.
              </td></tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
