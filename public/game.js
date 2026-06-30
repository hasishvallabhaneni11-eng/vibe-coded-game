const socket = io();

const SCORE_LABELS = {
  1: { label: 'SINGLE', icon: '☝️' },
  2: { label: 'DOUBLE', icon: '✌️' },
  3: { label: 'TRIPLE', icon: '🤟' },
  4: { label: 'FOUR!', icon: '🔥' },
  5: { label: 'FIVE', icon: '🖐️' },
  6: { label: 'SIXER!', icon: '💥' }
};

const SCORE_COLORS = {
  1: { bg: 'linear-gradient(135deg, #1a237e, #283593)', glow: '#536dfe', border: '#536dfe' },
  2: { bg: 'linear-gradient(135deg, #004d40, #00695c)', glow: '#64ffda', border: '#64ffda' },
  3: { bg: 'linear-gradient(135deg, #4a148c, #6a1b9a)', glow: '#e040fb', border: '#e040fb' },
  4: { bg: 'linear-gradient(135deg, #b71c1c, #c62828)', glow: '#ff5252', border: '#ff5252' },
  5: { bg: 'linear-gradient(135deg, #e65100, #ef6c00)', glow: '#ffab40', border: '#ffab40' },
  6: { bg: 'linear-gradient(135deg, #f57f17, #ff8f00)', glow: '#ffd740', border: '#ffd740' }
};

function createScoreCard(num) {
  const s = SCORE_LABELS[num] || { label: num, icon: '' };
  const c = SCORE_COLORS[num] || SCORE_COLORS[1];
  return `<div class="score-reveal-card" style="background:${c.bg};border-color:${c.border};box-shadow:0 0 30px ${c.glow}40, 0 0 60px ${c.glow}20;">
    <div class="src-number" style="text-shadow:0 0 30px ${c.glow};">${num}</div>
    <div class="src-label">${s.label}</div>
    <div class="src-icon">${s.icon}</div>
  </div>`;
}

const RPS_EMOJIS = { rock: '🪨', paper: '📄', scissors: '✂️' };

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.bgGain = null;
    this.bgOscillators = [];
    this.initialized = false;
    this.currentBg = null;
  }

  init() {
    if (this.initialized) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = state.soundEnabled ? 0.5 : 0;
    this.masterGain.connect(this.ctx.destination);
    this.bgGain = this.ctx.createGain();
    this.bgGain.gain.value = 0;
    this.bgGain.connect(this.masterGain);
    this.initialized = true;
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended' && state.soundEnabled) this.ctx.resume();
  }

  setMuted(muted) {
    if (!this.initialized) return;
    if (muted) {
      this.masterGain.gain.value = 0;
      this.stopBgAmbience();
      // Suspend the entire AudioContext so nothing can produce sound
      if (this.ctx && this.ctx.state === 'running') {
        this.ctx.suspend();
      }
    } else {
      // Resume context first, then set volume
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
      this.masterGain.gain.value = 0.5;
      // Only restart bg ambience on menu screens, not mid-game
      if (!this.currentBg && (currentScreenName === 'home' || currentScreenName === 'name')) {
        this.startBgAmbience();
      }
    }
  }

  // Guard used inside every engine method — belt-and-braces so even
  // direct calls (bypassing playSound) are silenced when muted.
  canPlay() {
    return this.initialized && state.soundEnabled;
  }

  createReverb(duration) {
    const rate = this.ctx.sampleRate;
    const length = rate * duration;
    const impulse = this.ctx.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.5);
      }
    }
    const conv = this.ctx.createConvolver();
    conv.buffer = impulse;
    return conv;
  }

  playNote(freq, type, vol, start, dur, dest) {
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.value = 0;
    g.gain.linearRampToValueAtTime(vol, start + 0.02);
    g.gain.linearRampToValueAtTime(vol * 0.7, start + dur * 0.6);
    g.gain.linearRampToValueAtTime(0.001, start + dur);
    osc.connect(g);
    g.connect(dest || this.masterGain);
    osc.start(start);
    osc.stop(start + dur + 0.05);
    return osc;
  }

  playChord(freqs, type, vol, start, dur, dest) {
    freqs.forEach(f => this.playNote(f, type, vol / freqs.length, start, dur, dest));
  }

  click() {
    if (!this.canPlay()) return;
    const t = this.ctx.currentTime;
    this.playNote(1200, 'sine', 0.06, t, 0.06);
    this.playNote(1800, 'sine', 0.03, t + 0.01, 0.04);
  }

  whoosh() {
    if (!this.canPlay()) return;
    const t = this.ctx.currentTime;
    const noise = this.ctx.createBufferSource();
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.3, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1);
    noise.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2000;
    filter.frequency.linearRampToValueAtTime(500, t + 0.3);
    filter.Q.value = 2;
    const g = this.ctx.createGain();
    g.gain.value = 0.08;
    g.gain.linearRampToValueAtTime(0.001, t + 0.3);
    noise.connect(filter);
    filter.connect(g);
    g.connect(this.masterGain);
    noise.start(t);
    noise.stop(t + 0.35);
  }

  success() {
    if (!this.canPlay()) return;
    const t = this.ctx.currentTime;
    const rev = this.createReverb(0.8);
    rev.connect(this.masterGain);
    const notes = [523, 659, 784];
    notes.forEach((f, i) => {
      this.playNote(f, 'sine', 0.07, t + i * 0.08, 0.25, rev);
      this.playNote(f * 2, 'sine', 0.02, t + i * 0.08 + 0.02, 0.15, rev);
    });
  }

  fail() {
    if (!this.canPlay()) return;
    const t = this.ctx.currentTime;
    this.playNote(400, 'sawtooth', 0.04, t, 0.4);
    this.playNote(300, 'sawtooth', 0.03, t + 0.1, 0.3);
    this.playNote(200, 'square', 0.02, t + 0.2, 0.3);
  }

  tick() {
    if (!this.canPlay()) return;
    const t = this.ctx.currentTime;
    this.playNote(1200, 'sine', 0.04, t, 0.03);
  }

  tenseTick() {
    if (!this.canPlay()) return;
    const t = this.ctx.currentTime;
    this.playNote(880, 'square', 0.03, t, 0.05);
    this.playNote(880, 'sine', 0.04, t, 0.08);
    this.playNote(440, 'sine', 0.02, t + 0.02, 0.06);
  }

  batHit(runs) {
    if (!this.canPlay()) return;
    const t = this.ctx.currentTime;
    const rev = this.createReverb(1.2);
    rev.connect(this.masterGain);

    const noise = this.ctx.createBufferSource();
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.15, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 3);
    noise.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = 0.12;
    noise.connect(g);
    g.connect(rev);
    noise.start(t);

    if (runs >= 4) {
      this.playNote(523, 'sine', 0.08, t + 0.1, 0.3, rev);
      this.playNote(659, 'sine', 0.07, t + 0.2, 0.3, rev);
      this.playNote(784, 'sine', 0.08, t + 0.3, 0.4, rev);
      this.playNote(1047, 'sine', 0.06, t + 0.4, 0.5, rev);

      const crowd = this.ctx.createBufferSource();
      const crowdBuf = this.ctx.createBuffer(1, this.ctx.sampleRate * 1.5, this.ctx.sampleRate);
      const crowdData = crowdBuf.getChannelData(0);
      for (let i = 0; i < crowdData.length; i++) {
        const env = Math.sin((i / crowdData.length) * Math.PI) * 0.8;
        crowdData[i] = (Math.random() * 2 - 1) * env;
      }
      crowd.buffer = crowdBuf;
      const crowdFilter = this.ctx.createBiquadFilter();
      crowdFilter.type = 'bandpass';
      crowdFilter.frequency.value = 800;
      crowdFilter.Q.value = 0.5;
      const cg = this.ctx.createGain();
      cg.gain.value = runs === 6 ? 0.1 : 0.06;
      crowd.connect(crowdFilter);
      crowdFilter.connect(cg);
      cg.connect(rev);
      crowd.start(t + 0.15);
    } else {
      this.playNote(440 + runs * 80, 'sine', 0.06, t + 0.1, 0.2, rev);
      this.playNote(440 + runs * 120, 'sine', 0.04, t + 0.15, 0.15, rev);
    }
  }

  out() {
    if (!this.canPlay()) return;
    const t = this.ctx.currentTime;
    const rev = this.createReverb(1.5);
    rev.connect(this.masterGain);

    this.playNote(600, 'sawtooth', 0.06, t, 0.15);
    this.playNote(500, 'sawtooth', 0.05, t + 0.05, 0.15);

    const noise = this.ctx.createBufferSource();
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.2, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2);
    noise.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = 0.1;
    noise.connect(g);
    g.connect(rev);
    noise.start(t);

    this.playNote(300, 'sine', 0.05, t + 0.2, 0.6, rev);
    this.playNote(200, 'sine', 0.04, t + 0.4, 0.5, rev);
    this.playNote(150, 'sine', 0.03, t + 0.6, 0.6, rev);

    setTimeout(() => {
      if (!this.canPlay()) return;
      const t2 = this.ctx.currentTime;
      const crowd = this.ctx.createBufferSource();
      const cb = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.8, this.ctx.sampleRate);
      const cd = cb.getChannelData(0);
      for (let i = 0; i < cd.length; i++) {
        cd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / cd.length, 1.5) * 0.5;
      }
      crowd.buffer = cb;
      const cf = this.ctx.createBiquadFilter();
      cf.type = 'lowpass';
      cf.frequency.value = 600;
      const cg2 = this.ctx.createGain();
      cg2.gain.value = 0.04;
      crowd.connect(cf);
      cf.connect(cg2);
      cg2.connect(this.masterGain);
      crowd.start(t2);
    }, 300);
  }

  victory() {
    if (!this.canPlay()) return;
    const t = this.ctx.currentTime;
    const rev = this.createReverb(2.0);
    rev.connect(this.masterGain);

    const fanfare = [
      { notes: [523, 659, 784], time: 0, dur: 0.3 },
      { notes: [587, 740, 880], time: 0.25, dur: 0.3 },
      { notes: [659, 784, 988], time: 0.5, dur: 0.3 },
      { notes: [784, 988, 1175], time: 0.75, dur: 0.5 },
      { notes: [1047, 1319, 1568], time: 1.1, dur: 0.8 }
    ];

    fanfare.forEach(chord => {
      this.playChord(chord.notes, 'sine', 0.12, t + chord.time, chord.dur, rev);
      this.playChord(chord.notes.map(f => f * 0.5), 'triangle', 0.04, t + chord.time, chord.dur * 1.2, rev);
    });

    const crowd = this.ctx.createBufferSource();
    const cb = this.ctx.createBuffer(2, this.ctx.sampleRate * 3, this.ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = cb.getChannelData(ch);
      for (let i = 0; i < d.length; i++) {
        const env = Math.sin((i / d.length) * Math.PI);
        d[i] = (Math.random() * 2 - 1) * env * 0.6;
      }
    }
    crowd.buffer = cb;
    const cf = this.ctx.createBiquadFilter();
    cf.type = 'bandpass';
    cf.frequency.value = 1000;
    cf.Q.value = 0.3;
    const cg3 = this.ctx.createGain();
    cg3.gain.value = 0.06;
    crowd.connect(cf);
    cf.connect(cg3);
    cg3.connect(rev);
    crowd.start(t + 0.5);
  }

  defeat() {
    if (!this.canPlay()) return;
    const t = this.ctx.currentTime;
    const rev = this.createReverb(2.0);
    rev.connect(this.masterGain);

    const melody = [
      { f: 440, time: 0, dur: 0.5 },
      { f: 415, time: 0.4, dur: 0.5 },
      { f: 392, time: 0.8, dur: 0.5 },
      { f: 349, time: 1.2, dur: 0.8 },
      { f: 330, time: 1.8, dur: 1.2 }
    ];

    melody.forEach(n => {
      this.playNote(n.f, 'sine', 0.06, t + n.time, n.dur, rev);
      this.playNote(n.f * 0.5, 'triangle', 0.03, t + n.time, n.dur * 1.2, rev);
    });
  }

  inningsChange() {
    if (!this.canPlay()) return;
    const t = this.ctx.currentTime;
    const rev = this.createReverb(1.5);
    rev.connect(this.masterGain);

    const drums = this.ctx.createBufferSource();
    const db = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.3, this.ctx.sampleRate);
    const dd = db.getChannelData(0);
    for (let i = 0; i < dd.length; i++) {
      dd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / dd.length, 5);
    }
    drums.buffer = db;
    const dg = this.ctx.createGain();
    dg.gain.value = 0.12;
    drums.connect(dg);
    dg.connect(this.masterGain);
    drums.start(t);

    this.playChord([392, 494, 587], 'sine', 0.08, t + 0.2, 0.4, rev);
    this.playChord([440, 554, 659], 'sine', 0.08, t + 0.5, 0.4, rev);
    this.playChord([523, 659, 784], 'sine', 0.1, t + 0.8, 0.6, rev);
    this.playNote(262, 'triangle', 0.05, t + 0.2, 1.2, rev);
  }

  rpsReveal() {
    if (!this.canPlay()) return;
    const t = this.ctx.currentTime;
    const rev = this.createReverb(0.6);
    rev.connect(this.masterGain);

    const drum = this.ctx.createBufferSource();
    const db2 = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.1, this.ctx.sampleRate);
    const dd2 = db2.getChannelData(0);
    for (let i = 0; i < dd2.length; i++) dd2[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / dd2.length, 4);
    drum.buffer = db2;
    const dg2 = this.ctx.createGain();
    dg2.gain.value = 0.15;
    drum.connect(dg2);
    dg2.connect(rev);
    drum.start(t);

    this.playNote(600, 'sine', 0.05, t + 0.05, 0.15, rev);
    this.playNote(800, 'sine', 0.04, t + 0.1, 0.2, rev);
  }

  startBgAmbience() {
    if (!this.initialized || !state.soundEnabled) return;
    this.stopBgAmbience();

    const pad1 = this.ctx.createOscillator();
    const pad2 = this.ctx.createOscillator();
    const pad3 = this.ctx.createOscillator();
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();

    pad1.type = 'sine';
    pad1.frequency.value = 110;
    pad2.type = 'sine';
    pad2.frequency.value = 165;
    pad3.type = 'triangle';
    pad3.frequency.value = 220;

    lfo.type = 'sine';
    lfo.frequency.value = 0.15;
    lfoGain.gain.value = 8;
    lfo.connect(lfoGain);
    lfoGain.connect(pad1.frequency);
    lfoGain.connect(pad2.frequency);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400;
    filter.Q.value = 2;

    const g1 = this.ctx.createGain();
    g1.gain.value = 0.025;
    const g2 = this.ctx.createGain();
    g2.gain.value = 0.015;
    const g3 = this.ctx.createGain();
    g3.gain.value = 0.01;

    pad1.connect(g1);
    pad2.connect(g2);
    pad3.connect(g3);
    g1.connect(filter);
    g2.connect(filter);
    g3.connect(filter);
    filter.connect(this.masterGain);

    pad1.start();
    pad2.start();
    pad3.start();
    lfo.start();

    this.bgOscillators = [pad1, pad2, pad3, lfo];
    this.currentBg = 'ambient';
  }

  stopBgAmbience() {
    this.bgOscillators.forEach(o => {
      try { o.stop(); } catch(e) {}
    });
    this.bgOscillators = [];
    this.currentBg = null;
  }

  milestoneFanfare(level) {
    if (!this.canPlay()) return;
    const t = this.ctx.currentTime;
    const rev = this.createReverb(2.5);
    rev.connect(this.masterGain);

    // Drum roll
    for (let i = 0; i < 8; i++) {
      const drum = this.ctx.createBufferSource();
      const db = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.08, this.ctx.sampleRate);
      const dd = db.getChannelData(0);
      for (let j = 0; j < dd.length; j++) dd[j] = (Math.random() * 2 - 1) * Math.pow(1 - j / dd.length, 4);
      drum.buffer = db;
      const dg = this.ctx.createGain();
      dg.gain.value = 0.04 + (i * 0.015);
      drum.connect(dg);
      dg.connect(rev);
      drum.start(t + i * 0.08);
    }

    // Ascending chord progression that scales with milestone
    const chords = level >= 200
      ? [
          { notes: [262, 330, 392], time: 0.7, dur: 0.3 },
          { notes: [330, 415, 494], time: 0.95, dur: 0.3 },
          { notes: [392, 494, 587], time: 1.15, dur: 0.3 },
          { notes: [494, 622, 740], time: 1.35, dur: 0.4 },
          { notes: [523, 659, 784], time: 1.55, dur: 0.4 },
          { notes: [659, 831, 988], time: 1.8, dur: 0.5 },
          { notes: [784, 988, 1175], time: 2.1, dur: 0.6 },
          { notes: [1047, 1319, 1568], time: 2.5, dur: 1.0 }
        ]
      : level >= 100
      ? [
          { notes: [330, 415, 494], time: 0.7, dur: 0.3 },
          { notes: [392, 494, 587], time: 0.95, dur: 0.3 },
          { notes: [523, 659, 784], time: 1.2, dur: 0.4 },
          { notes: [659, 831, 988], time: 1.5, dur: 0.5 },
          { notes: [784, 988, 1175], time: 1.85, dur: 0.6 },
          { notes: [1047, 1319, 1568], time: 2.3, dur: 0.8 }
        ]
      : [
          { notes: [392, 494, 587], time: 0.7, dur: 0.3 },
          { notes: [523, 659, 784], time: 1.0, dur: 0.4 },
          { notes: [659, 831, 988], time: 1.3, dur: 0.5 },
          { notes: [784, 988, 1175], time: 1.7, dur: 0.6 }
        ];

    const vol = level >= 200 ? 0.14 : level >= 100 ? 0.12 : 0.09;
    chords.forEach(chord => {
      this.playChord(chord.notes, 'sine', vol, t + chord.time, chord.dur, rev);
      this.playChord(chord.notes.map(f => f * 0.5), 'triangle', vol * 0.3, t + chord.time, chord.dur * 1.3, rev);
    });

    // Big crowd roar for 100+
    if (level >= 100) {
      const crowd = this.ctx.createBufferSource();
      const crowdDur = level >= 200 ? 4 : 3;
      const cb = this.ctx.createBuffer(2, this.ctx.sampleRate * crowdDur, this.ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = cb.getChannelData(ch);
        for (let i = 0; i < d.length; i++) {
          const env = Math.sin((i / d.length) * Math.PI);
          d[i] = (Math.random() * 2 - 1) * env * 0.7;
        }
      }
      crowd.buffer = cb;
      const cf = this.ctx.createBiquadFilter();
      cf.type = 'bandpass';
      cf.frequency.value = 900;
      cf.Q.value = 0.4;
      const cg = this.ctx.createGain();
      cg.gain.value = level >= 200 ? 0.1 : 0.07;
      crowd.connect(cf);
      cf.connect(cg);
      cg.connect(rev);
      crowd.start(t + 0.8);
    }
  }
}

