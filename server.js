const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  socket.on('create-room', (data) => {
    let code = generateRoomCode();
    while (rooms[code]) code = generateRoomCode();

    rooms[code] = {
      code,
      mode: data.mode,
      players: [{
        id: socket.id,
        name: data.playerName,
        rpsChoice: null,
        score: 0,
        balls: 0,
        currentChoice: null,
        isOut: false
      }],
      state: 'waiting',
      tossWinner: null,
      tossChoice: null,
      battingPlayer: null,
      bowlingPlayer: null,
      innings: 1,
      target: null,
      ballTimer: null,
      rpsTimer: null
    };

    socket.join(code);
    socket.roomCode = code;
    socket.emit('room-created', { code });
  });

  socket.on('join-room', (data) => {
    const room = rooms[data.code];
    if (!room) {
      socket.emit('join-error', { message: 'Room not found! Check the code and try again.' });
      return;
    }
    if (room.players.length >= 2) {
      socket.emit('join-error', { message: 'Room is full!' });
      return;
    }
    if (room.state !== 'waiting') {
      socket.emit('join-error', { message: 'Game already in progress!' });
      return;
    }

    room.players.push({
      id: socket.id,
      name: data.playerName,
      rpsChoice: null,
      score: 0,
      balls: 0,
      currentChoice: null,
      isOut: false
    });

    socket.join(data.code);
    socket.roomCode = data.code;
    room.state = 'rps';

    io.to(data.code).emit('game-start', {
      players: room.players.map(p => ({ id: p.id, name: p.name })),
      state: 'rps'
    });

    startRPSTimer(data.code);
  });

  function startRPSTimer(code) {
    const room = rooms[code];
    if (!room) return;

    let timeLeft = 10;
    io.to(code).emit('rps-timer', { time: timeLeft });

    room.rpsTimer = setInterval(() => {
      timeLeft--;
      io.to(code).emit('rps-timer', { time: timeLeft });

      if (timeLeft <= 0) {
        clearInterval(room.rpsTimer);
        room.rpsTimer = null;

        const p1 = room.players[0];
        const p2 = room.players[1];

        if (!p1.rpsChoice || !p2.rpsChoice) {
          io.to(code).emit('game-error', { message: 'Time ran out! A player did not make a choice.' });
          cleanupRoom(code);
          return;
        }

        resolveRPS(code);
      }
    }, 1000);
  }

  socket.on('rps-choice', (data) => {
    const room = rooms[socket.roomCode];
    if (!room || room.state !== 'rps') return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player || player.rpsChoice) return;

    player.rpsChoice = data.choice;

    const opponent = room.players.find(p => p.id !== socket.id);
    if (opponent) {
      io.to(opponent.id).emit('opponent-rps-locked', {});
    }

    if (room.players.every(p => p.rpsChoice)) {
      if (room.rpsTimer) {
        clearInterval(room.rpsTimer);
        room.rpsTimer = null;
      }
      setTimeout(() => resolveRPS(socket.roomCode), 500);
    }
  });

  function resolveRPS(code) {
    const room = rooms[code];
    if (!room) return;

    const p1 = room.players[0];
    const p2 = room.players[1];
    const beats = { rock: 'scissors', scissors: 'paper', paper: 'rock' };

    let winner;
    if (p1.rpsChoice === p2.rpsChoice) {
      p1.rpsChoice = null;
      p2.rpsChoice = null;

      io.to(code).emit('rps-draw', {
        choices: { [p1.id]: p1.rpsChoice, [p2.id]: p2.rpsChoice }
      });

      room.state = 'rps';
      setTimeout(() => startRPSTimer(code), 2000);
      return;
    }

    winner = beats[p1.rpsChoice] === p2.rpsChoice ? p1 : p2;
    room.tossWinner = winner.id;
    room.state = 'toss-choice';

    io.to(code).emit('rps-result', {
      choices: { [p1.id]: p1.rpsChoice, [p2.id]: p2.rpsChoice },
      winnerId: winner.id,
      winnerName: winner.name
    });
  }

  socket.on('toss-decision', (data) => {
    const room = rooms[socket.roomCode];
    if (!room || room.state !== 'toss-choice') return;
    if (socket.id !== room.tossWinner) return;

    room.tossChoice = data.choice;

    if (data.choice === 'bat') {
      room.battingPlayer = room.players.find(p => p.id === socket.id);
      room.bowlingPlayer = room.players.find(p => p.id !== socket.id);
    } else {
      room.bowlingPlayer = room.players.find(p => p.id === socket.id);
      room.battingPlayer = room.players.find(p => p.id !== socket.id);
    }

    room.state = 'playing';
    room.innings = 1;

    io.to(socket.roomCode).emit('innings-start', {
      innings: 1,
      battingId: room.battingPlayer.id,
      battingName: room.battingPlayer.name,
      bowlingId: room.bowlingPlayer.id,
      bowlingName: room.bowlingPlayer.name,
      target: null
    });

    startBallTimer(socket.roomCode);
  });

  function startBallTimer(code) {
    const room = rooms[code];
    if (!room) return;

    if (room.ballTimer) clearInterval(room.ballTimer);

    let timeLeft = 10;
    io.to(code).emit('ball-timer', { time: timeLeft });

    room.ballTimer = setInterval(() => {
      timeLeft--;
      io.to(code).emit('ball-timer', { time: timeLeft });

      if (timeLeft <= 0) {
        clearInterval(room.ballTimer);
        room.ballTimer = null;
        io.to(code).emit('game-error', { message: 'Time ran out! A player was too slow.' });
        cleanupRoom(code);
      }
    }, 1000);
  }

  socket.on('play-number', (data) => {
    const room = rooms[socket.roomCode];
    if (!room || room.state !== 'playing') return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    const num = parseInt(data.number);
    if (num < 1 || num > 6) return;

    player.currentChoice = num;

    const opponent = room.players.find(p => p.id !== socket.id);
    if (!opponent || !opponent.currentChoice) {
      io.to(opponent.id).emit('opponent-locked', {});
      return;
    }

    if (room.ballTimer) {
      clearInterval(room.ballTimer);
      room.ballTimer = null;
    }

    const batsman = room.battingPlayer;
    const bowler = room.bowlingPlayer;
    const batChoice = batsman.currentChoice;
    const bowlChoice = bowler.currentChoice;

    batsman.currentChoice = null;
    bowler.currentChoice = null;

    let isOut = batChoice === bowlChoice;
    let runs = isOut ? 0 : batChoice;

    const prevScore = batsman.score;
    if (!isOut) {
      batsman.score += runs;
      batsman.balls++;
    } else {
      batsman.balls++;
      batsman.isOut = true;
    }

    // Check milestones
    if (!isOut) {
      const milestones = [50, 100, 150, 200, 250, 300];
      for (const m of milestones) {
        if (prevScore < m && batsman.score >= m) {
          setTimeout(() => {
            io.to(socket.roomCode).emit('milestone', {
              playerId: batsman.id,
              playerName: batsman.name,
              milestone: m,
              score: batsman.score
            });
          }, 800);
          break;
        }
      }
    }

    if (room.innings === 2 && !isOut && batsman.score >= room.target) {
      io.to(socket.roomCode).emit('ball-result', {
        batChoice,
        bowlChoice,
        runs,
        isOut,
        score: batsman.score,
        balls: batsman.balls,
        battingId: batsman.id,
        bowlingId: bowler.id
      });

      setTimeout(() => {
        io.to(socket.roomCode).emit('match-over', {
          winnerId: batsman.id,
          winnerName: batsman.name,
          scores: {
            [room.players[0].id]: { name: room.players[0].name, score: room.players[0].score, balls: room.players[0].balls },
            [room.players[1].id]: { name: room.players[1].name, score: room.players[1].score, balls: room.players[1].balls }
          },
          message: `${batsman.name} wins by ${2 - 0} wickets!`
        });
        cleanupRoom(socket.roomCode);
      }, 2000);
      return;
    }

    io.to(socket.roomCode).emit('ball-result', {
      batChoice,
      bowlChoice,
      runs,
      isOut,
      score: batsman.score,
      balls: batsman.balls,
      battingId: batsman.id,
      bowlingId: bowler.id
    });

    if (isOut) {
      if (room.innings === 1) {
        room.target = batsman.score + 1;
        room.innings = 2;

        const temp = room.battingPlayer;
        room.battingPlayer = room.bowlingPlayer;
        room.bowlingPlayer = temp;
        room.battingPlayer.score = 0;
        room.battingPlayer.balls = 0;
        room.battingPlayer.isOut = false;
        room.battingPlayer.currentChoice = null;
        room.bowlingPlayer.currentChoice = null;

        setTimeout(() => {
          io.to(socket.roomCode).emit('innings-change', {
            innings: 2,
            target: room.target,
            battingId: room.battingPlayer.id,
            battingName: room.battingPlayer.name,
            bowlingId: room.bowlingPlayer.id,
            bowlingName: room.bowlingPlayer.name
          });
        }, 3000);

        setTimeout(() => {
          if (rooms[socket.roomCode]) startBallTimer(socket.roomCode);
        }, 7000);
        return;
      } else {
        const winner = room.bowlingPlayer;
        const diff = room.target - batsman.score - 1;
        setTimeout(() => {
          io.to(socket.roomCode).emit('match-over', {
            winnerId: winner.id,
            winnerName: winner.name,
            scores: {
              [room.players[0].id]: { name: room.players[0].name, score: room.players[0].score, balls: room.players[0].balls },
              [room.players[1].id]: { name: room.players[1].name, score: room.players[1].score, balls: room.players[1].balls }
            },
            message: `${winner.name} wins by ${diff} runs!`
          });
          cleanupRoom(socket.roomCode);
        }, 2000);
        return;
      }
    }

    setTimeout(() => startBallTimer(socket.roomCode), 1500);
  });

  function cleanupRoom(code) {
    const room = rooms[code];
    if (!room) return;
    if (room.ballTimer) clearInterval(room.ballTimer);
    if (room.rpsTimer) clearInterval(room.rpsTimer);
    delete rooms[code];
  }

  socket.on('chat-message', (data) => {
    const room = rooms[socket.roomCode];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    const msg = (data.message || '').trim().slice(0, 100);
    if (!msg) return;
    io.to(socket.roomCode).emit('chat-message', {
      senderId: socket.id,
      senderName: player.name,
      message: msg,
      timestamp: Date.now()
    });
  });

  socket.on('reaction', (data) => {
    const room = rooms[socket.roomCode];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    const allowed = ['😂','🔥','👏','😢','😤','🎉','💪','👀','🤯','❤️'];
    if (!allowed.includes(data.emoji)) return;
    io.to(socket.roomCode).emit('reaction', {
      senderId: socket.id,
      senderName: player.name,
      emoji: data.emoji
    });
  });

  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
    const code = socket.roomCode;
    if (!code || !rooms[code]) return;

    const room = rooms[code];
    const remaining = room.players.find(p => p.id !== socket.id);

    if (remaining && room.state !== 'waiting') {
      io.to(remaining.id).emit('game-error', { message: 'Your opponent disconnected!' });
    }
    cleanupRoom(code);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Hand Cricket Ultimate running on port ${PORT}`);
});
