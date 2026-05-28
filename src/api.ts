// src/api.ts — postMessage protocol with the embedding dashboard.

/** One parameter declared by a composite (spec or generator). Mirrors the
 *  Python decorator's parameters shape. */
export interface ParameterDecl {
  type: 'string' | 'int' | 'float' | 'bool' | 'list[string]' | string;
  default?: unknown;
  description?: string;
}

export type CompositeLoadMsg = {
  type: 'composite:load';
  state: any;
  parameters?: Record<string, ParameterDecl>;
  overrides?: Record<string, unknown>;
  default_n_steps?: number;
  metadata?: { name?: string; library?: string; context?: string; id?: string };
};

export type ExploreReadyMsg = { type: 'explore:ready' };

export type ExploreInspectMsg = {
  type: 'explore:inspect';
  path: string[];
  kind: 'store' | 'process';
  details: Record<string, unknown>;
};

export type ExploreEmitChangedMsg = {
  type: 'explore:emit-changed';
  paths: string[];  // explicit-emit path strings, joined by '/'
};

export type ExploreRunCompleteMsg = {
  type: 'explore:run-complete';
  simulation_id: string;
  composite_id: string;
};

/** Pick the right postMessage target for the embedding context.
 *
 * - Embedded iframe: messages go to `window.parent` (the embedding page).
 * - Pop-out window: `window.parent === window` (no parent frame); the dashboard
 *   that opened us is at `window.opener`. Without this branch the popup posts
 *   to itself and the dashboard never sees `explore:ready` → no state arrives.
 */
function _embeddingTarget(): WindowProxy | null {
  if (window.opener && window.opener !== window) return window.opener;
  if (window.parent && window.parent !== window) return window.parent;
  return null;
}

export function postReady() {
  const target = _embeddingTarget();
  if (target) target.postMessage({ type: 'explore:ready' } as ExploreReadyMsg, '*');
}

export function postInspect(payload: Omit<ExploreInspectMsg, 'type'>) {
  const target = _embeddingTarget();
  if (target) target.postMessage({ type: 'explore:inspect', ...payload }, '*');
}

export function postEmitChanged(paths: string[]) {
  const target = _embeddingTarget();
  if (target) target.postMessage(
    { type: 'explore:emit-changed', paths } as ExploreEmitChangedMsg,
    '*',
  );
}

export function postRunComplete(simulation_id: string, composite_id: string) {
  const target = _embeddingTarget();
  if (target) target.postMessage(
    { type: 'explore:run-complete', simulation_id, composite_id } as ExploreRunCompleteMsg,
    '*',
  );
}

export function onCompositeLoad(handler: (msg: CompositeLoadMsg) => void) {
  const listener = (ev: MessageEvent) => {
    if (ev.data?.type === 'composite:load') handler(ev.data as CompositeLoadMsg);
  };
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}

/** Decode an optional URL-param composite (?composite=<base64-json>). */
export function decodeUrlComposite(): any | null {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('composite');
  if (!raw) return null;
  try {
    return JSON.parse(atob(raw));
  } catch {
    return null;
  }
}

// --- Run lifecycle (start-then-poll) -------------------------------------

export type RunStatusValue = 'running' | 'completed' | 'failed' | 'orphaned';

export interface StartRunArgs {
  id: string;
  steps: number;
  emit_paths: string[];
  overrides?: Record<string, unknown>;
  label?: string;
}

export interface StartRunResponse {
  run_id: string;
  status: RunStatusValue;
}

export interface RunStatus {
  run_id: string;
  status: RunStatusValue;
  progress_step: number;
  n_steps: number | null;
  heartbeat_at: number | null;
  error?: string;
  log_path?: string;
  viz_html?: Record<string, { html: string }>;
}

export interface RunTrajectory {
  run_id: string;
  trajectory: Array<{ step: number; time?: number; state: Record<string, unknown> }>;
}

/** Start a detached composite run. Resolves with {run_id}; rejects on non-2xx
 *  (notably 429 when the concurrency cap is hit) with the server's error text. */
