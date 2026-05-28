// HPC Run tab body. Rendered by RunPanel when an HPC backend is selected.
//
// Two job cards in one panel — ParCa (parameter calibration → out/sim_data)
// and Colony (whole-cell simulation that reads ParCa's cache). Each card
// submits a SLURM job via /api/hpc/<workload>/run, then polls
// /api/hpc/<workload>/run/<slurm_id> (state chip) and
// /api/hpc/<workload>/run/<run_id>/log (log tail) until terminal.
//
// Defaults are seeded from the composite's persisted hpc_run_config (managed
// by the Configure tab's HpcConfigForm). The user can override per-run
// resources inline. Active jobs survive iframe reloads via sessionStorage.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchHpcConfig, fetchHpcRunLog, fetchHpcRunStatus, submitHpcRun,
  type HpcRunConfig,
} from '../api';
import { useBackend } from '../BackendContext';

export interface HpcRunPanelProps {
  compositeId: string | null;
}

interface JobState {
  runId: string;
  slurmJobId: string | number;
  workload: string;
  state: string;             // SLURM state (PENDING/RUNNING/COMPLETED/FAILED/...)
  log: string;
  error?: string;
}

type CardKey = 'parca' | 'colony';

const ACTIVE_JOBS_KEY = 'loom-explore:hpc-active-jobs';
const TERMINAL_STATES = new Set(['COMPLETED', 'FAILED', 'CANCELLED', 'TIMEOUT']);

function _isTerminal(s: string): boolean { return TERMINAL_STATES.has(s.toUpperCase()); }

function _loadPersisted(compositeId: string | null): Partial<Record<CardKey, JobState>> {
  if (!compositeId) return {};
  try {
    const raw = sessionStorage.getItem(ACTIVE_JOBS_KEY);
    if (!raw) return {};
    const all = JSON.parse(raw) as Record<string, Partial<Record<CardKey, JobState>>>;
    return all[compositeId] || {};
  } catch { return {}; }
}

function _persistJob(compositeId: string, card: CardKey, job: JobState | null) {
  try {
    const raw = sessionStorage.getItem(ACTIVE_JOBS_KEY);
    const all = raw ? JSON.parse(raw) as Record<string, Partial<Record<CardKey, JobState>>> : {};
    const slot = all[compositeId] || {};
    if (job) slot[card] = job; else delete slot[card];
    all[compositeId] = slot;
    sessionStorage.setItem(ACTIVE_JOBS_KEY, JSON.stringify(all));
  } catch { /* sessionStorage unavailable */ }
}

// ParCa logs emit ``checkpoint_step_<N>.pkl`` lines; there are nine
// checkpoints in the canonical pipeline. Parsing the highest observed step
// drives the determinate progress bar.
function _parcaProgressPct(log: string): number | null {
  const matches = log.match(/checkpoint_step_(\d+)\.pkl/g);
  if (!matches?.length) return null;
  let max = 0;
  for (const m of matches) {
    const n = parseInt(m.match(/(\d+)/)![1], 10);
    if (n > max) max = n;
  }
  return Math.min(100, Math.round(max / 9 * 100));
}

