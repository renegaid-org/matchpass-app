import { describe, it, expect, vi, beforeEach } from 'vitest';
import { _resetInviteSubscriptionForTest, refreshInviteSubscription } from '../server/relay.js';

describe('refreshInviteSubscription', () => {
  beforeEach(() => _resetInviteSubscriptionForTest());

  it('issues no REQ when no active session pubkeys', () => {
    const mockRelay = { subscribe: vi.fn() };
    refreshInviteSubscription(mockRelay, []);
    expect(mockRelay.subscribe).not.toHaveBeenCalled();
  });

  it('issues a single REQ with #p filter for active session pubkeys', () => {
    const mockRelay = { subscribe: vi.fn(() => ({ close: vi.fn() })) };
    refreshInviteSubscription(mockRelay, ['aa'.repeat(32), 'bb'.repeat(32)]);
    expect(mockRelay.subscribe).toHaveBeenCalledOnce();
    const [filters] = mockRelay.subscribe.mock.calls[0];
    expect(filters).toEqual([{ kinds: [1059], '#p': ['aa'.repeat(32), 'bb'.repeat(32)] }]);
  });

  it('closes the prior subscription when refreshed', () => {
    const close1 = vi.fn();
    const close2 = vi.fn();
    const mockRelay = {
      subscribe: vi.fn()
        .mockReturnValueOnce({ close: close1 })
        .mockReturnValueOnce({ close: close2 }),
    };
    refreshInviteSubscription(mockRelay, ['aa'.repeat(32)]);
    refreshInviteSubscription(mockRelay, ['aa'.repeat(32), 'bb'.repeat(32)]);
    expect(close1).toHaveBeenCalled();
  });
});
