import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AddStaffWizard } from './AddStaffWizard';

// Hoisted mock state — vi.mock factories run before imports, so we use
// vi.hoisted to share a controllable mock between the factory and the tests.
const mocks = vi.hoisted(() => {
  return {
    mintMock: vi.fn(),
    state: { invite: null as null | { invite_token: string; qr_payload: string; pending_expires_at: number }, status: 'idle' as string },
  };
});

vi.mock('../hooks/useInvite', () => ({
  useInvite: () => ({
    state: mocks.state,
    mint: mocks.mintMock,
  }),
}));

describe('AddStaffWizard', () => {
  beforeEach(() => {
    mocks.mintMock.mockReset();
    mocks.state = { invite: null, status: 'idle' };
  });

  it('renders role + expiry pickers and a Generate button', () => {
    render(<AddStaffWizard onClose={() => {}} />);
    expect(screen.getByLabelText(/role/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/expires/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /generate/i })).toBeInTheDocument();
  });

  it('calls mint with selected role on Generate click', async () => {
    render(<AddStaffWizard onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /generate/i }));
    await waitFor(() =>
      expect(mocks.mintMock).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'gate_steward' }),
      ),
    );
  });
});