export function HpcRunPanel({ compositeId }: HpcRunPanelProps) {
  const { selected, selectedId, statusById } = useBackend();
  const status = selectedId ? statusById[selectedId] : undefined;

  const [cfg, setCfg] = useState<HpcRunConfig | null>(null);
  const [cfgError, setCfgError] = useState<string | null>(null);
  const [parca, setParca] = useState<JobState | null>(null);
  const [colony, setColony] = useState<JobState | null>(null);

  // Hydrate hpc_run_config from the composite each time it changes.
  useEffect(() => {
    if (!compositeId) { setCfg(null); return; }
    let cancelled = false;
    setCfgError(null);
    fetchHpcConfig(compositeId)
      .then((c) => { if (!cancelled) setCfg(c); })
      .catch((exc) => { if (!cancelled) setCfgError(String(exc)); });
    return () => { cancelled = true; };
  }, [compositeId]);

  // Resume any active jobs for this composite on mount / composite-change.
  useEffect(() => {
    const persisted = _loadPersisted(compositeId);
    setParca(persisted.parca || null);
    setColony(persisted.colony || null);
  }, [compositeId]);

  const workload = (cfg?.backend || 'v2ecoli').trim();

  // Shared poll loop: re-fetch status + log for any non-terminal job. Cheap
  // single requests; a dropped tick just retries.
  const pollJob = useCallback(async (job: JobState): Promise<JobState> => {
    let next: JobState = job;
    try {
      const log = await fetchHpcRunLog(job.workload, job.runId);
      next = { ...next, log: log.log };
    } catch { /* log not ready */ }
    try {
      const st = await fetchHpcRunStatus(job.workload, job.slurmJobId);
      next = { ...next, state: (st.state || 'UNKNOWN').toUpperCase() };
    } catch { /* transient */ }
    return next;
  }, []);

  // ParCa polling.
  useEffect(() => {
    if (!parca || _isTerminal(parca.state)) return;
    let cancelled = false;
    const tick = async () => {
      const updated = await pollJob(parca);
      if (cancelled) return;
      setParca(updated);
      if (compositeId) {
        _persistJob(compositeId, 'parca', _isTerminal(updated.state) ? null : updated);
      }
    };
    void tick();
    const id = setInterval(tick, 20000);
    return () => { cancelled = true; clearInterval(id); };
  }, [parca?.runId, parca?.state, pollJob, compositeId]);

  // Colony polling.
  useEffect(() => {
    if (!colony || _isTerminal(colony.state)) return;
    let cancelled = false;
    const tick = async () => {
      const updated = await pollJob(colony);
      if (cancelled) return;
      setColony(updated);
      if (compositeId) {
        _persistJob(compositeId, 'colony', _isTerminal(updated.state) ? null : updated);
      }
    };
    void tick();
    const id = setInterval(tick, 30000);
    return () => { cancelled = true; clearInterval(id); };
  }, [colony?.runId, colony?.state, pollJob, compositeId]);

  const canSubmit = !!compositeId && !!cfg;

  if (!compositeId) {
    return (
      <div style={_wrap}>
        <h3 style={_h3}>HPC Run</h3>
        <p style={_muted}>No composite selected.</p>
      </div>
    );
  }

  if (cfgError) {
    return (
      <div style={_wrap}>
        <h3 style={_h3}>HPC Run</h3>
        <p style={{ color: '#b91c1c' }}>Could not load HPC config: {cfgError}</p>
      </div>
    );
  }

  return (
    <div style={_wrap}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <h3 style={_h3}>HPC Run</h3>
        <span style={_muted}>
          Dispatching to <strong>{selected?.label ?? selectedId}</strong>
          {' · workload '}<code>{workload}</code>
        </span>
      </div>

      {status && !status.ok && (
        <div style={_warn}>
          <strong>Backend is not connected.</strong>{' '}
          {status.missing_fields?.length
            ? <>Missing: <code>{status.missing_fields.join(', ')}</code></>
            : status.message || 'Submitting will fail until connectivity is restored.'}
        </div>
      )}

      <ParcaCard
        cfg={cfg} workload={workload} compositeId={compositeId} canSubmit={canSubmit}
        job={parca} setJob={setParca}
      />
      <ColonyCard
        cfg={cfg} workload={workload} compositeId={compositeId} canSubmit={canSubmit}
        job={colony} setJob={setColony}
      />
    </div>
  );
}

// --- ParCa card ----------------------------------------------------------

