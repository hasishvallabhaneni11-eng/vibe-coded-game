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
    this.masterGain.gain.value = 0.5;
    this.masterGain.connect(this.ctx.destination);
    this.bgGain = this.ctx.createGain();
    this.bgGain.gain.value = 0;
    this.bgGain.connect(this.masterGain);
    this.initialized = true;
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
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
    if (!this.initialized) return;
    const t = this.ctx.currentTime;
    this.playNote(1200, 'sine', 0.06, t, 0.06);
    this.playNote(1800, 'sine', 0.03, t + 0.01, 0.04);
  }

  whoosh() {
    if (!this.initialized) return;
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
    if (!this.initialized) return;
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
    if (!this.initialized) return;
    const t = this.ctx.currentTime;
    this.playNote(400, 'sawtooth', 0.04, t, 0.4);
    this.playNote(300, 'sawtooth', 0.03, t + 0.1, 0.3);
    this.playNote(200, 'square', 0.02, t + 0.2, 0.3);
  }

  tick() {
    if (!this.initialized) return;
    const t = this.ctx.currentTime;
    this.playNote(1200, 'sine', 0.04, t, 0.03);
  }

  tenseTick() {
    if (!this.initialized) return;
    const t = this.ctx.currentTime;
    this.playNote(880, 'square', 0.03, t, 0.05);
    this.playNote(880, 'sine', 0.04, t, 0.08);
    this.playNote(440, 'sine', 0.02, t + 0.02, 0.06);
  }

  batHit(runs) {
    if (!this.initialized) return;
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
    if (!this.initialized) return;
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
      if (!this.initialized) return;
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
    if (!this.initialized) return;
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
    if (!this.initialized) return;
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
    if (!this.initialized) return;
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
    if (!this.initialized) return;
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
    if (!this.initialized) return;
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
    if (!this.initialized) return;
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
  if (!audio.currentBg && state.soundEnabled) audio.startBgAmbience();
}, { once: false });

document.addEventListener('touchstart', () => {
  audio.init();
  audio.resume();
  if (!audio.currentBg && state.soundEnabled) audio.startBgAmbience();
}, { once: false });

function playSound(type) {
  if (!state.soundEnabled || !audio.initialized) return;
  audio.resume();
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
  particlesEnabled: localStorage.getItem('hc_particles') !== 'false'
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
  settings: document.getElementById('settings-screen')
};

