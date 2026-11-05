/* ==========================================================================
   NEON FRONTIER — canvas renderer
   Draws the menu background, maps, towers, enemies, projectiles and all
   short-lived combat effects. Glow is used deliberately, not on every particle.
   ========================================================================== */

(() => {
  'use strict';

  const NF = window.NF = window.NF || {};
  const TAU = Math.PI * 2;

  function hashString(value) {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function hexPath(ctx, x, y, radius, rotation = 0, sides = 6) {
    ctx.beginPath();
    for (let i = 0; i < sides; i += 1) {
      const angle = rotation + (i / sides) * TAU;
      const px = x + Math.cos(angle) * radius;
      const py = y + Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  function roundRectPath(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  class Renderer {
    constructor(canvas, game) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.game = game;
      this.dpr = 1;
      this.width = 1280;
      this.height = 720;
      this.scale = 1;
      this.offsetX = 0;
      this.offsetY = 0;
      this.time = 0;
      this.decorMapId = null;
      this.decor = [];
      this.menuBuildings = [];
      this.menuParticles = [];
      this.lastMapId = null;
      this.resize();
      this.buildMenuScene();
    }

    resize() {
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.width = window.innerWidth;
      this.height = window.innerHeight;
      this.canvas.width = Math.max(1, Math.floor(this.width * this.dpr));
      this.canvas.height = Math.max(1, Math.floor(this.height * this.dpr));
      this.canvas.style.width = `${this.width}px`;
      this.canvas.style.height = `${this.height}px`;
      this.scale = Math.min(this.width / NF.WORLD.width, this.height / NF.WORLD.height);
      this.offsetX = (this.width - NF.WORLD.width * this.scale) / 2;
      this.offsetY = (this.height - NF.WORLD.height * this.scale) / 2;
    }

    screenToWorld(clientX, clientY) {
      const rect = this.canvas.getBoundingClientRect();
      return {
        x: (clientX - rect.left - this.offsetX) / this.scale,
        y: (clientY - rect.top - this.offsetY) / this.scale
      };
    }

    buildMenuScene() {
      const random = NF.createSeededRandom(0x51f15e);
      this.menuBuildings = [];
      for (let i = 0; i < 42; i += 1) {
        const width = NF.lerp(24, 92, random());
        const height = NF.lerp(60, 300, random() ** 1.6);
        this.menuBuildings.push({
          x: random() * 1.15 * 1280 - 80,
          width,
          height,
          layer: random() < 0.55 ? 0.45 : 1,
          hue: random() < 0.4 ? 'cyan' : random() < 0.7 ? 'pink' : 'purple',
          antenna: random() < 0.28
        });
      }
      this.menuBuildings.sort((a, b) => a.layer - b.layer);
      this.menuParticles = Array.from({ length: 38 }, () => ({
        x: random() * 1280,
        y: random() * 720,
        size: NF.lerp(0.6, 2.2, random()),
        speed: NF.lerp(4, 18, random()),
        phase: random() * TAU
      }));
    }

    getDecor(map) {
      if (this.decorMapId === map.id) return this.decor;
      this.decorMapId = map.id;
      const random = NF.createSeededRandom(hashString(map.id));
      const decor = [];
      if (map.theme.decor === 'city') {
        for (let i = 0; i < 52; i += 1) {
          const width = NF.lerp(24, 94, random());
          const height = NF.lerp(26, 150, random() ** 1.4);
          decor.push({
            type: 'building',
            x: random() * 1360 - 40,
            y: random() * 760 - 20,
            width,
            height,
            depth: random() * 0.5 + 0.35,
            antenna: random() < 0.3,
            hue: random() < 0.6 ? 0 : 1
          });
        }
      } else if (map.theme.decor === 'factory') {
        for (let i = 0; i < 34; i += 1) {
          decor.push({
            type: random() < 0.5 ? 'tank' : 'pipe',
            x: random() * 1320 - 20,
            y: random() * 740 - 10,
            width: NF.lerp(28, 110, random()),
            height: NF.lerp(22, 80, random()),
            depth: random() * 0.5 + 0.35,
            hue: random() < 0.55 ? 0 : 1
          });
        }
      } else {
        for (let i = 0; i < 28; i += 1) {
          decor.push({
            type: random() < 0.5 ? 'ring' : 'panel',
            x: random() * 1320 - 20,
            y: random() * 740 - 10,
            width: NF.lerp(30, 130, random()),
            height: NF.lerp(12, 60, random()),
            depth: random() * 0.5 + 0.3,
            rotation: random() * TAU,
            hue: random() < 0.5 ? 0 : 1
          });
        }
      }
      this.decor = decor;
      return decor;
    }

    render(dt) {
      this.time += dt;
      const ctx = this.ctx;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.width, this.height);

      if (this.game.state === 'menu') {
        this.drawMenuBackground();
        return;
      }

      ctx.fillStyle = '#04060d';
      ctx.fillRect(0, 0, this.width, this.height);

      const shakeAmount = this.game.profile.settings.shake ? this.game.shake : 0;
      const shakeX = shakeAmount > 0 ? NF.rand(-shakeAmount, shakeAmount) : 0;
      const shakeY = shakeAmount > 0 ? NF.rand(-shakeAmount, shakeAmount) : 0;

      ctx.save();
      ctx.translate(this.offsetX + shakeX, this.offsetY + shakeY);
      ctx.scale(this.scale, this.scale);
      ctx.beginPath();
      ctx.rect(0, 0, NF.WORLD.width, NF.WORLD.height);
      ctx.clip();

      if (this.lastMapId !== this.game.map.id) {
        this.lastMapId = this.game.map.id;
        this.decorMapId = null;
      }
      this.drawMap();
      this.drawPlacementLayer();
      this.drawTowers();
      this.drawProjectiles();
      this.drawEnemies();
      this.drawEffects();
      this.drawParticles();
      this.drawFloatingTexts();
      this.drawForeground();

      ctx.restore();

      if (this.game.flash > 0) {
        ctx.fillStyle = `rgba(255, 0, 119, ${Math.min(0.32, this.game.flash * 0.2)})`;
        ctx.fillRect(0, 0, this.width, this.height);
      }
    }

    // -----------------------------------------------------------------------
    // Menu background
    // -----------------------------------------------------------------------

    drawMenuBackground() {
      const ctx = this.ctx;
      const w = this.width;
      const h = this.height;
      const time = this.time;
      const gradient = ctx.createRadialGradient(w * 0.66, h * 0.38, 10, w * 0.6, h * 0.45, Math.max(w, h) * 0.8);
      gradient.addColorStop(0, '#162442');
      gradient.addColorStop(0.32, '#0b1327');
      gradient.addColorStop(1, '#04060d');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);

      // Large atmospheric halo.
      const halo = ctx.createRadialGradient(w * 0.74, h * 0.37, 20, w * 0.74, h * 0.37, Math.min(w, h) * 0.42);
      halo.addColorStop(0, 'rgba(0, 240, 255, 0.14)');
      halo.addColorStop(0.45, 'rgba(112, 0, 255, 0.08)');
      halo.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, w, h);

      // Perspective grid floor.
      ctx.save();
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.12)';
      ctx.lineWidth = 1;
      const horizon = h * 0.55;
      const vanishX = w * 0.63;
      for (let i = 0; i < 20; i += 1) {
        const t = i / 19;
        const y = horizon + (h - horizon) * (t * t);
        ctx.globalAlpha = 0.08 + t * 0.2;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      for (let i = -12; i <= 12; i += 1) {
        ctx.globalAlpha = 0.08;
        ctx.beginPath();
        ctx.moveTo(vanishX, horizon);
        ctx.lineTo(vanishX + i * w * 0.15, h);
        ctx.stroke();
      }
      ctx.restore();

      // Distant city silhouettes.
      const baseY = h * 0.73;
      ctx.save();
      for (const building of this.menuBuildings) {
        const x = (building.x / 1280) * w;
        const bw = (building.width / 1280) * w;
        const bh = (building.height / 720) * h;
        const y = baseY - bh + (building.layer === 0.45 ? h * 0.08 : 0);
        ctx.globalAlpha = building.layer === 0.45 ? 0.38 : 0.72;
        ctx.fillStyle = building.layer === 0.45 ? '#0a1324' : '#070c17';
        ctx.fillRect(x, y, bw, bh);
        const accent = building.hue === 'cyan' ? 'rgba(0, 240, 255, 0.42)' : building.hue === 'pink' ? 'rgba(255, 0, 119, 0.36)' : 'rgba(112, 0, 255, 0.4)';
        ctx.fillStyle = accent;
        ctx.fillRect(x, y, bw, 1.5);
        if (building.antenna) {
          ctx.fillRect(x + bw * 0.5, y - bh * 0.18, 1.5, bh * 0.18);
          ctx.fillStyle = building.hue === 'pink' ? '#ff0077' : '#00f0ff';
          ctx.fillRect(x + bw * 0.5 - 1, y - bh * 0.2, 3.5, 3.5);
        }
        // Sparse windows.
        ctx.fillStyle = accent;
        const columns = Math.max(1, Math.floor(bw / 14));
        const rows = Math.max(1, Math.floor(bh / 18));
        for (let cx = 0; cx < columns; cx += 1) {
          for (let cy = 0; cy < rows; cy += 1) {
            if ((cx * 7 + cy * 11 + building.width) % 5 < 2) {
              ctx.globalAlpha = 0.16;
              ctx.fillRect(x + 5 + cx * 14, y + 7 + cy * 18, 3, 3);
            }
          }
        }
      }
      ctx.restore();

      // Neon ring behind the briefing.
      ctx.save();
      ctx.translate(w * 0.77, h * 0.37);
      ctx.rotate(time * 0.05);
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.16)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, Math.min(w, h) * 0.22, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([5, 15]);
      ctx.strokeStyle = 'rgba(255, 0, 119, 0.22)';
      ctx.beginPath();
      ctx.arc(0, 0, Math.min(w, h) * 0.25, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      // Floating data motes.
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const particle of this.menuParticles) {
        const x = ((particle.x + time * particle.speed) % (1280 + 80)) / 1280 * w;
        const y = particle.y / 720 * h + Math.sin(time * 0.7 + particle.phase) * 8;
        ctx.globalAlpha = 0.2 + Math.sin(time + particle.phase) * 0.12;
        ctx.fillStyle = particle.phase % 2 > 1 ? '#00f0ff' : '#ff0077';
        ctx.beginPath();
        ctx.arc(x, y, particle.size, 0, TAU);
        ctx.fill();
      }
      ctx.restore();

      // Bottom fade for UI legibility.
      const fade = ctx.createLinearGradient(0, h * 0.55, 0, h);
      fade.addColorStop(0, 'rgba(4, 6, 13, 0)');
      fade.addColorStop(1, 'rgba(4, 6, 13, 0.82)');
      ctx.fillStyle = fade;
      ctx.fillRect(0, h * 0.5, w, h * 0.5);
    }

    // -----------------------------------------------------------------------
    // Map
    // -----------------------------------------------------------------------

    drawMap() {
      const ctx = this.ctx;
      const map = this.game.map;
      const theme = map.theme;

      const bg = ctx.createLinearGradient(0, 0, NF.WORLD.width, NF.WORLD.height);
      bg.addColorStop(0, theme.bg);
      bg.addColorStop(0.55, theme.bg2);
      bg.addColorStop(1, theme.bg);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, NF.WORLD.width, NF.WORLD.height);

      this.drawGrid(theme);
      this.drawDecor(map);

      // Ambient glows.
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const glow = ctx.createRadialGradient(1120, 500, 10, 1120, 500, 250);
      glow.addColorStop(0, `${theme.accent}18`);
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(860, 240, 520, 520);
      const glow2 = ctx.createRadialGradient(180, 160, 10, 180, 160, 300);
      glow2.addColorStop(0, `${theme.accent2}12`);
      glow2.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow2;
      ctx.fillRect(0, 0, 520, 460);
      ctx.restore();

      this.drawPath(map);
      this.drawCore(map);
    }

    drawGrid(theme) {
      const ctx = this.ctx;
      ctx.save();
      ctx.strokeStyle = theme.grid;
      ctx.lineWidth = 1;
      const offset = (this.time * 8) % 40;
      for (let x = -40 + offset; x < NF.WORLD.width + 40; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, NF.WORLD.height);
        ctx.stroke();
      }
      for (let y = -40 + offset; y < NF.WORLD.height + 40; y += 40) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(NF.WORLD.width, y);
        ctx.stroke();
      }
      ctx.globalAlpha = 0.4;
      ctx.strokeStyle = theme.accent;
      for (let x = 0; x < NF.WORLD.width; x += 200) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, 14);
        ctx.stroke();
      }
      ctx.restore();
    }

    drawDecor(map) {
      const ctx = this.ctx;
      const theme = map.theme;
      const decor = this.getDecor(map);
      ctx.save();
      for (const item of decor) {
        if (item.type === 'building') {
          ctx.globalAlpha = 0.52;
          ctx.fillStyle = item.hue === 0 ? '#07111f' : '#0b0b1a';
          ctx.fillRect(item.x, item.y, item.width, item.height);
          ctx.globalAlpha = 0.28;
          ctx.strokeStyle = item.hue === 0 ? theme.accent : theme.accent2;
          ctx.lineWidth = 1;
          ctx.strokeRect(item.x + 0.5, item.y + 0.5, item.width, item.height);
          ctx.globalAlpha = 0.2;
          ctx.fillStyle = item.hue === 0 ? theme.accent : theme.accent2;
          ctx.fillRect(item.x, item.y, item.width, 1);
          if (item.antenna) {
            ctx.globalAlpha = 0.36;
            ctx.fillRect(item.x + item.width * 0.5, item.y - 16, 1.2, 16);
            ctx.fillStyle = theme.accent2;
            ctx.fillRect(item.x + item.width * 0.5 - 1, item.y - 18, 3, 3);
          }
          ctx.globalAlpha = 0.12;
          for (let wx = 6; wx < item.width - 4; wx += 12) {
            for (let wy = 8; wy < item.height - 4; wy += 16) {
              if ((wx * 3 + wy + item.width) % 7 < 2) ctx.fillRect(item.x + wx, item.y + wy, 2.5, 2.5);
            }
          }
        } else if (item.type === 'tank' || item.type === 'pipe') {
          ctx.globalAlpha = 0.42;
          ctx.fillStyle = '#130d08';
          ctx.strokeStyle = item.hue === 0 ? theme.accent : theme.accent2;
          ctx.lineWidth = 1;
          if (item.type === 'tank') {
            roundRectPath(ctx, item.x, item.y, item.width, item.height, 10);
            ctx.fill();
            ctx.stroke();
            ctx.globalAlpha = 0.18;
            ctx.fillRect(item.x + 8, item.y + 8, item.width - 16, 3);
          } else {
            ctx.fillRect(item.x, item.y, item.width, 8);
            ctx.strokeRect(item.x, item.y, item.width, 8);
            ctx.fillRect(item.x + item.width * 0.2, item.y, 5, item.height);
            ctx.strokeRect(item.x + item.width * 0.2, item.y, 5, item.height);
          }
        } else if (item.type === 'ring' || item.type === 'panel') {
          ctx.globalAlpha = 0.34;
          ctx.strokeStyle = item.hue === 0 ? theme.accent : theme.accent2;
          ctx.lineWidth = 1;
          if (item.type === 'ring') {
            ctx.beginPath();
            ctx.ellipse(item.x, item.y, item.width * 0.5, item.height * 0.35, item.rotation, 0, TAU);
            ctx.stroke();
          } else {
            ctx.strokeRect(item.x, item.y, item.width, item.height);
            ctx.globalAlpha = 0.12;
            ctx.fillStyle = theme.accent;
            ctx.fillRect(item.x + 4, item.y + 4, item.width - 8, item.height - 8);
          }
        }
      }
      ctx.restore();
    }

    drawPath(map) {
      const ctx = this.ctx;
      const theme = map.theme;
      const path = map.path;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Wide soft edge.
      ctx.globalAlpha = 0.20;
      ctx.strokeStyle = theme.pathEdge;
      ctx.lineWidth = 76;
      ctx.beginPath();
      ctx.moveTo(path[0].x, path[0].y);
      for (let i = 1; i < path.length; i += 1) ctx.lineTo(path[i].x, path[i].y);
      ctx.stroke();

      // Dark road.
      ctx.globalAlpha = 0.96;
      ctx.strokeStyle = theme.path;
      ctx.lineWidth = NF.BUILD.pathWidth;
      ctx.beginPath();
      ctx.moveTo(path[0].x, path[0].y);
      for (let i = 1; i < path.length; i += 1) ctx.lineTo(path[i].x, path[i].y);
      ctx.stroke();

      // Neon edges.
      ctx.globalAlpha = 0.62;
      ctx.strokeStyle = theme.pathEdge;
      ctx.lineWidth = 2;
      ctx.shadowColor = theme.pathEdge;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(path[0].x, path[0].y);
      for (let i = 1; i < path.length; i += 1) ctx.lineTo(path[i].x, path[i].y);
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Animated center lane.
      ctx.globalAlpha = 0.72;
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([14, 18]);
      ctx.lineDashOffset = -this.time * 32;
      ctx.beginPath();
      ctx.moveTo(path[0].x, path[0].y);
      for (let i = 1; i < path.length; i += 1) ctx.lineTo(path[i].x, path[i].y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Direction chevrons.
      ctx.globalAlpha = 0.36;
      ctx.fillStyle = theme.accent;
      for (let i = 1; i < path.length; i += 1) {
        const a = path[i - 1];
        const b = path[i];
        const distance = NF.dist(a.x, a.y, b.x, b.y);
        const steps = Math.max(1, Math.floor(distance / 120));
        for (let step = 1; step <= steps; step += 1) {
          const t = step / (steps + 1);
          const x = NF.lerp(a.x, b.x, t);
          const y = NF.lerp(a.y, b.y, t);
          const angle = Math.atan2(b.y - a.y, b.x - a.x);
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(angle);
          ctx.beginPath();
          ctx.moveTo(6, 0);
          ctx.lineTo(-3, 4);
          ctx.lineTo(-3, -4);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      }
      ctx.restore();
    }

    drawCore(map) {
      const ctx = this.ctx;
      const core = map.core;
      const game = this.game;
      const ratio = game.coreRatio;
      const color = ratio > 0.6 ? '#00f0ff' : ratio > 0.3 ? '#ffe600' : '#ff0077';
      const pulse = 1 + Math.sin(this.time * 4) * 0.06;

      ctx.save();
      ctx.translate(core.x, core.y);
      ctx.globalCompositeOperation = 'lighter';
      const halo = ctx.createRadialGradient(0, 0, 8, 0, 0, 90);
      halo.addColorStop(0, `${color}66`);
      halo.addColorStop(0.4, `${color}22`);
      halo.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(0, 0, 90, 0, TAU);
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.translate(core.x, core.y);

      // Shield bubble.
      if (game.coreShield > 0) {
        ctx.save();
        ctx.globalAlpha = 0.32 + Math.sin(this.time * 5) * 0.08;
        ctx.strokeStyle = '#b26bff';
        ctx.lineWidth = 2;
        ctx.shadowColor = '#b26bff';
        ctx.shadowBlur = 16;
        ctx.beginPath();
        ctx.arc(0, 0, 62 + Math.sin(this.time * 3) * 2, 0, TAU);
        ctx.stroke();
        ctx.restore();
      }

      ctx.rotate(this.time * 0.18);
      ctx.strokeStyle = `${color}88`;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 10]);
      ctx.beginPath();
      ctx.arc(0, 0, 46, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = `${color}44`;
      ctx.beginPath();
      ctx.arc(0, 0, 56, 0, TAU);
      ctx.stroke();
      ctx.rotate(-this.time * 0.42);
      for (let i = 0; i < 6; i += 1) {
        const angle = (i / 6) * TAU;
        ctx.fillStyle = i % 2 === 0 ? color : '#ff0077';
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.arc(Math.cos(angle) * 52, Math.sin(angle) * 52, 2.5, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.rotate(this.time * 0.24);

      // Damaged cracks.
      if (ratio < 0.7) {
        ctx.strokeStyle = `rgba(255, 0, 119, ${0.2 + (1 - ratio) * 0.4})`;
        ctx.lineWidth = 1;
        for (let i = 0; i < 5; i += 1) {
          const angle = i * 1.7 + 0.3;
          ctx.beginPath();
          ctx.moveTo(Math.cos(angle) * 12, Math.sin(angle) * 12);
          ctx.lineTo(Math.cos(angle + 0.18) * 24, Math.sin(angle + 0.18) * 24);
          ctx.lineTo(Math.cos(angle - 0.1) * 34, Math.sin(angle - 0.1) * 34);
          ctx.stroke();
        }
      }

      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 28;
      ctx.beginPath();
      ctx.arc(0, 0, 18 * pulse, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(0, 0, 7 * pulse, 0, TAU);
      ctx.fill();
      ctx.restore();

      // Core label.
      ctx.save();
      ctx.translate(core.x, core.y + 76);
      ctx.textAlign = 'center';
      ctx.font = '700 8px Orbitron, sans-serif';
      ctx.fillStyle = 'rgba(0, 240, 255, 0.7)';
      ctx.fillText('ENERGIEKERN', 0, 0);
      ctx.restore();
    }

    // -----------------------------------------------------------------------
    // Towers
    // -----------------------------------------------------------------------

    drawTowers() {
      for (const tower of this.game.towers) this.drawTower(tower);
    }

    towerPalette(tower) {
      const def = tower.def;
      const skin = NF.SKINS.find((entry) => entry.id === this.game.profile.selectedSkin) || NF.SKINS[0];
      const spec = tower.spec ? def.specs[tower.spec] : null;
      return {
        main: spec ? spec.color : def.color,
        secondary: def.color2,
        skinA: skin.a,
        skinB: skin.b,
        spec
      };
    }

    drawTower(tower) {
      const ctx = this.ctx;
      const game = this.game;
      const palette = this.towerPalette(tower);
      const selected = game.selectedTower === tower;
      const disabled = tower.disabledTimer > 0;
      const color = disabled ? '#6b7280' : palette.main;

      if (selected) {
        const stats = game.getTowerStats(tower);
        ctx.save();
        ctx.globalAlpha = 0.20;
        ctx.fillStyle = palette.main;
        ctx.beginPath();
        ctx.arc(tower.x, tower.y, stats.range, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 0.68;
        ctx.strokeStyle = palette.main;
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 8]);
        ctx.beginPath();
        ctx.arc(tower.x, tower.y, stats.range, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }

      ctx.save();
      ctx.translate(tower.x, tower.y);

      // Base glow.
      ctx.globalCompositeOperation = 'lighter';
      const baseGlow = ctx.createRadialGradient(0, 0, 4, 0, 0, 42);
      baseGlow.addColorStop(0, `${color}33`);
      baseGlow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = baseGlow;
      ctx.beginPath();
      ctx.arc(0, 0, 42, 0, TAU);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';

      // Rotating platform.
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = 'rgba(4, 9, 18, 0.92)';
      hexPath(ctx, 0, 0, 25, Math.PI / 6);
      ctx.fill();
      ctx.strokeStyle = `${color}99`;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = palette.skinA;
      hexPath(ctx, 0, 0, 19, tower.rotation);
      ctx.stroke();

      // Overcharge aura.
      if (game.overchargeTimer > 0) {
        ctx.globalAlpha = 0.28 + Math.sin(this.time * 12) * 0.08;
        ctx.strokeStyle = '#ffe600';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, 31, 0, TAU);
        ctx.stroke();
      }

      // Level pips.
      for (let i = 0; i < 5; i += 1) {
        ctx.globalAlpha = i < tower.level ? 0.9 : 0.18;
        ctx.fillStyle = i < tower.level ? palette.main : '#64748b';
        const angle = -Math.PI / 2 + i * 0.45;
        ctx.fillRect(Math.cos(angle) * 30 - 1.5, Math.sin(angle) * 30 - 1.5, 3, 3);
      }

      if (disabled) {
        ctx.globalAlpha = 0.45 + Math.sin(this.time * 20) * 0.2;
        ctx.strokeStyle = '#ff0077';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(0, 0, 29, 0, TAU);
        ctx.stroke();
      }

      ctx.save();
      ctx.rotate(tower.angle);

      if (tower.typeId === 'pulse') {
        ctx.fillStyle = '#0a1726';
        roundRectPath(ctx, -5, -7, 25, 14, 3);
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.9;
        ctx.fillRect(13, -3, 14, 6);
        ctx.globalAlpha = 0.5;
        ctx.fillRect(26, -1, 7, 2);
        ctx.fillStyle = '#0a1726';
        ctx.fillRect(-9, -11, 7, 22);
        ctx.strokeStyle = `${color}88`;
        ctx.strokeRect(-9, -11, 7, 22);
      } else if (tower.typeId === 'cryo') {
        ctx.fillStyle = '#081725';
        ctx.beginPath();
        ctx.moveTo(0, -10);
        ctx.lineTo(16, 0);
        ctx.lineTo(0, 10);
        ctx.lineTo(-12, 0);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.75;
        ctx.beginPath();
        ctx.moveTo(15, 0);
        ctx.lineTo(28, -4);
        ctx.lineTo(28, 4);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(-4, -7);
        ctx.lineTo(3, 0);
        ctx.lineTo(-4, 7);
        ctx.stroke();
      } else if (tower.typeId === 'plasma') {
        ctx.fillStyle = '#170a12';
        ctx.beginPath();
        ctx.arc(0, 0, 13, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.arc(6, 0, 7, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = '#ff9d3c';
        ctx.beginPath();
        ctx.ellipse(0, 0, 18, 7, this.time * 1.5, 0, TAU);
        ctx.stroke();
      } else if (tower.typeId === 'hunter') {
        ctx.fillStyle = '#15110a';
        roundRectPath(ctx, -11, -12, 30, 24, 4);
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = '#0a0f18';
        ctx.fillRect(2, -9, 16, 7);
        ctx.fillRect(2, 2, 16, 7);
        ctx.strokeStyle = `${color}aa`;
        ctx.strokeRect(2, -9, 16, 7);
        ctx.strokeRect(2, 2, 16, 7);
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.9;
        ctx.fillRect(17, -7, 5, 3);
        ctx.fillRect(17, 4, 5, 3);
      } else if (tower.typeId === 'arc') {
        ctx.fillStyle = '#100b1e';
        ctx.beginPath();
        ctx.arc(0, 0, 11, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.strokeStyle = `${color}aa`;
        ctx.lineWidth = 1;
        for (let i = 0; i < 3; i += 1) {
          const angle = this.time * 3 + i * (TAU / 3);
          ctx.beginPath();
          ctx.moveTo(Math.cos(angle) * 8, Math.sin(angle) * 8);
          ctx.lineTo(Math.cos(angle) * 21, Math.sin(angle) * 21);
          ctx.stroke();
        }
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.arc(0, 0, 4, 0, TAU);
        ctx.fill();
      }

      // Muzzle flash.
      if (tower.fireFlash > 0) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = tower.fireFlash / 0.10;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(tower.typeId === 'arc' ? 18 : 30, 0, 7, 0, TAU);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.restore();

      // Spec indicator.
      if (palette.spec) {
        ctx.globalAlpha = 0.8;
        ctx.strokeStyle = palette.spec.color;
        ctx.lineWidth = 1.2;
        ctx.setLineDash([3, 5]);
        ctx.beginPath();
        ctx.arc(0, 0, 33, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.restore();
    }

    // -----------------------------------------------------------------------
    // Enemies
    // -----------------------------------------------------------------------

    drawEnemies() {
      const enemies = [...this.game.enemies].sort((a, b) => a.y - b.y);
      for (const enemy of enemies) this.drawEnemy(enemy);
    }

    drawEnemy(enemy) {
      const ctx = this.ctx;
      const isBoss = enemy.isBoss;
      const alpha = enemy.cloakActive && !isBoss ? 0.26 : 1;
      const pulse = 1 + Math.sin(this.time * 6 + enemy.laneSeed) * 0.05;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(enemy.x, enemy.y);

      // Shadow.
      ctx.fillStyle = 'rgba(0, 0, 0, 0.34)';
      ctx.beginPath();
      ctx.ellipse(0, enemy.radius * 0.85, enemy.radius * 0.9, enemy.radius * 0.32, 0, 0, TAU);
      ctx.fill();

      if (isBoss) {
        ctx.globalCompositeOperation = 'lighter';
        const aura = ctx.createRadialGradient(0, 0, 4, 0, 0, enemy.radius * 2.1);
        aura.addColorStop(0, `${enemy.color}33`);
        aura.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = aura;
        ctx.beginPath();
        ctx.arc(0, 0, enemy.radius * 2.1, 0, TAU);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      }

      if (enemy.stunTimer > 0) {
        ctx.globalAlpha = 0.45;
        ctx.strokeStyle = '#ffe600';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.arc(0, 0, enemy.radius + 7, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = alpha;
      }

      if (enemy.shield > 0) {
        ctx.save();
        ctx.globalAlpha = 0.25 + (enemy.shield / Math.max(1, enemy.shieldMax)) * 0.22;
        ctx.strokeStyle = '#b26bff';
        ctx.lineWidth = 1.5;
        ctx.shadowColor = '#b26bff';
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(0, 0, enemy.radius + 6, 0, TAU);
        ctx.stroke();
        ctx.restore();
      }

      ctx.fillStyle = enemy.color;
      ctx.strokeStyle = enemy.color2;
      ctx.lineWidth = 1.5;
      ctx.shadowColor = enemy.color;
      ctx.shadowBlur = isBoss ? 22 : 8;

      switch (enemy.shape) {
        case 'scout':
          ctx.beginPath();
          ctx.moveTo(enemy.radius * 1.1, 0);
          ctx.lineTo(-enemy.radius * 0.6, enemy.radius * 0.7);
          ctx.lineTo(-enemy.radius * 0.25, 0);
          ctx.lineTo(-enemy.radius * 0.6, -enemy.radius * 0.7);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(0, 0, 2.4, 0, TAU);
          ctx.fill();
          break;
        case 'assault':
          hexPath(ctx, 0, 0, enemy.radius * pulse, Math.PI / 6);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#0a0f18';
          hexPath(ctx, 0, 0, enemy.radius * 0.52, Math.PI / 6);
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(-2, -2, 4, 4);
          break;
        case 'heavy':
          ctx.beginPath();
          for (let i = 0; i < 8; i += 1) {
            const angle = (i / 8) * TAU;
            const radius = i % 2 === 0 ? enemy.radius * 1.1 : enemy.radius * 0.84;
            const px = Math.cos(angle) * radius;
            const py = Math.sin(angle) * radius;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#2a1608';
          ctx.fillRect(-enemy.radius * 0.45, -enemy.radius * 0.3, enemy.radius * 0.9, enemy.radius * 0.6);
          ctx.fillStyle = enemy.color;
          ctx.fillRect(-enemy.radius * 0.25, -enemy.radius * 0.1, enemy.radius * 0.5, enemy.radius * 0.2);
          break;
        case 'shield':
          ctx.beginPath();
          ctx.moveTo(0, -enemy.radius * 1.2);
          ctx.lineTo(enemy.radius, 0);
          ctx.lineTo(0, enemy.radius * 1.2);
          ctx.lineTo(-enemy.radius, 0);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#e9e3ff';
          ctx.beginPath();
          ctx.arc(0, 0, enemy.radius * 0.3, 0, TAU);
          ctx.fill();
          break;
        case 'phantom':
          ctx.beginPath();
          ctx.moveTo(0, -enemy.radius * 1.2);
          ctx.lineTo(enemy.radius * 0.9, enemy.radius * 0.5);
          ctx.lineTo(0, enemy.radius * 0.2);
          ctx.lineTo(-enemy.radius * 0.9, enemy.radius * 0.5);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.globalAlpha = alpha * 0.5;
          ctx.strokeStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(0, 0, enemy.radius * 0.7, 0, TAU);
          ctx.stroke();
          break;
        case 'repair':
          roundRectPath(ctx, -enemy.radius, -enemy.radius, enemy.radius * 2, enemy.radius * 2, 5);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#06140b';
          ctx.fillRect(-enemy.radius * 0.2, -enemy.radius * 0.65, enemy.radius * 0.4, enemy.radius * 1.3);
          ctx.fillRect(-enemy.radius * 0.65, -enemy.radius * 0.2, enemy.radius * 1.3, enemy.radius * 0.4);
          break;
        case 'swarm':
          ctx.beginPath();
          ctx.arc(0, 0, enemy.radius * pulse, 0, TAU);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#0d0c05';
          ctx.beginPath();
          ctx.arc(-2, 0, 1.8, 0, TAU);
          ctx.fill();
          break;
        case 'elite':
          ctx.beginPath();
          for (let i = 0; i < 10; i += 1) {
            const angle = (i / 10) * TAU;
            const radius = i % 2 === 0 ? enemy.radius * 1.1 : enemy.radius * 0.75;
            const px = Math.cos(angle) * radius;
            const py = Math.sin(angle) * radius;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#1a0612';
          hexPath(ctx, 0, 0, enemy.radius * 0.45, Math.PI / 6);
          ctx.fill();
          break;
        case 'titan':
          this.drawTitan(ctx, enemy);
          break;
        case 'void':
          this.drawVoidDestroyer(ctx, enemy);
          break;
        case 'omega':
          this.drawOmega(ctx, enemy);
          break;
        default:
          ctx.beginPath();
          ctx.arc(0, 0, enemy.radius, 0, TAU);
          ctx.fill();
          ctx.stroke();
      }

      ctx.shadowBlur = 0;
      ctx.globalAlpha = alpha;

      if (enemy.hitFlash > 0) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = enemy.hitFlash / 0.12 * 0.5;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(0, 0, enemy.radius * 1.05, 0, TAU);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      }

      if (enemy.repairPulse > 0) {
        ctx.globalAlpha = enemy.repairPulse / 0.35 * 0.4;
        ctx.strokeStyle = '#00ff66';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(0, 0, enemy.radius + 14 + (1 - enemy.repairPulse / 0.35) * 20, 0, TAU);
        ctx.stroke();
      }

      ctx.restore();

      this.drawEnemyHealth(enemy);
    }

    drawTitan(ctx, enemy) {
      const r = enemy.radius;
      ctx.fillStyle = '#2b1a08';
      ctx.strokeStyle = enemy.color;
      ctx.lineWidth = 2;
      roundRectPath(ctx, -r * 0.85, -r * 0.7, r * 1.7, r * 1.4, 8);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = enemy.color;
      ctx.fillRect(-r * 0.65, -r * 0.45, r * 0.3, r * 0.9);
      ctx.fillRect(r * 0.35, -r * 0.45, r * 0.3, r * 0.9);
      ctx.fillStyle = '#0a0f18';
      ctx.fillRect(-r * 0.38, -r * 0.25, r * 0.76, r * 0.5);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-r * 0.14, -r * 0.1, r * 0.28, r * 0.2);
      ctx.strokeStyle = enemy.color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-r * 0.8, -r * 0.55);
      ctx.lineTo(-r * 1.1, -r * 0.9);
      ctx.moveTo(r * 0.8, -r * 0.55);
      ctx.lineTo(r * 1.1, -r * 0.9);
      ctx.stroke();
    }

    drawVoidDestroyer(ctx, enemy) {
      const r = enemy.radius;
      ctx.fillStyle = '#180d2a';
      ctx.strokeStyle = enemy.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(r * 1.25, 0);
      ctx.lineTo(r * 0.2, -r * 0.65);
      ctx.lineTo(-r * 1.1, -r * 0.35);
      ctx.lineTo(-r * 0.65, 0);
      ctx.lineTo(-r * 1.1, r * 0.35);
      ctx.lineTo(r * 0.2, r * 0.65);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = enemy.color2;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.3, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.48, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = enemy.color;
      ctx.fillRect(-r * 0.9, -r * 0.12, r * 0.5, r * 0.24);
    }

    drawOmega(ctx, enemy) {
      const r = enemy.radius;
      ctx.fillStyle = '#1a0515';
      ctx.strokeStyle = enemy.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < 12; i += 1) {
        const angle = (i / 12) * TAU + this.time * 0.2;
        const radius = i % 2 === 0 ? r * 1.05 : r * 0.75;
        const px = Math.cos(angle) * radius;
        const py = Math.sin(angle) * radius;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = enemy.color2;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.55, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.22, 0, TAU);
      ctx.fill();
      for (let i = 0; i < 3; i += 1) {
        const angle = this.time * 0.8 + i * (TAU / 3);
        ctx.fillStyle = enemy.color;
        ctx.beginPath();
        ctx.arc(Math.cos(angle) * r * 0.72, Math.sin(angle) * r * 0.72, 3.5, 0, TAU);
        ctx.fill();
      }
    }

    drawEnemyHealth(enemy) {
      if (enemy.isBoss) return;
      const ctx = this.ctx;
      const width = Math.max(24, enemy.radius * 2.2);
      const x = enemy.x - width / 2;
      const y = enemy.y - enemy.radius - 11;
      ctx.save();
      ctx.globalAlpha = enemy.cloakActive ? 0.35 : 0.9;
      ctx.fillStyle = 'rgba(2, 5, 10, 0.75)';
      ctx.fillRect(x - 1, y - 1, width + 2, 5);
      ctx.fillStyle = enemy.hp / enemy.maxHp > 0.35 ? '#00ff66' : '#ff0077';
      ctx.fillRect(x, y, width * enemy.healthRatio, 3);
      if (enemy.shieldMax > 0) {
        ctx.fillStyle = 'rgba(178, 107, 255, 0.85)';
        ctx.fillRect(x, y - 3, width * enemy.shieldRatio, 2);
      }
      ctx.restore();
    }

    // -----------------------------------------------------------------------
    // Projectiles / effects / particles / text
    // -----------------------------------------------------------------------

    drawProjectiles() {
      const ctx = this.ctx;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const projectile of this.game.projectiles) {
        // Trail.
        for (let i = 0; i < projectile.trail.length; i += 1) {
          const point = projectile.trail[i];
          ctx.globalAlpha = (point.life / 0.28) * 0.35;
          ctx.fillStyle = projectile.color;
          ctx.beginPath();
          ctx.arc(point.x, point.y, projectile.radius * (i / projectile.trail.length), 0, TAU);
          ctx.fill();
        }

        ctx.globalAlpha = 1;
        ctx.translate(projectile.x, projectile.y);
        ctx.rotate(projectile.angle);
        if (projectile.type === 'pulse') {
          ctx.fillStyle = projectile.color;
          ctx.fillRect(-5, -1.5, 12, 3);
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(2, -1, 4, 2);
        } else if (projectile.type === 'cryo') {
          ctx.fillStyle = projectile.color;
          ctx.beginPath();
          ctx.moveTo(6, 0);
          ctx.lineTo(-3, 4);
          ctx.lineTo(-6, 0);
          ctx.lineTo(-3, -4);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(0, 0, 2, 0, TAU);
          ctx.fill();
        } else if (projectile.type === 'plasma') {
          ctx.fillStyle = projectile.color;
          ctx.beginPath();
          ctx.arc(0, 0, 6, 0, TAU);
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(0, 0, 2.5, 0, TAU);
          ctx.fill();
        } else if (projectile.type === 'hunter') {
          ctx.fillStyle = '#d7dce8';
          ctx.fillRect(-8, -2, 14, 4);
          ctx.fillStyle = projectile.color;
          ctx.beginPath();
          ctx.moveTo(6, 0);
          ctx.lineTo(-2, 3);
          ctx.lineTo(-2, -3);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(-7, 0, 2.5, 0, TAU);
          ctx.fill();
        }
        ctx.rotate(-projectile.angle);
        ctx.translate(-projectile.x, -projectile.y);
      }
      ctx.restore();
    }

    drawEffects() {
      const ctx = this.ctx;
      ctx.save();
      for (const effect of this.game.effects) {
        const progress = 1 - effect.life / effect.maxLife;
        const alpha = NF.clamp(effect.life / effect.maxLife, 0, 1);
        ctx.globalAlpha = alpha;

        if (effect.type === 'lightning' && effect.segments) {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.strokeStyle = effect.color;
          ctx.lineWidth = 2.2;
          ctx.shadowColor = effect.color;
          ctx.shadowBlur = 12;
          ctx.beginPath();
          for (const segment of effect.segments) {
            ctx.moveTo(segment.x1, segment.y1);
            ctx.lineTo(segment.x2, segment.y2);
          }
          ctx.stroke();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 0.8;
          ctx.stroke();
          ctx.restore();
        } else if (effect.type === 'repair-beam' && effect.segments) {
          ctx.save();
          ctx.strokeStyle = effect.color;
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          for (const segment of effect.segments) {
            ctx.moveTo(segment.x1, segment.y1);
            ctx.lineTo(segment.x2, segment.y2);
          }
          ctx.stroke();
          ctx.restore();
        } else if (effect.type === 'orbital-warning') {
          ctx.strokeStyle = effect.color;
          ctx.lineWidth = 1.5;
          ctx.setLineDash([7, 8]);
          ctx.lineDashOffset = -this.time * 24;
          ctx.beginPath();
          ctx.arc(effect.x, effect.y, effect.radius, 0, TAU);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = alpha * 0.12;
          ctx.fillStyle = effect.color;
          ctx.beginPath();
          ctx.arc(effect.x, effect.y, effect.radius, 0, TAU);
          ctx.fill();
        } else if (effect.type === 'orbital-beam') {
          const gradient = ctx.createLinearGradient(effect.x, 0, effect.x, NF.WORLD.height);
          gradient.addColorStop(0, 'rgba(0, 240, 255, 0)');
          gradient.addColorStop(0.3, 'rgba(0, 240, 255, 0.75)');
          gradient.addColorStop(1, 'rgba(0, 240, 255, 0)');
          ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = gradient;
          ctx.fillRect(effect.x - effect.radius * 0.22, 0, effect.radius * 0.44, NF.WORLD.height);
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(effect.x - 4, 0, 8, NF.WORLD.height);
          ctx.globalCompositeOperation = 'source-over';
        } else if (effect.type === 'emp') {
          ctx.strokeStyle = effect.color;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(effect.x, effect.y, effect.radius * progress, 0, TAU);
          ctx.stroke();
          ctx.globalAlpha = alpha * 0.3;
          ctx.fillStyle = effect.color;
          ctx.beginPath();
          ctx.arc(effect.x, effect.y, effect.radius * progress, 0, TAU);
          ctx.fill();
        } else if (effect.type === 'explosion' || effect.type === 'boss-explosion') {
          const radius = effect.radius * (0.4 + progress * 0.8);
          ctx.globalCompositeOperation = 'lighter';
          ctx.strokeStyle = effect.color;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(effect.x, effect.y, radius, 0, TAU);
          ctx.stroke();
          ctx.globalAlpha = alpha * 0.25;
          ctx.fillStyle = effect.color;
          ctx.beginPath();
          ctx.arc(effect.x, effect.y, radius, 0, TAU);
          ctx.fill();
          if (effect.color2) {
            ctx.strokeStyle = effect.color2;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(effect.x, effect.y, radius * 0.7, 0, TAU);
            ctx.stroke();
          }
          ctx.globalCompositeOperation = 'source-over';
        } else if (effect.type === 'seismic' || effect.type === 'omega-pulse' || effect.type === 'omega-rage' || effect.type === 'void-phase' || effect.type === 'boss-phase' || effect.type === 'shield-break' || effect.type === 'leak' || effect.type === 'boss-spawn') {
          ctx.globalCompositeOperation = 'lighter';
          ctx.strokeStyle = effect.color;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(effect.x, effect.y, effect.radius * progress, 0, TAU);
          ctx.stroke();
          ctx.globalAlpha = alpha * 0.18;
          ctx.fillStyle = effect.color;
          ctx.beginPath();
          ctx.arc(effect.x, effect.y, effect.radius * progress, 0, TAU);
          ctx.fill();
          ctx.globalCompositeOperation = 'source-over';
        } else if (effect.type === 'muzzle') {
          ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = effect.color;
          ctx.beginPath();
          ctx.arc(effect.x, effect.y, effect.radius * (1 - progress), 0, TAU);
          ctx.fill();
          ctx.globalCompositeOperation = 'source-over';
        } else if (effect.type === 'impact' || effect.type === 'build' || effect.type === 'upgrade' || effect.type === 'sell' || effect.type === 'spawn' || effect.type === 'repair-core' || effect.type === 'overcharge') {
          ctx.globalCompositeOperation = 'lighter';
          ctx.strokeStyle = effect.color;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(effect.x, effect.y, effect.radius * progress, 0, TAU);
          ctx.stroke();
          ctx.globalAlpha = alpha * 0.2;
          ctx.fillStyle = effect.color;
          ctx.beginPath();
          ctx.arc(effect.x, effect.y, effect.radius * progress, 0, TAU);
          ctx.fill();
          ctx.globalCompositeOperation = 'source-over';
        }
      }
      ctx.restore();
    }

    drawParticles() {
      const ctx = this.ctx;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const particle of this.game.particles) {
        const alpha = NF.clamp(particle.life / particle.maxLife, 0, 1);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = particle.color;
        if (particle.shape === 'square') {
          ctx.fillRect(particle.x - particle.size / 2, particle.y - particle.size / 2, particle.size, particle.size);
        } else {
          ctx.beginPath();
          ctx.arc(particle.x, particle.y, particle.size, 0, TAU);
          ctx.fill();
        }
      }
      ctx.restore();
    }

    drawFloatingTexts() {
      const ctx = this.ctx;
      ctx.save();
      ctx.textAlign = 'center';
      for (const text of this.game.floatingTexts) {
        const alpha = NF.clamp(text.life / text.maxLife, 0, 1);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = text.color;
        ctx.font = `${text.bold ? '700' : '500'} ${text.size}px Orbitron, sans-serif`;
        ctx.shadowColor = text.color;
        ctx.shadowBlur = 8;
        ctx.fillText(text.text, text.x, text.y);
      }
      ctx.restore();
    }

    // -----------------------------------------------------------------------
    // Placement / foreground
    // -----------------------------------------------------------------------

    drawPlacementLayer() {
      const game = this.game;
      const ctx = this.ctx;
      if (game.selectedTowerType) {
        const def = NF.TOWER_DEFS[game.selectedTowerType];
        const x = game.hoverWorld.x;
        const y = game.hoverWorld.y;
        const check = game.getPlacementCheck(x, y, def.id);
        const valid = check.ok;
        const previewColor = valid ? def.color : '#ff0077';
        ctx.save();
        ctx.globalAlpha = 0.55;
        ctx.strokeStyle = previewColor;
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 7]);
        ctx.beginPath();
        ctx.arc(x, y, def.base.range, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 0.16;
        ctx.fillStyle = previewColor;
        ctx.beginPath();
        ctx.arc(x, y, def.base.range, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 0.85;
        ctx.strokeStyle = valid ? '#00ff66' : '#ff0077';
        ctx.lineWidth = 2;
        hexPath(ctx, x, y, 29, Math.PI / 6);
        ctx.stroke();
        if (!valid) {
          ctx.globalAlpha = 0.9;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(x - 8, y - 8);
          ctx.lineTo(x + 8, y + 8);
          ctx.moveTo(x + 8, y - 8);
          ctx.lineTo(x - 8, y + 8);
          ctx.stroke();
        }
        ctx.restore();
      }

      if (game.pendingAbility) {
        const ability = NF.ABILITY_MAP[game.pendingAbility];
        if (ability) {
          ctx.save();
          ctx.globalAlpha = 0.6;
          ctx.strokeStyle = ability.color;
          ctx.lineWidth = 1.5;
          ctx.setLineDash([7, 8]);
          ctx.beginPath();
          ctx.arc(game.hoverWorld.x, game.hoverWorld.y, ability.radius, 0, TAU);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = 0.12;
          ctx.fillStyle = ability.color;
          ctx.beginPath();
          ctx.arc(game.hoverWorld.x, game.hoverWorld.y, ability.radius, 0, TAU);
          ctx.fill();
          ctx.restore();
        }
      }
    }

    drawForeground() {
      const ctx = this.ctx;
      // Subtle edge vignette inside the play field.
      const gradient = ctx.createRadialGradient(NF.WORLD.width / 2, NF.WORLD.height / 2, 240, NF.WORLD.width / 2, NF.WORLD.height / 2, 760);
      gradient.addColorStop(0, 'rgba(0,0,0,0)');
      gradient.addColorStop(1, 'rgba(0,0,0,0.48)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, NF.WORLD.width, NF.WORLD.height);

      // Boss battle tint.
      if (this.game.bossEnemy) {
        ctx.globalAlpha = 0.04 + Math.sin(this.time * 2) * 0.015;
        ctx.fillStyle = '#ff0077';
        ctx.fillRect(0, 0, NF.WORLD.width, NF.WORLD.height);
      }
    }
  }

  NF.Renderer = Renderer;
})();