function ParcaCard({
  cfg, workload, compositeId, canSubmit, job, setJob,
}: {
  cfg: HpcRunConfig | null;
  workload: string;
  compositeId: string;
  canSubmit: boolean;
  job: JobState | null;
  setJob: (j: JobState | null) => void;
}) {
  const [cpus, setCpus] = useState(cfg?.cpus ?? 8);
  const [memGb, setMemGb] = useState(cfg?.mem_gb ?? 32);
  const [timeMin, setTimeMin] = useState(cfg?.time_limit_min ?? 60);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const outdir = cfg?.outdir || 'out/sim_data';

  // Re-seed from cfg when it (re-)loads.
  useEffect(() => {
    if (!cfg) return;
    setCpus(cfg.cpus ?? 8);
    setMemGb(cfg.mem_gb ?? 32);
    setTimeMin(cfg.time_limit_min ?? 60);
  }, [cfg]);

  const running = !!job && !_isTerminal(job.state);
  const pct = job ? _parcaProgressPct(job.log) : null;

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const command = `v2ecoli-parca --mode fast --cpus ${cpus} --outdir ${outdir}`;
      const res = await submitHpcRun(workload, {
        command, composite_id: compositeId,
        cpus, mem_gb: memGb, time_min: timeMin,
      });
      const next: JobState = {
        runId: res.run_id, slurmJobId: res.slurm_job_id, workload,
        state: 'PENDING', log: '(waiting for log…)',
      };
      setJob(next);
      _persistJob(compositeId, 'parca', next);
    } catch (exc) {
      setError(String(exc instanceof Error ? exc.message : exc));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section style={_card}>
      <h4 style={_h4}>⚗️ Run ParCa</h4>
      <div style={_muted}>
        Fit whole-cell parameters. Output: <code>{outdir}</code>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 8 }}>
        <NumField label="CPUs" min={1} max={64} value={cpus} onChange={setCpus} disabled={running} />
        <NumField label="Mem (GB)" min={8} max={256} value={memGb} onChange={setMemGb} disabled={running} />
        <NumField label="Time (min)" min={10} max={1440} value={timeMin} onChange={setTimeMin} disabled={running} />
      </div>
      <RunActions
        label="▶ Run ParCa"
        canSubmit={canSubmit && !running && !submitting}
        submitting={submitting}
        onClick={submit}
        chip={job ? <StateChip job={job} /> : null}
        error={error}
      />
      {running && (
        <ProgressBar pct={pct} label={
          pct != null ? `Step ${Math.round(pct * 9 / 100)} / 9 (${pct}%)` : 'queued / running…'
        } />
      )}
      {job && <LogPre log={job.log} />}
    </section>
  );
}

// --- Colony card ---------------------------------------------------------

function ColonyCard({
  cfg, workload, compositeId, canSubmit, job, setJob,
}: {
  cfg: HpcRunConfig | null;
  workload: string;
  compositeId: string;
  canSubmit: boolean;
  job: JobState | null;
  setJob: (j: JobState | null) => void;
}) {
  const [nCells, setNCells] = useState(cfg?.n_cells ?? 4);
  const [duration, setDuration] = useState(cfg?.duration_min ?? 22);
  const [seed, setSeed] = useState(cfg?.seed ?? 0);
  const [memGb, setMemGb] = useState(cfg?.mem_gb ?? 32);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cacheDir = cfg?.cache_dir || 'out/sim_data/cache';

  useEffect(() => {
    if (!cfg) return;
    setNCells(cfg.n_cells ?? 4);
    setDuration(cfg.duration_min ?? 22);
    setSeed(cfg.seed ?? 0);
    setMemGb(cfg.mem_gb ?? 32);
  }, [cfg]);

  const running = !!job && !_isTerminal(job.state);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const command =
        `v2ecoli-colony --n-cells ${nCells}` +
        ` --duration-min ${duration}` +
        ` --seed ${seed}` +
        ` --cache-dir ${cacheDir}`;
      const res = await submitHpcRun(workload, {
        command, composite_id: compositeId,
        cpus: 1, mem_gb: memGb, time_min: Math.max(duration * 3, 60),
      });
      const next: JobState = {
        runId: res.run_id, slurmJobId: res.slurm_job_id, workload,
        state: 'PENDING', log: '(waiting for log…)',
      };
      setJob(next);
      _persistJob(compositeId, 'colony', next);
    } catch (exc) {
      setError(String(exc instanceof Error ? exc.message : exc));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section style={_card}>
      <h4 style={_h4}>🧬 Run Colony</h4>
      <div style={_muted}>
        Simulate the colony using the ParCa cache at <code>{cacheDir}</code>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, marginTop: 8 }}>
        <NumField label="N Cells" min={1} max={64} value={nCells} onChange={setNCells} disabled={running} />
        <NumField label="Duration (min)" min={1} max={1440} value={duration} onChange={setDuration} disabled={running} />
        <NumField label="Seed" min={0} value={seed} onChange={setSeed} disabled={running} />
        <NumField label="Mem (GB)" min={8} max={512} value={memGb} onChange={setMemGb} disabled={running} />
      </div>
      <RunActions
        label="🧬 Run Colony"
        canSubmit={canSubmit && !running && !submitting}
        submitting={submitting}
        onClick={submit}
        chip={job ? <StateChip job={job} /> : null}
        error={error}
      />
      {running && <ProgressBar pct={null} label="queued / running…" />}
      {job && <LogPre log={job.log} />}
    </section>
  );
}