function showScreen(name) {
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
    audio.whoosh();
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

function spawnConfetti() {
  const container = document.getElementById('confetti-container');
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
  showScreen('home');
  document.getElementById('player-display-name').textContent = state.playerName;
  document.getElementById('settings-name-input').value = state.playerName;
} else {
  showScreen('name');
}

document.getElementById('name-submit-btn').addEventListener('click', () => {
  const name = document.getElementById('player-name-input').value.trim();
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
  playSound('fail');
});

document.getElementById('settings-btn').addEventListener('click', () => {
  playSound('click');
  showScreen('settings');
});

document.getElementById('settings-back-btn').addEventListener('click', () => {
  playSound('click');
  showScreen('home');
});

document.getElementById('settings-save-name').addEventListener('click', () => {
  const name = document.getElementById('settings-name-input').value.trim();
  if (name) {
    state.playerName = name;
    localStorage.setItem('hc_playerName', name);
    document.getElementById('player-display-name').textContent = name;
    playSound('success');
  }
});

document.getElementById('sound-toggle').checked = state.soundEnabled;
document.getElementById('particles-toggle').checked = state.particlesEnabled;

document.getElementById('sound-toggle').addEventListener('change', (e) => {
  state.soundEnabled = e.target.checked;
  localStorage.setItem('hc_sound', e.target.checked);
  if (e.target.checked) {
    audio.init();
    audio.startBgAmbience();
  } else {
    audio.stopBgAmbience();
  }
});

document.getElementById('particles-toggle').addEventListener('change', (e) => {
  state.particlesEnabled = e.target.checked;
  localStorage.setItem('hc_particles', e.target.checked);
});

document.getElementById('room-back-btn').addEventListener('click', () => {
  playSound('click');
  showScreen('home');
});

document.getElementById('create-room-btn').addEventListener('click', () => {
  playSound('click');
  socket.emit('create-room', { mode: state.mode, playerName: state.playerName });
});

document.getElementById('join-room-btn').addEventListener('click', () => {
  playSound('click');
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
  document.getElementById('rps-hand-left').textContent = '❓';
  document.getElementById('rps-hand-right').textContent = '❓';
  document.getElementById('rps-status-left').textContent = 'Choosing...';
  document.getElementById('rps-status-right').textContent = 'Choosing...';

  document.querySelectorAll('.rps-btn').forEach(b => {
    b.classList.remove('selected');
    b.disabled = false;
  });

  playSound('success');
  showScreen('rps');
});

document.querySelectorAll('.rps-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const choice = btn.dataset.choice;
    socket.emit('rps-choice', { choice });
    playSound('click');

    document.querySelectorAll('.rps-btn').forEach(b => {
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
    document.querySelectorAll('.rps-btn').forEach(b => {
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
      document.querySelector('.toss-panel h2').textContent = `${data.winnerName} won the toss!`;
      document.getElementById('toss-choice-buttons').classList.add('hidden');
      document.getElementById('toss-loser-msg').textContent = `Waiting for ${data.winnerName} to choose...`;
      document.getElementById('toss-loser-msg').classList.remove('hidden');
    }
  }, 2500);
});

document.querySelectorAll('.toss-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const choice = btn.dataset.choice;
    socket.emit('toss-decision', { choice });
    playSound('click');
    document.querySelectorAll('.toss-btn').forEach(b => b.disabled = true);
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

  document.getElementById('hud-name-left').textContent = myData.name;
  document.getElementById('hud-role-left').textContent = myData.role;
  document.getElementById('hud-score-left').textContent = '0';
  document.getElementById('hud-balls-left').textContent = '(0 balls)';
  document.getElementById('hud-name-right').textContent = oppData.name;
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
  document.querySelectorAll('.num-btn').forEach(b => {
    b.classList.remove('selected');
    b.disabled = false;
  });
  document.getElementById('ball-result-overlay').classList.add('hidden');
}

document.querySelectorAll('.num-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (state.locked) return;
    const num = btn.dataset.num;
    state.locked = true;
    playSound('click');

    document.querySelectorAll('.num-btn').forEach(b => {
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
    audio.batHit(data.runs);
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

  document.getElementById('winner-text').textContent = isWinner ? 'YOU WIN!' : `${data.winnerName} Wins!`;
  document.getElementById('result-message').textContent = data.message;

  const scoresDiv = document.getElementById('final-scores');
  scoresDiv.innerHTML = '';

  Object.entries(data.scores).forEach(([id, info]) => {
    const card = document.createElement('div');
    card.className = 'score-card' + (id === data.winnerId ? ' winner' : '');
    card.innerHTML = `
      <div class="sc-name">${info.name}</div>
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
  showScreen('home');
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
  const container = document.getElementById('floating-reactions');
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

socket.on('chat-message', (data) => {
  const div = document.createElement('div');
  const isSelf = data.senderId === socket.id;
  div.className = 'chat-msg' + (isSelf ? ' self' : '');
  div.innerHTML = `<span class="chat-msg-name">${data.senderName}:</span><span class="chat-msg-text">${escapeHtml(data.message)}</span>`;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  // Only keep last 50 messages in DOM
  while (chatMessages.children.length > 50) {
    chatMessages.removeChild(chatMessages.firstChild);
  }

  if (!chatOpen && !isSelf) {
    chatBadge.classList.remove('hidden');
    playSound('tick');
  }
});

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
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
  const overlay = document.getElementById('milestone-overlay');
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

  document.getElementById('milestone-number').textContent = data.milestone;
  document.getElementById('milestone-label').textContent = config.label;
  document.getElementById('milestone-player').textContent = `🏏 ${data.playerName} • Score: ${data.score}`;

  // Spawn decorative stars
  const starsContainer = document.getElementById('milestone-stars');
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

