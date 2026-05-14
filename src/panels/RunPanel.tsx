import { useState, useEffect, useRef, useCallback } from 'react';
import type React from 'react';
import { JsonTree } from './JsonNode';
import {
  postRunComplete, startRun, fetchRunStatus, fetchRunTrajectory,
  type RunStatus,
} from '../api';

export interface RunPanelProps {
  compositeId: string | null;
  emitSet: Set<string>;
  runContext?: string;
}

const ACTIVE_RUN_KEY = 'loom-explore:active-run';
const POLL_MS = 1500;

/** One observable row: expandable; step navigator + JSON tree. */
function ObservableRow({ name, entries }: { name: string; entries: any[] }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(entries.length ? entries.length - 1 : 0);
  const total = entries.length;
  const current = (entries[step] || {}) as Record<string, unknown>;

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
      <tr style={{ borderBottom: '1px solid #f3f4f6', cursor: 'pointer' }}
          onClick={() => setOpen((o) => !o)}>
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, fontSize: 13 }}>
                <button onClick={() => setStep((s) => Math.max(0, s - 1))}
                        disabled={step === 0} style={{ padding: '2px 8px' }}>‹ Prev</button>
                <span style={{ color: '#374151' }}>
                  Step <strong>{step + 1}</strong> of {total}
                </span>
                <input type="range" min={0} max={Math.max(0, total - 1)} value={step}
                       onChange={(e) => setStep(parseInt(e.target.value, 10) || 0)}
                       style={{ flex: 1, maxWidth: 320 }} />
                <button onClick={() => setStep((s) => Math.min(total - 1, s + 1))}
                        disabled={step >= total - 1} style={{ padding: '2px 8px' }}>Next ›</button>
                {current.time !== undefined && (
                  <small style={{ color: '#6b7280' }}>time = {String(current.time)}</small>
                )}
              </div>
              <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 4,
                            padding: '8px 12px', maxHeight: 400, overflow: 'auto' }}>
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

/** Group a flat trajectory list into ObservableRow-friendly per-key entries. */
function trajectoryToObservables(
  trajectory: Array<{ step: number; state: Record<string, unknown> }>,
): Record<string, any[]> {
  const out: Record<string, any[]> = {};
  for (const row of trajectory) {
    for (const [k, v] of Object.entries(row.state || {})) {
      (out[k] ||= []).push(v);
    }
  }
  return out;
}

