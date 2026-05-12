// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Reset module cache between tests to get a fresh import (important for the
// postMessage spy tests which import after spying).
beforeEach(() => {
  vi.resetModules();
});

describe('postMessage protocol', () => {
  it('postReady fires the parent message', async () => {
    const spy = vi.spyOn(window.parent, 'postMessage');
    const { postReady } = await import('../api');
    postReady();
    expect(spy).toHaveBeenCalledWith({ type: 'explore:ready' }, '*');
    spy.mockRestore();
  });

  it('postInspect includes path, kind, details', async () => {
    const spy = vi.spyOn(window.parent, 'postMessage');
    const { postInspect } = await import('../api');
    postInspect({ path: ['a', 'b'], kind: 'store', details: { foo: 1 } });
    expect(spy).toHaveBeenCalledWith(
      { type: 'explore:inspect', path: ['a', 'b'], kind: 'store', details: { foo: 1 } },
      '*'
    );
    spy.mockRestore();
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