// --- Shared bits ---------------------------------------------------------

function StateChip({ job }: { job: JobState }) {
  const state = job.state.toUpperCase();
  const color = state === 'COMPLETED' ? '#16a34a'
    : state === 'FAILED' || state === 'CANCELLED' || state === 'TIMEOUT' ? '#dc2626'
    : '#6b7280';
  return (
    <span style={{ fontSize: 12, fontWeight: 600, color }}>
      SLURM {String(job.slurmJobId)}: {state}
    </span>
  );
}

function ProgressBar({ pct, label }: { pct: number | null; label: string }) {
  const isDet = pct != null;
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ background: '#e5e7eb', borderRadius: 4, height: 8, overflow: 'hidden', position: 'relative' }}>
        <div
          style={{
            background: '#3b82f6',
            height: '100%',
            width: isDet ? `${pct}%` : '40%',
            transition: isDet ? 'width 0.3s' : undefined,
            animation: isDet ? undefined : 'loom-indeterminate 1.4s ease-in-out infinite',
            position: isDet ? undefined : 'absolute',
          }}
        />
      </div>
      <small style={{ color: '#6b7280' }}>{label}</small>
      {!isDet && (
        <style>{`@keyframes loom-indeterminate { 0% { left: -40%; } 100% { left: 100%; } }`}</style>
      )}
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
        marginTop: 10, padding: 8, maxHeight: 200, overflow: 'auto',
        background: '#0f172a', color: '#e2e8f0', fontSize: 11, lineHeight: 1.4,
        borderRadius: 4, whiteSpace: 'pre-wrap',
      }}
    >
      {log || '(no log yet)'}
    </pre>
  );
}

function RunActions({
  label, canSubmit, submitting, onClick, chip, error,
}: {
  label: string;
  canSubmit: boolean;
  submitting: boolean;
  onClick: () => void;
  chip: React.ReactNode;
  error: string | null;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
      <button
        type="button"
        onClick={onClick}
        disabled={!canSubmit}
        style={{
          padding: '6px 14px', fontSize: 13, fontWeight: 600,
          background: canSubmit ? '#2563eb' : '#9ca3af',
          color: '#fff', border: 0, borderRadius: 4,
          cursor: canSubmit ? 'pointer' : 'default',
        }}
      >
        {submitting ? 'Submitting…' : label}
      </button>
      {chip}
      {error && <span style={{ fontSize: 12, color: '#b91c1c' }}>Error: {error}</span>}
    </div>
  );
}

function NumField({
  label, value, onChange, min, max, disabled,
}: {
  label: string; value: number; onChange: (n: number) => void;
  min?: number; max?: number; disabled?: boolean;
}) {
  return (
    <label style={{
      display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12,
      fontWeight: 600, color: '#555',
    }}>
      {label}
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          if (!Number.isNaN(n)) onChange(n);
        }}
        style={{
          fontSize: 13, padding: '4px 8px',
          border: '1px solid #d1d5db', borderRadius: 4,
        }}
      />
    </label>
  );
}

// --- Styles --------------------------------------------------------------

const _wrap: React.CSSProperties = { padding: 16, fontFamily: 'system-ui, sans-serif' };
const _h3: React.CSSProperties = { marginTop: 0, marginBottom: 8 };
const _h4: React.CSSProperties = { marginTop: 0, marginBottom: 4 };
const _muted: React.CSSProperties = { fontSize: 12, color: '#6b7280' };
const _card: React.CSSProperties = {
  marginTop: 14, padding: 12,
  border: '1px solid #e5e7eb', borderRadius: 6, background: '#fafafa',
};
const _warn: React.CSSProperties = {
  marginTop: 10, padding: '8px 12px',
  background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 4,
  fontSize: 12, color: '#92400e',
};