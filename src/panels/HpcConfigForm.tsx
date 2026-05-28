// HPC run-config form. Rendered by ConfigurePanel when an HPC backend is
// selected. Round-trips through `/api/composite/<id>/hpc-config` and saves
// the merged result back into the composite doc (server-side commit).
import { useEffect, useState } from 'react';
import { fetchHpcConfig, saveHpcConfig, type HpcRunConfig } from '../api';
import { useBackend } from '../BackendContext';

const _DEFAULTS: Required<Pick<HpcRunConfig,
  'backend' | 'n_cells' | 'duration_min' | 'seed' | 'cpus' | 'mem_gb' |
  'time_limit_min' | 'outdir' | 'cache_dir'
>> = {
  backend: 'v2ecoli',
  n_cells: 4,
  duration_min: 22,
  seed: 0,
  cpus: 8,
  mem_gb: 32,
  time_limit_min: 60,
  outdir: 'out/sim_data',
  cache_dir: 'out/sim_data/cache',
};

type FormState = Required<typeof _DEFAULTS>;

function _merge(saved: HpcRunConfig): FormState {
  return { ..._DEFAULTS, ...saved } as FormState;
}

export interface HpcConfigFormProps {
  compositeId: string | null;
}

export function HpcConfigForm({ compositeId }: HpcConfigFormProps) {
  const { selected, statusById, selectedId } = useBackend();
  const status = selectedId ? statusById[selectedId] : undefined;

  const [values, setValues] = useState<FormState>(_DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  // Hydrate from server whenever the composite id changes.
  useEffect(() => {
    if (!compositeId) {
      setValues(_DEFAULTS);
      setLoaded(true);
      return;
    }
    let cancelled = false;
    setLoaded(false);
    setError(null);
    setOkMsg(null);
    fetchHpcConfig(compositeId)
      .then((cfg) => {
        if (cancelled) return;
        setValues(_merge(cfg));
        setDirty(false);
      })
      .catch((exc) => {
        if (cancelled) return;
        setError(String(exc));
      })
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [compositeId]);

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setValues((prev) => ({ ...prev, [k]: v }));
    setDirty(true);
    setOkMsg(null);
  };

  async function save() {
    if (!compositeId) {
      setError('No composite id — cannot save.');
      return;
    }
    setSaving(true);
    setError(null);
    setOkMsg(null);
    try {
      const merged = await saveHpcConfig(compositeId, values);
      setValues(_merge(merged));
      setDirty(false);
      setOkMsg('Saved');
    } catch (exc) {
      setError(String(exc));
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) {
    return <div style={{ padding: 20, color: '#666' }}>Loading HPC config…</div>;
  }

  return (
    <div style={{ padding: 20, fontFamily: 'system-ui', maxWidth: 720 }}>
      <h3 style={{ marginTop: 0 }}>HPC Run Configuration</h3>
      <p style={{ fontSize: 12, color: '#6b7280', marginTop: 0 }}>
        Saved to this composite's <code>hpc_run_config</code>. Used as pre-filled
        defaults by the <strong>Run</strong> tab when dispatching to{' '}
        <strong>{selected?.label ?? 'this backend'}</strong>.
      </p>
      {status && !status.ok && (
        <div style={{
          padding: '8px 12px', marginBottom: 12,
          background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 4,
          fontSize: 12, color: '#92400e',
        }}>
          <strong>Backend is not connected.</strong> You can still edit and save
          the config, but runs will fail until connectivity is restored.
          {status.missing_fields?.length ? (
            <div style={{ marginTop: 4 }}>
              Missing: <code>{status.missing_fields.join(', ')}</code>
            </div>
          ) : status.message ? (
            <div style={{ marginTop: 4 }}>{status.message}</div>
          ) : null}
        </div>
      )}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12,
      }}>
        <Field label="Backend">
          <select
            value={values.backend}
            onChange={(e) => update('backend', e.target.value)}
            style={_inputStyle}
          >
            <option value="v2ecoli">v2ecoli</option>
          </select>
        </Field>
        <NumField label="N Cells" min={1} max={128}
          value={values.n_cells} onChange={(n) => update('n_cells', n)} />
        <NumField label="Duration (min)" min={1} max={1440}
          value={values.duration_min} onChange={(n) => update('duration_min', n)} />
        <NumField label="Seed" min={0}
          value={values.seed} onChange={(n) => update('seed', n)} />
        <NumField label="CPUs" min={1} max={64}
          value={values.cpus} onChange={(n) => update('cpus', n)} />
        <NumField label="Memory (GB)" min={8} max={512}
          value={values.mem_gb} onChange={(n) => update('mem_gb', n)} />
        <NumField label="Time limit (min)" min={10} max={10080}
          value={values.time_limit_min} onChange={(n) => update('time_limit_min', n)} />
        <Field label="ParCa outdir">
          <input
            type="text"
            value={values.outdir}
            onChange={(e) => update('outdir', e.target.value)}
            style={_inputStyle}
          />
        </Field>
        <Field label="Colony cache-dir" full>
          <input
            type="text"
            value={values.cache_dir}
            onChange={(e) => update('cache_dir', e.target.value)}
            style={_inputStyle}
          />
        </Field>
      </div>
      <div style={{
        marginTop: 18, display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <button
          type="button"
          onClick={save}
          disabled={saving || !compositeId || !dirty}
          style={{
            padding: '6px 14px', fontSize: 13, fontWeight: 600,
            background: dirty ? '#2563eb' : '#9ca3af',
            color: '#fff', border: 0, borderRadius: 4,
            cursor: (saving || !dirty) ? 'default' : 'pointer',
          }}
        >
          {saving ? 'Saving…' : 'Save Config'}
        </button>
        {dirty && !saving && (
          <span style={{ fontSize: 12, color: '#b45309', fontWeight: 500 }}>
            ● Unsaved changes
          </span>
        )}
        {okMsg && !dirty && (
          <span style={{ fontSize: 12, color: '#065f46' }}>{okMsg}</span>
        )}
        {error && (
          <span style={{ fontSize: 12, color: '#b91c1c' }}>Error: {error}</span>
        )}
      </div>
    </div>
  );
}

// --- Small layout helpers (keep the form body declarative) ---------------

const _inputStyle: React.CSSProperties = {
  fontSize: 13, padding: '4px 8px',
  border: '1px solid #d1d5db', borderRadius: 4,
  width: '100%', boxSizing: 'border-box',
};

function Field({
  label, children, full,
}: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <label style={{
      display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12,
      color: '#374151', fontWeight: 500,
      gridColumn: full ? '1 / span 2' : undefined,
    }}>
      {label}
      {children}
    </label>
  );
}

function NumField({
  label, value, onChange, min, max,
}: { label: string; value: number; onChange: (n: number) => void; min?: number; max?: number }) {
  return (
    <Field label={label}>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          if (!Number.isNaN(n)) onChange(n);
        }}
        style={_inputStyle}
      />
    </Field>
  );
}
