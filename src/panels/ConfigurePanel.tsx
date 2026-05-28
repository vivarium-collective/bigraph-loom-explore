// src/panels/ConfigurePanel.tsx — Configure tab body.
//
// Dispatches on the currently-selected compute backend:
//   - kind === 'local' (or unknown): render the recipe-`parameters` form
//     (one input per declared parameter), so users can override defaults and
//     re-resolve the composite via /api/composite-resolve.
//   - kind === 'hpc': render <HpcConfigForm /> which round-trips through
//     /api/composite/<id>/hpc-config and saves the merged result back into
//     the composite doc.
//
// ConfigurePanel itself is a thin dispatcher with no hooks; the two
// backend-specific bodies own their own state. Keeping the dispatcher
// hook-free avoids Rules-of-Hooks violations when the user changes backend
// mid-session.
import { useEffect, useState } from 'react';
import type { ParameterDecl } from '../api';
import { parseListString, formatListString } from '../parsers';
import { useBackend } from '../BackendContext';
import { HpcConfigForm } from './HpcConfigForm';

export interface ConfigurePanelProps {
  compositeId: string | null;
  parameters: Record<string, ParameterDecl>;
  overrides: Record<string, unknown>;
  onApplied: (overrides: Record<string, unknown>, state: unknown) => void;
}

export function ConfigurePanel(props: ConfigurePanelProps) {
  const { selected } = useBackend();
  if (selected?.kind === 'hpc') {
    return <HpcConfigForm compositeId={props.compositeId} />;
  }
  return <LocalParametersForm {...props} />;
}

// --- Local backend: recipe `parameters` form (unchanged from pre-Phase-D) -

type FormValue = string | number | boolean;

function _initialValue(pdef: ParameterDecl, override: unknown): FormValue {
  const seed = override !== undefined ? override : pdef.default;
  if (pdef.type === 'list[string]') {
    return formatListString(Array.isArray(seed) ? (seed as string[]) : []);
  }
  if (pdef.type === 'bool') return Boolean(seed);
  if (pdef.type === 'int' || pdef.type === 'float') {
    return seed == null ? '' : String(seed);
  }
  return seed == null ? '' : String(seed);
}

function _castFormValue(pdef: ParameterDecl, raw: FormValue): unknown {
  if (pdef.type === 'list[string]') return parseListString(String(raw));
  if (pdef.type === 'bool') return Boolean(raw);
  if (pdef.type === 'int') {
    const n = parseInt(String(raw), 10);
    return Number.isNaN(n) ? null : n;
  }
  if (pdef.type === 'float') {
    const n = parseFloat(String(raw));
    return Number.isNaN(n) ? null : n;
  }
  return String(raw);
}

function LocalParametersForm({
  compositeId, parameters, overrides, onApplied,
}: ConfigurePanelProps) {
  const [values, setValues] = useState<Record<string, FormValue>>(() =>
    Object.fromEntries(
      Object.entries(parameters).map(([k, pdef]) => [k, _initialValue(pdef, overrides[k])])
    )
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setValues(Object.fromEntries(
      Object.entries(parameters).map(([k, pdef]) => [k, _initialValue(pdef, overrides[k])])
    ));
    setError(null);
  }, [parameters, overrides]);

  const paramKeys = Object.keys(parameters);
  if (paramKeys.length === 0) {
    return (
      <div style={{ padding: 20, color: '#666', fontFamily: 'system-ui' }}>
        This composite has no parameters to configure.
      </div>
    );
  }

  async function apply() {
    if (!compositeId) {
      setError('No composite id — cannot apply.');
      return;
    }
    const newOverrides: Record<string, unknown> = {};
    for (const [k, pdef] of Object.entries(parameters)) {
      newOverrides[k] = _castFormValue(pdef, values[k]);
    }
    setBusy(true);
    setError(null);
    try {
      const url = `/api/composite-resolve?id=${encodeURIComponent(compositeId)}`
        + `&overrides=${encodeURIComponent(JSON.stringify(newOverrides))}`;
      const r = await fetch(url);
      const body = await r.json();
      if (!r.ok || body.error) {
        throw new Error(body.error || `HTTP ${r.status}`);
      }
      onApplied(newOverrides, body.state);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: 20, fontFamily: 'system-ui', maxWidth: 720 }}>
      <div style={{ display: 'grid', gap: 18 }}>
        {paramKeys.map((k) => {
          const pdef = parameters[k];
          const id = `cfg-${k}`;
          const val = values[k];
          const onChange = (v: FormValue) => setValues((prev) => ({ ...prev, [k]: v }));
          return (
            <div key={k}>
              <label htmlFor={id} style={{ display: 'block', marginBottom: 4 }}>
                <code style={{ fontWeight: 600 }}>{k}</code>
                <span style={{ color: '#666', marginLeft: 8, fontSize: 12 }}>
                  ({pdef.type})
                </span>
              </label>
              {pdef.description && (
                <div style={{ color: '#666', fontSize: 12, marginBottom: 4 }}>
                  {pdef.description}
                </div>
              )}
              {pdef.type === 'list[string]' ? (
                <textarea
                  id={id}
                  rows={Math.max(3, String(val).split('\n').length + 1)}
                  value={String(val)}
                  onChange={(e) => onChange(e.target.value)}
                  style={{ width: '100%', fontFamily: 'monospace', fontSize: 13, padding: 6 }}
                  placeholder="one item per line"
                />
              ) : pdef.type === 'bool' ? (
                <select
                  id={id}
                  value={String(val)}
                  onChange={(e) => onChange(e.target.value === 'true')}
                  style={{ fontSize: 13, padding: '4px 8px' }}
                >
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              ) : (
                <input
                  id={id}
                  type={pdef.type === 'int' || pdef.type === 'float' ? 'number' : 'text'}
                  step={pdef.type === 'float' ? 'any' : pdef.type === 'int' ? '1' : undefined}
                  value={String(val)}
                  onChange={(e) => onChange(e.target.value)}
                  style={{ fontSize: 13, padding: '4px 8px', minWidth: 240 }}
                />
              )}
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          onClick={apply}
          disabled={busy || !compositeId}
          style={{
            padding: '6px 14px', fontSize: 13, fontWeight: 600,
            background: '#2563eb', color: '#fff', border: 0, borderRadius: 4,
            cursor: busy ? 'wait' : 'pointer',
          }}
        >
          {busy ? 'Applying…' : 'Apply'}
        </button>
        {error && (
          <span style={{ color: '#b91c1c', fontSize: 13 }}>Error: {error}</span>
        )}
      </div>
    </div>
  );
}
