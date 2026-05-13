// src/api.ts — postMessage protocol with the embedding dashboard.

export type CompositeLoadMsg = {
  type: 'composite:load';
  state: any;
  metadata?: { name?: string; context?: string; id?: string };
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
