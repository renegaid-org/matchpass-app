import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PendingAcceptancesPanel } from './PendingAcceptancesPanel';
import type { Nip98Signer } from '../lib/nip98';
import type { AcceptedInvite } from '../hooks/useInvite';

// Shared mock state for the hooks — see AddStaffWizard.test.tsx for the same
// vi.hoisted pattern.
const mocks = vi.hoisted(() => ({
  pending: [] as AcceptedInvite[],
  publishWithAddedEntries: vi.fn(),
}));

vi.mock('../hooks/useInvite', async () => {
  const actual = await vi.importActual<typeof import('../hooks/useInvite')>(
    '../hooks/useInvite',
  );
  return {
    ...actual,
    usePendingAcceptances: () => mocks.pending,
  };
});

vi.mock('../hooks/useRoster', () => ({
  useRoster: () => ({
    publishWithAddedEntries: mocks.publishWithAddedEntries,
    staff: [],
    loading: false,
    error: null,
    publish: vi.fn(),
    refresh: vi.fn(),
    clubPubkey: null,
    rosterEvent: null,
  }),
}));

const stubSigner: Nip98Signer = {
  signEvent: async () => ({
    id: 'x', pubkey: 'y', kind: 27235, created_at: 0, tags: [], content: '', sig: 'z',
  }),
};

describe('PendingAcceptancesPanel', () => {
  beforeEach(() => {
    mocks.pending = [];
    mocks.publishWithAddedEntries.mockReset();
    mocks.publishWithAddedEntries.mockResolvedValue({ ok: true });
  });

  it('renders nothing when the accepted-invite queue is empty', () => {
    const { container } = render(<PendingAcceptancesPanel signer={stubSigner} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders one row per accepted invite and calls publishWithAddedEntries on Sign roster', async () => {
    mocks.pending = [
      {
        token_hash: 'h1',
        club_pubkey: 'aa'.repeat(32),
        role: 'gate_steward',
        display_name: 'Marcus',
        persona_pubkey: 'cc'.repeat(32),
        accepted_at: 1747200000,
        staff_expires_at: 1747300000,
        status: 'accepted',
      },
    ];
    render(<PendingAcceptancesPanel signer={stubSigner} />);
    expect(screen.getByText('Marcus')).toBeInTheDocument();
    expect(screen.getByText(/gate steward/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /sign roster/i }));
    await waitFor(() =>
      expect(mocks.publishWithAddedEntries).toHaveBeenCalledWith([
        expect.objectContaining({
          pubkey: 'cc'.repeat(32),
          role: 'gate_steward',
          displayName: 'Marcus',
          expiresAt: 1747300000,
        }),
      ]),
    );
  });
});
