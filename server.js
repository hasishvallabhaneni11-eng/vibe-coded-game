const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

// ---- Firebase Admin SDK ----
initializeApp({
  projectId: 'hand-cricket-ultimate'
});
const adminAuth = getAuth();
const firestore = getFirestore();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 60000,
  pingInterval: 25000,
  transports: ['websocket', 'polling']
});

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

// Map userId -> socketId for single-device enforcement
const userSessions = {};

// ---- Socket auth middleware ----
io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token;
  if (token) {
    try {
      const decoded = await adminAuth.verifyIdToken(token);
      socket.userId = decoded.uid;
      socket.userEmail = decoded.email || null;
      socket.userDisplayName = decoded.name || 'Player';
    } catch (err) {
      console.log('Auth token verification failed:', err.message);
      socket.userId = 'guest_' + socket.id;
    }
  } else {
    socket.userId = 'guest_' + socket.id;
  }
  next();
});

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function teamMemberCount(room, team) {
  return room.players.filter(p => p.team === team).length;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

const RUN_PHRASES = {
  1: ['nudges it for a quick single', 'taps it away and takes one', 'works it around for a single', 'eases it for a single'],
  2: ['picks up a brisk two', 'finds the gap for a couple', 'good running there, two taken'],
  3: ['sprints through for three', 'three runs added with smart running', 'digs out three hard-earned runs'],
  4: ['cracks it away — FOUR!', 'finds the boundary — FOUR runs!', 'timed to perfection, FOUR!', 'races away for FOUR!'],
  5: ['five runs — rare but rewarding!', 'pushes hard and gets five!', 'five on the board, brilliant effort!'],
  6: ['SIX! That has sailed miles away!', 'MASSIVE! Out of the ground for SIX!', 'SIX! Into the crowd, what a hit!', 'SIX! Absolutely launched!']
};

const OUT_PHRASES = [
  (b, bo) => `${bo} matches the number — ${b} has to walk back!`,
  (b, bo) => `Clash! ${b} and ${bo} pick the same number — OUT!`,
  (b, bo) => `${bo} strikes! ${b} is dismissed!`,
  (b, bo) => `Gone! ${b} couldn't get away that time!`,
  (b, bo) => `Big moment! ${bo} reads it perfectly and ${b} is out!`
];

function runCommentary(batsmanName, runs) {
  return `🏏 ${batsmanName} ${pick(RUN_PHRASES[runs] || RUN_PHRASES[1])}`;
}

function outCommentary(batsmanName, bowlerName) {
  return `🎯 ${pick(OUT_PHRASES)(batsmanName, bowlerName)}`;
}

function teamAddCommentary(code, text) {
  const room = rooms[code];
  if (!room) return;
  room.commentary.push(text);
  if (room.commentary.length > 50) room.commentary.shift();
  io.to(code).emit('team-commentary', { text });
}

function teamBroadcastState(code) {
  const room = rooms[code];
  if (!room) return;

  io.to(code).emit('team-state', {
    phase: room.phase,
    hostId: room.hostId,
    players: room.players.map(p => ({
      id: p.id, name: p.name, team: p.team, isCaptain: p.isCaptain,
      score: p.score, balls: p.balls, isOut: p.isOut,
      ballsBowled: p.ballsBowled, runsConceded: p.runsConceded, wicketsTaken: p.wicketsTaken
    })),
    unassigned: room.unassigned.map(id => {
      const p = room.players.find(x => x.id === id);
      return { id, name: p ? p.name : '???' };
    }),
    captains: room.captains,
    draftTurn: room.draftTurn,
    battingTeam: room.battingTeam,
    bowlingTeam: room.bowlingTeam,
    innings: room.innings,
    target: room.target,
    teamScores: room.teamScores,
    currentBatsmanId: room.currentBatsmanId,
    currentBowlerId: room.currentBowlerId,
    lastBowlerId: room.lastBowlerId,
    ballsInOver: room.ballsInOver,
    overNumber: room.overNumber,
    tossWinnerTeam: room.tossWinnerTeam || null
  });
}

function teamStartToss(code, type, p1, p2) {
  const room = rooms[code];
  if (!room) return;

  room.toss = { type, p1, p2, choices: {}, timer: null };
  room.phase = type === 'draft' ? 'draft-toss' : 'match-toss';

  const p1Player = room.players.find(p => p.id === p1);
  const p2Player = room.players.find(p => p.id === p2);

  io.to(code).emit('team-toss-start', {
    type,
    p1: { id: p1, name: p1Player.name, team: p1Player.team },
    p2: { id: p2, name: p2Player.name, team: p2Player.team }
  });

  let timeLeft = 10;
  io.to(code).emit('team-toss-timer', { time: timeLeft });

  room.toss.timer = setInterval(() => {
    timeLeft--;
    io.to(code).emit('team-toss-timer', { time: timeLeft });

    if (timeLeft <= 0) {
      clearInterval(room.toss.timer);
      room.toss.timer = null;

      const choices = ['rock', 'paper', 'scissors'];
      const t = room.toss;
      if (!t.choices[t.p1]) t.choices[t.p1] = choices[Math.floor(Math.random() * 3)];
      if (!t.choices[t.p2]) t.choices[t.p2] = choices[Math.floor(Math.random() * 3)];
      teamResolveToss(code);
    }
  }, 1000);

  teamBroadcastState(code);
}

function teamResolveToss(code) {
  const room = rooms[code];
  if (!room || !room.toss) return;

  const t = room.toss;
  const beats = { rock: 'scissors', scissors: 'paper', paper: 'rock' };
  const c1 = t.choices[t.p1];
  const c2 = t.choices[t.p2];

  if (c1 === c2) {
    io.to(code).emit('team-toss-draw', {});
    setTimeout(() => teamStartToss(code, t.type, t.p1, t.p2), 2000);
    return;
  }

  const winnerId = beats[c1] === c2 ? t.p1 : t.p2;
  const p1Player = room.players.find(p => p.id === t.p1);
  const p2Player = room.players.find(p => p.id === t.p2);
  const winner = room.players.find(p => p.id === winnerId);

  io.to(code).emit('team-toss-result', {
    type: t.type,
    choices: { [t.p1]: c1, [t.p2]: c2 },
    p1: { id: t.p1, name: p1Player.name },
    p2: { id: t.p2, name: p2Player.name },
    winnerId,
    winnerName: winner.name,
    winnerTeam: winner.team
  });

  if (t.type === 'draft') {
    room.draftTurn = winner.team;
    teamAddCommentary(code, `${winner.name} won the toss! Team ${winner.team} picks first.`);
    room.toss = null;
    setTimeout(() => {
      room.phase = 'draft';
      teamBroadcastState(code);
    }, 2800);
  } else {
    room.tossWinnerTeam = winner.team;
    teamAddCommentary(code, `${winner.name} won the toss!`);
    room.toss = null;
    setTimeout(() => {
      room.phase = 'toss-choice';
      teamBroadcastState(code);
    }, 2800);
  }
}

function teamStartBallTimer(code) {
  const room = rooms[code];
  if (!room) return;

  if (room.ballTimer) clearInterval(room.ballTimer);

  let timeLeft = 12;
  io.to(code).emit('team-ball-timer', { time: timeLeft });

  // Trigger bot auto-play if bot is batting or bowling
  if (room.hasBot) teamBotAutoPlay(code);

  room.ballTimer = setInterval(() => {
    timeLeft--;
    io.to(code).emit('team-ball-timer', { time: timeLeft });

    if (timeLeft <= 0) {
      clearInterval(room.ballTimer);
      room.ballTimer = null;

      const batsman = room.players.find(p => p.id === room.currentBatsmanId);
      const bowler = room.players.find(p => p.id === room.currentBowlerId);
      if (batsman && !batsman.currentChoice) batsman.currentChoice = Math.floor(Math.random() * 6) + 1;
      if (bowler && !bowler.currentChoice) bowler.currentChoice = Math.floor(Math.random() * 6) + 1;

      teamResolveBall(code);
    }
  }, 1000);
}

function teamBuildBallPayload(room, batsman, bowler, batChoice, bowlChoice, runs, isOut) {
  return {
    batsmanId: batsman.id, batsmanName: batsman.name,
    bowlerId: bowler.id, bowlerName: bowler.name,
    batChoice, bowlChoice, runs, isOut,
    batsmanScore: batsman.score, batsmanBalls: batsman.balls,
    teamScores: room.teamScores,
    ballsInOver: room.ballsInOver, overNumber: room.overNumber,
    innings: room.innings, target: room.target,
    battingTeam: room.battingTeam, bowlingTeam: room.bowlingTeam
  };
}

function teamResolveBall(code) {
  const room = rooms[code];
  if (!room) return;

  if (room.ballTimer) { clearInterval(room.ballTimer); room.ballTimer = null; }

  const batsman = room.players.find(p => p.id === room.currentBatsmanId);
  const bowler = room.players.find(p => p.id === room.currentBowlerId);
  if (!batsman || !bowler) return;

  const batChoice = batsman.currentChoice;
  const bowlChoice = bowler.currentChoice;
  batsman.currentChoice = null;
  bowler.currentChoice = null;

  const isOut = batChoice === bowlChoice;
  const battingTeam = room.battingTeam;
  const ts = room.teamScores[battingTeam];
  const prevTeamScore = ts.runs;
  let runs = 0;

  batsman.balls++;
  room.ballsInOver++;
  bowler.ballsBowled++;

  if (isOut) {
    batsman.isOut = true;
    ts.wickets++;
    bowler.wicketsTaken++;
    teamAddCommentary(code, `${outCommentary(batsman.name, bowler.name)} Team ${battingTeam} ${ts.runs}/${ts.wickets}`);
  } else {
    runs = batChoice;
    const prevBatsmanScore = batsman.score;
    batsman.score += runs;
    ts.runs += runs;
    bowler.runsConceded += runs;
    teamAddCommentary(code, `${runCommentary(batsman.name, runs)} • Team ${battingTeam} ${ts.runs}/${ts.wickets}`);

    // Individual batsman milestone (50, 100, 150, ...) — like a real "fifty"/"century"
    const playerMilestones = [50, 100, 150, 200, 250, 300];
    for (const m of playerMilestones) {
      if (prevBatsmanScore < m && batsman.score >= m) {
        setTimeout(() => {
          io.to(code).emit('milestone', {
            playerId: batsman.id, playerName: batsman.name,
            milestone: m, score: batsman.score
          });
        }, 800);
        break;
      }
    }

    // Team milestone — only celebrated from 100 onward, not every 50
    const teamMilestones = [100, 150, 200, 250, 300];
    for (const m of teamMilestones) {
      if (prevTeamScore < m && ts.runs >= m) {
        setTimeout(() => {
          io.to(code).emit('milestone', {
            playerId: null, playerName: `Team ${battingTeam}`,
            milestone: m, score: ts.runs
          });
        }, 1500);
        break;
      }
    }
  }

  if (room.innings === 2 && !isOut && ts.runs >= room.target) {
    io.to(code).emit('team-ball-result', teamBuildBallPayload(room, batsman, bowler, batChoice, bowlChoice, runs, isOut));
    setTimeout(() => teamFinishMatch(code, battingTeam, null), 1800);
    return;
  }

  const allOut = ts.wickets >= teamMemberCount(room, battingTeam);
  const overComplete = room.ballsInOver >= 6;

  io.to(code).emit('team-ball-result', teamBuildBallPayload(room, batsman, bowler, batChoice, bowlChoice, runs, isOut));

  if (isOut && allOut) {
    if (room.innings === 1) {
      room.target = ts.runs + 1;
      room.innings = 2;
      room.battingTeam = room.bowlingTeam;
      room.bowlingTeam = battingTeam;
      room.currentBatsmanId = null;
      room.currentBowlerId = null;
      room.lastBowlerId = null;
      room.ballsInOver = 0;
      room.overNumber = 1;
      room.players.forEach(p => {
        if (p.team === room.battingTeam) { p.score = 0; p.balls = 0; p.isOut = false; }
        if (p.team === room.bowlingTeam) { p.ballsBowled = 0; p.runsConceded = 0; p.wicketsTaken = 0; }
      });
      teamAddCommentary(code, `🚩 Innings break! Team ${room.battingTeam} need ${room.target} runs to win.`);

      setTimeout(() => {
        io.to(code).emit('team-innings-change', {
          innings: 2, target: room.target,
          battingTeam: room.battingTeam, bowlingTeam: room.bowlingTeam
        });
        room.phase = 'select-bowler';
        teamBroadcastState(code);
      }, 3000);
    } else {
      const diff = room.target - ts.runs - 1;
      teamFinishMatch(code, room.bowlingTeam, diff);
    }
    return;
  }

  if (isOut) {
    if (overComplete) {
      room.lastBowlerId = room.currentBowlerId;
      room.currentBowlerId = null;
      room.ballsInOver = 0;
      room.overNumber++;
    }
    room.currentBatsmanId = null;
    setTimeout(() => {
      room.phase = 'select-batsman';
      teamBroadcastState(code);
    }, 1500);
    return;
  }

  if (overComplete) {
    room.lastBowlerId = room.currentBowlerId;
    room.currentBowlerId = null;
    room.ballsInOver = 0;
    room.overNumber++;
    teamAddCommentary(code, `🔚 End of over ${room.overNumber - 1} — Team ${battingTeam} ${ts.runs}/${ts.wickets}`);
    setTimeout(() => {
      room.phase = 'select-bowler';
      teamBroadcastState(code);
    }, 1500);
    return;
  }

  setTimeout(() => {
    teamBroadcastState(code);
    teamStartBallTimer(code);
  }, 1500);
}

function teamFinishMatch(code, winningTeam, runDiff) {
  const room = rooms[code];
  if (!room) return;
  room.phase = 'finished';

  let message;
  let finalWinningTeam = winningTeam;
  
  if (runDiff === 0) {
    finalWinningTeam = null;
    message = "Match Tied!";
  } else if (runDiff === null) {
    const wicketsLeft = teamMemberCount(room, winningTeam) - room.teamScores[winningTeam].wickets;
    message = `🏆 Team ${winningTeam} wins by ${wicketsLeft} wicket${wicketsLeft === 1 ? '' : 's'}!`;
  } else {
    message = `🏆 Team ${winningTeam} wins by ${runDiff} run${runDiff === 1 ? '' : 's'}!`;
  }

  teamAddCommentary(code, message);

  setTimeout(() => {
    io.to(code).emit('team-match-over', {
      winningTeam: finalWinningTeam,
      message,
      teamScores: room.teamScores,
      players: room.players.map(p => ({
        id: p.id, name: p.name, team: p.team, isCaptain: p.isCaptain,
        score: p.score, balls: p.balls, isOut: p.isOut,
        ballsBowled: p.ballsBowled, runsConceded: p.runsConceded, wicketsTaken: p.wicketsTaken
      })),
      scorecardData: {
        mode: 'team',
        players: room.players.map(p => ({
          id: p.id, name: p.name, team: p.team, isCaptain: p.isCaptain,
          score: p.score, balls: p.balls, isOut: p.isOut,
          ballsBowled: p.ballsBowled, runsConceded: p.runsConceded, wicketsTaken: p.wicketsTaken
        })),
        battingTeam: room.battingTeam,
        bowlingTeam: room.bowlingTeam,
        innings: room.innings,
        target: room.target,
        teamScores: room.teamScores
      }
    });
    teamCleanupRoom(code);
  }, 1800);
}

function teamCleanupRoom(code) {
  const room = rooms[code];
  if (!room) return;
  
  io.to(code).emit('scorecard-data', {
    mode: 'team',
    players: room.players.map(p => ({
      id: p.id, name: p.name, team: p.team, isCaptain: p.isCaptain,
      score: p.score, balls: p.balls, isOut: p.isOut,
      ballsBowled: p.ballsBowled, runsConceded: p.runsConceded, wicketsTaken: p.wicketsTaken
    })),
    battingTeam: room.battingTeam,
    bowlingTeam: room.bowlingTeam,
    innings: room.innings,
    target: room.target,
    teamScores: room.teamScores
  });

  if (room.ballTimer) clearInterval(room.ballTimer);
  if (room.toss && room.toss.timer) clearInterval(room.toss.timer);
  if (room.lobbyTimerInterval) clearInterval(room.lobbyTimerInterval);

  // Keep room alive for play-again instead of deleting
  room.phase = 'finished';
  room.teamRematchAccepted = {};
  room.teamRematchTimer = null;

  // Send hostId so client knows who can start play-again
  io.to(code).emit('team-match-finished', { hostId: room.hostId });

  // Auto-cleanup after 120s if no play-again
  room.teamRematchTimeout = setTimeout(() => {
    if (rooms[code] && rooms[code].phase === 'finished') {
      delete rooms[code];
    }
  }, 120000);
}

function teamDestroyRoom(code) {
  const room = rooms[code];
  if (!room) return;
  if (room.ballTimer) clearInterval(room.ballTimer);
  if (room.toss && room.toss.timer) clearInterval(room.toss.timer);
  if (room.lobbyTimerInterval) clearInterval(room.lobbyTimerInterval);
  if (room.teamRematchTimeout) clearTimeout(room.teamRematchTimeout);
  if (room.teamRematchTimer) clearTimeout(room.teamRematchTimer);
  delete rooms[code];
}

// ---- Team rematch: reset room for a new game ----
function resetTeamRoomForRematch(code, allAccepted) {
  const room = rooms[code];
  if (!room) return;

  if (room.teamRematchTimeout) clearTimeout(room.teamRematchTimeout);
  if (room.teamRematchTimer) clearTimeout(room.teamRematchTimer);

  // Remove bot if present
  room.players = room.players.filter(p => !p.isBot);
  room.hasBot = false;

  // Reset all player stats
  room.players.forEach(p => {
    p.score = 0;
    p.balls = 0;
    p.currentChoice = null;
    p.isOut = false;
    p.ballsBowled = 0;
    p.runsConceded = 0;
    p.wicketsTaken = 0;
  });

  // Reset room state
  room.toss = null;
  room.tossWinnerTeam = null;
  room.battingTeam = null;
  room.bowlingTeam = null;
  room.innings = 1;
  room.target = null;
  room.teamScores = { A: { runs: 0, wickets: 0 }, B: { runs: 0, wickets: 0 } };
  room.currentBatsmanId = null;
  room.currentBowlerId = null;
  room.lastBowlerId = null;
  room.ballsInOver = 0;
  room.overNumber = 1;
  room.ballTimer = null;
  room.commentary = [];
  room.teamRematchAccepted = {};
  room.draftTurn = null;

  if (allAccepted) {
    // All accepted — teams stay, go to match toss (with bot check)
    const botAdded = teamAssignBotIfNeeded(code);
    const delay = botAdded ? 4500 : 0;
    setTimeout(() => {
      if (!rooms[code]) return;
      room.phase = 'match-toss';
      teamStartToss(code, 'match', room.captains.A, room.captains.B);
    }, delay);
    io.to(code).emit('team-rematch-starting', {});
  } else {
    // Some left — go back to lobby for re-draft
    room.phase = 'lobby';
    // Reset teams
    room.players.forEach(p => {
      if (!p.isCaptain) p.team = null;
    });
    room.unassigned = room.players.filter(p => !p.isCaptain).map(p => p.id);
    io.to(code).emit('team-rematch-lobby', {});
    teamBroadcastState(code);
  }
}

// ---- Team rematch: timer expired ----
function teamRematchTimerExpire(code) {
  const room = rooms[code];
  if (!room || room.phase !== 'finished') return;

  const humanPlayers = room.players.filter(p => !p.isBot);
  const allAccepted = humanPlayers.every(p => room.teamRematchAccepted[p.id]);

  if (allAccepted) {
    resetTeamRoomForRematch(code, true);
    return;
  }

  // Remove players who didn't accept
  const nonAccepted = humanPlayers.filter(p => !room.teamRematchAccepted[p.id]);
  nonAccepted.forEach(p => {
    io.to(p.id).emit('team-rematch-kicked', { reason: 'You did not accept in time.' });
    const sock = io.sockets.sockets.get(p.id);
    if (sock) {
      sock.leave(code);
      sock.roomCode = null;
    }
  });
  room.players = room.players.filter(p => room.teamRematchAccepted[p.id] || p.isBot);

  // Reassign captains if needed
  ['A', 'B'].forEach(team => {
    const captainId = room.captains[team];
    if (!room.players.find(p => p.id === captainId)) {
      const teammates = room.players.filter(p => p.team === team && !p.isBot);
      if (teammates.length > 0) {
        const newCap = teammates[Math.floor(Math.random() * teammates.length)];
        newCap.isCaptain = true;
        room.captains[team] = newCap.id;
        teamAddCommentary(code, `👑 ${newCap.name} is now Team ${team}'s captain.`);
      }
    }
  });

  // Update hostId if host was removed
  if (!room.players.find(p => p.id === room.hostId)) {
    const newHost = room.players.find(p => !p.isBot);
    if (newHost) room.hostId = newHost.id;
  }

  // Check if enough players remain (need at least 2 non-bot)
  const remaining = room.players.filter(p => !p.isBot);
  if (remaining.length < 2) {
    io.to(code).emit('team-game-error', { message: 'Not enough players to continue.' });
    teamDestroyRoom(code);
    return;
  }

  resetTeamRoomForRematch(code, false);
}

function teamHandleDisconnect(code, playerId) {
  const room = rooms[code];
  if (!room) return;
  const player = room.players.find(p => p.id === playerId);
  if (!player) return;

  if (room.phase === 'lobby') {
    room.players = room.players.filter(p => p.id !== playerId);
    room.unassigned = room.unassigned.filter(id => id !== playerId);

    if (room.players.length === 0) { teamCleanupRoom(code); return; }

    if (player.isCaptain) {
      const team = player.team;
      let replacement = room.players.find(p => p.team === team);
      if (!replacement && room.unassigned.length) {
        const id = room.unassigned.shift();
        replacement = room.players.find(p => p.id === id);
        if (replacement) replacement.team = team;
      }
      if (replacement) {
        replacement.isCaptain = true;
        room.captains[team] = replacement.id;
      } else {
        room.captains[team] = null;
      }
    }

    if (room.hostId === playerId) {
      room.hostId = room.captains.A || room.captains.B || (room.players[0] ? room.players[0].id : null);
    }

    teamAddCommentary(code, `${player.name} left the lobby.`);
    teamBroadcastState(code);
    return;
  }

  // Handle disconnect during play-again vote
  if (room.phase === 'finished') {
    room.players = room.players.filter(p => p.id !== playerId);
    if (player.isCaptain && player.team) {
      const teammates = room.players.filter(p => p.team === player.team && !p.isBot);
      if (teammates.length > 0) {
        const newCap = teammates[Math.floor(Math.random() * teammates.length)];
        newCap.isCaptain = true;
        room.captains[player.team] = newCap.id;
      }
    }
    if (room.hostId === playerId) {
      const newHost = room.players.find(p => !p.isBot);
      if (newHost) room.hostId = newHost.id;
    }
    const remaining = room.players.filter(p => !p.isBot);
    if (remaining.length < 2) {
      teamDestroyRoom(code);
      return;
    }
    // Check if all remaining accepted
    const humanPlayers = room.players.filter(p => !p.isBot);
    const allAccepted = humanPlayers.every(p => room.teamRematchAccepted && room.teamRematchAccepted[p.id]);
    if (allAccepted && room.teamRematchTimer) {
      clearTimeout(room.teamRematchTimer);
      room.teamRematchTimer = null;
      resetTeamRoomForRematch(code, true);
    }
    return;
  }

  if (room.toss && room.toss.timer) clearInterval(room.toss.timer);
  io.to(code).emit('team-game-error', { message: `${player.name} disconnected. Match ended.` });
  teamDestroyRoom(code);
}

// ---- Bot: Check if teams are unequal and assign bot ----
// Returns true if bot was added (so callers can add delay)
function teamAssignBotIfNeeded(code) {
  const room = rooms[code];
  if (!room) return false;

  const teamA = room.players.filter(p => p.team === 'A');
  const teamB = room.players.filter(p => p.team === 'B');

  if (teamA.length === teamB.length) return false; // Equal teams, no bot needed

  const smallerTeam = teamA.length < teamB.length ? 'A' : 'B';

  // Create bot player
  const bot = {
    id: 'bot_ultimate',
    name: 'The Ultimate Bot',
    isBot: true,
    team: smallerTeam,
    isCaptain: false,
    score: 0,
    balls: 0,
    wicketsTaken: 0,
    isOut: false,
    currentChoice: null,
    ballsBowled: 0,
    runsConceded: 0
  };

  room.players.push(bot);
  room.hasBot = true;

  teamAddCommentary(code, `🤖 The Ultimate Bot joins Team ${smallerTeam}!`);
  // Delay the announcement so it doesn't overlap with draft UI
  setTimeout(() => {
    if (!rooms[code]) return;
    io.to(code).emit('team-bot-assigned', { team: smallerTeam, botName: 'The Ultimate Bot' });
    teamBroadcastState(code);
  }, 1500);
  return true;
}

// ---- Bot: Auto-play logic with weighted random ----
function teamBotAutoPlay(code) {
  const room = rooms[code];
  if (!room || !room.hasBot) return;

  const botPlayer = room.players.find(p => p.id === 'bot_ultimate');
  if (!botPlayer) return;

  const isBatting = room.currentBatsmanId === 'bot_ultimate';
  const isBowling = room.currentBowlerId === 'bot_ultimate';

  if (!isBatting && !isBowling) return;
  if (botPlayer.currentChoice) return; // Already chose

  // Weighted random: favor 2-4 for realism
  const weights = [5, 20, 25, 25, 15, 10]; // 1-6
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  let choice = 1;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) { choice = i + 1; break; }
  }

  // Delay to feel natural (1-2s)
  const delay = 1000 + Math.random() * 1000;
  setTimeout(() => {
    if (!rooms[code] || room.phase !== 'playing') return;
    if (botPlayer.currentChoice) return;

    botPlayer.currentChoice = choice;

    const batsman = room.players.find(p => p.id === room.currentBatsmanId);
    const bowler = room.players.find(p => p.id === room.currentBowlerId);

    if (batsman.currentChoice && bowler.currentChoice) {
      teamResolveBall(code);
    } else {
      // Notify the other player that bot locked in
      const otherId = isBatting ? room.currentBowlerId : room.currentBatsmanId;
      if (otherId !== 'bot_ultimate') {
        io.to(otherId).emit('team-opponent-locked', {});
      }
    }
  }, delay);
}