const audio = new AudioEngine();

document.addEventListener('click', () => {
  audio.init();
  audio.resume();
}, { once: true });

document.addEventListener('touchstart', () => {
  audio.init();
  audio.resume();
}, { once: true });

function playSound(type) {
  if (!state.soundEnabled || !audio.initialized) return;
  switch(type) {
    case 'click': audio.click(); break;
    case 'whoosh': audio.whoosh(); break;
    case 'success': audio.success(); break;
    case 'fail': audio.fail(); break;
    case 'tick': audio.tick(); break;
    case 'tenseTick': audio.tenseTick(); break;
    case 'batHit': audio.batHit(1); break;
    case 'out': audio.out(); break;
    case 'win': audio.victory(); break;
    case 'rpsReveal': audio.rpsReveal(); break;
    case 'inningsChange': audio.inningsChange(); break;
    case 'defeat': audio.defeat(); break;
    case 'milestone50': audio.milestoneFanfare(50); break;
    case 'milestone100': audio.milestoneFanfare(100); break;
    case 'milestone200': audio.milestoneFanfare(200); break;
  }
}

const state = {
  playerName: localStorage.getItem('hc_playerName') || '',
  playerId: null,
  roomCode: null,
  mode: '1v1',
  players: [],
  isBatting: false,
  locked: false,
  soundEnabled: localStorage.getItem('hc_sound') !== 'false',
  particlesEnabled: localStorage.getItem('hc_particles') !== 'false',
  team: null,
  teamLocked: false,
  isHost: false
};

const screens = {
  name: document.getElementById('name-screen'),
  home: document.getElementById('home-screen'),
  room: document.getElementById('room-screen'),
  waiting: document.getElementById('waiting-screen'),
  join: document.getElementById('join-screen'),
  rps: document.getElementById('rps-screen'),
  tossChoice: document.getElementById('toss-choice-screen'),
  game: document.getElementById('game-screen'),
  result: document.getElementById('result-screen'),
  settings: document.getElementById('settings-screen'),
  teamLobby: document.getElementById('team-lobby-screen'),
  teamToss: document.getElementById('team-toss-screen'),
  teamDraft: document.getElementById('team-draft-screen'),
  teamTossChoice: document.getElementById('team-toss-choice-screen'),
  teamGame: document.getElementById('team-game-screen'),
  teamResult: document.getElementById('team-result-screen')
};

let currentScreenName = null;

