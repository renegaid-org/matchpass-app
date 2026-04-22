import { useEffect, useState } from 'react';
import { Layout } from './components/Layout';
import { OfflineBanner } from './components/OfflineBanner';
import { useConfirm } from './components/ConfirmModal';
import { useOfflineQueue } from './hooks/useOfflineQueue';
import { Pair } from './pages/Pair';
import { Scan } from './pages/Scan';
import { Result } from './pages/Result';
import { Dashboard } from './pages/Dashboard';
import { CardIssue } from './pages/CardIssue';
import { ReviewDetail } from './pages/ReviewDetail';
import { SanctionIssue } from './pages/SanctionIssue';
import { Roster } from './pages/Roster';
import { UnlinkedIncident } from './pages/UnlinkedIncident';
import { useAuth } from './hooks/useAuth';
import { getTodayStats } from './lib/db';
import type { ScanResult as ScanResultType, NostrEvent } from './types';
import type { ReviewRequest } from './hooks/useFlags';

type Page = 'home' | 'pair' | 'scan' | 'result' | 'dashboard' | 'card' | 'review' | 'sanction' | 'roster' | 'incident';

const GATE_STORAGE_KEY = 'matchpass.gateId';

export function App() {
  const { ready, status, signer, remotePubkey, startPairing, unpair } = useAuth();
  const confirm = useConfirm();
  const offline = useOfflineQueue(signer);
  const [page, setPage] = useState<Page>('home');
  const [gateId, setGateId] = useState<string>(() => localStorage.getItem(GATE_STORAGE_KEY) || '');
  const [lastResult, setLastResult] = useState<ScanResultType | null>(null);
  const [cardTarget, setCardTarget] = useState<string | null>(null);
  const [sanctionTarget, setSanctionTarget] = useState<string | null>(null);
  const [reviewTarget, setReviewTarget] = useState<ReviewRequest | null>(null);
  const [todayStats, setTodayStats] = useState({ green: 0, amber: 0, red: 0 });

  useEffect(() => {
    if (remotePubkey) {
      getTodayStats(remotePubkey).then(s =>
        setTodayStats({ green: s.green, amber: s.amber, red: s.red }),
      );
    }
  }, [remotePubkey, lastResult]);

  if (!ready) {
    return (
      <Layout title="MatchPass">
        <div className="card"><p>Loading…</p></div>
      </Layout>
    );
  }

  const banner = (
    <OfflineBanner
      online={offline.online}
      queueSize={offline.queueSize}
      flushing={offline.flushing}
      onRetry={() => { offline.flush().catch(() => {}); }}
    />
  );

  if (status.kind !== 'connected' || page === 'pair') {
    return (
      <Layout title="MatchPass" showBack={page === 'pair'} onBack={() => setPage('home')}>
        <Pair status={status} onStart={() => startPairing()} onCancel={() => setPage('home')} />
      </Layout>
    );
  }

  if (page === 'result' && lastResult) {
    return (
      <Layout
        title="Result"
        showBack
        onBack={() => setPage('scan')}
        accent={lastResult.decision === 'red' ? 'warning' : 'default'}
      >
        <Result result={lastResult} onDone={() => setPage('scan')} />
      </Layout>
    );
  }

  if (page === 'scan') {
    if (!gateId) {
      return (
        <Layout title="Choose gate" showBack onBack={() => setPage('home')}>
          <GatePicker onPick={(id) => { setGateId(id); localStorage.setItem(GATE_STORAGE_KEY, id); }} />
        </Layout>
      );
    }
    if (!signer || !remotePubkey) return null;
    return (
      <Layout title="Scan" showBack onBack={() => setPage('home')} roleBadge="Steward">
        <Scan
          signer={signer}
          stewardPubkey={remotePubkey}
          gateId={gateId}
          onResult={(r: ScanResultType & { venueEntryEvent: NostrEvent }) => {
            setLastResult(r);
            setPage('result');
          }}
          onSwitchGate={() => { setGateId(''); localStorage.removeItem(GATE_STORAGE_KEY); }}
        />
      </Layout>
    );
  }

  if (page === 'dashboard' && signer) {
    return (
      <Layout title="Dashboard" showBack onBack={() => setPage('home')} roleBadge="Officer" accent="officer">
        <Dashboard
          signer={signer}
          onIssueCardForFlag={(fanPubkey) => {
            setCardTarget(fanPubkey);
            setPage('card');
          }}
          onOpenReview={(request) => {
            setReviewTarget(request);
            setPage('review');
          }}
          onIssueSanction={(fanPubkey) => {
            setSanctionTarget(fanPubkey);
            setPage('sanction');
          }}
        />
      </Layout>
    );
  }

  if (page === 'card' && signer && cardTarget) {
    return (
      <Layout title="Issue card" showBack onBack={() => setPage('dashboard')} accent="warning">
        <CardIssue signer={signer} fanPubkey={cardTarget} onDone={() => setPage('dashboard')} />
      </Layout>
    );
  }

  if (page === 'incident') {
    return (
      <Layout title="Incident note" showBack onBack={() => setPage('home')}>
        <UnlinkedIncident onBack={() => setPage('home')} />
      </Layout>
    );
  }

  if (page === 'roster' && signer && remotePubkey) {
    return (
      <Layout title="Roster" showBack onBack={() => setPage('home')} accent="officer">
        <Roster signer={signer} adminPubkey={remotePubkey} onBack={() => setPage('home')} />
      </Layout>
    );
  }

  if (page === 'sanction' && signer && sanctionTarget) {
    return (
      <Layout title="Issue sanction" showBack onBack={() => setPage('dashboard')} accent="warning">
        <SanctionIssue
          signer={signer}
          fanPubkey={sanctionTarget}
          onBack={() => setPage('dashboard')}
          onDone={() => {
            setSanctionTarget(null);
            setPage('dashboard');
          }}
        />
      </Layout>
    );
  }

  if (page === 'review' && signer && remotePubkey && reviewTarget) {
    return (
      <Layout title="Review" showBack onBack={() => setPage('dashboard')} accent="officer">
        <ReviewDetail
          signer={signer}
          officerPubkey={remotePubkey}
          request={reviewTarget}
          onBack={() => setPage('dashboard')}
          onResolved={() => {
            setReviewTarget(null);
            setPage('dashboard');
          }}
        />
      </Layout>
    );
  }

  return (
    <>
      {banner}
      <Layout
        title="MatchPass"
        roleBadge="Steward"
        onSettingsOpen={async () => {
          const { confirmed } = await confirm({
            title: 'Unpair from Signet?',
            message: 'This device will forget your Signet pairing.',
            detail: 'Incident notes, offline queue, and today\'s stats on this device will be cleared. Your chain events on the relay are unaffected.',
            variant: 'danger',
            confirmLabel: 'Unpair and clear',
          });
          if (confirmed) {
            localStorage.removeItem(GATE_STORAGE_KEY);
            setGateId('');
            await unpair();
          }
        }}
      >
        <Home
          remotePubkey={remotePubkey || ''}
          stats={todayStats}
          onScan={() => setPage('scan')}
          onDashboard={() => setPage('dashboard')}
          onRoster={() => setPage('roster')}
          onIncident={() => setPage('incident')}
        />
      </Layout>
    </>
  );
}

