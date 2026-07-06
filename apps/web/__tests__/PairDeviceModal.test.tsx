import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSyncStore } from '@ledger/stores';
import PairDeviceModal from '../src/components/PairDeviceModal.js';

jest.mock('qrcode', () => ({
  __esModule: true,
  toDataURL: jest.fn().mockResolvedValue('data:image/png;base64,FAKE'),
}));

const PAYLOAD = 'ledger-sync://pair?v=1&host=192.168.1.20&port=45680&device=abc&secret=xyz';

function primeStore(overrides: Record<string, unknown> = {}) {
  useSyncStore.setState({
    pairing: {
      mode: null,
      payload: null,
      expiresAt: null,
      status: 'idle',
      error: null,
    },
    startPairingHost: jest.fn().mockResolvedValue({ success: true }),
    cancelPairing: jest.fn(),
    completePairingJoin: jest.fn().mockResolvedValue({ success: true }),
    ...overrides,
  } as never);
}

describe('PairDeviceModal — host mode', () => {
  it('requests an offer on mount and renders QR + copyable payload + countdown', async () => {
    const startPairingHost = jest.fn().mockResolvedValue({ success: true });
    primeStore({
      startPairingHost,
      pairing: {
        mode: 'host',
        payload: PAYLOAD,
        expiresAt: Date.now() + 90_000,
        status: 'waiting',
        error: null,
      },
    });
    render(<PairDeviceModal mode="host" canScan={false} onClose={() => {}} />);

    expect(startPairingHost).toHaveBeenCalled();
    expect(screen.getByDisplayValue(PAYLOAD)).toBeInTheDocument();
    expect(screen.getByText(/expires in/)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByAltText('Pairing QR code')).toHaveAttribute(
        'src',
        'data:image/png;base64,FAKE',
      );
    });
  });

  it('offers regeneration once the code expired', () => {
    primeStore({
      pairing: {
        mode: 'host',
        payload: PAYLOAD,
        expiresAt: Date.now() - 1000,
        status: 'waiting',
        error: null,
      },
    });
    render(<PairDeviceModal mode="host" canScan={false} onClose={() => {}} />);
    expect(screen.getByText('Code expired')).toBeInTheDocument();
    expect(screen.getByText('Generate a new code')).toBeInTheDocument();
  });

  it('cancels the offer on unmount', () => {
    const cancelPairing = jest.fn();
    primeStore({ cancelPairing });
    const { unmount } = render(<PairDeviceModal mode="host" canScan={false} onClose={() => {}} />);
    unmount();
    expect(cancelPairing).toHaveBeenCalled();
  });
});

describe('PairDeviceModal — join mode', () => {
  it('hides the scan button when scanning is unavailable', () => {
    primeStore();
    render(<PairDeviceModal mode="join" canScan={false} onClose={() => {}} />);
    expect(screen.queryByText('Scan QR code')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('ledger-sync://pair?...')).toBeInTheDocument();
  });

  it('shows the scan button when scanning is available', () => {
    primeStore();
    render(<PairDeviceModal mode="join" canScan={true} onClose={() => {}} />);
    expect(screen.getByText('Scan QR code')).toBeInTheDocument();
  });

  it('submits a pasted code', async () => {
    const user = userEvent.setup();
    const completePairingJoin = jest.fn().mockResolvedValue({ success: true });
    primeStore({ completePairingJoin });
    render(<PairDeviceModal mode="join" canScan={false} onClose={() => {}} />);

    const pairButton = screen.getByRole('button', { name: 'Pair' });
    expect(pairButton).toBeDisabled();
    await user.type(screen.getByPlaceholderText('ledger-sync://pair?...'), PAYLOAD);
    expect(pairButton).toBeEnabled();
    await user.click(pairButton);
    expect(completePairingJoin).toHaveBeenCalledWith(PAYLOAD);
  });

  it('renders pairing errors', () => {
    primeStore({
      pairing: {
        mode: 'join',
        payload: null,
        expiresAt: null,
        status: 'error',
        error: 'Pairing code expired — ask the host device to show a new one.',
      },
    });
    render(<PairDeviceModal mode="join" canScan={false} onClose={() => {}} />);
    expect(screen.getByText(/Pairing code expired/)).toBeInTheDocument();
  });

  it('auto-closes after success', async () => {
    jest.useFakeTimers();
    try {
      const onClose = jest.fn();
      primeStore({
        pairing: { mode: 'join', payload: null, expiresAt: null, status: 'success', error: null },
      });
      render(<PairDeviceModal mode="join" canScan={false} onClose={onClose} />);
      expect(screen.getByText('Device paired ✓')).toBeInTheDocument();
      jest.advanceTimersByTime(1500);
      expect(onClose).toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});