function pcClass(playerId) {
  const idx = state.players.findIndex(p => p.id === playerId);
  return idx === 1 ? 'pc-1' : 'pc-0';
}

function showScreen(name) {
  currentScreenName = name;
  Object.values(screens).forEach(s => s.classList.remove('active'));
  const target = screens[name];
  if (target) {
    target.classList.add('active');
    target.querySelectorAll('.animate-in').forEach(el => {
      el.style.animation = 'none';
      el.offsetHeight;
      el.style.animation = '';
    });
  }
  if (state.soundEnabled && audio.initialized) {
    playSound('whoosh');
    // Start bg ambience when reaching home or name screen (safe point — toggle has settled)
    if ((name === 'home' || name === 'name') && !audio.currentBg) {
      audio.startBgAmbience();
    }
  }
  // Stop bg ambience when entering gameplay (game has its own sounds)
  if (name === 'game' || name === 'teamGame') {
    audio.stopBgAmbience();
  }
  if (name !== 'teamLobby' && name !== 'teamDraft' && name !== 'teamGame' &&
      name !== 'teamToss' && name !== 'teamTossChoice') {
    document.getElementById('transfer-captain-btn').classList.add('hidden');
  }
}

const canvas = document.getElementById('particle-canvas');
const pCtx = canvas.getContext('2d');
let particles = [];
let animFrameId = null;

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

class Particle {
  constructor() {
    this.reset();
  }
  reset() {
    this.x = Math.random() * canvas.width;
    this.y = Math.random() * canvas.height;
    this.size = Math.random() * 2 + 0.5;
    this.speedX = (Math.random() - 0.5) * 0.3;
    this.speedY = (Math.random() - 0.5) * 0.3;
    this.opacity = Math.random() * 0.5 + 0.1;
    this.hue = Math.random() > 0.5 ? 190 : 270;
    this.life = Math.random() * 200 + 100;
    this.maxLife = this.life;
  }
  update() {
    this.x += this.speedX;
    this.y += this.speedY;
    this.life--;
    this.opacity = (this.life / this.maxLife) * 0.4;
    if (this.life <= 0 || this.x < 0 || this.x > canvas.width || this.y < 0 || this.y > canvas.height) {
      this.reset();
    }
  }
  draw() {
    pCtx.beginPath();
    pCtx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    pCtx.fillStyle = `hsla(${this.hue}, 100%, 70%, ${this.opacity})`;
    pCtx.fill();
  }
}

function initParticles() {
  resizeCanvas();
  particles = [];
  const count = Math.min(80, Math.floor((canvas.width * canvas.height) / 15000));
  for (let i = 0; i < count; i++) particles.push(new Particle());
}

function drawConnections() {
  for (let i = 0; i < particles.length; i++) {
    for (let j = i + 1; j < particles.length; j++) {
      const dx = particles[i].x - particles[j].x;
      const dy = particles[i].y - particles[j].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 120) {
        pCtx.beginPath();
        pCtx.moveTo(particles[i].x, particles[i].y);
        pCtx.lineTo(particles[j].x, particles[j].y);
        pCtx.strokeStyle = `rgba(0, 229, 255, ${(1 - dist / 120) * 0.08})`;
        pCtx.lineWidth = 0.5;
        pCtx.stroke();
      }
    }
  }
}

function animateParticles() {
  if (!state.particlesEnabled) {
    pCtx.clearRect(0, 0, canvas.width, canvas.height);
    animFrameId = requestAnimationFrame(animateParticles);
    return;
  }
  pCtx.clearRect(0, 0, canvas.width, canvas.height);
  particles.forEach(p => { p.update(); p.draw(); });
  drawConnections();
  animFrameId = requestAnimationFrame(animateParticles);
}

window.addEventListener('resize', () => { resizeCanvas(); });
initParticles();
animateParticles();

function spawnConfetti(containerId = 'confetti-container') {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  const colors = ['#00e5ff', '#b388ff', '#ff4081', '#ffd740', '#69f0ae', '#ffffff'];
  for (let i = 0; i < 80; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.left = Math.random() * 100 + '%';
    piece.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
    piece.style.width = (Math.random() * 10 + 5) + 'px';
    piece.style.height = (Math.random() * 10 + 5) + 'px';
    piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
    piece.style.animationDuration = (Math.random() * 2.5 + 2) + 's';
    piece.style.animationDelay = (Math.random() * 2) + 's';
    container.appendChild(piece);
  }
  setTimeout(() => { container.innerHTML = ''; }, 6000);
}

if (state.playerName) {
  state.playerName = capitalizeFirst(state.playerName);
  localStorage.setItem('hc_playerName', state.playerName);
  showScreen('home');
  document.getElementById('player-display-name').textContent = state.playerName;
  document.getElementById('settings-name-input').value = state.playerName;
} else {
  showScreen('name');
}

document.getElementById('name-submit-btn').addEventListener('click', () => {
  const name = capitalizeFirst(document.getElementById('player-name-input').value.trim());
  if (!name) {
    document.getElementById('player-name-input').style.borderColor = 'var(--red)';
    document.getElementById('player-name-input').style.animation = 'shakeX 0.5s ease';
    setTimeout(() => { document.getElementById('player-name-input').style.animation = ''; }, 500);
    return;
  }
  state.playerName = name;
  localStorage.setItem('hc_playerName', name);
  document.getElementById('player-display-name').textContent = name;
  document.getElementById('settings-name-input').value = name;
  playSound('success');
  showScreen('home');
});

document.getElementById('player-name-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('name-submit-btn').click();
});

document.getElementById('mode-1v1-btn').addEventListener('click', () => {
  state.mode = '1v1';
  playSound('click');
  showScreen('room');
});

document.getElementById('mode-team-btn').addEventListener('click', () => {
  state.mode = 'team';
  playSound('click');
  showScreen('room');
});



document.getElementById('settings-back-btn').addEventListener('click', () => {
  playSound('click');
  showScreen('home');
});

document.getElementById('settings-save-name').addEventListener('click', () => {
  const name = capitalizeFirst(document.getElementById('settings-name-input').value.trim());
  if (name) {
    state.playerName = name;
    localStorage.setItem('hc_playerName', name);
    document.getElementById('player-display-name').textContent = name;
    playSound('success');
  }
});

document.getElementById('sound-toggle').checked = state.soundEnabled;

document.getElementById('sound-toggle').addEventListener('change', (e) => {
  state.soundEnabled = e.target.checked;
  localStorage.setItem('hc_sound', e.target.checked);

  if (!audio.initialized && e.target.checked) audio.init();
  audio.setMuted(!e.target.checked);

  // Keep quick-settings toggle in sync
  const q = document.getElementById('sound-toggle-quick');
  if (q) q.checked = e.target.checked;
});

const soundToggleQuick = document.getElementById('sound-toggle-quick');
if (soundToggleQuick) {
  soundToggleQuick.checked = state.soundEnabled;
  soundToggleQuick.addEventListener('change', (e) => {
    state.soundEnabled = e.target.checked;
    localStorage.setItem('hc_sound', e.target.checked);
    document.getElementById('sound-toggle').checked = e.target.checked;

    if (!audio.initialized && e.target.checked) audio.init();
    audio.setMuted(!e.target.checked);
  });
}



document.getElementById('room-back-btn').addEventListener('click', () => {
  playSound('click');
  showScreen('home');
});

document.getElementById('create-room-btn').addEventListener('click', () => {
  playSound('click');
  const payload = { mode: state.mode, playerName: state.playerName };
  socket.emit('create-room', payload);
});

document.getElementById('join-room-btn').addEventListener('click', () => {
  playSound('click');
  document.getElementById('join-code-input').value = '';
  document.getElementById('join-error-msg').classList.add('hidden');
  showScreen('join');
});

document.getElementById('waiting-back-btn').addEventListener('click', () => {
  playSound('click');
  showScreen('room');
});

document.getElementById('join-back-btn').addEventListener('click', () => {
  playSound('click');
  showScreen('room');
});

document.getElementById('copy-code-btn').addEventListener('click', () => {
  const code = document.getElementById('room-code-text').textContent;
  navigator.clipboard.writeText(code).catch(() => {});
  playSound('success');
  const btn = document.getElementById('copy-code-btn');
  btn.innerHTML = '✓';
  setTimeout(() => {
    btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  }, 1500);
});

document.getElementById('join-submit-btn').addEventListener('click', () => {
  const code = document.getElementById('join-code-input').value.trim().toUpperCase();
  if (!code || code.length < 4) {
    document.getElementById('join-error-msg').textContent = 'Please enter a valid room code';
    document.getElementById('join-error-msg').classList.remove('hidden');
    playSound('fail');
    return;
  }
  document.getElementById('join-error-msg').classList.add('hidden');
  socket.emit('join-room', { code, playerName: state.playerName });
});

document.getElementById('join-code-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('join-submit-btn').click();
});

socket.on('room-created', (data) => {
  state.roomCode = data.code;
  document.getElementById('room-code-text').textContent = data.code;

  if (state.mode === 'team') {
    document.getElementById('lobby-code-text').textContent = data.code;
    document.getElementById('lobby-code-row').classList.remove('hidden');
    playSound('success');
    showScreen('teamLobby');
    return;
  }

  playSound('success');
  showScreen('waiting');
});

socket.on('join-error', (data) => {
  document.getElementById('join-error-msg').textContent = data.message;
  document.getElementById('join-error-msg').classList.remove('hidden');
  playSound('fail');
});

socket.on('game-start', (data) => {
  state.players = data.players;
  state.playerId = socket.id;

  const me = data.players.find(p => p.id === socket.id);
  const opp = data.players.find(p => p.id !== socket.id);

  document.getElementById('rps-name-left').textContent = me.name;
  document.getElementById('rps-name-right').textContent = opp.name;
  document.getElementById('rps-player-left').className = 'rps-player ' + pcClass(me.id) + '-card';
  document.getElementById('rps-player-right').className = 'rps-player ' + pcClass(opp.id) + '-card';
  document.getElementById('rps-name-left').className = 'rps-player-name ' + pcClass(me.id);
  document.getElementById('rps-name-right').className = 'rps-player-name ' + pcClass(opp.id);
  document.getElementById('rps-hand-left').textContent = '❓';
  document.getElementById('rps-hand-right').textContent = '❓';
  document.getElementById('rps-status-left').textContent = 'Choosing...';
  document.getElementById('rps-status-right').textContent = 'Choosing...';

  document.querySelectorAll('#rps-choices .rps-btn').forEach(b => {
    b.classList.remove('selected');
    b.disabled = false;
  });

  playSound('success');
  showScreen('rps');
});