export function RunPanel(props: RunPanelProps) {
  const [steps, setSteps] = useState(5);
  const [runId, setRunId] = useState<string | null>(null);
  const [status, setStatus] = useState<RunStatus | null>(null);
  const [observables, setObservables] = useState<Record<string, any[]> | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const inInvestigation = !!(props.runContext && props.runContext.startsWith('investigation:'));
  const canRun = !!props.compositeId && !inInvestigation;
  const isRunning = status?.status === 'running' || (!!runId && !status);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const loadTrajectory = useCallback(async (id: string) => {
    try {
      const traj = await fetchRunTrajectory(id);
      setObservables(trajectoryToObservables(traj.trajectory));
    } catch {
      /* trajectory not ready yet — ignore, next poll retries */
    }
  }, []);

  // Poll one run until terminal. Independent cheap requests: a dropped poll
  // simply retries on the next tick.
  const beginPolling = useCallback((id: string) => {
    stopPolling();
    const tick = async () => {
      let s: RunStatus;
      try {
        s = await fetchRunStatus(id);
      } catch {
        return; // transient — try again next tick
      }
      setStatus(s);
      if (s.status === 'running') {
        void loadTrajectory(id);
      } else {
        stopPolling();
        void loadTrajectory(id);
        sessionStorage.removeItem(ACTIVE_RUN_KEY);
        if (s.status === 'completed' && props.compositeId) {
          postRunComplete(id, props.compositeId);
        }
      }
    };
    void tick();
    pollRef.current = setInterval(tick, POLL_MS);
  }, [stopPolling, loadTrajectory, props.compositeId]);

  // Re-attach to an in-flight run after an iframe reload / network blip.
  useEffect(() => {
    const raw = sessionStorage.getItem(ACTIVE_RUN_KEY);
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as { run_id: string; composite_id: string };
      if (saved.composite_id === props.compositeId && saved.run_id) {
        setRunId(saved.run_id);
        beginPolling(saved.run_id);
      }
    } catch {
      sessionStorage.removeItem(ACTIVE_RUN_KEY);
    }
    return stopPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.compositeId]);

  async function handleRun() {
    if (!props.compositeId) {
      setStartError('No composite id — pop-out windows need ?id=<dotted-ref> in the URL.');
      return;
    }
    setStartError(null);
    setStatus(null);
    setObservables(null);
    try {
      const res = await startRun({
        id: props.compositeId,
        steps,
        emit_paths: Array.from(props.emitSet),
      });
      setRunId(res.run_id);
      sessionStorage.setItem(ACTIVE_RUN_KEY, JSON.stringify({
        run_id: res.run_id, composite_id: props.compositeId,
      }));
      beginPolling(res.run_id);
    } catch (e: any) {
      setStartError(String(e?.message || e));
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

  const pct = status && status.n_steps
    ? Math.round((status.progress_step / status.n_steps) * 100)
    : 0;

  return (
    <div style={wrapStyle}>
      <h3 style={{ marginTop: 0 }}>Run</h3>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <label>
          Steps{' '}
          <input type="number" min={1} max={100} value={steps}
                 onChange={(e) => setSteps(parseInt(e.target.value) || 1)}
                 style={{ width: 70 }} disabled={isRunning} />
        </label>
        <button onClick={handleRun} disabled={isRunning || !canRun}>
          {isRunning ? 'Running…' : 'Run'}
        </button>
        <small style={{ color: '#666' }}>
          Emit selections:{' '}
          {props.emitSet.size === 0
            ? <em>none — pick stores in the View tab</em>
            : Array.from(props.emitSet).join(', ')}
        </small>
      </div>

      {startError && (
        <div style={{ color: '#c00', marginTop: 8 }}>
          <strong>Could not start run:</strong> {startError}
        </div>
      )}

      {isRunning && status && (
        <div style={{ margin: '8px 0' }}>
          <div style={{ background: '#e5e7eb', borderRadius: 4, height: 10, overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, background: '#3b82f6', height: '100%' }} />
          </div>
          <small style={{ color: '#6b7280' }}>
            Step {status.progress_step} of {status.n_steps ?? '?'} — running detached;
            safe to reload this tab.
          </small>
        </div>
      )}
      {isRunning && !status && (
        <p style={{ color: '#6b7280' }}>Starting run…</p>
      )}

      {status && (status.status === 'failed' || status.status === 'orphaned') && (
        <div style={{ color: '#c00', marginTop: 8 }}>
          <p style={{ margin: 0 }}>
            <strong>Run {status.status}.</strong>{' '}
            {status.log_path && <span>See log: <code>{status.log_path}</code></span>}
          </p>
          {status.error && (
            <details style={{ marginTop: 6 }}>
              <summary style={{ cursor: 'pointer', color: '#7f1d1d' }}>Show log excerpt</summary>
              <pre style={{ background: '#fef2f2', border: '1px solid #fecaca', padding: 10,
                            fontSize: 11, lineHeight: 1.4, overflow: 'auto', maxHeight: 320,
                            marginTop: 6, whiteSpace: 'pre-wrap' }}>
                {status.error.trim()}
              </pre>
            </details>
          )}
        </div>
      )}

      {status?.status === 'completed' && (
        <p style={{ color: '#6b7280', fontSize: 13, margin: '4px 0 10px' }}>
          Run complete — <strong>{status.n_steps ?? 0}</strong> steps. Click any
          observable row to browse its trajectory.
        </p>
      )}

      {observables && (
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f3f4f6' }}>
              <th style={{ textAlign: 'left', padding: '6px 8px' }}>Observable</th>
              <th style={{ textAlign: 'left', padding: '6px 8px', width: 80 }}>Steps</th>
              <th style={{ textAlign: 'left', padding: '6px 8px' }}>Latest preview</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(observables).sort().map(([k, entries]) => (
              <ObservableRow key={k} name={k} entries={entries} />
            ))}
            {!Object.keys(observables).length && (
              <tr>
                <td colSpan={3} style={{ padding: 12, color: '#666' }}>
                  No observables emitted. Toggle stores in the View tab to capture their values.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {status?.viz_html && Object.keys(status.viz_html).length > 0 && (
        <div style={{ marginTop: 20 }}>
          <h4>Visualizations</h4>
          {Object.entries(status.viz_html).map(([path, payload]) => (
            <div key={path} style={{ marginBottom: 12, border: '1px solid #e5e7eb', borderRadius: 4 }}>
              <div style={{ padding: '6px 10px', background: '#f3f4f6', fontFamily: 'monospace', fontSize: 12 }}>
                {path}
              </div>
              <iframe srcDoc={(payload as { html: string }).html || '<p>No HTML</p>'}
                      style={{ width: '100%', height: 320, border: 0 }}
                      sandbox="allow-scripts" />
            </div>
          ))}
        </div>
      )}

      {!runId && !startError && (
        <p style={{ color: '#888' }}>
          Click <strong>Run</strong> to execute the composite for the chosen number of steps.
        </p>
      )}
    </div>
  );
}
