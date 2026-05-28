// HPC Results tab body. Rendered by ResultsPanel when an HPC backend is
// selected.
//
// Lists the composite's HPC runs (via /api/composite/<id>/runs — the server
// filters meta sidecars by composite_id) and shows per-run detail: SLURM
// chip, terminal-state summary stats grid, and a tailable log pane. The
// selected run's log auto-refreshes every 30 s; the runs list has a manual
// refresh button.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchCompositeHpcRuns, fetchCompositeRunSummary, fetchHpcRunLog,
  type CompositeHpcRunMeta, type CompositeRunSummary,
} from '../api';

export interface HpcResultsPanelProps {
  compositeId: string | null;
}

const LOG_POLL_MS = 30000;

export function HpcResultsPanel({ compositeId }: HpcResultsPanelProps) {
  const [runs, setRuns] = useState<CompositeHpcRunMeta[] | null>(null);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [summary, setSummary] = useState<CompositeRunSummary | null>(null);
  const [summaryMeta, setSummaryMeta] = useState<CompositeHpcRunMeta | null>(null);
  const [log, setLog] = useState<string>('');
  const [logBusy, setLogBusy] = useState(false);

  const refreshRuns = useCallback(async () => {
    if (!compositeId) return;
    setRunsError(null);
    try {
      const list = await fetchCompositeHpcRuns(compositeId);
      setRuns(list);
      setSelectedRunId((prev) => {
        if (prev && list.some((r) => r.run_id === prev)) return prev;
        return list[0]?.run_id ?? null;
      });
    } catch (exc) {
      setRunsError(String(exc instanceof Error ? exc.message : exc));
      setRuns([]);
    }
  }, [compositeId]);

  useEffect(() => { void refreshRuns(); }, [refreshRuns]);

  // Selected run's meta drives the workload id we ask for the log under.
  const selectedMeta = runs?.find((r) => r.run_id === selectedRunId) ?? null;
  const workload = selectedMeta?.backend || 'v2ecoli';

  // Reset detail state when the selection changes.
  useEffect(() => {
    setSummary(null);
    setSummaryMeta(null);
    setLog('');
  }, [selectedRunId]);

  // Summary fetch (single shot per selection — the terminal JSON block in
  // the log doesn't change once written).
  useEffect(() => {
    if (!compositeId || !selectedRunId) return;
    let cancelled = false;
    fetchCompositeRunSummary(compositeId, selectedRunId)
      .then((data) => {
        if (cancelled) return;
        setSummary(data.summary);
        setSummaryMeta(data.meta);
      })
      .catch(() => { /* summary endpoint is best-effort; ignore */ });
    return () => { cancelled = true; };
  }, [compositeId, selectedRunId]);

  // Log auto-refresh.
  const refreshLog = useCallback(async () => {
    if (!selectedRunId) return;
    setLogBusy(true);
    try {
      const r = await fetchHpcRunLog(workload, selectedRunId);
      setLog(r.log || '(no log yet)');
    } catch {
      setLog('(error loading log)');
    } finally {
      setLogBusy(false);
    }
  }, [selectedRunId, workload]);

  useEffect(() => {
    if (!selectedRunId) return;
    void refreshLog();
    const id = setInterval(() => { void refreshLog(); }, LOG_POLL_MS);
    return () => clearInterval(id);
  }, [refreshLog, selectedRunId]);

  if (!compositeId) {
    return (
      <div style={_wrap}>
        <h3 style={_h3}>HPC Results</h3>
        <p style={_muted}>No composite selected.</p>
      </div>
    );
  }

  return (
    <div style={_wrap}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <h3 style={_h3}>HPC Results</h3>
        <button type="button" onClick={() => { void refreshRuns(); }} style={_btnMini}>
          ↻ Refresh runs
        </button>
      </div>

      {runsError && (
        <div style={{ color: '#b91c1c', fontSize: 12, marginBottom: 8 }}>
          Error loading runs: {runsError}
        </div>
      )}

      {runs == null && !runsError && (
        <p style={_muted}>Loading runs…</p>
      )}

      {runs && runs.length === 0 && (
        <p style={_muted}>
          No HPC runs for this composite yet. Use the <strong>Run</strong> tab to submit jobs.
        </p>
      )}

      {runs && runs.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
          {runs.map((r) => (
            <RunCard
              key={r.run_id}
              run={r}
              active={r.run_id === selectedRunId}
              onClick={() => setSelectedRunId(r.run_id)}
            />
          ))}
        </div>
      )}

      {selectedRunId && selectedMeta && (
        <RunDetail
          meta={selectedMeta}
          summary={summary}
          summaryMeta={summaryMeta}
          log={log}
          logBusy={logBusy}
          onRefreshLog={refreshLog}
        />
      )}
    </div>
  );
}

// --- Run card -----------------------------------------------------------

