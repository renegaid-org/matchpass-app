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

  // Stabilise fast-changing props so the scanner-start effect does not
  // re-run when the parent re-renders with a new closure. Without this,
  // flipping `paused` restarts the scanner and opens a race where the
  // prior scanner's stop() is still in-flight when the next start() runs
  // — the camera LED stays on, onDecode may fire for a paused scanner,
  // and the component accumulates orphan media tracks.
  const onDecodeRef = useRef(onDecode);
  const onErrorRef = useRef(onError);
  const pausedRef = useRef(paused);
  useEffect(() => { onDecodeRef.current = onDecode; }, [onDecode]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

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
            // Read pause state via ref at decode-time, not via stale closure.
            if (cancelled || pausedRef.current) return;
            onDecodeRef.current(decoded);
          },
          // ignore per-frame decode failures
          () => {},
        );
        if (!cancelled) setStatus('running');
      } catch (err) {
        const msg = (err as Error).message || 'Camera failed to start';
        setErrMsg(msg);
        setStatus('error');
        onErrorRef.current?.(msg);
      }
    }

    // Stop scanning when the tab is hidden so the camera LED turns off and
    // the hardware is released for other apps. Restart on re-show.
    let hiddenDuringThisRun = false;
    const onVisibility = () => {
      const scanner = scannerRef.current;
      if (document.hidden && scanner && status !== 'idle') {
        hiddenDuringThisRun = true;
        scanner.stop().catch(() => {}).finally(() => { scanner.clear(); });
        scannerRef.current = null;
        setStatus('idle');
      } else if (!document.hidden && hiddenDuringThisRun) {
        hiddenDuringThisRun = false;
        start();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    start();

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      const scanner = scannerRef.current;
      if (scanner) {
        scanner.stop().catch(() => {}).finally(() => scanner.clear());
      }
      scannerRef.current = null;
    };
    // Intentionally empty dep array — camera lifecycle is owned by this
    // mount; prop changes are plumbed through refs above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
