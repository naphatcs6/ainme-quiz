'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useSocket } from '@/hooks/useSocket';

interface Player { id: string; name: string; score: number; answered: boolean; }
interface Song { videoId: string; title: string; artist: string; thumbnail?: string; }
interface Room { code: string; hostId: string; players: Player[]; status: string; totalRounds: number; totalSongs: number; roundDuration: number; }

function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([^&\n?#]+)/,
    /(?:youtu\.be\/)([^&\n?#]+)/,
    /(?:youtube\.com\/embed\/)([^&\n?#]+)/,
    /^([a-zA-Z0-9_-]{11})$/,
  ];
  for (const p of patterns) {
    const m = url.trim().match(p);
    if (m) return m[1];
  }
  return null;
}

export default function LobbyPage() {
  const router = useRouter();
  const params = useParams();
  const code = (params.code as string)?.toUpperCase();
  const { emit, on, off, isConnected, socket } = useSocket();

  const [room, setRoom] = useState<Room | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [songTitle, setSongTitle] = useState('');
  const [songArtist, setSongArtist] = useState('');
  const [addError, setAddError] = useState('');
  const [loading, setLoading] = useState(false);
  const [startError, setStartError] = useState('');
  const [playerName, setPlayerName] = useState('');

  useEffect(() => {
    const name = localStorage.getItem('playerName') || '';
    setPlayerName(name);
  }, []);

  // Fetch room state on connect (join-room is idempotent for existing members)
  useEffect(() => {
    if (!isConnected || !code) return;
    const name = localStorage.getItem('playerName') || 'Player';
    emit('join-room', { roomCode: code, playerName: name }, (res: { success: boolean; room: Room; songs?: Song[]; error?: string }) => {
      if (res.success) {
        setRoom(res.room);
      }
    });
  }, [isConnected, code, emit]);

  useEffect(() => {
    const offRoomUpdated = on('room-updated', (data: unknown) => { setRoom(data as Room); });
    const offSongList = on('song-list-updated', (data: unknown) => { setSongs((data as { songs: Song[] }).songs); });
    const offGameStart = on('round-started', () => { router.push(`/room/${code}/game`); });

    return () => {
      offRoomUpdated();
      offSongList();
      offGameStart();
    };
  }, [on, code, router]);

  const handleAddSong = useCallback(() => {
    const vid = extractVideoId(youtubeUrl.trim());
    if (!vid) return setAddError('URL ไม่ถูกต้อง ลองใหม่อีกครั้ง');
    if (!songTitle.trim()) return setAddError('กรุณาใส่ชื่อเพลง');

    emit('add-song', {
      roomCode: code,
      videoId: vid,
      title: songTitle.trim(),
      artist: songArtist.trim() || 'Unknown',
      thumbnail: `https://img.youtube.com/vi/${vid}/mqdefault.jpg`,
    }, (res: { success: boolean; songs: Song[]; error?: string }) => {
      if (res.success) {
        setSongs(res.songs);
        setYoutubeUrl('');
        setSongTitle('');
        setSongArtist('');
        setAddError('');
      } else {
        setAddError(res.error || 'เกิดข้อผิดพลาด');
      }
    });
  }, [youtubeUrl, songTitle, songArtist, code, emit]);

  const handleRemoveSong = (index: number) => {
    emit('remove-song', { roomCode: code, index }, (res: { success: boolean; songs: Song[] }) => {
      if (res.success) setSongs(res.songs);
    });
  };

  const handleStart = () => {
    setLoading(true);
    setStartError('');
    emit('start-game', { roomCode: code }, (res: { success: boolean; error?: string }) => {
      setLoading(false);
      if (!res.success) setStartError(res.error || 'เริ่มเกมไม่ได้');
    });
  };

  const isHost = room ? socket?.id === room.hostId : false;

  return (
    <main style={{ minHeight: '100vh', padding: '2rem', position: 'relative', zIndex: 1, maxWidth: '900px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: '2rem' }} className="animate-slide-up">
        <h1 style={{ fontSize: '1.75rem', fontWeight: 800, margin: 0 }}>🏠 ล็อบบี้</h1>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Room Code:</span>
            <span style={{
              fontSize: '1.75rem', fontWeight: 900, letterSpacing: '0.2em',
              background: 'var(--gradient-btn)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
            }}>{code}</span>
            <button onClick={() => navigator.clipboard.writeText(code)} style={{ background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.3)', borderRadius: '8px', padding: '0.3rem 0.6rem', cursor: 'pointer', color: 'var(--purple-light)', fontSize: '0.8rem', fontFamily: 'inherit' }}>
              📋 คัดลอก
            </button>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: '1.5rem', alignItems: 'start' }}>
        {/* Players */}
        <div className="glass-card animate-slide-up" style={{ padding: '1.5rem' }}>
          <h2 style={{ margin: '0 0 1rem', fontSize: '1rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
            👥 ผู้เล่น ({room?.players?.length || 0})
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {(room?.players || []).map((p) => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.65rem 0.85rem', background: 'rgba(255,255,255,0.04)', borderRadius: '10px', border: '1px solid var(--border-subtle)' }}>
                <span style={{ fontSize: '1.1rem' }}>
                  {p.id === room?.hostId ? '👑' : '🎮'}
                </span>
                <span style={{ fontWeight: 600, flex: 1, fontSize: '0.95rem' }}>{p.name}</span>
                {p.id === room?.hostId && <span className="badge badge-gold">Host</span>}
                {p.name === playerName && p.id !== room?.hostId && <span className="badge badge-purple">คุณ</span>}
              </div>
            ))}
          </div>

          {/* Start button */}
          <div style={{ marginTop: '1.5rem' }}>
            {startError && <p style={{ color: '#fca5a5', fontSize: '0.8rem', marginBottom: '0.5rem', textAlign: 'center' }}>{startError}</p>}
            <button id="start-game-btn" className="btn-primary" style={{ width: '100%' }} onClick={handleStart} disabled={loading || songs.length === 0}>
              {loading ? '⏳ กำลังเริ่ม...' : `🚀 เริ่มเกม (${songs.length} เพลง)`}
            </button>
            {songs.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', textAlign: 'center', marginTop: '0.5rem' }}>เพิ่มเพลงก่อนเริ่มเกม</p>}
          </div>
        </div>

        {/* Song Management */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="glass-card animate-slide-up" style={{ padding: '1.5rem', animationDelay: '0.1s' }}>
            <h2 style={{ margin: '0 0 1rem', fontSize: '1rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
              ➕ เพิ่มเพลงจาก YouTube
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <input id="youtube-url" className="input-field" placeholder="YouTube URL (ตัวอย่าง: https://youtu.be/...)" value={youtubeUrl} onChange={e => setYoutubeUrl(e.target.value)} />
              <input id="song-title" className="input-field" placeholder="ชื่อเพลง (สำหรับทาย)" value={songTitle} onChange={e => setSongTitle(e.target.value)} />
              <input id="song-artist" className="input-field" placeholder="ชื่ออนิเมะ / ศิลปิน (ไม่บังคับ)" value={songArtist} onChange={e => setSongArtist(e.target.value)} />
              {addError && <p style={{ color: '#fca5a5', fontSize: '0.8rem', margin: 0 }}>{addError}</p>}
              <button id="add-song-btn" className="btn-primary" onClick={handleAddSong}>
                ✨ เพิ่มเพลง
              </button>
            </div>
          </div>

          {/* Song list */}
          <div className="glass-card animate-slide-up" style={{ padding: '1.5rem', animationDelay: '0.2s' }}>
            <h2 style={{ margin: '0 0 1rem', fontSize: '1rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
              🎵 เพลงในเกม ({songs.length})
            </h2>
            {songs.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🎶</div>
                <p style={{ margin: 0 }}>ยังไม่มีเพลง เพิ่มได้เลย!</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '280px', overflowY: 'auto' }}>
                {songs.map((song, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.6rem 0.75rem', background: 'rgba(255,255,255,0.04)', borderRadius: '10px', border: '1px solid var(--border-subtle)' }}>
                    {song.thumbnail && <img src={song.thumbnail} alt="" style={{ width: '48px', height: '36px', objectFit: 'cover', borderRadius: '6px' }} />}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: '0.875rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{song.title}</div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{song.artist}</div>
                    </div>
                    <button className="btn-danger" onClick={() => handleRemoveSong(i)}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
