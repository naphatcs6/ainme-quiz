const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { Server } = require('socket.io');
const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');

// ─── Playlist persistence ───────────────────────────────────────────────────
const PLAYLISTS_FILE = path.join(__dirname, 'data', 'playlists.json');

function loadPlaylists() {
  try {
    const raw = fs.readFileSync(PLAYLISTS_FILE, 'utf8');
    return JSON.parse(raw).playlists || [];
  } catch {
    return [];
  }
}

function savePlaylists(playlists) {
  fs.mkdirSync(path.dirname(PLAYLISTS_FILE), { recursive: true });
  fs.writeFileSync(PLAYLISTS_FILE, JSON.stringify({ playlists }, null, 2), 'utf8');
}

const dev = process.env.NODE_ENV !== 'production';
// Disable Turbopack — it has Windows compatibility issues with reserved filenames (nul, con, etc.)
process.env.NEXT_PRIVATE_DISABLE_TURBOPACK = '1';
const app = next({ dev });
const handle = app.getRequestHandler();

// In-memory game state
const rooms = new Map();

function createRoom(hostId, hostName) {
  const code = Math.random().toString(36).substring(2, 8).toUpperCase();
  const room = {
    code,
    hostId,
    players: [{ id: hostId, name: hostName, score: 0, answered: false }],
    status: 'lobby', // lobby | playing | round-result | finished
    songs: [],
    currentRound: 0,
    totalRounds: 10,
    currentSong: null,
    roundTimer: null,
    roundDuration: 30, // seconds
    answers: [],
  };
  rooms.set(code, room);
  return room;
}

function getRoom(code) {
  return rooms.get(code);
}

