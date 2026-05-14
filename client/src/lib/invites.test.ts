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
  it('opens EventSource and dispatches events', () => {
    const events: unknown[] = [];
    const onEvent = (e: unknown) => events.push(e);
    const mockEs: { onmessage: ((e: MessageEvent) => void) | null; close: () => void } = {
      onmessage: null,
      close: vi.fn(),
    };
    // vi.fn(() => obj) isn't usable as a constructor — use a factory function
    // returning mockEs so `new EventSource(...)` resolves to it.
    global.EventSource = function () { return mockEs; } as unknown as typeof EventSource;

    const close = subscribeToInvite('TOK', onEvent);
    mockEs.onmessage?.({
      data: JSON.stringify({ type: 'accepted', persona_pubkey: 'cc' }),
    } as MessageEvent);
    expect(events).toEqual([{ type: 'accepted', persona_pubkey: 'cc' }]);

    close();
    expect(mockEs.close).toHaveBeenCalled();
  });
});
