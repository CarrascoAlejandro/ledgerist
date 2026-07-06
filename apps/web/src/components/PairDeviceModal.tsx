import { useEffect, useState } from 'react';
import { useSyncStore } from '@ledger/stores';

interface Props {
  mode: 'host' | 'join';
  canScan: boolean;
  onClose: () => void;
}

function formatCountdown(expiresAt: number | null, now: number): string {
  if (!expiresAt) return '';
  const remaining = Math.max(0, Math.floor((expiresAt - now) / 1000));
  const m = Math.floor(remaining / 60);
  const s = remaining % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function PairDeviceModal({ mode, canScan, onClose }: Props) {
  const { pairing, startPairingHost, cancelPairing, completePairingJoin } = useSyncStore();
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [pasted, setPasted] = useState('');
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (mode === 'host') {
      void startPairingHost();
    }
    return () => {
      cancelPairing();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (pairing.payload) {
      void import('qrcode').then(async (QRCode) => {
        const url = await QRCode.toDataURL(pairing.payload!, { width: 256, margin: 1 });
        if (!cancelled) setQrDataUrl(url);
      });
    } else {
      setQrDataUrl(null);
    }
    return () => {
      cancelled = true;
    };
  }, [pairing.payload]);

  useEffect(() => {
    if (pairing.status === 'success') {
      const timer = setTimeout(onClose, 1200);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [pairing.status, onClose]);

  async function handleCopy() {
    if (pairing.payload) {
      await navigator.clipboard.writeText(pairing.payload);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  async function handleScan() {
    const { CapacitorBarcodeScanner, CapacitorBarcodeScannerTypeHint } = await import(
      '@capacitor/barcode-scanner'
    );
    const result = await CapacitorBarcodeScanner.scanBarcode({
      hint: CapacitorBarcodeScannerTypeHint.QR_CODE,
    });
    if (result.ScanResult) {
      await completePairingJoin(result.ScanResult);
    }
  }

  const expired = pairing.expiresAt !== null && now > pairing.expiresAt;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="mx-4 w-full max-w-sm rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800">
        <h2 className="mb-4 text-base font-semibold text-gray-900 dark:text-gray-100">
          {mode === 'host' ? 'Pair a new device' : 'Join a device'}
        </h2>

        {pairing.status === 'success' && (
          <p className="mb-4 rounded-md bg-green-50 p-3 text-sm text-green-700 dark:bg-green-900/30 dark:text-green-300">
            Device paired ✓
          </p>
        )}
        {pairing.error && (
          <p className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
            {pairing.error}
          </p>
        )}

        {mode === 'host' && pairing.payload && (
          <div className="flex flex-col items-center gap-3">
            {qrDataUrl && (
              <img src={qrDataUrl} alt="Pairing QR code" className="h-64 w-64 rounded bg-white p-2" />
            )}
            {expired ? (
              <div className="flex flex-col items-center gap-2">
                <p className="text-sm text-red-600 dark:text-red-400">Code expired</p>
                <button
                  onClick={() => void startPairingHost()}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  Generate a new code
                </button>
              </div>
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Scan from the other device — expires in {formatCountdown(pairing.expiresAt, now)}
              </p>
            )}
            <div className="w-full">
              <p className="mb-1 text-xs text-gray-500 dark:text-gray-400">
                Or copy the code manually:
              </p>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={pairing.payload}
                  className="w-full truncate rounded-md border border-gray-300 bg-gray-50 px-2 py-1 text-xs text-gray-600 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300"
                />
                <button
                  onClick={() => void handleCopy()}
                  className="shrink-0 rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                >
                  {copied ? 'Copied ✓' : 'Copy'}
                </button>
              </div>
            </div>
          </div>
        )}

        {mode === 'join' && (
          <div className="flex flex-col gap-3">
            {canScan && (
              <button
                onClick={() => void handleScan()}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Scan QR code
              </button>
            )}
            <div>
              <p className="mb-1 text-xs text-gray-500 dark:text-gray-400">
                {canScan ? 'Or paste the pairing code:' : 'Paste the pairing code from the host device:'}
              </p>
              <textarea
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                rows={3}
                placeholder="ledger-sync://pair?..."
                className="w-full rounded-md border border-gray-300 bg-gray-50 px-2 py-1 text-xs text-gray-700 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
              />
            </div>
            <button
              onClick={() => void completePairingJoin(pasted)}
              disabled={!pasted.trim() || pairing.status === 'waiting'}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {pairing.status === 'waiting' ? 'Pairing…' : 'Pair'}
            </button>
          </div>
        )}

        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
