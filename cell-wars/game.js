/* ==========================================================================
   CELL WARS — Deluxe Browser Edition
   A local single-player arena game against AI bots.

   Architecture overview (prepared for a future real multiplayer mode):
   - ProfileStore  : local persistence (credits, skins, settings, records)
   - AudioEngine   : synthetic Web Audio SFX + ambient music, no assets
   - Cell / Team   : pure-ish simulation entities
   - BotBrain      : local AI personality/state machine (separate from cells)
   - Game          : authoritative local simulation (movement, collisions,
                     food, spawning, ranking). No DOM access.
   - Renderer      : canvas rendering only
   - MenuScene     : animated menu backdrop
   - InputController : mouse/keyboard/touch to intent
   - UIController  : screens, HUD and DOM wiring

   There is deliberately NO network code in this file.
   ========================================================================== */

(() => {
  'use strict';

  // -------------------------------------------------------------------------
  // Constants & small utilities
  // -------------------------------------------------------------------------

  const STORAGE_KEY = 'cellwars_save_v1';
  const ARENA_SIZE = 5600;
  const START_MASS = 100;
  const MAX_CELL_MASS = 24000;
  const EAT_RATIO = 1.22;
  const THREAT_RATIO = 1.20;
  const MIN_SPLIT_MASS = 80;
  const MAX_PLAYER_CELLS = 8;
  const SPLIT_COOLDOWN = 0.3;
  const SPLIT_LAUNCH_SPEED = 760;
  const MERGE_BASE_TIME = 8;
  const PLAYER_SPAWN_SHIELD = 3;
  const FOOD_MASS_MIN = 4.4;
  const FOOD_MASS_MAX = 6.4;
  const TAU = Math.PI * 2;

  const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (min, max) => min + Math.random() * (max - min);
  const randInt = (min, max) => Math.floor(rand(min, max + 1));
  const dist2 = (ax, ay, bx, by) => {
    const dx = bx - ax;
    const dy = by - ay;
    return dx * dx + dy * dy;
  };
  const dist = (ax, ay, bx, by) => Math.sqrt(dist2(ax, ay, bx, by));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  const formatTime = (seconds) => {
    const s = Math.max(0, Math.floor(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  const formatNumber = (value) => Math.round(value).toLocaleString('de-DE');
  const formatCompact = (value) => {
    const v = Math.round(value);
    if (v >= 10000) return `${(v / 1000).toFixed(1).replace('.', ',')}k`;
    return formatNumber(v);
  };

  const massToRadius = (mass) => Math.sqrt(Math.max(1, mass)) * 2.25;

  // Movement speed intentionally depends on cell radius: small cells are
  // quick, large cells are slower. Identical rules apply to player and bots.
  const cellSpeed = (radius) => clamp(340 * Math.pow(22.5 / Math.max(radius, 10), 0.36), 70, 365);

  const sanitizeName = (raw) => {
    const cleaned = String(raw == null ? '' : raw)
      .replace(/[<>&"'`\\]/g, '')
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 14);
    return cleaned || 'PILOT';
  };

  // -------------------------------------------------------------------------
  // Skins
  // -------------------------------------------------------------------------

  const SKINS = [
    { id: 'proto', name: 'PROTO', price: 0, a: '#3cf5c6', b: '#0a5a63', glow: '#3cf5c6', desc: 'Ausgewogener Allrounder' },
    { id: 'nova', name: 'NOVA', price: 0, a: '#ff6fdc', b: '#68145e', glow: '#ff6fdc', desc: 'Magenta-Plasma' },
    { id: 'toxic', name: 'TOXIC', price: 0, a: '#c8ff63', b: '#3b6410', glow: '#c8ff63', desc: 'Giftgrüner Jäger' },
    { id: 'solar', name: 'SOLAR', price: 350, a: '#ffd75e', b: '#8a2c00', glow: '#ffd75e', desc: 'Heißer Sonnenkern' },
    { id: 'cryo', name: 'CRYO', price: 600, a: '#a9efff', b: '#1c4ba8', glow: '#8be9ff', desc: 'Eisblaue Kryozelle' },
    { id: 'void', name: 'VOID', price: 900, a: '#b28cff', b: '#2a0b5e', glow: '#b28cff', desc: 'Violette Leere' },
    { id: 'ember', name: 'EMBER', price: 1400, a: '#ff9368', b: '#5c0713', glow: '#ff7a55', desc: 'Glühende Asche' },
    { id: 'aurora', name: 'AURORA', price: 2000, a: '#6bffd0', b: '#5b28a8', glow: '#8dffdd', desc: 'Polarlicht-Spektrum' },
    { id: 'prism', name: 'PRISM', price: 2800, a: '#ffffff', b: '#ff59c7', glow: '#ff9ae4', desc: 'Rotierendes Lichtspektrum', special: 'rainbow' },
    { id: 'singularity', name: 'SINGULARITY', price: 3800, a: '#effcff', b: '#060c18', glow: '#9ff7ff', desc: 'Schwarzer Kern, weißer Rand' }
  ];

  const skinById = (id) => SKINS.find((skin) => skin.id === id) || SKINS[0];

  const BOT_SKIN_POOL = SKINS.filter((skin) => skin.id !== 'prism');

  // -------------------------------------------------------------------------
  // Difficulty presets — every value genuinely changes the AI / population.
  // ULTRA does not cheat: bots obey the same speed and eating rules.
  // -------------------------------------------------------------------------

  const DIFFICULTIES = {
    easy: {
      id: 'easy',
      label: 'EASY',
      color: '#5ef2c2',
      blurb: 'Ruhige Gewässer. Wenige, kleinere Bots mit langsamer Reaktion.',
      botCount: 9,
      botMassMin: 60,
      botMassMax: 140,
      reactionMin: 0.5,
      reactionMax: 0.85,
      vision: 620,
      fleeFraction: 0.46,
      aggression: 0.42,
      mistake: 0.22,
      speedMult: 0.96,
      coinMult: 1.0,
      respawnMassMult: 0.85
    },
    normal: {
      id: 'normal',
      label: 'NORMAL',
      color: '#3cf5c6',
      blurb: 'Die Standard-Arena. Ausbalancierte Jäger und vorsichtige Sammler.',
      botCount: 13,
      botMassMin: 80,
      botMassMax: 200,
      reactionMin: 0.32,
      reactionMax: 0.56,
      vision: 760,
      fleeFraction: 0.55,
      aggression: 0.62,
      mistake: 0.10,
      speedMult: 1.0,
      coinMult: 1.3,
      respawnMassMult: 1.0
    },
    hard: {
      id: 'hard',
      label: 'HARD',
      color: '#ffd75e',
      blurb: 'Erfahrene Schwärme. Schnellere Entscheidungen, größere Jäger.',
      botCount: 16,
      botMassMin: 110,
      botMassMax: 300,
      reactionMin: 0.22,
      reactionMax: 0.38,
      vision: 900,
      fleeFraction: 0.64,
      aggression: 0.8,
      mistake: 0.05,
      speedMult: 1.015,
      coinMult: 1.7,
      respawnMassMult: 1.15
    },
    ultra: {
      id: 'ultra',
      label: 'ULTRA',
      color: '#ff6079',
      blurb: 'Albtraum-Becken. Viele große Zellen, extreme Reaktion, kein Pardon.',
      botCount: 20,
      botMassMin: 150,
      botMassMax: 420,
      reactionMin: 0.14,
      reactionMax: 0.26,
      vision: 1050,
      fleeFraction: 0.72,
      aggression: 0.95,
      mistake: 0.02,
      speedMult: 1.03,
      coinMult: 2.2,
      respawnMassMult: 1.3
    }
  };

  const QUALITY = {
    low: { id: 'low', food: 480, particles: 80, glow: false, dpr: 1, label: 'LOW', note: '480 Nahrung · reduzierte Effekte · DPR 1' },
    medium: { id: 'medium', food: 680, particles: 180, glow: true, dpr: 1.5, label: 'MED', note: '680 Nahrung · mittlere Effekte · DPR 1.5' },
    high: { id: 'high', food: 900, particles: 320, glow: true, dpr: 2, label: 'HIGH', note: '900 Nahrung · volle Effekte · DPR 2' }
  };

  const FOOD_COLORS = ['#5fffe0', '#c8ff66', '#ff7add', '#ffd95e', '#7fb4ff', '#b78cff', '#ff9a66'];

  const BOT_NAMES = [
    'NEXUS', 'VORTEX', 'HELIX', 'ORBITA', 'KRYO', 'SPORE', 'VANTA', 'LUMEN',
    'RIFT', 'ECHO', 'NOVA', 'SABLE', 'ONYX', 'PULSE', 'QUASAR', 'ZENITH',
    'MIRAGE', 'CINDER', 'DRIFT', 'GLITCH', 'APEX', 'NEON', 'PHASE', 'PRISM',
    'SURGE', 'TALON', 'UMBRA', 'VOLT', 'WRAITH', 'XENON', 'YARA', 'ZERO',
    'ATLAS', 'BLOOM', 'CIPHER', 'DELTA', 'FLUX', 'HALO', 'IRIS', 'JADE'
  ];

  // -------------------------------------------------------------------------
  // Local persistence
  // -------------------------------------------------------------------------

  const createDefaultProfile = () => ({
    version: 1,
    coins: 0,
    owned: ['proto', 'nova', 'toxic'],
    skin: 'proto',
    name: '',
    games: 0,
    totalKills: 0,
    best: { mass: 0, time: 0, kills: 0, rank: 0 },
    settings: {
      sfx: 0.7,
      music: 0.3,
      particles: true,
      quality: 'high',
      hints: true
    }
  });

  class ProfileStore {
    constructor() {
      this.profile = this.load();
      this.available = true;
    }

    load() {
      const defaults = createDefaultProfile();
      let raw = null;
      try {
        raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      } catch (err) {
        raw = null;
      }
      if (!raw || typeof raw !== 'object') return defaults;

      const profile = defaults;
      profile.coins = clamp(Math.floor(Number(raw.coins) || 0), 0, 9999999);
      profile.games = clamp(Math.floor(Number(raw.games) || 0), 0, 9999999);
      profile.totalKills = clamp(Math.floor(Number(raw.totalKills) || 0), 0, 99999999);

      const validIds = new Set(SKINS.map((skin) => skin.id));
      const owned = Array.isArray(raw.owned) ? raw.owned.filter((id) => validIds.has(id)) : [];
      profile.owned = [...new Set([...defaults.owned, ...owned])];
      profile.skin = validIds.has(raw.skin) && profile.owned.includes(raw.skin) ? raw.skin : defaults.skin;

      if (raw.name) profile.name = sanitizeName(raw.name) === 'PILOT' && !String(raw.name).trim() ? '' : sanitizeName(raw.name);

      if (raw.best && typeof raw.best === 'object') {
        profile.best.mass = clamp(Math.floor(Number(raw.best.mass) || 0), 0, 9999999);
        profile.best.time = clamp(Number(raw.best.time) || 0, 0, 360000);
        profile.best.kills = clamp(Math.floor(Number(raw.best.kills) || 0), 0, 999999);
        profile.best.rank = clamp(Math.floor(Number(raw.best.rank) || 0), 0, 99);
      }

      const settings = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
      profile.settings.sfx = clamp(Number(settings.sfx), 0, 1);
      if (!Number.isFinite(profile.settings.sfx)) profile.settings.sfx = defaults.settings.sfx;
      profile.settings.music = clamp(Number(settings.music), 0, 1);
      if (!Number.isFinite(profile.settings.music)) profile.settings.music = defaults.settings.music;
      profile.settings.particles = settings.particles !== false;
      profile.settings.hints = settings.hints !== false;
      profile.settings.quality = QUALITY[settings.quality] ? settings.quality : 'high';

      return profile;
    }

    save() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.profile));
        this.available = true;
      } catch (err) {
        this.available = false;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Audio engine — all sounds are synthesized, no external assets.
  // -------------------------------------------------------------------------

  class AudioEngine {
    constructor(profile) {
      this.profile = profile;
      this.ctx = null;
      this.sfxGain = null;
      this.musicGain = null;
      this.musicFilter = null;
      this.musicTimer = null;
      this.noiseBuffer = null;
      this.lastFoodSound = 0;
      this.chordIndex = 0;
    }

    get settings() {
      return this.profile.settings;
    }

    unlock() {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        this.ctx = new AudioCtx();
        this.sfxGain = this.ctx.createGain();
        this.sfxGain.gain.value = this.settings.sfx;
        this.sfxGain.connect(this.ctx.destination);

        this.musicFilter = this.ctx.createBiquadFilter();
        this.musicFilter.type = 'lowpass';
        this.musicFilter.frequency.value = 640;
        this.musicGain = this.ctx.createGain();
        this.musicGain.gain.value = this.settings.music * 0.16;
        this.musicFilter.connect(this.musicGain);
        this.musicGain.connect(this.ctx.destination);
        this.startMusic();
      }
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
    }

    setSfxVolume(value) {
      this.settings.sfx = clamp(value, 0, 1);
      if (this.sfxGain) this.sfxGain.gain.setTargetAtTime(this.settings.sfx, this.ctx.currentTime, 0.04);
    }

    setMusicVolume(value) {
      this.settings.music = clamp(value, 0, 1);
      if (this.musicGain) this.musicGain.gain.setTargetAtTime(this.settings.music * 0.16, this.ctx.currentTime, 0.15);
    }

    startMusic() {
      if (!this.ctx || this.musicTimer) return;
      this.playChord();
      this.musicTimer = window.setInterval(() => this.playChord(), 10000);
    }

    playChord() {
      if (!this.ctx || !this.musicGain || this.settings.music <= 0.001) return;
      const chords = [
        [55, 110, 164.81, 220],
        [43.65, 87.31, 130.81, 174.61],
        [49, 98, 146.83, 196],
        [41.2, 82.41, 123.47, 164.81]
      ];
      const chord = chords[this.chordIndex % chords.length];
      this.chordIndex += 1;
      const now = this.ctx.currentTime + 0.05;
      chord.forEach((frequency, index) => {
        try {
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = index === 0 ? 'sine' : 'triangle';
          osc.frequency.value = frequency;
          osc.detune.value = index === 0 ? 0 : rand(-5, 5);
          const level = index === 0 ? 0.05 : 0.022;
          gain.gain.setValueAtTime(0.0001, now);
          gain.gain.linearRampToValueAtTime(level, now + 2.4);
          gain.gain.linearRampToValueAtTime(level * 0.8, now + 8);
          gain.gain.linearRampToValueAtTime(0.0001, now + 13);
          osc.connect(gain);
          gain.connect(this.musicFilter);
          osc.start(now);
          osc.stop(now + 13.2);
        } catch (err) {
          /* audio is optional */
        }
      });
    }

    tone(freq, endFreq, duration, type, volume, delay = 0) {
      if (!this.ctx || !this.sfxGain) return;
      if (this.settings.sfx <= 0.001) return;
      try {
        const t0 = this.ctx.currentTime + delay;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type || 'sine';
        osc.frequency.setValueAtTime(Math.max(20, freq), t0);
        if (endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t0 + duration);
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.linearRampToValueAtTime(volume, t0 + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
        osc.connect(gain);
        gain.connect(this.sfxGain);
        osc.start(t0);
        osc.stop(t0 + duration + 0.03);
      } catch (err) {
        /* ignore */
      }
    }

    noise(duration, volume, cutoff = 900, delay = 0) {
      if (!this.ctx || !this.sfxGain) return;
      if (this.settings.sfx <= 0.001) return;
      try {
        if (!this.noiseBuffer) {
          const length = Math.floor(this.ctx.sampleRate * 1.2);
          this.noiseBuffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
          const data = this.noiseBuffer.getChannelData(0);
          for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
        }
        const t0 = this.ctx.currentTime + delay;
        const source = this.ctx.createBufferSource();
        source.buffer = this.noiseBuffer;
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(cutoff, t0);
        filter.frequency.exponentialRampToValueAtTime(120, t0 + duration);
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(volume, t0);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
        source.connect(filter);
        filter.connect(gain);
        gain.connect(this.sfxGain);
        source.start(t0);
        source.stop(t0 + duration + 0.03);
      } catch (err) {
        /* ignore */
      }
    }

    click() {
      this.tone(760, 560, 0.055, 'square', 0.035);
    }

    food() {
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      if (now - this.lastFoodSound < 0.055) return;
      this.lastFoodSound = now;
      this.tone(rand(780, 1040), rand(1150, 1400), 0.07, 'sine', 0.035);
    }

    split() {
      this.tone(260, 880, 0.16, 'triangle', 0.09);
      this.noise(0.16, 0.05, 1600);
    }

    eatCell() {
      this.tone(180, 62, 0.28, 'sawtooth', 0.09);
      this.noise(0.26, 0.12, 700);
    }

    cellLost() {
      this.tone(340, 120, 0.3, 'triangle', 0.08);
      this.noise(0.2, 0.06, 500);
    }

    rankOne() {
      [523.25, 659.25, 783.99, 1046.5].forEach((freq, index) => {
        this.tone(freq, null, 0.22, 'triangle', 0.06, index * 0.08);
      });
    }

    gameOver() {
      this.tone(300, 58, 0.9, 'sawtooth', 0.1);
      this.noise(0.8, 0.14, 600);
    }
  }

  // -------------------------------------------------------------------------
  // Simulation entities
  // -------------------------------------------------------------------------

  let nextCellId = 1;
  let nextTeamId = 1;

  const skinColors = (skin) => ({
    a: skin.a,
    b: skin.b,
    glow: skin.glow || skin.a,
    special: skin.special || null
  });

  class Cell {
    constructor(team, x, y, mass) {
      this.id = nextCellId++;
      this.team = team;
      this.x = x;
      this.y = y;
      this.mass = mass;
      this.radius = massToRadius(mass);
      this.drawRadius = this.radius;
      this.vx = 0;
      this.vy = 0;
      this.launchVx = 0;
      this.launchVy = 0;
      this.mergeTimer = 0;
      this.mergeTotal = 1;
      this.aimX = 1;
      this.aimY = 0;
      this.dead = false;
      this.phase = Math.random() * TAU;
      this.flash = 0;
    }
  }

  const createTeam = (name, isPlayer, skin, extra = {}) => ({
    id: nextTeamId++,
    name,
    isPlayer,
    cells: [],
    kills: 0,
    alive: true,
    skinId: skin.id,
    colors: skinColors(skin),
    speedMult: 1,
    spawnShield: 0,
    brain: null,
    persona: null,
    ...extra
  });

  // -------------------------------------------------------------------------
  // Camera
  // -------------------------------------------------------------------------

  class Camera {
    constructor() {
      this.x = ARENA_SIZE / 2;
      this.y = ARENA_SIZE / 2;
      this.viewHeight = 1160;
      this.zoom = 1;
      this.canvasW = 1280;
      this.canvasH = 720;
      this.shakeX = 0;
      this.shakeY = 0;
    }

    setViewport(width, height) {
      this.canvasW = Math.max(1, width);
      this.canvasH = Math.max(1, height);
      this.zoom = this.canvasH / this.viewHeight;
    }

    focusPoint(game) {
      const cells = game.player ? game.player.cells : [];
      if (!cells.length) return { x: this.x, y: this.y, totalMass: START_MASS, spread: 0 };
      let total = 0;
      let sx = 0;
      let sy = 0;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const cell of cells) {
        const m = Math.max(1, cell.mass);
        total += m;
        sx += cell.x * m;
        sy += cell.y * m;
        minX = Math.min(minX, cell.x);
        minY = Math.min(minY, cell.y);
        maxX = Math.max(maxX, cell.x);
        maxY = Math.max(maxY, cell.y);
      }
      let spread = 0;
      for (let i = 0; i < cells.length; i += 1) {
        for (let j = i + 1; j < cells.length; j += 1) {
          spread = Math.max(spread, dist(cells[i].x, cells[i].y, cells[j].x, cells[j].y));
        }
      }
      return {
        x: sx / total,
        y: sy / total,
        totalMass: total,
        spread,
        minX,
        minY,
        maxX,
        maxY
      };
    }

    update(dt, game, snap = false) {
      const focus = this.focusPoint(game);
      let targetX = focus.x;
      let targetY = focus.y;

      // Slight look-ahead toward the pointer, capped to keep the cell visible.
      if (game.pointerWorld) {
        const lookX = clamp((game.pointerWorld.x - targetX) * 0.07, -90, 90);
        const lookY = clamp((game.pointerWorld.y - targetY) * 0.07, -90, 90);
        targetX += lookX;
        targetY += lookY;
      }

      const equivalentRadius = massToRadius(focus.totalMass);
      const targetView = clamp(1000 + equivalentRadius * 7.2 + focus.spread * 0.5, 1000, 3400);

      if (snap) {
        this.x = targetX;
        this.y = targetY;
        this.viewHeight = targetView;
      } else {
        const follow = 1 - Math.exp(-5.2 * dt);
        this.x = lerp(this.x, targetX, follow);
        this.y = lerp(this.y, targetY, follow);
        this.viewHeight = lerp(this.viewHeight, targetView, 1 - Math.exp(-3.2 * dt));
      }

      this.zoom = this.canvasH / this.viewHeight;
      const halfW = this.canvasW / (2 * this.zoom);
      const halfH = this.canvasH / (2 * this.zoom);
      this.x = halfW * 2 >= ARENA_SIZE ? ARENA_SIZE / 2 : clamp(this.x, halfW, ARENA_SIZE - halfW);
      this.y = halfH * 2 >= ARENA_SIZE ? ARENA_SIZE / 2 : clamp(this.y, halfH, ARENA_SIZE - halfH);

      if (game.shake > 0.2 && game.particles.enabled) {
        this.shakeX = rand(-game.shake, game.shake);
        this.shakeY = rand(-game.shake, game.shake);
        game.shake *= Math.exp(-6 * dt);
      } else {
        this.shakeX = 0;
        this.shakeY = 0;
      }
    }

    screenToWorld(screenX, screenY) {
      return {
        x: this.x + (screenX - this.canvasW / 2) / this.zoom,
        y: this.y + (screenY - this.canvasH / 2) / this.zoom
      };
    }

    bounds(padding = 80) {
      const halfW = this.canvasW / (2 * this.zoom);
      const halfH = this.canvasH / (2 * this.zoom);
      return {
        left: this.x - halfW - padding,
        right: this.x + halfW + padding,
        top: this.y - halfH - padding,
        bottom: this.y + halfH + padding
      };
    }
  }

  // -------------------------------------------------------------------------
  // Particles, rings and floating text
  // -------------------------------------------------------------------------

  class ParticleSystem {
    constructor(cap) {
      this.items = [];
      this.cap = cap;
      this.enabled = true;
    }

    setCap(cap) {
      this.cap = cap;
      if (this.items.length > cap) this.items.length = cap;
    }

    burst(x, y, colors, count = 8, options = {}) {
      if (!this.enabled) return;
      const palette = Array.isArray(colors) ? colors : [colors];
      const speedMin = options.speedMin || 30;
      const speedMax = options.speedMax || 150;
      const sizeMin = options.sizeMin || 1.5;
      const sizeMax = options.sizeMax || 4;
      const lifeMin = options.lifeMin || 0.35;
      const lifeMax = options.lifeMax || 0.9;
      for (let i = 0; i < count; i += 1) {
        if (this.items.length >= this.cap) break;
        const angle = Math.random() * TAU;
        const speed = rand(speedMin, speedMax);
        const life = rand(lifeMin, lifeMax);
        this.items.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          size: rand(sizeMin, sizeMax),
          life,
          maxLife: life,
          color: pick(palette),
          drag: options.drag == null ? 2.4 : options.drag
        });
      }
    }

    update(dt) {
      for (let i = this.items.length - 1; i >= 0; i -= 1) {
        const p = this.items[i];
        p.life -= dt;
        if (p.life <= 0) {
          this.items[i] = this.items[this.items.length - 1];
          this.items.pop();
          continue;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        const damping = Math.exp(-p.drag * dt);
        p.vx *= damping;
        p.vy *= damping;
      }
    }

    clear() {
      this.items.length = 0;
    }

    draw(ctx, view) {
      for (const p of this.items) {
        if (p.x < view.left || p.x > view.right || p.y < view.top || p.y > view.bottom) continue;
        const alpha = clamp(p.life / p.maxLife, 0, 1);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.5 + alpha * 0.7), 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  // -------------------------------------------------------------------------
  // Spatial hash for food (rebuilt each simulation step, cheap and safe)
  // -------------------------------------------------------------------------

  class FoodGrid {
    constructor(worldSize, bucketSize) {
      this.bucketSize = bucketSize;
      this.cols = Math.ceil(worldSize / bucketSize);
      this.buckets = Array.from({ length: this.cols * this.cols }, () => []);
    }

    rebuild(foods) {
      for (const bucket of this.buckets) bucket.length = 0;
      for (const food of foods) {
        const gx = clamp(Math.floor(food.x / this.bucketSize), 0, this.cols - 1);
        const gy = clamp(Math.floor(food.y / this.bucketSize), 0, this.cols - 1);
        this.buckets[gy * this.cols + gx].push(food);
      }
    }

    forEachNear(x, y, radius, callback) {
      const minX = clamp(Math.floor((x - radius) / this.bucketSize), 0, this.cols - 1);
      const maxX = clamp(Math.floor((x + radius) / this.bucketSize), 0, this.cols - 1);
      const minY = clamp(Math.floor((y - radius) / this.bucketSize), 0, this.cols - 1);
      const maxY = clamp(Math.floor((y + radius) / this.bucketSize), 0, this.cols - 1);
      const radiusSq = radius * radius;
      for (let gy = minY; gy <= maxY; gy += 1) {
        for (let gx = minX; gx <= maxX; gx += 1) {
          const bucket = this.buckets[gy * this.cols + gx];
          for (let i = 0; i < bucket.length; i += 1) {
            const food = bucket[i];
            const dx = food.x - x;
            const dy = food.y - y;
            if (dx * dx + dy * dy <= radiusSq) callback(food);
          }
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Bot AI — personality driven state machine (forage / hunt / flee / wander)
  // -------------------------------------------------------------------------

  const PERSONA_TYPES = {
    easy: [['cautious', 0.45], ['balanced', 0.4], ['aggressive', 0.15]],
    normal: [['cautious', 0.34], ['balanced', 0.38], ['aggressive', 0.28]],
    hard: [['cautious', 0.22], ['balanced', 0.38], ['aggressive', 0.4]],
    ultra: [['cautious', 0.14], ['balanced', 0.34], ['aggressive', 0.52]]
  };

  function createPersona(difficulty) {
    const table = PERSONA_TYPES[difficulty.id] || PERSONA_TYPES.normal;
    let roll = Math.random();
    let type = 'balanced';
    for (const [candidate, weight] of table) {
      if (roll < weight) {
        type = candidate;
        break;
      }
      roll -= weight;
    }
    let caution;
    let aggression;
    if (type === 'cautious') {
      caution = rand(1.2, 1.48);
      aggression = rand(0.5, 0.78);
    } else if (type === 'aggressive') {
      caution = rand(0.74, 0.95);
      aggression = rand(1.08, 1.4);
    } else {
      caution = rand(0.98, 1.16);
      aggression = rand(0.84, 1.08);
    }
    return {
      type,
      caution,
      aggression,
      visionMult: rand(0.92, 1.15),
      reactMult: rand(0.88, 1.16),
      speedMult: rand(0.96, 1.015)
    };
  }

  class BotBrain {
    constructor(team, difficulty, persona) {
      this.team = team;
      this.difficulty = difficulty;
      this.persona = persona;
      this.state = 'forage';
      this.thinkTimer = rand(0.05, 0.4);
      this.targetFood = null;
      this.targetCell = null;
      this.fleeFrom = [];
      this.wander = { x: rand(400, ARENA_SIZE - 400), y: rand(400, ARENA_SIZE - 400) };
      this.dir = { x: Math.cos(rand(0, TAU)), y: Math.sin(rand(0, TAU)) };
    }

    update(dt, game) {
      const cell = this.team.cells[0];
      if (!cell || cell.dead) return;

      this.thinkTimer -= dt;
      if (this.thinkTimer <= 0) {
        this.think(game, cell);
        this.thinkTimer = rand(this.difficulty.reactionMin, this.difficulty.reactionMax) * this.persona.reactMult;
      }

      let dir = null;
      if (this.state === 'hunt' && this.targetCell && !this.targetCell.dead) {
        const dx = this.targetCell.x - cell.x;
        const dy = this.targetCell.y - cell.y;
        const length = Math.hypot(dx, dy);
        if (length > 4) dir = { x: dx / length, y: dy / length };
        else this.thinkTimer = Math.min(this.thinkTimer, 0.12);
      } else if (this.state === 'flee' && this.fleeFrom.length) {
        let ax = 0;
        let ay = 0;
        let valid = 0;
        for (const threat of this.fleeFrom) {
          if (!threat || threat.dead) continue;
          const dx = cell.x - threat.x;
          const dy = cell.y - threat.y;
          const length = Math.hypot(dx, dy);
          if (length < 1) continue;
          const weight = (threat.mass / Math.max(1, cell.mass)) / Math.max(80, length);
          ax += (dx / length) * weight;
          ay += (dy / length) * weight;
          valid += 1;
        }
        if (valid > 0) {
          const length = Math.hypot(ax, ay);
          if (length > 0.0001) dir = { x: ax / length, y: ay / length };
        } else {
          this.state = 'forage';
          this.fleeFrom = [];
        }
      } else if ((this.state === 'forage' || this.state === 'hunt') && this.targetFood && this.targetFood.active) {
        const dx = this.targetFood.x - cell.x;
        const dy = this.targetFood.y - cell.y;
        const length = Math.hypot(dx, dy);
        if (length > 3) dir = { x: dx / length, y: dy / length };
      } else if (this.state === 'wander') {
        const dx = this.wander.x - cell.x;
        const dy = this.wander.y - cell.y;
        const length = Math.hypot(dx, dy);
        if (length > 90) dir = { x: dx / length, y: dy / length };
        else {
          this.state = 'forage';
          this.thinkTimer = Math.min(this.thinkTimer, 0.1);
        }
      }

      if (!dir) {
        dir = this.dir;
        this.thinkTimer = Math.min(this.thinkTimer, 0.2);
      }

      this.dir = this.steerAwayFromWalls(cell, dir);
    }

    think(game, cell) {
      const vision = this.difficulty.vision * this.persona.visionMult;
      const fleeRange = vision * this.difficulty.fleeFraction * this.persona.caution;
      const threats = [];
      let nearestThreat = null;
      let nearestThreatDist = Infinity;
      let bestPrey = null;
      let bestPreyScore = -Infinity;

      for (const team of game.teams) {
        if (team === this.team) continue;
        for (const other of team.cells) {
          if (other.dead) continue;
          const d = dist(cell.x, cell.y, other.x, other.y);
          if (d > vision) continue;

          if (other.mass > cell.mass * THREAT_RATIO) {
            threats.push(other);
            const score = (other.mass / Math.max(1, cell.mass)) / (d + 90);
            if (d < nearestThreatDist || (d === nearestThreatDist && score > 0)) {
              nearestThreatDist = d;
              nearestThreat = other;
            }
          } else if (cell.mass > other.mass * EAT_RATIO && d < vision * 0.92) {
            const score = (other.mass / (d + 90)) * (0.7 + this.persona.aggression * 0.5);
            if (score > bestPreyScore) {
              bestPreyScore = score;
              bestPrey = other;
            }
          }
        }
      }

      threats.sort((a, b) => dist(cell.x, cell.y, a.x, a.y) - dist(cell.x, cell.y, b.x, b.y));

      // 1. Survival first: flee from clearly larger cells.
      if (nearestThreat && nearestThreatDist < fleeRange) {
        this.state = 'flee';
        this.targetCell = null;
        this.targetFood = null;
        this.fleeFrom = threats.slice(0, 4);
        return;
      }

      if (this.state === 'flee') {
        if (nearestThreat && nearestThreatDist < fleeRange * 1.25) {
          this.fleeFrom = threats.slice(0, 4);
          return;
        }
        this.state = 'forage';
        this.fleeFrom = [];
      }

      // 2. Keep a running hunt if the victim is still valid and visible.
      if (this.state === 'hunt' && this.targetCell && !this.targetCell.dead) {
        const d = dist(cell.x, cell.y, this.targetCell.x, this.targetCell.y);
        if (d < vision * 1.4 && cell.mass > this.targetCell.mass * EAT_RATIO) {
          if (!nearestThreat || nearestThreatDist > fleeRange * 0.9) {
            this.fleeFrom = threats.slice(0, 2);
            return;
          }
        }
      }

      // 3. Hunt potential prey. Aggressive personalities take more risks.
      const aggression = this.difficulty.aggression * this.persona.aggression;
      if (bestPrey && aggression > 0.5 && Math.random() > this.difficulty.mistake * 0.6) {
        const dangerNear = nearestThreat && nearestThreatDist < fleeRange * 0.92;
        if (!dangerNear || bestPrey.mass < cell.mass * 0.35) {
          this.state = 'hunt';
          this.targetCell = bestPrey;
          this.targetFood = null;
          this.fleeFrom = threats.slice(0, 2);
          return;
        }
      }

      // 4. Forage, with an occasional believable detour.
      this.state = 'forage';
      this.targetCell = null;
      this.fleeFrom = [];
      this.targetFood = game.findNearestFood(cell, vision * 1.8) || game.findNearestFood(cell, Infinity);

      if (Math.random() < this.difficulty.mistake * 0.4) {
        this.state = 'wander';
        this.wander = { x: rand(400, ARENA_SIZE - 400), y: rand(400, ARENA_SIZE - 400) };
      }
    }

    steerAwayFromWalls(cell, dir) {
      let x = dir ? dir.x : 0;
      let y = dir ? dir.y : 0;
      const margin = 280 + cell.radius;
      if (cell.x < margin) x += (1 - cell.x / margin) * 2.4;
      if (cell.x > ARENA_SIZE - margin) x -= (1 - (ARENA_SIZE - cell.x) / margin) * 2.4;
      if (cell.y < margin) y += (1 - cell.y / margin) * 2.4;
      if (cell.y > ARENA_SIZE - margin) y -= (1 - (ARENA_SIZE - cell.y) / margin) * 2.4;
      const length = Math.hypot(x, y);
      if (length < 0.0001) {
        return { x: (ARENA_SIZE / 2 - cell.x) >= 0 ? 1 : -1, y: 0 };
      }
      return { x: x / length, y: y / length };
    }
  }

  // -------------------------------------------------------------------------
  // Game — authoritative local simulation, no DOM dependencies.
  // -------------------------------------------------------------------------

  const FIXED_STEP = 1 / 60;

  class Game {
    constructor(store, audio, callbacks = {}) {
      this.store = store;
      this.profile = store.profile;
      this.audio = audio;
      this.callbacks = callbacks;
      this.camera = new Camera();
      this.particles = new ParticleSystem(320);
      this.foodGrid = new FoodGrid(ARENA_SIZE, 200);
      this.state = 'idle';
      this.accumulator = 0;
      this.reset();
    }

    get quality() {
      return QUALITY[this.profile.settings.quality] || QUALITY.high;
    }

    get configDifficulty() {
      return (this.config && DIFFICULTIES[this.config.difficulty]) || DIFFICULTIES.normal;
    }

    reset() {
      this.teams = [];
      this.player = null;
      this.foods = [];
      this.time = 0;
      this.kills = 0;
      this.maxMass = START_MASS;
      this.preDeathMass = START_MASS;
      this.preDeathRank = 0;
      this.deathMass = START_MASS;
      this.deathRank = 0;
      this.respawnQueue = [];
      this.effects = [];
      this.floatTexts = [];
      this.rankOneShown = false;
      this.splitLock = 0;
      this.deathTimer = 0;
      this.shake = 0;
      this.pointerWorld = { x: ARENA_SIZE / 2, y: ARENA_SIZE / 2 };
      this.hudDirty = true;
      this.accumulator = 0;
      this.foodTarget = this.quality.food;
      this.particles.clear();
      this.particles.setCap(this.quality.particles);
      this.particles.enabled = this.profile.settings.particles !== false;
    }

    start(config) {
      this.reset();
      const difficulty = DIFFICULTIES[config.difficulty] || DIFFICULTIES.normal;
      const skinId = this.profile.owned.includes(config.skinId) ? config.skinId : this.profile.skin;
      this.config = {
        name: sanitizeName(config.name),
        difficulty: difficulty.id,
        skinId
      };
      this.state = 'playing';
      this.foodTarget = this.quality.food;

      // Player team
      const spawn = this.pickSpawnPoint(0, 0);
      this.player = createTeam(this.config.name, true, skinById(skinId), {
        spawnShield: PLAYER_SPAWN_SHIELD,
        speedMult: 1
      });
      const playerCell = new Cell(this.player, spawn.x, spawn.y, START_MASS);
      this.player.cells.push(playerCell);
      this.teams.push(this.player);

      // Food
      for (let i = 0; i < this.foodTarget; i += 1) {
        this.foods.push(this.createFood(rand(40, ARENA_SIZE - 40), rand(40, ARENA_SIZE - 40)));
      }

      // Bots
      for (let i = 0; i < difficulty.botCount; i += 1) {
        this.spawnBot(difficulty, true);
      }

      this.foodGrid.rebuild(this.foods);
      this.camera.setViewport(this.camera.canvasW, this.camera.canvasH);
      this.camera.update(0, this, true);
      this.callbacks.onGameStart?.();
    }

    stop() {
      this.state = 'idle';
      this.reset();
    }

    pause() {
      if (this.state === 'playing') this.state = 'paused';
    }

    resume() {
      if (this.state === 'paused') this.state = 'playing';
    }

    isRunning() {
      return this.state === 'playing' || this.state === 'dying';
    }

    createFood(x, y) {
      return {
        x,
        y,
        r: rand(4.2, 6.8),
        mass: rand(FOOD_MASS_MIN, FOOD_MASS_MAX),
        color: pick(FOOD_COLORS),
        phase: rand(0, TAU),
        active: true,
        respawnAt: 0
      };
    }

    respawnFood(food) {
      food.x = rand(50, ARENA_SIZE - 50);
      food.y = rand(50, ARENA_SIZE - 50);
      food.r = rand(4.2, 6.8);
      food.mass = rand(FOOD_MASS_MIN, FOOD_MASS_MAX);
      food.color = pick(FOOD_COLORS);
      food.phase = rand(0, TAU);
      food.active = true;
      food.respawnAt = 0;
    }

    findNearestFood(cell, maxRange) {
      let best = null;
      let bestDist = maxRange === Infinity ? Infinity : maxRange * maxRange;
      for (const food of this.foods) {
        if (!food.active) continue;
        const dx = food.x - cell.x;
        const dy = food.y - cell.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestDist) {
          bestDist = d2;
          best = food;
        }
      }
      return best;
    }

    pickSpawnPoint(minPlayerDistance, minCellDistance) {
      let best = { x: rand(300, ARENA_SIZE - 300), y: rand(300, ARENA_SIZE - 300) };
      let bestClearance = -1;

      for (let attempt = 0; attempt < 60; attempt += 1) {
        const x = rand(280, ARENA_SIZE - 280);
        const y = rand(280, ARENA_SIZE - 280);
        let clearance = Infinity;
        let valid = true;

        if (this.player) {
          for (const cell of this.player.cells) {
            const d = dist(x, y, cell.x, cell.y) - cell.radius;
            clearance = Math.min(clearance, d);
            if (d < minPlayerDistance) {
              valid = false;
              break;
            }
          }
        }

        if (valid) {
          for (const team of this.teams) {
            for (const cell of team.cells) {
              const d = dist(x, y, cell.x, cell.y) - cell.radius;
              clearance = Math.min(clearance, d);
              if (d < minCellDistance) {
                valid = false;
                break;
              }
            }
            if (!valid) break;
          }
        }

        if (valid) return { x, y };
        if (clearance > bestClearance) {
          bestClearance = clearance;
          best = { x, y };
        }
      }

      return best;
    }

    uniqueBotName() {
      const used = new Set(this.teams.filter((team) => !team.isPlayer).map((team) => team.name));
      let name = pick(BOT_NAMES);
      let attempt = 0;
      while (used.has(name) && attempt < 40) {
        name = `${pick(BOT_NAMES)}-${randInt(2, 9)}`;
        attempt += 1;
      }
      return name;
    }

    spawnBot(difficulty, initial) {
      const mass = initial
        ? rand(difficulty.botMassMin, difficulty.botMassMax)
        : rand(60, 135) * difficulty.respawnMassMult;
      const spawn = this.pickSpawnPoint(820, 330);
      const skin = pick(BOT_SKIN_POOL);
      const persona = createPersona(difficulty);
      const team = createTeam(this.uniqueBotName(), false, skin, {
        speedMult: persona.speedMult * difficulty.speedMult,
        persona
      });
      const cell = new Cell(team, spawn.x, spawn.y, mass);
      team.cells.push(cell);
      team.brain = new BotBrain(team, difficulty, persona);
      this.teams.push(team);
      return team;
    }

    queueBotRespawn() {
      this.respawnQueue.push({
        at: this.time + rand(1.6, 3.8),
        difficultyId: this.configDifficulty.id
      });
    }

    processRespawnQueue() {
      if (!this.respawnQueue.length) return;
      const difficulty = this.configDifficulty;
      let aliveBots = this.teams.filter((team) => !team.isPlayer && team.alive && team.cells.length > 0).length;
      for (let i = this.respawnQueue.length - 1; i >= 0; i -= 1) {
        const entry = this.respawnQueue[i];
        if (this.time < entry.at) continue;
        this.respawnQueue.splice(i, 1);
        if (aliveBots < difficulty.botCount) {
          this.spawnBot(difficulty, false);
          aliveBots += 1;
        }
      }
    }

    activeCells() {
      const cells = [];
      for (const team of this.teams) {
        for (const cell of team.cells) {
          if (!cell.dead) cells.push(cell);
        }
      }
      return cells;
    }

    teamMass(team) {
      let total = 0;
      for (const cell of team.cells) {
        if (!cell.dead) total += cell.mass;
      }
      return total;
    }

    playerMass() {
      return this.player ? this.teamMass(this.player) : 0;
    }

    rankings() {
      const list = [];
      for (const team of this.teams) {
        const mass = this.teamMass(team);
        if (mass <= 0 || !team.alive) continue;
        list.push({
          team,
          name: team.name,
          mass,
          isPlayer: team.isPlayer,
          color: team.colors.a,
          cells: team.cells.length
        });
      }
      list.sort((a, b) => b.mass - a.mass);
      list.forEach((row, index) => {
        row.rank = index + 1;
      });
      return list;
    }

    playerRank() {
      const row = this.rankings().find((entry) => entry.isPlayer);
      return row ? row.rank : 0;
    }

    update(dt) {
      if (!this.isRunning()) return;
      this.accumulator += Math.min(dt, 0.08);
      let steps = 0;
      while (this.accumulator >= FIXED_STEP && steps < 4) {
        this.step(FIXED_STEP);
        this.accumulator -= FIXED_STEP;
        steps += 1;
        if (!this.isRunning()) break;
      }
      if (steps === 4) this.accumulator = 0;
    }

    step(dt) {
      if (this.state === 'dying') {
        this.deathTimer -= dt;
        this.particles.update(dt);
        this.updateEffects(dt);
        this.camera.update(dt, this);
        if (this.deathTimer <= 0) this.finishRun();
        return;
      }
      if (this.state !== 'playing' || !this.player) return;

      this.time += dt;
      this.splitLock = Math.max(0, this.splitLock - dt);
      if (this.player.spawnShield > 0) {
        this.player.spawnShield = Math.max(0, this.player.spawnShield - dt);
      }

      for (const food of this.foods) {
        if (!food.active && this.time >= food.respawnAt) this.respawnFood(food);
      }

      this.processRespawnQueue();

      // Pointer intent is recomputed once per fixed step.
      const pointerInput = this.getPointerIntent();

      for (const team of this.teams) {
        if (!team.cells.length || !team.alive) continue;
        if (team.isPlayer) {
          for (const cell of team.cells) {
            if (cell.dead) continue;
            if (cell.mergeTimer > 0) cell.mergeTimer = Math.max(0, cell.mergeTimer - dt);
            let dir = pointerInput.keyboard;
            if (!dir) {
              const dx = pointerInput.world.x - cell.x;
              const dy = pointerInput.world.y - cell.y;
              const length = Math.hypot(dx, dy);
              const deadZone = 9 / Math.max(0.2, this.camera.zoom);
              if (length > deadZone) dir = { x: dx / length, y: dy / length };
            }
            if (dir) {
              cell.aimX = dir.x;
              cell.aimY = dir.y;
            }
            this.moveCell(cell, dir, dt);
          }
        } else if (team.brain) {
          team.brain.update(dt, this);
          for (const cell of team.cells) {
            if (cell.dead) continue;
            this.moveCell(cell, team.brain.dir, dt);
          }
        }
      }

      this.updateOwnCellInteractions(dt);

      // Food collisions
      this.foodGrid.rebuild(this.foods);
      const cells = this.activeCells();
      for (const cell of cells) {
        if (cell.dead) continue;
        this.foodGrid.forEachNear(cell.x, cell.y, cell.radius + 12, (food) => {
          if (!food.active || cell.dead) return;
          const pickupDistance = cell.radius + food.r * 0.35;
          if (dist2(cell.x, cell.y, food.x, food.y) <= pickupDistance * pickupDistance) {
            this.collectFood(cell, food);
          }
        });
      }

      // Capture values before eating resolves, so a last-second death still
      // reports the mass/rank the player had at that moment.
      this.preDeathMass = this.playerMass();
      this.preDeathRank = this.playerRank();

      this.handleCellCollisions();
      this.cleanupDeadCells();
      this.syncRadii();

      if (this.state === 'playing') {
        const currentMass = this.playerMass();
        this.maxMass = Math.max(this.maxMass, currentMass);
        if (this.player.cells.length === 0) {
          const lastCell = this.player.lastCellPosition;
          this.startDeath(lastCell ? lastCell.x : this.camera.x, lastCell ? lastCell.y : this.camera.y);
        } else {
          const rank = this.playerRank();
          if (rank === 1 && !this.rankOneShown) {
            this.rankOneShown = true;
            this.callbacks.onEvent?.('rank-one');
          }
        }
      }

      this.particles.update(dt);
      this.updateEffects(dt);
      this.camera.update(dt, this);
    }

    getPointerIntent() {
      const pointer = this.pointerWorld || { x: this.camera.x, y: this.camera.y };
      return {
        world: pointer,
        keyboard: this.callbacks.getKeyboardDir ? this.callbacks.getKeyboardDir() : null
      };
    }

    moveCell(cell, dir, dt) {
      const speed = cellSpeed(cell.radius) * (cell.team.speedMult || 1);
      const targetVx = dir ? dir.x * speed : 0;
      const targetVy = dir ? dir.y * speed : 0;
      const responsiveness = 9;
      cell.vx += (targetVx - cell.vx) * Math.min(1, responsiveness * dt);
      cell.vy += (targetVy - cell.vy) * Math.min(1, responsiveness * dt);

      const dx = (cell.vx + cell.launchVx) * dt;
      const dy = (cell.vy + cell.launchVy) * dt;
      cell.x += dx;
      cell.y += dy;

      cell.launchVx *= Math.exp(-3.4 * dt);
      cell.launchVy *= Math.exp(-3.4 * dt);

      const r = cell.radius;
      if (cell.x < r) {
        cell.x = r;
        if (cell.vx < 0) cell.vx = 0;
        if (cell.launchVx < 0) cell.launchVx = 0;
      } else if (cell.x > ARENA_SIZE - r) {
        cell.x = ARENA_SIZE - r;
        if (cell.vx > 0) cell.vx = 0;
        if (cell.launchVx > 0) cell.launchVx = 0;
      }
      if (cell.y < r) {
        cell.y = r;
        if (cell.vy < 0) cell.vy = 0;
        if (cell.launchVy < 0) cell.launchVy = 0;
      } else if (cell.y > ARENA_SIZE - r) {
        cell.y = ARENA_SIZE - r;
        if (cell.vy > 0) cell.vy = 0;
        if (cell.launchVy > 0) cell.launchVy = 0;
      }
    }

    updateOwnCellInteractions(dt) {
      if (!this.player) return;
      const cells = this.player.cells;
      for (let i = 0; i < cells.length; i += 1) {
        const a = cells[i];
        if (a.dead) continue;
        for (let j = i + 1; j < cells.length; j += 1) {
          const b = cells[j];
          if (b.dead) continue;
          const d = dist(a.x, a.y, b.x, b.y);
          if (d <= 0.001) continue;

          if (a.mergeTimer <= 0 && b.mergeTimer <= 0 && d < (a.radius + b.radius) * 0.58) {
            const big = a.mass >= b.mass ? a : b;
            const small = big === a ? b : a;
            const total = big.mass + small.mass;
            big.x = (big.x * big.mass + small.x * small.mass) / total;
            big.y = (big.y * big.mass + small.y * small.mass) / total;
            big.mass = Math.min(MAX_CELL_MASS, total);
            big.mergeTimer = 0;
            big.flash = Math.max(big.flash, 0.35);
            small.dead = true;
            if (this.particles.enabled) {
              this.particles.burst(small.x, small.y, [big.team.colors.a, big.team.colors.glow], 6, {
                speedMin: 15,
                speedMax: 70,
                sizeMin: 1,
                sizeMax: 3,
                lifeMin: 0.25,
                lifeMax: 0.55
              });
            }
            continue;
          }

          const minDistance = (a.radius + b.radius) * 0.88;
          if (d < minDistance) {
            const overlap = minDistance - d;
            const nx = (b.x - a.x) / d;
            const ny = (b.y - a.y) / d;
            const total = Math.max(1, a.mass + b.mass);
            const push = overlap * Math.min(1, dt * 7) * 0.5;
            a.x -= nx * push * (b.mass / total);
            a.y -= ny * push * (b.mass / total);
            b.x += nx * push * (a.mass / total);
            b.y += ny * push * (a.mass / total);
          }
        }
      }
      this.player.cells = cells.filter((cell) => !cell.dead);
    }

    collectFood(cell, food) {
      if (!food.active) return;
      food.active = false;
      food.respawnAt = this.time + rand(0.5, 2.6);
      cell.mass = Math.min(MAX_CELL_MASS, cell.mass + food.mass);
      if (cell.team.isPlayer) {
        this.audio.food();
        if (this.particles.enabled) {
          this.particles.burst(food.x, food.y, [food.color, cell.team.colors.a], 3, {
            speedMin: 15,
            speedMax: 65,
            sizeMin: 1,
            sizeMax: 2.6,
            lifeMin: 0.25,
            lifeMax: 0.55
          });
        }
      } else if (this.particles.enabled && Math.random() < 0.15) {
        this.particles.burst(food.x, food.y, [food.color], 2, {
          speedMin: 10,
          speedMax: 45,
          sizeMin: 0.8,
          sizeMax: 1.8,
          lifeMin: 0.2,
          lifeMax: 0.45
        });
      }
    }

    handleCellCollisions() {
      const cells = this.activeCells();
      for (let i = 0; i < cells.length; i += 1) {
        const a = cells[i];
        if (a.dead) continue;
        for (let j = i + 1; j < cells.length; j += 1) {
          const b = cells[j];
          if (b.dead || a.team === b.team) continue;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d = Math.hypot(dx, dy);
          if (d <= 0.0001) {
            if (a.mass > b.mass * EAT_RATIO) this.consumeCell(a, b);
            else if (b.mass > a.mass * EAT_RATIO) this.consumeCell(b, a);
            continue;
          }

          const aShielded = a.team.isPlayer && a.team.spawnShield > 0;
          const bShielded = b.team.isPlayer && b.team.spawnShield > 0;
          const aEatsB = !bShielded && a.mass > b.mass * EAT_RATIO && d < a.radius - b.radius * 0.25;
          const bEatsA = !aShielded && b.mass > a.mass * EAT_RATIO && d < b.radius - a.radius * 0.25;

          if (aEatsB) {
            this.consumeCell(a, b);
            continue;
          }
          if (bEatsA) {
            this.consumeCell(b, a);
            continue;
          }

          const minDistance = (a.radius + b.radius) * 0.86;
          if (d < minDistance) {
            const overlap = minDistance - d;
            const nx = dx / d;
            const ny = dy / d;
            const total = Math.max(1, a.mass + b.mass);
            const push = overlap * 0.35;
            a.x -= nx * push * (b.mass / total);
            a.y -= ny * push * (b.mass / total);
            b.x += nx * push * (a.mass / total);
            b.y += ny * push * (a.mass / total);
            a.x = clamp(a.x, a.radius, ARENA_SIZE - a.radius);
            a.y = clamp(a.y, a.radius, ARENA_SIZE - a.radius);
            b.x = clamp(b.x, b.radius, ARENA_SIZE - b.radius);
            b.y = clamp(b.y, b.radius, ARENA_SIZE - b.radius);
          }
        }
      }
    }

    consumeCell(eater, victim) {
      if (eater.dead || victim.dead) return;
      const victimMass = victim.mass;
      eater.mass = Math.min(MAX_CELL_MASS, eater.mass + victimMass);
      victim.dead = true;
      victim.team.lastCellPosition = { x: victim.x, y: victim.y };
      eater.team.kills += 1;
      eater.flash = 1;

      if (eater.team.isPlayer) {
        this.audio.eatCell();
        this.addShake(Math.min(10, 2 + victimMass * 0.012));
        if (this.particles.enabled) {
          this.particles.burst(victim.x, victim.y, [victim.team.colors.a, victim.team.colors.b, eater.team.colors.a], 22, {
            speedMin: 40,
            speedMax: 210,
            sizeMin: 1.5,
            sizeMax: 5,
            lifeMin: 0.45,
            lifeMax: 1
          });
        }
        this.addRing(victim.x, victim.y, victim.team.colors.glow, victim.radius * 2.4, 0.55);
        this.addFloatText(victim.x, victim.y - victim.radius, `+${formatNumber(victimMass)}`, eater.team.colors.glow);
        this.callbacks.onEvent?.('kill', { name: victim.team.name, mass: victimMass });
      } else if (victim.team.isPlayer) {
        this.audio.cellLost();
        this.addShake(8);
        if (this.particles.enabled) {
          this.particles.burst(victim.x, victim.y, [victim.team.colors.a, '#ffffff', eater.team.colors.a], 18, {
            speedMin: 30,
            speedMax: 180,
            sizeMin: 1.2,
            sizeMax: 4.2,
            lifeMin: 0.4,
            lifeMax: 0.9
          });
        }
      } else if (this.particles.enabled && Math.random() < 0.5) {
        this.particles.burst(victim.x, victim.y, [victim.team.colors.a], 5, {
          speedMin: 20,
          speedMax: 100,
          sizeMin: 1,
          sizeMax: 3,
          lifeMin: 0.25,
          lifeMax: 0.6
        });
      }
    }

    cleanupDeadCells() {
      const playerCellsBefore = this.player ? this.player.cells.length : 0;
      for (const team of this.teams) {
        if (!team.cells.length) continue;
        team.cells = team.cells.filter((cell) => !cell.dead);
        if (!team.isPlayer && team.cells.length === 0 && team.alive) {
          team.alive = false;
          this.queueBotRespawn();
        }
      }
      if (this.player && this.player.cells.length === 0) {
        this.player.alive = false;
      } else if (this.player && playerCellsBefore > this.player.cells.length && this.player.cells.length > 0) {
        this.callbacks.onEvent?.('cell-lost', { remaining: this.player.cells.length });
      }
    }

    syncRadii() {
      for (const team of this.teams) {
        for (const cell of team.cells) {
          cell.radius = massToRadius(cell.mass);
          cell.drawRadius = cell.drawRadius || cell.radius;
        }
      }
    }

    splitPlayer() {
      if (this.state !== 'playing' || !this.player) return;
      if (this.splitLock > 0) return;
      const cells = this.player.cells.filter((cell) => !cell.dead && cell.mass >= MIN_SPLIT_MASS);
      if (!cells.length) return;
      let slots = MAX_PLAYER_CELLS - this.player.cells.length;
      if (slots <= 0) return;

      cells.sort((a, b) => b.mass - a.mass);
      let didSplit = false;
      for (const cell of cells) {
        if (slots <= 0) break;
        if (cell.mass < MIN_SPLIT_MASS) continue;
        const half = cell.mass / 2;
        const dirLength = Math.hypot(cell.aimX, cell.aimY) || 1;
        const dirX = cell.aimX / dirLength;
        const dirY = cell.aimY / dirLength;
        const mergeTime = MERGE_BASE_TIME + Math.sqrt(half) * 0.18;
        cell.mass = half;
        cell.mergeTimer = mergeTime;
        cell.mergeTotal = mergeTime;
        cell.flash = 1;
        cell.launchVx += dirX * 240;

        const newCell = new Cell(cell.team, cell.x + dirX * (cell.radius * 0.55), cell.y + dirY * (cell.radius * 0.55), half);
        newCell.aimX = dirX;
        newCell.aimY = dirY;
        newCell.mergeTimer = mergeTime;
        newCell.mergeTotal = mergeTime;
        newCell.launchVx = dirX * SPLIT_LAUNCH_SPEED;
        newCell.launchVy = dirY * SPLIT_LAUNCH_SPEED;
        newCell.flash = 1;
        this.player.cells.push(newCell);
        slots -= 1;
        didSplit = true;

        if (this.particles.enabled) {
          this.particles.burst(cell.x, cell.y, [this.player.colors.a, this.player.colors.glow], 14, {
            speedMin: 30,
            speedMax: 170,
            sizeMin: 1,
            sizeMax: 3.5,
            lifeMin: 0.3,
            lifeMax: 0.75
          });
        }
        this.addRing(cell.x, cell.y, this.player.colors.glow, cell.radius * 3.2, 0.4);
      }

      if (didSplit) {
        this.splitLock = SPLIT_COOLDOWN;
        this.audio.split();
        this.addShake(2.2);
      }
    }

    addShake(amount) {
      if (!this.particles.enabled) return;
      this.shake = Math.min(26, Math.max(this.shake, amount));
    }

    addRing(x, y, color, maxRadius, life) {
      if (!this.particles.enabled) return;
      if (this.effects.length > 40) this.effects.shift();
      this.effects.push({ x, y, color, maxRadius: Math.max(12, maxRadius), life, maxLife: life });
    }

    addFloatText(x, y, text, color) {
      if (!this.particles.enabled) return;
      if (this.floatTexts.length > 18) this.floatTexts.shift();
      this.floatTexts.push({ x, y, text, color, life: 0.9, maxLife: 0.9 });
    }

    updateEffects(dt) {
      for (let i = this.effects.length - 1; i >= 0; i -= 1) {
        const effect = this.effects[i];
        effect.life -= dt;
        if (effect.life <= 0) {
          this.effects.splice(i, 1);
        }
      }
      for (let i = this.floatTexts.length - 1; i >= 0; i -= 1) {
        const text = this.floatTexts[i];
        text.life -= dt;
        text.y -= 34 * dt;
        if (text.life <= 0) this.floatTexts.splice(i, 1);
      }
    }

    startDeath(x, y) {
      if (this.state !== 'playing') return;
      this.state = 'dying';
      this.deathTimer = 1.1;
      this.deathMass = Math.max(this.maxMass, this.preDeathMass || 0);
      this.deathRank = this.preDeathRank || this.playerRank() || 0;
      this.audio.gameOver();
      this.addShake(24);
      if (this.particles.enabled) {
        this.particles.burst(x, y, ['#ffffff', this.player.colors.a, this.player.colors.glow, '#ff59c7'], 60, {
          speedMin: 40,
          speedMax: 300,
          sizeMin: 1.4,
          sizeMax: 6,
          lifeMin: 0.6,
          lifeMax: 1.5
        });
      }
      this.addRing(x, y, '#ffffff', 240, 0.9);
      this.callbacks.onEvent?.('dying');
    }

    finishRun() {
      if (this.state !== 'dying') return;
      this.state = 'gameover';
      const difficulty = this.configDifficulty;
      const score = Math.floor(this.deathMass * 0.8 + this.player.kills * 55 + this.time * 2.1);
      const coins = Math.max(5, Math.round(score * 0.25 * difficulty.coinMult));
      const profile = this.store.profile;
      const previousBest = profile.best.mass || 0;
      const newBest = this.deathMass > previousBest;

      if (newBest) {
        profile.best.mass = Math.floor(this.deathMass);
        profile.best.time = this.time;
        profile.best.kills = this.player.kills;
        profile.best.rank = this.deathRank;
      }
      profile.coins += coins;
      profile.games += 1;
      profile.totalKills += this.player.kills;
      this.store.save();

      this.callbacks.onGameOver?.({
        time: this.time,
        mass: this.deathMass,
        kills: this.player.kills,
        rank: this.deathRank,
        difficulty: difficulty.label,
        bestMass: profile.best.mass,
        newBest,
        coins,
        score,
        wonRankOne: this.rankOneShown
      });
    }

    applyQuality() {
      const quality = this.quality;
      this.foodTarget = quality.food;
      this.particles.setCap(quality.particles);
      if (this.state === 'playing' || this.state === 'paused') {
        while (this.foods.length < this.foodTarget) {
          this.foods.push(this.createFood(rand(40, ARENA_SIZE - 40), rand(40, ARENA_SIZE - 40)));
        }
      }
    }

    getSnapshot() {
      return {
        state: this.state,
        difficulty: this.config ? this.config.difficulty : null,
        time: this.time,
        playerMass: this.playerMass(),
        maxMass: this.maxMass,
        kills: this.player ? this.player.kills : 0,
        rank: this.playerRank(),
        playerCells: this.player ? this.player.cells.length : 0,
        botTeams: this.teams.filter((team) => !team.isPlayer && team.cells.length).length,
        foodsActive: this.foods.filter((food) => food.active).length,
        particles: this.particles.items.length,
        mergeTimers: this.player ? this.player.cells.map((cell) => Number(cell.mergeTimer.toFixed(2))) : []
      };
    }
  }

  // -------------------------------------------------------------------------
  // Renderer — pure canvas drawing, no simulation state is mutated except
  // visual-only interpolation values (draw radius, flash decay).
  // -------------------------------------------------------------------------

  class Renderer {
    constructor(canvas, minimapCanvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: true });
      this.minimap = minimapCanvas;
      this.mctx = minimapCanvas.getContext('2d', { alpha: true });
      this.game = null;
      this.dprCap = 2;
      this.glowEnabled = true;
      this.cssW = 1;
      this.cssH = 1;
      this.dpr = 1;
      this.miniCssSize = 152;
      this.miniDpr = 1;
      this.dirty = true;
      this.lastNow = 0;

      let scheduled = 0;
      const scheduleResize = () => {
        if (scheduled) return;
        scheduled = window.requestAnimationFrame(() => {
          scheduled = 0;
          this.resize();
        });
      };
      window.addEventListener('resize', scheduleResize);
      window.addEventListener('orientationchange', scheduleResize);
      document.addEventListener('fullscreenchange', scheduleResize);
    }

    attach(game) {
      this.game = game;
      this.resize();
    }

    configureQuality(quality) {
      const q = quality || QUALITY.high;
      this.dprCap = q.dpr;
      this.glowEnabled = q.glow;
      this.resize();
    }

    resize() {
      const width = Math.max(1, this.canvas.clientWidth || window.innerWidth || 1);
      const height = Math.max(1, this.canvas.clientHeight || window.innerHeight || 1);
      const dpr = Math.min(window.devicePixelRatio || 1, this.dprCap);
      this.cssW = width;
      this.cssH = height;
      this.dpr = dpr;
      const pixelWidth = Math.round(width * dpr);
      const pixelHeight = Math.round(height * dpr);
      if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
        this.canvas.width = pixelWidth;
        this.canvas.height = pixelHeight;
      }
      if (this.game) this.game.camera.setViewport(width, height);
      this.resizeMinimap();
      this.dirty = true;
    }

    resizeMinimap() {
      const size = Math.max(40, this.minimap.clientWidth || 152);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.miniCssSize = size;
      this.miniDpr = dpr;
      const pixels = Math.round(size * dpr);
      if (this.minimap.width !== pixels || this.minimap.height !== pixels) {
        this.minimap.width = pixels;
        this.minimap.height = pixels;
      }
    }

    markDirty() {
      this.dirty = true;
    }

    resolveColors(team, cell, time) {
      if (team.skinId === 'prism') {
        const hue = (time * 55 + cell.id * 31) % 360;
        return {
          a: `hsl(${hue.toFixed(0)} 100% 69%)`,
          b: `hsl(${(hue + 62) % 360} 88% 24%)`,
          glow: `hsl(${hue.toFixed(0)} 100% 64%)`
        };
      }
      return team.colors;
    }

    draw(game, now) {
      const ctx = this.ctx;
      const width = this.cssW;
      const height = this.cssH;
      const dpr = this.dpr;
      const delta = clamp((now - this.lastNow) / 1000, 0, 0.06);
      this.lastNow = now;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      if (!game || !game.player) {
        this.dirty = false;
        return;
      }

      const camera = game.camera;
      const zoom = camera.zoom;
      const time = now / 1000;
      const shakeX = camera.shakeX;
      const shakeY = camera.shakeY;
      const offsetX = dpr * (width / 2 - (camera.x + shakeX) * zoom);
      const offsetY = dpr * (height / 2 - (camera.y + shakeY) * zoom);

      ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, offsetX, offsetY);

      const view = {
        left: camera.x - width / (2 * zoom) - 140,
        right: camera.x + width / (2 * zoom) + 140,
        top: camera.y - height / (2 * zoom) - 140,
        bottom: camera.y + height / (2 * zoom) + 140
      };

      this.drawArena(ctx, view, zoom, time);
      this.drawFood(ctx, game, view, time);

      const playerCells = game.player.cells;
      let playerMaxMass = 0;
      for (const cell of playerCells) playerMaxMass = Math.max(playerMaxMass, cell.mass);

      const cells = game.activeCells();
      cells.sort((a, b) => a.mass - b.mass);
      for (const cell of cells) {
        const drawR = Math.max(5, cell.drawRadius || cell.radius);
        if (cell.x + drawR < view.left || cell.x - drawR > view.right || cell.y + drawR < view.top || cell.y - drawR > view.bottom) {
          continue;
        }
        let danger = false;
        if (!cell.team.isPlayer && playerMaxMass > 0 && cell.mass > playerMaxMass * EAT_RATIO) {
          for (const own of playerCells) {
            if (dist(cell.x, cell.y, own.x, own.y) < 950) {
              danger = true;
              break;
            }
          }
        }
        this.drawCell(ctx, cell, time, zoom, delta, danger);
      }

      this.drawEffects(ctx, game, view, zoom);
      game.particles.draw(ctx, view);

      // Screen-space labels and floating pickups.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.drawLabels(ctx, game, camera, zoom, time);
      this.drawMinimap(game);

      this.dirty = false;
    }

    drawArena(ctx, view, zoom, time) {
      const left = Math.max(0, view.left);
      const right = Math.min(ARENA_SIZE, view.right);
      const top = Math.max(0, view.top);
      const bottom = Math.min(ARENA_SIZE, view.bottom);
      if (right <= left || bottom <= top) return;

      const step = 200;
      ctx.lineWidth = 1 / zoom;
      ctx.strokeStyle = 'rgba(98, 205, 184, 0.055)';
      ctx.beginPath();
      const startX = Math.ceil(left / step) * step;
      const startY = Math.ceil(top / step) * step;
      for (let x = startX; x <= right; x += step) {
        ctx.moveTo(x, top);
        ctx.lineTo(x, bottom);
      }
      for (let y = startY; y <= bottom; y += step) {
        ctx.moveTo(left, y);
        ctx.lineTo(right, y);
      }
      ctx.stroke();

      // Sparse membrane dots at coarser intersections.
      if (this.glowEnabled) {
        const dotStep = 400;
        ctx.fillStyle = 'rgba(140, 255, 235, 0.13)';
        for (let x = Math.ceil(left / dotStep) * dotStep; x <= right; x += dotStep) {
          for (let y = Math.ceil(top / dotStep) * dotStep; y <= bottom; y += dotStep) {
            ctx.beginPath();
            ctx.arc(x, y, 1.6 / zoom, 0, TAU);
            ctx.fill();
          }
        }
      }

      // Arena membrane border
      ctx.save();
      if (this.glowEnabled) {
        ctx.shadowColor = 'rgba(60, 245, 198, 0.6)';
        ctx.shadowBlur = 22;
      }
      ctx.strokeStyle = 'rgba(60, 245, 198, 0.55)';
      ctx.lineWidth = Math.max(2, 3 / zoom);
      ctx.strokeRect(0, 0, ARENA_SIZE, ARENA_SIZE);
      ctx.restore();

      ctx.strokeStyle = 'rgba(120, 255, 228, 0.10)';
      ctx.lineWidth = Math.max(1, 10 / zoom);
      ctx.strokeRect(12, 12, ARENA_SIZE - 24, ARENA_SIZE - 24);

      // Animated corner brackets
      const bracket = 110;
      const pulse = 0.28 + Math.sin(time * 1.4) * 0.08;
      ctx.strokeStyle = `rgba(200, 255, 99, ${pulse.toFixed(3)})`;
      ctx.lineWidth = Math.max(2, 4 / zoom);
      ctx.beginPath();
      ctx.moveTo(28, 28 + bracket); ctx.lineTo(28, 28); ctx.lineTo(28 + bracket, 28);
      ctx.moveTo(ARENA_SIZE - 28 - bracket, 28); ctx.lineTo(ARENA_SIZE - 28, 28); ctx.lineTo(ARENA_SIZE - 28, 28 + bracket);
      ctx.moveTo(28, ARENA_SIZE - 28 - bracket); ctx.lineTo(28, ARENA_SIZE - 28); ctx.lineTo(28 + bracket, ARENA_SIZE - 28);
      ctx.moveTo(ARENA_SIZE - 28 - bracket, ARENA_SIZE - 28); ctx.lineTo(ARENA_SIZE - 28, ARENA_SIZE - 28); ctx.lineTo(ARENA_SIZE - 28, ARENA_SIZE - 28 - bracket);
      ctx.stroke();
    }

    drawFood(ctx, game, view, time) {
      for (const food of game.foods) {
        if (!food.active) continue;
        if (food.x < view.left || food.x > view.right || food.y < view.top || food.y > view.bottom) continue;
        const pulse = 1 + Math.sin(time * 2.6 + food.phase) * 0.14;
        const radius = food.r * pulse;
        if (this.glowEnabled) {
          ctx.globalAlpha = 0.13;
          ctx.fillStyle = food.color;
          ctx.beginPath();
          ctx.arc(food.x, food.y, radius * 2.35, 0, TAU);
          ctx.fill();
        }
        ctx.globalAlpha = 0.95;
        ctx.fillStyle = food.color;
        ctx.beginPath();
        ctx.arc(food.x, food.y, radius, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 0.8;
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.beginPath();
        ctx.arc(food.x - radius * 0.24, food.y - radius * 0.28, radius * 0.3, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    drawCell(ctx, cell, time, zoom, delta, danger) {
      const team = cell.team;
      const colors = this.resolveColors(team, cell, time);
      const targetRadius = Math.max(5, cell.drawRadius || cell.radius);
      const pulse = 1 + Math.sin(time * 2.1 + cell.phase) * 0.012;
      const radius = targetRadius * pulse;

      cell.flash = Math.max(0, cell.flash - delta * 2.6);

      if (this.glowEnabled) {
        ctx.shadowColor = colors.glow;
        ctx.shadowBlur = team.isPlayer ? 30 : 15;
      }

      const gradient = ctx.createRadialGradient(
        cell.x - radius * 0.34,
        cell.y - radius * 0.36,
        radius * 0.05,
        cell.x,
        cell.y,
        radius * 1.03
      );
      gradient.addColorStop(0, colors.a);
      gradient.addColorStop(0.48, colors.a);
      gradient.addColorStop(1, colors.b);

      ctx.beginPath();
      const segments = radius > 44 ? 30 : 20;
      for (let i = 0; i <= segments; i += 1) {
        const angle = (i / segments) * TAU;
        const wobble = 1 + Math.sin(angle * 3 + time * 1.25 + cell.phase) * 0.012 + Math.sin(angle * 5 - time * 0.8) * 0.006;
        const px = cell.x + Math.cos(angle) * radius * wobble;
        const py = cell.y + Math.sin(angle) * radius * wobble;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();
      ctx.shadowBlur = 0;

      // Cell membrane
      ctx.strokeStyle = colors.a;
      ctx.globalAlpha = 0.8;
      ctx.lineWidth = Math.max(1.1, radius * 0.045);
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Soft nucleus
      const nucleus = ctx.createRadialGradient(
        cell.x - radius * 0.1,
        cell.y - radius * 0.12,
        0,
        cell.x,
        cell.y,
        radius * 0.58
      );
      nucleus.addColorStop(0, 'rgba(255,255,255,0.20)');
      nucleus.addColorStop(0.5, 'rgba(255,255,255,0.05)');
      nucleus.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = nucleus;
      ctx.beginPath();
      ctx.arc(cell.x, cell.y, radius * 0.6, 0, TAU);
      ctx.fill();

      // Highlight
      ctx.strokeStyle = 'rgba(255,255,255,0.28)';
      ctx.lineWidth = Math.max(0.8, radius * 0.022);
      ctx.beginPath();
      ctx.arc(cell.x - radius * 0.1, cell.y - radius * 0.12, radius * 0.78, Math.PI * 1.06, Math.PI * 1.54);
      ctx.stroke();

      if (cell.flash > 0.01) {
        ctx.globalAlpha = cell.flash * 0.6;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = Math.max(1.4, radius * 0.05);
        ctx.beginPath();
        ctx.arc(cell.x, cell.y, radius * (1 + (1 - cell.flash) * 0.22), 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      if (team.isPlayer && team.spawnShield > 0) {
        ctx.globalAlpha = 0.3 + Math.sin(time * 6) * 0.12;
        ctx.strokeStyle = '#ffffff';
        ctx.setLineDash([6 / zoom, 8 / zoom]);
        ctx.lineWidth = 2 / zoom;
        ctx.beginPath();
        ctx.arc(cell.x, cell.y, radius + 9 / zoom, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }

      if (team.isPlayer && cell.mergeTimer > 0) {
        const progress = clamp(1 - cell.mergeTimer / Math.max(0.001, cell.mergeTotal || cell.mergeTimer), 0, 1);
        ctx.globalAlpha = 0.55;
        ctx.strokeStyle = 'rgba(220, 255, 247, 0.85)';
        ctx.lineWidth = 2.2 / zoom;
        ctx.beginPath();
        ctx.arc(cell.x, cell.y, radius + 6 / zoom, -Math.PI / 2, -Math.PI / 2 + progress * TAU);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      if (danger) {
        ctx.globalAlpha = 0.32 + Math.sin(time * 3.4) * 0.1;
        ctx.strokeStyle = '#ff6079';
        ctx.setLineDash([9 / zoom, 7 / zoom]);
        ctx.lineWidth = 1.7 / zoom;
        ctx.beginPath();
        ctx.arc(cell.x, cell.y, radius + 5 / zoom, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }

      // Smoothly animate the displayed radius after growth.
      cell.drawRadius = lerp(cell.drawRadius, cell.radius, Math.min(1, 9 * delta));
    }

    drawEffects(ctx, game, view, zoom) {
      for (const effect of game.effects) {
        if (effect.x < view.left || effect.x > view.right || effect.y < view.top || effect.y > view.bottom) continue;
        const progress = 1 - effect.life / effect.maxLife;
        const eased = 1 - Math.pow(1 - progress, 3);
        const radius = effect.maxRadius * eased;
        ctx.globalAlpha = Math.max(0, effect.life / effect.maxLife) * 0.55;
        ctx.strokeStyle = effect.color;
        ctx.lineWidth = Math.max(1.5, 3.5 / zoom);
        ctx.beginPath();
        ctx.arc(effect.x, effect.y, radius, 0, TAU);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    drawLabels(ctx, game, camera, zoom, time) {
      const width = this.cssW;
      const height = this.cssH;
      const allCells = game.activeCells();
      allCells.sort((a, b) => a.mass - b.mass);

      for (const cell of allCells) {
        const radius = Math.max(5, cell.drawRadius || cell.radius);
        const screenX = (cell.x - (camera.x + camera.shakeX)) * zoom + width / 2;
        const screenY = (cell.y - (camera.y + camera.shakeY)) * zoom + height / 2;
        const screenRadius = radius * zoom;
        if (screenX + screenRadius < -40 || screenX - screenRadius > width + 40 || screenY + screenRadius < -40 || screenY - screenRadius > height + 40) {
          continue;
        }
        if (!cell.team.isPlayer && screenRadius < 9) continue;

        const fontSize = clamp(11 + screenRadius * 0.055, 11, 20);
        ctx.font = `700 ${fontSize.toFixed(1)}px Rajdhani, Segoe UI, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.lineJoin = 'round';
        ctx.lineWidth = Math.max(3, fontSize * 0.23);
        ctx.strokeStyle = 'rgba(2, 6, 12, 0.88)';
        ctx.fillStyle = cell.team.isPlayer ? '#eafff8' : 'rgba(224, 242, 249, 0.9)';
        const labelY = screenY - screenRadius - 5;
        ctx.strokeText(cell.team.name, screenX, labelY);
        ctx.fillText(cell.team.name, screenX, labelY);
      }

      // Floating mass pickup text
      for (const item of game.floatTexts) {
        const screenX = (item.x - (camera.x + camera.shakeX)) * zoom + width / 2;
        const screenY = (item.y - (camera.y + camera.shakeY)) * zoom + height / 2;
        const alpha = clamp(item.life / item.maxLife, 0, 1);
        ctx.globalAlpha = alpha;
        ctx.font = '700 15px Rajdhani, Segoe UI, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(2, 6, 12, 0.85)';
        ctx.fillStyle = item.color;
        ctx.strokeText(item.text, screenX, screenY);
        ctx.fillText(item.text, screenX, screenY);
        ctx.globalAlpha = 1;
      }

      // Player direction tick near tiny cells (subtle aiming aid).
      if (game.player) {
        for (const cell of game.player.cells) {
          const screenX = (cell.x - (camera.x + camera.shakeX)) * zoom + width / 2;
          const screenY = (cell.y - (camera.y + camera.shakeY)) * zoom + height / 2;
          const screenRadius = Math.max(5, cell.drawRadius) * zoom;
          if (screenRadius > 44) continue;
          const length = Math.hypot(cell.aimX, cell.aimY) || 1;
          const ax = cell.aimX / length;
          const ay = cell.aimY / length;
          ctx.globalAlpha = 0.35;
          ctx.strokeStyle = '#d8fff7';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(screenX + ax * (screenRadius + 5), screenY + ay * (screenRadius + 5));
          ctx.lineTo(screenX + ax * (screenRadius + 12), screenY + ay * (screenRadius + 12));
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
    }

    drawMinimap(game) {
      if (!game.player) return;
      const ctx = this.mctx;
      const size = this.miniCssSize;
      const dpr = this.miniDpr;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.minimap.width, this.minimap.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      ctx.fillStyle = 'rgba(3, 8, 15, 0.92)';
      ctx.fillRect(0, 0, size, size);

      const pad = 7;
      const scale = (size - pad * 2) / ARENA_SIZE;

      // Camera viewport
      const camera = game.camera;
      const halfW = camera.canvasW / (2 * camera.zoom);
      const halfH = camera.canvasH / (2 * camera.zoom);
      const viewLeft = clamp(camera.x - halfW, 0, ARENA_SIZE);
      const viewTop = clamp(camera.y - halfH, 0, ARENA_SIZE);
      const viewRight = clamp(camera.x + halfW, 0, ARENA_SIZE);
      const viewBottom = clamp(camera.y + halfH, 0, ARENA_SIZE);
      ctx.fillStyle = 'rgba(60, 245, 198, 0.075)';
      ctx.fillRect(pad + viewLeft * scale, pad + viewTop * scale, Math.max(1, (viewRight - viewLeft) * scale), Math.max(1, (viewBottom - viewTop) * scale));

      ctx.strokeStyle = 'rgba(120, 255, 228, 0.18)';
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
      ctx.strokeStyle = 'rgba(120, 255, 228, 0.06)';
      for (let i = 1; i <= 3; i += 1) {
        const p = (size / 4) * i;
        ctx.beginPath();
        ctx.moveTo(p, 0); ctx.lineTo(p, size);
        ctx.moveTo(0, p); ctx.lineTo(size, p);
        ctx.stroke();
      }

      const playerCells = game.player.cells;
      for (const team of game.teams) {
        for (const cell of team.cells) {
          if (cell.dead) continue;
          const x = pad + cell.x * scale;
          const y = pad + cell.y * scale;
          const dotRadius = clamp(1.5 + massToRadius(cell.mass) * 0.07, 1.5, 4.8);
          ctx.fillStyle = team.colors.a;
          ctx.globalAlpha = team.isPlayer ? 0.95 : 0.72;
          ctx.beginPath();
          ctx.arc(x, y, dotRadius, 0, TAU);
          ctx.fill();
          if (team.isPlayer) {
            ctx.globalAlpha = 0.9;
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.3;
            ctx.beginPath();
            ctx.arc(x, y, dotRadius + 2.2, 0, TAU);
            ctx.stroke();
          }
        }
      }
      ctx.globalAlpha = 1;

      // Direction of largest own cell
      if (playerCells.length) {
        const biggest = playerCells.reduce((a, b) => (a.mass > b.mass ? a : b));
        const x = pad + biggest.x * scale;
        const y = pad + biggest.y * scale;
        const length = Math.hypot(biggest.aimX, biggest.aimY) || 1;
        ctx.strokeStyle = 'rgba(60, 245, 198, 0.55)';
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (biggest.aimX / length) * 7, y + (biggest.aimY / length) * 7);
        ctx.stroke();
      }
    }
  }

  // -------------------------------------------------------------------------
  // Menu backdrop — slow floating cells, independent of the simulation.
  // -------------------------------------------------------------------------

  class MenuScene {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.dpr = 1;
      this.cssW = 1;
      this.cssH = 1;
      this.blobs = [];
      this.dots = [];
      this.colors = [
        '60, 245, 198',
        '200, 255, 99',
        '255, 89, 199',
        '143, 118, 255',
        '92, 220, 255'
      ];
      this.create();
      let scheduled = 0;
      const scheduleResize = () => {
        if (scheduled) return;
        scheduled = window.requestAnimationFrame(() => {
          scheduled = 0;
          this.resize();
        });
      };
      window.addEventListener('resize', scheduleResize);
      window.addEventListener('orientationchange', scheduleResize);
      this.resize();
    }

    create() {
      this.blobs = [];
      for (let i = 0; i < 9; i += 1) {
        this.blobs.push({
          x: Math.random(),
          y: Math.random(),
          scale: rand(0.08, 0.2),
          vx: rand(-0.0018, 0.0018),
          vy: rand(-0.0014, 0.0014),
          phase: rand(0, TAU),
          color: this.colors[i % this.colors.length],
          alpha: rand(0.04, 0.085)
        });
      }
      this.dots = [];
      for (let i = 0; i < 34; i += 1) {
        this.dots.push({
          x: Math.random(),
          y: Math.random(),
          size: rand(1.5, 3.4),
          phase: rand(0, TAU),
          speed: rand(0.3, 0.9),
          color: pick(this.colors)
        });
      }
    }

    resize() {
      const width = Math.max(1, this.canvas.clientWidth || window.innerWidth || 1);
      const height = Math.max(1, this.canvas.clientHeight || window.innerHeight || 1);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.cssW = width;
      this.cssH = height;
      this.dpr = dpr;
      this.canvas.width = Math.round(width * dpr);
      this.canvas.height = Math.round(height * dpr);
    }

    update(dt) {
      for (const blob of this.blobs) {
        blob.x += blob.vx * dt;
        blob.y += blob.vy * dt;
        if (blob.x < -0.15) blob.x = 1.15;
        if (blob.x > 1.15) blob.x = -0.15;
        if (blob.y < -0.15) blob.y = 1.15;
        if (blob.y > 1.15) blob.y = -0.15;
      }
    }

    draw(time) {
      const ctx = this.ctx;
      const width = this.cssW;
      const height = this.cssH;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      const base = Math.min(width, height);

      for (const blob of this.blobs) {
        const cx = blob.x * width;
        const cy = blob.y * height;
        const radius = base * blob.scale * (1 + Math.sin(time * 0.5 + blob.phase) * 0.08);
        const gradient = ctx.createRadialGradient(cx - radius * 0.25, cy - radius * 0.3, radius * 0.08, cx, cy, radius);
        gradient.addColorStop(0, `rgba(${blob.color}, ${blob.alpha * 1.6})`);
        gradient.addColorStop(0.6, `rgba(${blob.color}, ${blob.alpha})`);
        gradient.addColorStop(1, `rgba(${blob.color}, 0)`);
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, TAU);
        ctx.fill();

        ctx.strokeStyle = `rgba(${blob.color}, ${blob.alpha * 2.2})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, cy, radius * 0.78, 0, TAU);
        ctx.stroke();
      }

      for (const dot of this.dots) {
        const x = dot.x * width + Math.cos(time * dot.speed + dot.phase) * 14;
        const y = dot.y * height + Math.sin(time * dot.speed * 0.8 + dot.phase) * 18;
        const alpha = 0.16 + (Math.sin(time * 1.6 + dot.phase) * 0.5 + 0.5) * 0.22;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = `rgb(${dot.color})`;
        ctx.beginPath();
        ctx.arc(x, y, dot.size, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      const vignette = ctx.createRadialGradient(width * 0.5, height * 0.45, base * 0.2, width * 0.5, height * 0.5, base * 0.85);
      vignette.addColorStop(0, 'rgba(4,8,16,0)');
      vignette.addColorStop(1, 'rgba(4,8,16,0.5)');
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, width, height);
    }
  }

  // -------------------------------------------------------------------------
  // Input — converts browser input into a simple intent layer.
  // -------------------------------------------------------------------------

  class InputController {
    constructor(canvas, game) {
      this.canvas = canvas;
      this.game = game;
      this.pointer = {
        x: Math.max(1, canvas.clientWidth) / 2,
        y: Math.max(1, canvas.clientHeight) / 2
      };
      this.keys = new Set();
      this.touchSteering = false;
      this.bind();
    }

    bind() {
      window.addEventListener('pointermove', (event) => {
        if (event.pointerType === 'mouse' || event.pointerType === 'pen') this.updatePointer(event);
      }, { passive: true });

      this.canvas.addEventListener('pointermove', (event) => {
        if (event.pointerType === 'touch' && this.touchSteering) this.updatePointer(event);
      }, { passive: true });

      this.canvas.addEventListener('pointerdown', (event) => {
        if (event.pointerType === 'mouse') {
          if (event.button === 0) this.game.splitPlayer();
        } else {
          this.touchSteering = true;
          this.updatePointer(event);
        }
      });

      window.addEventListener('pointerup', (event) => {
        if (event.pointerType !== 'mouse') this.touchSteering = false;
      }, { passive: true });

      window.addEventListener('pointercancel', () => {
        this.touchSteering = false;
      }, { passive: true });

      window.addEventListener('keydown', (event) => this.handleKeyDown(event));
      window.addEventListener('keyup', (event) => this.handleKeyUp(event));
      window.addEventListener('blur', () => this.keys.clear());
      this.canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    }

    updatePointer(event) {
      const rect = this.canvas.getBoundingClientRect();
      this.pointer.x = clamp(event.clientX - rect.left, 0, rect.width);
      this.pointer.y = clamp(event.clientY - rect.top, 0, rect.height);
    }

    isTypingTarget(event) {
      const target = event.target;
      if (!target) return false;
      const tag = target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
    }

    handleKeyDown(event) {
      if (this.isTypingTarget(event)) return;
      const key = event.key.toLowerCase();
      const movementKeys = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'];
      if (movementKeys.includes(key)) {
        this.keys.add(key);
        if (this.game.state === 'playing') event.preventDefault();
        return;
      }
      if (event.code === 'Space' || event.key === ' ') {
        if (this.game.state === 'playing') {
          event.preventDefault();
          if (!event.repeat) this.game.splitPlayer();
        }
      }
    }

    handleKeyUp(event) {
      this.keys.delete(event.key.toLowerCase());
    }

    getKeyboardDir() {
      let x = 0;
      let y = 0;
      if (this.keys.has('a') || this.keys.has('arrowleft')) x -= 1;
      if (this.keys.has('d') || this.keys.has('arrowright')) x += 1;
      if (this.keys.has('w') || this.keys.has('arrowup')) y -= 1;
      if (this.keys.has('s') || this.keys.has('arrowdown')) y += 1;
      if (x === 0 && y === 0) return null;
      const length = Math.hypot(x, y);
      return { x: x / length, y: y / length };
    }

    reset() {
      this.keys.clear();
      this.touchSteering = false;
    }
  }

  // -------------------------------------------------------------------------
  // UI controller — screens, menus, HUD and DOM wiring.
  // -------------------------------------------------------------------------

  class UIController {
    constructor(store, audio, game, renderer, input) {
      this.store = store;
      this.profile = store.profile;
      this.audio = audio;
      this.game = game;
      this.renderer = renderer;
      this.input = input;

      this.selectedDiff = 'normal';
      this.currentConfig = null;
      this.currentScreen = 'menu';
      this.settingsOrigin = 'menu';
      this.toastTimer = null;
      this.hudAccumulator = 0;
      this.leaderboardAccumulator = 0;
      this.lbRows = [];

      this.cacheElements();
      this.buildDifficultyCards();
      this.buildLeaderboardRows();
      this.bindEvents();
      this.syncSettingsUI();
      this.updatePreviews();
      this.updateMenuStats();
      this.renderSkinGrid();
      this.selectDifficulty('normal', true);
      this.applyHints();
      this.applyQuality();
      this.setGameActive(false);
      this.showScreen('menu');
    }

    cacheElements() {
      const byId = (id) => document.getElementById(id);
      this.app = byId('cw-app');
      this.hud = byId('cw-hud');
      this.hudName = byId('cw-hud-player-name');
      this.hudMass = byId('cw-hud-mass');
      this.hudRank = byId('cw-hud-rank');
      this.hudTime = byId('cw-hud-time');
      this.hudKills = byId('cw-hud-kills');
      this.leaderboardList = byId('cw-leaderboard-list');
      this.controlsHint = byId('cw-controls-hint');
      this.toast = byId('cw-toast');

      this.screens = Array.from(document.querySelectorAll('.cw-screen'));
      this.menuCoins = byId('cw-menu-coins');
      this.menuBest = byId('cw-menu-best');
      this.menuGames = byId('cw-menu-games');
      this.menuOrb = byId('cw-menu-orb');
      this.menuSkinName = byId('cw-menu-skin-name');
      this.menuSkinDesc = byId('cw-menu-skin-desc');
      this.menuSkinCode = byId('cw-menu-skin-code');

      this.nameInput = byId('cw-name-input');
      this.difficultyGrid = byId('cw-difficulty-grid');
      this.setupBest = byId('cw-setup-best');
      this.setupCoins = byId('cw-setup-coins');
      this.setupOrb = byId('cw-setup-orb');
      this.setupSkinName = byId('cw-setup-skin-name');
      this.setupSkinDesc = byId('cw-setup-skin-desc');

      this.collectionCoins = byId('cw-collection-coins');
      this.skinGrid = byId('cw-skin-grid');

      this.sfxSlider = byId('cw-set-sfx');
      this.sfxValue = byId('cw-set-sfx-val');
      this.musicSlider = byId('cw-set-music');
      this.musicValue = byId('cw-set-music-val');
      this.particlesToggle = byId('cw-set-particles');
      this.hintsToggle = byId('cw-set-hints');
      this.qualityGroup = byId('cw-quality-group');
      this.qualityDesc = byId('cw-set-quality-desc');
      this.fullscreenButton = byId('cw-btn-fullscreen');

      this.pauseMass = byId('cw-pause-mass');
      this.pauseRank = byId('cw-pause-rank');
      this.pauseTime = byId('cw-pause-time');

      this.resKicker = byId('cw-res-kicker');
      this.resTitle = byId('cw-res-title');
      this.resSub = byId('cw-res-sub');
      this.resTime = byId('cw-res-time');
      this.resMass = byId('cw-res-mass');
      this.resKills = byId('cw-res-kills');
      this.resRank = byId('cw-res-rank');
      this.resBest = byId('cw-res-best');
      this.resCoins = byId('cw-res-coins');
      this.resNewBest = byId('cw-res-newbest');

      this.btnAgain = byId('cw-btn-again');
      this.btnGameoverMenu = byId('cw-btn-gameover-menu');
      this.touchSplit = byId('cw-btn-touch-split');
    }

    // -----------------------------------------------------------------------
    // Screens
    // -----------------------------------------------------------------------

    blurScreenFocus() {
      const active = document.activeElement;
      if (active && active.closest && active.closest('.cw-screen') && typeof active.blur === 'function') {
        active.blur();
      }
    }

    showScreen(name) {
      this.blurScreenFocus();
      const targetId = name ? `cw-screen-${name}` : null;
      for (const screen of this.screens) {
        const active = screen.id === targetId;
        screen.classList.toggle('is-active', active);
        screen.setAttribute('aria-hidden', String(!active));
        screen.inert = !active;
      }
      this.currentScreen = name;
      this.app.classList.toggle('cw-game-over', name === 'gameover');
      this.renderer.markDirty();
    }

    hideScreens() {
      this.blurScreenFocus();
      for (const screen of this.screens) {
        screen.classList.remove('is-active');
        screen.setAttribute('aria-hidden', 'true');
        screen.inert = true;
      }
      this.currentScreen = null;
      this.app.classList.remove('cw-game-over');
    }

    setGameActive(active) {
      this.app.classList.toggle('cw-game-active', active);
      this.hud.setAttribute('aria-hidden', String(!active));
      if (active) {
        this.hudAccumulator = 1;
        this.updateHud(true);
      } else {
        this.hideToast();
      }
      this.renderer.markDirty();
    }

    // -----------------------------------------------------------------------
    // Menu / setup / collection
    // -----------------------------------------------------------------------

    openSetup() {
      this.nameInput.value = this.profile.name || '';
      this.updatePreviews();
      this.updateMenuStats();
      this.selectDifficulty(this.selectedDiff, true);
      this.showScreen('setup');
      this.input.reset();
      this.audio.click();
      window.setTimeout(() => {
        if (this.currentScreen === 'setup') this.nameInput.focus({ preventScroll: true });
      }, 220);
    }

    startBattle() {
      const raw = String(this.nameInput.value || '');
      const name = sanitizeName(raw);
      this.profile.name = raw.trim() ? name : '';
      this.store.save();

      this.currentConfig = {
        name,
        difficulty: this.selectedDiff,
        skinId: this.profile.skin
      };

      this.hideScreens();
      this.setGameActive(true);
      this.game.start(this.currentConfig);
      this.input.reset();
      this.updateHud(true);
      this.updateLeaderboard(true);
      this.updatePreviews();
      this.renderer.markDirty();
      this.audio.click();
    }

    pauseBattle() {
      if (this.game.state !== 'playing') return;
      this.game.pause();
      this.updatePauseStats();
      this.showScreen('pause');
      this.input.reset();
      this.renderer.markDirty();
      this.audio.click();
    }

    resumeBattle() {
      if (this.game.state !== 'paused') return;
      this.game.resume();
      this.hideScreens();
      this.input.reset();
      this.renderer.markDirty();
      this.audio.click();
    }

    restartBattle() {
      const config = this.currentConfig || {
        name: sanitizeName(this.profile.name || 'PILOT'),
        difficulty: this.selectedDiff,
        skinId: this.profile.skin
      };
      this.currentConfig = config;
      this.hideScreens();
      this.setGameActive(true);
      this.game.start(config);
      this.input.reset();
      this.updateHud(true);
      this.updateLeaderboard(true);
      this.renderer.markDirty();
      this.audio.click();
    }

    quitToMenu() {
      this.game.stop();
      this.setGameActive(false);
      this.hideScreens();
      this.showScreen('menu');
      this.updateMenuStats();
      this.updatePreviews();
      this.renderSkinGrid();
      this.input.reset();
      this.renderer.markDirty();
      this.audio.click();
    }

    openCollection() {
      this.renderSkinGrid();
      this.updateMenuStats();
      this.showScreen('collection');
      this.input.reset();
      this.audio.click();
    }

    openSettings(origin) {
      this.settingsOrigin = origin;
      this.syncSettingsUI();
      this.showScreen('settings');
      this.input.reset();
      this.audio.click();
    }

    closeSettings() {
      this.store.save();
      this.audio.click();
      if (this.settingsOrigin === 'pause' && this.game.state === 'paused') {
        this.updatePauseStats();
        this.showScreen('pause');
      } else {
        this.showScreen('menu');
        this.updateMenuStats();
      }
      this.input.reset();
      this.renderer.markDirty();
    }

    buildDifficultyCards() {
      this.difficultyGrid.replaceChildren();
      Object.values(DIFFICULTIES).forEach((diff) => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'cw-diff-card';
        card.dataset.diff = diff.id;
        card.style.setProperty('--diff', diff.color);
        card.setAttribute('aria-pressed', 'false');

        const name = document.createElement('strong');
        name.textContent = diff.label;
        const check = document.createElement('span');
        check.className = 'cw-diff-check';
        check.textContent = '◆';
        const blurb = document.createElement('small');
        blurb.textContent = diff.blurb;
        const meta = document.createElement('span');
        meta.className = 'cw-diff-meta';
        meta.textContent = `${diff.botCount} BOTS · ${diff.coinMult}× CREDITS`;

        card.append(name, check, blurb, meta);
        this.difficultyGrid.appendChild(card);
      });
    }

    selectDifficulty(id, silent = false) {
      if (!DIFFICULTIES[id]) return;
      this.selectedDiff = id;
      for (const card of this.difficultyGrid.querySelectorAll('.cw-diff-card')) {
        const active = card.dataset.diff === id;
        card.classList.toggle('is-selected', active);
        card.setAttribute('aria-pressed', String(active));
      }
      if (!silent) this.audio.click();
    }

    renderSkinGrid() {
      this.skinGrid.replaceChildren();
      const equipped = this.profile.skin;
      for (const skin of SKINS) {
        const owned = this.profile.owned.includes(skin.id);
        const isEquipped = equipped === skin.id;
        const card = document.createElement('article');
        card.className = `cw-skin-card${isEquipped ? ' is-equipped' : ''}${owned ? '' : ' is-locked'}`;
        card.dataset.skin = skin.id;
        card.style.setProperty('--skin-a', skin.a);
        card.style.setProperty('--skin-b', skin.b);
        card.style.setProperty('--skin-glow', skin.glow || skin.a);

        const orb = document.createElement('div');
        orb.className = `cw-skin-orb${skin.special === 'rainbow' ? ' is-prism' : ''}`;
        const name = document.createElement('div');
        name.className = 'cw-skin-name';
        name.textContent = skin.name;
        const desc = document.createElement('div');
        desc.className = 'cw-skin-desc';
        desc.textContent = skin.desc;
        const state = document.createElement('div');
        state.className = 'cw-skin-state';
        state.textContent = isEquipped ? 'AKTIV' : owned ? 'FREIGESCHALTET' : `GESPERRT · ${skin.price} CR`;

        const action = document.createElement('button');
        action.type = 'button';
        action.className = 'cw-skin-action';
        action.dataset.skinAction = owned ? 'equip' : 'buy';
        action.dataset.skin = skin.id;
        if (isEquipped) {
          action.textContent = 'AKTIV';
          action.disabled = true;
        } else if (owned) {
          action.textContent = 'EQUIP';
        } else {
          action.textContent = `KAUFEN · ${skin.price} CR`;
        }

        card.append(orb, name, desc, state, action);
        this.skinGrid.appendChild(card);
      }
    }

    equipSkin(id) {
      const skin = skinById(id);
      if (!this.profile.owned.includes(id)) {
        this.showToast('ZUERST FREISCHALTEN', 'warn');
        this.audio.click();
        return;
      }
      if (this.profile.skin === id) return;
      this.profile.skin = id;
      this.store.save();
      this.updatePreviews();
      this.renderSkinGrid();
      this.audio.click();
    }

    buySkin(id) {
      const skin = skinById(id);
      if (!skin) return;
      if (this.profile.owned.includes(id)) {
        this.equipSkin(id);
        return;
      }
      if (this.profile.coins < skin.price) {
        this.showToast(`NICHT GENUG CREDITS · ES FEHLEN ${skin.price - this.profile.coins}`, 'warn');
        this.audio.click();
        return;
      }
      this.profile.coins -= skin.price;
      this.profile.owned.push(id);
      this.profile.skin = id;
      this.store.save();
      this.updateMenuStats();
      this.updatePreviews();
      this.renderSkinGrid();
      this.audio.rankOne();
      this.showToast(`${skin.name} FREIGESCHALTET`, 'good');
    }

    updatePreviews() {
      const skin = skinById(this.profile.skin);
      const applyOrb = (orb) => {
        if (!orb) return;
        orb.style.setProperty('--orb-a', skin.a);
        orb.style.setProperty('--orb-b', skin.b);
        orb.style.setProperty('--orb-glow', skin.glow || skin.a);
        orb.classList.toggle('is-prism', skin.special === 'rainbow');
      };
      applyOrb(this.menuOrb);
      applyOrb(this.setupOrb);
      const code = `CW-${String(SKINS.findIndex((candidate) => candidate.id === skin.id) + 1).padStart(2, '0')}`;
      this.menuSkinCode.textContent = code;
      this.menuSkinName.textContent = skin.name;
      this.menuSkinDesc.textContent = skin.desc;
      this.setupSkinName.textContent = skin.name;
      this.setupSkinDesc.textContent = skin.desc;
    }

    updateMenuStats() {
      const best = this.profile.best.mass ? formatCompact(this.profile.best.mass) : '—';
      this.menuCoins.textContent = formatNumber(this.profile.coins);
      this.menuBest.textContent = best;
      this.menuGames.textContent = formatNumber(this.profile.games);
      this.setupBest.textContent = best;
      this.setupCoins.textContent = formatNumber(this.profile.coins);
      this.collectionCoins.textContent = formatNumber(this.profile.coins);
    }

    updatePauseStats() {
      const player = this.game.player;
      if (!player) return;
      const rank = this.game.playerRank();
      this.pauseMass.textContent = formatNumber(this.game.playerMass());
      this.pauseRank.textContent = rank ? `#${rank}` : '#--';
      this.pauseTime.textContent = formatTime(this.game.time);
    }

    // -----------------------------------------------------------------------
    // Event wiring
    // -----------------------------------------------------------------------

    bindEvents() {
      const byId = (id) => document.getElementById(id);

      byId('cw-btn-play').addEventListener('click', () => this.openSetup());
      byId('cw-btn-collection').addEventListener('click', () => this.openCollection());
      byId('cw-btn-settings').addEventListener('click', () => this.openSettings('menu'));
      byId('cw-setup-back').addEventListener('click', () => {
        this.showScreen('menu');
        this.updateMenuStats();
        this.audio.click();
      });
      byId('cw-collection-back').addEventListener('click', () => {
        this.showScreen('menu');
        this.updateMenuStats();
        this.audio.click();
      });
      byId('cw-settings-back').addEventListener('click', () => this.closeSettings());
      byId('cw-btn-start').addEventListener('click', () => this.startBattle());
      byId('cw-btn-pause').addEventListener('click', () => this.pauseBattle());
      byId('cw-btn-resume').addEventListener('click', () => this.resumeBattle());
      byId('cw-btn-restart').addEventListener('click', () => this.restartBattle());
      byId('cw-btn-pause-settings').addEventListener('click', () => this.openSettings('pause'));
      byId('cw-btn-quit').addEventListener('click', () => this.quitToMenu());
      this.btnAgain.addEventListener('click', () => this.restartBattle());
      this.btnGameoverMenu.addEventListener('click', () => this.quitToMenu());

      this.touchSplit.addEventListener('click', () => {
        this.game.splitPlayer();
      });

      this.difficultyGrid.addEventListener('click', (event) => {
        const card = event.target.closest('.cw-diff-card');
        if (card) this.selectDifficulty(card.dataset.diff);
      });

      this.skinGrid.addEventListener('click', (event) => {
        const button = event.target.closest('[data-skin-action]');
        if (button) {
          if (button.dataset.skinAction === 'buy') this.buySkin(button.dataset.skin);
          else this.equipSkin(button.dataset.skin);
          return;
        }
        const card = event.target.closest('.cw-skin-card');
        if (card) this.equipSkin(card.dataset.skin);
      });

      this.nameInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          this.startBattle();
        }
      });

      this.sfxSlider.addEventListener('input', () => {
        const value = Number(this.sfxSlider.value);
        this.profile.settings.sfx = value;
        this.audio.setSfxVolume(value);
        this.sfxValue.textContent = `${Math.round(value * 100)}%`;
      });
      this.sfxSlider.addEventListener('change', () => this.store.save());

      this.musicSlider.addEventListener('input', () => {
        const value = Number(this.musicSlider.value);
        this.profile.settings.music = value;
        this.audio.setMusicVolume(value);
        this.musicValue.textContent = `${Math.round(value * 100)}%`;
      });
      this.musicSlider.addEventListener('change', () => {
        this.store.save();
        this.audio.unlock();
      });

      this.particlesToggle.addEventListener('click', () => {
        const enabled = this.profile.settings.particles !== false;
        this.profile.settings.particles = !enabled;
        this.applyParticlesSetting();
        this.store.save();
        this.syncSettingsUI();
        this.audio.click();
      });

      this.hintsToggle.addEventListener('click', () => {
        this.profile.settings.hints = this.profile.settings.hints === false;
        this.applyHints();
        this.store.save();
        this.syncSettingsUI();
        this.audio.click();
      });

      this.qualityGroup.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-quality]');
        if (!button) return;
        const id = button.dataset.quality;
        if (!QUALITY[id]) return;
        this.profile.settings.quality = id;
        this.applyQuality();
        this.store.save();
        this.syncSettingsUI();
        this.audio.click();
      });

      this.fullscreenButton.addEventListener('click', () => this.toggleFullscreen());

      window.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        if (this.currentScreen === 'settings') {
          event.preventDefault();
          this.closeSettings();
          return;
        }
        if (this.currentScreen === 'pause') {
          event.preventDefault();
          this.resumeBattle();
          return;
        }
        if (this.currentScreen === 'setup' || this.currentScreen === 'collection') {
          event.preventDefault();
          this.showScreen('menu');
          this.updateMenuStats();
          this.audio.click();
          return;
        }
        if (this.currentScreen === 'gameover') {
          event.preventDefault();
          this.quitToMenu();
          return;
        }
        if (this.game.state === 'playing' && this.app.classList.contains('cw-game-active')) {
          event.preventDefault();
          this.pauseBattle();
        }
      });

      document.addEventListener('visibilitychange', () => {
        if (document.hidden && this.game.state === 'playing') this.pauseBattle();
      });

      document.addEventListener('fullscreenchange', () => {
        window.setTimeout(() => {
          this.renderer.resize();
          this.syncSettingsUI();
          this.renderer.markDirty();
        }, 80);
      });
    }

    applyParticlesSetting() {
      const enabled = this.profile.settings.particles !== false;
      this.game.particles.enabled = enabled;
      if (!enabled) {
        this.game.particles.clear();
        this.game.effects.length = 0;
        this.game.floatTexts.length = 0;
      }
    }

    applyHints() {
      this.controlsHint.classList.toggle('is-hidden', this.profile.settings.hints === false);
    }

    applyQuality() {
      const quality = QUALITY[this.profile.settings.quality] || QUALITY.high;
      this.renderer.configureQuality(quality);
      this.game.applyQuality();
      this.applyParticlesSetting();
    }

    syncSettingsUI() {
      const settings = this.profile.settings;
      this.sfxSlider.value = String(settings.sfx);
      this.sfxValue.textContent = `${Math.round(settings.sfx * 100)}%`;
      this.musicSlider.value = String(settings.music);
      this.musicValue.textContent = `${Math.round(settings.music * 100)}%`;

      const particlesOn = settings.particles !== false;
      this.particlesToggle.textContent = particlesOn ? 'AN' : 'AUS';
      this.particlesToggle.setAttribute('aria-pressed', String(particlesOn));

      const hintsOn = settings.hints !== false;
      this.hintsToggle.textContent = hintsOn ? 'AN' : 'AUS';
      this.hintsToggle.setAttribute('aria-pressed', String(hintsOn));

      for (const button of this.qualityGroup.querySelectorAll('button[data-quality]')) {
        button.classList.toggle('is-active', button.dataset.quality === settings.quality);
      }
      const quality = QUALITY[settings.quality] || QUALITY.high;
      this.qualityDesc.textContent = quality.note;

      const isFullscreen = Boolean(document.fullscreenElement);
      this.fullscreenButton.textContent = isFullscreen ? 'VERLASSEN' : 'AKTIVIEREN';
      this.fullscreenButton.setAttribute('aria-pressed', String(isFullscreen));

      this.applyHints();
    }

    async toggleFullscreen() {
      this.audio.click();
      if (!document.fullscreenElement && navigator.userActivation && navigator.userActivation.isActive === false) {
        this.showToast('VOLLBILD NUR PER DIREKTEM KLICK', 'warn');
        return;
      }
      try {
        if (!document.fullscreenElement) {
          if (this.app.requestFullscreen) {
            const request = this.app.requestFullscreen();
            const timeout = new Promise((resolve, reject) => {
              window.setTimeout(() => reject(new Error('Fullscreen timeout')), 1600);
            });
            await Promise.race([request, timeout]);
            if (!document.fullscreenElement) throw new Error('Fullscreen denied');
          } else {
            this.showToast('VOLLBILD NICHT VERFÜGBAR', 'warn');
          }
        } else if (document.exitFullscreen) {
          await document.exitFullscreen();
        }
      } catch (error) {
        this.showToast('VOLLBILD NICHT VERFÜGBAR', 'warn');
      }
      this.syncSettingsUI();
    }

    // -----------------------------------------------------------------------
    // HUD / leaderboard / results
    // -----------------------------------------------------------------------

    buildLeaderboardRows() {
      this.leaderboardList.replaceChildren();
      this.lbRows = [];
      for (let i = 0; i < 9; i += 1) {
        const li = document.createElement('li');
        li.className = 'cw-lb-row';
        li.style.display = 'none';
        const rank = document.createElement('span');
        rank.className = 'cw-lb-rank';
        const dot = document.createElement('span');
        dot.className = 'cw-lb-dot';
        const name = document.createElement('span');
        name.className = 'cw-lb-name';
        const mass = document.createElement('span');
        mass.className = 'cw-lb-mass';
        li.append(rank, dot, name, mass);
        this.leaderboardList.appendChild(li);
        this.lbRows.push({ li, rank, dot, name, mass });
      }
    }

    updateLeaderboard() {
      if (!this.game.player) return;
      const width = window.innerWidth;
      const limit = width <= 480 ? 5 : width <= 720 ? 6 : 8;
      const standings = this.game.rankings();
      const playerRow = standings.find((row) => row.isPlayer);
      let rows = standings.slice(0, limit);
      let extraPlayer = false;
      if (playerRow && !rows.some((row) => row.isPlayer)) {
        rows = standings.slice(0, Math.max(0, limit - 1));
        rows.push(playerRow);
        extraPlayer = true;
      }

      for (let i = 0; i < this.lbRows.length; i += 1) {
        const row = rows[i];
        const nodes = this.lbRows[i];
        if (!row) {
          nodes.li.style.display = 'none';
          continue;
        }
        nodes.li.style.display = 'grid';
        nodes.li.classList.toggle('is-player', Boolean(row.isPlayer));
        nodes.li.classList.toggle('is-separated', Boolean(extraPlayer && i === rows.length - 1));
        nodes.li.style.setProperty('--lb-color', row.color);
        nodes.dot.style.background = row.color;
        nodes.dot.style.boxShadow = `0 0 6px ${row.color}`;
        nodes.rank.textContent = `#${row.rank}`;
        nodes.name.textContent = row.name;
        nodes.mass.textContent = formatCompact(row.mass);
      }
    }

    updateHud(force = false) {
      const game = this.game;
      if (!game.player) return;
      const isOver = game.state === 'dying' || game.state === 'gameover';
      const mass = isOver ? game.deathMass : game.playerMass();
      const rank = isOver ? game.deathRank || game.preDeathRank : game.playerRank();
      const kills = game.player.kills;

      this.hudName.textContent = game.player.name;
      this.hudMass.textContent = formatNumber(mass);
      this.hudRank.textContent = rank ? `#${rank}` : '#--';
      this.hudTime.textContent = formatTime(game.time);
      this.hudKills.textContent = formatNumber(kills);
      if (force) this.applyHints();
    }

    tick(dt) {
      if (this.game.state !== 'playing' && this.game.state !== 'paused' && this.game.state !== 'dying') return;
      this.hudAccumulator += dt;
      if (this.hudAccumulator >= 0.12) {
        this.hudAccumulator = 0;
        this.updateHud();
        this.updateLeaderboard();
      }
    }

    handleGameEvent(type, data) {
      if (type === 'rank-one') {
        this.showToast('DU FÜHRST DIE RANGLISTE AN', 'good');
        this.audio.rankOne();
      } else if (type === 'cell-lost' && data && data.remaining > 0) {
        this.showToast(`ZELLE VERLOREN · ${data.remaining} ÜBRIG`, 'warn');
      }
    }

    showResults(results) {
      this.resKicker.textContent = `BATTLE BEENDET // ${results.difficulty}`;
      this.resTitle.textContent = results.rank === 1 ? 'DOMINIERT.' : 'VERSCHLUNGEN.';
      this.resSub.textContent = results.rank === 1
        ? 'Du warst die größte Zelle der Arena. Doch am Ende zählt nur das Überleben.'
        : 'Die Arena hat dich gefressen. Wachse beim nächsten Lauf klüger.';
      this.resTime.textContent = formatTime(results.time);
      this.resMass.textContent = formatNumber(results.mass);
      this.resKills.textContent = formatNumber(results.kills);
      this.resRank.textContent = results.rank ? `#${results.rank}` : '#--';
      this.resBest.textContent = formatNumber(results.bestMass);
      this.resCoins.textContent = formatNumber(results.coins);
      this.resNewBest.classList.toggle('is-visible', Boolean(results.newBest));

      this.setGameActive(true);
      this.showScreen('gameover');
      this.updateMenuStats();
      this.updatePreviews();
      this.input.reset();
      this.renderer.markDirty();
    }

    // -----------------------------------------------------------------------
    // Toast
    // -----------------------------------------------------------------------

    showToast(message, tone = '') {
      if (!this.toast) return;
      if (this.toastTimer) {
        window.clearTimeout(this.toastTimer);
        this.toastTimer = null;
      }
      this.toast.textContent = message;
      this.toast.classList.remove('tone-good', 'tone-warn', 'tone-danger');
      if (tone) this.toast.classList.add(`tone-${tone}`);
      this.toast.classList.add('is-visible');
      this.toastTimer = window.setTimeout(() => {
        this.toast.classList.remove('is-visible');
        this.toastTimer = null;
      }, 2500);
    }

    hideToast() {
      if (this.toastTimer) {
        window.clearTimeout(this.toastTimer);
        this.toastTimer = null;
      }
      this.toast.classList.remove('is-visible');
    }
  }

  // -------------------------------------------------------------------------
  // Boot
  // -------------------------------------------------------------------------

  const boot = () => {
    const appEl = document.getElementById('cw-app');
    const canvas = document.getElementById('cw-canvas');
    const menuCanvas = document.getElementById('cw-menu-bg');
    const minimapCanvas = document.getElementById('cw-minimap-canvas');
    if (!appEl || !canvas || !menuCanvas || !minimapCanvas) return;

    const store = new ProfileStore();
    const audio = new AudioEngine(store.profile);
    let ui = null;
    let input = null;

    const game = new Game(store, audio, {
      onGameStart: () => {},
      onGameOver: (results) => {
        if (ui) ui.showResults(results);
      },
      onEvent: (type, data) => {
        if (ui) ui.handleGameEvent(type, data);
      },
      getKeyboardDir: () => (input ? input.getKeyboardDir() : null)
    });

    const renderer = new Renderer(canvas, minimapCanvas);
    renderer.attach(game);
    const menuScene = new MenuScene(menuCanvas);
    input = new InputController(canvas, game);
    ui = new UIController(store, audio, game, renderer, input);

    // Audio may only start after a user gesture. Both listeners stay active so
    // a suspended AudioContext is resumed after tab switches.
    const unlockAudio = () => audio.unlock();
    window.addEventListener('pointerdown', unlockAudio, { passive: true });
    window.addEventListener('keydown', unlockAudio);

    // A single requestAnimationFrame loop drives both menu and battle.
    let last = performance.now();
    const frame = (now) => {
      const dt = clamp((now - last) / 1000, 0, 0.05);
      last = now;
      const inGame = appEl.classList.contains('cw-game-active');

      if (inGame) {
        game.pointerWorld = game.camera.screenToWorld(input.pointer.x, input.pointer.y);
        if (game.isRunning()) {
          game.update(dt);
          ui.tick(dt);
          renderer.draw(game, now);
        } else if (renderer.dirty) {
          renderer.draw(game, now);
        }
      } else {
        menuScene.update(dt);
        menuScene.draw(now / 1000);
      }

      window.requestAnimationFrame(frame);
    };
    window.requestAnimationFrame((now) => {
      last = now;
      window.requestAnimationFrame(frame);
    });

    window.addEventListener('pagehide', () => {
      if (audio.musicTimer) {
        window.clearInterval(audio.musicTimer);
        audio.musicTimer = null;
      }
    });

    // Test hook, only exposed with ?debug=1. Keeps production surface clean.
    if (new URLSearchParams(window.location.search).has('debug')) {
      window.CellWarsDebug = {
        store,
        audio,
        game,
        renderer,
        menuScene,
        input,
        ui,
        snapshot() {
          return {
            screen: ui.currentScreen,
            game: game.getSnapshot(),
            profile: JSON.parse(JSON.stringify(store.profile))
          };
        },
        addCoins(amount) {
          const value = Math.floor(Number(amount) || 0);
          store.profile.coins = Math.max(0, store.profile.coins + value);
          store.save();
          ui.updateMenuStats();
          ui.renderSkinGrid();
          return store.profile.coins;
        },
        unlockAll() {
          store.profile.owned = SKINS.map((skin) => skin.id);
          store.save();
          ui.updateMenuStats();
          ui.renderSkinGrid();
          ui.updatePreviews();
        },
        setMass(value) {
          const cell = game.player ? game.player.cells[0] : null;
          if (!cell) return null;
          cell.mass = clamp(Number(value) || START_MASS, 1, MAX_CELL_MASS);
          cell.radius = massToRadius(cell.mass);
          return cell.mass;
        },
        killPlayer() {
          if (game.state !== 'playing' || !game.player) return false;
          const cell = game.player.cells[0];
          game.preDeathMass = game.playerMass();
          game.preDeathRank = game.playerRank();
          game.startDeath(cell ? cell.x : game.camera.x, cell ? cell.y : game.camera.y);
          return true;
        },
        spawnPrey(mass = 55) {
          if (game.state !== 'playing' || !game.player || !game.player.cells.length) return null;
          const difficulty = game.configDifficulty;
          const team = game.spawnBot(difficulty, false);
          const prey = team.cells[0];
          const playerCell = game.player.cells[0];
          prey.mass = clamp(Number(mass) || 55, 1, MAX_CELL_MASS);
          prey.radius = massToRadius(prey.mass);
          prey.x = clamp(playerCell.x + playerCell.radius + prey.radius + 6, prey.radius, ARENA_SIZE - prey.radius);
          prey.y = playerCell.y;
          team.brain.thinkTimer = 60;
          return { team: team.name, mass: prey.mass, x: prey.x, y: prey.y };
        }
      };
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
