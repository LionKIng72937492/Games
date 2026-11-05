/* ==========================================================================
   NEON FRONTIER — procedural audio engine
   Web Audio only: no external samples, no downloads. The engine stays silent
   until the browser unlocks audio after a user gesture.
   ========================================================================== */

(() => {
  'use strict';

  const NF = window.NF = window.NF || {};

  class AudioEngine {
    constructor(settings = {}) {
      this.ctx = null;
      this.master = null;
      this.musicGain = null;
      this.sfxGain = null;
      this.noiseBuffer = null;
      this.musicTimer = null;
      this.musicMode = 'menu';
      this.musicStep = 0;
      this.unlocked = false;
      this.muted = false;
      this.musicVolume = Number.isFinite(settings.music) ? settings.music : 0.3;
      this.sfxVolume = Number.isFinite(settings.sfx) ? settings.sfx : 0.7;
      this.lastPlay = Object.create(null);
      this._musicBus = null;
    }

    unlock() {
      if (this.unlocked) return;
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      try {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 1;
        this.master.connect(this.ctx.destination);

        this.musicGain = this.ctx.createGain();
        this.musicGain.gain.value = this.musicVolume;
        this.musicGain.connect(this.master);

        this.sfxGain = this.ctx.createGain();
        this.sfxGain.gain.value = this.sfxVolume;
        this.sfxGain.connect(this.master);

        this.noiseBuffer = this._createNoiseBuffer(1.2);
        this.unlocked = true;
        if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      } catch (error) {
        console.warn('NEON FRONTIER audio could not start:', error);
      }
    }

    setVolumes({ music, sfx }) {
      if (Number.isFinite(music)) {
        this.musicVolume = NF.clamp(music, 0, 1);
        if (this.musicGain) this.musicGain.gain.setTargetAtTime(this.musicVolume, this.ctx.currentTime, 0.05);
      }
      if (Number.isFinite(sfx)) {
        this.sfxVolume = NF.clamp(sfx, 0, 1);
        if (this.sfxGain) this.sfxGain.gain.setTargetAtTime(this.sfxVolume, this.ctx.currentTime, 0.03);
      }
    }

    setMuted(muted) {
      this.muted = Boolean(muted);
      if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 1, this.ctx.currentTime, 0.05);
    }

    _createNoiseBuffer(seconds) {
      const length = Math.max(1, Math.floor(this.ctx.sampleRate * seconds));
      const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
      return buffer;
    }

    _envelope(node, start, attack, hold, release, peak = 0.25) {
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(peak, start + attack);
      gain.gain.setValueAtTime(peak, start + attack + hold);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + attack + hold + release);
      node.connect(gain);
      return gain;
    }

    _tone({ freq = 440, endFreq = null, type = 'sine', duration = 0.16, volume = 0.18, attack = 0.005, bus = 'sfx', delay = 0 }) {
      if (!this.ctx || !this.unlocked) return;
      const now = this.ctx.currentTime + delay;
      const osc = this.ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(Math.max(20, freq), now);
      if (endFreq !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), now + duration);
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(volume, now + attack);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      osc.connect(gain);
      gain.connect(bus === 'music' ? this.musicGain : this.sfxGain);
      osc.start(now);
      osc.stop(now + duration + 0.03);
    }

    _noise({ duration = 0.2, volume = 0.16, filter = 'lowpass', frequency = 900, delay = 0 }) {
      if (!this.ctx || !this.noiseBuffer || !this.unlocked) return;
      const now = this.ctx.currentTime + delay;
      const source = this.ctx.createBufferSource();
      source.buffer = this.noiseBuffer;
      const filterNode = this.ctx.createBiquadFilter();
      filterNode.type = filter;
      filterNode.frequency.setValueAtTime(frequency, now);
      filterNode.frequency.exponentialRampToValueAtTime(Math.max(80, frequency * 0.25), now + duration);
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(volume, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      source.connect(filterNode);
      filterNode.connect(gain);
      gain.connect(this.sfxGain);
      source.start(now);
      source.stop(now + duration + 0.03);
    }

    play(name) {
      if (!this.ctx || !this.unlocked) return;
      const now = NF.now();
      // Prevent machine-gun audio spam from many simultaneous hits.
      const throttle = this.lastPlay[name] || 0;
      if (now - throttle < 42) return;
      this.lastPlay[name] = now;

      switch (name) {
        case 'click':
          this._tone({ freq: 620, endFreq: 840, type: 'square', duration: 0.045, volume: 0.06 });
          break;
        case 'hover':
          this._tone({ freq: 320, endFreq: 380, type: 'sine', duration: 0.03, volume: 0.025 });
          break;
        case 'laser':
          this._tone({ freq: 1450, endFreq: 420, type: 'sawtooth', duration: 0.09, volume: 0.08 });
          this._tone({ freq: 800, endFreq: 260, type: 'square', duration: 0.07, volume: 0.035, delay: 0.01 });
          break;
        case 'cryo':
          this._tone({ freq: 1100, endFreq: 620, type: 'sine', duration: 0.18, volume: 0.07 });
          this._noise({ duration: 0.13, volume: 0.045, filter: 'highpass', frequency: 2200 });
          break;
        case 'plasma':
          this._tone({ freq: 210, endFreq: 70, type: 'sawtooth', duration: 0.22, volume: 0.11 });
          this._noise({ duration: 0.16, volume: 0.06, filter: 'lowpass', frequency: 1100 });
          break;
        case 'missile':
          this._noise({ duration: 0.28, volume: 0.09, filter: 'bandpass', frequency: 900 });
          this._tone({ freq: 320, endFreq: 880, type: 'triangle', duration: 0.18, volume: 0.04 });
          break;
        case 'arc':
          this._tone({ freq: 1700, endFreq: 380, type: 'square', duration: 0.1, volume: 0.055 });
          this._tone({ freq: 2400, endFreq: 700, type: 'sawtooth', duration: 0.07, volume: 0.035, delay: 0.02 });
          break;
        case 'hit':
          this._noise({ duration: 0.045, volume: 0.035, filter: 'highpass', frequency: 1800 });
          break;
        case 'explosion':
          this._noise({ duration: 0.48, volume: 0.2, filter: 'lowpass', frequency: 750 });
          this._tone({ freq: 95, endFreq: 34, type: 'sine', duration: 0.45, volume: 0.16 });
          break;
        case 'death':
          this._tone({ freq: 420, endFreq: 80, type: 'sawtooth', duration: 0.22, volume: 0.06 });
          break;
        case 'bossDeath':
          this._noise({ duration: 1.2, volume: 0.28, filter: 'lowpass', frequency: 620 });
          this._tone({ freq: 110, endFreq: 26, type: 'sawtooth', duration: 1.1, volume: 0.2 });
          this._tone({ freq: 420, endFreq: 55, type: 'square', duration: 0.9, volume: 0.08, delay: 0.1 });
          break;
        case 'upgrade':
          this._tone({ freq: 440, endFreq: 660, type: 'triangle', duration: 0.1, volume: 0.08 });
          this._tone({ freq: 660, endFreq: 990, type: 'triangle', duration: 0.14, volume: 0.07, delay: 0.08 });
          break;
        case 'build':
          this._tone({ freq: 160, endFreq: 520, type: 'square', duration: 0.16, volume: 0.08 });
          break;
        case 'sell':
          this._tone({ freq: 660, endFreq: 220, type: 'triangle', duration: 0.18, volume: 0.07 });
          break;
        case 'error':
          this._tone({ freq: 150, endFreq: 90, type: 'square', duration: 0.16, volume: 0.08 });
          break;
        case 'waveStart':
          this._tone({ freq: 220, endFreq: 660, type: 'sawtooth', duration: 0.4, volume: 0.08 });
          this._tone({ freq: 440, endFreq: 880, type: 'triangle', duration: 0.35, volume: 0.05, delay: 0.12 });
          break;
        case 'waveClear':
          this._tone({ freq: 523, endFreq: 784, type: 'triangle', duration: 0.2, volume: 0.08 });
          this._tone({ freq: 784, endFreq: 1046, type: 'triangle', duration: 0.28, volume: 0.07, delay: 0.16 });
          break;
        case 'bossWarn':
          this._tone({ freq: 180, endFreq: 180, type: 'sawtooth', duration: 0.28, volume: 0.12 });
          this._tone({ freq: 240, endFreq: 240, type: 'sawtooth', duration: 0.28, volume: 0.1, delay: 0.35 });
          this._tone({ freq: 180, endFreq: 120, type: 'sawtooth', duration: 0.4, volume: 0.1, delay: 0.7 });
          break;
        case 'ability':
          this._tone({ freq: 280, endFreq: 1200, type: 'sawtooth', duration: 0.35, volume: 0.1 });
          this._noise({ duration: 0.3, volume: 0.05, filter: 'bandpass', frequency: 1600 });
          break;
        case 'orbital':
          this._tone({ freq: 900, endFreq: 80, type: 'sawtooth', duration: 0.75, volume: 0.14 });
          this._noise({ duration: 0.7, volume: 0.12, filter: 'lowpass', frequency: 1400 });
          break;
        case 'emp':
          this._tone({ freq: 90, endFreq: 480, type: 'square', duration: 0.5, volume: 0.1 });
          this._tone({ freq: 1800, endFreq: 240, type: 'sawtooth', duration: 0.45, volume: 0.05, delay: 0.05 });
          break;
        case 'repair':
          this._tone({ freq: 320, endFreq: 640, type: 'sine', duration: 0.28, volume: 0.07 });
          this._tone({ freq: 480, endFreq: 960, type: 'sine', duration: 0.28, volume: 0.05, delay: 0.12 });
          break;
        case 'overcharge':
          this._tone({ freq: 220, endFreq: 880, type: 'sawtooth', duration: 0.42, volume: 0.1 });
          this._tone({ freq: 440, endFreq: 1320, type: 'triangle', duration: 0.42, volume: 0.06, delay: 0.08 });
          break;
        case 'leak':
          this._tone({ freq: 120, endFreq: 45, type: 'square', duration: 0.4, volume: 0.13 });
          this._noise({ duration: 0.3, volume: 0.08, filter: 'lowpass', frequency: 500 });
          break;
        case 'gameover':
          this._tone({ freq: 330, endFreq: 55, type: 'sawtooth', duration: 1.3, volume: 0.12 });
          this._noise({ duration: 1.0, volume: 0.08, filter: 'lowpass', frequency: 500 });
          break;
        case 'victory':
          [523, 659, 784, 1046, 1318].forEach((freq, index) => {
            this._tone({ freq, type: 'triangle', duration: 0.4, volume: 0.08, delay: index * 0.14 });
          });
          break;
        case 'achievement':
          this._tone({ freq: 880, endFreq: 1320, type: 'triangle', duration: 0.18, volume: 0.08 });
          this._tone({ freq: 1320, endFreq: 1760, type: 'triangle', duration: 0.22, volume: 0.06, delay: 0.12 });
          break;
        default:
          break;
      }
    }

    startMusic(mode = 'menu') {
      this.musicMode = mode;
      if (!this.ctx || !this.unlocked) return;
      if (this.musicTimer) return;
      this.musicStep = 0;
      const tick = () => {
        if (!this.ctx || !this.unlocked || this.muted) return;
        this._musicTick();
      };
      tick();
      this.musicTimer = window.setInterval(tick, 420);
    }

    stopMusic() {
      if (this.musicTimer) {
        window.clearInterval(this.musicTimer);
        this.musicTimer = null;
      }
    }

    setMusicMode(mode) {
      if (this.musicMode === mode) return;
      this.musicMode = mode;
      this.musicStep = 0;
    }

    _musicTick() {
      if (!this.musicGain) return;
      const step = this.musicStep;
      this.musicStep = (this.musicStep + 1) % 32;
      const boss = this.musicMode === 'boss';
      const battle = this.musicMode === 'battle';
      const root = boss ? 55 : battle ? 65 : 49;
      const scale = boss ? [0, 1, 3, 6, 8, 10] : [0, 3, 5, 7, 10, 12];
      const note = scale[step % scale.length];
      const freq = root * Math.pow(2, note / 12);

      // Sparse sub-bass pulse.
      if (step % 4 === 0) {
        this._tone({
          freq: root,
          endFreq: root * 0.98,
          type: 'sine',
          duration: 0.5,
          volume: 0.055,
          bus: 'music'
        });
      }

      // Cold arpeggio, quieter on menu.
      if (step % 2 === 0 || (battle && step % 3 === 0) || (boss && step % 1 === 0)) {
        this._tone({
          freq: freq * 4,
          endFreq: freq * 4 * 0.99,
          type: boss ? 'sawtooth' : 'triangle',
          duration: boss ? 0.18 : 0.28,
          volume: boss ? 0.018 : battle ? 0.022 : 0.014,
          bus: 'music'
        });
      }

      // Boss warning motif.
      if (boss && step % 8 === 0) {
        this._tone({
          freq: 120,
          endFreq: 90,
          type: 'square',
          duration: 0.3,
          volume: 0.025,
          bus: 'music'
        });
      }
    }
  }

  NF.AudioEngine = AudioEngine;
})();