document.querySelectorAll('#rps-choices .rps-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const choice = btn.dataset.choice;
    socket.emit('rps-choice', { choice });
    playSound('click');

    document.querySelectorAll('#rps-choices .rps-btn').forEach(b => {
      b.classList.remove('selected');
      b.disabled = true;
    });
    btn.classList.add('selected');
    btn.disabled = false;

    document.getElementById('rps-hand-left').textContent = RPS_EMOJIS[choice];
    document.getElementById('rps-hand-left').classList.add('locked');
    document.getElementById('rps-status-left').textContent = 'Locked in!';
  });
});

socket.on('opponent-rps-locked', () => {
  document.getElementById('rps-hand-right').classList.add('locked');
  document.getElementById('rps-status-right').textContent = 'Locked in!';
  playSound('tick');
});

socket.on('rps-timer', (data) => {
  const time = data.time;
  document.getElementById('rps-timer-text').textContent = time;
  const progress = document.getElementById('rps-timer-progress');
  const offset = 283 - (time / 10) * 283;
  progress.style.strokeDashoffset = offset;
  progress.classList.remove('warning', 'danger');
  if (time <= 3) progress.classList.add('danger');
  else if (time <= 5) progress.classList.add('warning');
  if (time <= 5) playSound('tenseTick');
});

socket.on('rps-draw', () => {
  document.getElementById('rps-hand-left').textContent = '🤝';
  document.getElementById('rps-hand-right').textContent = '🤝';
  document.getElementById('rps-status-left').textContent = "It's a draw!";
  document.getElementById('rps-status-right').textContent = "It's a draw!";

  setTimeout(() => {
    document.getElementById('rps-hand-left').textContent = '❓';
    document.getElementById('rps-hand-right').textContent = '❓';
    document.getElementById('rps-hand-left').classList.remove('locked', 'revealed');
    document.getElementById('rps-hand-right').classList.remove('locked', 'revealed');
    document.getElementById('rps-status-left').textContent = 'Choosing...';
    document.getElementById('rps-status-right').textContent = 'Choosing...';
    document.querySelectorAll('#rps-choices .rps-btn').forEach(b => {
      b.classList.remove('selected');
      b.disabled = false;
    });
  }, 1800);
});

socket.on('rps-result', (data) => {
  const me = socket.id;
  const opp = state.players.find(p => p.id !== me)?.id;

  document.getElementById('rps-hand-left').textContent = RPS_EMOJIS[data.choices[me]];
  document.getElementById('rps-hand-right').textContent = RPS_EMOJIS[data.choices[opp]];
  document.getElementById('rps-hand-left').classList.add('revealed');
  document.getElementById('rps-hand-right').classList.add('revealed');

  playSound('rpsReveal');

  const isWinner = data.winnerId === me;
  document.getElementById('rps-status-left').textContent = isWinner ? '🏆 Winner!' : '';
  document.getElementById('rps-status-right').textContent = !isWinner ? '🏆 Winner!' : '';

  setTimeout(() => {
    playSound(isWinner ? 'success' : 'fail');
  }, 500);

  setTimeout(() => {
    if (isWinner) {
      showScreen('tossChoice');
      document.getElementById('toss-loser-msg').classList.add('hidden');
      document.getElementById('toss-choice-buttons').classList.remove('hidden');
    } else {
      showScreen('tossChoice');
      document.querySelector('#toss-choice-screen .toss-panel h2').textContent = `${data.winnerName} won the toss!`;
      document.getElementById('toss-choice-buttons').classList.add('hidden');
      document.getElementById('toss-loser-msg').textContent = `Waiting for ${data.winnerName} to choose...`;
      document.getElementById('toss-loser-msg').classList.remove('hidden');
    }
  }, 2500);
});

document.querySelectorAll('#toss-choice-buttons .toss-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const choice = btn.dataset.choice;
    socket.emit('toss-decision', { choice });
    playSound('click');
    document.querySelectorAll('#toss-choice-buttons .toss-btn').forEach(b => b.disabled = true);
  });
});

socket.on('innings-start', (data) => {
  state.isBatting = data.battingId === socket.id;
  state.locked = false;

  const me = socket.id;
  const opp = state.players.find(p => p.id !== me)?.id;
  const myData = me === data.battingId
    ? { name: state.players.find(p => p.id === me)?.name, role: '🏏 Batting', score: 0, balls: 0 }
    : { name: state.players.find(p => p.id === me)?.name, role: '🎯 Bowling', score: 0, balls: 0 };
  const oppData = opp === data.battingId
    ? { name: state.players.find(p => p.id === opp)?.name, role: '🏏 Batting', score: 0, balls: 0 }
    : { name: state.players.find(p => p.id === opp)?.name, role: '🎯 Bowling', score: 0, balls: 0 };

  document.getElementById('hud-player-left').className = 'hud-player ' + pcClass(me) + '-card';
  document.getElementById('hud-player-right').className = 'hud-player ' + pcClass(opp) + '-card';
  document.getElementById('hud-name-left').textContent = myData.name;
  document.getElementById('hud-name-left').className = 'hud-name ' + pcClass(me);
  document.getElementById('hud-role-left').textContent = myData.role;
  document.getElementById('hud-score-left').textContent = '0';
  document.getElementById('hud-balls-left').textContent = '(0 balls)';
  document.getElementById('hud-name-right').textContent = oppData.name;
  document.getElementById('hud-name-right').className = 'hud-name ' + pcClass(opp);
  document.getElementById('hud-role-right').textContent = oppData.role;
  document.getElementById('hud-score-right').textContent = '0';
  document.getElementById('hud-balls-right').textContent = '(0 balls)';

  document.getElementById('hud-innings').textContent = '1st Innings';
  document.getElementById('hud-target').classList.add('hidden');

  document.getElementById('game-instruction').textContent = state.isBatting
    ? 'You are BATTING! Pick your runs!' : 'You are BOWLING! Pick a number!';

  resetNumberGrid();
  showScreen('game');
});

function resetNumberGrid() {
  state.locked = false;
  document.querySelectorAll('#number-grid .num-btn').forEach(b => {
    b.classList.remove('selected');
    b.disabled = false;
  });
  document.getElementById('ball-result-overlay').classList.add('hidden');
}

document.querySelectorAll('#number-grid .num-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (state.locked) return;
    const num = btn.dataset.num;
    state.locked = true;
    playSound('click');

    document.querySelectorAll('#number-grid .num-btn').forEach(b => {
      b.classList.remove('selected');
      b.disabled = true;
    });
    btn.classList.add('selected');

    socket.emit('play-number', { number: num });
  });
});

socket.on('opponent-locked', () => {
  playSound('tick');
});

socket.on('ball-timer', (data) => {
  const time = data.time;
  document.getElementById('game-timer-text').textContent = time;
  const progress = document.getElementById('game-timer-progress');
  const offset = 283 - (time / 10) * 283;
  progress.style.strokeDashoffset = offset;
  progress.classList.remove('warning', 'danger');
  if (time <= 3) progress.classList.add('danger');
  else if (time <= 5) progress.classList.add('warning');
  if (time <= 3 && !state.locked) playSound('tenseTick');
});

socket.on('ball-result', (data) => {
  const overlay = document.getElementById('ball-result-overlay');
  overlay.classList.remove('hidden');

  document.getElementById('result-bat-hand').innerHTML = createScoreCard(data.batChoice);
  document.getElementById('result-bowl-hand').innerHTML = createScoreCard(data.bowlChoice);

  const resultText = document.getElementById('result-text');
  if (data.isOut) {
    resultText.textContent = 'OUT!';
    resultText.className = 'result-text out';
    playSound('out');
  } else {
    resultText.textContent = `+${data.runs} RUNS`;
    resultText.className = 'result-text runs';
    if (state.soundEnabled && audio.initialized) audio.batHit(data.runs);
  }

  const me = socket.id;
  if (data.battingId === me) {
    document.getElementById('hud-score-left').textContent = data.score;
    document.getElementById('hud-balls-left').textContent = `(${data.balls} balls)`;
    document.getElementById('hud-score-left').classList.add('score-pop');
    setTimeout(() => document.getElementById('hud-score-left').classList.remove('score-pop'), 500);
  } else {
    document.getElementById('hud-score-right').textContent = data.score;
    document.getElementById('hud-balls-right').textContent = `(${data.balls} balls)`;
    document.getElementById('hud-score-right').classList.add('score-pop');
    setTimeout(() => document.getElementById('hud-score-right').classList.remove('score-pop'), 500);
  }

  if (!data.isOut) {
    setTimeout(() => {
      resetNumberGrid();
    }, 1400);
  }
});

socket.on('innings-change', (data) => {
  state.isBatting = data.battingId === socket.id;
  state.locked = false;

  const gameArena = document.querySelector('.game-arena');
  const overlay = document.createElement('div');
  overlay.className = 'innings-overlay';
  overlay.innerHTML = `
    <h2>2nd Innings</h2>
    <p>${data.battingName} is now batting</p>
    <div class="target-display">Target: ${data.target} runs</div>
  `;
  gameArena.appendChild(overlay);

  playSound('inningsChange');

  const me = socket.id;

  if (data.battingId === me) {
    document.getElementById('hud-role-left').textContent = '🏏 Batting';
    document.getElementById('hud-score-left').textContent = '0';
    document.getElementById('hud-balls-left').textContent = '(0 balls)';
    document.getElementById('hud-role-right').textContent = '🎯 Bowling';
  } else {
    document.getElementById('hud-role-left').textContent = '🎯 Bowling';
    document.getElementById('hud-role-right').textContent = '🏏 Batting';
    document.getElementById('hud-score-right').textContent = '0';
    document.getElementById('hud-balls-right').textContent = '(0 balls)';
  }

  document.getElementById('hud-innings').textContent = '2nd Innings';
  document.getElementById('hud-target').textContent = `Target: ${data.target}`;
  document.getElementById('hud-target').classList.remove('hidden');

  document.getElementById('game-instruction').textContent = state.isBatting
    ? 'You are BATTING! Chase the target!' : 'You are BOWLING! Defend your score!';

  setTimeout(() => {
    overlay.remove();
    resetNumberGrid();
  }, 3500);
});

socket.on('match-over', (data) => {
  const isWinner = data.winnerId === socket.id;
  const isTie = data.winnerId === null;

  if (isTie) {
    document.getElementById('winner-text').textContent = 'MATCH TIED!';
  } else {
    document.getElementById('winner-text').textContent = isWinner ? 'YOU WIN!' : `${data.winnerName} Wins!`;
  }

  document.getElementById('result-message').textContent = data.message;

  const scoresDiv = document.getElementById('final-scores');
  scoresDiv.innerHTML = '';

  Object.entries(data.scores).forEach(([id, info]) => {
    const card = document.createElement('div');
    card.className = 'score-card ' + pcClass(id) + '-card' + (id === data.winnerId ? ' winner' : '');
    card.innerHTML = `
      <div class="sc-name ${pcClass(id)}">${escapeHtml(info.name)}</div>
      <div class="sc-score">${info.score}</div>
      <div class="sc-balls">${info.balls} balls</div>
    `;
    scoresDiv.appendChild(card);
  });

  showScreen('result');

  if (isWinner) {
    spawnConfetti();
    playSound('win');
  } else {
    playSound('defeat');
  }
});

