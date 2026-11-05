/* ==========================================================================
   NEON FRONTIER — entities
   Tower, Enemy, Projectile, Particle, Effect and FloatingText classes.
   The engine owns the collections; these classes own local simulation state.
   ========================================================================== */

(() => {
  'use strict';

  const NF = window.NF = window.NF || {};
  const TAU = Math.PI * 2;

  function angleLerp(current, target, amount) {
    let delta = ((target - current + Math.PI * 3) % TAU) - Math.PI;
    return current + delta * amount;
  }

  // -------------------------------------------------------------------------
  // Tower
  // -------------------------------------------------------------------------

  class Tower {
    constructor(game, typeId, x, y, padIndex = null) {
      this.game = game;
      this.typeId = typeId;
      this.def = NF.TOWER_DEFS[typeId];
      this.padIndex = padIndex;
      this.x = x;
      this.y = y;
      this.level = 1;
      this.spec = null;
      this.targeting = 'first';
      this.invested = this.def.cost;
      this.kills = 0;
      this.damageDealt = 0;
      this.shots = 0;
      this.cooldown = 0.25;
      this.angle = -Math.PI / 2;
      this.rotation = Math.random() * TAU;
      this.fireFlash = 0;
      this.recoil = 0;
      this.disabledTimer = 0;
      this.rangePulse = 0;
      this.sellFlash = 0;
      this.lastTarget = null;
      this.overchargeGlow = 0;
    }

    get stats() {
      return this.game.getTowerStats(this);
    }

    get isMaxLevel() {
      return this.level >= 5;
    }

    get nextUpgradeCost() {
      if (this.isMaxLevel) return 0;
      return this.game.getUpgradeCost(this);
    }

    get specCost() {
      return this.game.getSpecCost(this);
    }

    get sellValue() {
      return this.game.getSellValue(this);
    }

    update(dt) {
      this.rotation += dt * 0.32;
      this.fireFlash = Math.max(0, this.fireFlash - dt);
      this.recoil = Math.max(0, this.recoil - dt * 5);
      this.rangePulse = Math.max(0, this.rangePulse - dt);
      this.sellFlash = Math.max(0, this.sellFlash - dt);
      this.overchargeGlow = this.game.overchargeTimer > 0 ? 1 : Math.max(0, this.overchargeGlow - dt * 2);

      if (this.disabledTimer > 0) {
        this.disabledTimer = Math.max(0, this.disabledTimer - dt);
        return;
      }

      const stats = this.game.getTowerStats(this);
      this.cooldown -= dt;

      const target = this.game.findTarget(this, stats);
      this.lastTarget = target;
      if (target) {
        const desired = Math.atan2(target.y - this.y, target.x - this.x);
        this.angle = angleLerp(this.angle, desired, Math.min(1, dt * 13));
        if (this.cooldown <= 0) {
          this.game.fireTower(this, target, stats);
          this.cooldown = 1 / Math.max(0.08, stats.fireRate);
          this.fireFlash = 0.10;
          this.recoil = 1;
          this.shots += 1;
        }
      } else {
        this.cooldown = NF.clamp(this.cooldown, 0, 0.25);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Enemy
  // -------------------------------------------------------------------------

  class Enemy {
    constructor(game, stats, options = {}) {
      this.game = game;
      this.stats = stats;
      this.type = stats.id;
      this.isBoss = Boolean(stats.boss);
      this.name = stats.name;
      this.maxHp = stats.maxHp;
      this.hp = stats.hp;
      this.shieldMax = stats.shieldMax || 0;
      this.shield = stats.shield || 0;
      this.shieldRegenDelay = 0;
      this.armor = stats.armor || 0;
      this.radius = stats.radius || 14;
      this.baseSpeed = stats.speed;
      this.speed = stats.speed;
      this.reward = stats.reward;
      this.coreDamage = stats.coreDamage;
      this.color = stats.color;
      this.color2 = stats.color2;
      this.shape = stats.shape;
      this.flying = Boolean(stats.flying);
      this.wave = stats.wave || game.wave;
      this.pathIndex = 1;
      this.distance = 0;
      this.x = game.map.path[0].x;
      this.y = game.map.path[0].y;
      this.dead = false;
      this.leaked = false;
      this.hitFlash = 0;
      this.slowTimer = 0;
      this.slowFactor = 0;
      this.stunTimer = 0;
      this.burnTimer = 0;
      this.burnDps = 0;
      this.burnAccum = 0;
      this.cloakTimer = 3.2;
      this.cloakActive = false;
      this.repairTimer = 1.2;
      this.repairPulse = 0;
      this.fortifyTimer = 4.5;
      this.fortifyActive = false;
      this.invulnerableTimer = 0;
      this.phase = 1;
      this.abilityTimer = this.isBoss ? (stats.abilityInterval || 8) * 0.65 : 0;
      this.enraged = false;
      this.spawnPulse = 0.6;
      this.bossType = stats.boss ? stats.id : null;
      this.deathTimer = 0;
      this.lastDamageSource = null;
      this.laneSeed = Math.random() * TAU;
    }

    get progress() {
      return this.distance / Math.max(1, this.game.map.length);
    }

    get isTargetable() {
      return !this.dead && !this.leaked && !(this.cloakActive && !this.isBoss);
    }

    get healthRatio() {
      return NF.clamp(this.hp / Math.max(1, this.maxHp), 0, 1);
    }

    get shieldRatio() {
      return NF.clamp(this.shield / Math.max(1, this.shieldMax), 0, 1);
    }

    applySlow(factor, duration) {
      if (this.isBoss) {
        factor *= 0.35;
        duration *= 0.65;
      }
      if (factor >= this.slowFactor || this.slowTimer <= 0) {
        this.slowFactor = Math.max(this.slowFactor, factor);
      }
      this.slowTimer = Math.max(this.slowTimer, duration);
    }

    applyStun(duration) {
      if (this.isBoss) duration = Math.min(duration, 0.8);
      this.stunTimer = Math.max(this.stunTimer, duration);
    }

    applyBurn(dps, duration) {
      if (this.isBoss) {
        dps *= 0.55;
        duration *= 0.75;
      }
      this.burnDps = Math.max(this.burnDps, dps);
      this.burnTimer = Math.max(this.burnTimer, duration);
    }

    heal(amount) {
      if (this.dead || this.leaked) return 0;
      const before = this.hp;
      this.hp = Math.min(this.maxHp, this.hp + amount);
      return this.hp - before;
    }

    takeDamage(amount, options = {}) {
      if (this.dead || this.leaked || amount <= 0) return 0;
      if (this.invulnerableTimer > 0 && !options.ignoreInvulnerability) return 0;

      let damage = amount;
      if (this.slowTimer > 0 && options.bonusVsSlowed) damage *= 1 + options.bonusVsSlowed;
      if (this.isBoss && options.bossBonus) damage *= 1 + options.bossBonus;
      const effectiveArmor = NF.clamp(this.armor - (options.armorPierce || 0), 0, 0.85);
      damage *= 1 - effectiveArmor;

      let absorbed = 0;
      if (this.shield > 0 && !options.ignoreShield) {
        absorbed = Math.min(this.shield, damage);
        this.shield -= absorbed;
        damage -= absorbed;
        this.shieldRegenDelay = 3.4;
        if (this.shield <= 0) this.game.onShieldBreak(this);
      }

      this.hp -= damage;
      this.hitFlash = 0.12;
      if (options.source) this.lastDamageSource = options.source;

      if (this.hp <= 0 && !this.dead) {
        this.dead = true;
        this.game.onEnemyKilled(this, options.source);
      }

      return absorbed + damage;
    }

    update(dt) {
      if (this.dead || this.leaked) return;

      this.spawnPulse = Math.max(0, this.spawnPulse - dt);
      this.hitFlash = Math.max(0, this.hitFlash - dt);
      this.repairPulse = Math.max(0, this.repairPulse - dt);

      if (this.slowTimer > 0) {
        this.slowTimer = Math.max(0, this.slowTimer - dt);
        if (this.slowTimer <= 0) this.slowFactor = 0;
      }

      if (this.burnTimer > 0) {
        this.burnTimer = Math.max(0, this.burnTimer - dt);
        this.burnAccum += dt;
        if (this.burnAccum >= 0.5) {
          const damage = this.burnDps * this.burnAccum;
          this.burnAccum = 0;
          this.takeDamage(damage, { armorPierce: 1, ignoreShield: false, dot: true });
        }
        if (this.burnTimer <= 0) {
          this.burnDps = 0;
          this.burnAccum = 0;
        }
      }

      if (this.shieldMax > 0 && this.shield < this.shieldMax) {
        if (this.shieldRegenDelay > 0) {
          this.shieldRegenDelay -= dt;
        } else {
          const regen = this.shieldMax * (this.isBoss ? 0.035 : 0.06) * dt;
          this.shield = Math.min(this.shieldMax, this.shield + regen);
        }
      }

      if (this.stats.repair && !this.isBoss) {
        this.repairTimer -= dt;
        if (this.repairTimer <= 0) {
          this.repairTimer = 1.4;
          this.repairPulse = 0.35;
          this.game.repairNearbyEnemies(this);
        }
      }

      if (this.stats.cloak && !this.isBoss) {
        this.cloakTimer -= dt;
        if (this.cloakTimer <= 0) {
          this.cloakActive = !this.cloakActive;
          this.cloakTimer = this.cloakActive ? 1.6 : 4.2;
        }
      }

      if (this.stats.elite && !this.isBoss) {
        this.fortifyTimer -= dt;
        if (this.fortifyTimer <= 0) {
          this.fortifyActive = !this.fortifyActive;
          this.fortifyTimer = this.fortifyActive ? 2.2 : 5.2;
        }
      }

      if (this.isBoss) this.updateBoss(dt);

      if (this.stunTimer > 0) {
        this.stunTimer = Math.max(0, this.stunTimer - dt);
        return;
      }

      this.move(dt);
    }

    move(dt) {
      const path = this.game.map.path;
      let speed = this.baseSpeed * (1 - this.slowFactor);
      if (this.enraged) speed *= 1.38;
      let remaining = speed * dt;

      while (remaining > 0 && this.pathIndex < path.length) {
        const target = path[this.pathIndex];
        const distance = NF.dist(this.x, this.y, target.x, target.y);
        if (distance <= remaining) {
          this.x = target.x;
          this.y = target.y;
          this.distance += distance;
          remaining -= distance;
          this.pathIndex += 1;
        } else if (distance > 0) {
          const ratio = remaining / distance;
          this.x += (target.x - this.x) * ratio;
          this.y += (target.y - this.y) * ratio;
          this.distance += remaining;
          remaining = 0;
        } else {
          this.pathIndex += 1;
        }
      }

      if (this.pathIndex >= path.length) {
        this.leaked = true;
        this.game.onEnemyLeaked(this);
      }
    }

    updateBoss(dt) {
      this.abilityTimer -= dt;
      this.invulnerableTimer = Math.max(0, this.invulnerableTimer - dt);

      const ratio = this.hp / this.maxHp;
      let nextPhase = 1;
      if (this.bossType === 'omega') {
        nextPhase = ratio > 0.66 ? 1 : ratio > 0.33 ? 2 : 3;
        if (nextPhase === 3) this.enraged = true;
      } else if (this.bossType === 'void') {
        nextPhase = this.shield > 0 ? 1 : 2;
      }
      if (nextPhase !== this.phase) {
        this.phase = nextPhase;
        this.game.onBossPhase(this, this.phase);
      }

      if (this.abilityTimer <= 0 && !this.game.isPaused) {
        this.abilityTimer = this.stats.abilityInterval || 8;
        this.game.bossAbility(this);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Projectile
  // -------------------------------------------------------------------------

  class Projectile {
    constructor(game, type, x, y, target, stats, options = {}) {
      this.game = game;
      this.type = type;
      this.x = x;
      this.y = y;
      this.target = target;
      this.stats = stats;
      this.speed = stats.projectileSpeed || 500;
      this.damage = stats.damage;
      this.splash = stats.splash || 0;
      this.radius = options.radius || 4;
      this.color = options.color || stats.color || '#00f0ff';
      this.color2 = options.color2 || stats.color2 || '#ffffff';
      this.angle = target ? Math.atan2(target.y - y, target.x - x) : 0;
      this.life = options.life || 4;
      this.maxLife = this.life;
      this.dead = false;
      this.homing = options.homing !== false;
      this.trail = [];
      this.trailTimer = 0;
      this.crit = Boolean(options.crit);
      this.source = options.source || null;
      this.armorPierce = stats.armorPierce || 0;
      this.bossBonus = stats.bossBonus || 0;
      this.bonusVsSlowed = stats.bonusVsSlowed || 0;
      this.antiAir = stats.antiAir || 1;
      this.slow = stats.slow || 0;
      this.slowDuration = stats.slowDuration || 0;
      this.burnDps = stats.burnDps || 0;
      this.burnDuration = stats.burnDuration || 0;
      this.spin = Math.random() * TAU;
    }

    update(dt) {
      if (this.dead) return;
      this.life -= dt;
      if (this.life <= 0) {
        this.dead = true;
        return;
      }
      this.spin += dt * 8;
      this.trailTimer += dt;
      if (this.trailTimer > 0.035) {
        this.trailTimer = 0;
        this.trail.push({ x: this.x, y: this.y, life: 0.28 });
        if (this.trail.length > 10) this.trail.shift();
      }
      for (const point of this.trail) point.life -= dt;
      this.trail = this.trail.filter((point) => point.life > 0);

      let target = this.target;
      if (!target || target.dead || target.leaked) {
        if (this.splash > 0) {
          // Keep flying briefly to the last known point and detonate.
          this.target = null;
        } else {
          this.dead = true;
          return;
        }
      }

      if (this.target && this.homing) {
        const desired = Math.atan2(this.target.y - this.y, this.target.x - this.x);
        this.angle = angleLerp(this.angle, desired, Math.min(1, dt * (this.type === 'hunter' ? 9 : 14)));
      }

      const move = this.speed * dt;
      this.x += Math.cos(this.angle) * move;
      this.y += Math.sin(this.angle) * move;

      if (this.target) {
        const hitDistance = this.target.radius + this.radius + 3;
        if (NF.dist2(this.x, this.y, this.target.x, this.target.y) <= hitDistance * hitDistance) {
          this.hit(this.target);
          return;
        }
      } else if (this.life < 2.2) {
        this.explode(null);
      }
    }

    hit(target) {
      this.dead = true;
      this.game.projectileHit(this, target);
    }

    explode(exclude) {
      if (this.dead) return;
      this.dead = true;
      this.game.projectileExplode(this, exclude);
    }
  }

  // -------------------------------------------------------------------------
  // Particle
  // -------------------------------------------------------------------------

  class Particle {
    constructor(options = {}) {
      this.x = options.x || 0;
      this.y = options.y || 0;
      this.vx = options.vx || 0;
      this.vy = options.vy || 0;
      this.life = options.life || 0.5;
      this.maxLife = this.life;
      this.size = options.size || 3;
      this.color = options.color || '#00f0ff';
      this.glow = options.glow !== false;
      this.gravity = options.gravity || 0;
      this.drag = options.drag === undefined ? 0.94 : options.drag;
      this.shape = options.shape || 'circle';
      this.rotation = options.rotation || 0;
      this.spin = options.spin || 0;
      this.dead = false;
    }

    update(dt) {
      this.life -= dt;
      if (this.life <= 0) {
        this.dead = true;
        return;
      }
      this.vx *= Math.pow(this.drag, dt * 60);
      this.vy *= Math.pow(this.drag, dt * 60);
      this.vy += this.gravity * dt;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.rotation += this.spin * dt;
    }
  }

  // -------------------------------------------------------------------------
  // Effect — short-lived visual event drawn by the renderer
  // -------------------------------------------------------------------------

  class Effect {
    constructor(type, options = {}) {
      this.type = type;
      this.x = options.x || 0;
      this.y = options.y || 0;
      this.life = options.life || 0.5;
      this.maxLife = this.life;
      this.radius = options.radius || 40;
      this.color = options.color || '#00f0ff';
      this.color2 = options.color2 || '#ffffff';
      this.follow = options.follow || null;
      this.angle = options.angle || 0;
      this.segments = options.segments || null;
      this.text = options.text || '';
      this.dead = false;
    }

    update(dt) {
      this.life -= dt;
      if (this.follow && !this.follow.dead && !this.follow.leaked) {
        this.x = this.follow.x;
        this.y = this.follow.y;
      }
      if (this.life <= 0) this.dead = true;
    }
  }

  // -------------------------------------------------------------------------
  // FloatingText
  // -------------------------------------------------------------------------

  class FloatingText {
    constructor(x, y, text, options = {}) {
      this.x = x;
      this.y = y;
      this.text = text;
      this.color = options.color || '#ffffff';
      this.life = options.life || 0.8;
      this.maxLife = this.life;
      this.vy = options.vy || -32;
      this.vx = options.vx || NF.rand(-8, 8);
      this.size = options.size || 12;
      this.bold = options.bold !== false;
      this.dead = false;
    }

    update(dt) {
      this.life -= dt;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.vy += 24 * dt;
      if (this.life <= 0) this.dead = true;
    }
  }

  NF.Tower = Tower;
  NF.Enemy = Enemy;
  NF.Projectile = Projectile;
  NF.Particle = Particle;
  NF.Effect = Effect;
  NF.FloatingText = FloatingText;
})();