function Home({
  remotePubkey,
  stats,
  onScan,
  onDashboard,
  onRoster,
  onIncident,
}: {
  remotePubkey: string;
  stats: { green: number; amber: number; red: number };
  onScan: () => void;
  onDashboard: () => void;
  onRoster: () => void;
  onIncident: () => void;
}) {
  const total = stats.green + stats.amber + stats.red;
  return (
    <div className="fade-in">
      <div className="section">
        <div className="section-title">Paired</div>
        <div className="card">
          <code style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            {remotePubkey.slice(0, 12)}…{remotePubkey.slice(-8)}
          </code>
        </div>
      </div>

      <button className="btn btn-primary btn-lg" onClick={onScan} style={{ marginBottom: 12 }}>
        Scan
      </button>

      <button className="btn btn-secondary btn-lg" onClick={onDashboard} style={{ marginBottom: 12 }}>
        Officer dashboard
      </button>

      <button className="btn btn-ghost btn-sm" onClick={onIncident} style={{ marginBottom: 8 }}>
        Note an incident (this device)
      </button>

      <button className="btn btn-ghost btn-sm" onClick={onRoster} style={{ marginBottom: 24 }}>
        Admin: edit roster
      </button>

      <div className="section">
        <div className="section-title">Today — this device</div>
        <div className="card">
          {total === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>No scans yet today.</p>
          ) : (
            <>
              <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{total}</div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                {stats.green} green · {stats.amber} amber · {stats.red} red
              </div>
            </>
          )}
        </div>
        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 8 }}>
          Private to your device. Not shared with admin or server.
        </p>
      </div>

      <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: 24, textAlign: 'center' }}>
        MatchPass credentials are adult-only in this pilot. Under-16s enter as normal.
      </p>
    </div>
  );
}

function GatePicker({ onPick }: { onPick: (id: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <div className="fade-in">
      <div className="card">
        <p style={{ marginBottom: 12, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
          Which gate are you working? A short code is fine — e.g. <code>A</code>,{' '}
          <code>N1</code>, <code>turnstile-6</code>.
        </p>
        <input
          className="input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Gate ID"
          maxLength={50}
        />
        <button
          className="btn btn-primary"
          disabled={!value.trim()}
          onClick={() => onPick(value.trim())}
          style={{ marginTop: 12 }}
        >
          Start scanning
        </button>
      </div>
    </div>
  );
}