function sanitizeRoom(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    players: room.players,
    status: room.status,
    currentRound: room.currentRound,
    totalRounds: room.totalRounds,
    totalSongs: room.songs.length,
    roundDuration: room.roundDuration,
  };
}

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  });

  const io = new Server(httpServer, {
    cors: { origin: '*' },
  });

  io.on('connection', (socket) => {
    console.log('[Socket] Connected:', socket.id);

    // Create a new room
    socket.on('create-room', ({ playerName, totalRounds, roundDuration }, callback) => {
      const room = createRoom(socket.id, playerName);
      room.totalRounds = totalRounds || 10;
      room.roundDuration = roundDuration || 30;
      socket.join(room.code);
      callback({ success: true, room: sanitizeRoom(room) });
      console.log(`[Room] Created: ${room.code} by ${playerName}`);
    });

    // Join an existing room
    socket.on('join-room', ({ roomCode, playerName }, callback) => {
      const room = getRoom(roomCode.toUpperCase());
      if (!room) return callback({ success: false, error: 'ไม่พบห้องนี้' });
      if (room.status !== 'lobby') return callback({ success: false, error: 'เกมเริ่มไปแล้ว' });

      // If socket already in room (page refresh), just return current state
      const existingPlayer = room.players.find((p) => p.id === socket.id);
      if (existingPlayer) {
        socket.join(roomCode.toUpperCase());
        return callback({ success: true, room: sanitizeRoom(room) });
      }

      // Check for duplicate name
      if (room.players.find((p) => p.name === playerName)) {
        playerName = playerName + '_' + Math.floor(Math.random() * 100);
      }

      room.players.push({ id: socket.id, name: playerName, score: 0, answered: false });
      socket.join(roomCode.toUpperCase());
      io.to(room.code).emit('room-updated', sanitizeRoom(room));
      callback({ success: true, room: sanitizeRoom(room) });
      console.log(`[Room] ${playerName} joined ${room.code}`);
    });

    // Host adds a song
    socket.on('add-song', ({ roomCode, videoId, title, artist, thumbnail }, callback) => {
      const room = getRoom(roomCode);
      if (!room) return callback({ success: false, error: 'ไม่พบห้อง' });
      if (room.hostId !== socket.id) return callback({ success: false, error: 'เฉพาะ host เท่านั้น' });

      const song = { videoId, title: title || 'Unknown', artist: artist || 'Unknown', thumbnail };
      room.songs.push(song);
      callback({ success: true, songs: room.songs });
      io.to(roomCode).emit('song-list-updated', { songs: room.songs });
    });

    // Host removes a song
    socket.on('remove-song', ({ roomCode, index }, callback) => {
      const room = getRoom(roomCode);
      if (!room || room.hostId !== socket.id) return;
      room.songs.splice(index, 1);
      callback({ success: true, songs: room.songs });
      io.to(roomCode).emit('song-list-updated', { songs: room.songs });
    });

    // Host starts the game
    socket.on('start-game', ({ roomCode }, callback) => {
      const room = getRoom(roomCode);
      if (!room) return callback({ success: false, error: 'ไม่พบห้อง' });
      if (room.hostId !== socket.id) return callback({ success: false, error: 'เฉพาะ host เท่านั้น' });
      if (room.songs.length === 0) return callback({ success: false, error: 'กรุณาเพิ่มเพลงก่อน' });

      // Shuffle songs and trim to totalRounds
      room.songs = room.songs.sort(() => Math.random() - 0.5).slice(0, room.totalRounds);
      room.totalRounds = room.songs.length;
      room.status = 'playing';
      room.currentRound = 0;
      room.players.forEach((p) => { p.score = 0; p.answered = false; });

      callback({ success: true });
      startRound(io, room);
    });

    // Player submits an answer
    socket.on('submit-answer', ({ roomCode, answer }) => {
      const room = getRoom(roomCode);
      if (!room || room.status !== 'playing') return;

      const player = room.players.find((p) => p.id === socket.id);
      if (!player || player.answered) return;

      player.answered = true;
      const song = room.songs[room.currentRound];
      // Exact match against the pre-generated correct choice label (multiple-choice mode)
      const correct = room._correctChoice ? answer === room._correctChoice : checkAnswer(answer, song.title, song.artist);
      const timeBonus = room._roundTimeLeft || 0;

      let pointsEarned = 0;
      if (correct) {
        const correctCount = room.players.filter((p) => p.answered && p._lastAnswerCorrect).length;
        // First correct gets more points
        pointsEarned = correct ? Math.max(100, 150 - correctCount * 20) + Math.floor(timeBonus * 2) : 0;
        player.score += pointsEarned;
        player._lastAnswerCorrect = true;
      } else {
        player._lastAnswerCorrect = false;
      }

      room.answers.push({ playerId: socket.id, playerName: player.name, answer, correct, pointsEarned });

      // Notify everyone of the answer result
      io.to(roomCode).emit('answer-result', {
        playerId: socket.id,
        playerName: player.name,
        correct,
        pointsEarned,
        players: room.players.map((p) => ({ id: p.id, name: p.name, score: p.score, answered: p.answered })),
      });

      // If all answered, end round early
      if (room.players.every((p) => p.answered)) {
        endRound(io, room);
      }
    });

    // Host manually ends the round
    socket.on('end-round', ({ roomCode }) => {
      const room = getRoom(roomCode);
      if (!room || room.hostId !== socket.id) return;
      endRound(io, room);
    });

    // Host goes to next round
    socket.on('next-round', ({ roomCode }) => {
      const room = getRoom(roomCode);
      if (!room || room.hostId !== socket.id) return;
      room.currentRound++;
      if (room.currentRound >= room.totalRounds) {
        endGame(io, room);
      } else {
        startRound(io, room);
      }
    });

    // Get current round state (called by game page on mount to catch missed round-started)
    socket.on('get-round-state', ({ roomCode }, callback) => {
      const room = getRoom(roomCode);
      if (!room) return callback({ success: false });
      if (room.status === 'playing' && room.currentSong) {
        socket.join(roomCode); // re-join the socket room if needed
        callback({
          success: true,
          status: 'playing',
          round: room.currentRound + 1,
          totalRounds: room.totalRounds,
          videoId: room.currentSong.videoId,
          duration: room.roundDuration,
          timeLeft: room._roundTimeLeft || 0,
          players: room.players.map((p) => ({ id: p.id, name: p.name, score: p.score, answered: p.answered })),
          hostId: room.hostId,
          choices: room._currentChoices || [],
        });
      } else if (room.status === 'round-result' && room.currentSong) {
        callback({
          success: true,
          status: 'round-result',
          song: { videoId: room.currentSong.videoId, title: room.currentSong.title, artist: room.currentSong.artist, thumbnail: room.currentSong.thumbnail },
          players: room.players.map((p) => ({ id: p.id, name: p.name, score: p.score, answered: p.answered, correct: p._lastAnswerCorrect })),
          isLastRound: room.currentRound + 1 >= room.totalRounds,
          hostId: room.hostId,
        });
      } else {
        callback({ success: false, status: room.status });
      }
    });

    // Host restarts game (back to lobby)
    socket.on('restart-game', ({ roomCode }) => {
      const room = getRoom(roomCode);
      if (!room || room.hostId !== socket.id) return;
      room.status = 'lobby';
      room.currentRound = 0;
      room.songs = [];
      room.answers = [];
      room.players.forEach((p) => { p.score = 0; p.answered = false; });
      io.to(roomCode).emit('game-restarted', sanitizeRoom(room));
    });

    // ─── Playlist events ─────────────────────────────────────────────────────

    // Get all playlists
    socket.on('get-playlists', (_, callback) => {
      callback({ success: true, playlists: loadPlaylists() });
    });

    // Save current room songs as a new playlist
    socket.on('save-playlist', ({ roomCode, name, createdBy }, callback) => {
      const room = getRoom(roomCode);
      if (!room) return callback({ success: false, error: 'ไม่พบห้อง' });
      if (room.hostId !== socket.id) return callback({ success: false, error: 'เฉพาะ Host เท่านั้น' });
      if (!name?.trim()) return callback({ success: false, error: 'กรุณาใส่ชื่อ Playlist' });
      if (room.songs.length === 0) return callback({ success: false, error: 'ไม่มีเพลงในห้อง' });

      const playlists = loadPlaylists();
      const newPlaylist = {
        id: randomUUID(),
        name: name.trim(),
        createdBy: createdBy || 'Unknown',
        createdAt: new Date().toISOString(),
        songs: room.songs.map(s => ({ videoId: s.videoId, title: s.title, artist: s.artist, thumbnail: s.thumbnail })),
      };
      playlists.push(newPlaylist);
      savePlaylists(playlists);
      callback({ success: true, playlist: newPlaylist, playlists });
    });

    // Load a playlist's songs into the current room (replaces existing songs)
    socket.on('load-playlist', ({ roomCode, playlistId }, callback) => {
      const room = getRoom(roomCode);
      if (!room) return callback({ success: false, error: 'ไม่พบห้อง' });
      if (room.hostId !== socket.id) return callback({ success: false, error: 'เฉพาะ Host เท่านั้น' });

      const playlists = loadPlaylists();
      const playlist = playlists.find(p => p.id === playlistId);
      if (!playlist) return callback({ success: false, error: 'ไม่พบ Playlist' });

      room.songs = [...playlist.songs];
      io.to(roomCode).emit('song-list-updated', { songs: room.songs });
      callback({ success: true, songs: room.songs });
    });

    // Delete a playlist
    socket.on('delete-playlist', ({ playlistId }, callback) => {
      const playlists = loadPlaylists();
      const idx = playlists.findIndex(p => p.id === playlistId);
      if (idx === -1) return callback({ success: false, error: 'ไม่พบ Playlist' });
      playlists.splice(idx, 1);
      savePlaylists(playlists);
      callback({ success: true, playlists });
    });

    // Rename a playlist
    socket.on('rename-playlist', ({ playlistId, name }, callback) => {
      if (!name?.trim()) return callback({ success: false, error: 'กรุณาใส่ชื่อ' });
      const playlists = loadPlaylists();
      const pl = playlists.find(p => p.id === playlistId);
      if (!pl) return callback({ success: false, error: 'ไม่พบ Playlist' });
      pl.name = name.trim();
      savePlaylists(playlists);
      callback({ success: true, playlists });
    });

    // Add a song to a saved playlist
    socket.on('add-song-to-playlist', ({ playlistId, song }, callback) => {
      if (!song?.videoId || !song?.title) return callback({ success: false, error: 'ข้อมูลเพลงไม่ครบ' });
      const playlists = loadPlaylists();
      const pl = playlists.find(p => p.id === playlistId);
      if (!pl) return callback({ success: false, error: 'ไม่พบ Playlist' });
      pl.songs.push({ videoId: song.videoId, title: song.title, artist: song.artist || 'Unknown', thumbnail: song.thumbnail || '' });
      savePlaylists(playlists);
      callback({ success: true, playlists });
    });

    // Edit a song within a saved playlist
    socket.on('edit-song-in-playlist', ({ playlistId, songIndex, song }, callback) => {
      const playlists = loadPlaylists();
      const pl = playlists.find(p => p.id === playlistId);
      if (!pl) return callback({ success: false, error: 'ไม่พบ Playlist' });
      if (songIndex < 0 || songIndex >= pl.songs.length) return callback({ success: false, error: 'ไม่พบเพลง' });
      pl.songs[songIndex] = { videoId: song.videoId || pl.songs[songIndex].videoId, title: song.title || pl.songs[songIndex].title, artist: song.artist ?? pl.songs[songIndex].artist, thumbnail: song.thumbnail ?? pl.songs[songIndex].thumbnail };
      savePlaylists(playlists);
      callback({ success: true, playlists });
    });

    // Remove a song from a saved playlist
    socket.on('remove-song-from-playlist', ({ playlistId, songIndex }, callback) => {
      const playlists = loadPlaylists();
      const pl = playlists.find(p => p.id === playlistId);
      if (!pl) return callback({ success: false, error: 'ไม่พบ Playlist' });
      if (songIndex < 0 || songIndex >= pl.songs.length) return callback({ success: false, error: 'ไม่พบเพลง' });
      pl.songs.splice(songIndex, 1);
      savePlaylists(playlists);
      callback({ success: true, playlists });
    });

    // Disconnect
    socket.on('disconnect', () => {
      console.log('[Socket] Disconnected:', socket.id);
      for (const [code, room] of rooms.entries()) {
        const playerIdx = room.players.findIndex((p) => p.id === socket.id);
        if (playerIdx !== -1) {
          const wasHost = room.hostId === socket.id;
          room.players.splice(playerIdx, 1);

          if (room.players.length === 0) {
            if (room.roundTimer) clearTimeout(room.roundTimer);
            rooms.delete(code);
          } else {
            if (wasHost) {
              room.hostId = room.players[0].id;
              io.to(code).emit('host-changed', { newHostId: room.hostId });
            }
            io.to(code).emit('room-updated', sanitizeRoom(room));
          }
        }
      }
    });
  });

  httpServer.listen(3000, () => {
    console.log('> Ready on http://localhost:3000');
  });
});

