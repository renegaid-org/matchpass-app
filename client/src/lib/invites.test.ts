import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createInvite, subscribeToInvite } from './invites';

describe('createInvite', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('POSTs to /api/gate/invites and returns parsed response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        invite_token: 'TOK',
        qr_payload: 'https://mysignet.app/...',
        pending_expires_at: 1747200000,
      }),
    } as Response);

    const result = await createInvite({
      role: 'gate_steward',
      displayName: 'Marcus',
      bearer: 'nip98-token',
    });
    expect(result.invite_token).toBe('TOK');
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/gate/invites',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Nostr nip98-token' }),
      }),
    );
  });

  it('throws on non-OK response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: 'forbidden' }),
    } as Response);
    await expect(createInvite({ role: 'gate_steward', bearer: 'x' })).rejects.toThrow(/forbidden/);
  });
});

describe('subscribeToInvite', () => {
  it('opens EventSource and dispatches named "invite" events', () => {
    const events: unknown[] = [];
    const onEvent = (e: unknown) => events.push(e);
    // The server emits `event: invite\ndata: …\n\n` SSE frames. The spec
    // routes those to addEventListener('invite', …), NOT to onmessage. The
    // mock has to mirror that contract or the test would mask the bug.
    const handlers = new Map<string, (e: MessageEvent) => void>();
    const mockEs = {
      addEventListener: (name: string, handler: (e: MessageEvent) => void) => {
        handlers.set(name, handler);
      },
      onerror: null as null | (() => void),
      readyState: 1,
      close: vi.fn(),
    };
    // vi.fn(() => obj) isn't usable as a constructor — use a factory function
    // returning mockEs so `new EventSource(...)` resolves to it.
    global.EventSource = function () { return mockEs; } as unknown as typeof EventSource;

    const close = subscribeToInvite('TOK', onEvent);
    const inviteHandler = handlers.get('invite');
    expect(inviteHandler).toBeDefined();
    inviteHandler?.({
      data: JSON.stringify({ type: 'accepted', persona_pubkey: 'cc' }),
    } as MessageEvent);
    expect(events).toEqual([{ type: 'accepted', persona_pubkey: 'cc' }]);

    close();
    expect(mockEs.close).toHaveBeenCalled();
  });

  it('invokes onError when EventSource enters CLOSED state', () => {
    const errors: Array<{ readyState: number }> = [];
    const onEvent = vi.fn();
    const onError = (err: { readyState: number }) => errors.push(err);
    const handlers = new Map<string, (e: MessageEvent) => void>();
    const mockEs = {
      addEventListener: (name: string, handler: (e: MessageEvent) => void) => {
        handlers.set(name, handler);
      },
      onerror: null as null | (() => void),
      readyState: 2,  // EventSource.CLOSED — browser gave up reconnecting
      close: vi.fn(),
    };
    global.EventSource = function () { return mockEs; } as unknown as typeof EventSource;
    // console.warn is emitted on every error — silence it for the test.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const close = subscribeToInvite('TOK', onEvent, onError);
    expect(mockEs.onerror).toBeTypeOf('function');
    mockEs.onerror!();
    expect(errors).toEqual([{ readyState: 2 }]);
    expect(warnSpy).toHaveBeenCalledOnce();

    close();
    warnSpy.mockRestore();
  });

  it('does not throw if onError is omitted', () => {
    const mockEs = {
      addEventListener: () => {},
      onerror: null as null | (() => void),
      readyState: 0,  // CONNECTING — auto-recovering
      close: vi.fn(),
    };
    global.EventSource = function () { return mockEs; } as unknown as typeof EventSource;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const close = subscribeToInvite('TOK', vi.fn());  // no onError
    expect(() => mockEs.onerror!()).not.toThrow();

    close();
    warnSpy.mockRestore();
  });
});