function RunCard({
  run, active, onClick,
}: {
  run: CompositeHpcRunMeta;
  active: boolean;
  onClick: () => void;
}) {
  const dt = run.submitted_at ? new Date(run.submitted_at).toLocaleString() : '';
  const cmdShort = (run.command || '').replace(/^v2ecoli-/, '').slice(0, 60);
  return (
    <div
      onClick={onClick}
      style={{
        padding: '8px 10px', borderRadius: 4, cursor: 'pointer',
        border: '1px solid',
        borderColor: active ? '#2563eb' : '#e5e7eb',
        background: active ? '#eff6ff' : '#fff',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <code style={{ fontSize: 12 }}>{run.run_id}</code>
        <span style={{
          fontSize: 11, color: '#475569',
          padding: '1px 6px', background: '#e2e8f0', borderRadius: 3,
        }}>
          SLURM {String(run.slurm_job_id)}
        </span>
      </div>
      <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
        {dt}{cmdShort && ` · ${cmdShort}`}
      </div>
    </div>
  );
}

// --- Run detail (summary grid + log tail) -------------------------------

function RunDetail({
  meta, summary, summaryMeta, log, logBusy, onRefreshLog,
}: {
  meta: CompositeHpcRunMeta;
  summary: CompositeRunSummary | null;
  summaryMeta: CompositeHpcRunMeta | null;
  log: string;
  logBusy: boolean;
  onRefreshLog: () => void;
}) {
  void summaryMeta; // currently unused — meta from the list is sufficient
  return (
    <section style={{
      marginTop: 14, padding: 12,
      border: '1px solid #e5e7eb', borderRadius: 6, background: '#fafafa',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <strong style={{ fontSize: 14 }}>Run <code>{meta.run_id}</code></strong>
        <span style={{ fontSize: 11, color: '#475569',
                       padding: '1px 6px', background: '#e2e8f0', borderRadius: 3 }}>
          SLURM {String(meta.slurm_job_id)}
        </span>
        {summary?.status && (
          <span style={{
            fontSize: 11, fontWeight: 600,
            color: _statusColor(String(summary.status)),
          }}>
            {String(summary.status).toUpperCase()}
          </span>
        )}
      </div>

      {summary && <SummaryGrid summary={summary} />}

      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginTop: summary ? 12 : 0, marginBottom: 4,
      }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#555' }}>Log</span>
        <button
          type="button"
          onClick={onRefreshLog}
          disabled={logBusy}
          style={_btnMini}
        >
          {logBusy ? '↻ Refreshing…' : '↻ Refresh'}
        </button>
      </div>
      <LogPre log={log} />
    </section>
  );
}

function SummaryGrid({ summary }: { summary: CompositeRunSummary }) {
  // Renders the stats the legacy JS surfaces. Missing keys collapse to "—".
  const stats: Array<[string, string]> = [
    ['Status', summary.status != null ? String(summary.status) : '—'],
    ['Cells (initial→final)',
      `${summary.n_cells_initial ?? '?'} → ${summary.n_cells_final ?? '?'}`],
    ['Duration', summary.duration_s != null
      ? `${(summary.duration_s / 60).toFixed(1)} min sim` : '—'],
    ['Wall time', summary.wall_seconds != null
      ? `${(summary.wall_seconds / 60).toFixed(1)} min` : '—'],
    ['Peak RSS', summary.peak_rss_mb != null
      ? `${Math.round(summary.peak_rss_mb / 1024)} GB` : '—'],
    ['Divisions', summary.n_division_events != null
      ? String(summary.n_division_events) : '—'],
  ];
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8,
      marginBottom: 4,
    }}>
      {stats.map(([key, val]) => (
        <div key={key} style={{
          padding: '6px 10px',
          background: '#fff', border: '1px solid #e5e7eb', borderRadius: 4,
        }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>{val}</div>
          <div style={{ fontSize: 11, color: '#6b7280' }}>{key}</div>
        </div>
      ))}
    </div>
  );
}

function LogPre({ log }: { log: string }) {
  const ref = useRef<HTMLPreElement | null>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [log]);
  return (
    <pre
      ref={ref}
      style={{
        margin: 0, padding: 8, maxHeight: 320, overflow: 'auto',
        background: '#0f172a', color: '#e2e8f0', fontSize: 11, lineHeight: 1.4,
        borderRadius: 4, whiteSpace: 'pre-wrap',
      }}
    >
      {log || '(no log yet)'}
    </pre>
  );
}

function _statusColor(s: string): string {
  const u = s.toUpperCase();
  if (u === 'COMPLETED' || u === 'OK' || u === 'SUCCESS') return '#16a34a';
  if (u === 'FAILED' || u === 'CANCELLED' || u === 'TIMEOUT' || u === 'ERROR') return '#dc2626';
  return '#6b7280';
}

// --- Styles -------------------------------------------------------------

const _wrap: React.CSSProperties = { padding: 16, fontFamily: 'system-ui, sans-serif' };
const _h3: React.CSSProperties = { marginTop: 0, marginBottom: 8 };
const _muted: React.CSSProperties = { fontSize: 12, color: '#6b7280' };
const _btnMini: React.CSSProperties = {
  fontSize: 11, padding: '3px 8px',
  border: '1px solid #d1d5db', borderRadius: 4,
  background: '#fff', cursor: 'pointer',
};
