import type { ReactNode } from 'react';
import { Z } from '../lib/z-index';

interface Props {
  title?: string;
  showBack?: boolean;
  onBack?: () => void;
  onSettingsOpen?: () => void;
  /** Role badge displayed in the header (e.g. "Gate Steward"). */
  roleBadge?: string;
  /** Banner colour when set — useful for officer / admin modes. */
  accent?: 'default' | 'officer' | 'admin' | 'warning';
  children: ReactNode;
}

const accentColors: Record<NonNullable<Props['accent']>, { border: string; bg: string }> = {
  default: { border: 'var(--border)', bg: 'var(--bg-card)' },
  officer: { border: 'var(--accent)', bg: 'var(--accent-light)' },
  admin: { border: 'var(--warning)', bg: 'var(--warning-light)' },
  warning: { border: 'var(--danger)', bg: 'var(--danger-light)' },
};

export function Layout({
  title,
  showBack,
  onBack,
  onSettingsOpen,
  roleBadge,
  accent = 'default',
  children,
}: Props) {
  const colors = accentColors[accent];
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          borderBottom: `1px solid ${colors.border}`,
          background: accent === 'default' ? 'var(--bg-card)' : colors.bg,
          position: 'sticky',
          top: 0,
          zIndex: Z.header,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {showBack && (
            <button
              onClick={onBack}
              aria-label="Go back"
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--accent)',
                fontSize: '1rem',
                cursor: 'pointer',
                padding: '4px 8px',
              }}
            >
              &larr;
            </button>
          )}
          <h2 style={{ margin: 0 }}>{title || 'MatchPass'}</h2>
          {roleBadge && (
            <span
              className="badge"
              style={{
                background: 'var(--bg-secondary)',
                color: 'var(--text-secondary)',
                marginLeft: 8,
                fontSize: '0.7rem',
              }}
            >
              {roleBadge}
            </span>
          )}
        </div>
        {onSettingsOpen && !showBack && (
          <button
            onClick={onSettingsOpen}
            aria-label="Settings"
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-secondary)',
              fontSize: '1.25rem',
              cursor: 'pointer',
              padding: '4px 8px',
            }}
          >
            &#9881;
          </button>
        )}
      </header>
      <main className="page" style={{ flex: 1 }}>
        {children}
      </main>
    </div>
  );
}