export async function startRun(args: StartRunArgs): Promise<StartRunResponse> {
  const r = await fetch('/api/composite-test-run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const body = await r.json();
  if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
  return body as StartRunResponse;
}

/** Poll one run's status. Cheap single-row read; safe to call on an interval. */
export async function fetchRunStatus(runId: string): Promise<RunStatus> {
  const r = await fetch(`/api/composite-run/${runId}/status`);
  const body = await r.json();
  if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
  return body as RunStatus;
}

/** Fetch a run's trajectory. Works mid-run (partial) and after completion. */
export async function fetchRunTrajectory(runId: string): Promise<RunTrajectory> {
  const r = await fetch(`/api/composite-run/${runId}`);
  const body = await r.json();
  if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
  return body as RunTrajectory;
}

// --- Compute backends ----------------------------------------------------

export type BackendKind = 'local' | 'hpc' | 'unknown';

export interface ComputeBackend {
  id: string;
  label: string;
  description: string;
  kind: BackendKind;
}

/** Uniform connectivity-probe shape returned by `/api/compute-backends/<id>/status`. */
export interface BackendStatus {
  ok: boolean;
  kind: BackendKind;
  message?: string;
  detail?: Record<string, unknown>;
  missing_fields?: string[];
}

/** List the dashboard's registered compute backends. */
export async function fetchComputeBackends(): Promise<ComputeBackend[]> {
  const r = await fetch('/api/compute-backends');
  const body = await r.json();
  if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
  return (body.backends || []) as ComputeBackend[];
}

/** Probe one backend's connectivity. */
export async function fetchBackendStatus(id: string): Promise<BackendStatus> {
  const r = await fetch(`/api/compute-backends/${encodeURIComponent(id)}/status`);
  const body = await r.json();
  if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
  return body as BackendStatus;
}

// --- HPC run-config (per-composite) --------------------------------------

/** Per-composite HPC run defaults persisted as the `hpc_run_config` block of
 *  the composite doc. Field set mirrors the legacy dashboard HPC form. All
 *  fields are optional — the server merges (not replaces) so partial saves
 *  preserve other keys. */
export interface HpcRunConfig {
  backend?: string;        // e.g. "v2ecoli"
  n_cells?: number;
  duration_min?: number;
  seed?: number;
  cpus?: number;
  mem_gb?: number;
  time_limit_min?: number;
  outdir?: string;         // ParCa output directory
  cache_dir?: string;      // Colony cache directory (typically <outdir>/cache)
}

export async function fetchHpcConfig(specId: string): Promise<HpcRunConfig> {
  const r = await fetch(`/api/composite/${encodeURIComponent(specId)}/hpc-config`);
  const body = await r.json();
  if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
  return (body.hpc_run_config || {}) as HpcRunConfig;
}

export async function saveHpcConfig(specId: string, cfg: HpcRunConfig): Promise<HpcRunConfig> {
  const r = await fetch(`/api/composite/${encodeURIComponent(specId)}/hpc-config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hpc_run_config: cfg }),
  });
  const body = await r.json();
  if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
  return (body.hpc_run_config || {}) as HpcRunConfig;
}

// --- HPC run submission + polling ----------------------------------------

export interface HpcRunResources {
  cpus: number;
  mem_gb: number;
  time_min: number;
}

export interface HpcRunSubmitArgs extends HpcRunResources {
  command: string;
  composite_id: string;
}

export interface HpcRunSubmitResponse {
  run_id: string;
  slurm_job_id: number | string;
  log_path?: string;
}

export interface HpcRunStatus {
  state: string;           // e.g. PENDING, RUNNING, COMPLETED, FAILED, CANCELLED, TIMEOUT
  slurm_job_id?: number | string;
  [extra: string]: unknown;
}

export interface HpcRunLog {
  log: string;
  run_id: string;
}

/** Submit a SLURM job to ``/api/hpc/<workload>/run``. ``workload`` is the
 *  workload-image identifier (e.g. ``v2ecoli``), not the cluster id. The
 *  cluster is resolved from the workspace's hpc settings server-side. */
export async function submitHpcRun(
  workload: string, args: HpcRunSubmitArgs,
): Promise<HpcRunSubmitResponse> {
  const r = await fetch(`/api/hpc/${encodeURIComponent(workload)}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const body = await r.json();
  if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
  return body as HpcRunSubmitResponse;
}

export async function fetchHpcRunStatus(
  workload: string, slurmJobId: number | string,
): Promise<HpcRunStatus> {
  const r = await fetch(`/api/hpc/${encodeURIComponent(workload)}/run/${slurmJobId}`);
  const body = await r.json();
  if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
  return body as HpcRunStatus;
}

export async function fetchHpcRunLog(
  workload: string, runId: string,
): Promise<HpcRunLog> {
  const r = await fetch(`/api/hpc/${encodeURIComponent(workload)}/run/${encodeURIComponent(runId)}/log`);
  const body = await r.json();
  if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
  return body as HpcRunLog;
}