document.getElementById('play-again-btn').addEventListener('click', () => {
  playSound('click');
  showScreen('home');
});

socket.on('game-error', (data) => {
  const modal = document.getElementById('error-modal');
  document.getElementById('error-message').textContent = data.message;
  modal.classList.remove('hidden');
  playSound('fail');
});

document.getElementById('error-ok-btn').addEventListener('click', () => {
  document.getElementById('error-modal').classList.add('hidden');
  playSound('click');
  // Non-fatal errors (e.g. "need more players") happen while the lobby is
  // still alive server-side, so don't boot the host back to the home screen.
  if (currentScreenName !== 'teamLobby') {
    showScreen('home');
  }
});

document.querySelectorAll('.mode-card, .room-card, .btn, .num-btn, .rps-btn, .toss-btn, .btn-icon, .back-btn').forEach(el => {
  el.addEventListener('mouseenter', function(e) {
    const glow = this.querySelector('.card-glow');
    if (glow) {
      const rect = this.getBoundingClientRect();
      glow.style.left = (e.clientX - rect.left) + 'px';
      glow.style.top = (e.clientY - rect.top) + 'px';
      glow.style.opacity = '0.5';
    }
  });

  el.addEventListener('mousemove', function(e) {
    const glow = this.querySelector('.card-glow');
    if (glow) {
      const rect = this.getBoundingClientRect();
      glow.style.left = (e.clientX - rect.left) + 'px';
      glow.style.top = (e.clientY - rect.top) + 'px';
    }
  });

  el.addEventListener('mouseleave', function() {
    const glow = this.querySelector('.card-glow');
    if (glow) glow.style.opacity = '0';
  });
});

// ===== REACTIONS SYSTEM =====
document.querySelectorAll('.reaction-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const emoji = btn.dataset.emoji;
    socket.emit('reaction', { emoji });
    btn.classList.add('just-sent');
    setTimeout(() => btn.classList.remove('just-sent'), 400);
    playSound('click');
  });
});

socket.on('reaction', (data) => {
  const container = document.getElementById(state.mode === 'team' ? 't-floating-reactions' : 'floating-reactions');
  const el = document.createElement('div');
  el.className = 'floating-emoji';
  el.textContent = data.emoji;
  el.style.left = Math.random() * 30 + 'px';
  el.style.animationDelay = Math.random() * 0.2 + 's';
  container.appendChild(el);
  setTimeout(() => el.remove(), 2500);

  if (data.senderId !== socket.id) {
    playSound('tick');
  }
});

// ===== CHAT SYSTEM =====
const chatToggle = document.getElementById('chat-toggle-btn');
const chatPanel = document.getElementById('chat-panel');
const chatClose = document.getElementById('chat-close-btn');
const chatInput = document.getElementById('chat-input');
const chatSend = document.getElementById('chat-send-btn');
const chatMessages = document.getElementById('chat-messages');
const chatBadge = document.getElementById('chat-badge');
let chatOpen = false;

chatToggle.addEventListener('click', () => {
  chatOpen = !chatOpen;
  if (chatOpen) {
    chatPanel.classList.remove('hidden');
    chatBadge.classList.add('hidden');
    chatInput.focus();
  } else {
    chatPanel.classList.add('hidden');
  }
  playSound('click');
});

chatClose.addEventListener('click', () => {
  chatOpen = false;
  chatPanel.classList.add('hidden');
  playSound('click');
});

function sendChatMessage() {
  const msg = chatInput.value.trim();
  if (!msg) return;
  socket.emit('chat-message', { message: msg });
  chatInput.value = '';
  playSound('click');
}

chatSend.addEventListener('click', sendChatMessage);
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendChatMessage();
});

let chatBubbleTimeout = null;

function showChatBubble(senderHtml, message) {
  const bubble = document.getElementById('chat-bubble');
  document.getElementById('chat-bubble-name').innerHTML = senderHtml + ':';
  document.getElementById('chat-bubble-text').textContent = message;
  bubble.classList.remove('hidden');
  bubble.classList.remove('bubble-out');
  void bubble.offsetWidth; // restart animation
  bubble.classList.add('bubble-in');

  if (chatBubbleTimeout) clearTimeout(chatBubbleTimeout);
  chatBubbleTimeout = setTimeout(() => {
    bubble.classList.add('bubble-out');
    setTimeout(() => bubble.classList.add('hidden'), 350);
  }, 4000);
}

socket.on('chat-message', (data) => {
  const isTeam = state.mode === 'team';
  const messages = document.getElementById(isTeam ? 't-chat-messages' : 'chat-messages');
  const div = document.createElement('div');
  const isSelf = data.senderId === socket.id;
  div.className = 'chat-msg' + (isSelf ? ' self' : '');

  let senderHtml = escapeHtml(data.senderName);
  if (isTeam && state.team) {
    const sender = state.team.players.find(p => p.id === data.senderId);
    if (sender) senderHtml = fmtPlayerName(data.senderName, !!sender.isCaptain, sender.team);
  }

  div.innerHTML = `<span class="chat-msg-name">${senderHtml}:</span><span class="chat-msg-text">${escapeHtml(data.message)}</span>`;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;

  // Only keep last 50 messages in DOM
  while (messages.children.length > 50) {
    messages.removeChild(messages.firstChild);
  }

  const open = isTeam ? tChatOpen : chatOpen;
  const badge = document.getElementById(isTeam ? 't-chat-badge' : 'chat-badge');
  if (!open && !isSelf) {
    badge.classList.remove('hidden');
    playSound('tick');
  }

  // Show the latest message as a fading bubble on the main screen, for everyone
  if (currentScreenName === 'game' || currentScreenName === 'teamGame') {
    showChatBubble(senderHtml, data.message);
  }
});

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function capitalizeFirst(str) {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ===== MILESTONE CELEBRATIONS =====
const MILESTONE_CONFIG = {
  50: { label: 'HALF CENTURY!', stars: 8, confetti: 40, duration: 3000 },
  100: { label: 'CENTURY! 💯', stars: 15, confetti: 80, duration: 4000 },
  150: { label: 'SUPER 150! ⚡', stars: 20, confetti: 100, duration: 4000 },
  200: { label: 'DOUBLE CENTURY! 🔥', stars: 30, confetti: 120, duration: 5000 },
  250: { label: 'LEGENDARY 250! 👑', stars: 35, confetti: 140, duration: 5000 },
  300: { label: 'TRIPLE CENTURY! 🏆', stars: 40, confetti: 160, duration: 6000 }
};

socket.on('milestone', (data) => {
  const pfx = state.mode === 'team' ? 't-' : '';
  const overlay = document.getElementById(pfx + 'milestone-overlay');
  const config = MILESTONE_CONFIG[data.milestone] || MILESTONE_CONFIG[50];

  // Set CSS class for milestone tier
  const milestoneContent = overlay.querySelector('.milestone-content');
  milestoneContent.className = 'milestone-content';
  if (data.milestone >= 200) {
    milestoneContent.classList.add('milestone-200');
  } else if (data.milestone >= 150) {
    milestoneContent.classList.add('milestone-150');
  } else if (data.milestone >= 100) {
    milestoneContent.classList.add('milestone-100');
  } else {
    milestoneContent.classList.add('milestone-50');
  }

  document.getElementById(pfx + 'milestone-number').textContent = data.milestone;
  document.getElementById(pfx + 'milestone-label').textContent = config.label;
  document.getElementById(pfx + 'milestone-player').textContent = `🏏 ${data.playerName} • Score: ${data.score}`;

  // Spawn decorative stars
  const starsContainer = document.getElementById(pfx + 'milestone-stars');
  starsContainer.innerHTML = '';
  const starEmojis = ['⭐', '✨', '🌟', '💫', '⚡'];
  for (let i = 0; i < config.stars; i++) {
    const star = document.createElement('div');
    star.className = 'milestone-star';
    star.textContent = starEmojis[Math.floor(Math.random() * starEmojis.length)];
    star.style.left = Math.random() * 100 + '%';
    star.style.top = Math.random() * 100 + '%';
    star.style.animationDelay = Math.random() * 1 + 's';
    star.style.fontSize = (16 + Math.random() * 20) + 'px';
    starsContainer.appendChild(star);
  }

  overlay.classList.remove('hidden');

  // Play tiered celebration sound
  if (data.milestone >= 200) {
    playSound('milestone200');
  } else if (data.milestone >= 100) {
    playSound('milestone100');
  } else {
    playSound('milestone50');
  }

  // Spawn confetti - more for higher milestones
  spawnConfetti();

  setTimeout(() => {
    overlay.classList.add('hidden');
  }, config.duration);
});


// ===================================================================
// ===== TEAM BATTLE MODE ============================================
// ===================================================================

function teamMe() {
  return state.team ? state.team.players.find(p => p.id === socket.id) : null;
}

function fmtPlayerName(name, isCaptain, team) {
  const safe = escapeHtml(name);
  const colorClass = team === 'A' ? 'tc-a' : team === 'B' ? 'tc-b' : '';
  const classes = [colorClass, isCaptain ? 'captain-name' : ''].filter(Boolean).join(' ');
  const label = isCaptain ? `👑 ${safe}` : safe;
  return `<span class="${classes}">${label}</span>`;
}

function renderChipList(containerId, list, data) {
  const el = document.getElementById(containerId);
  el.innerHTML = '';
  if (!list.length) {
    el.innerHTML = '<span class="player-chip empty">Empty</span>';
    return;
  }
  list.forEach(p => {
    const full = data.players.find(x => x.id === p.id) || p;
    const chip = document.createElement('div');
    chip.className = 'player-chip';
    if (full.team === 'A') chip.classList.add('team-color-a');
    if (full.team === 'B') chip.classList.add('team-color-b');
    if (p.id === socket.id) chip.classList.add('is-you');
    if (full.isOut) chip.classList.add('out');
    let label = fmtPlayerName(p.name, !!full.isCaptain, full.team);
    if (p.id === socket.id) label += ' (You)';
    chip.innerHTML = label;
    el.appendChild(chip);
  });
}

document.getElementById('team-lobby-back-btn').addEventListener('click', () => {
  playSound('click');
  showScreen('home');
});

document.getElementById('lobby-copy-code-btn').addEventListener('click', () => {
  const code = document.getElementById('lobby-code-text').textContent;
  navigator.clipboard.writeText(code).catch(() => {});
  playSound('success');
  const btn = document.getElementById('lobby-copy-code-btn');
  btn.innerHTML = '✓';
  setTimeout(() => {
    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  }, 1500);
});

document.getElementById('lobby-start-btn').addEventListener('click', () => {
  playSound('click');
  socket.emit('team-start-game');
});

function formatLobbyTime(seconds) {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

socket.on('team-lobby-timer', (data) => {
  document.getElementById('lobby-timer-value').textContent = formatLobbyTime(data.time);
});

socket.on('team-lobby-timeout', () => {
  document.getElementById('lobby-timer-value').textContent = "Time's up";
});

// ----- Lobby rendering -----
function renderLobby(data) {
  state.isHost = data.hostId === socket.id;

  document.getElementById('lobby-status').textContent =
    `${data.players.length} player${data.players.length === 1 ? '' : 's'} in the room`;

  renderChipList('lobby-team-a', data.players.filter(p => p.team === 'A'), data);
  renderChipList('lobby-team-b', data.players.filter(p => p.team === 'B'), data);
  renderChipList('lobby-unassigned', data.unassigned, data);

  const canStart = !!(data.captains.A && data.captains.B);
  const startBtn = document.getElementById('lobby-start-btn');
  const waitMsg = document.getElementById('lobby-wait-host-msg');

  if (state.isHost) {
    startBtn.classList.remove('hidden');
    startBtn.disabled = !canStart;
    if (!canStart) {
      waitMsg.classList.remove('hidden');
      waitMsg.textContent = 'Need at least 2 players (one per team) to start.';
    } else {
      waitMsg.classList.add('hidden');
    }
  } else {
    startBtn.classList.add('hidden');
    waitMsg.classList.remove('hidden');
    waitMsg.textContent = canStart
      ? 'Waiting for the host to start the match...'
      : 'Waiting for more players to join...';
  }
}

// ----- Draft Toss / Match Toss -----
let teamTossState = null;

socket.on('team-toss-start', (data) => {
  teamTossState = data;
  const isDraft = data.type === 'draft';

  document.getElementById('tt-title').textContent = isDraft ? '🎲 Draft Toss!' : '🪙 Match Toss!';
  document.getElementById('tt-subtitle').textContent = isDraft
    ? 'Captains play Rock Paper Scissors — winner drafts first'
    : 'Captains play Rock Paper Scissors — winner picks Bat or Bowl';

  document.getElementById('tt-name-left').innerHTML = fmtPlayerName(data.p1.name, true, data.p1.team);
  document.getElementById('tt-name-right').innerHTML = fmtPlayerName(data.p2.name, true, data.p2.team);
  document.getElementById('tt-player-left').className = 'rps-player' + (data.p1.team === 'A' ? ' team-color-a' : data.p1.team === 'B' ? ' team-color-b' : '');
  document.getElementById('tt-player-right').className = 'rps-player' + (data.p2.team === 'A' ? ' team-color-a' : data.p2.team === 'B' ? ' team-color-b' : '');
  document.getElementById('tt-hand-left').textContent = '❓';
  document.getElementById('tt-hand-right').textContent = '❓';
  document.getElementById('tt-hand-left').classList.remove('locked', 'revealed');
  document.getElementById('tt-hand-right').classList.remove('locked', 'revealed');
  document.getElementById('tt-status-left').textContent = 'Choosing...';
  document.getElementById('tt-status-right').textContent = 'Choosing...';

  const amParticipant = socket.id === data.p1.id || socket.id === data.p2.id;
  document.getElementById('tt-choices').classList.toggle('hidden', !amParticipant);
  document.getElementById('tt-spectate-msg').classList.toggle('hidden', amParticipant);
  if (!amParticipant) {
    document.getElementById('tt-spectate-msg').textContent =
      `Captains ${data.p1.name} & ${data.p2.name} are tossing...`;
  }

  document.querySelectorAll('#tt-choices .rps-btn').forEach(b => {
    b.classList.remove('selected');
    b.disabled = false;
  });

  playSound('success');
  showScreen('teamToss');
});

document.querySelectorAll('#tt-choices .rps-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const choice = btn.dataset.choice;
    socket.emit('team-toss-choice', { choice });
    playSound('click');

    document.querySelectorAll('#tt-choices .rps-btn').forEach(b => {
      b.classList.remove('selected');
      b.disabled = true;
    });
    btn.classList.add('selected');
    btn.disabled = false;

    const mySide = (teamTossState && socket.id === teamTossState.p1.id) ? 'left' : 'right';
    document.getElementById(`tt-hand-${mySide}`).textContent = RPS_EMOJIS[choice];
    document.getElementById(`tt-hand-${mySide}`).classList.add('locked');
    document.getElementById(`tt-status-${mySide}`).textContent = 'Locked in!';
  });
});

