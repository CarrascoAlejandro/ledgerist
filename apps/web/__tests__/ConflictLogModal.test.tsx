import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConflictLogModal from '../src/components/ConflictLogModal.js';
import type { SyncConflict } from '@ledger/sync';

function makeConflict(overrides: Partial<SyncConflict> = {}): SyncConflict {
  return {
    conflict_id: 'c-1',
    kind: 'lww',
    table_name: 'entries',
    row_id: 'e-1',
    peer_device_id: 'peer-1',
    winner: 'remote',
    loser_snapshot: JSON.stringify({ detail: 'lost edit', amount: 12 }),
    resolved_at: '2026-07-06 12:00:00',
    seen: 0,
    ...overrides,
  };
}

describe('ConflictLogModal', () => {
  it('shows an empty state', () => {
    render(<ConflictLogModal conflicts={[]} onClose={() => {}} />);
    expect(screen.getByText('No conflicts recorded.')).toBeInTheDocument();
  });

  it('renders kind badges and winner descriptions', () => {
    render(
      <ConflictLogModal
        conflicts={[
          makeConflict(),
          makeConflict({
            conflict_id: 'c-2',
            kind: 'unique_name',
            table_name: 'books',
            winner: 'local',
            loser_snapshot: JSON.stringify({ name: 'Trips' }),
          }),
        ]}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText('Concurrent edit')).toBeInTheDocument();
    expect(screen.getByText('Book name collision')).toBeInTheDocument();
    expect(screen.getByText(/the newer remote version won/)).toBeInTheDocument();
    expect(screen.getByText(/this device.s version won/)).toBeInTheDocument();
  });

  it('expands the loser snapshot on demand', async () => {
    const user = userEvent.setup();
    render(<ConflictLogModal conflicts={[makeConflict()]} onClose={() => {}} />);
    expect(screen.queryByText(/"amount": 12/)).not.toBeInTheDocument();
    await user.click(screen.getByText('Show overwritten data'));
    expect(screen.getByText(/"amount": 12/)).toBeInTheDocument();
    await user.click(screen.getByText('Hide overwritten data'));
    expect(screen.queryByText(/"amount": 12/)).not.toBeInTheDocument();
  });

  it('fires onClose', async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();
    render(<ConflictLogModal conflicts={[]} onClose={onClose} />);
    await user.click(screen.getByText('Done'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
