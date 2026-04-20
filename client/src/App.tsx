import { useEffect, useState } from 'react';
import { Layout } from './components/Layout';
import { Pair } from './pages/Pair';
import { Scan } from './pages/Scan';
import { Result } from './pages/Result';
import { Dashboard } from './pages/Dashboard';
import { CardIssue } from './pages/CardIssue';
import { useAuth } from './hooks/useAuth';
import { getTodayStats } from './lib/db';
import type { ScanResult as ScanResultType, NostrEvent } from './types';

type Page = 'home' | 'pair' | 'scan' | 'result' | 'dashboard' | 'card';

const GATE_STORAGE_KEY = 'matchpass.gateId';

export function App() {
  const { ready, status, signer, remotePubkey, startPairing, unpair } = useAuth();
  const [page, setPage] = useState<Page>('home');
  const [gateId, setGateId] = useState<string>(() => localStorage.getItem(GATE_STORAGE_KEY) || '');
  const [lastResult, setLastResult] = useState<ScanResultType | null>(null);
  const [cardTarget, setCardTarget] = useState<string | null>(null);
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

  return (
    <Layout
      title="MatchPass"
      roleBadge="Steward"
      onSettingsOpen={async () => {
        if (confirm('Unpair from Signet?')) await unpair();
      }}
    >
      <Home
        remotePubkey={remotePubkey || ''}
        stats={todayStats}
        onScan={() => setPage('scan')}
        onDashboard={() => setPage('dashboard')}
      />
    </Layout>
  );
}

function Home({
  remotePubkey,
  stats,
  onScan,
  onDashboard,
}: {
  remotePubkey: string;
  stats: { green: number; amber: number; red: number };
  onScan: () => void;
  onDashboard: () => void;
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

      <button className="btn btn-secondary btn-lg" onClick={onDashboard} style={{ marginBottom: 24 }}>
        Officer dashboard
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
