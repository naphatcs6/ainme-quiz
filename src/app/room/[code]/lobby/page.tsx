'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useSocket } from '@/hooks/useSocket';

interface Player { id: string; name: string; score: number; answered: boolean; }
interface Song { videoId: string; title: string; artist: string; thumbnail?: string; }
interface Room { code: string; hostId: string; players: Player[]; status: string; totalRounds: number; totalSongs: number; roundDuration: number; }
interface Playlist { id: string; name: string; createdBy: string; createdAt: string; songs: Song[]; }

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

  // Playlist state
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [playlistName, setPlaylistName] = useState('');
  const [playlistError, setPlaylistError] = useState('');
  const [playlistMsg, setPlaylistMsg] = useState('');
  const [showLibrary, setShowLibrary] = useState(false);

  // Expanded playlist editing
  const [expandedPlaylistId, setExpandedPlaylistId] = useState<string | null>(null);
  const [editingSongIdx, setEditingSongIdx] = useState<number | null>(null);
  const [editSongTitle, setEditSongTitle] = useState('');
  const [editSongArtist, setEditSongArtist] = useState('');
  const [editSongUrl, setEditSongUrl] = useState('');
  // Add song to playlist
  const [addToPlUrl, setAddToPlUrl] = useState('');
  const [addToPlTitle, setAddToPlTitle] = useState('');
  const [addToPlArtist, setAddToPlArtist] = useState('');
  const [addToPlError, setAddToPlError] = useState('');
  // Rename
  const [renamingPlaylistId, setRenamingPlaylistId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  useEffect(() => {
    const name = localStorage.getItem('playerName') || '';
    setPlayerName(name);
  }, []);

  useEffect(() => {
    if (!isConnected || !code) return;
    const name = localStorage.getItem('playerName') || 'Player';
    emit('join-room', { roomCode: code, playerName: name }, (res: { success: boolean; room: Room; error?: string }) => {
      if (res.success) setRoom(res.room);
    });
    emit('get-playlists', {}, (res: { success: boolean; playlists: Playlist[] }) => {
      if (res.success) setPlaylists(res.playlists);
    });
  }, [isConnected, code, emit]);

  useEffect(() => {
    const offRoomUpdated = on('room-updated', (data: unknown) => { setRoom(data as Room); });
    const offSongList = on('song-list-updated', (data: unknown) => { setSongs((data as { songs: Song[] }).songs); });
    const offGameStart = on('round-started', () => { router.push(`/room/${code}/game`); });
    return () => { offRoomUpdated(); offSongList(); offGameStart(); };
  }, [on, code, router]);

  const handleAddSong = useCallback(() => {
    const vid = extractVideoId(youtubeUrl.trim());
    if (!vid) return setAddError('URL ไม่ถูกต้อง ลองใหม่อีกครั้ง');
    if (!songTitle.trim()) return setAddError('กรุณาใส่ชื่อเพลง');
    emit('add-song', {
      roomCode: code, videoId: vid, title: songTitle.trim(),
      artist: songArtist.trim() || 'Unknown',
      thumbnail: `https://img.youtube.com/vi/${vid}/mqdefault.jpg`,
    }, (res: { success: boolean; songs: Song[]; error?: string }) => {
      if (res.success) { setSongs(res.songs); setYoutubeUrl(''); setSongTitle(''); setSongArtist(''); setAddError(''); }
      else setAddError(res.error || 'เกิดข้อผิดพลาด');
    });
  }, [youtubeUrl, songTitle, songArtist, code, emit]);

  const handleRemoveSong = (index: number) => {
    emit('remove-song', { roomCode: code, index }, (res: { success: boolean; songs: Song[] }) => {
      if (res.success) setSongs(res.songs);
    });
  };

  const handleStart = () => {
    setLoading(true); setStartError('');
    emit('start-game', { roomCode: code }, (res: { success: boolean; error?: string }) => {
      setLoading(false);
      if (!res.success) setStartError(res.error || 'เริ่มเกมไม่ได้');
    });
  };

  // ─── Playlist handlers ──────────────────────────────
  const showMsg = (msg: string) => { setPlaylistMsg(msg); setTimeout(() => setPlaylistMsg(''), 3000); };

  const handleSavePlaylist = useCallback(() => {
    setPlaylistError('');
    if (!playlistName.trim()) return setPlaylistError('กรุณาใส่ชื่อ Playlist');
    emit('save-playlist', { roomCode: code, name: playlistName.trim(), createdBy: playerName },
      (res: { success: boolean; playlists?: Playlist[]; error?: string }) => {
        if (res.success) { setPlaylists(res.playlists || []); setPlaylistName(''); showMsg('✅ บันทึก Playlist แล้ว!'); }
        else setPlaylistError(res.error || 'เกิดข้อผิดพลาด');
      });
  }, [playlistName, code, playerName, emit]);

  const handleLoadPlaylist = useCallback((playlistId: string) => {
    emit('load-playlist', { roomCode: code, playlistId },
      (res: { success: boolean; songs?: Song[]; error?: string }) => {
        if (res.success) { setSongs(res.songs || []); showMsg('✅ โหลด Playlist แล้ว!'); }
        else setPlaylistError(res.error || 'เกิดข้อผิดพลาด');
      });
  }, [code, emit]);

  const handleDeletePlaylist = useCallback((playlistId: string) => {
    emit('delete-playlist', { playlistId },
      (res: { success: boolean; playlists?: Playlist[]; error?: string }) => {
        if (res.success) { setPlaylists(res.playlists || []); if (expandedPlaylistId === playlistId) setExpandedPlaylistId(null); }
        else setPlaylistError(res.error || 'เกิดข้อผิดพลาด');
      });
  }, [emit, expandedPlaylistId]);

  const handleRenamePlaylist = useCallback((playlistId: string) => {
    emit('rename-playlist', { playlistId, name: renameValue },
      (res: { success: boolean; playlists?: Playlist[]; error?: string }) => {
        if (res.success) { setPlaylists(res.playlists || []); setRenamingPlaylistId(null); showMsg('✅ เปลี่ยนชื่อแล้ว!'); }
        else setPlaylistError(res.error || 'เกิดข้อผิดพลาด');
      });
  }, [renameValue, emit]);

  const handleAddSongToPlaylist = useCallback((playlistId: string) => {
    const vid = extractVideoId(addToPlUrl.trim());
    if (!vid) return setAddToPlError('URL ไม่ถูกต้อง');
    if (!addToPlTitle.trim()) return setAddToPlError('กรุณาใส่ชื่อเพลง');
    emit('add-song-to-playlist', {
      playlistId,
      song: { videoId: vid, title: addToPlTitle.trim(), artist: addToPlArtist.trim() || 'Unknown', thumbnail: `https://img.youtube.com/vi/${vid}/mqdefault.jpg` },
    }, (res: { success: boolean; playlists?: Playlist[]; error?: string }) => {
      if (res.success) { setPlaylists(res.playlists || []); setAddToPlUrl(''); setAddToPlTitle(''); setAddToPlArtist(''); setAddToPlError(''); showMsg('✅ เพิ่มเพลงแล้ว!'); }
      else setAddToPlError(res.error || 'เกิดข้อผิดพลาด');
    });
  }, [addToPlUrl, addToPlTitle, addToPlArtist, emit]);

  const handleEditSongInPlaylist = useCallback((playlistId: string, songIndex: number) => {
    const vid = editSongUrl.trim() ? extractVideoId(editSongUrl.trim()) : undefined;
    emit('edit-song-in-playlist', {
      playlistId, songIndex,
      song: {
        ...(vid ? { videoId: vid, thumbnail: `https://img.youtube.com/vi/${vid}/mqdefault.jpg` } : {}),
        title: editSongTitle.trim() || undefined,
        artist: editSongArtist.trim() || undefined,
      },
    }, (res: { success: boolean; playlists?: Playlist[]; error?: string }) => {
      if (res.success) { setPlaylists(res.playlists || []); setEditingSongIdx(null); showMsg('✅ แก้ไขแล้ว!'); }
      else setPlaylistError(res.error || 'เกิดข้อผิดพลาด');
    });
  }, [editSongUrl, editSongTitle, editSongArtist, emit]);

  const handleRemoveSongFromPlaylist = useCallback((playlistId: string, songIndex: number) => {
    emit('remove-song-from-playlist', { playlistId, songIndex },
      (res: { success: boolean; playlists?: Playlist[]; error?: string }) => {
        if (res.success) { setPlaylists(res.playlists || []); showMsg('✅ ลบเพลงแล้ว!'); }
        else setPlaylistError(res.error || 'เกิดข้อผิดพลาด');
      });
  }, [emit]);

  const isHost = room ? socket?.id === room.hostId : false;
  const expandedPlaylist = playlists.find(p => p.id === expandedPlaylistId);

  // ─── Styles ──────────────────────────────────────────
  const smallBtn = (bg: string, border: string, color: string): React.CSSProperties => ({
    background: bg, border: `1px solid ${border}`, borderRadius: '7px', padding: '0.3rem 0.6rem',
    cursor: 'pointer', color, fontSize: '0.75rem', fontFamily: 'inherit', fontWeight: 700, whiteSpace: 'nowrap',
  });
  const inputSmall: React.CSSProperties = { fontSize: '0.8rem', padding: '0.35rem 0.5rem', borderRadius: '6px', border: '1px solid var(--border-subtle)', background: 'rgba(255,255,255,0.06)', color: 'var(--text-primary)', fontFamily: 'inherit', width: '100%' };

  return (
    <main style={{ minHeight: '100vh', padding: '2rem', position: 'relative', zIndex: 1, maxWidth: '900px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: '2rem' }} className="animate-slide-up">
        <h1 style={{ fontSize: '1.75rem', fontWeight: 800, margin: 0 }}>🏠 ล็อบบี้</h1>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Room Code:</span>
            <span style={{ fontSize: '1.75rem', fontWeight: 900, letterSpacing: '0.2em', background: 'var(--gradient-btn)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>{code}</span>
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
                <span style={{ fontSize: '1.1rem' }}>{p.id === room?.hostId ? '👑' : '🎮'}</span>
                <span style={{ fontWeight: 600, flex: 1, fontSize: '0.95rem' }}>{p.name}</span>
                {p.id === room?.hostId && <span className="badge badge-gold">Host</span>}
                {p.name === playerName && p.id !== room?.hostId && <span className="badge badge-purple">คุณ</span>}
              </div>
            ))}
          </div>
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

          {/* Add Song */}
          <div className="glass-card animate-slide-up" style={{ padding: '1.5rem', animationDelay: '0.1s' }}>
            <h2 style={{ margin: '0 0 1rem', fontSize: '1rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
              ➕ เพิ่มเพลงจาก YouTube
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <input id="youtube-url" className="input-field" placeholder="YouTube URL (ตัวอย่าง: https://youtu.be/...)" value={youtubeUrl} onChange={e => setYoutubeUrl(e.target.value)} />
              <input id="song-title" className="input-field" placeholder="ชื่อเพลง (สำหรับทาย)" value={songTitle} onChange={e => setSongTitle(e.target.value)} />
              <input id="song-artist" className="input-field" placeholder="ชื่ออนิเมะ / ภาค เช่น SAO Season 1 (จะแสดงในตัวเลือก)" value={songArtist} onChange={e => setSongArtist(e.target.value)} />
              {addError && <p style={{ color: '#fca5a5', fontSize: '0.8rem', margin: 0 }}>{addError}</p>}
              <button id="add-song-btn" className="btn-primary" onClick={handleAddSong}>✨ เพิ่มเพลง</button>
            </div>
          </div>

          {/* Song list */}
          <div className="glass-card animate-slide-up" style={{ padding: '1.5rem', animationDelay: '0.2s' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                🎵 เพลงในเกม ({songs.length})
              </h2>
              {isHost && songs.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input id="playlist-name-input" className="input-field" style={{ fontSize: '0.8rem', padding: '0.4rem 0.6rem', width: '130px' }}
                    placeholder="ชื่อ Playlist..." value={playlistName} onChange={e => setPlaylistName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSavePlaylist()} />
                  <button id="save-playlist-btn" onClick={handleSavePlaylist}
                    style={smallBtn('rgba(34,197,94,0.15)', 'rgba(34,197,94,0.4)', '#4ade80')}>
                    💾 บันทึก
                  </button>
                </div>
              )}
            </div>
            {playlistError && <p style={{ color: '#fca5a5', fontSize: '0.8rem', margin: '0 0 0.5rem' }}>{playlistError}</p>}
            {playlistMsg && <p style={{ color: '#4ade80', fontSize: '0.8rem', margin: '0 0 0.5rem' }}>{playlistMsg}</p>}
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
                    {isHost && <button className="btn-danger" onClick={() => handleRemoveSong(i)}>✕</button>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ─── Playlist Library ─────────────────────────────── */}
          <div className="glass-card animate-slide-up" style={{ padding: '1.5rem', animationDelay: '0.3s', border: '1px solid rgba(139,92,246,0.2)' }}>
            <button onClick={() => setShowLibrary(v => !v)}
              style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--text-secondary)', fontFamily: 'inherit', padding: 0 }}>
              <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>📚 คลังเพลง ({playlists.length})</h2>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{showLibrary ? '▲ ซ่อน' : '▼ แสดง'}</span>
            </button>

            {showLibrary && (
              <div style={{ marginTop: '1rem' }}>
                {playlists.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--text-muted)' }}>
                    <div style={{ fontSize: '1.75rem', marginBottom: '0.4rem' }}>📭</div>
                    <p style={{ margin: 0, fontSize: '0.875rem' }}>ยังไม่มี Playlist ที่บันทึกไว้</p>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', maxHeight: '500px', overflowY: 'auto' }}>
                    {playlists.map((pl) => {
                      const isExpanded = expandedPlaylistId === pl.id;
                      return (
                        <div key={pl.id} style={{ borderRadius: '10px', border: `1px solid ${isExpanded ? 'rgba(139,92,246,0.5)' : 'rgba(139,92,246,0.2)'}`, background: isExpanded ? 'rgba(139,92,246,0.1)' : 'rgba(139,92,246,0.04)', overflow: 'hidden' }}>
                          {/* Playlist header */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.7rem 0.75rem' }}>
                            <button onClick={() => { setExpandedPlaylistId(isExpanded ? null : pl.id); setEditingSongIdx(null); setAddToPlUrl(''); setAddToPlTitle(''); setAddToPlArtist(''); setAddToPlError(''); }}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.8rem', padding: 0, fontFamily: 'inherit' }}>
                              {isExpanded ? '▼' : '▶'}
                            </button>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              {renamingPlaylistId === pl.id ? (
                                <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                                  <input style={{ ...inputSmall, width: '140px' }} value={renameValue}
                                    onChange={e => setRenameValue(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && handleRenamePlaylist(pl.id)} autoFocus />
                                  <button onClick={() => handleRenamePlaylist(pl.id)} style={smallBtn('rgba(34,197,94,0.15)', 'rgba(34,197,94,0.4)', '#4ade80')}>✓</button>
                                  <button onClick={() => setRenamingPlaylistId(null)} style={smallBtn('rgba(255,255,255,0.06)', 'var(--border-subtle)', 'var(--text-muted)')}>✕</button>
                                </div>
                              ) : (
                                <>
                                  <div style={{ fontWeight: 700, fontSize: '0.88rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>🎼 {pl.name}</div>
                                  <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginTop: '0.1rem' }}>
                                    {pl.songs.length} เพลง · {pl.createdBy} · {new Date(pl.createdAt).toLocaleDateString('th-TH')}
                                  </div>
                                </>
                              )}
                            </div>
                            <div style={{ display: 'flex', gap: '0.35rem', flexShrink: 0 }}>
                              {isHost && (
                                <button onClick={() => handleLoadPlaylist(pl.id)} style={smallBtn('rgba(139,92,246,0.2)', 'rgba(139,92,246,0.4)', 'var(--purple-light)')}>▶ โหลด</button>
                              )}
                              {renamingPlaylistId !== pl.id && (
                                <button onClick={() => { setRenamingPlaylistId(pl.id); setRenameValue(pl.name); }} style={smallBtn('rgba(251,191,36,0.12)', 'rgba(251,191,36,0.3)', '#fbbf24')}>✏️</button>
                              )}
                              <button onClick={() => handleDeletePlaylist(pl.id)} style={smallBtn('rgba(239,68,68,0.12)', 'rgba(239,68,68,0.3)', '#f87171')}>🗑</button>
                            </div>
                          </div>

                          {/* Expanded: show songs */}
                          {isExpanded && (
                            <div style={{ borderTop: '1px solid rgba(139,92,246,0.15)', padding: '0.75rem' }}>
                              {pl.songs.length === 0 ? (
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', textAlign: 'center', margin: '0.5rem 0' }}>ไม่มีเพลงใน Playlist นี้</p>
                              ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '0.75rem' }}>
                                  {pl.songs.map((s, si) => (
                                    <div key={si}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0.5rem', background: 'rgba(255,255,255,0.04)', borderRadius: '8px', fontSize: '0.8rem' }}>
                                        {s.thumbnail && <img src={s.thumbnail} alt="" style={{ width: '36px', height: '27px', objectFit: 'cover', borderRadius: '4px' }} />}
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                          <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.title}</div>
                                          <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>{s.artist}</div>
                                        </div>
                                        <div style={{ display: 'flex', gap: '0.25rem', flexShrink: 0 }}>
                                          <button onClick={() => { setEditingSongIdx(editingSongIdx === si ? null : si); setEditSongTitle(s.title); setEditSongArtist(s.artist); setEditSongUrl(''); }}
                                            style={smallBtn('rgba(251,191,36,0.1)', 'rgba(251,191,36,0.25)', '#fbbf24')}>✏️</button>
                                          <button onClick={() => handleRemoveSongFromPlaylist(pl.id, si)}
                                            style={smallBtn('rgba(239,68,68,0.1)', 'rgba(239,68,68,0.25)', '#f87171')}>✕</button>
                                        </div>
                                      </div>
                                      {/* Edit song inline */}
                                      {editingSongIdx === si && (
                                        <div style={{ marginTop: '0.35rem', padding: '0.5rem', background: 'rgba(251,191,36,0.06)', borderRadius: '8px', border: '1px solid rgba(251,191,36,0.15)' }}>
                                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                            <input style={inputSmall} placeholder="YouTube URL (เว้นว่างถ้าไม่เปลี่ยน)" value={editSongUrl} onChange={e => setEditSongUrl(e.target.value)} />
                                            <input style={inputSmall} placeholder="ชื่อเพลง" value={editSongTitle} onChange={e => setEditSongTitle(e.target.value)} />
                                            <input style={inputSmall} placeholder="ชื่ออนิเมะ / ภาค" value={editSongArtist} onChange={e => setEditSongArtist(e.target.value)} />
                                            <div style={{ display: 'flex', gap: '0.35rem', justifyContent: 'flex-end' }}>
                                              <button onClick={() => setEditingSongIdx(null)} style={smallBtn('rgba(255,255,255,0.06)', 'var(--border-subtle)', 'var(--text-muted)')}>ยกเลิก</button>
                                              <button onClick={() => handleEditSongInPlaylist(pl.id, si)} style={smallBtn('rgba(34,197,94,0.15)', 'rgba(34,197,94,0.4)', '#4ade80')}>💾 บันทึก</button>
                                            </div>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}

                              {/* Add song to playlist */}
                              <div style={{ padding: '0.6rem', background: 'rgba(34,197,94,0.05)', borderRadius: '8px', border: '1px solid rgba(34,197,94,0.15)' }}>
                                <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>➕ เพิ่มเพลงเข้า Playlist</div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                  <input style={inputSmall} placeholder="YouTube URL" value={addToPlUrl} onChange={e => setAddToPlUrl(e.target.value)} />
                                  <input style={inputSmall} placeholder="ชื่อเพลง" value={addToPlTitle} onChange={e => setAddToPlTitle(e.target.value)} />
                                  <input style={inputSmall} placeholder="ชื่ออนิเมะ / ภาค" value={addToPlArtist} onChange={e => setAddToPlArtist(e.target.value)} />
                                  {addToPlError && <p style={{ color: '#fca5a5', fontSize: '0.75rem', margin: 0 }}>{addToPlError}</p>}
                                  <button onClick={() => handleAddSongToPlaylist(pl.id)}
                                    style={{ ...smallBtn('rgba(34,197,94,0.15)', 'rgba(34,197,94,0.4)', '#4ade80'), padding: '0.4rem 0.75rem', alignSelf: 'flex-end' }}>
                                    ✨ เพิ่มเพลง
                                  </button>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
