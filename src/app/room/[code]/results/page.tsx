'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { useSocket } from '@/hooks/useSocket';

interface Player { id: string; name: string; score: number; }

export default function ResultsPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const code = (params.code as string)?.toUpperCase();
  const { emit } = useSocket();

  const [players, setPlayers] = useState<Player[]>([]);

  useEffect(() => {
    const raw = searchParams.get('players');
    if (raw) {
      try { setPlayers(JSON.parse(decodeURIComponent(raw))); } catch { }
    }
  }, [searchParams]);

  const medals = ['🥇', '🥈', '🥉'];
  const maxScore = players[0]?.score || 1;

  return (
    <main style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem', position: 'relative', zIndex: 1 }}>
      <div style={{ maxWidth: '600px', width: '100%' }}>
        <div style={{ textAlign: 'center', marginBottom: '2.5rem' }} className="animate-slide-up">
          <div style={{ fontSize: '4rem', marginBottom: '0.5rem' }} className="animate-float">🏆</div>
          <h1 style={{ fontSize: '2rem', fontWeight: 900, background: 'linear-gradient(135deg, #fbbf24, #f9a8d4)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', margin: 0 }}>
            ผลการแข่งขัน
          </h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
            🏠 ห้อง <strong>{code}</strong>
          </p>
        </div>

        {/* Podium-style top 3 */}
        {players.length >= 1 && (
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: '0.75rem', marginBottom: '2rem' }} className="animate-slide-up">
            {[players[1], players[0], players[2]].filter(Boolean).map((p, visualIdx) => {
              const actualRank = players.indexOf(p);
              const heights = [140, 180, 110];
              return (
                <div key={p.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', flex: 1 }}>
                  <div style={{ fontSize: '2rem' }}>{medals[actualRank] || `${actualRank + 1}.`}</div>
                  <div style={{ fontWeight: 800, fontSize: '0.9rem', textAlign: 'center', maxWidth: '80px', wordBreak: 'break-word' }}>{p.name}</div>
                  <div style={{ fontWeight: 900, fontSize: '1.2rem', color: actualRank === 0 ? 'var(--gold)' : 'var(--text-primary)' }}>{p.score}</div>
                  <div style={{
                    width: '100%', height: `${heights[visualIdx]}px`,
                    background: actualRank === 0 ? 'linear-gradient(180deg, rgba(251,191,36,0.4), rgba(251,191,36,0.1))' :
                      actualRank === 1 ? 'linear-gradient(180deg, rgba(148,163,184,0.3), rgba(148,163,184,0.1))' :
                        'linear-gradient(180deg, rgba(180,120,60,0.3), rgba(180,120,60,0.1))',
                    border: '1px solid',
                    borderColor: actualRank === 0 ? 'rgba(251,191,36,0.4)' : actualRank === 1 ? 'rgba(148,163,184,0.3)' : 'rgba(180,120,60,0.3)',
                    borderRadius: '12px 12px 0 0',
                  }} />
                </div>
              );
            })}
          </div>
        )}

        {/* Full Leaderboard */}
        <div className="glass-card animate-slide-up" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h2 style={{ margin: '0 0 1rem', fontSize: '1rem', fontWeight: 700, color: 'var(--text-secondary)' }}>📊 ตารางคะแนนทั้งหมด</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {players.map((p, i) => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 1rem', borderRadius: '12px', background: i === 0 ? 'rgba(251,191,36,0.1)' : 'rgba(255,255,255,0.04)', border: `1px solid ${i === 0 ? 'rgba(251,191,36,0.3)' : 'var(--border-subtle)'}` }}>
                <span style={{ fontSize: '1.25rem', minWidth: '28px' }}>{medals[i] || `${i + 1}.`}</span>
                <span style={{ flex: 1, fontWeight: 700 }}>{p.name}</span>
                {/* Score bar */}
                <div style={{ width: '80px', height: '6px', background: 'rgba(255,255,255,0.08)', borderRadius: '999px', overflow: 'hidden', marginRight: '0.5rem' }}>
                  <div style={{ height: '100%', width: `${(p.score / maxScore) * 100}%`, background: 'var(--gradient-btn)', borderRadius: '999px', transition: 'width 0.5s' }} />
                </div>
                <span style={{ fontWeight: 900, fontSize: '1.1rem', minWidth: '50px', textAlign: 'right', color: i === 0 ? 'var(--gold)' : 'var(--text-primary)' }}>{p.score}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
          <button id="play-again-btn" className="btn-primary" style={{ flex: 1 }} onClick={() => {
            emit('restart-game', { roomCode: code });
            router.push(`/room/${code}/lobby`);
          }}>
            🔄 เล่นอีกรอบ
          </button>
          <button id="home-btn" className="btn-secondary" style={{ flex: 1 }} onClick={() => router.push('/')}>
            🏠 กลับหน้าแรก
          </button>
        </div>
      </div>
    </main>
  );
}
