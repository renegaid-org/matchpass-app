/**
 * Always-on-top build badge. The hue is a deterministic hash of
 * __BUILD_TIME__, so a given build renders the same colour and a new
 * build shifts it — at-a-glance UAT signal for "is this the build I
 * expected to be looking at?".
 *
 * Ported from signet-app/src/components/VersionBadge.tsx. No server
 * component — values are baked in at Vite build time via `define`.
 */
import { Z } from '../lib/z-index';

function hueFromString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

export function VersionBadge() {
  const hue = hueFromString(__BUILD_TIME__);
  const date = __BUILD_TIME__.slice(0, 10);
  const time = __BUILD_TIME__.slice(11, 16);
  return (
    <div
      title={`Built ${__BUILD_TIME__}\nCommit ${__GIT_SHA__}`}
      style={{
        position: 'fixed',
        top: 8,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: Z.debug,
        padding: '4px 10px',
        borderRadius: 6,
        background: `hsl(${hue}, 55%, 30%)`,
        color: '#fff',
        fontSize: 11,
        fontWeight: 600,
        lineHeight: 1.3,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        pointerEvents: 'auto',
        userSelect: 'none',
        boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
        whiteSpace: 'nowrap',
        opacity: 0.85,
      }}
    >
      v{__APP_VERSION__} · {date} {time} · {__GIT_SHA__}
    </div>
  );
}