socket.on('team-toss-opponent-locked', () => {
  const oppSide = (teamTossState && socket.id === teamTossState.p1.id) ? 'right' : 'left';
  document.getElementById(`tt-hand-${oppSide}`).classList.add('locked');
  document.getElementById(`tt-status-${oppSide}`).textContent = 'Locked in!';
  playSound('tick');
});

socket.on('team-toss-timer', (data) => {
  const time = data.time;
  document.getElementById('tt-timer-text').textContent = time;
  const progress = document.getElementById('tt-timer-progress');
  const offset = 283 - (time / 10) * 283;
  progress.style.strokeDashoffset = offset;
  progress.classList.remove('warning', 'danger');
  if (time <= 3) progress.classList.add('danger');
  else if (time <= 5) progress.classList.add('warning');
  if (time <= 5) playSound('tenseTick');
});

socket.on('team-toss-draw', () => {
  document.getElementById('tt-hand-left').textContent = '🤝';
  document.getElementById('tt-hand-right').textContent = '🤝';
  document.getElementById('tt-status-left').textContent = "It's a draw!";
  document.getElementById('tt-status-right').textContent = "It's a draw!";

  setTimeout(() => {
    document.getElementById('tt-hand-left').textContent = '❓';
    document.getElementById('tt-hand-right').textContent = '❓';
    document.getElementById('tt-hand-left').classList.remove('locked', 'revealed');
    document.getElementById('tt-hand-right').classList.remove('locked', 'revealed');
    document.getElementById('tt-status-left').textContent = 'Choosing...';
    document.getElementById('tt-status-right').textContent = 'Choosing...';
    document.querySelectorAll('#tt-choices .rps-btn').forEach(b => {
      b.classList.remove('selected');
      b.disabled = false;
    });
  }, 1800);
});

socket.on('team-toss-result', (data) => {
  document.getElementById('tt-hand-left').textContent = RPS_EMOJIS[data.choices[data.p1.id]];
  document.getElementById('tt-hand-right').textContent = RPS_EMOJIS[data.choices[data.p2.id]];
  document.getElementById('tt-hand-left').classList.add('revealed');
  document.getElementById('tt-hand-right').classList.add('revealed');

  playSound('rpsReveal');

  const winnerSide = data.winnerId === data.p1.id ? 'left' : 'right';
  const loserSide = winnerSide === 'left' ? 'right' : 'left';
  document.getElementById(`tt-status-${winnerSide}`).textContent = '🏆 Winner!';
  document.getElementById(`tt-status-${loserSide}`).textContent = '';

  if (socket.id === data.winnerId) {
    setTimeout(() => playSound('success'), 500);
  } else if (socket.id === data.p1.id || socket.id === data.p2.id) {
    setTimeout(() => playSound('fail'), 500);
  } else {
    setTimeout(() => playSound('tick'), 500);
  }
});

// ----- Draft -----
function renderDraft(data) {
  const me = teamMe();
  const isMyTurn = !!(me && me.isCaptain && me.team === data.draftTurn);

  document.getElementById('draft-turn-text').textContent = isMyTurn
    ? "🎯 It's your turn to pick!"
    : `Team ${data.draftTurn}'s captain is picking...`;

  renderChipList('draft-team-a', data.players.filter(p => p.team === 'A'), data);
  renderChipList('draft-team-b', data.players.filter(p => p.team === 'B'), data);

  const poolEl = document.getElementById('draft-pool-list');
  poolEl.innerHTML = '';
  if (!data.unassigned.length) {
    poolEl.innerHTML = '<span class="player-chip empty">None</span>';
    return;
  }
  data.unassigned.forEach(p => {
    const chip = document.createElement('div');
    chip.className = 'player-chip';
    if (p.id === socket.id) chip.classList.add('is-you');
    chip.textContent = p.name + (p.id === socket.id ? ' (You)' : '');
    if (isMyTurn) {
      chip.classList.add('pickable');
      chip.addEventListener('click', () => {
        socket.emit('team-draft-pick', { playerId: p.id });
        playSound('click');
      });
    }
    poolEl.appendChild(chip);
  });
}

// ----- Match toss decision (bat/bowl) -----
function renderTossChoice(data) {
  const winnerTeam = data.tossWinnerTeam;
  document.getElementById('ttc-title').textContent = `🏆 Team ${winnerTeam} won the toss!`;

  const me = teamMe();
  const amDecider = !!(me && me.isCaptain && me.team === winnerTeam);

  document.getElementById('ttc-buttons').classList.toggle('hidden', !amDecider);
  document.getElementById('ttc-wait-msg').classList.toggle('hidden', amDecider);
  if (!amDecider) {
    document.getElementById('ttc-wait-msg').textContent = `Waiting for Team ${winnerTeam}'s captain to choose...`;
  }
  document.querySelectorAll('#ttc-buttons .toss-btn').forEach(b => b.disabled = false);
}

document.querySelectorAll('#ttc-buttons .toss-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const choice = btn.dataset.choice;
    socket.emit('team-toss-decision', { choice });
    playSound('click');
    document.querySelectorAll('#ttc-buttons .toss-btn').forEach(b => b.disabled = true);
  });
});

