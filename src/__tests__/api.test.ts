// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Reset module cache between tests to get a fresh import (important for the
// postMessage spy tests which import after spying).
beforeEach(() => {
  vi.resetModules();
});

describe('postMessage protocol', () => {
  // The api helpers post to window.opener (popup mode) or window.parent (iframe
  // mode). In jsdom both default to `window` itself, which the helper treats as
  // "no embedding target" and silently no-ops. Install a mock opener so the
  // spy captures the call.
  const mockOpener = { postMessage: vi.fn() };

  beforeEach(() => {
    mockOpener.postMessage.mockReset();
    Object.defineProperty(window, 'opener', {
      value: mockOpener,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'opener', {
      value: null,
      configurable: true,
      writable: true,
    });
  });

  it('postReady fires the embedding-target message', async () => {
    const { postReady } = await import('../api');
    postReady();
    expect(mockOpener.postMessage).toHaveBeenCalledWith({ type: 'explore:ready' }, '*');
  });

  it('postInspect includes path, kind, details', async () => {
    const { postInspect } = await import('../api');
    postInspect({ path: ['a', 'b'], kind: 'store', details: { foo: 1 } });
    expect(mockOpener.postMessage).toHaveBeenCalledWith(
      { type: 'explore:inspect', path: ['a', 'b'], kind: 'store', details: { foo: 1 } },
      '*'
    );
  });

  it('postReady is a no-op when there is no embedding target', async () => {
    Object.defineProperty(window, 'opener', { value: null, configurable: true, writable: true });
    const { postReady } = await import('../api');
    expect(() => postReady()).not.toThrow();
    expect(mockOpener.postMessage).not.toHaveBeenCalled();
  });

  it('onCompositeLoad invokes handler for matching messages', async () => {
    const { onCompositeLoad } = await import('../api');
    const handler = vi.fn();
    const off = onCompositeLoad(handler);
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'composite:load', state: { foo: 1 } },
    }));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].state).toEqual({ foo: 1 });
    off();
  });

  it('onCompositeLoad ignores non-matching messages', async () => {
    const { onCompositeLoad } = await import('../api');
    const handler = vi.fn();
    const off = onCompositeLoad(handler);
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'something-else' } }));
    expect(handler).not.toHaveBeenCalled();
    off();
  });
});
