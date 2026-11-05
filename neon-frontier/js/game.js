/* ==========================================================================
   NEON FRONTIER — game engine
   Owns the run state, economy, wave manager, combat resolution, boss logic,
   abilities, technology effects, achievements and run snapshots.
   ========================================================================== */

(() => {
  'use strict';

  const NF = window.NF = window.NF || {};
  const TAU = Math.PI * 2;

  class Game {
    constructor({ save, audio, profile }) {
      this.save = save;
      this.audio = audio;
      this.profile = profile;
      this.onEvent = null;

      this.state = 'menu';
      this.map = NF.MAPS[0];
      this.difficulty = NF.DIFFICULTIES.normal;
      this.wave = 1;
      this.wavePlan = null;
      this.waveActive = false;
      this.waveCountdown = 0;
      this.waveElapsed = 0;
      this.spawnQueue = [];
      this.spawnTimer = 0;
      this.totalInWave = 0;
      this.spawnedInWave = 0;
      this.resolvedInWave = 0;
      this.killedInWave = 0;
      this.waveCoreDamage = 0;
      this.boss = null;

      this.credits = 0;
      this.energy = 100;
      this.energyMax = 100;
      this.coreHp = 120;
      this.coreMax = 120;
      this.coreShield = 0;
      this.score = 0;
      this.kills = 0;
      this.bossesKilled = 0;
      this.runTime = 0;
      this.runXp = 0;
      this.researchEarned = 0;
      this.towersBuilt = 0;
      this.towerUses = { pulse: 0, cryo: 0, plasma: 0, hunter: 0, arc: 0 };
      this.towers = [];
      this.enemies = [];
      this.projectiles = [];
      this.particles = [];
      this.effects = [];
      this.floatingTexts = [];
      this.orbitalStrikes = [];
      this.pads = [];
      this.selectedTower = null;
      this.selectedTowerType = null;
      this.pendingAbility = null;
      this.hoverWorld = { x: NF.WORLD.width / 2, y: NF.WORLD.height / 2 };
      this.speed = 1;
      this.overchargeTimer = 0;
      this.abilityCooldowns = {};
      this.shake = 0;
      this.flash = 0;
      this.saveTimer = 0;
      this.autoStart = false;
      this.result = null;
      this.lastWaveCompleted = 0;
      this.mods = {};
      this.recalculateMods();
    }

    get isPaused() {
      return this.state === 'paused';
    }

    get coreRatio() {
      return NF.clamp(this.coreHp / Math.max(1, this.coreMax), 0, 1);
    }

    get coreStatus() {
      if (this.coreRatio > 0.6) return 'STABIL';
      if (this.coreRatio > 0.3) return 'BESCHÄDIGT';
      return 'KRITISCH';
    }

    get bossEnemy() {
      return this.enemies.find((enemy) => enemy.isBoss && !enemy.dead && !enemy.leaked) || null;
    }

    get enemyCount() {
      return this.enemies.filter((enemy) => !enemy.dead && !enemy.leaked).length + this.spawnQueue.length;
    }

    get waveProgress() {
      return this.totalInWave > 0 ? NF.clamp(this.resolvedInWave / this.totalInWave, 0, 1) : 0;
    }

    get selectedTowerStats() {
      return this.selectedTower ? this.getTowerStats(this.selectedTower) : null;
    }

    emit(type, payload = {}) {
      if (typeof this.onEvent === 'function') this.onEvent(type, payload);
    }

    recalculateMods() {
      const tech = NF.getTechEffects(this.profile.tech);
      const doctrine = NF.getDoctrineEffects(this.profile.doctrine);
      this.mods = {
        damage: 1 + (tech.damage || 0) + (doctrine.damage || 0),
        fireRate: 1 + (tech.fireRate || 0),
        crit: tech.crit || 0,
        credits: 1 + (tech.credits || 0),
        upgradeDiscount: NF.clamp(tech.upgradeDiscount || 0, 0, 0.6),
        sellBonus: (tech.sellBonus || 0) + (doctrine.sellBonus || 0),
        startCredits: (tech.startCredits || 0) + (doctrine.startCredits || 0),
        coreMax: (tech.coreMax || 0) + (doctrine.coreMax || 0),
        coreRegen: tech.coreRegen || 0,
        coreArmor: tech.coreArmor || 0,
        coreShield: tech.coreShield || 0,
        energyRegen: 3.2 + (tech.energyRegen || 0) + (doctrine.energyRegen || 0),
        abilityPower: 1 + (tech.abilityPower || 0),
        cooldownReduction: NF.clamp(tech.cooldownReduction || 0, 0, 0.6),
        overchargeBoost: tech.overchargeBoost || 0,
        bossDamage: tech.bossDamage || 0
      };
    }

    getStartCredits() {
      return Math.round(this.difficulty.startCredits + this.mods.startCredits);
    }

    getCoreMax() {
      return Math.round(this.difficulty.coreHP + this.mods.coreMax);
    }

    getUpgradeCost(tower) {
      return Math.max(1, Math.round(NF.getUpgradeCost(tower.def, tower.level) * (1 - this.mods.upgradeDiscount)));
    }

    getSpecCost(tower) {
      return Math.max(1, Math.round(NF.getSpecCost(tower.def) * (1 - this.mods.upgradeDiscount)));
    }

    getSellValue(tower) {
      return NF.getSellValue(tower, this.mods.sellBonus);
    }

    getAbilityCooldown(ability) {
      return Math.max(3, ability.cooldown * (1 - this.mods.cooldownReduction));
    }

    getAbilityState(abilityId) {
      const def = NF.ABILITY_MAP[abilityId];
      if (!def) return null;
      const cooldown = this.abilityCooldowns[abilityId] || 0;
      return {
        def,
        cooldown,
        maxCooldown: this.getAbilityCooldown(def),
        affordable: this.energy >= def.cost,
        ready: cooldown <= 0 && this.energy >= def.cost
      };
    }

    getTowerStats(tower, overrideLevel = null) {
      const def = tower.def;
      const base = def.base;
      const level = NF.clamp(Math.round(overrideLevel || tower.level), 1, 5);
      const lm = def.level;
      const stats = {
        ...base,
        damage: base.damage * (1 + (level - 1) * lm.damage),
        fireRate: base.fireRate * (1 + (level - 1) * lm.fireRate),
        range: base.range * (1 + (level - 1) * lm.range),
        splash: base.splash * (1 + (level - 1) * lm.splash),
        crit: base.crit + (level - 1) * lm.crit,
        critMult: base.critMult,
        bossBonus: base.bossBonus + this.mods.bossDamage
      };

      // Arc towers gain an extra chain at levels 3 and 5.
      if (stats.chains > 0) stats.chains += Math.floor((level - 1) / 2);

      stats.damage *= this.mods.damage;
      stats.fireRate *= this.mods.fireRate;
      stats.crit += this.mods.crit;

      if (tower.spec) {
        const spec = def.specs[tower.spec];
        if (spec) {
          for (const [key, multiplier] of Object.entries(spec.mult || {})) {
            if (key in stats) stats[key] *= multiplier;
          }
          for (const [key, addition] of Object.entries(spec.add || {})) {
            if (key in stats) stats[key] += addition;
          }
        }
      }

      if (this.overchargeTimer > 0) {
        stats.fireRate *= 1 + 0.8 + this.mods.overchargeBoost;
      }

      stats.fireRate = Math.max(0.08, stats.fireRate);
      stats.crit = NF.clamp(stats.crit, 0, 0.8);
      stats.chains = Math.max(0, Math.round(stats.chains));
      stats.missiles = Math.max(0, Math.round(stats.missiles));
      stats.dps = stats.damage * stats.fireRate;
      stats.color = def.color;
      stats.color2 = def.color2;
      return stats;
    }

    // -----------------------------------------------------------------------
    // Run lifecycle
    // -----------------------------------------------------------------------

    startRun(mapId, difficultyId, snapshot = null) {
      this.map = NF.getMap(mapId);
      this.difficulty = NF.DIFFICULTIES[difficultyId] || NF.DIFFICULTIES.normal;
      this.recalculateMods();

      this.wave = snapshot ? Math.max(1, Math.floor(snapshot.wave || 1)) : 1;
      this.wavePlan = null;
      this.waveActive = false;
      this.waveCountdown = snapshot ? 8 : 10;
      this.waveElapsed = 0;
      this.spawnQueue = [];
      this.spawnTimer = 0;
      this.totalInWave = 0;
      this.spawnedInWave = 0;
      this.resolvedInWave = 0;
      this.killedInWave = 0;
      this.waveCoreDamage = 0;
      this.boss = null;
      this.lastWaveCompleted = 0;

      this.credits = snapshot ? Math.max(0, snapshot.credits) : this.getStartCredits();
      this.coreMax = snapshot ? Math.max(1, snapshot.coreMax) : this.getCoreMax();
      this.coreHp = snapshot ? NF.clamp(snapshot.coreHp, 0, this.coreMax) : this.coreMax;
      this.coreShield = snapshot ? Math.max(0, snapshot.coreShield || 0) : 0;
      this.energy = snapshot ? NF.clamp(snapshot.energy, 0, this.energyMax) : this.energyMax;
      this.runTime = snapshot ? Math.max(0, snapshot.time || 0) : 0;
      this.kills = snapshot ? Math.max(0, snapshot.kills || 0) : 0;
      this.bossesKilled = snapshot ? Math.max(0, snapshot.bossesKilled || 0) : 0;
      this.runXp = snapshot ? Math.max(0, snapshot.runXp || 0) : 0;
      this.researchEarned = snapshot ? Math.max(0, snapshot.researchEarned || 0) : 0;
      this.towersBuilt = snapshot ? Math.max(0, snapshot.towersBuilt || 0) : 0;
      this.towerUses = { pulse: 0, cryo: 0, plasma: 0, hunter: 0, arc: 0, ...(snapshot ? snapshot.towerUses : {}) };
      this.overchargeTimer = snapshot ? Math.max(0, snapshot.overchargeTimer || 0) : 0;
      this.abilityCooldowns = snapshot ? { ...snapshot.abilityCooldowns } : {};
      this.score = snapshot ? Math.max(0, snapshot.score || 0) : 0;
      this.shake = 0;
      this.flash = 0;
      this.saveTimer = 0;
      this.result = null;
      this.selectedTower = null;
      this.selectedTowerType = null;
      this.pendingAbility = null;
      this.orbitalStrikes = [];
      this.towers = [];
      this.enemies = [];
      this.projectiles = [];
      this.particles = [];
      this.effects = [];
      this.floatingTexts = [];
      this.pads = (this.map.pads || []).map((pad, index) => ({ ...pad, index, tower: null }));
      this.autoStart = Boolean(this.profile.settings.autoStart);
      this.speed = [1, 2, 3].includes(this.profile.settings.speed) ? this.profile.settings.speed : 1;

      if (snapshot && Array.isArray(snapshot.towers)) {
        for (const saved of snapshot.towers) {
          if (!saved || !NF.TOWER_DEFS[saved.type]) continue;

          // New snapshots store free x/y coordinates. Older snapshots only
          // contain a padIndex, so keep that path as a migration fallback.
          const pad = Number.isInteger(saved.padIndex) ? this.pads[saved.padIndex] : null;
          const savedX = Number(saved.x);
          const savedY = Number(saved.y);
          const hasPosition = Number.isFinite(savedX) && Number.isFinite(savedY);
          const x = hasPosition ? savedX : pad ? pad.x : NaN;
          const y = hasPosition ? savedY : pad ? pad.y : NaN;
          if (!Number.isFinite(x) || !Number.isFinite(y) || this.getTowerAt(x, y)) continue;

          const tower = new NF.Tower(this, saved.type, x, y, pad ? pad.index : null);
          tower.level = NF.clamp(saved.level || 1, 1, 5);
          tower.spec = saved.spec && NF.TOWER_DEFS[saved.type].specs[saved.spec] ? saved.spec : null;
          tower.targeting = ['first', 'last', 'strongest', 'fastest'].includes(saved.targeting) ? saved.targeting : 'first';
          tower.invested = Math.max(tower.def.cost, saved.invested || tower.def.cost);
          tower.kills = Math.max(0, saved.kills || 0);
          tower.damageDealt = Math.max(0, saved.damageDealt || 0);
          tower.shots = Math.max(0, saved.shots || 0);
          this.towers.push(tower);
          if (pad) pad.tower = tower;
        }
      }

      this.profile.selectedMap = this.map.id;
      this.profile.selectedDifficulty = this.difficulty.id;
      this.save.saveProfile(this.profile);
      this.state = 'playing';
      this.audio.setMusicMode('battle');
      this.audio.startMusic('battle');
      this.emit('statechange', 'playing');
      this.emit('runStart', { map: this.map, difficulty: this.difficulty, resumed: Boolean(snapshot) });
      this.saveRunSnapshot();
    }

    resumeRun(snapshot) {
      if (!snapshot) return false;
      this.startRun(snapshot.mapId, snapshot.difficulty, snapshot);
      this.emit('toast', { text: 'LAUF WIEDERHERGESTELLT', tone: 'green' });
      return true;
    }

    pause() {
      if (this.state !== 'playing') return;
      this.state = 'paused';
      this.saveRunSnapshot();
      this.emit('statechange', 'paused');
    }

    resume() {
      if (this.state !== 'paused') return;
      this.state = 'playing';
      this.emit('statechange', 'playing');
    }

    togglePause() {
      if (this.state === 'playing') this.pause();
      else if (this.state === 'paused') this.resume();
    }

    setSpeed(speed) {
      this.speed = [1, 2, 3].includes(Number(speed)) ? Number(speed) : 1;
      this.profile.settings.speed = this.speed;
      this.save.saveProfile(this.profile);
      this.emit('speedchange', this.speed);
    }

    abandonRun() {
      if (!['playing', 'paused'].includes(this.state)) return;
      this.endRun(false, true);
    }

    endRun(victory, abandoned = false) {
      if (!['playing', 'paused'].includes(this.state)) return;
      const completedWave = this.lastWaveCompleted || Math.max(0, this.wave - (this.waveActive ? 1 : 0));
      this.score = this.calculateScore();
      this.state = victory ? 'victory' : 'gameover';
      this.pendingAbility = null;
      this.selectedTowerType = null;
      this.checkAchievements();

      const stats = this.profile.stats;
      stats.games += 1;
      if (victory) stats.wins += 1;
      else stats.losses += 1;
      stats.bestWave = Math.max(stats.bestWave, completedWave);
      stats.totalKills += this.kills;
      stats.bossKills += this.bossesKilled;
      stats.totalPlayTime += this.runTime;
      stats.highScore = Math.max(stats.highScore, this.score);
      for (const id of NF.TOWER_ORDER) {
        stats.towerUses[id] = (stats.towerUses[id] || 0) + (this.towerUses[id] || 0);
      }
      stats.favoriteTower = NF.TOWER_ORDER.reduce((best, id) => (
        (stats.towerUses[id] || 0) > (stats.towerUses[best] || 0) ? id : best
      ), 'pulse');
      const bestDifficultyRank = NF.DIFFICULTY_ORDER.findIndex((id) => NF.DIFFICULTIES[id].label === stats.bestDifficulty);
      const runDifficultyRank = NF.DIFFICULTY_ORDER.indexOf(this.difficulty.id);
      if (runDifficultyRank > bestDifficultyRank) {
        stats.bestDifficulty = this.difficulty.label;
      }

      const xpEarned = Math.round(this.runXp + completedWave * 8 * this.difficulty.xp + (victory ? 260 : 0));
      const researchBonus = victory ? 20 : 0;
      if (researchBonus > 0) {
        this.profile.research += researchBonus;
        this.researchEarned += researchBonus;
      }
      this.profile.xp += xpEarned;
      const levelUps = NF.applyLevelUps(this.profile);

      this.profile.lastRun = {
        mapId: this.map.id,
        mapName: this.map.name,
        difficulty: this.difficulty.id,
        difficultyName: this.difficulty.name,
        wave: completedWave,
        score: this.score,
        victory,
        date: Date.now()
      };
      this.save.saveProfile(this.profile);
      this.save.clearRun();
      this.audio.setMusicMode('menu');
      this.audio.play(victory ? 'victory' : 'gameover');

      this.result = {
        victory,
        abandoned,
        map: this.map,
        difficulty: this.difficulty,
        wave: completedWave,
        score: this.score,
        kills: this.kills,
        bossesKilled: this.bossesKilled,
        xpEarned,
        researchEarned: this.researchEarned,
        levelUps,
        time: this.runTime,
        coreHp: this.coreHp,
        coreMax: this.coreMax
      };
      this.emit('runEnd', this.result);
      this.emit('statechange', this.state);
    }

    // -----------------------------------------------------------------------
    // Build / selection
    // -----------------------------------------------------------------------

    selectTowerType(typeId) {
      if (!NF.TOWER_DEFS[typeId]) return;
      this.pendingAbility = null;
      this.selectedTower = null;
      this.selectedTowerType = this.selectedTowerType === typeId ? null : typeId;
      this.emit('selectionchange');
    }

    selectTower(tower) {
      this.selectedTower = tower || null;
      this.selectedTowerType = null;
      this.pendingAbility = null;
      this.emit('selectionchange');
    }

    selectTowerAt(x, y) {
      const tower = this.getTowerAt(x, y);
      if (tower) {
        this.selectTower(tower);
        return tower;
      }
      return null;
    }

    getTowerAt(x, y) {
      return this.towers.find((tower) => NF.dist2(x, y, tower.x, tower.y) <= 30 * 30) || null;
    }

    setHoverWorld(x, y) {
      this.hoverWorld.x = x;
      this.hoverWorld.y = y;
    }

    getPathDistance(x, y) {
      let nearest = Infinity;
      for (const segment of this.map.segments) {
        const distance = NF.pointToSegmentDistance(
          x, y,
          segment.a.x, segment.a.y,
          segment.b.x, segment.b.y
        );
        if (distance < nearest) nearest = distance;
      }
      return nearest;
    }

    getPlacementCheck(x, y, typeId = this.selectedTowerType) {
      const def = NF.TOWER_DEFS[typeId];
      if (!def) return { ok: false, reason: 'Kein Turm ausgewählt.' };
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return { ok: false, reason: 'Ungültige Position.' };
      }

      const margin = NF.BUILD.margin;
      if (x < margin || x > NF.WORLD.width - margin || y < margin || y > NF.WORLD.height - margin) {
        return { ok: false, reason: 'Außerhalb der Baufläche.' };
      }

      const coreDistance = NF.dist(x, y, this.map.core.x, this.map.core.y);
      if (coreDistance < NF.BUILD.coreClearance) {
        return { ok: false, reason: 'Zu nah am Energiekern.' };
      }

      const pathDistance = this.getPathDistance(x, y);
      if (pathDistance < NF.BUILD.pathClearance) {
        return { ok: false, reason: 'Nicht auf dem Gegnerweg bauen.' };
      }

      for (const tower of this.towers) {
        if (NF.dist2(x, y, tower.x, tower.y) < NF.BUILD.towerClearanceSq) {
          return { ok: false, reason: 'Hier steht bereits ein Turm.' };
        }
      }

      if (this.credits < def.cost) {
        return { ok: false, reason: 'Nicht genug Credits.' };
      }

      return { ok: true, def, pathDistance, coreDistance };
    }

    placeTowerAt(x, y, typeId = this.selectedTowerType) {
      const def = NF.TOWER_DEFS[typeId];
      if (!def) return { ok: false, reason: 'Kein Turm ausgewählt.' };
      const check = this.getPlacementCheck(x, y, def.id);
      if (!check.ok) return check;

      this.credits -= def.cost;
      const tower = new NF.Tower(this, def.id, x, y);
      this.towers.push(tower);
      this.towersBuilt += 1;
      this.towerUses[def.id] = (this.towerUses[def.id] || 0) + 1;
      this.selectedTower = tower;
      this.selectedTowerType = null;
      this.audio.play('build');
      this.addEffect('build', { x, y, radius: 42, color: def.color, life: 0.45 });
      this.spawnParticles(x, y, def.color, 12, { speed: 100, size: 2.5, life: 0.45 });
      this.checkAchievements();
      this.emit('selectionchange');
      return { ok: true, tower };
    }

    // Backwards-compatible helper for old debug calls: a single number still
    // refers to a legacy pad, while two coordinates build freely.
    placeTower(x, y, typeId = this.selectedTowerType) {
      if (typeof x === 'number' && y === undefined) {
        const pad = this.pads[x];
        if (!pad) return { ok: false, reason: 'Ungültige Position.' };
        return this.placeTowerAt(pad.x, pad.y, typeId);
      }
      if (x && typeof x === 'object') {
        return this.placeTowerAt(x.x, x.y, x.typeId || typeId);
      }
      return this.placeTowerAt(x, y, typeId);
    }

    upgradeSelectedTower() {
      const tower = this.selectedTower;
      if (!tower) return { ok: false, reason: 'Kein Turm ausgewählt.' };
      if (tower.isMaxLevel) return { ok: false, reason: 'Maximales Level erreicht.' };
      const cost = this.getUpgradeCost(tower);
      if (this.credits < cost) return { ok: false, reason: 'Nicht genug Credits.' };
      this.credits -= cost;
      tower.level += 1;
      tower.invested += cost;
      tower.rangePulse = 0.6;
      this.audio.play('upgrade');
      this.addEffect('upgrade', { x: tower.x, y: tower.y, radius: 38, color: tower.def.color, life: 0.55 });
      this.spawnParticles(tower.x, tower.y, tower.def.color, 18, { speed: 130, size: 2.4, life: 0.55 });
      this.checkAchievements();
      this.emit('towerchange', tower);
      return { ok: true, tower };
    }

    chooseSpecialization(specId) {
      const tower = this.selectedTower;
      if (!tower) return { ok: false, reason: 'Kein Turm ausgewählt.' };
      if (tower.level < 3) return { ok: false, reason: 'Spezialisierung ab Level 3.' };
      if (tower.spec) return { ok: false, reason: 'Spezialisierung bereits gewählt.' };
      if (!tower.def.specs[specId]) return { ok: false, reason: 'Unbekannte Spezialisierung.' };
      const cost = this.getSpecCost(tower);
      if (this.credits < cost) return { ok: false, reason: 'Nicht genug Credits.' };
      this.credits -= cost;
      tower.invested += cost;
      tower.spec = specId;
      tower.rangePulse = 0.7;
      this.audio.play('upgrade');
      this.addEffect('upgrade', { x: tower.x, y: tower.y, radius: 52, color: tower.def.specs[specId].color, life: 0.75 });
      this.spawnParticles(tower.x, tower.y, tower.def.specs[specId].color, 26, { speed: 160, size: 3, life: 0.7 });
      this.emit('towerchange', tower);
      return { ok: true, tower };
    }

    sellSelectedTower() {
      const tower = this.selectedTower;
      if (!tower) return { ok: false, reason: 'Kein Turm ausgewählt.' };
      const value = this.getSellValue(tower);
      this.credits += value;
      if (Number.isInteger(tower.padIndex)) {
        const pad = this.pads[tower.padIndex];
        if (pad) pad.tower = null;
      }
      this.towers = this.towers.filter((entry) => entry !== tower);
      this.addEffect('sell', { x: tower.x, y: tower.y, radius: 36, color: '#ffe600', life: 0.45 });
      this.spawnParticles(tower.x, tower.y, '#ffe600', 14, { speed: 100, size: 2, life: 0.4 });
      this.audio.play('sell');
      this.selectedTower = null;
      this.emit('selectionchange');
      return { ok: true, value };
    }

    cycleTargeting() {
      if (!this.selectedTower) return;
      const modes = ['first', 'last', 'strongest', 'fastest'];
      const index = modes.indexOf(this.selectedTower.targeting);
      this.selectedTower.targeting = modes[(index + 1) % modes.length];
      this.audio.play('click');
      this.emit('towerchange', this.selectedTower);
    }

    cancelAction() {
      this.selectedTowerType = null;
      this.pendingAbility = null;
      this.emit('selectionchange');
    }

    // -----------------------------------------------------------------------
    // Abilities
    // -----------------------------------------------------------------------

    activateAbility(abilityId) {
      const ability = NF.ABILITY_MAP[abilityId];
      if (!ability) return { ok: false, reason: 'Unbekannte Fähigkeit.' };
      const state = this.getAbilityState(abilityId);
      if (!state) return { ok: false, reason: 'Fähigkeit nicht verfügbar.' };
      if (state.cooldown > 0) return { ok: false, reason: `Abklingzeit: ${Math.ceil(state.cooldown)}s` };
      if (!state.affordable) return { ok: false, reason: 'Nicht genug Energie.' };

      if (abilityId === 'orbital' || abilityId === 'emp') {
        this.pendingAbility = abilityId;
        this.selectedTowerType = null;
        this.selectedTower = null;
        this.audio.play('click');
        this.emit('selectionchange');
        return { ok: true, needsTarget: true };
      }
      return this.castAbility(abilityId, this.map.core.x, this.map.core.y);
    }

    castAbilityAt(x, y) {
      if (!this.pendingAbility) return { ok: false, reason: 'Keine Fähigkeit ausgewählt.' };
      const id = this.pendingAbility;
      this.pendingAbility = null;
      return this.castAbility(id, x, y);
    }

    castAbility(abilityId, x, y) {
      const ability = NF.ABILITY_MAP[abilityId];
      if (!ability) return { ok: false, reason: 'Unbekannte Fähigkeit.' };
      const state = this.getAbilityState(abilityId);
      if (!state || state.cooldown > 0) return { ok: false, reason: 'Fähigkeit noch nicht bereit.' };
      if (!state.affordable) return { ok: false, reason: 'Nicht genug Energie.' };

      this.energy -= ability.cost;
      this.abilityCooldowns[abilityId] = this.getAbilityCooldown(ability);

      if (abilityId === 'orbital') {
        this.orbitalStrikes.push({
          x,
          y,
          radius: ability.radius,
          damage: ability.damage * this.mods.abilityPower,
          timer: 0.8
        });
        this.addEffect('orbital-warning', { x, y, radius: ability.radius, color: ability.color, life: 0.8 });
        this.audio.play('ability');
        this.emit('ability', ability);
      } else if (abilityId === 'emp') {
        this.addEffect('emp', { x, y, radius: ability.radius, color: ability.color, life: 0.7 });
        for (const enemy of this.enemies) {
          if (enemy.dead || enemy.leaked) continue;
          if (NF.dist2(x, y, enemy.x, enemy.y) <= (ability.radius + enemy.radius) ** 2) {
            enemy.applyStun(ability.stun);
            this.damageEnemy(enemy, 24 * this.mods.abilityPower, { source: null, armorPierce: 0.5, silent: true });
          }
        }
        this.shake = Math.max(this.shake, 5);
        this.audio.play('emp');
        this.emit('ability', ability);
      } else if (abilityId === 'repair') {
        const heal = this.coreMax * ability.heal;
        this.coreHp = Math.min(this.coreMax, this.coreHp + heal);
        this.addEffect('repair-core', { x: this.map.core.x, y: this.map.core.y, radius: 66, color: ability.color, life: 0.8 });
        this.spawnParticles(this.map.core.x, this.map.core.y, ability.color, 24, { speed: 80, size: 2.5, life: 0.8 });
        this.audio.play('repair');
        this.emit('ability', ability);
      } else if (abilityId === 'overcharge') {
        this.overchargeTimer = ability.duration;
        this.addEffect('overcharge', { x: this.map.core.x, y: this.map.core.y, radius: 90, color: ability.color, life: 0.8 });
        this.audio.play('overcharge');
        this.emit('ability', ability);
      }

      this.emit('selectionchange');
      return { ok: true, ability };
    }

    updateOrbitalStrikes(dt) {
      for (const strike of this.orbitalStrikes) {
        strike.timer -= dt;
        if (strike.timer <= 0) {
          this.addEffect('orbital-beam', { x: strike.x, y: strike.y, radius: strike.radius, color: '#00f0ff', life: 0.55 });
          this.addEffect('explosion', { x: strike.x, y: strike.y, radius: strike.radius, color: '#00f0ff', color2: '#ffffff', life: 0.6 });
          this.spawnExplosion(strike.x, strike.y, '#00f0ff', 48, strike.radius);
          this.damageArea(strike.x, strike.y, strike.radius, strike.damage, { source: null, armorPierce: 0.3, bossBonus: 0.1 });
          this.shake = Math.max(this.shake, 12);
          this.audio.play('orbital');
        }
      }
      this.orbitalStrikes = this.orbitalStrikes.filter((strike) => strike.timer > 0);
    }

    // -----------------------------------------------------------------------
    // Main update
    // -----------------------------------------------------------------------

    update(dt) {
      if (this.state !== 'playing') return;
      dt = Math.min(dt, 0.05);
      this.runTime += dt;
      this.saveTimer += dt;

      this.energy = Math.min(this.energyMax, this.energy + this.mods.energyRegen * dt);
      if (this.mods.coreRegen > 0 && this.coreHp > 0) {
        this.coreHp = Math.min(this.coreMax, this.coreHp + this.mods.coreRegen * dt);
      }
      if (this.overchargeTimer > 0) this.overchargeTimer = Math.max(0, this.overchargeTimer - dt);

      for (const id of Object.keys(this.abilityCooldowns)) {
        this.abilityCooldowns[id] = Math.max(0, (this.abilityCooldowns[id] || 0) - dt);
        if (this.abilityCooldowns[id] <= 0) delete this.abilityCooldowns[id];
      }

      this.updateOrbitalStrikes(dt);

      for (const tower of this.towers) tower.update(dt);
      for (const enemy of this.enemies) enemy.update(dt);
      for (const projectile of this.projectiles) projectile.update(dt);
      for (const particle of this.particles) particle.update(dt);
      for (const effect of this.effects) effect.update(dt);
      for (const text of this.floatingTexts) text.update(dt);

      this.enemies = this.enemies.filter((enemy) => !enemy.dead && !enemy.leaked);
      this.projectiles = this.projectiles.filter((projectile) => !projectile.dead);
      this.particles = this.particles.filter((particle) => !particle.dead);
      this.effects = this.effects.filter((effect) => !effect.dead);
      this.floatingTexts = this.floatingTexts.filter((text) => !text.dead);
      if (this.particles.length > 750) this.particles.splice(0, this.particles.length - 750);
      if (this.effects.length > 120) this.effects.splice(0, this.effects.length - 120);
      if (this.floatingTexts.length > 80) this.floatingTexts.splice(0, this.floatingTexts.length - 80);

      this.shake = Math.max(0, this.shake - dt * 18);
      this.flash = Math.max(0, this.flash - dt * 2.2);

      if (this.waveActive) {
        this.waveElapsed += dt;
        if (this.spawnQueue.length > 0) {
          this.spawnTimer -= dt;
          if (this.spawnTimer <= 0) {
            this.spawnNextEnemy();
            this.spawnTimer = this.wavePlan ? this.wavePlan.interval : 0.6;
          }
        }
        if (this.spawnQueue.length === 0 && this.resolvedInWave >= this.totalInWave) {
          this.completeWave();
        }
      } else {
        this.waveCountdown -= dt;
        if (this.waveCountdown <= 0) this.startWave();
      }

      if (this.saveTimer > 15 && !this.waveActive) {
        this.saveTimer = 0;
        this.saveRunSnapshot();
      }

      this.score = this.calculateScore();
      this.emit('tick');
    }

    startWave() {
      if (this.state !== 'playing') return;
      if (this.wave > NF.FINAL_WAVE) {
        this.endRun(true);
        return;
      }
      this.wavePlan = NF.getWavePlan(this.wave, this.difficulty);
      this.waveActive = true;
      this.waveCountdown = 0;
      this.waveElapsed = 0;
      this.spawnQueue = [...this.wavePlan.types];
      this.totalInWave = this.spawnQueue.length;
      this.spawnedInWave = 0;
      this.resolvedInWave = 0;
      this.killedInWave = 0;
      this.waveCoreDamage = 0;
      this.spawnTimer = 0.35;
      this.boss = null;

      if (this.mods.coreShield > 0) {
        this.coreShield = Math.max(this.coreShield, Math.round(this.mods.coreShield));
      }

      this.audio.play(this.wavePlan.isBoss ? 'bossWarn' : 'waveStart');
      if (this.wavePlan.isBoss) {
        this.audio.setMusicMode('boss');
        this.emit('bossWarning', { wave: this.wave, bossType: this.wavePlan.bossType });
      } else {
        this.audio.setMusicMode('battle');
      }
      this.emit('waveStart', this.wavePlan);
      this.saveRunSnapshot();
    }

    spawnNextEnemy() {
      if (!this.wavePlan || this.spawnQueue.length === 0) return;
      const type = this.spawnQueue.shift();
      this.spawnedInWave += 1;
      if (type.startsWith('boss:')) {
        this.spawnBoss(type.slice(5));
        return;
      }
      const stats = NF.getEnemyStats(type, this.wave, this.difficulty);
      const enemy = new NF.Enemy(this, stats);
      this.enemies.push(enemy);
      this.addEffect('spawn', { x: enemy.x + 26, y: enemy.y, radius: 26, color: enemy.color, life: 0.45 });
    }

    spawnBoss(bossType) {
      const stats = NF.getBossStats(bossType, this.difficulty);
      const enemy = new NF.Enemy(this, { ...stats, wave: this.wave });
      enemy.isBoss = true;
      enemy.bossType = bossType;
      this.enemies.push(enemy);
      this.boss = enemy;
      this.audio.play('bossWarn');
      this.shake = Math.max(this.shake, 8);
      this.addEffect('boss-spawn', { x: enemy.x + 40, y: enemy.y, radius: 80, color: enemy.color, life: 1.0 });
      this.emit('bossSpawn', enemy);
    }

    spawnEscort(type, boss) {
      const stats = NF.getEnemyStats(type, this.wave, this.difficulty);
      const enemy = new NF.Enemy(this, stats);
      enemy.x = boss.x + NF.rand(-24, 24);
      enemy.y = boss.y + NF.rand(-24, 24);
      enemy.pathIndex = boss.pathIndex;
      enemy.distance = boss.distance;
      this.enemies.push(enemy);
      this.totalInWave += 1;
      this.addEffect('spawn', { x: enemy.x, y: enemy.y, radius: 24, color: enemy.color, life: 0.4 });
      return enemy;
    }

    completeWave() {
      if (!this.waveActive) return;
      this.waveActive = false;
      const completedWave = this.wave;
      this.lastWaveCompleted = completedWave;
      const rewardCredits = this.wavePlan ? this.wavePlan.rewardCredits : 0;
      const rewardResearch = this.wavePlan ? this.wavePlan.rewardResearch : 0;
      this.credits += rewardCredits;
      this.profile.research += rewardResearch;
      this.researchEarned += rewardResearch;
      this.runXp += 15 + completedWave * 5;
      this.energy = Math.min(this.energyMax, this.energy + 15);
      this.profile.stats.bestWave = Math.max(this.profile.stats.bestWave, completedWave);
      this.save.saveProfile(this.profile);
      this.audio.play('waveClear');
      this.emit('waveComplete', {
        wave: completedWave,
        credits: rewardCredits,
        research: rewardResearch,
        nextWave: completedWave + 1
      });
      this.checkAchievements();

      if (completedWave >= NF.FINAL_WAVE) {
        this.endRun(true);
        return;
      }

      this.wave += 1;
      this.wavePlan = null;
      this.waveCountdown = this.autoStart ? 4 : 9;
      this.totalInWave = 0;
      this.resolvedInWave = 0;
      this.saveRunSnapshot();
      this.emit('waveReady', { wave: this.wave, countdown: this.waveCountdown });
    }

    // -----------------------------------------------------------------------
    // Combat helpers
    // -----------------------------------------------------------------------

    findTarget(tower, stats) {
      const candidates = [];
      const rangeSq = (stats.range + 8) ** 2;
      for (const enemy of this.enemies) {
        if (!enemy.isTargetable) continue;
        if (NF.dist2(tower.x, tower.y, enemy.x, enemy.y) <= rangeSq) candidates.push(enemy);
      }
      if (candidates.length === 0) return null;

      switch (tower.targeting) {
        case 'last':
          candidates.sort((a, b) => a.progress - b.progress);
          break;
        case 'strongest':
          candidates.sort((a, b) => (b.hp + b.shield) - (a.hp + a.shield));
          break;
        case 'fastest':
          candidates.sort((a, b) => b.baseSpeed - a.baseSpeed);
          break;
        case 'first':
        default:
          candidates.sort((a, b) => b.progress - a.progress);
          break;
      }
      return candidates[0];
    }

    fireTower(tower, target, stats) {
      const muzzleX = tower.x + Math.cos(tower.angle) * 22;
      const muzzleY = tower.y + Math.sin(tower.angle) * 22;
      const crit = Math.random() < stats.crit;
      const damage = stats.damage * (crit ? stats.critMult : 1);

      if (tower.typeId === 'arc') {
        this.fireArc(tower, target, stats);
        return;
      }

      const makeProjectile = (projType, options = {}) => {
        const projectile = new NF.Projectile(this, projType, muzzleX, muzzleY, target, {
          ...stats,
          damage: options.damage || damage
        }, {
          crit,
          source: tower,
          color: stats.color,
          color2: stats.color2,
          ...options
        });
        this.projectiles.push(projectile);
      };

      if (tower.typeId === 'pulse') {
        makeProjectile('pulse');
        // Pulse Cannon level 5: twin-shot upgrade.
        if (tower.level >= 5) {
          const second = new NF.Projectile(this, 'pulse', muzzleX, muzzleY, target, {
            ...stats,
            damage: damage * 0.72
          }, {
            crit,
            source: tower,
            color: stats.color,
            color2: stats.color2
          });
          second.angle += 0.07;
          this.projectiles.push(second);
        }
        this.audio.play('laser');
      } else if (tower.typeId === 'cryo') {
        makeProjectile('cryo');
        this.audio.play('cryo');
      } else if (tower.typeId === 'plasma') {
        makeProjectile('plasma');
        this.audio.play('plasma');
      } else if (tower.typeId === 'hunter') {
        const targets = [target];
        if (stats.missiles > 1) {
          const others = this.enemies
            .filter((enemy) => enemy !== target && enemy.isTargetable && NF.dist2(tower.x, tower.y, enemy.x, enemy.y) <= stats.range ** 2)
            .sort((a, b) => NF.dist2(tower.x, tower.y, a.x, a.y) - NF.dist2(tower.x, tower.y, b.x, b.y));
          for (let i = 1; i < stats.missiles && others.length > 0; i += 1) targets.push(others[(i - 1) % others.length]);
        }
        for (let i = 0; i < stats.missiles; i += 1) {
          const missileTarget = targets[i % targets.length];
          const missile = new NF.Projectile(this, 'hunter', muzzleX, muzzleY, missileTarget, {
            ...stats,
            damage
          }, {
            crit,
            source: tower,
            color: stats.color,
            color2: stats.color2,
            radius: 5
          });
          missile.angle += (i - (stats.missiles - 1) / 2) * 0.14;
          this.projectiles.push(missile);
        }
        this.audio.play('missile');
      }

      this.addEffect('muzzle', { x: muzzleX, y: muzzleY, radius: 12, color: stats.color, life: 0.12, angle: tower.angle });
      this.spawnParticles(muzzleX, muzzleY, stats.color, 3, { speed: 70, size: 1.8, life: 0.22 });
    }

    fireArc(tower, target, stats) {
      const segments = [];
      const hit = new Set();
      let current = target;
      let previousX = tower.x;
      let previousY = tower.y;

      for (let jump = 0; jump < stats.chains && current; jump += 1) {
        hit.add(current);
        segments.push({ x1: previousX, y1: previousY, x2: current.x, y2: current.y });
        const crit = Math.random() < stats.crit;
        const damage = stats.damage * Math.pow(0.86, jump) * (crit ? stats.critMult : 1);
        this.damageEnemy(current, damage, {
          source: tower,
          armorPierce: stats.armorPierce,
          bossBonus: stats.bossBonus,
          bonusVsSlowed: stats.bonusVsSlowed
        });
        if (Math.random() < stats.stunChance) current.applyStun(stats.stunDuration);
        previousX = current.x;
        previousY = current.y;

        let next = null;
        let best = Infinity;
        for (const enemy of this.enemies) {
          if (hit.has(enemy) || !enemy.isTargetable) continue;
          const distance = NF.dist2(previousX, previousY, enemy.x, enemy.y);
          if (distance < best && distance <= stats.chainRange ** 2) {
            best = distance;
            next = enemy;
          }
        }
        current = next;
      }

      this.addEffect('lightning', {
        x: tower.x,
        y: tower.y,
        segments,
        color: stats.color,
        color2: '#ffffff',
        life: 0.22
      });
      this.audio.play('arc');
      this.addEffect('muzzle', { x: tower.x, y: tower.y, radius: 14, color: stats.color, life: 0.1 });
    }

    damageEnemy(enemy, amount, options = {}) {
      if (!enemy || enemy.dead || enemy.leaked || amount <= 0) return 0;
      const total = enemy.takeDamage(amount, options);
      if (total > 0) {
        if (options.source && options.source instanceof NF.Tower) {
          options.source.damageDealt += total;
        }
        if (!options.silent && this.profile.settings.damageNumbers) {
          this.addText(enemy.x + NF.rand(-8, 8), enemy.y - enemy.radius - 4, `-${Math.round(total)}`, {
            color: options.crit ? '#ffe600' : '#ffffff',
            size: options.crit ? 14 : 11,
            life: 0.65
          });
        }
        if (!options.dot) {
          this.spawnParticles(enemy.x, enemy.y, enemy.color, 2, { speed: 55, size: 1.6, life: 0.22 });
          this.audio.play('hit');
        }
      }
      return total;
    }

    damageArea(x, y, radius, damage, options = {}, exclude = null) {
      for (const enemy of [...this.enemies]) {
        if (enemy === exclude || !enemy.isTargetable) continue;
        const distance = NF.dist(x, y, enemy.x, enemy.y);
        if (distance <= radius + enemy.radius) {
          const falloff = 1 - NF.clamp(distance / Math.max(1, radius), 0, 1) * 0.35;
          this.damageEnemy(enemy, damage * falloff, options);
        }
      }
    }

    applyProjectileHit(projectile, enemy) {
      let damage = projectile.damage;
      if (projectile.antiAir > 1 && enemy.flying) damage *= projectile.antiAir;
      const options = {
        source: projectile.source,
        armorPierce: projectile.armorPierce,
        bossBonus: projectile.bossBonus,
        bonusVsSlowed: projectile.bonusVsSlowed,
        crit: projectile.crit
      };
      this.damageEnemy(enemy, damage, options);
      if (projectile.slow > 0) enemy.applySlow(projectile.slow, projectile.slowDuration);
      if (projectile.burnDps > 0) enemy.applyBurn(projectile.burnDps, projectile.burnDuration);
    }

    projectileHit(projectile, target) {
      if (projectile.splash > 0) {
        this.applyProjectileHit(projectile, target);
        this.damageArea(projectile.x, projectile.y, projectile.splash, projectile.damage * 0.72, {
          source: projectile.source,
          armorPierce: projectile.armorPierce,
          bossBonus: projectile.bossBonus,
          bonusVsSlowed: projectile.bonusVsSlowed,
          crit: projectile.crit
        }, target);
        this.addEffect('explosion', {
          x: projectile.x,
          y: projectile.y,
          radius: projectile.splash,
          color: projectile.color,
          color2: projectile.color2,
          life: 0.4
        });
        this.spawnExplosion(projectile.x, projectile.y, projectile.color, 14, projectile.splash);
        if (projectile.type === 'plasma' || projectile.type === 'hunter') this.audio.play('explosion');
      } else {
        this.applyProjectileHit(projectile, target);
        this.addEffect('impact', {
          x: projectile.x,
          y: projectile.y,
          radius: 18,
          color: projectile.color,
          color2: projectile.color2,
          life: 0.22
        });
      }

      // Cryo applies its slow to the splash area as well.
      if (projectile.slow > 0 && projectile.splash > 0) {
        for (const enemy of this.enemies) {
          if (!enemy.isTargetable) continue;
          if (NF.dist2(projectile.x, projectile.y, enemy.x, enemy.y) <= (projectile.splash + enemy.radius) ** 2) {
            enemy.applySlow(projectile.slow, projectile.slowDuration);
          }
        }
      }
    }

    projectileExplode(projectile) {
      if (projectile.splash > 0) {
        this.damageArea(projectile.x, projectile.y, projectile.splash, projectile.damage * 0.7, {
          source: projectile.source,
          armorPierce: projectile.armorPierce,
          bossBonus: projectile.bossBonus,
          bonusVsSlowed: projectile.bonusVsSlowed,
          crit: projectile.crit
        });
        this.addEffect('explosion', {
          x: projectile.x,
          y: projectile.y,
          radius: projectile.splash,
          color: projectile.color,
          color2: projectile.color2,
          life: 0.4
        });
        this.spawnExplosion(projectile.x, projectile.y, projectile.color, 10, projectile.splash);
      }
    }

    // -----------------------------------------------------------------------
    // Enemy events / boss abilities
    // -----------------------------------------------------------------------

    onEnemyKilled(enemy, source) {
      if (this.state !== 'playing') return;
      const credits = Math.max(1, Math.round(enemy.reward * this.mods.credits));
      this.credits += credits;
      this.energy = Math.min(this.energyMax, this.energy + (enemy.isBoss ? 25 : 1.1));
      this.kills += 1;
      this.resolvedInWave += 1;
      this.killedInWave += 1;
      this.runXp += enemy.isBoss ? 120 : Math.max(1, Math.round(enemy.reward * 0.7));
      if (source instanceof NF.Tower) source.kills += 1;

      this.addText(enemy.x, enemy.y - enemy.radius - 8, `+${credits}`, {
        color: '#ffe600',
        size: enemy.isBoss ? 18 : 10,
        life: 0.8
      });
      this.spawnParticles(enemy.x, enemy.y, enemy.color, enemy.isBoss ? 40 : 8, {
        speed: enemy.isBoss ? 280 : 90,
        size: enemy.isBoss ? 4 : 2,
        life: enemy.isBoss ? 0.9 : 0.4
      });

      if (enemy.isBoss) {
        this.bossesKilled += 1;
        this.boss = null;
        this.audio.play('bossDeath');
        this.audio.setMusicMode('battle');
        this.shake = Math.max(this.shake, 18);
        this.flash = 1;
        this.addEffect('boss-explosion', {
          x: enemy.x,
          y: enemy.y,
          radius: 170,
          color: enemy.color,
          color2: enemy.color2,
          life: 1.1
        });
        this.spawnExplosion(enemy.x, enemy.y, enemy.color, 90, 190);
        this.runXp += 120;
        this.emit('bossKilled', enemy);
        this.checkAchievements(enemy);
        if (this.waveCoreDamage === 0) this.unlockAchievement('untouchable');
      } else {
        this.audio.play('death');
      }

      this.checkAchievements();
      this.emit('enemyKilled', enemy);
    }

    onEnemyLeaked(enemy) {
      if (this.state !== 'playing') return;
      this.resolvedInWave += 1;
      this.damageCore(enemy.coreDamage, enemy);
      this.addEffect('leak', { x: this.map.core.x, y: this.map.core.y, radius: 70, color: '#ff0077', life: 0.55 });
      this.addText(this.map.core.x, this.map.core.y - 60, `-${enemy.coreDamage} KERN`, {
        color: '#ff0077',
        size: 15,
        life: 1.1
      });
      this.audio.play('leak');
      this.emit('leak', enemy);
    }

    damageCore(amount, source = null) {
      let damage = Math.max(0, amount);
      if (this.coreShield > 0) {
        const absorbed = Math.min(this.coreShield, damage);
        this.coreShield -= absorbed;
        damage -= absorbed;
        if (this.coreShield <= 0) {
          this.addEffect('shield-break', { x: this.map.core.x, y: this.map.core.y, radius: 60, color: '#b26bff', life: 0.5 });
        }
      }
      damage *= 1 - this.mods.coreArmor;
      this.coreHp = Math.max(0, this.coreHp - damage);
      this.waveCoreDamage += damage;
      this.shake = Math.max(this.shake, 7);
      this.flash = Math.max(this.flash, 0.35);
      if (this.coreHp <= 0) this.endRun(false);
    }

    onShieldBreak(enemy) {
      this.addEffect('shield-break', { x: enemy.x, y: enemy.y, radius: enemy.radius + 18, color: '#b26bff', life: 0.4 });
      this.spawnParticles(enemy.x, enemy.y, '#b26bff', 10, { speed: 90, size: 2, life: 0.35 });
    }

    repairNearbyEnemies(source) {
      const targets = this.enemies.filter((enemy) => (
        enemy !== source &&
        !enemy.dead &&
        !enemy.leaked &&
        enemy.hp < enemy.maxHp &&
        NF.dist2(source.x, source.y, enemy.x, enemy.y) <= 155 * 155
      ));
      for (const target of targets.slice(0, 3)) {
        const heal = target.maxHp * 0.045 + 4;
        const actual = target.heal(heal);
        if (actual > 0) {
          this.addEffect('repair-beam', {
            x: source.x,
            y: source.y,
            segments: [{ x1: source.x, y1: source.y, x2: target.x, y2: target.y }],
            color: '#00ff66',
            life: 0.25
          });
          this.addText(target.x, target.y - target.radius - 4, `+${Math.round(actual)}`, {
            color: '#00ff66',
            size: 9,
            life: 0.55
          });
        }
      }
    }

    onBossPhase(enemy, phase) {
      this.shake = Math.max(this.shake, 6);
      this.addEffect('boss-phase', {
        x: enemy.x,
        y: enemy.y,
        radius: 100,
        color: enemy.color,
        color2: enemy.color2,
        life: 0.9
      });
      this.audio.play('bossWarn');
      this.emit('bossPhase', { boss: enemy, phase });
    }

    bossAbility(enemy) {
      if (this.state !== 'playing') return;
      if (enemy.bossType === 'titan') {
        this.addEffect('seismic', { x: enemy.x, y: enemy.y, radius: 260, color: '#ffb347', life: 0.8 });
        this.shake = Math.max(this.shake, 12);
        this.audio.play('explosion');
        for (const tower of this.towers) {
          if (NF.dist2(enemy.x, enemy.y, tower.x, tower.y) <= 260 * 260) {
            tower.disabledTimer = Math.max(tower.disabledTimer, 2.2);
          }
        }
        this.spawnEscort('assault', enemy);
        this.spawnEscort('assault', enemy);
        this.emit('bossAbility', { boss: enemy, ability: 'seismic' });
      } else if (enemy.bossType === 'void') {
        enemy.invulnerableTimer = 1.8;
        enemy.shield = Math.min(enemy.shieldMax, enemy.shield + enemy.shieldMax * 0.15);
        this.addEffect('void-phase', { x: enemy.x, y: enemy.y, radius: 120, color: enemy.color, color2: enemy.color2, life: 0.8 });
        this.spawnEscort('phantom', enemy);
        this.spawnEscort('phantom', enemy);
        this.spawnEscort('phantom', enemy);
        this.audio.play('emp');
        this.emit('bossAbility', { boss: enemy, ability: 'phase' });
      } else if (enemy.bossType === 'omega') {
        if (enemy.phase === 1) {
          for (let i = 0; i < 4; i += 1) this.spawnEscort('swarm', enemy);
          this.addEffect('omega-pulse', { x: enemy.x, y: enemy.y, radius: 130, color: enemy.color, life: 0.7 });
          this.audio.play('plasma');
        } else if (enemy.phase === 2) {
          const targets = this.towers.filter((tower) => tower.disabledTimer <= 0).slice(0, 2);
          for (const tower of targets) tower.disabledTimer = 2.8;
          this.addEffect('emp', { x: enemy.x, y: enemy.y, radius: 220, color: '#b26bff', life: 0.8 });
          this.spawnEscort('shield', enemy);
          this.spawnEscort('shield', enemy);
          this.audio.play('emp');
        } else {
          this.spawnEscort('elite', enemy);
          this.spawnEscort('elite', enemy);
          enemy.enraged = true;
          this.addEffect('omega-rage', { x: enemy.x, y: enemy.y, radius: 160, color: '#ff0077', life: 0.9 });
          this.audio.play('bossWarn');
        }
        this.emit('bossAbility', { boss: enemy, ability: 'omega', phase: enemy.phase });
      }
    }

    // -----------------------------------------------------------------------
    // Visual helpers
    // -----------------------------------------------------------------------

    addEffect(type, options = {}) {
      this.effects.push(new NF.Effect(type, options));
    }

    addText(x, y, text, options = {}) {
      if (!this.profile.settings.damageNumbers && String(text).startsWith('-')) return;
      this.floatingTexts.push(new NF.FloatingText(x, y, text, options));
    }

    spawnParticles(x, y, color, count = 8, options = {}) {
      if (!this.profile.settings.particles) return;
      const amount = Math.min(count, 60);
      const speed = options.speed || 80;
      for (let i = 0; i < amount; i += 1) {
        const angle = Math.random() * TAU;
        const velocity = NF.rand(speed * 0.25, speed);
        this.particles.push(new NF.Particle({
          x,
          y,
          vx: Math.cos(angle) * velocity,
          vy: Math.sin(angle) * velocity,
          life: NF.rand((options.life || 0.5) * 0.45, options.life || 0.5),
          size: NF.rand(1, options.size || 2.5),
          color: Math.random() < 0.22 ? '#ffffff' : color,
          gravity: options.gravity || 0,
          drag: options.drag || 0.92,
          shape: options.shape || 'circle'
        }));
      }
    }

    spawnExplosion(x, y, color, count = 20, radius = 60) {
      if (!this.profile.settings.particles) return;
      this.spawnParticles(x, y, color, count, {
        speed: radius * 4,
        size: 4,
        life: 0.7,
        gravity: 12,
        drag: 0.9
      });
      this.spawnParticles(x, y, '#ffffff', Math.round(count * 0.3), {
        speed: radius * 5,
        size: 2,
        life: 0.35,
        drag: 0.86
      });
    }

    // -----------------------------------------------------------------------
    // Meta progression
    // -----------------------------------------------------------------------

    checkAchievements(boss = null) {
      const totalKills = this.profile.stats.totalKills + this.kills;
      const techCount = Object.keys(this.profile.tech).length;
      if (this.kills >= 1 || totalKills >= 1) this.unlockAchievement('first_blood');
      if (this.wave >= 10 || this.profile.stats.bestWave >= 10) this.unlockAchievement('wave10');
      if (this.bossesKilled >= 1) this.unlockAchievement('first_boss');
      if (this.towersBuilt >= 5 || this.towers.length >= 5) this.unlockAchievement('architect');
      if (totalKills >= 100) this.unlockAchievement('centurion');
      if (techCount >= 5) this.unlockAchievement('tech_pioneer');
      if (this.towers.some((tower) => tower.level >= 5)) this.unlockAchievement('max_tower');
      if (boss && boss.bossType === 'omega') this.unlockAchievement('omega');
      if (this.state === 'victory' && this.difficulty.id === 'nightmare') this.unlockAchievement('nightmare_win');
    }

    unlockAchievement(id) {
      if (this.profile.achievements[id]) return false;
      const achievement = NF.ACHIEVEMENTS.find((entry) => entry.id === id);
      if (!achievement) return false;
      this.profile.achievements[id] = true;
      this.save.saveProfile(this.profile);
      this.audio.play('achievement');
      this.emit('achievement', achievement);
      return true;
    }

    buyTech(nodeId) {
      const node = NF.TECH_NODE_MAP[nodeId];
      if (!node) return { ok: false, reason: 'Unbekannter Technologie-Knoten.' };
      if (this.profile.tech[nodeId]) return { ok: false, reason: 'Bereits erforscht.' };
      if (node.req && !this.profile.tech[node.req]) return { ok: false, reason: 'Voraussetzung fehlt.' };
      if (this.profile.research < node.cost) return { ok: false, reason: 'Nicht genug Forschungspunkte.' };
      this.profile.research -= node.cost;
      this.profile.tech[nodeId] = true;
      this.recalculateMods();
      this.save.saveProfile(this.profile);
      this.audio.play('upgrade');
      this.checkAchievements();
      this.emit('techchange', node);
      return { ok: true, node };
    }

    buyDoctrine(upgradeId) {
      const upgrade = NF.DOCTRINE_UPGRADES.find((entry) => entry.id === upgradeId);
      if (!upgrade) return { ok: false, reason: 'Unbekannte Doktrin.' };
      const current = this.profile.doctrine[upgradeId] || 0;
      if (current >= upgrade.max) return { ok: false, reason: 'Maximale Stufe erreicht.' };
      if (this.profile.doctrinePoints < 1) return { ok: false, reason: 'Keine Doktrin-Punkte.' };
      this.profile.doctrinePoints -= 1;
      this.profile.doctrine[upgradeId] = current + 1;
      this.recalculateMods();
      this.save.saveProfile(this.profile);
      this.audio.play('upgrade');
      this.emit('doctrinechange', upgrade);
      return { ok: true, upgrade };
    }

    calculateScore() {
      return Math.round(
        Math.max(0, this.wave - (this.waveActive ? 1 : 0)) * 1000 +
        this.kills * 15 +
        this.coreHp * 4 +
        this.credits * 0.5 +
        this.bossesKilled * 2500 +
        this.towers.reduce((total, tower) => total + tower.level * 25, 0)
      );
    }

    saveRunSnapshot() {
      if (!this.map || !['playing', 'paused'].includes(this.state)) return;
      const snapshot = NF.createRunSnapshot();
      snapshot.mapId = this.map.id;
      snapshot.difficulty = this.difficulty.id;
      snapshot.wave = this.wave;
      snapshot.credits = Math.round(this.credits);
      snapshot.coreHp = Math.round(this.coreHp);
      snapshot.coreMax = this.coreMax;
      snapshot.coreShield = Math.round(this.coreShield);
      snapshot.energy = Math.round(this.energy);
      snapshot.time = this.runTime;
      snapshot.score = this.calculateScore();
      snapshot.kills = this.kills;
      snapshot.bossesKilled = this.bossesKilled;
      snapshot.runXp = this.runXp;
      snapshot.researchEarned = this.researchEarned;
      snapshot.towersBuilt = this.towersBuilt;
      snapshot.towerUses = { ...this.towerUses };
      snapshot.abilityCooldowns = { ...this.abilityCooldowns };
      snapshot.overchargeTimer = this.overchargeTimer;
      snapshot.towers = this.towers.map((tower) => ({
        type: tower.typeId,
        x: Math.round(tower.x * 10) / 10,
        y: Math.round(tower.y * 10) / 10,
        level: tower.level,
        spec: tower.spec,
        targeting: tower.targeting,
        invested: tower.invested,
        kills: tower.kills,
        damageDealt: tower.damageDealt,
        shots: tower.shots
      }));
      this.save.saveRun(snapshot);
    }

    // -----------------------------------------------------------------------
    // Info helpers used by UI
    // -----------------------------------------------------------------------

    getWaveLabel() {
      if (this.state === 'menu') return 'BEREIT';
      if (this.waveActive) return `WELLE ${String(this.wave).padStart(2, '0')}`;
      if (this.wave > NF.FINAL_WAVE) return 'ABGESCHLOSSEN';
      return `WELLE ${String(this.wave).padStart(2, '0')}`;
    }

    getWaveStateLabel() {
      if (this.waveActive) return 'AKTIV';
      if (this.waveCountdown > 0) return `IN ${Math.ceil(this.waveCountdown)}s`;
      return 'BEREIT';
    }

    getBossInfo() {
      const boss = this.bossEnemy;
      if (!boss) return null;
      return {
        name: boss.name,
        phase: boss.phase,
        maxHp: boss.maxHp,
        hp: boss.hp,
        shield: boss.shield,
        shieldMax: boss.shieldMax,
        ratio: boss.healthRatio,
        shieldRatio: boss.shieldRatio
      };
    }

    getSummary() {
      return {
        map: this.map,
        difficulty: this.difficulty,
        wave: this.wave,
        waveActive: this.waveActive,
        credits: Math.round(this.credits),
        energy: Math.round(this.energy),
        coreHp: Math.round(this.coreHp),
        coreMax: this.coreMax,
        coreShield: Math.round(this.coreShield),
        score: this.calculateScore(),
        kills: this.kills,
        bossesKilled: this.bossesKilled,
        towers: this.towers.length,
        enemies: this.enemyCount,
        speed: this.speed
      };
    }
  }

  NF.Game = Game;
})();
