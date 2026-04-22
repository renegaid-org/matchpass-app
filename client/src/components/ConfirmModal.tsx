/**
 * In-app modal replacing native `confirm()` / `prompt()` / `alert()` for any
 * action that writes to the chain or destroys local data.
 *
 * Why a custom modal — the 2026-04-20 security audit flagged that
 * installed-PWA contexts on iOS can silently suppress the native dialogs,
 * which is dangerous when the "Cancel" path is silently taken for
 * destructive actions like issuing bans. This component is always-rendered
 * in React-land and does not go through window.confirm.
 *
 * Usage:
 *
 *   const confirm = useConfirm();
 *   const { confirmed, input } = await confirm({
 *     title: 'Issue ban?',
 *     message: 'This publishes to the chain.',
 *     variant: 'danger',
 *     requireType: 'BAN',
 *   });
 */
import {
  createContext, useContext, useState, useCallback, useRef, useEffect,
  type ReactNode,
} from 'react';

export interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  detail?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'danger' | 'warning';
  /** If set, the confirm button stays disabled until the user types exactly this string. */
  requireType?: string;
  /** If set, the modal shows a text input and returns its value in `input`. */
  input?: {
    placeholder?: string;
    initialValue?: string;
    maxLength?: number;
    required?: boolean;
  };
  /** If set, no Cancel button — only a single acknowledgement button. */
  ack?: boolean;
}

export interface ConfirmResult {
  confirmed: boolean;
  input?: string;
}

type Resolver = (r: ConfirmResult) => void;

interface PendingState extends ConfirmOptions {
  resolve: Resolver;
}

const ConfirmContext = createContext<(opts: ConfirmOptions) => Promise<ConfirmResult>>(
  () => Promise.reject(new Error('ConfirmProvider missing from tree')),
);

export function useConfirm() {
  return useContext(ConfirmContext);
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingState | null>(null);
  const [typed, setTyped] = useState('');
  const [inputValue, setInputValue] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);

  const confirm = useCallback((opts: ConfirmOptions) => {
    setTyped('');
    setInputValue(opts.input?.initialValue ?? '');
    return new Promise<ConfirmResult>((resolve) => {
      setPending({ ...opts, resolve });
    });
  }, []);

  const close = useCallback((result: ConfirmResult) => {
    if (!pending) return;
    pending.resolve(result);
    setPending(null);
  }, [pending]);

  // Close on Escape; default-focus the dialog so keyboard users can act.
  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !pending.ack) close({ confirmed: false });
    };
    window.addEventListener('keydown', onKey);
    dialogRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [pending, close]);

  const typeOk = !pending?.requireType || typed === pending.requireType;
  const inputOk = !pending?.input?.required || inputValue.trim().length > 0;
  const canConfirm = typeOk && inputOk;

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(15, 23, 42, 0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 16, animation: 'fadeIn 120ms ease forwards',
          }}
          onClick={() => { if (!pending.ack) close({ confirmed: false }); }}
          role="presentation"
        >
          <div
            ref={dialogRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg-card)',
              color: 'var(--text-primary)',
              borderRadius: 'var(--radius)',
              padding: 20,
              width: '100%', maxWidth: 400,
              boxShadow: 'var(--shadow-lg)',
              outline: 'none',
            }}
          >
            <h3 id="confirm-title" style={{ fontSize: '1.1rem', marginBottom: 8 }}>
              {pending.title}
            </h3>
            {pending.message && (
              <div style={{ fontSize: '0.95rem', color: 'var(--text-secondary)', marginBottom: 12 }}>
                {pending.message}
              </div>
            )}
            {pending.detail && (
              <div style={{
                fontSize: '0.8rem',
                color: 'var(--text-muted)',
                marginBottom: 12,
                padding: 10,
                background: 'var(--bg-secondary)',
                borderRadius: 'var(--radius-sm)',
              }}>
                {pending.detail}
              </div>
            )}
            {pending.input && (
              <textarea
                className="input"
                rows={3}
                value={inputValue}
                maxLength={pending.input.maxLength ?? 500}
                placeholder={pending.input.placeholder}
                onChange={(e) => setInputValue(e.target.value)}
                style={{ marginBottom: 12 }}
              />
            )}
            {pending.requireType && (
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  Type <code style={{
                    fontFamily: 'ui-monospace, monospace',
                    background: 'var(--bg-secondary)',
                    padding: '1px 6px',
                    borderRadius: 3,
                  }}>{pending.requireType}</code> to confirm
                </label>
                <input
                  className="input"
                  value={typed}
                  autoFocus
                  onChange={(e) => setTyped(e.target.value)}
                  style={{ marginTop: 6, fontFamily: 'ui-monospace, monospace' }}
                />
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              {!pending.ack && (
                <button
                  className="btn btn-ghost"
                  onClick={() => close({ confirmed: false })}
                  style={{ width: 'auto' }}
                >
                  {pending.cancelLabel || 'Cancel'}
                </button>
              )}
              <button
                className={
                  pending.variant === 'danger' ? 'btn btn-danger'
                    : pending.variant === 'warning' ? 'btn btn-warning'
                    : 'btn btn-primary'
                }
                onClick={() => close({ confirmed: true, input: pending.input ? inputValue : undefined })}
                disabled={!canConfirm}
                style={{ width: 'auto' }}
              >
                {pending.confirmLabel || (pending.ack ? 'OK' : 'Confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
