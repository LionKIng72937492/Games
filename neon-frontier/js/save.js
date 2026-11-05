/* ==========================================================================
   NEON FRONTIER — persistence
   Versioned profile + run snapshot storage. Invalid or old data is normalized
   instead of crashing the game. A memory fallback keeps the game playable if
   localStorage is unavailable (private mode / file restrictions).
   ========================================================================== */

(() => {
  'use strict';

  const NF = window.NF = window.NF || {};

  const PROFILE_KEY = 'neon-frontier-profile-v1';
  const RUN_KEY = 'neon-frontier-run-v1';
  const SAVE_VERSION = 1;

  const memoryStore = new Map();

  function readRaw(key) {
    try {
      const value = window.localStorage.getItem(key);
      if (value !== null) return value;
    } catch (error) {
      // localStorage may be blocked; use the in-memory fallback below.
    }
    return memoryStore.has(key) ? memoryStore.get(key) : null;
  }

  function writeRaw(key, value) {
    memoryStore.set(key, value);
    try {
      window.localStorage.setItem(key, value);
    } catch (error) {
      // Keep the memory copy; the session still works.
    }
  }

  function removeRaw(key) {
    memoryStore.delete(key);
    try {
      window.localStorage.removeItem(key);
    } catch (error) {
      // Ignore storage removal failures.
    }
  }

  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function mergeDefaults(target, defaults) {
    if (Array.isArray(defaults)) return Array.isArray(target) ? target : NF.deepClone(defaults);
    if (isObject(defaults)) {
      const result = isObject(target) ? { ...target } : {};
      for (const [key, defaultValue] of Object.entries(defaults)) {
        result[key] = mergeDefaults(result[key], defaultValue);
      }
      return result;
    }
    return target === undefined || target === null ? defaults : target;
  }

  class SaveManager {
    constructor() {
      this.lastError = null;
      this.profile = this.loadProfile();
    }

    loadProfile() {
      const fallback = NF.createDefaultProfile();
      const raw = readRaw(PROFILE_KEY);
      if (!raw) return fallback;

      try {
        const parsed = JSON.parse(raw);
        if (!isObject(parsed)) throw new Error('Profil ist kein Objekt.');
        const merged = mergeDefaults(parsed, fallback);
        merged.version = SAVE_VERSION;

        // Sanitize numeric values that could break progression/UI.
        merged.level = NF.clamp(Math.floor(Number(merged.level) || 1), 1, 30);
        merged.xp = Math.max(0, Number(merged.xp) || 0);
        merged.doctrinePoints = Math.max(0, Math.floor(Number(merged.doctrinePoints) || 0));
        merged.research = Math.max(0, Math.floor(Number(merged.research) || 0));
        merged.settings.music = NF.clamp(Number(merged.settings.music) || 0, 0, 1);
        merged.settings.sfx = NF.clamp(Number(merged.settings.sfx) || 0, 0, 1);
        merged.settings.speed = [1, 2, 3].includes(Number(merged.settings.speed)) ? Number(merged.settings.speed) : 1;
        merged.settings.autoStart = Boolean(merged.settings.autoStart);
        merged.settings.particles = merged.settings.particles !== false;
        merged.settings.shake = merged.settings.shake !== false;
        merged.settings.damageNumbers = merged.settings.damageNumbers !== false;

        for (const key of ['games', 'wins', 'losses', 'bestWave', 'totalKills', 'bossKills', 'highScore']) {
          merged.stats[key] = Math.max(0, Math.floor(Number(merged.stats[key]) || 0));
        }
        merged.stats.totalPlayTime = Math.max(0, Number(merged.stats.totalPlayTime) || 0);

        if (!NF.DIFFICULTIES[merged.selectedDifficulty]) merged.selectedDifficulty = 'normal';
        if (!NF.getMap(merged.selectedMap)) merged.selectedMap = 'neon-city';
        if (!NF.SKINS.some((skin) => skin.id === merged.selectedSkin)) merged.selectedSkin = 'standard';

        // Remove unknown doctrine/tech keys so old or manipulated saves are safe.
        const doctrine = {};
        for (const upgrade of NF.DOCTRINE_UPGRADES) {
          doctrine[upgrade.id] = NF.clamp(Math.floor(Number(merged.doctrine[upgrade.id]) || 0), 0, upgrade.max);
        }
        merged.doctrine = doctrine;

        const tech = {};
        for (const id of Object.keys(NF.TECH_NODE_MAP)) {
          if (merged.tech[id]) tech[id] = true;
        }
        merged.tech = tech;

        const achievements = {};
        for (const achievement of NF.ACHIEVEMENTS) {
          if (merged.achievements[achievement.id]) achievements[achievement.id] = true;
        }
        merged.achievements = achievements;

        const towerUses = {};
        for (const id of NF.TOWER_ORDER) {
          towerUses[id] = Math.max(0, Math.floor(Number(merged.stats.towerUses[id]) || 0));
        }
        merged.stats.towerUses = towerUses;

        return merged;
      } catch (error) {
        this.lastError = error;
        console.warn('NEON FRONTIER: beschädigter Spielstand wird zurückgesetzt.', error);
        return fallback;
      }
    }

    saveProfile(profile = this.profile) {
      if (!profile) return;
      this.profile = profile;
      profile.version = SAVE_VERSION;
      profile.updatedAt = Date.now();
      writeRaw(PROFILE_KEY, JSON.stringify(profile));
    }

    resetProfile() {
      removeRaw(PROFILE_KEY);
      removeRaw(RUN_KEY);
      this.profile = NF.createDefaultProfile();
      this.saveProfile(this.profile);
      return this.profile;
    }

    loadRun() {
      const raw = readRaw(RUN_KEY);
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw);
        if (!isObject(parsed) || parsed.version !== SAVE_VERSION) return null;
        if (!NF.getMap(parsed.mapId) || !NF.DIFFICULTIES[parsed.difficulty]) return null;
        if (!Number.isFinite(parsed.wave) || parsed.wave < 1) return null;
        return parsed;
      } catch (error) {
        this.lastError = error;
        return null;
      }
    }

    saveRun(snapshot) {
      if (!snapshot) return;
      writeRaw(RUN_KEY, JSON.stringify({ ...snapshot, version: SAVE_VERSION, savedAt: Date.now() }));
    }

    clearRun() {
      removeRaw(RUN_KEY);
    }

    hasRun() {
      return Boolean(this.loadRun());
    }

    // Used by settings reset and debug tooling.
    exportProfile() {
      return JSON.stringify(this.profile, null, 2);
    }
  }

  NF.SaveManager = SaveManager;
})();
