const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { Server } = require('socket.io');
const { randomUUID } = require('crypto');

const dev = process.env.NODE_ENV !== 'production';
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
      const correct = checkAnswer(answer, song.title, song.artist);
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

  io.to(room.code).emit('round-started', {
    round: room.currentRound + 1,
    totalRounds: room.totalRounds,
    videoId: song.videoId,
    duration: room.roundDuration,
    hostId: room.hostId,
    players: room.players.map((p) => ({ id: p.id, name: p.name, score: p.score, answered: false })),
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
