import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

interface Props {
  onDecode: (text: string) => void;
  onError?: (err: string) => void;
  /** Disable the scanner while the caller processes a decode. */
  paused?: boolean;
}

export function CameraCard({ onDecode, onError, paused = false }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [status, setStatus] = useState<'idle' | 'starting' | 'running' | 'error'>('idle');
  const [errMsg, setErrMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      if (!containerRef.current) return;
      setStatus('starting');
      const id = `qr-${Math.random().toString(36).slice(2, 9)}`;
      containerRef.current.id = id;
      try {
        const scanner = new Html5Qrcode(id);
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: 'environment' },
          {
            fps: 10,
            qrbox: (w, h) => ({ width: Math.min(w, h) * 0.8, height: Math.min(w, h) * 0.8 }),
          },
          (decoded) => {
            if (cancelled || paused) return;
            onDecode(decoded);
          },
          // ignore per-frame decode failures
          () => {},
        );
        if (!cancelled) setStatus('running');
      } catch (err) {
        const msg = (err as Error).message || 'Camera failed to start';
        setErrMsg(msg);
        setStatus('error');
        onError?.(msg);
      }
    }

    start();

    return () => {
      cancelled = true;
      const scanner = scannerRef.current;
      if (scanner) {
        scanner.stop().catch(() => {}).finally(() => scanner.clear());
      }
      scannerRef.current = null;
    };
  }, [onDecode, onError, paused]);

  return (
    <div
      className="card card-flush"
      style={{ aspectRatio: '1 / 1', overflow: 'hidden', position: 'relative' }}
    >
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {status !== 'running' && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.04)',
            color: 'var(--text-secondary)',
            fontSize: '0.9rem',
          }}
        >
          {status === 'starting' && 'Starting camera…'}
          {status === 'error' && (errMsg || 'Camera unavailable')}
          {status === 'idle' && 'Camera idle'}
        </div>
      )}
    </div>
  );
}
