// Compute-backend selection state, shared across tab bodies.
//
// Holds the list of registered backends, the user's current selection, and a
// per-backend connectivity-status cache. Tab bodies read the selection from
// here (via `useBackend()`) to render backend-specific UI.
//
// The provider fetches `/api/compute-backends` on mount and probes the
// selected backend's status on selection-change + on explicit `refreshStatus`
// calls (e.g. from the "Test connection" button).
import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
} from 'react';
import type { ReactNode } from 'react';
import {
  fetchBackendStatus, fetchComputeBackends,
  type BackendStatus, type ComputeBackend,
} from './api';

export interface BackendContextValue {
  backends: ComputeBackend[];
  selectedId: string | null;
  selected: ComputeBackend | null;
  /** Per-backend status. `undefined` = never probed; `null` = probe in flight. */
  statusById: Record<string, BackendStatus | null | undefined>;
  /** Whether the initial list-fetch is still in flight. */
  loading: boolean;
  /** Error from the initial list-fetch (the per-backend probe errors live in `statusById[id].message`). */
  loadError: string | null;
  setSelectedId(id: string | null): void;
  /** Re-probe one backend; updates `statusById[id]`. */
  refreshStatus(id: string): Promise<void>;
}

const _defaultValue: BackendContextValue = {
  backends: [],
  selectedId: null,
  selected: null,
  statusById: {},
  loading: true,
  loadError: null,
  setSelectedId: () => {},
  refreshStatus: async () => {},
};

const BackendContext = createContext<BackendContextValue>(_defaultValue);

const LS_KEY = 'loom-explore.selected-backend';

export function BackendProvider({ children }: { children: ReactNode }) {
  const [backends, setBackends] = useState<ComputeBackend[]>([]);
  const [selectedId, _setSelectedId] = useState<string | null>(() => {
    try { return localStorage.getItem(LS_KEY); } catch { return null; }
  });
  const [statusById, setStatusById] = useState<BackendContextValue['statusById']>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const setSelectedId = useCallback((id: string | null) => {
    _setSelectedId(id);
    try {
      if (id) localStorage.setItem(LS_KEY, id);
      else localStorage.removeItem(LS_KEY);
    } catch { /* localStorage may be unavailable */ }
  }, []);

  const refreshStatus = useCallback(async (id: string) => {
    setStatusById((s) => ({ ...s, [id]: null }));
    try {
      const st = await fetchBackendStatus(id);
      setStatusById((s) => ({ ...s, [id]: st }));
    } catch (exc) {
      setStatusById((s) => ({ ...s, [id]: { ok: false, kind: 'unknown', message: String(exc) } }));
    }
  }, []);

  // Initial list fetch. Default selection: persisted choice if it's still in
  // the list, otherwise the first backend.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    fetchComputeBackends()
      .then((list) => {
        if (cancelled) return;
        setBackends(list);
        _setSelectedId((current) => {
          if (current && list.some((b) => b.id === current)) return current;
          const fallback = list[0]?.id ?? null;
          if (fallback) {
            try { localStorage.setItem(LS_KEY, fallback); } catch { /* ignore */ }
          }
          return fallback;
        });
      })
      .catch((exc) => {
        if (cancelled) return;
        setLoadError(String(exc));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  // Auto-probe whenever selection changes (and we haven't probed it yet).
  useEffect(() => {
    if (!selectedId) return;
    if (statusById[selectedId] !== undefined) return;
    refreshStatus(selectedId);
  }, [selectedId, statusById, refreshStatus]);

  const selected = useMemo(
    () => backends.find((b) => b.id === selectedId) ?? null,
    [backends, selectedId],
  );

  const value: BackendContextValue = {
    backends, selectedId, selected, statusById, loading, loadError,
    setSelectedId, refreshStatus,
  };
  return <BackendContext.Provider value={value}>{children}</BackendContext.Provider>;
}

export function useBackend(): BackendContextValue {
  return useContext(BackendContext);
}