function checkAnswer(answer, title, artist) {
  const normalize = (str) =>
    str.toLowerCase()
      .replace(/[^\u0E00-\u0E7Fa-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  const a = normalize(answer);
  const t = normalize(title);
  const ar = normalize(artist || '');

  if (a === t || a === ar) return true;
  if (t.length > 4 && t.includes(a) && a.length >= t.length * 0.5) return true;
  return false;
}

function startRound(io, room) {
  if (room.roundTimer) clearTimeout(room.roundTimer);
  room.status = 'playing';
  room.answers = [];
  room.players.forEach((p) => { p.answered = false; p._lastAnswerCorrect = false; });

  const song = room.songs[room.currentRound];
  room.currentSong = song;
  room._roundStart = Date.now();
  room._roundTimeLeft = room.roundDuration;

  // Format a song as a choice label: "Title (Artist)" when artist is known
  const choiceLabel = (s) =>
    s.artist && s.artist !== 'Unknown' ? `${s.title} (${s.artist})` : s.title;

  // Generate 4 multiple-choice options: 1 correct + up to 3 distractors
  const distractors = room.songs
    .filter((_, i) => i !== room.currentRound)
    .sort(() => Math.random() - 0.5)
    .slice(0, 3)
    .map(s => choiceLabel(s));
  const correctLabel = choiceLabel(song);
  // De-duplicate in case a distractor label happens to match the correct one
  const uniqueDistractors = distractors.filter(d => d !== correctLabel);
  const choices = [correctLabel, ...uniqueDistractors].sort(() => Math.random() - 0.5);
  room._currentChoices = choices;
  room._correctChoice = correctLabel;

  io.to(room.code).emit('round-started', {
    round: room.currentRound + 1,
    totalRounds: room.totalRounds,
    videoId: song.videoId,
    duration: room.roundDuration,
    hostId: room.hostId,
    players: room.players.map((p) => ({ id: p.id, name: p.name, score: p.score, answered: false })),
    choices,
  });

  // Countdown tick
  let timeLeft = room.roundDuration;
  const tick = setInterval(() => {
    timeLeft--;
    room._roundTimeLeft = timeLeft;
    io.to(room.code).emit('timer-tick', { timeLeft });
    if (timeLeft <= 0) {
      clearInterval(tick);
    }
  }, 1000);

  room._tickInterval = tick;

  room.roundTimer = setTimeout(() => {
    endRound(io, room);
  }, room.roundDuration * 1000);
}

function endRound(io, room) {
  if (room.roundTimer) { clearTimeout(room.roundTimer); room.roundTimer = null; }
  if (room._tickInterval) { clearInterval(room._tickInterval); room._tickInterval = null; }

  room.status = 'round-result';
  const song = room.songs[room.currentRound];

  io.to(room.code).emit('round-ended', {
    song: { videoId: song.videoId, title: song.title, artist: song.artist, thumbnail: song.thumbnail },
    players: room.players.map((p) => ({ id: p.id, name: p.name, score: p.score, answered: p.answered, correct: p._lastAnswerCorrect })),
    answers: room.answers,
    isLastRound: room.currentRound + 1 >= room.totalRounds,
  });
}

function endGame(io, room) {
  if (room.roundTimer) clearTimeout(room.roundTimer);
  room.status = 'finished';
  const sorted = [...room.players].sort((a, b) => b.score - a.score);
  io.to(room.code).emit('game-over', { players: sorted });
}
