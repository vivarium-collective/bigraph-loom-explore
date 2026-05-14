import { useState } from 'react';
import type React from 'react';
import { JsonTree } from './JsonNode';
import { postRunComplete } from '../api';

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
  /** Path-keyed dict of rendered HTML, one per Visualization step in the
   *  composite. Produced by `pbg_superpowers.visualization.render_results`
   *  on the server side. */
  viz_html?: Record<string, { html: string }>;
  error?: string;
  /** Full Python traceback from the subprocess that ran the composite.
   *  Present when error === "run failed" — surfaces the underlying cause
   *  (e.g. missing dylib, schema mismatch, process exception). */
  traceback?: string;
}

/** One observable row: expandable; when expanded shows a step navigator +
 * collapsible JSON tree of the current step's value. */
function ObservableRow({ name, entries }: { name: string; entries: any[] }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(entries.length ? entries.length - 1 : 0);
  const total = entries.length;
  const current = (entries[step] || {}) as Record<string, unknown>;

  // Drop bookkeeping fields ('time', '_*') so the tree focuses on observable data.
  const visible: Record<string, unknown> = {};
  Object.entries(current).forEach(([k, v]) => {
    if (k === 'time' || k.startsWith('_')) return;
    visible[k] = v;
  });

  const previewKv = Object.entries(visible).slice(0, 1)[0];
  const previewStr = previewKv
    ? (() => {
        const v = previewKv[1];
        if (v === null || typeof v !== 'object') return String(v);
        if (Array.isArray(v)) return `list[${v.length}]`;
        return `{${Object.keys(v as object).length} keys}`;
      })()
    : '—';

  return (
    <>
      <tr
        style={{ borderBottom: '1px solid #f3f4f6', cursor: 'pointer' }}
        onClick={() => setOpen((o) => !o)}
      >
        <td style={{ padding: '6px 8px' }}>
          <span style={{ display: 'inline-block', width: 14, color: '#6b7280' }}>
            {open ? '▾' : '▸'}
          </span>
          <code>{name}</code>
        </td>
        <td style={{ padding: '6px 8px' }}>{total}</td>
        <td style={{ padding: '6px 8px', fontFamily: 'monospace', fontSize: 12, color: '#4b5563' }}>
          {previewStr}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={3} style={{ background: '#fafafa', padding: 0 }}>
            <div style={{ padding: 10 }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                marginBottom: 8, fontSize: 13,
              }}>
                <button
                  onClick={() => setStep((s) => Math.max(0, s - 1))}
                  disabled={step === 0}
                  style={{ padding: '2px 8px' }}
                >‹ Prev</button>
                <span style={{ color: '#374151' }}>
                  Step <strong>{step + 1}</strong> of {total}
                </span>
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, total - 1)}
                  value={step}
                  onChange={(e) => setStep(parseInt(e.target.value, 10) || 0)}
                  style={{ flex: 1, maxWidth: 320 }}
                />
                <button
                  onClick={() => setStep((s) => Math.min(total - 1, s + 1))}
                  disabled={step >= total - 1}
                  style={{ padding: '2px 8px' }}
                >Next ›</button>
                {current.time !== undefined && (
                  <small style={{ color: '#6b7280' }}>time = {String(current.time)}</small>
                )}
              </div>
              <div style={{
                background: '#fff', border: '1px solid #e5e7eb',
                borderRadius: 4, padding: '8px 12px',
                maxHeight: 400, overflow: 'auto',
              }}>
                {Object.keys(visible).length === 0 ? (
                  <p style={{ color: '#9ca3af', fontSize: 13, margin: 0 }}>
                    No emitted fields at this step.
                  </p>
                ) : (
                  <JsonTree value={visible} />
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
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
        if (body.simulation_id && props.compositeId) {
          postRunComplete(body.simulation_id, props.compositeId);
        }
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
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
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
        <div style={{ color: '#c00', marginTop: 8 }}>
          <p style={{ margin: 0 }}><strong>Run failed:</strong> {result.error}</p>
          {result.traceback && (
            <details style={{ marginTop: 6 }}>
              <summary style={{ cursor: 'pointer', color: '#7f1d1d' }}>Show traceback</summary>
              <pre style={{
                background: '#fef2f2', border: '1px solid #fecaca',
                padding: 10, fontSize: 11, lineHeight: 1.4,
                overflow: 'auto', maxHeight: 320, marginTop: 6,
                whiteSpace: 'pre-wrap',
              }}>{result.traceback.trim()}</pre>
            </details>
          )}
        </div>
      )}

      {result?.results && (
        <>
          <p style={{ color: '#6b7280', fontSize: 13, margin: '4px 0 10px' }}>
            Run complete — <strong>{result.steps || 0}</strong> steps emitted. Click any observable row to browse its trajectory.
          </p>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f3f4f6' }}>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>Observable</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', width: 80 }}>Steps</th>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>Latest preview</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(result.results).sort().map(([k, entries]) => (
                <ObservableRow key={k} name={k} entries={entries} />
              ))}
              {!Object.keys(result.results).length && (
                <tr>
                  <td colSpan={3} style={{ padding: 12, color: '#666' }}>
                    Run complete — no observables emitted. Toggle stores in the View tab to capture their values.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}

      {result?.viz_html && Object.keys(result.viz_html).length > 0 && (
        <div style={{ marginTop: 20 }}>
          <h4>Visualizations</h4>
          {Object.entries(result.viz_html).map(([path, payload]) => (
            <div key={path} style={{ marginBottom: 12, border: '1px solid #e5e7eb', borderRadius: 4 }}>
              <div style={{ padding: '6px 10px', background: '#f3f4f6', fontFamily: 'monospace', fontSize: 12 }}>
                {path}
              </div>
              <iframe
                srcDoc={(payload as { html: string }).html || '<p>No HTML</p>'}
                style={{ width: '100%', height: 320, border: 0 }}
                sandbox="allow-scripts"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
