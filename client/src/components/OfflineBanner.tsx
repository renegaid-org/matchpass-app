interface Props {
  online: boolean;
  queueSize: number;
  flushing: boolean;
  onRetry: () => void;
}

export function OfflineBanner({ online, queueSize, flushing, onRetry }: Props) {
  if (online && queueSize === 0 && !flushing) return null;

  const label = !online
    ? `Offline${queueSize > 0 ? ` · ${queueSize} queued` : ''}`
    : flushing
      ? 'Syncing queued events…'
      : `${queueSize} queued event${queueSize === 1 ? '' : 's'} — tap to retry`;

  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        background: online ? 'var(--warning)' : 'var(--danger)',
        color: 'white',
        fontSize: '0.8rem',
        textAlign: 'center',
        padding: '6px 12px',
        zIndex: 100,
        cursor: queueSize > 0 && online && !flushing ? 'pointer' : 'default',
      }}
      onClick={() => {
        if (queueSize > 0 && online && !flushing) onRetry();
      }}
    >
      {label}
    </div>
  );
}