// ----- Bowler / Batsman selection modal -----
function renderSelectModal(data) {
  const listEl = document.getElementById('select-modal-list');
  listEl.innerHTML = '';
  const me = teamMe();

  if (data.phase === 'select-bowler') {
    document.getElementById('select-modal-icon').textContent = '🎯';
    document.getElementById('select-modal-title').textContent = 'Select Bowler';

    const eligible = data.players.filter(p => p.team === data.bowlingTeam && p.id !== data.lastBowlerId);
    const captain = data.players.find(p => p.id === data.captains[data.bowlingTeam]);
    const amCaptain = !!(me && captain && me.id === captain.id);

    document.getElementById('select-modal-subtitle').innerHTML = amCaptain
      ? 'Pick your bowler for this over'
      : `Waiting for ${fmtPlayerName(captain ? captain.name : 'the captain', !!captain, captain ? captain.team : null)} to pick a bowler...`;

    if (amCaptain) {
      eligible.forEach(p => {
        const btn = document.createElement('button');
        btn.className = 'player-pick-btn';
        btn.innerHTML = `<span class="ppb-label">${p.id === socket.id ? '👤 ' : ''}${fmtPlayerName(p.name, p.isCaptain, p.team)}</span>`;
        btn.addEventListener('click', () => {
          socket.emit('team-select-bowler', { bowlerId: p.id });
          playSound('click');
        });
        listEl.appendChild(btn);
      });
    }
  } else if (data.phase === 'select-batsman') {
    document.getElementById('select-modal-icon').textContent = '🏏';
    document.getElementById('select-modal-title').textContent = 'Select Batsman';

    const eligible = data.players.filter(p => p.team === data.battingTeam && !p.isOut);
    const captain = data.players.find(p => p.id === data.captains[data.battingTeam]);
    const amCaptain = !!(me && captain && me.id === captain.id);

    document.getElementById('select-modal-subtitle').innerHTML = amCaptain
      ? 'Pick your next batsman'
      : `Waiting for ${fmtPlayerName(captain ? captain.name : 'the captain', !!captain, captain ? captain.team : null)} to pick a batsman...`;

    if (amCaptain) {
      // Every eligible player here is yet to bat (0/0 by definition), so we
      // just show the name — a score line would always read "0 (0 balls)".
      eligible.forEach(p => {
        const btn = document.createElement('button');
        btn.className = 'player-pick-btn';
        btn.innerHTML = `<span class="ppb-label">${p.id === socket.id ? '👤 ' : ''}${fmtPlayerName(p.name, p.isCaptain, p.team)}</span>`;
        btn.addEventListener('click', () => {
          socket.emit('team-select-batsman', { batsmanId: p.id });
          playSound('click');
        });
        listEl.appendChild(btn);
      });
    }
  }

  document.getElementById('team-select-modal').classList.remove('hidden');
}

function hideSelectModal() {
  document.getElementById('team-select-modal').classList.add('hidden');
}

// ----- Team game HUD -----
function renderTeamGameHud(data) {
  document.getElementById('t-hud-innings').textContent = data.innings === 1 ? '1st Innings' : '2nd Innings';

  const targetEl = document.getElementById('t-hud-target');
  if (data.innings === 2 && data.target) {
    targetEl.textContent = `Target: ${data.target}`;
    targetEl.classList.remove('hidden');
  } else {
    targetEl.classList.add('hidden');
  }

  document.getElementById('t-over-display').textContent = `Over ${data.overNumber}.${data.ballsInOver}`;
  document.getElementById('t-team-a-score').textContent = `${data.teamScores.A.runs}/${data.teamScores.A.wickets}`;
  document.getElementById('t-team-b-score').textContent = `${data.teamScores.B.runs}/${data.teamScores.B.wickets}`;
  document.getElementById('t-team-a-card').classList.toggle('active-team', data.battingTeam === 'A');
  document.getElementById('t-team-b-card').classList.toggle('active-team', data.battingTeam === 'B');

  const batsman = data.players.find(p => p.id === data.currentBatsmanId);
  const bowler = data.players.find(p => p.id === data.currentBowlerId);
  document.getElementById('t-batsman-name').innerHTML = batsman ? fmtPlayerName(batsman.name, batsman.isCaptain, batsman.team) : '--';
  document.getElementById('t-batsman-score').textContent = batsman ? `(${batsman.score})` : '';
  document.getElementById('t-bowler-name').innerHTML = bowler ? fmtPlayerName(bowler.name, bowler.isCaptain, bowler.team) : '--';
}

// ----- Active player vs spectator view -----
function resetTeamNumberGrid() {
  state.teamLocked = false;
  document.querySelectorAll('#t-number-grid .num-btn').forEach(b => {
    b.classList.remove('selected');
    b.disabled = false;
  });
  document.getElementById('t-ball-result-overlay').classList.add('hidden');
}

document.querySelectorAll('#t-number-grid .num-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (state.teamLocked) return;
    const num = btn.dataset.num;
    state.teamLocked = true;
    playSound('click');

    document.querySelectorAll('#t-number-grid .num-btn').forEach(b => {
      b.classList.remove('selected');
      b.disabled = true;
    });
    btn.classList.add('selected');

    socket.emit('team-play-number', { number: num });
  });
});

function renderActiveOrSpectate(data) {
  const amBatsman = data.currentBatsmanId === socket.id;
  const amBowler = data.currentBowlerId === socket.id;

  if (amBatsman || amBowler) {
    document.getElementById('t-active-view').classList.remove('hidden');
    document.getElementById('t-spectate-view').classList.add('hidden');
    document.getElementById('t-game-instruction').textContent = amBatsman
      ? '🏏 You are BATTING! Pick your runs!'
      : '🎯 You are BOWLING! Pick a number!';
    resetTeamNumberGrid();
  } else {
    document.getElementById('t-active-view').classList.add('hidden');
    document.getElementById('t-spectate-view').classList.remove('hidden');
  }
}

socket.on('team-ball-timer', (data) => {
  const time = data.time;
  document.getElementById('t-game-timer-text').textContent = time;
  const progress = document.getElementById('t-game-timer-progress');
  const offset = 283 - (time / 12) * 283;
  progress.style.strokeDashoffset = offset;
  progress.classList.remove('warning', 'danger');
  if (time <= 3) progress.classList.add('danger');
  else if (time <= 5) progress.classList.add('warning');
  if (time <= 3 && !state.teamLocked) playSound('tenseTick');
});

socket.on('team-opponent-locked', () => {
  playSound('tick');
});

// ----- Ball result -----
socket.on('team-ball-result', (data) => {
  const overlay = document.getElementById('t-ball-result-overlay');
  overlay.classList.remove('hidden');

  document.getElementById('t-result-bat-hand').innerHTML = createScoreCard(data.batChoice);
  document.getElementById('t-result-bowl-hand').innerHTML = createScoreCard(data.bowlChoice);

  const resultText = document.getElementById('t-result-text');
  if (data.isOut) {
    resultText.textContent = 'OUT!';
    resultText.className = 'result-text out';
    playSound('out');
  } else {
    resultText.textContent = `+${data.runs} RUN${data.runs === 1 ? '' : 'S'}`;
    resultText.className = 'result-text runs';
    if (state.soundEnabled && audio.initialized) audio.batHit(data.runs);
  }

  document.getElementById('t-team-a-score').textContent = `${data.teamScores.A.runs}/${data.teamScores.A.wickets}`;
  document.getElementById('t-team-b-score').textContent = `${data.teamScores.B.runs}/${data.teamScores.B.wickets}`;
  document.getElementById('t-batsman-score').textContent = `(${data.batsmanScore})`;
  document.getElementById('t-over-display').textContent = `Over ${data.overNumber}.${data.ballsInOver}`;

  const scoreEl = document.getElementById(data.battingTeam === 'A' ? 't-team-a-score' : 't-team-b-score');
  scoreEl.classList.add('score-pop');
  setTimeout(() => scoreEl.classList.remove('score-pop'), 500);

  setTimeout(() => {
    overlay.classList.add('hidden');
  }, data.isOut ? 1800 : 1400);

  if (!data.isOut) {
    setTimeout(() => {
      resetTeamNumberGrid();
    }, 1400);
  }
});

// ----- Innings change -----
socket.on('team-innings-change', (data) => {
  const gameArena = document.querySelector('#team-game-screen .game-arena');
  const overlay = document.createElement('div');
  overlay.className = 'innings-overlay';
  overlay.innerHTML = `
    <h2>2nd Innings</h2>
    <p>Team ${data.battingTeam} is now batting</p>
    <div class="target-display">Target: ${data.target} runs</div>
  `;
  gameArena.appendChild(overlay);

  playSound('inningsChange');

  setTimeout(() => {
    overlay.remove();
  }, 3500);
});

// ----- Commentary feed -----
socket.on('team-commentary', (data) => {
  const feed = document.getElementById('commentary-feed');
  const line = document.createElement('div');
  line.className = 'commentary-line';
  line.textContent = data.text;
  feed.appendChild(line);
  feed.scrollTop = feed.scrollHeight;
  while (feed.children.length > 40) feed.removeChild(feed.firstChild);
});

// ----- Master team state dispatcher -----
socket.on('team-state', (data) => {
  state.team = data;

  const me = teamMe();
  const showTransfer = !!(me && me.isCaptain && me.team &&
    data.players.some(p => p.team === me.team && p.id !== me.id) &&
    data.phase !== 'finished');
  document.getElementById('transfer-captain-btn').classList.toggle('hidden', !showTransfer);

  switch (data.phase) {
    case 'lobby':
      renderLobby(data);
      if (currentScreenName !== 'teamLobby') showScreen('teamLobby');
      break;

    case 'draft-toss':
    case 'match-toss':
      // handled by team-toss-start
      break;

    case 'draft':
      renderDraft(data);
      if (currentScreenName !== 'teamDraft') showScreen('teamDraft');
      break;

    case 'toss-choice':
      renderTossChoice(data);
      if (currentScreenName !== 'teamTossChoice') showScreen('teamTossChoice');
      break;

    case 'select-bowler':
    case 'select-batsman':
      if (currentScreenName !== 'teamGame') showScreen('teamGame');
      renderTeamGameHud(data);
      document.getElementById('t-active-view').classList.add('hidden');
      document.getElementById('t-spectate-view').classList.remove('hidden');
      document.getElementById('t-ball-result-overlay').classList.add('hidden');
      renderSelectModal(data);
      break;

    case 'playing':
      hideSelectModal();
      if (currentScreenName !== 'teamGame') showScreen('teamGame');
      renderTeamGameHud(data);
      renderActiveOrSpectate(data);
      break;

    case 'finished':
      // handled by team-match-over
      break;
  }
});