function teamStartGame(code) {
  const room = rooms[code];
  if (!room) return;

  if (room.lobbyTimerInterval) {
    clearInterval(room.lobbyTimerInterval);
    room.lobbyTimerInterval = null;
  }

  if (room.unassigned.length > 0) {
    room.phase = 'draft-toss';
    teamStartToss(code, 'draft', room.captains.A, room.captains.B);
  } else {
    const botAdded = teamAssignBotIfNeeded(code);
    const delay = botAdded ? 4500 : 0; // Give time for bot announcement
    setTimeout(() => {
      if (!rooms[code]) return;
      room.phase = 'match-toss';
      teamStartToss(code, 'match', room.captains.A, room.captains.B);
    }, delay);
  }
}

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id, 'userId:', socket.userId);

  // ---- Single-device enforcement ----
  if (socket.userId && !socket.userId.startsWith('guest_')) {
    const existingSocketId = userSessions[socket.userId];
    if (existingSocketId && existingSocketId !== socket.id) {
      const existingSocket = io.sockets.sockets.get(existingSocketId);
      if (existingSocket) {
        existingSocket.emit('force-disconnect', {
          message: 'Your account was signed in on another device.'
        });
        existingSocket.disconnect(true);
      }
    }
    userSessions[socket.userId] = socket.id;
  }

  socket.on('create-room', (data) => {
    let code = generateRoomCode();
    while (rooms[code]) code = generateRoomCode();

    if (data.mode === 'team') {
      rooms[code] = {
        code,
        mode: 'team',
        phase: 'lobby',
        hostId: socket.id,
        players: [{
          id: socket.id,
          name: data.playerName,
          team: 'A',
          isCaptain: true,
          score: 0,
          balls: 0,
          isOut: false,
          currentChoice: null,
          ballsBowled: 0,
          runsConceded: 0,
          wicketsTaken: 0
        }],
        captains: { A: socket.id, B: null },
        unassigned: [],
        draftTurn: null,
        toss: null,
        tossWinnerTeam: null,
        battingTeam: null,
        bowlingTeam: null,
        innings: 1,
        target: null,
        teamScores: { A: { runs: 0, wickets: 0 }, B: { runs: 0, wickets: 0 } },
        currentBatsmanId: null,
        currentBowlerId: null,
        lastBowlerId: null,
        ballsInOver: 0,
        overNumber: 1,
        ballTimer: null,
        commentary: []
      };

      socket.join(code);
      socket.roomCode = code;
      socket.emit('room-created', { code });
      teamBroadcastState(code);
      return;
    }

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
        isOut: false,
        ballsBowled: 0,
        runsConceded: 0,
        wicketsTaken: 0
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

    if (room.mode === 'team') {
      const MAX_TEAM_PLAYERS = 20;
      if (room.players.length >= MAX_TEAM_PLAYERS) {
        socket.emit('join-error', { message: 'Room is full!' });
        return;
      }
      if (room.phase !== 'lobby') {
        socket.emit('join-error', { message: 'Game already in progress!' });
        return;
      }

      let team = null;
      let isCaptain = false;
      if (!room.captains.A) {
        team = 'A';
        isCaptain = true;
        room.captains.A = socket.id;
      } else if (!room.captains.B) {
        team = 'B';
        isCaptain = true;
        room.captains.B = socket.id;
      }

      const player = {
        id: socket.id,
        name: data.playerName,
        team,
        isCaptain,
        score: 0,
        balls: 0,
        isOut: false,
        currentChoice: null,
        ballsBowled: 0,
        runsConceded: 0,
        wicketsTaken: 0
      };
      room.players.push(player);
      if (!team) room.unassigned.push(socket.id);

      socket.join(data.code);
      socket.roomCode = data.code;

      teamAddCommentary(data.code, `${data.playerName} joined the lobby.`);
      teamBroadcastState(data.code);
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

    // Always clear any existing timer before starting a new one (prevents duplicate timers on draws)
    if (room.rpsTimer) {
      clearInterval(room.rpsTimer);
      room.rpsTimer = null;
    }

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
          destroyRoom(code);
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
      // Capture choices BEFORE resetting them
      const drawChoices = { [p1.id]: p1.rpsChoice, [p2.id]: p2.rpsChoice };
      p1.rpsChoice = null;
      p2.rpsChoice = null;

      io.to(code).emit('rps-draw', { choices: drawChoices });

      room.state = 'rps';
      // startRPSTimer will clear any old timer internally before starting fresh
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
    bowler.ballsBowled++;
    if (!isOut) {
      batsman.score += runs;
      batsman.balls++;
      bowler.runsConceded += runs;
    } else {
      batsman.balls++;
      batsman.isOut = true;
      bowler.wicketsTaken++;
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
          message: `${batsman.name} wins by ${2 - 0} wickets!`,
          scorecardData: {
            mode: '1v1',
            players: room.players.map(p => ({
              id: p.id, name: p.name,
              score: p.score, balls: p.balls, isOut: p.isOut,
              ballsBowled: p.ballsBowled, runsConceded: p.runsConceded, wicketsTaken: p.wicketsTaken
            })),
            battingId: room.battingPlayer ? room.battingPlayer.id : null,
            bowlingId: room.bowlingPlayer ? room.bowlingPlayer.id : null,
            innings: room.innings,
            target: room.target
          }
        });
        cleanupRoom(socket.roomCode, batsman.id);
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
        room.bowlingPlayer.ballsBowled = 0;
        room.bowlingPlayer.runsConceded = 0;
        room.bowlingPlayer.wicketsTaken = 0;

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
        const diff = room.target - batsman.score - 1;
        let matchData = {};
        
        const scData = {
          mode: '1v1',
          players: room.players.map(p => ({
            id: p.id, name: p.name,
            score: p.score, balls: p.balls, isOut: p.isOut,
            ballsBowled: p.ballsBowled, runsConceded: p.runsConceded, wicketsTaken: p.wicketsTaken
          })),
          battingId: room.battingPlayer ? room.battingPlayer.id : null,
          bowlingId: room.bowlingPlayer ? room.bowlingPlayer.id : null,
          innings: room.innings,
          target: room.target
        };

        if (diff === 0) {
          matchData = {
            winnerId: null,
            winnerName: null,
            scores: {
              [room.players[0].id]: { name: room.players[0].name, score: room.players[0].score, balls: room.players[0].balls },
              [room.players[1].id]: { name: room.players[1].name, score: room.players[1].score, balls: room.players[1].balls }
            },
            message: "Match Tied!",
            scorecardData: scData
          };
        } else {
          const winner = room.bowlingPlayer;
          matchData = {
            winnerId: winner.id,
            winnerName: winner.name,
            scores: {
              [room.players[0].id]: { name: room.players[0].name, score: room.players[0].score, balls: room.players[0].balls },
              [room.players[1].id]: { name: room.players[1].name, score: room.players[1].score, balls: room.players[1].balls }
            },
            message: `${winner.name} wins by ${diff} runs!`,
            scorecardData: scData
          };
        }

        setTimeout(() => {
          io.to(socket.roomCode).emit('match-over', matchData);
          cleanupRoom(socket.roomCode, matchData.winnerId);
        }, 2000);
        return;
      }
    }

    setTimeout(() => startBallTimer(socket.roomCode), 1500);
  });

  // ---- Update player stats in Firestore after a match ----
  async function updatePlayerStats(room, winnerId) {
    if (!room || room.mode !== '1v1' || room.players.length !== 2) return;

    // Take a synchronous snapshot of the stats to avoid race conditions
    // if the room resets (e.g. rematch) while we're awaiting Firestore
    const statsSnapshot = room.players.map(p => ({
      id: p.id,
      score: p.score,
      wicketsTaken: p.wicketsTaken,
      isWinner: p.id === winnerId
    }));

    for (const pData of statsSnapshot) {
      // Find the socket for this player to get their userId
      const playerSocket = io.sockets.sockets.get(pData.id);
      if (!playerSocket || !playerSocket.userId || playerSocket.userId.startsWith('guest_')) continue;

      const uid = playerSocket.userId;
      const isWinner = pData.isWinner;

      try {
        const docRef = firestore.collection('users').doc(uid);
        const doc = await docRef.get();
        if (!doc.exists) continue;

        const stats = doc.data().stats || {};
        const updates = {
          'stats.matchesPlayed': (stats.matchesPlayed || 0) + 1,
          'stats.totalRuns': (stats.totalRuns || 0) + (pData.score || 0),
          'stats.totalWickets': (stats.totalWickets || 0) + (pData.wicketsTaken || 0)
        };

        if ((pData.score || 0) > (stats.highestScore || 0)) {
          updates['stats.highestScore'] = pData.score;
        }
        if ((pData.wicketsTaken || 0) > (stats.bestBowling || 0)) {
          updates['stats.bestBowling'] = pData.wicketsTaken;
        }

        if (isWinner) {
          updates['stats.matchesWon'] = (stats.matchesWon || 0) + 1;
          const newStreak = (stats.currentStreak || 0) + 1;
          updates['stats.currentStreak'] = newStreak;
          if (newStreak > (stats.bestStreak || 0)) {
            updates['stats.bestStreak'] = newStreak;
          }
        } else if (winnerId === null) {
          // Tie — count as played, reset streak, but don't count as loss
          updates['stats.matchesTied'] = (stats.matchesTied || 0) + 1;
          updates['stats.currentStreak'] = 0;
        } else {
          updates['stats.matchesLost'] = (stats.matchesLost || 0) + 1;
          updates['stats.currentStreak'] = 0;
        }

        await docRef.update(updates);
        // Notify the player that stats were updated
        if (playerSocket) playerSocket.emit('stats-updated', { success: true });
      } catch (err) {
        console.error('Failed to update stats for', uid, err.message);
      }
    }
  }

  function cleanupRoom(code, winnerId) {
    const room = rooms[code];
    if (!room) return;

    // Update player stats in Firestore (async, fire-and-forget)
    updatePlayerStats(room, winnerId).catch(err => {
      console.error('Stats update failed:', err.message);
    });

    io.to(code).emit('scorecard-data', {
      mode: '1v1',
      players: room.players.map(p => ({
        id: p.id, name: p.name,
        score: p.score, balls: p.balls, isOut: p.isOut,
        ballsBowled: p.ballsBowled, runsConceded: p.runsConceded, wicketsTaken: p.wicketsTaken
      })),
      battingId: room.battingPlayer ? room.battingPlayer.id : null,
      bowlingId: room.bowlingPlayer ? room.bowlingPlayer.id : null,
      innings: room.innings,
      target: room.target
    });

    if (room.ballTimer) clearInterval(room.ballTimer);
    if (room.rpsTimer) clearInterval(room.rpsTimer);

    // Keep room alive for rematch instead of deleting
    room.state = 'finished';
    room.rematchRequests = {};

    // Auto-cleanup after 60s if no rematch
    room.rematchTimeout = setTimeout(() => {
      if (rooms[code] && rooms[code].state === 'finished') {
        delete rooms[code];
      }
    }, 60000);
  }

  function destroyRoom(code) {
    const room = rooms[code];
    if (!room) return;
    if (room.ballTimer) clearInterval(room.ballTimer);
    if (room.rpsTimer) clearInterval(room.rpsTimer);
    if (room.rematchTimeout) clearTimeout(room.rematchTimeout);
    delete rooms[code];
  }

  function resetRoomForRematch(code) {
    const room = rooms[code];
    if (!room) { console.log('[REMATCH] resetRoomForRematch: room not found for', code); return; }
    console.log('[REMATCH] resetRoomForRematch: resetting room', code, 'with players', room.players.map(p => p.id));

    if (room.rematchTimeout) clearTimeout(room.rematchTimeout);

    // Reset player stats
    room.players.forEach(p => {
      p.rpsChoice = null;
      p.score = 0;
      p.balls = 0;
      p.currentChoice = null;
      p.isOut = false;
      p.ballsBowled = 0;
      p.runsConceded = 0;
      p.wicketsTaken = 0;
    });

    // Reset room state
    room.state = 'rps';
    room.tossWinner = null;
    room.tossChoice = null;
    room.battingPlayer = null;
    room.bowlingPlayer = null;
    room.innings = 1;
    room.target = null;
    room.ballTimer = null;
    room.rpsTimer = null;
    room.rematchRequests = {};

    // Start fresh game
    io.to(code).emit('game-start', {
      players: room.players.map(p => ({ id: p.id, name: p.name })),
      state: 'rps'
    });

    startRPSTimer(code);
  }

  socket.on('rematch-request', () => {
    console.log('[REMATCH] rematch-request from', socket.id, 'roomCode:', socket.roomCode);
    const room = rooms[socket.roomCode];
    if (!room) { console.log('[REMATCH] no room found'); return; }
    if (room.state !== 'finished') { console.log('[REMATCH] room state is', room.state, 'not finished'); return; }

    room.rematchRequests[socket.id] = true;
    console.log('[REMATCH] requests so far:', JSON.stringify(room.rematchRequests));

    const opponent = room.players.find(p => p.id !== socket.id);
    if (!opponent) { console.log('[REMATCH] no opponent found'); return; }

    // Check if both players requested
    if (room.rematchRequests[opponent.id]) {
      console.log('[REMATCH] Both players agreed! Starting rematch...');
      io.to(socket.roomCode).emit('rematch-accepted');
      setTimeout(() => resetRoomForRematch(socket.roomCode), 1000);
    } else {
      console.log('[REMATCH] Notifying opponent', opponent.id);
      // Notify opponent
      io.to(opponent.id).emit('rematch-requested', {
        fromName: room.players.find(p => p.id === socket.id).name
      });
    }
  });

  socket.on('rematch-decline', () => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room || room.state !== 'finished') return;

    const opponent = room.players.find(p => p.id !== socket.id);
    if (opponent) {
      io.to(opponent.id).emit('rematch-declined');
    }
    destroyRoom(code);
  });

  socket.on('team-toss-choice', (data) => {
    const room = rooms[socket.roomCode];
    if (!room || room.mode !== 'team' || !room.toss) return;
    const t = room.toss;
    if (socket.id !== t.p1 && socket.id !== t.p2) return;
    if (t.choices[socket.id]) return;

    t.choices[socket.id] = data.choice;
    const otherId = socket.id === t.p1 ? t.p2 : t.p1;
    io.to(otherId).emit('team-toss-opponent-locked', {});

    if (t.choices[t.p1] && t.choices[t.p2]) {
      if (t.timer) { clearInterval(t.timer); t.timer = null; }
      setTimeout(() => teamResolveToss(socket.roomCode), 500);
    }
  });

  socket.on('team-draft-pick', (data) => {
    const room = rooms[socket.roomCode];
    if (!room || room.mode !== 'team' || room.phase !== 'draft') return;
    const team = room.draftTurn;
    if (socket.id !== room.captains[team]) return;

    const idx = room.unassigned.indexOf(data.playerId);
    if (idx === -1) return;

    room.unassigned.splice(idx, 1);
    const player = room.players.find(p => p.id === data.playerId);
    player.team = team;

    const captain = room.players.find(p => p.id === socket.id);
    teamAddCommentary(socket.roomCode, `${captain.name} drafted ${player.name} to Team ${team}.`);

    if (room.unassigned.length === 0) {
      // Check if teams are unequal — add bot to smaller team
      const botAdded = teamAssignBotIfNeeded(socket.roomCode);
      const tossDelay = botAdded ? 4500 : 0;
      setTimeout(() => {
        if (!rooms[socket.roomCode]) return;
        room.phase = 'match-toss';
        teamStartToss(socket.roomCode, 'match', room.captains.A, room.captains.B);
      }, tossDelay);
    } else {
      room.draftTurn = team === 'A' ? 'B' : 'A';
      teamBroadcastState(socket.roomCode);
    }
  });

  socket.on('team-transfer-captain', (data) => {
    const room = rooms[socket.roomCode];
    if (!room || room.mode !== 'team') return;
    if (room.phase === 'finished') return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player || !player.isCaptain) return;

    const newCaptain = room.players.find(p => p.id === data.newCaptainId);
    if (!newCaptain || newCaptain.team !== player.team || newCaptain.id === player.id) return;
    // Cannot transfer captaincy to bot
    if (newCaptain.isBot) return;

    player.isCaptain = false;
    newCaptain.isCaptain = true;
    room.captains[player.team] = newCaptain.id;

    if (room.hostId === player.id) room.hostId = newCaptain.id;

    teamAddCommentary(socket.roomCode, `👑 ${newCaptain.name} is now Team ${player.team}'s captain.`);
    teamBroadcastState(socket.roomCode);
  });

  socket.on('team-start-game', () => {
    const room = rooms[socket.roomCode];
    if (!room || room.mode !== 'team' || room.phase !== 'lobby') return;
    if (socket.id !== room.hostId) return;

    if (!room.captains.A || !room.captains.B || room.players.length < 3) {
      socket.emit('team-game-error', { message: 'Need at least 3 players for a team battle!' });
      return;
    }

    teamStartGame(socket.roomCode);
  });

  // ---- Team Play Again ----
  socket.on('team-rematch-request', () => {
    const room = rooms[socket.roomCode];
    if (!room || room.mode !== 'team' || room.phase !== 'finished') return;
    if (socket.id !== room.hostId) return;

    // Host accepted implicitly
    room.teamRematchAccepted[socket.id] = true;

    // Emit offer to all players
    io.to(socket.roomCode).emit('team-rematch-offer', {
      hostName: room.players.find(p => p.id === socket.id)?.name || 'Host'
    });

    // Start 10-second timer
    room.teamRematchTimer = setTimeout(() => {
      teamRematchTimerExpire(socket.roomCode);
    }, 10000);
  });

  socket.on('team-rematch-accept', () => {
    const room = rooms[socket.roomCode];
    if (!room || room.mode !== 'team' || room.phase !== 'finished') return;

    room.teamRematchAccepted[socket.id] = true;

    // Check if all human players accepted
    const humanPlayers = room.players.filter(p => !p.isBot);
    const allAccepted = humanPlayers.every(p => room.teamRematchAccepted[p.id]);

    if (allAccepted) {
      if (room.teamRematchTimer) { clearTimeout(room.teamRematchTimer); room.teamRematchTimer = null; }
      resetTeamRoomForRematch(socket.roomCode, true);
    }
  });

  socket.on('team-rematch-decline', () => {
    const room = rooms[socket.roomCode];
    if (!room || room.mode !== 'team' || room.phase !== 'finished') return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    // Remove from room
    io.to(socket.id).emit('team-rematch-kicked', { reason: 'You declined the rematch.' });
    socket.leave(socket.roomCode);
    room.players = room.players.filter(p => p.id !== socket.id);

    // Reassign captain if this player was captain
    if (player.isCaptain && player.team) {
      const teammates = room.players.filter(p => p.team === player.team && !p.isBot);
      if (teammates.length > 0) {
        const newCap = teammates[Math.floor(Math.random() * teammates.length)];
        newCap.isCaptain = true;
        room.captains[player.team] = newCap.id;
        teamAddCommentary(socket.roomCode, `👑 ${newCap.name} is now Team ${player.team}'s captain.`);
      }
    }

    // Update host if needed
    if (room.hostId === socket.id) {
      const newHost = room.players.find(p => !p.isBot);
      if (newHost) room.hostId = newHost.id;
    }

    socket.roomCode = null;

    // Check if enough remain
    const remaining = room.players.filter(p => !p.isBot);
    if (remaining.length < 2) {
      if (room.teamRematchTimer) { clearTimeout(room.teamRematchTimer); room.teamRematchTimer = null; }
      io.to(room.code).emit('team-game-error', { message: 'Not enough players to continue.' });
      teamDestroyRoom(room.code);
      return;
    }

    // Check if all remaining have accepted
    const humanPlayers = room.players.filter(p => !p.isBot);
    const allAccepted = humanPlayers.every(p => room.teamRematchAccepted[p.id]);
    if (allAccepted) {
      if (room.teamRematchTimer) { clearTimeout(room.teamRematchTimer); room.teamRematchTimer = null; }
      resetTeamRoomForRematch(room.code, true);
    }
  });

  socket.on('get-scorecard', () => {
    const room = rooms[socket.roomCode];
    if (!room) return;

    if (room.mode === 'team') {
      socket.emit('scorecard-data', {
        mode: 'team',
        players: room.players.map(p => ({
          id: p.id, name: p.name, team: p.team, isCaptain: p.isCaptain,
          score: p.score, balls: p.balls, isOut: p.isOut,
          ballsBowled: p.ballsBowled, runsConceded: p.runsConceded, wicketsTaken: p.wicketsTaken
        })),
        battingTeam: room.battingTeam,
        bowlingTeam: room.bowlingTeam,
        innings: room.innings,
        target: room.target,
        teamScores: room.teamScores
      });
    } else {
      socket.emit('scorecard-data', {
        mode: '1v1',
        players: room.players.map(p => ({
          id: p.id, name: p.name,
          score: p.score, balls: p.balls, isOut: p.isOut,
          ballsBowled: p.ballsBowled, runsConceded: p.runsConceded, wicketsTaken: p.wicketsTaken
        })),
        battingId: room.battingPlayer ? room.battingPlayer.id : null,
        bowlingId: room.bowlingPlayer ? room.bowlingPlayer.id : null,
        innings: room.innings,
        target: room.target
      });
    }
  });

  socket.on('team-toss-decision', (data) => {
    const room = rooms[socket.roomCode];
    if (!room || room.mode !== 'team' || room.phase !== 'toss-choice') return;
    const winnerTeam = room.tossWinnerTeam;
    if (socket.id !== room.captains[winnerTeam]) return;

    if (data.choice === 'bat') {
      room.battingTeam = winnerTeam;
      room.bowlingTeam = winnerTeam === 'A' ? 'B' : 'A';
    } else {
      room.bowlingTeam = winnerTeam;
      room.battingTeam = winnerTeam === 'A' ? 'B' : 'A';
    }

    teamAddCommentary(socket.roomCode, `Team ${winnerTeam} chose to ${data.choice === 'bat' ? 'BAT' : 'BOWL'} first.`);

    room.phase = 'select-bowler';
    teamBroadcastState(socket.roomCode);
  });

  socket.on('team-select-bowler', (data) => {
    const room = rooms[socket.roomCode];
    if (!room || room.mode !== 'team' || room.phase !== 'select-bowler') return;
    if (socket.id !== room.captains[room.bowlingTeam]) return;

    const bowler = room.players.find(p => p.id === data.bowlerId && p.team === room.bowlingTeam);
    if (!bowler) return;
    if (room.lastBowlerId && bowler.id === room.lastBowlerId) return;

    room.currentBowlerId = bowler.id;
    const tsB = room.teamScores[room.battingTeam];
    teamAddCommentary(socket.roomCode, `🎯 ${bowler.name} will bowl over ${room.overNumber} — Team ${room.battingTeam} ${tsB.runs}/${tsB.wickets}`);

    if (!room.currentBatsmanId) {
      room.phase = 'select-batsman';
      teamBroadcastState(socket.roomCode);
    } else {
      room.phase = 'playing';
      teamBroadcastState(socket.roomCode);
      teamStartBallTimer(socket.roomCode);
    }
  });

  socket.on('team-select-batsman', (data) => {
    const room = rooms[socket.roomCode];
    if (!room || room.mode !== 'team' || room.phase !== 'select-batsman') return;
    if (socket.id !== room.captains[room.battingTeam]) return;

    const batsman = room.players.find(p => p.id === data.batsmanId && p.team === room.battingTeam && !p.isOut);
    if (!batsman) return;

    room.currentBatsmanId = batsman.id;
    const tsA = room.teamScores[room.battingTeam];
    teamAddCommentary(socket.roomCode, `🏏 ${batsman.name} walks out to bat — Team ${room.battingTeam} ${tsA.runs}/${tsA.wickets}`);

    if (!room.currentBowlerId) {
      room.phase = 'select-bowler';
      teamBroadcastState(socket.roomCode);
    } else {
      room.phase = 'playing';
      teamBroadcastState(socket.roomCode);
      teamStartBallTimer(socket.roomCode);
    }
  });

  socket.on('team-play-number', (data) => {
    const room = rooms[socket.roomCode];
    if (!room || room.mode !== 'team' || room.phase !== 'playing') return;
    if (socket.id !== room.currentBatsmanId && socket.id !== room.currentBowlerId) return;

    const num = parseInt(data.number);
    if (num < 1 || num > 6) return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player || player.currentChoice) return;
    player.currentChoice = num;

    const batsman = room.players.find(p => p.id === room.currentBatsmanId);
    const bowler = room.players.find(p => p.id === room.currentBowlerId);

    if (!batsman.currentChoice || !bowler.currentChoice) {
      const otherId = socket.id === room.currentBatsmanId ? room.currentBowlerId : room.currentBatsmanId;
      io.to(otherId).emit('team-opponent-locked', {});
      return;
    }

    teamResolveBall(socket.roomCode);
  });

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
    const allowed = ['😭','😵‍💫','😎','😂','😱'];
    if (!allowed.includes(data.emoji)) return;
    io.to(socket.roomCode).emit('reaction', {
      senderId: socket.id,
      senderName: player.name,
      emoji: data.emoji
    });
  });

  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);

    // Clean up user session mapping
    if (socket.userId && userSessions[socket.userId] === socket.id) {
      delete userSessions[socket.userId];
    }

    const code = socket.roomCode;
    if (!code || !rooms[code]) return;

    const room = rooms[code];

    if (room.mode === 'team') {
      teamHandleDisconnect(code, socket.id);
      return;
    }

    const remaining = room.players.find(p => p.id !== socket.id);

    if (room.state === 'finished') {
      // Player left during rematch window
      if (remaining) {
        io.to(remaining.id).emit('rematch-cancelled');
      }
      destroyRoom(code);
      return;
    }

    if (remaining && room.state !== 'waiting') {
      io.to(remaining.id).emit('game-error', { message: 'Your opponent disconnected!' });
    }
    destroyRoom(code);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Hand Cricket Ultimate running on port ${PORT}`);
});