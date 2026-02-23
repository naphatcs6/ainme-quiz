'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useSocket } from '@/hooks/useSocket';

export default function HomePage() {
  const router = useRouter();
  const { emit, isConnected } = useSocket();

  const [name, setName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [tab, setTab] = useState<'create' | 'join'>('create');
  const [totalRounds, setTotalRounds] = useState(10);
  const [roundDuration, setRoundDuration] = useState(30);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = useCallback(() => {
    if (!name.trim()) return setError('กรุณาใส่ชื่อของคุณ');
    setLoading(true);
    setError('');
    emit('create-room', { playerName: name.trim(), totalRounds, roundDuration }, (res: { success: boolean; room: { code: string }; error?: string }) => {
      setLoading(false);
      if (res.success) {
        localStorage.setItem('playerName', name.trim());
        router.push(`/room/${res.room.code}/lobby`);
      } else {
        setError(res.error || 'เกิดข้อผิดพลาด');
      }
    });
  }, [name, totalRounds, roundDuration, emit, router]);

  const handleJoin = useCallback(() => {
    if (!name.trim()) return setError('กรุณาใส่ชื่อของคุณ');
    if (!roomCode.trim()) return setError('กรุณาใส่ Room Code');
    setLoading(true);
    setError('');
    emit('join-room', { roomCode: roomCode.trim().toUpperCase(), playerName: name.trim() }, (res: { success: boolean; room: { code: string }; error?: string }) => {
      setLoading(false);
      if (res.success) {
        localStorage.setItem('playerName', name.trim());
        router.push(`/room/${res.room.code}/lobby`);
      } else {
        setError(res.error || 'เกิดข้อผิดพลาด');
      }
    });
  }, [name, roomCode, emit, router]);

  return (
    <main style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem', position: 'relative', zIndex: 1 }}>
      {/* Hero */}
      <div style={{ textAlign: 'center', marginBottom: '3rem' }} className="animate-slide-up">
        <div style={{ fontSize: '4rem', marginBottom: '0.5rem' }} className="animate-float">🎵</div>
        <h1 style={{ fontSize: 'clamp(2rem, 6vw, 3.5rem)', fontWeight: 900, background: 'linear-gradient(135deg, #a78bfa, #f9a8d4, #67e8f9)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', margin: 0, lineHeight: 1.1 }}>
          AnimeQuiz
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '1.1rem', marginTop: '0.75rem', fontWeight: 500 }}>
          ทายเพลงอนิเมะ • เล่นกับเพื่อนแบบเรียลไทม์ 🎮
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', marginTop: '1rem', flexWrap: 'wrap' }}>
          <span className="badge badge-purple">🎵 YouTube</span>
          <span className="badge badge-pink">👥 Multiplayer</span>
          <span className="badge badge-gold">⚡ Real-time</span>
        </div>
      </div>

      {/* Card */}
      <div className="glass-card animate-slide-up" style={{ width: '100%', maxWidth: '460px', padding: '2.5rem', animationDelay: '0.1s' }}>
        {/* Name input */}
        <div style={{ marginBottom: '1.5rem' }}>
          <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-secondary)', fontWeight: 600, fontSize: '0.875rem' }}>
            ชื่อผู้เล่น
          </label>
          <input
            id="player-name"
            className="input-field"
            placeholder="ชื่อของคุณ..."
            value={name}
            onChange={e => setName(e.target.value)}
            maxLength={20}
            onKeyDown={e => e.key === 'Enter' && (tab === 'create' ? handleCreate() : handleJoin())}
          />
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', background: 'rgba(255,255,255,0.04)', borderRadius: '12px', padding: '0.3rem' }}>
          {(['create', 'join'] as const).map(t => (
            <button
              key={t}
              onClick={() => { setTab(t); setError(''); }}
              style={{
                flex: 1, padding: '0.65rem', borderRadius: '10px', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700, fontSize: '0.95rem', transition: 'all 0.2s',
                background: tab === t ? 'var(--gradient-btn)' : 'transparent',
                color: tab === t ? 'white' : 'var(--text-secondary)',
              }}
            >
              {t === 'create' ? '🏠 สร้างห้อง' : '🚪 เข้าร่วม'}
            </button>
          ))}
        </div>

        {tab === 'join' && (
          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-secondary)', fontWeight: 600, fontSize: '0.875rem' }}>
              Room Code
            </label>
            <input
              id="room-code-input"
              className="input-field"
              placeholder="XXXXXX"
              value={roomCode}
              onChange={e => setRoomCode(e.target.value.toUpperCase())}
              maxLength={8}
              style={{ textAlign: 'center', fontSize: '1.5rem', fontWeight: 800, letterSpacing: '0.25em' }}
              onKeyDown={e => e.key === 'Enter' && handleJoin()}
            />
          </div>
        )}

        {tab === 'create' && (
          <div style={{ marginBottom: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <label style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', color: 'var(--text-secondary)', fontWeight: 600, fontSize: '0.875rem' }}>
                <span>จำนวนเพลง</span>
                <span style={{ color: 'var(--purple-light)' }}>{totalRounds} เพลง</span>
              </label>
              <input type="range" min={3} max={20} value={totalRounds} onChange={e => setTotalRounds(+e.target.value)}
                style={{ width: '100%', accentColor: 'var(--purple)' }} />
            </div>
            <div>
              <label style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', color: 'var(--text-secondary)', fontWeight: 600, fontSize: '0.875rem' }}>
                <span>เวลาต่อรอบ</span>
                <span style={{ color: 'var(--purple-light)' }}>{roundDuration} วินาที</span>
              </label>
              <input type="range" min={10} max={60} step={5} value={roundDuration} onChange={e => setRoundDuration(+e.target.value)}
                style={{ width: '100%', accentColor: 'var(--purple)' }} />
            </div>
          </div>
        )}

        {error && (
          <div style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '10px', padding: '0.75rem 1rem', color: '#fca5a5', fontSize: '0.875rem', marginBottom: '1rem', textAlign: 'center' }}>
            {error}
          </div>
        )}

        <button
          id={tab === 'create' ? 'create-room-btn' : 'join-room-btn'}
          className="btn-primary"
          style={{ width: '100%', fontSize: '1.05rem' }}
          disabled={loading || !isConnected}
          onClick={tab === 'create' ? handleCreate : handleJoin}
        >
          {loading ? '⏳ กำลังดำเนินการ...' : !isConnected ? '🔌 กำลังเชื่อมต่อ...' : tab === 'create' ? '✨ สร้างห้อง' : '🚀 เข้าร่วมเกม'}
        </button>

        <p style={{ textAlign: 'center', marginTop: '1.25rem', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
          {isConnected ? '🟢 เชื่อมต่อแล้ว' : '🔴 กำลังเชื่อมต่อ...'}
        </p>
      </div>

      {/* How to play */}
      <div style={{ marginTop: '2.5rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem', maxWidth: '600px', width: '100%' }} className="animate-slide-up">
        {[
          { icon: '🎵', title: 'เพิ่มเพลง', desc: 'วาง YouTube URL เพลงอนิเมะที่ชอบ' },
          { icon: '👥', title: 'ชวนเพื่อน', desc: 'แชร์ Room Code ให้เพื่อนเข้าร่วม' },
          { icon: '🎯', title: 'ทายเพลง', desc: 'ฟังเพลงแล้วพิมพ์คำตอบให้เร็วที่สุด' },
          { icon: '🏆', title: 'ชนะ!', desc: 'สะสมคะแนนและขึ้นอันดับ 1' },
        ].map(item => (
          <div key={item.title} className="glass-card glass-card-hover" style={{ padding: '1.25rem', textAlign: 'center' }}>
            <div style={{ fontSize: '1.75rem', marginBottom: '0.5rem' }}>{item.icon}</div>
            <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.3rem' }}>{item.title}</div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', lineHeight: 1.5 }}>{item.desc}</div>
          </div>
        ))}
      </div>
    </main>
  );
}
