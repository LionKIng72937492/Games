/* ==========================================================================
   NEON FRONTIER — boot, input and animation loop
   Keeps the game loop independent from UI rendering and exposes a small debug
   surface for local verification. Everything is local; no network calls.
   ========================================================================== */

(() => {
  'use strict';

  const NF = window.NF = window.NF || {};

  function boot() {
    const canvas = document.getElementById('nf-canvas');
    if (!canvas) return;

    const save = new NF.SaveManager();
    const audio = new NF.AudioEngine(save.profile.settings);
    const game = new NF.Game({ save, audio, profile: save.profile });
    const renderer = new NF.Renderer(canvas, game);
    const ui = new NF.UI({ game, renderer, audio, save });
    game.onEvent = (type, payload) => ui.handleGameEvent(type, payload);

    audio.setVolumes(save.profile.settings);
    ui.showMenu();

    const existingRun = save.loadRun();
    if (existingRun) ui.openResumePrompt(existingRun);

    // -----------------------------------------------------------------------
    // Audio unlock
    // -----------------------------------------------------------------------

    const unlockAudio = () => {
      if (audio.unlocked) return;
      audio.unlock();
      audio.setVolumes(save.profile.settings);
      if (audio.unlocked) {
        audio.setMusicMode(game.state === 'menu' ? 'menu' : 'battle');
        audio.startMusic(game.state === 'menu' ? 'menu' : 'battle');
      }
    };
    window.addEventListener('pointerdown', unlockAudio, { passive: true });
    window.addEventListener('keydown', unlockAudio);

    // -----------------------------------------------------------------------
    // Canvas pointer input
    // -----------------------------------------------------------------------

    const modalOpen = () => !document.getElementById('nf-modal-root').classList.contains('nf-hidden');

    const updateHover = (event) => {
      if (game.state !== 'playing') return;
      const world = renderer.screenToWorld(event.clientX, event.clientY);
      game.setHoverWorld(world.x, world.y);
    };

    canvas.addEventListener('pointermove', updateHover, { passive: true });
    canvas.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      unlockAudio();
      if (game.state !== 'playing' || modalOpen()) return;
      const world = renderer.screenToWorld(event.clientX, event.clientY);
      game.setHoverWorld(world.x, world.y);

      if (game.pendingAbility) {
        const result = game.castAbilityAt(world.x, world.y);
        if (!result.ok) {
          ui.toast(result.reason || 'FÄHIGKEIT NICHT BEREIT', 'pink');
          audio.play('error');
        }
        return;
      }

      if (game.selectedTowerType) {
        const result = game.placeTowerAt(world.x, world.y);
        if (!result.ok) {
          ui.toast(result.reason, 'pink');
          audio.play('error');
        }
        return;
      }

      const tower = game.selectTowerAt(world.x, world.y);
      if (!tower) {
        game.selectTower(null);
      }
    });

    canvas.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      if (game.state === 'playing') {
        game.cancelAction();
        audio.play('click');
      }
    });

    // -----------------------------------------------------------------------
    // Keyboard
    // -----------------------------------------------------------------------

    window.addEventListener('keydown', (event) => {
      const target = event.target;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      const key = event.key;

      if (key === 'Escape') {
        event.preventDefault();
        ui.handleEscape();
        return;
      }

      if (key === ' ' || key === 'Spacebar') {
        event.preventDefault();
        if (modalOpen()) {
          ui.closeModal();
        } else if (game.state === 'playing') {
          ui.openPause();
        } else if (game.state === 'paused') {
          game.resume();
        }
        return;
      }

      if (modalOpen()) return;

      if (/^[1-4]$/.test(key)) {
        event.preventDefault();
        if (game.state === 'playing') ui.triggerAbility(Number(key) - 1);
        return;
      }

      if (key === 't' || key === 'T') {
        event.preventDefault();
        if (game.state === 'playing' || game.state === 'paused') ui.openTechnology(true);
        else ui.openTechnology(false);
        return;
      }

      if ((key === 'u' || key === 'U') && game.state === 'playing') {
        event.preventDefault();
        const result = game.upgradeSelectedTower();
        if (!result.ok) {
          ui.toast(result.reason, 'pink');
          audio.play('error');
        }
        ui.renderInspector(true);
      }
    });

    // -----------------------------------------------------------------------
    // Resize / visibility / persistence
    // -----------------------------------------------------------------------

    window.addEventListener('resize', () => renderer.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && game.state === 'playing') {
        game.pause();
        ui.openPause();
      }
    });
    window.addEventListener('beforeunload', () => {
      if (game.state === 'playing' || game.state === 'paused') game.saveRunSnapshot();
      save.saveProfile(save.profile);
    });

    // -----------------------------------------------------------------------
    // Main loop
    // -----------------------------------------------------------------------

    let last = performance.now();
    const frame = (now) => {
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      if (game.state === 'playing') game.update(dt * game.speed);
      renderer.render(dt);
      ui.update(dt);
      window.requestAnimationFrame(frame);
    };
    window.requestAnimationFrame(frame);

    // -----------------------------------------------------------------------
    // Local debug API — useful for verification, harmless for players.
    // -----------------------------------------------------------------------

    window.NeonFrontierDebug = {
      game,
      renderer,
      ui,
      save,
      audio,
      start(mapId = 'neon-city', difficulty = 'normal') {
        ui.startRun(mapId, difficulty);
        return game.getSummary();
      },
      resume() {
        const snapshot = save.loadRun();
        if (!snapshot) return null;
        ui.startRun(snapshot.mapId, snapshot.difficulty, snapshot);
        return game.getSummary();
      },
      addCredits(amount = 1000) {
        game.credits = Math.max(0, game.credits + Number(amount || 0));
        return game.credits;
      },
      setWave(wave = 1) {
        game.wave = Math.max(1, Math.min(NF.FINAL_WAVE, Math.floor(wave)));
        game.waveActive = false;
        game.wavePlan = null;
        game.waveCountdown = 0;
        game.spawnQueue = [];
        game.enemies = [];
        game.projectiles = [];
        game.resolvedInWave = 0;
        game.totalInWave = 0;
        return game.wave;
      },
      startWave() {
        game.startWave();
        return game.getSummary();
      },
      spawn(type = 'assault', count = 1) {
        for (let i = 0; i < count; i += 1) {
          const stats = NF.getEnemyStats(type, game.wave, game.difficulty);
          const enemy = new NF.Enemy(game, stats);
          game.enemies.push(enemy);
        }
        return game.enemies.length;
      },
      boss(type = 'titan') {
        game.spawnBoss(type);
        return game.getBossInfo();
      },
      damageCore(amount = 10) {
        game.damageCore(amount);
        return game.coreHp;
      },
      win() {
        game.endRun(true);
        return game.result;
      },
      lose() {
        game.endRun(false);
        return game.result;
      },
      unlockAll() {
        for (const node of Object.keys(NF.TECH_NODE_MAP)) save.profile.tech[node] = true;
        for (const upgrade of NF.DOCTRINE_UPGRADES) save.profile.doctrine[upgrade.id] = upgrade.max;
        for (const achievement of NF.ACHIEVEMENTS) save.profile.achievements[achievement.id] = true;
        save.profile.research = 500;
        save.profile.doctrinePoints = 20;
        save.saveProfile(save.profile);
        game.recalculateMods();
        ui.updateMenuProfile();
        return save.profile;
      },
      saveRun() {
        game.saveRunSnapshot();
        return save.loadRun();
      },
      state() {
        return {
          game: game.getSummary(),
          towers: game.towers.length,
          enemies: game.enemies.length,
          projectiles: game.projectiles.length,
          modalOpen: modalOpen(),
          screen: ui.currentScreen
        };
      }
    };

    // Friendly console marker; no gameplay impact.
    console.info(`NEON FRONTIER ${NF.VERSION} ready · debug API: NeonFrontierDebug`);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
