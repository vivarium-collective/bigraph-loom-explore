// src/api.ts — postMessage protocol with the embedding dashboard.

export type CompositeLoadMsg = {
  type: 'composite:load';
  state: any;
  metadata?: { name?: string; context?: string };
};

export type ExploreReadyMsg = { type: 'explore:ready' };

export type ExploreInspectMsg = {
  type: 'explore:inspect';
  path: string[];
  kind: 'store' | 'process';
  details: Record<string, unknown>;
};

export function postReady() {
  window.parent.postMessage({ type: 'explore:ready' } as ExploreReadyMsg, '*');
}

export function postInspect(payload: Omit<ExploreInspectMsg, 'type'>) {
  window.parent.postMessage({ type: 'explore:inspect', ...payload }, '*');
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
