'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useSocket } from '@/hooks/useSocket';

interface Player { id: string; name: string; score: number; answered: boolean; correct?: boolean; }
interface Song { videoId: string; title: string; artist: string; thumbnail?: string; }

export default function GamePage() {
  const router = useRouter();
  const params = useParams();
  const code = (params.code as string)?.toUpperCase();
  const { emit, on, off, socket, isConnected } = useSocket();

  const [round, setRound] = useState(1);
  const [totalRounds, setTotalRounds] = useState(10);
  const [timeLeft, setTimeLeft] = useState(30);
  const [maxTime, setMaxTime] = useState(30);
  const [players, setPlayers] = useState<Player[]>([]);
  const [choices, setChoices] = useState<string[]>([]);
  const [selectedChoice, setSelectedChoice] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [myResult, setMyResult] = useState<{ correct: boolean; points: number } | null>(null);
  const [roundEnded, setRoundEnded] = useState(false);
  const [revealSong, setRevealSong] = useState<Song | null>(null);
  const [isLastRound, setIsLastRound] = useState(false);
  const [recentAnswers, setRecentAnswers] = useState<{ playerName: string; correct: boolean; points: number }[]>([]);

  // Audio state
  const [currentVideoId, setCurrentVideoId] = useState<string>('');
  const [audioStarted, setAudioStarted] = useState(false);
  const [needsManualPlay, setNeedsManualPlay] = useState(false);
  const [iframeKey, setIframeKey] = useState(0); // force re-mount iframe

  // Build YouTube embed URL
  const buildEmbedUrl = (videoId: string, autoplay: boolean) =>
    `https://www.youtube.com/embed/${videoId}?autoplay=${autoplay ? 1 : 0}&controls=1&rel=0&iv_load_policy=3&modestbranding=1&enablejsapi=1`;

  const startAudio = useCallback((videoId: string, autoplay = true) => {
    setCurrentVideoId(videoId);
    setIframeKey(k => k + 1); // force iframe re-mount with new src
    setAudioStarted(autoplay);
    setNeedsManualPlay(!autoplay);
  }, []);

  const handleManualPlay = useCallback(() => {
    if (!currentVideoId) return;
    setNeedsManualPlay(false);
    setAudioStarted(true);
    setIframeKey(k => k + 1);
  }, [currentVideoId]);

  useEffect(() => {
    const offRound = on('round-started', (data: unknown) => {
      const d = data as { round: number; totalRounds: number; videoId: string; duration: number; players: Player[]; choices: string[] };
      setRound(d.round);
      setTotalRounds(d.totalRounds);
      setTimeLeft(d.duration);
      setMaxTime(d.duration);
      setPlayers(d.players);
      setChoices(d.choices || []);
      setSelectedChoice(null);
      setSubmitted(false);
      setMyResult(null);
      setRoundEnded(false);
      setRevealSong(null);
      setRecentAnswers([]);
      setAudioStarted(false);
      setNeedsManualPlay(false);
      // Start loading audio
      startAudio(d.videoId, true);
    });

    const offTimer = on('timer-tick', (data: unknown) => {
      setTimeLeft((data as { timeLeft: number }).timeLeft);
    });

    const offAnswer = on('answer-result', (data: unknown) => {
      const d = data as { playerId: string; playerName: string; correct: boolean; pointsEarned: number; players: Player[] };
      setPlayers(d.players);
      setRecentAnswers(prev => [{ playerName: d.playerName, correct: d.correct, points: d.pointsEarned }, ...prev].slice(0, 5));
      if (d.playerId === socket?.id) {
        setMyResult({ correct: d.correct, points: d.pointsEarned });
      }
    });

    const offRoundEnd = on('round-ended', (data: unknown) => {
      const d = data as { song: Song; players: Player[]; isLastRound: boolean };
      setRoundEnded(true);
      setRevealSong(d.song);
      setPlayers(d.players);
      setIsLastRound(d.isLastRound);
      setNeedsManualPlay(false);
      // Stop the video by clearing currentVideoId
      setCurrentVideoId('');
    });

    const offGameOver = on('game-over', (data: unknown) => {
      router.push(`/room/${code}/results?players=${encodeURIComponent(JSON.stringify((data as { players: Player[] }).players))}`);
    });

    return () => { offRound(); offTimer(); offAnswer(); offRoundEnd(); offGameOver(); };
  }, [on, off, socket, code, router, startAudio]);

  // On mount: query server for the current round state (fixes race condition
  // where round-started fires before game page is mounted and listening)
  useEffect(() => {
    if (!isConnected || !code) return;
    type RoundState = {
      success: boolean; status?: string;
      round?: number; totalRounds?: number; videoId?: string;
      duration?: number; timeLeft?: number; players?: Player[];
      song?: Song; isLastRound?: boolean;
    };
    emit('get-round-state', { roomCode: code }, (d: RoundState) => {
      if (!d.success) return;
      if (d.status === 'playing' && d.videoId) {
        setRound(d.round!); setTotalRounds(d.totalRounds!);
        setTimeLeft(d.timeLeft ?? d.duration!); setMaxTime(d.duration!);
        setPlayers(d.players || []); setChoices((d as { choices?: string[] }).choices || []);
        setSelectedChoice(null); setSubmitted(false); setMyResult(null);
        setRoundEnded(false); setRevealSong(null); setRecentAnswers([]);
        startAudio(d.videoId, true);
      } else if (d.status === 'round-result' && d.song) {
        setRoundEnded(true); setRevealSong(d.song);
        setPlayers(d.players || []); setIsLastRound(d.isLastRound || false);
        setCurrentVideoId('');
      }
    });
  }, [isConnected, code, emit, startAudio]);

  const handleChoiceSelect = useCallback((choice: string) => {
    if (submitted || roundEnded) return;
    setSelectedChoice(choice);
    setSubmitted(true);
    emit('submit-answer', { roomCode: code, answer: choice });
  }, [submitted, roundEnded, emit, code]);

  const handleNextRound = () => emit('next-round', { roomCode: code });

  const timerPct = maxTime > 0 ? (timeLeft / maxTime) * 100 : 0;
  const timerColor = timerPct > 50 ? '#22d3ee' : timerPct > 25 ? '#fbbf24' : '#ef4444';
  const sortedPlayers = [...players].sort((a, b) => b.score - a.score);

  return (
    <main style={{ minHeight: '100vh', padding: '1rem', position: 'relative', zIndex: 1 }}>
      <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div>
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>รอบที่</span>
            <span style={{ fontWeight: 900, fontSize: '1.5rem', marginLeft: '0.4rem' }}>{round}</span>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}> / {totalRounds}</span>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '2rem', fontWeight: 900, color: timerColor, fontVariantNumeric: 'tabular-nums', transition: 'color 0.5s', minWidth: '60px', textAlign: 'center' }}>
              {timeLeft}
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>วินาที</div>
          </div>
          <div className="badge badge-purple">🏠 {code}</div>
        </div>

        {/* Timer bar */}
        <div style={{ height: '6px', background: 'rgba(255,255,255,0.1)', borderRadius: '999px', marginBottom: '1.5rem', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${timerPct}%`, background: `linear-gradient(90deg, ${timerColor}, ${timerColor}88)`, borderRadius: '999px', transition: 'width 1s linear, background 0.5s' }} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 260px', gap: '1.5rem', alignItems: 'start' }}>
          {/* Main Game Area */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

            {/* Music Player Card */}
            <div className="glass-card" style={{ overflow: 'hidden', border: '1px solid var(--border-glow)', background: 'linear-gradient(135deg, rgba(139,92,246,0.12), rgba(236,72,153,0.08))' }}>

              {!roundEnded ? (
                <>
                  {/* YouTube iframe — hidden behind overlay, but this allows autoplay */}
                  {currentVideoId && !needsManualPlay && (
                    <div style={{ position: 'relative', height: 0, overflow: 'hidden' }}>
                      <iframe
                        key={iframeKey}
                        src={buildEmbedUrl(currentVideoId, audioStarted)}
                        allow="autoplay; encrypted-media"
                        style={{ position: 'absolute', top: '-9999px', left: 0, width: '1px', height: '1px', border: 'none', opacity: 0 }}
                        title="audio-player"
                      />
                    </div>
                  )}

                  {/* Visible UI */}
                  <div style={{ padding: '2rem', textAlign: 'center' }}>
                    {needsManualPlay ? (
                      /* Browser blocked autoplay — show play button */
                      <>
                        <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>🔇</div>
                        <p style={{ margin: '0 0 1.25rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                          เบราว์เซอร์บล็อกเสียงอัตโนมัติ<br />
                          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>กดปุ่มเพื่อเริ่มฟังเพลง</span>
                        </p>
                        <button
                          id="play-audio-btn"
                          className="btn-primary animate-pulse-glow"
                          style={{ fontSize: '1.15rem', padding: '1rem 2.5rem' }}
                          onClick={handleManualPlay}
                        >
                          🔊 กดเพื่อฟังเพลง
                        </button>
                      </>
                    ) : audioStarted ? (
                      /* Playing */
                      <>
                        <div style={{ display: 'flex', gap: '5px', alignItems: 'flex-end', justifyContent: 'center', height: '48px', marginBottom: '1rem' }}>
                          {[1, 2, 3, 4, 5, 6].map(i => (
                            <div key={i} style={{
                              width: '7px',
                              background: i % 2 === 0 ? '#a78bfa' : '#f9a8d4',
                              borderRadius: '4px',
                              animation: `eq${i} ${0.4 + i * 0.08}s ease-in-out infinite alternate`,
                            }} />
                          ))}
                        </div>
                        <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.1rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                          {submitted ? '✅ ส่งคำตอบแล้ว รอดูผล...' : '🎧 ฟังเพลงแล้วทายชื่อเพลง!'}
                        </h2>
                        {myResult && (
                          <div style={{ marginTop: '0.75rem', padding: '0.65rem 1.25rem', borderRadius: '12px', display: 'inline-block', background: myResult.correct ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)', border: `1px solid ${myResult.correct ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)'}` }}>
                            <span style={{ fontSize: '1.1rem', fontWeight: 800, color: myResult.correct ? '#4ade80' : '#f87171' }}>
                              {myResult.correct ? `✅ ถูกต้อง! +${myResult.points} คะแนน` : '❌ ผิด รอดูเฉลย'}
                            </span>
                          </div>
                        )}
                      </>
                    ) : (
                      /* Loading */
                      <>
                        <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>⏳</div>
                        <p style={{ margin: 0, color: 'var(--text-secondary)', fontWeight: 600 }}>กำลังโหลดเพลง...</p>
                      </>
                    )}
                  </div>
                </>
              ) : (
                /* Round Result */
                <div style={{ padding: '1.5rem', textAlign: 'center' }}>
                  <h2 style={{ margin: '0 0 0.75rem', fontSize: '1rem', color: 'var(--text-secondary)', fontWeight: 600 }}>🎌 เฉลย</h2>

                  {/* YouTube video embed */}
                  {revealSong?.videoId && (
                    <div style={{ position: 'relative', width: '100%', paddingBottom: '56.25%', borderRadius: '12px', overflow: 'hidden', marginBottom: '1rem' }}>
                      <iframe
                        src={`https://www.youtube.com/embed/${revealSong.videoId}?autoplay=1&controls=1&rel=0&modestbranding=1`}
                        allow="autoplay; encrypted-media; picture-in-picture"
                        allowFullScreen
                        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none' }}
                        title={revealSong.title}
                      />
                    </div>
                  )}

                  <div style={{ fontSize: '1.4rem', fontWeight: 900, marginBottom: '0.25rem' }}>{revealSong?.title}</div>
                  <div style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>{revealSong?.artist}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', justifyContent: 'center', marginBottom: '1rem' }}>
                    {players.filter(p => p.correct).map(p => (
                      <span key={p.id} className="badge badge-green">✅ {p.name} ตอบถูก!</span>
                    ))}
                  </div>
                  <button id="next-round-btn" className="btn-primary" onClick={handleNextRound} style={{ minWidth: '160px' }}>
                    {isLastRound ? '🏆 ดูผลสรุป' : '▶️ รอบถัดไป'}
                  </button>
                </div>
              )}
            </div>

            {/* Multiple Choice Buttons */}
            {!roundEnded && choices.length > 0 && (
              <div className="glass-card" style={{ padding: '1.25rem' }}>
                <p style={{ margin: '0 0 0.85rem', fontSize: '0.82rem', color: 'var(--text-muted)', textAlign: 'center', fontWeight: 600 }}>
                  🎯 เลือกชื่อเพลงที่ถูกต้อง
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.65rem' }}>
                  {choices.map((choice, idx) => {
                    const isSelected = selectedChoice === choice;
                    const isCorrect = isSelected && myResult?.correct;
                    const isWrong = isSelected && myResult !== null && !myResult.correct;
                    const bgColor = isCorrect
                      ? 'rgba(34,197,94,0.25)'
                      : isWrong
                        ? 'rgba(239,68,68,0.25)'
                        : 'rgba(255,255,255,0.06)';
                    const borderColor = isCorrect
                      ? 'rgba(34,197,94,0.7)'
                      : isWrong
                        ? 'rgba(239,68,68,0.7)'
                        : isSelected
                          ? 'rgba(139,92,246,0.7)'
                          : 'var(--border-subtle)';
                    return (
                      <button
                        key={idx}
                        id={`choice-btn-${idx}`}
                        onClick={() => handleChoiceSelect(choice)}
                        disabled={submitted}
                        style={{
                          padding: '0.85rem 1rem',
                          borderRadius: '12px',
                          border: `2px solid ${borderColor}`,
                          background: bgColor,
                          color: 'var(--text-primary)',
                          fontWeight: 700,
                          fontSize: '0.9rem',
                          cursor: submitted ? 'default' : 'pointer',
                          transition: 'all 0.2s',
                          textAlign: 'left',
                          lineHeight: 1.3,
                          minHeight: '56px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem',
                        }}
                      >
                        <span style={{ fontSize: '1rem', flexShrink: 0 }}>
                          {isCorrect ? '✅' : isWrong ? '❌' : ['🅐', '🅑', '🅒', '🅓'][idx]}
                        </span>
                        {choice}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Recent Answers Feed */}
            {recentAnswers.length > 0 && (
              <div className="glass-card" style={{ padding: '1rem' }}>
                <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.875rem', color: 'var(--text-secondary)', fontWeight: 700 }}>📢 คำตอบล่าสุด</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  {recentAnswers.map((a, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.875rem', padding: '0.4rem 0.6rem', borderRadius: '8px', background: a.correct ? 'rgba(34,197,94,0.1)' : 'rgba(255,255,255,0.04)' }}>
                      <span>{a.correct ? '✅' : '💭'}</span>
                      <span style={{ fontWeight: 600 }}>{a.playerName}</span>
                      {a.correct && <span style={{ marginLeft: 'auto', color: '#4ade80', fontWeight: 700 }}>+{a.points}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Scoreboard */}
          <div className="glass-card" style={{ padding: '1.25rem' }}>
            <h3 style={{ margin: '0 0 1rem', fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-secondary)' }}>🏆 คะแนน</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {sortedPlayers.map((p, i) => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.6rem 0.75rem', borderRadius: '10px', background: i === 0 ? 'rgba(251,191,36,0.12)' : 'rgba(255,255,255,0.04)', border: `1px solid ${i === 0 ? 'rgba(251,191,36,0.3)' : 'var(--border-subtle)'}`, transition: 'all 0.3s' }}>
                  <span style={{ fontSize: '1rem', minWidth: '24px', textAlign: 'center' }}>
                    {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: '0.875rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {p.name} {p.id === socket?.id ? '(คุณ)' : ''}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {p.answered ? (p.correct ? '✅ ถูก' : '❌ ผิด') : '⏳ รอ...'}
                    </div>
                  </div>
                  <div style={{ fontWeight: 900, fontSize: '1rem', color: i === 0 ? 'var(--gold)' : 'var(--text-primary)' }}>
                    {p.score}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Equalizer keyframes */}
      <style>{`
        @keyframes eq1 { from { height: 10px; } to { height: 30px; } }
        @keyframes eq2 { from { height: 16px; } to { height: 44px; } }
        @keyframes eq3 { from { height: 22px; } to { height: 48px; } }
        @keyframes eq4 { from { height: 14px; } to { height: 38px; } }
        @keyframes eq5 { from { height: 20px; } to { height: 40px; } }
        @keyframes eq6 { from { height: 8px; } to { height: 28px; } }
      `}</style>
    </main>
  );
}