// ----- Match over -----
socket.on('team-match-over', (data) => {
  const me = teamMe();
  const myTeam = me ? me.team : null;
  const isWinner = myTeam === data.winningTeam;
  const isTie = data.winningTeam === null;

  if (isTie) {
    document.getElementById('t-winner-text').textContent = 'MATCH TIED!';
  } else {
    document.getElementById('t-winner-text').textContent = isWinner ? 'YOUR TEAM WINS!' : `Team ${data.winningTeam} Wins!`;
  }

  document.getElementById('t-result-message').textContent = data.message;

  const teamScoresDiv = document.getElementById('t-final-team-scores');
  teamScoresDiv.innerHTML = '';
  ['A', 'B'].forEach(team => {
    const ts = data.teamScores[team];
    const card = document.createElement('div');
    card.className = 'team-final-score-card' + (team === data.winningTeam ? ' winner' : '');
    card.innerHTML = `<div class="tfs-label">Team ${team}</div><div class="tfs-score">${ts.runs}/${ts.wickets}</div>`;
    teamScoresDiv.appendChild(card);
  });

  const playersDiv = document.getElementById('t-final-player-scores');
  playersDiv.innerHTML = '';

  const teamAPlayers = data.players.filter(p => p.team === 'A').sort((a,b) => b.score - a.score).slice(0, 2);
  const teamBPlayers = data.players.filter(p => p.team === 'B').sort((a,b) => b.score - a.score).slice(0, 2);

  const makeCard = (p, team) => {
    const isWinTeam = team === data.winningTeam;
    return `
    <div class="ts-card ts-card-${team.toLowerCase()}${isWinTeam ? ' ts-card-winner' : ''}">
      <span class="ts-card-name">${p.isCaptain ? '👑 ' : ''}${p.name}</span>
      <span class="ts-card-score">${p.score} <small>(${p.balls})</small></span>
    </div>`;
  };

  playersDiv.innerHTML = `
    <div class="top-scorers-split">
      <div class="ts-col">
        ${teamAPlayers.map(p => makeCard(p, 'A')).join('')}
      </div>
      <div class="ts-col">
        ${teamBPlayers.map(p => makeCard(p, 'B')).join('')}
      </div>
    </div>`;

  document.getElementById('transfer-captain-btn').classList.add('hidden');
  showScreen('teamResult');

  if (myTeam === null) {
    // shouldn't happen post-draft, but guard anyway
  }

  if (isWinner) {
    spawnConfetti('t-confetti-container');
    playSound('win');
  } else {
    playSound('defeat');
  }
});

document.getElementById('t-play-again-btn').addEventListener('click', () => {
  playSound('click');
  showScreen('home');
});

socket.on('team-game-error', (data) => {
  if (currentScreenName !== 'teamLobby') {
    document.getElementById('transfer-captain-btn').classList.add('hidden');
  }
  const modal = document.getElementById('error-modal');
  document.getElementById('error-message').textContent = data.message;
  modal.classList.remove('hidden');
  playSound('fail');
});

// ----- Captaincy transfer -----
document.getElementById('transfer-captain-btn').addEventListener('click', () => {
  const me = teamMe();
  if (!me || !state.team) return;

  const listEl = document.getElementById('transfer-pick-list');
  listEl.innerHTML = '';

  const teammates = state.team.players.filter(p => p.team === me.team && p.id !== me.id);
  if (!teammates.length) return;

  teammates.forEach(p => {
    const btn = document.createElement('button');
    btn.className = 'player-pick-btn';
    btn.innerHTML = `<span class="ppb-label">${fmtPlayerName(p.name, false, p.team)}</span>`;
    btn.addEventListener('click', () => {
      socket.emit('team-transfer-captain', { newCaptainId: p.id });
      document.getElementById('transfer-captain-modal').classList.add('hidden');
      playSound('click');
    });
    listEl.appendChild(btn);
  });

  document.getElementById('transfer-captain-modal').classList.remove('hidden');
  playSound('click');
});

document.getElementById('transfer-cancel-btn').addEventListener('click', () => {
  document.getElementById('transfer-captain-modal').classList.add('hidden');
  playSound('click');
});

// ----- Team chat panel -----
const tChatToggle = document.getElementById('t-chat-toggle-btn');
const tChatPanel = document.getElementById('t-chat-panel');
const tChatClose = document.getElementById('t-chat-close-btn');
const tChatInput = document.getElementById('t-chat-input');
const tChatSend = document.getElementById('t-chat-send-btn');
const tChatBadge = document.getElementById('t-chat-badge');
let tChatOpen = false;

tChatToggle.addEventListener('click', () => {
  tChatOpen = !tChatOpen;
  if (tChatOpen) {
    tChatPanel.classList.remove('hidden');
    tChatBadge.classList.add('hidden');
    tChatInput.focus();
  } else {
    tChatPanel.classList.add('hidden');
  }
  playSound('click');
});

tChatClose.addEventListener('click', () => {
  tChatOpen = false;
  tChatPanel.classList.add('hidden');
  playSound('click');
});

function sendTeamChatMessage() {
  const msg = tChatInput.value.trim();
  if (!msg) return;
  socket.emit('chat-message', { message: msg });
  tChatInput.value = '';
  playSound('click');
}

tChatSend.addEventListener('click', sendTeamChatMessage);
tChatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendTeamChatMessage();
});

// ===================================================================
// ===== LIVE SCORECARD (cricbuzz-style) ==============================
// ===================================================================

function strikeRate(score, balls) {
  if (!balls) return '0.0';
  return ((score / balls) * 100).toFixed(1);
}

function bowlingOvers(balls) {
  const overs = Math.floor(balls / 6);
  const rem = balls % 6;
  return `${overs}.${rem}`;
}

function renderScorecard(data) {
  const body = document.getElementById('scorecard-body');

  if (data.mode === 'team') {
    const teamA = data.players.filter(p => p.team === 'A');
    const teamB = data.players.filter(p => p.team === 'B');
    const ts = data.teamScores || { A: { runs: 0, wickets: 0 }, B: { runs: 0, wickets: 0 } };

    const renderTeamBlock = (label, list, score, colorClass) => {
      const battedOrBowled = list.filter(p => p.balls > 0 || p.isOut || p.ballsBowled > 0);
      const batters = list.filter(p => p.balls > 0 || p.isOut);
      const bowlers = list.filter(p => p.ballsBowled > 0);

      let html = `<div class="sc-team-block ${colorClass}">
        <div class="sc-team-header">
          <span>${label}</span>
          <span class="sc-team-total">${score.runs}/${score.wickets}</span>
        </div>`;

      if (batters.length) {
        html += `<div class="sc-section-label">Batting</div>
          <div class="sc-table-header"><span>Batter</span><span>R</span><span>B</span><span>SR</span></div>`;
        batters.forEach(p => {
          html += `<div class="sc-row">
            <span class="sc-row-name">${fmtPlayerName(p.name, p.isCaptain, p.team)}${p.isOut ? '' : ' <em>*</em>'}</span>
            <span>${p.score}</span>
            <span>${p.balls}</span>
            <span>${strikeRate(p.score, p.balls)}</span>
          </div>`;
        });
      } else {
        html += `<div class="sc-section-label">Batting</div><div class="sc-empty">Yet to bat</div>`;
      }

      if (bowlers.length) {
        html += `<div class="sc-section-label">Bowling</div>
          <div class="sc-table-header"><span>Bowler</span><span>O</span><span>R</span><span>W</span></div>`;
        bowlers.forEach(p => {
          html += `<div class="sc-row">
            <span class="sc-row-name">${fmtPlayerName(p.name, p.isCaptain, p.team)}</span>
            <span>${bowlingOvers(p.ballsBowled)}</span>
            <span>${p.runsConceded}</span>
            <span>${p.wicketsTaken}</span>
          </div>`;
        });
      }

      html += `</div>`;
      return html;
    };

    let html = '';
    if (data.target) {
      html += `<div class="sc-target-banner">🎯 Target: ${data.target} • Innings ${data.innings}</div>`;
    }
    html += renderTeamBlock('Team A', teamA, ts.A, 'team-color-a');
    html += renderTeamBlock('Team B', teamB, ts.B, 'team-color-b');
    body.innerHTML = html;
  } else {
    const players = data.players;
    let html = '';
    if (data.target) {
      html += `<div class="sc-target-banner">🎯 Target: ${data.target} • Innings ${data.innings}</div>`;
    }
    html += `<div class="sc-table-header"><span>Player</span><span>R</span><span>B</span><span>SR</span></div>`;
    players.forEach(p => {
      const isBatting = p.id === data.battingId;
      html += `<div class="sc-row ${pcClass(p.id)}">
        <span class="sc-row-name">${escapeHtml(p.name)}${isBatting ? ' <em>*</em>' : ''}</span>
        <span>${p.score}</span>
        <span>${p.balls}</span>
        <span>${strikeRate(p.score, p.balls)}</span>
      </div>`;
    });
    html += `<div class="sc-section-label">Bowling Figures</div>
      <div class="sc-table-header"><span>Player</span><span>O</span><span>R</span><span>W</span></div>`;
    players.forEach(p => {
      html += `<div class="sc-row ${pcClass(p.id)}">
        <span class="sc-row-name">${escapeHtml(p.name)}</span>
        <span>${bowlingOvers(p.ballsBowled)}</span>
        <span>${p.runsConceded}</span>
        <span>${p.wicketsTaken}</span>
      </div>`;
    });
    body.innerHTML = html;
  }
}

socket.on('scorecard-data', (data) => {
  renderScorecard(data);
});

function openScorecard() {
  document.getElementById('scorecard-body').innerHTML = '<div class="sc-loading">Loading scorecard...</div>';
  document.getElementById('scorecard-modal').classList.remove('hidden');
  socket.emit('get-scorecard');
  playSound('click');
}

document.getElementById('t-scorecard-btn').addEventListener('click', openScorecard);
document.getElementById('t-result-scorecard-btn').addEventListener('click', openScorecard);
document.getElementById('scorecard-close-btn').addEventListener('click', () => {
  document.getElementById('scorecard-modal').classList.add('hidden');
  playSound('click');
});

// ===================================================================
// ===== GLOBAL SETTINGS (top-right, every screen) ====================
// ===================================================================

const globalSettingsBtn = document.getElementById('global-settings-btn');
const quickSettingsPanel = document.getElementById('quick-settings-panel');
let screenBeforeSettings = null;

globalSettingsBtn.addEventListener('click', () => {
  quickSettingsPanel.classList.toggle('hidden');
  playSound('click');
});

document.getElementById('qsp-close-btn').addEventListener('click', () => {
  quickSettingsPanel.classList.add('hidden');
  playSound('click');
});

document.getElementById('qsp-full-settings-btn').addEventListener('click', () => {
  quickSettingsPanel.classList.add('hidden');
  screenBeforeSettings = currentScreenName;
  playSound('click');
  showScreen('settings');
});



// Close the quick settings popover when clicking outside it
document.addEventListener('click', (e) => {
  if (quickSettingsPanel.classList.contains('hidden')) return;
  if (quickSettingsPanel.contains(e.target) || globalSettingsBtn.contains(e.target)) return;
  quickSettingsPanel.classList.add('hidden');
});

// Settings-back-btn now returns to whichever screen the user came from
const settingsBackBtnEl = document.getElementById('settings-back-btn');
const newSettingsBackBtn = settingsBackBtnEl.cloneNode(true);
settingsBackBtnEl.parentNode.replaceChild(newSettingsBackBtn, settingsBackBtnEl);
newSettingsBackBtn.addEventListener('click', () => {
  playSound('click');
  showScreen(screenBeforeSettings || 'home');
  screenBeforeSettings = null;
});
