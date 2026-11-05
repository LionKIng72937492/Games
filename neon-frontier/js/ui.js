/* ==========================================================================
   NEON FRONTIER — UI controller
   DOM screens, modals, HUD, inspector, tech tree, meta progression and toasts.
   The canvas is the game; this file owns everything around it.
   ========================================================================== */

(() => {
  'use strict';

  const NF = window.NF = window.NF || {};

  const TARGET_LABELS = {
    first: 'ERSTER',
    last: 'LETZTER',
    strongest: 'STÄRKSTER',
    fastest: 'SCHNELLSTER'
  };

  const TOWER_ROLE_LABELS = {
    pulse: 'STANDARD',
    cryo: 'KONTROLLE',
    plasma: 'FLÄCHE',
    hunter: 'HOMING',
    arc: 'KETTE'
  };

  function pct(value, max) {
    return `${NF.clamp((value / Math.max(1, max)) * 100, 0, 100).toFixed(1)}%`;
  }

  class UI {
    constructor({ game, renderer, audio, save }) {
      this.game = game;
      this.renderer = renderer;
      this.audio = audio;
      this.save = save;
      this.profile = save.profile;
      this.dom = {
        menu: document.getElementById('nf-menu'),
        hud: document.getElementById('nf-hud'),
        modalRoot: document.getElementById('nf-modal-root'),
        toastRoot: document.getElementById('nf-toast-root'),
        profileChip: document.getElementById('nf-profile-chip'),
        menuLevel: document.getElementById('nf-menu-level'),
        menuXpBar: document.getElementById('nf-menu-xp-bar'),
        menuXp: document.getElementById('nf-menu-xp'),
        menuDoctrine: document.getElementById('nf-menu-doctrine'),
        menuMapName: document.getElementById('nf-menu-map-name'),
        menuBestWave: document.getElementById('nf-menu-best-wave'),
        menuBosses: document.getElementById('nf-menu-bosses'),
        menuScore: document.getElementById('nf-menu-score'),
        menuLastRun: document.getElementById('nf-menu-last-run'),
        credits: document.getElementById('nf-hud-credits'),
        energy: document.getElementById('nf-hud-energy'),
        energyFill: document.getElementById('nf-hud-energy-fill'),
        research: document.getElementById('nf-hud-research'),
        wave: document.getElementById('nf-hud-wave'),
        waveState: document.getElementById('nf-hud-wave-state'),
        waveFill: document.getElementById('nf-hud-wave-fill'),
        enemies: document.getElementById('nf-hud-enemies'),
        difficulty: document.getElementById('nf-hud-difficulty'),
        coreText: document.getElementById('nf-hud-core-text'),
        coreFill: document.getElementById('nf-hud-core-fill'),
        coreStatus: document.getElementById('nf-hud-core-status'),
        score: document.getElementById('nf-hud-score'),
        bossBar: document.getElementById('nf-boss-bar'),
        bossName: document.getElementById('nf-boss-name'),
        bossPhase: document.getElementById('nf-boss-phase'),
        bossFill: document.getElementById('nf-boss-fill'),
        bossShieldFill: document.getElementById('nf-boss-shield-fill'),
        bossHp: document.getElementById('nf-boss-hp'),
        wavePanel: document.getElementById('nf-wave-panel'),
        waveCountdown: document.getElementById('nf-wave-countdown'),
        wavePanelSub: document.getElementById('nf-wave-panel-sub'),
        nextWave: document.getElementById('nf-btn-next-wave'),
        palette: document.getElementById('nf-tower-palette'),
        inspector: document.getElementById('nf-inspector'),
        abilityBar: document.getElementById('nf-ability-bar'),
        placementHint: document.getElementById('nf-placement-hint'),
        placementText: document.getElementById('nf-placement-text'),
        cancelPlacement: document.getElementById('nf-btn-cancel-placement'),
        pause: document.getElementById('nf-btn-pause'),
        menuButton: document.getElementById('nf-btn-menu'),
        techButton: document.getElementById('nf-btn-tech'),
        speedButtons: [...document.querySelectorAll('.nf-speed-btn')]
      };
      this.modalOnClose = null;
      this.modalResume = false;
      this.setupMap = this.profile.selectedMap;
      this.setupDifficulty = this.profile.selectedDifficulty;
      this.lastInspectorSignature = '';
      this.resultTimeout = null;
      this.currentScreen = 'menu';
      this.bindStaticEvents();
      this.buildPalette();
      this.buildAbilityBar();
      this.updateMenuProfile();
      this.updateHUD();
    }

    // -----------------------------------------------------------------------
    // Static bindings
    // -----------------------------------------------------------------------

    bindStaticEvents() {
      document.querySelectorAll('[data-menu-action]').forEach((button) => {
        button.addEventListener('click', () => {
          this.audio.unlock();
          this.audio.play('click');
          const action = button.dataset.menuAction;
          if (action === 'play' || action === 'maps') this.openSetup();
          else if (action === 'upgrades') this.openUpgrades();
          else if (action === 'technology') this.openTechnology(false);
          else if (action === 'statistics') this.openStatistics();
          else if (action === 'settings') this.openSettings(false);
        });
      });

      this.dom.speedButtons.forEach((button) => {
        button.addEventListener('click', () => {
          this.game.setSpeed(Number(button.dataset.speed));
          this.audio.play('click');
        });
      });

      this.dom.pause.addEventListener('click', () => this.openPause());
      this.dom.menuButton.addEventListener('click', () => this.openPause());
      this.dom.techButton.addEventListener('click', () => this.openTechnology(true));
      this.dom.nextWave.addEventListener('click', () => {
        if (this.game.state !== 'playing' || this.game.waveActive) return;
        this.game.waveCountdown = 0;
        this.game.startWave();
        this.audio.play('click');
      });
      this.dom.cancelPlacement.addEventListener('click', () => {
        this.game.cancelAction();
        this.audio.play('click');
      });

      this.dom.modalRoot.addEventListener('click', (event) => {
        if (event.target === this.dom.modalRoot) this.closeModal();
      });

      this.dom.modalRoot.addEventListener('click', (event) => {
        if (event.target.closest('[data-modal-close]')) this.closeModal();
      });
    }

    buildPalette() {
      const html = ['<div class="nf-palette-title">VERTEIDIGUNG // 5 KLASSEN</div>'];
      for (const id of NF.TOWER_ORDER) {
        const def = NF.TOWER_DEFS[id];
        html.push(`
          <button type="button" class="nf-tower-btn" data-tower="${id}" style="--tower-color:${def.color}" title="${def.name} — ${def.desc}">
            <span class="nf-tower-btn-icon">${def.icon}</span>
            <span>
              <span class="nf-tower-btn-name">${def.name}</span>
              <span class="nf-tower-btn-cost">◈ ${def.cost}</span>
            </span>
          </button>
        `);
      }
      this.dom.palette.innerHTML = html.join('');
      this.dom.palette.querySelectorAll('[data-tower]').forEach((button) => {
        button.addEventListener('click', () => {
          const type = button.dataset.tower;
          if (this.game.credits < NF.TOWER_DEFS[type].cost && this.game.selectedTowerType !== type) {
            this.toast('NICHT GENUG CREDITS', 'pink');
            this.audio.play('error');
            return;
          }
          this.audio.play('click');
          this.game.selectTowerType(type);
        });
      });
    }

    buildAbilityBar() {
      this.dom.abilityBar.innerHTML = NF.ABILITIES.map((ability) => `
        <button type="button" class="nf-ability-btn" data-ability="${ability.id}" style="--ability-color:${ability.color}" title="${ability.name} — ${ability.desc}">
          <span class="nf-ability-key">${ability.key}</span>
          <span class="nf-ability-icon">${ability.icon}</span>
          <span class="nf-ability-name">${ability.short}</span>
          <span class="nf-ability-cost">${ability.cost}</span>
          <span class="nf-ability-cd"></span>
        </button>
      `).join('');
      this.dom.abilityBar.querySelectorAll('[data-ability]').forEach((button) => {
        button.addEventListener('click', () => {
          this.audio.unlock();
          this.audio.play('click');
          const result = this.game.activateAbility(button.dataset.ability);
          if (!result.ok) {
            this.toast(result.reason || 'FÄHIGKEIT NICHT BEREIT', 'pink');
            this.audio.play('error');
          } else if (result.needsTarget) {
            this.toast('ZIELBEREICH AUF DER KARTE WÄHLEN', 'gold');
          }
          this.updateHUD();
        });
      });
    }

    // -----------------------------------------------------------------------
    // Screens and menu
    // -----------------------------------------------------------------------

    showMenu() {
      this.currentScreen = 'menu';
      this.dom.menu.classList.remove('nf-hidden');
      this.dom.hud.classList.add('nf-hidden');
      this.dom.modalRoot.classList.add('nf-hidden');
      this.dom.modalRoot.innerHTML = '';
      this.modalResume = false;
      this.modalOnClose = null;
      this.updateMenuProfile();
      this.audio.setMusicMode('menu');
      this.audio.startMusic('menu');
    }

    showHUD() {
      this.currentScreen = 'game';
      this.dom.menu.classList.add('nf-hidden');
      this.dom.hud.classList.remove('nf-hidden');
      this.renderInspector(true);
      this.updateHUD();
    }

    goToMenu() {
      if (this.resultTimeout) {
        window.clearTimeout(this.resultTimeout);
        this.resultTimeout = null;
      }
      this.game.state = 'menu';
      this.game.selectedTower = null;
      this.game.selectedTowerType = null;
      this.game.pendingAbility = null;
      this.game.enemies = [];
      this.game.projectiles = [];
      this.game.particles = [];
      this.game.effects = [];
      this.game.floatingTexts = [];
      this.showMenu();
    }

    startRun(mapId, difficultyId, snapshot = null) {
      this.audio.unlock();
      this.closeModal({ resume: false, skipCallback: true });
      this.game.startRun(mapId, difficultyId, snapshot);
      this.showHUD();
      this.audio.setMusicMode('battle');
      this.audio.startMusic('battle');
    }

    openResumePrompt(snapshot) {
      if (!snapshot) return;
      const map = NF.getMap(snapshot.mapId);
      const difficulty = NF.DIFFICULTIES[snapshot.difficulty] || NF.DIFFICULTIES.normal;
      const html = `
        <div class="nf-modal is-narrow">
          <div class="nf-modal-head">
            <div>
              <span class="nf-modal-kicker">GESICHERTER EINSATZ</span>
              <h2>LAUF FORTSETZEN?</h2>
              <p>Ein gespeicherter Einsatz wurde gefunden. Du kannst an der letzten Wellengrenze weitermachen.</p>
            </div>
            <button type="button" class="nf-modal-close" data-modal-close aria-label="Schließen">×</button>
          </div>
          <div class="nf-modal-body">
            <div class="nf-result-stats is-three">
              <div><span>KARTE</span><b style="font-size:12px">${map.name}</b></div>
              <div><span>SCHWIERIGKEIT</span><b style="font-size:12px;color:${difficulty.color}">${difficulty.name}</b></div>
              <div><span>WELLE</span><b>${String(snapshot.wave).padStart(2, '0')}</b></div>
              <div><span>CREDITS</span><b>${NF.formatNumber(snapshot.credits || 0)}</b></div>
              <div><span>KERN</span><b>${Math.round(snapshot.coreHp || 0)} / ${Math.round(snapshot.coreMax || 0)}</b></div>
              <div><span>ZEIT</span><b style="font-size:14px">${NF.formatTime(snapshot.time || 0)}</b></div>
            </div>
          </div>
          <div class="nf-modal-footer">
            <button type="button" class="nf-btn nf-btn-danger" data-resume-discard><span><b>VERWERFEN</b><small>Gespeicherten Lauf löschen</small></span></button>
            <button type="button" class="nf-btn nf-btn-primary" data-resume-continue><span><b>FORTSETZEN</b><small>Einsatz wiederherstellen</small></span></button>
          </div>
        </div>
      `;
      this.openModal(html, { resumeOnClose: false });
      this.dom.modalRoot.querySelector('[data-resume-continue]').addEventListener('click', () => {
        this.audio.play('click');
        this.startRun(snapshot.mapId, snapshot.difficulty, snapshot);
      });
      this.dom.modalRoot.querySelector('[data-resume-discard]').addEventListener('click', () => {
        this.audio.play('click');
        this.save.clearRun();
        this.closeModal({ resume: false, skipCallback: true });
        this.toast('GESPEICHERTER LAUF VERWORFEN', 'pink');
        this.showMenu();
      });
    }

    // -----------------------------------------------------------------------
    // Setup / map selection
    // -----------------------------------------------------------------------

    openSetup() {
      this.setupMap = this.profile.selectedMap;
      this.setupDifficulty = this.profile.selectedDifficulty;
      this.renderSetup();
    }

    renderSetup() {
      const map = NF.getMap(this.setupMap);
      const difficulty = NF.DIFFICULTIES[this.setupDifficulty] || NF.DIFFICULTIES.normal;
      const startCredits = Math.round(difficulty.startCredits + this.game.mods.startCredits);
      const coreMax = Math.round(difficulty.coreHP + this.game.mods.coreMax);
      const savedRun = this.save.loadRun();
      const mapCards = NF.MAPS.map((entry) => `
        <article class="nf-card nf-map-card ${entry.id === this.setupMap ? 'is-selected' : ''}" data-setup-map="${entry.id}">
          <div class="nf-map-preview">${this.mapPreview(entry)}</div>
          <div class="nf-card-head">
            <div><h3>${entry.name}</h3><small>${entry.sector} · ${entry.subtitle}</small></div>
            <span class="nf-pill ${entry.id === 'void-station' ? 'is-pink' : 'is-gold'}">${entry.threat}</span>
          </div>
          <p>${entry.desc}</p>
          <div class="nf-map-meta"><span>FREIE PLATZIERUNG</span><span>${entry.path.length - 1} SEKTOREN</span></div>
        </article>
      `).join('');
      const diffCards = NF.DIFFICULTY_ORDER.map((id) => {
        const entry = NF.DIFFICULTIES[id];
        return `
          <article class="nf-difficulty-card ${id === this.setupDifficulty ? 'is-selected' : ''}" data-setup-difficulty="${id}" style="--diff-color:${entry.color}">
            <h3>${entry.name}</h3>
            <p>${entry.desc}</p>
            <div class="nf-diff-stats">
              <span>HP ×${entry.hp.toFixed(2)}</span>
              <span>SPEED ×${entry.speed.toFixed(2)}</span>
              <span>START ◈${entry.startCredits}</span>
              <span>KERN ${entry.coreHP}</span>
            </div>
          </article>
        `;
      }).join('');
      const html = `
        <div class="nf-modal is-wide">
          <div class="nf-modal-head">
            <div>
              <span class="nf-modal-kicker">EINSATZZENTRALE</span>
              <h2>VERTEIDIGUNG STARTEN</h2>
              <p>Wähle Einsatzgebiet und Schwierigkeitsgrad. Jede Karte hat eine eigene Route und ein eigenes visuelles Thema. Türme kannst du überall platzieren, außer auf dem Gegnerweg, am Kern oder auf anderen Türmen.</p>
            </div>
            <button type="button" class="nf-modal-close" data-modal-close aria-label="Schließen">×</button>
          </div>
          <div class="nf-modal-body">
            <div class="nf-section-title">EINSATZGEBIET</div>
            <div class="nf-card-grid">${mapCards}</div>
            <div class="nf-section-title">SCHWIERIGKEITSGRAD</div>
            <div class="nf-difficulty-grid">${diffCards}</div>
            <div class="nf-section-title">EINSATZDATEN</div>
            <div class="nf-result-stats">
              <div><span>KARTE</span><b style="font-size:12px">${map.name}</b></div>
              <div><span>START-CREDITS</span><b>◈ ${startCredits}</b></div>
              <div><span>KERN-HP</span><b>${coreMax}</b></div>
              <div><span>WELLEN</span><b>30</b></div>
              <div><span>BOSSE</span><b>3</b></div>
            </div>
            ${savedRun ? `
              <div class="nf-setting-row" style="margin-top:12px">
                <div><label>GESPEICHERTER LAUF</label><small>${NF.getMap(savedRun.mapId).name} · Welle ${savedRun.wave} · ${NF.DIFFICULTIES[savedRun.difficulty].name}</small></div>
                <button type="button" class="nf-btn nf-btn-small" data-setup-resume><span><b>FORTSETZEN</b></span></button>
              </div>
            ` : ''}
          </div>
          <div class="nf-modal-footer">
            <button type="button" class="nf-btn" data-modal-close><span><b>ZURÜCK</b></span></button>
            <button type="button" class="nf-btn nf-btn-primary" data-setup-start><span class="nf-btn-icon">▶</span><span><b>EINSATZ STARTEN</b><small>${map.name} · ${difficulty.name}</small></span></button>
          </div>
        </div>
      `;
      this.openModal(html, { resumeOnClose: false });
      this.dom.modalRoot.querySelectorAll('[data-setup-map]').forEach((card) => {
        card.addEventListener('click', () => {
          this.setupMap = card.dataset.setupMap;
          this.audio.play('click');
          this.renderSetup();
        });
      });
      this.dom.modalRoot.querySelectorAll('[data-setup-difficulty]').forEach((card) => {
        card.addEventListener('click', () => {
          this.setupDifficulty = card.dataset.setupDifficulty;
          this.audio.play('click');
          this.renderSetup();
        });
      });
      const startButton = this.dom.modalRoot.querySelector('[data-setup-start]');
      if (startButton) {
        startButton.addEventListener('click', () => {
          this.audio.play('click');
          this.startRun(this.setupMap, this.setupDifficulty);
        });
      }
      const resumeButton = this.dom.modalRoot.querySelector('[data-setup-resume]');
      if (resumeButton) {
        resumeButton.addEventListener('click', () => {
          const snapshot = this.save.loadRun();
          if (snapshot) this.startRun(snapshot.mapId, snapshot.difficulty, snapshot);
        });
      }
    }

    mapPreview(map) {
      const points = map.path.map((point) => {
        const x = (point.x / NF.WORLD.width) * 300 + 10;
        const y = (point.y / NF.WORLD.height) * 112 + 10;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(' ');
      const coreX = (map.core.x / NF.WORLD.width) * 300 + 10;
      const coreY = (map.core.y / NF.WORLD.height) * 112 + 10;
      return `
        <svg viewBox="0 0 320 132" preserveAspectRatio="none" aria-hidden="true">
          <rect width="320" height="132" fill="${map.theme.bg}"/>
          <g opacity="0.16" stroke="${map.theme.accent}">
            <path d="M0 22H320M0 52H320M0 82H320M0 112H320M40 0V132M100 0V132M160 0V132M220 0V132M280 0V132"/>
          </g>
          <polyline points="${points}" fill="none" stroke="${map.theme.pathEdge}" stroke-width="13" stroke-opacity="0.25" stroke-linecap="round" stroke-linejoin="round"/>
          <polyline points="${points}" fill="none" stroke="${map.theme.path}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
          <polyline points="${points}" fill="none" stroke="${map.theme.accent}" stroke-width="1.2" stroke-dasharray="5 5" stroke-linecap="round" stroke-linejoin="round"/>
          <circle cx="${coreX}" cy="${coreY}" r="8" fill="${map.theme.accent}" opacity="0.2"/>
          <circle cx="${coreX}" cy="${coreY}" r="3.5" fill="#ffffff"/>
        </svg>
      `;
    }

    // -----------------------------------------------------------------------
    // Upgrades / skins
    // -----------------------------------------------------------------------

    openUpgrades() {
      const doctrineRows = NF.DOCTRINE_UPGRADES.map((upgrade) => {
        const level = this.profile.doctrine[upgrade.id] || 0;
        const pips = Array.from({ length: upgrade.max }, (_, index) => `<i class="${index < level ? 'is-on' : ''}"></i>`).join('');
        const maxed = level >= upgrade.max;
        return `
          <div class="nf-upgrade-row">
            <div>
              <h3>${upgrade.icon} ${upgrade.name}</h3>
              <p>${upgrade.desc}</p>
              <div class="nf-upgrade-pips">${pips}</div>
            </div>
            <div class="nf-upgrade-buy">
              <small>${level} / ${upgrade.max}</small>
              <button type="button" class="nf-btn nf-btn-small ${maxed ? '' : 'nf-btn-primary'}" data-doctrine-buy="${upgrade.id}" ${maxed || this.profile.doctrinePoints < 1 ? 'disabled' : ''}>
                <span><b>${maxed ? 'MAX' : 'KAUFEN · 1 PUNKT'}</b></span>
              </button>
            </div>
          </div>
        `;
      }).join('');
      const skinCards = NF.SKINS.map((skin) => {
        const unlocked = !skin.unlock || Boolean(this.profile.achievements[skin.unlock]);
        const selected = this.profile.selectedSkin === skin.id;
        return `
          <article class="nf-skin-card ${selected ? 'is-selected' : ''} ${unlocked ? '' : 'is-locked'}" data-skin="${skin.id}" style="--skin-a:${skin.a};--skin-b:${skin.b}">
            <div class="nf-skin-orb"></div>
            <b>${skin.name}</b>
            <small>${unlocked ? skin.desc : 'GESPERRT · ' + skin.desc}</small>
          </article>
        `;
      }).join('');
      const html = `
        <div class="nf-modal">
          <div class="nf-modal-head">
            <div>
              <span class="nf-modal-kicker">PERMANENTE PROGRESSION</span>
              <h2>UPGRADES &amp; ARSENAL</h2>
              <p>Doktrin-Punkte entstehen durch Kommando-Level. Sie verbessern deine nächsten Einsätze dauerhaft. Skins sind rein kosmetisch.</p>
            </div>
            <button type="button" class="nf-modal-close" data-modal-close aria-label="Schließen">×</button>
          </div>
          <div class="nf-modal-body">
            <div class="nf-result-stats" style="margin-top:0">
              <div><span>KOMMANDO-LEVEL</span><b>${this.profile.level}</b></div>
              <div><span>DOKTRIN-PUNKTE</span><b>${this.profile.doctrinePoints}</b></div>
              <div><span>FORSCHUNG</span><b>${NF.formatNumber(this.profile.research)}</b></div>
            </div>
            <div class="nf-section-title">DOKTRIN</div>
            <div class="nf-upgrade-list">${doctrineRows}</div>
            <div class="nf-section-title">SKINS</div>
            <div class="nf-skin-grid">${skinCards}</div>
          </div>
          <div class="nf-modal-footer">
            <button type="button" class="nf-btn" data-modal-close><span><b>ZURÜCK</b></span></button>
          </div>
        </div>
      `;
      this.openModal(html);
      this.dom.modalRoot.querySelectorAll('[data-doctrine-buy]').forEach((button) => {
        button.addEventListener('click', () => {
          const result = this.game.buyDoctrine(button.dataset.doctrineBuy);
          if (!result.ok) {
            this.toast(result.reason, 'pink');
            this.audio.play('error');
          } else {
            this.toast(`${result.upgrade.name} VERBESSERT`, 'green');
            this.openUpgrades();
          }
        });
      });
      this.dom.modalRoot.querySelectorAll('[data-skin]').forEach((card) => {
        card.addEventListener('click', () => {
          const skin = NF.SKINS.find((entry) => entry.id === card.dataset.skin);
          const unlocked = !skin.unlock || Boolean(this.profile.achievements[skin.unlock]);
          if (!unlocked) {
            this.toast('SKIN NOCH GESPERRT', 'pink');
            this.audio.play('error');
            return;
          }
          this.profile.selectedSkin = skin.id;
          this.save.saveProfile(this.profile);
          this.audio.play('click');
          this.toast(`SKIN: ${skin.name}`, 'gold');
          this.openUpgrades();
        });
      });
    }

    // -----------------------------------------------------------------------
    // Technology tree
    // -----------------------------------------------------------------------

    openTechnology(fromGame = false) {
      const branches = NF.TECH_BRANCHES.map((branch) => {
        const nodes = branch.nodes.map((node) => {
          const owned = Boolean(this.profile.tech[node.id]);
          const reqOk = !node.req || Boolean(this.profile.tech[node.req]);
          const canBuy = !owned && reqOk && this.profile.research >= node.cost;
          return `
            <div class="nf-tech-node ${owned ? 'is-owned' : ''} ${!reqOk && !owned ? 'is-locked' : ''}">
              <h4>${node.name}</h4>
              <p>${node.desc}</p>
              <button type="button" data-tech-buy="${node.id}" ${owned || !canBuy ? 'disabled' : ''}>
                ${owned ? 'ERFORSCHT' : !reqOk ? 'VORAUSSETZUNG FEHLT' : `ERFORSCHEN · ${node.cost} RP`}
              </button>
            </div>
          `;
        }).join('');
        return `
          <div class="nf-tech-branch" style="--branch-color:${branch.color}">
            <div class="nf-tech-branch-head"><h3>${branch.icon} ${branch.name}</h3><span>${branch.nodes.filter((node) => this.profile.tech[node.id]).length} / ${branch.nodes.length}</span></div>
            ${nodes}
          </div>
        `;
      }).join('');
      const html = `
        <div class="nf-modal is-wide">
          <div class="nf-modal-head">
            <div>
              <span class="nf-modal-kicker">FORSCHUNGSNETZ</span>
              <h2>TECHNOLOGY</h2>
              <p>Forschungspunkte werden durch abgeschlossene Wellen und Bosse verdient und bleiben dauerhaft erhalten. Jeder Zweig hat vier Stufen.</p>
            </div>
            <button type="button" class="nf-modal-close" data-modal-close aria-label="Schließen">×</button>
          </div>
          <div class="nf-modal-body">
            <div class="nf-result-stats" style="margin-top:0">
              <div><span>FORSCHUNGSPUNKTE</span><b>${NF.formatNumber(this.profile.research)}</b></div>
              <div><span>FREIGESCHALTET</span><b>${Object.keys(this.profile.tech).length} / ${Object.keys(NF.TECH_NODE_MAP).length}</b></div>
              <div><span>KOMMANDO-LEVEL</span><b>${this.profile.level}</b></div>
            </div>
            <div class="nf-section-title">FORSCHUNGSZWEIGE</div>
            <div class="nf-tech-grid">${branches}</div>
          </div>
          <div class="nf-modal-footer">
            <button type="button" class="nf-btn" data-modal-close><span><b>ZURÜCK</b></span></button>
          </div>
        </div>
      `;
      this.openModal(html, { pauseGame: fromGame, resumeOnClose: fromGame });
      this.dom.modalRoot.querySelectorAll('[data-tech-buy]').forEach((button) => {
        button.addEventListener('click', () => {
          const result = this.game.buyTech(button.dataset.techBuy);
          if (!result.ok) {
            this.toast(result.reason, 'pink');
            this.audio.play('error');
          } else {
            this.toast(`${result.node.name} ERFORSCHT`, 'green');
            this.openTechnology(fromGame);
          }
        });
      });
    }

    // -----------------------------------------------------------------------
    // Statistics
    // -----------------------------------------------------------------------

    openStatistics() {
      const stats = this.profile.stats;
      const favorite = NF.TOWER_DEFS[stats.favoriteTower] || NF.TOWER_DEFS.pulse;
      const achievements = NF.ACHIEVEMENTS.map((achievement) => {
        const unlocked = Boolean(this.profile.achievements[achievement.id]);
        return `
          <div class="nf-achievement ${unlocked ? 'is-unlocked' : ''}">
            <div class="nf-achievement-icon">${achievement.icon}</div>
            <div><b>${achievement.name}</b><small>${achievement.desc}</small></div>
          </div>
        `;
      }).join('');
      const towerUsage = NF.TOWER_ORDER.map((id) => {
        const def = NF.TOWER_DEFS[id];
        const uses = stats.towerUses[id] || 0;
        return `
          <div class="nf-setting-row">
            <div><label>${def.icon} ${def.name}</label><small>${TOWER_ROLE_LABELS[id]} · ${uses} Einsätze</small></div>
            <div style="width:min(260px,34vw);height:5px;background:rgba(0,240,255,.1)"><div style="height:100%;width:${Math.min(100, uses / Math.max(1, stats.games) * 35)}%;background:${def.color};box-shadow:0 0 8px ${def.color}"></div></div>
          </div>
        `;
      }).join('');
      const html = `
        <div class="nf-modal is-wide">
          <div class="nf-modal-head">
            <div>
              <span class="nf-modal-kicker">KOMMANDO-AKTE</span>
              <h2>STATISTICS</h2>
              <p>Alle Einsätze, Rekorde und Erfolge werden lokal in diesem Browser gespeichert.</p>
            </div>
            <button type="button" class="nf-modal-close" data-modal-close aria-label="Schließen">×</button>
          </div>
          <div class="nf-modal-body">
            <div class="nf-stats-grid">
              <div class="nf-stat-tile"><span>HÖCHSTE WELLE</span><b>${stats.bestWave}</b></div>
              <div class="nf-stat-tile"><span>HIGHSCORE</span><b>${NF.formatNumber(stats.highScore)}</b></div>
              <div class="nf-stat-tile"><span>GESAMT-KILLS</span><b>${NF.formatNumber(stats.totalKills)}</b></div>
              <div class="nf-stat-tile"><span>BOSS-KILLS</span><b>${stats.bossKills}</b></div>
              <div class="nf-stat-tile"><span>SPIELZEIT</span><b style="font-size:15px">${NF.formatTime(stats.totalPlayTime)}</b></div>
              <div class="nf-stat-tile"><span>SIEGE / NIEDERLAGEN</span><b style="font-size:15px">${stats.wins} / ${stats.losses}</b></div>
              <div class="nf-stat-tile"><span>LIEBLINGSTURM</span><b style="font-size:12px">${favorite.name}</b></div>
              <div class="nf-stat-tile"><span>BESTE SCHWIERIGKEIT</span><b style="font-size:12px">${stats.bestDifficulty || '—'}</b></div>
            </div>
            <div class="nf-section-title">ERFOLGE · ${Object.keys(this.profile.achievements).length} / ${NF.ACHIEVEMENTS.length}</div>
            <div class="nf-achievement-list">${achievements}</div>
            <div class="nf-section-title">TURM-NUTZUNG</div>
            <div class="nf-settings-group">${towerUsage}</div>
          </div>
          <div class="nf-modal-footer">
            <button type="button" class="nf-btn" data-modal-close><span><b>ZURÜCK</b></span></button>
          </div>
        </div>
      `;
      this.openModal(html);
    }

    // -----------------------------------------------------------------------
    // Settings
    // -----------------------------------------------------------------------

    openSettings(fromGame = false) {
      const settings = this.profile.settings;
      const html = `
        <div class="nf-modal is-narrow">
          <div class="nf-modal-head">
            <div>
              <span class="nf-modal-kicker">SYSTEMKONFIGURATION</span>
              <h2>SETTINGS</h2>
              <p>Audio, Effekte und lokale Daten. Änderungen werden sofort gespeichert.</p>
            </div>
            <button type="button" class="nf-modal-close" data-modal-close aria-label="Schließen">×</button>
          </div>
          <div class="nf-modal-body">
            <div class="nf-settings-group">
              <div class="nf-setting-row">
                <div><label>MUSIKLAUTSTÄRKE</label><small>Prozeduraler Cyberpunk-Soundtrack</small></div>
                <input type="range" min="0" max="1" step="0.05" value="${settings.music}" data-setting="music" aria-label="Musiklautstärke">
              </div>
              <div class="nf-setting-row">
                <div><label>SOUNDEFFEKTE</label><small>Waffen, Treffer, Explosionen</small></div>
                <input type="range" min="0" max="1" step="0.05" value="${settings.sfx}" data-setting="sfx" aria-label="Soundeffektlautstärke">
              </div>
              <div class="nf-setting-row">
                <div><label>PARTIKEL</label><small>Explosionen, Treffer, Umgebung</small></div>
                <button type="button" class="nf-toggle ${settings.particles ? 'is-on' : ''}" data-toggle="particles" aria-label="Partikel umschalten"></button>
              </div>
              <div class="nf-setting-row">
                <div><label>SCREEN SHAKE</label><small>Kameraerschütterung bei schweren Treffern</small></div>
                <button type="button" class="nf-toggle ${settings.shake ? 'is-on' : ''}" data-toggle="shake" aria-label="Screen Shake umschalten"></button>
              </div>
              <div class="nf-setting-row">
                <div><label>SCHADENSZAHLEN</label><small>Fließende Trefferwerte anzeigen</small></div>
                <button type="button" class="nf-toggle ${settings.damageNumbers ? 'is-on' : ''}" data-toggle="damageNumbers" aria-label="Schadenszahlen umschalten"></button>
              </div>
              <div class="nf-setting-row">
                <div><label>AUTO-START</label><small>Nächste Welle automatisch starten</small></div>
                <button type="button" class="nf-toggle ${settings.autoStart ? 'is-on' : ''}" data-toggle="autoStart" aria-label="Auto-Start umschalten"></button>
              </div>
            </div>
            <div class="nf-section-title">LOKALE DATEN</div>
            <div class="nf-setting-row">
              <div><label>FORTSCHRITT ZURÜCKSETZEN</label><small>Profil, Forschung, Erfolge und Statistiken löschen</small></div>
              <button type="button" class="nf-btn nf-btn-small nf-btn-danger" data-reset-progress><span><b>RESET</b></span></button>
            </div>
          </div>
          <div class="nf-modal-footer">
            <button type="button" class="nf-btn" data-modal-close><span><b>ZURÜCK</b></span></button>
          </div>
        </div>
      `;
      this.openModal(html, { pauseGame: fromGame, resumeOnClose: fromGame });
      this.dom.modalRoot.querySelectorAll('[data-setting]').forEach((input) => {
        input.addEventListener('input', () => {
          const key = input.dataset.setting;
          const value = Number(input.value);
          settings[key] = value;
          this.audio.setVolumes({ music: settings.music, sfx: settings.sfx });
          this.save.saveProfile(this.profile);
          if (key === 'sfx') this.audio.play('click');
        });
      });
      this.dom.modalRoot.querySelectorAll('[data-toggle]').forEach((button) => {
        button.addEventListener('click', () => {
          const key = button.dataset.toggle;
          settings[key] = !settings[key];
          button.classList.toggle('is-on', Boolean(settings[key]));
          if (key === 'autoStart') this.game.autoStart = Boolean(settings[key]);
          this.save.saveProfile(this.profile);
          this.audio.play('click');
        });
      });
      const resetButton = this.dom.modalRoot.querySelector('[data-reset-progress]');
      resetButton.addEventListener('click', () => {
        if (!window.confirm('Wirklich den gesamten NEON FRONTIER Fortschritt löschen? Diese Aktion kann nicht rückgängig gemacht werden.')) return;
        this.profile = this.save.resetProfile();
        this.game.profile = this.profile;
        this.game.recalculateMods();
        this.audio.setVolumes(this.profile.settings);
        this.closeModal({ resume: false, skipCallback: true });
        this.showMenu();
        this.updateMenuProfile();
        this.toast('FORTSCHRITT ZURÜCKGESETZT', 'pink');
      });
    }

    // -----------------------------------------------------------------------
    // Pause
    // -----------------------------------------------------------------------

    openPause() {
      if (!['playing', 'paused'].includes(this.game.state)) return;
      if (this.game.state === 'playing') this.game.pause();
      const summary = this.game.getSummary();
      const html = `
        <div class="nf-modal is-narrow">
          <div class="nf-modal-head">
            <div>
              <span class="nf-modal-kicker">SYSTEM PAUSIERT</span>
              <h2>PAUSE</h2>
              <p>${summary.map.name} · ${summary.difficulty.name} · Welle ${summary.wave}</p>
            </div>
            <button type="button" class="nf-modal-close" data-modal-close aria-label="Schließen">×</button>
          </div>
          <div class="nf-modal-body">
            <div class="nf-result-stats" style="margin-top:0">
              <div><span>CREDITS</span><b>◈ ${NF.formatNumber(summary.credits)}</b></div>
              <div><span>KERN</span><b>${summary.coreHp} / ${summary.coreMax}</b></div>
              <div><span>SCORE</span><b>${NF.formatNumber(summary.score)}</b></div>
              <div><span>TÜRME</span><b>${summary.towers}</b></div>
            </div>
            <div class="nf-section-title">AKTIONEN</div>
            <div class="nf-upgrade-list">
              <button type="button" class="nf-btn nf-btn-primary" data-pause-resume><span class="nf-btn-icon">▶</span><span><b>FORTSETZEN</b><small>Verteidigung wieder aufnehmen</small></span></button>
              <button type="button" class="nf-btn" data-pause-tech><span class="nf-btn-icon">⌬</span><span><b>TECHNOLOGY</b><small>Forschungspunkte einsetzen</small></span></button>
              <button type="button" class="nf-btn" data-pause-settings><span class="nf-btn-icon">⚙</span><span><b>SETTINGS</b><small>Audio und Effekte</small></span></button>
              <button type="button" class="nf-btn nf-btn-danger" data-pause-abandon><span class="nf-btn-icon">×</span><span><b>EINSATZ BEENDEN</b><small>Lauf als Niederlage werten</small></span></button>
            </div>
          </div>
          <div class="nf-modal-footer">
            <button type="button" class="nf-btn" data-modal-close><span><b>FORTSETZEN</b></span></button>
          </div>
        </div>
      `;
      this.openModal(html, { resumeOnClose: true });
      this.dom.modalRoot.querySelector('[data-pause-resume]').addEventListener('click', () => this.closeModal());
      this.dom.modalRoot.querySelector('[data-pause-tech]').addEventListener('click', () => {
        this.closeModal({ resume: false, skipCallback: true });
        this.openTechnology(true);
      });
      this.dom.modalRoot.querySelector('[data-pause-settings]').addEventListener('click', () => {
        this.closeModal({ resume: false, skipCallback: true });
        this.openSettings(true);
      });
      this.dom.modalRoot.querySelector('[data-pause-abandon]').addEventListener('click', () => {
        if (!window.confirm('Einsatz wirklich beenden? Der aktuelle Lauf wird als Niederlage gewertet.')) return;
        this.closeModal({ resume: false, skipCallback: true });
        this.game.abandonRun();
      });
    }

    // -----------------------------------------------------------------------
    // Result
    // -----------------------------------------------------------------------

    openResult(result) {
      this.currentScreen = 'result';
      this.dom.hud.classList.add('nf-hidden');
      const victory = result.victory;
      const color = victory ? '#00ff66' : '#ff0077';
      const title = result.abandoned ? 'EINSATZ ABGEBROCHEN' : victory ? 'SEKTOR GESICHERT' : 'KERN ZERSTÖRT';
      const subtitle = result.abandoned
        ? 'Der Einsatz wurde vorzeitig beendet. Die Maschinenarmee bleibt eine Bedrohung.'
        : victory
          ? 'Omega Core ist gefallen. Der letzte Energiekern der Menschheit brennt weiter.'
          : 'Die Verteidigungslinie ist zusammengebrochen. Aber jeder Lauf bringt neue Erkenntnisse.';
      const html = `
        <div class="nf-modal is-narrow">
          <div class="nf-modal-head">
            <div>
              <span class="nf-modal-kicker">EINSATZBERICHT</span>
              <h2>${victory ? 'VICTORY' : 'GAME OVER'}</h2>
            </div>
            <button type="button" class="nf-modal-close" data-modal-close aria-label="Schließen">×</button>
          </div>
          <div class="nf-modal-body">
            <div class="nf-result-hero" style="--result-color:${color}">
              <div class="nf-result-emblem">${victory ? 'Ω' : '✖'}</div>
              <h2>${title}</h2>
              <p>${subtitle}</p>
            </div>
            <div class="nf-result-stats is-three">
              <div><span>WELLE</span><b>${result.wave}</b></div>
              <div><span>SCORE</span><b>${NF.formatNumber(result.score)}</b></div>
              <div><span>KILLS</span><b>${result.kills}</b></div>
              <div><span>BOSSE</span><b>${result.bossesKilled}</b></div>
              <div><span>ZEIT</span><b style="font-size:14px">${NF.formatTime(result.time)}</b></div>
              <div><span>KARTE</span><b style="font-size:11px">${result.map.name}</b></div>
            </div>
            <div class="nf-result-rewards">
              <span class="nf-pill is-gold">+ ${NF.formatNumber(result.xpEarned)} XP</span>
              <span class="nf-pill is-green">+ ${NF.formatNumber(result.researchEarned)} RP</span>
              <span class="nf-pill">${result.difficulty.name}</span>
              ${result.levelUps > 0 ? `<span class="nf-pill is-green">LEVEL +${result.levelUps}</span>` : ''}
            </div>
          </div>
          <div class="nf-modal-footer">
            <button type="button" class="nf-btn" data-result-menu><span><b>HAUPTMENÜ</b></span></button>
            <button type="button" class="nf-btn nf-btn-primary" data-result-retry><span class="nf-btn-icon">▶</span><span><b>NOCHMAL</b><small>${result.map.name} · ${result.difficulty.name}</small></span></button>
          </div>
        </div>
      `;
      this.openModal(html, { resumeOnClose: false });
      this.modalOnClose = () => this.goToMenu();
      this.dom.modalRoot.querySelector('[data-result-menu]').addEventListener('click', () => {
        this.modalOnClose = null;
        this.closeModal({ resume: false, skipCallback: true });
        this.goToMenu();
      });
      this.dom.modalRoot.querySelector('[data-result-retry]').addEventListener('click', () => {
        this.modalOnClose = null;
        this.closeModal({ resume: false, skipCallback: true });
        this.startRun(result.map.id, result.difficulty.id);
      });
    }

    // -----------------------------------------------------------------------
    // Modal plumbing
    // -----------------------------------------------------------------------

    openModal(html, options = {}) {
      if (!this.dom.modalRoot.classList.contains('nf-hidden')) {
        this.closeModal({ resume: false, skipCallback: true });
      }
      if (options.pauseGame && this.game.state === 'playing') this.game.pause();
      this.modalResume = Boolean(options.resumeOnClose) && this.game.state === 'paused';
      this.modalOnClose = options.onClose || null;
      this.dom.modalRoot.innerHTML = html;
      this.dom.modalRoot.classList.remove('nf-hidden');
      this.dom.modalRoot.scrollTop = 0;
    }

    closeModal(options = {}) {
      if (this.dom.modalRoot.classList.contains('nf-hidden')) return;
      this.dom.modalRoot.classList.add('nf-hidden');
      this.dom.modalRoot.innerHTML = '';
      const callback = this.modalOnClose;
      this.modalOnClose = null;
      const shouldResume = options.resume !== false && this.modalResume;
      this.modalResume = false;
      if (!options.skipCallback && typeof callback === 'function') callback();
      if (shouldResume && this.game.state === 'paused') this.game.resume();
    }

    // -----------------------------------------------------------------------
    // Toasts / events
    // -----------------------------------------------------------------------

    toast(text, tone = '') {
      const toast = document.createElement('div');
      toast.className = `nf-toast ${tone ? `is-${tone}` : ''}`;
      toast.textContent = text;
      this.dom.toastRoot.appendChild(toast);
      window.setTimeout(() => {
        toast.classList.add('is-out');
        window.setTimeout(() => toast.remove(), 320);
      }, 2400);
    }

    handleGameEvent(type, payload = {}) {
      switch (type) {
        case 'runStart':
          this.showHUD();
          this.toast(`EINSATZ: ${payload.map.name} · ${payload.difficulty.name}`, 'gold');
          break;
        case 'statechange':
          if (payload === 'playing') this.dom.hud.classList.remove('nf-hidden');
          break;
        case 'waveStart':
          this.toast(payload.isBoss ? `⚠ BOSS-WELLE ${payload.wave}` : `WELLE ${payload.wave} STARTET`, payload.isBoss ? 'pink' : '');
          break;
        case 'waveComplete':
          this.toast(`WELLE ${payload.wave} ABGESCHLOSSEN · +◈${payload.credits} · +${payload.research} RP`, 'green');
          break;
        case 'bossWarning':
          this.toast('⚠ BOSS-SIGNATUR ERKANNT', 'pink');
          break;
        case 'bossSpawn':
          this.toast(`${payload.name} BETRITT DEN SEKTOR`, 'pink');
          break;
        case 'bossPhase':
          this.toast(`${payload.boss.name} · PHASE ${payload.phase}`, 'pink');
          break;
        case 'bossAbility':
          this.toast(`${payload.boss.name}: ${payload.ability.toUpperCase()}`, 'pink');
          break;
        case 'bossKilled':
          this.toast(`${payload.name} ZERSTÖRT`, 'gold');
          break;
        case 'achievement':
          this.toast(`ERFOLG: ${payload.name}`, 'gold');
          this.audio.play('achievement');
          break;
        case 'ability':
          // Ability feedback is already shown by the HUD cooldown and canvas.
          break;
        case 'runEnd':
          if (this.resultTimeout) window.clearTimeout(this.resultTimeout);
          this.resultTimeout = window.setTimeout(() => {
            this.resultTimeout = null;
            this.openResult(payload);
          }, 450);
          break;
        case 'toast':
          this.toast(payload.text, payload.tone || '');
          break;
        case 'selectionchange':
          this.renderInspector(true);
          this.updateHUD();
          break;
        case 'towerchange':
          this.renderInspector(true);
          break;
        case 'techchange':
        case 'doctrinechange':
          this.updateMenuProfile();
          break;
        default:
          break;
      }
    }

    // -----------------------------------------------------------------------
    // HUD updates
    // -----------------------------------------------------------------------

    update(dt) {
      if (this.currentScreen === 'menu') {
        this.updateMenuProfile();
        return;
      }
      if (this.currentScreen === 'game') {
        this.updateHUD();
        this.updateInspectorAffordability();
      }
    }

    updateMenuProfile() {
      const profile = this.profile;
      if (this.dom.menu.classList.contains('nf-hidden')) return;
      const needed = NF.xpForNextLevel(profile.level);
      this.dom.menuLevel.textContent = String(profile.level).padStart(2, '0');
      this.dom.menuXpBar.style.width = pct(profile.xp, needed);
      this.dom.menuXp.textContent = `${NF.formatNumber(profile.xp)} / ${NF.formatNumber(needed)} XP`;
      this.dom.menuDoctrine.textContent = `${profile.doctrinePoints} DOKTRIN-PUNKT${profile.doctrinePoints === 1 ? '' : 'E'}`;
      this.dom.menuMapName.textContent = NF.getMap(profile.selectedMap).name;
      this.dom.menuBestWave.textContent = String(profile.stats.bestWave);
      this.dom.menuBosses.textContent = String(profile.stats.bossKills);
      this.dom.menuScore.textContent = NF.formatNumber(profile.stats.highScore);
      if (profile.lastRun) {
        const result = profile.lastRun.victory ? 'SIEG' : 'NIEDERLAGE';
        this.dom.menuLastRun.textContent = `${profile.lastRun.mapName} · Welle ${profile.lastRun.wave} · ${result}`;
      } else {
        this.dom.menuLastRun.textContent = 'Noch kein Einsatz abgeschlossen.';
      }
    }

    updateHUD() {
      if (this.currentScreen !== 'game') return;
      const game = this.game;
      const profile = this.profile;
      this.dom.credits.textContent = NF.formatNumber(game.credits);
      this.dom.energy.textContent = `${Math.floor(game.energy)} / ${game.energyMax}`;
      this.dom.energyFill.style.width = pct(game.energy, game.energyMax);
      this.dom.research.textContent = NF.formatNumber(profile.research);
      this.dom.wave.textContent = game.getWaveLabel();
      this.dom.waveState.textContent = game.getWaveStateLabel();
      this.dom.waveFill.style.width = pct(game.waveProgress, 1);
      this.dom.enemies.textContent = `${game.enemyCount} GEGNER`;
      this.dom.difficulty.textContent = game.difficulty.name;
      this.dom.coreText.textContent = `${Math.ceil(game.coreHp)} / ${game.coreMax}${game.coreShield > 0 ? ` +${Math.ceil(game.coreShield)}` : ''}`;
      this.dom.coreFill.style.width = pct(game.coreHp, game.coreMax);
      this.dom.coreStatus.textContent = game.coreStatus;
      this.dom.coreStatus.style.color = game.coreRatio > 0.6 ? 'var(--nf-green)' : game.coreRatio > 0.3 ? 'var(--nf-yellow)' : 'var(--nf-pink)';
      this.dom.score.textContent = `SCORE ${NF.formatNumber(game.calculateScore())}`;

      const boss = game.getBossInfo();
      if (boss) {
        this.dom.bossBar.classList.remove('nf-hidden');
        this.dom.bossName.textContent = boss.name;
        this.dom.bossPhase.textContent = `PHASE ${boss.phase}`;
        this.dom.bossFill.style.width = pct(boss.hp, boss.maxHp);
        this.dom.bossShieldFill.style.width = pct(boss.shield, Math.max(1, boss.maxHp));
        this.dom.bossHp.textContent = `${NF.formatNumber(Math.ceil(boss.hp))} / ${NF.formatNumber(Math.ceil(boss.maxHp))}${boss.shield > 0 ? ` · SCHILD ${NF.formatNumber(Math.ceil(boss.shield))}` : ''}`;
      } else {
        this.dom.bossBar.classList.add('nf-hidden');
      }

      if (game.waveActive) {
        this.dom.waveCountdown.textContent = `WELLE ${String(game.wave).padStart(2, '0')} LÄUFT`;
        this.dom.wavePanelSub.textContent = `${game.enemyCount} Gegner im Sektor`;
        this.dom.nextWave.disabled = true;
        this.dom.nextWave.textContent = 'WELLE AKTIV';
      } else {
        const countdown = Math.max(0, Math.ceil(game.waveCountdown));
        this.dom.waveCountdown.textContent = `NÄCHSTE WELLE IN ${countdown}`;
        this.dom.wavePanelSub.textContent = game.autoStart ? 'AUTO-START AKTIV' : 'Verteidigung vorbereiten';
        this.dom.nextWave.disabled = game.state !== 'playing';
        this.dom.nextWave.textContent = 'NÄCHSTE WELLE';
      }

      this.dom.speedButtons.forEach((button) => {
        button.classList.toggle('is-active', Number(button.dataset.speed) === game.speed);
      });

      this.dom.palette.querySelectorAll('[data-tower]').forEach((button) => {
        const type = button.dataset.tower;
        const def = NF.TOWER_DEFS[type];
        button.classList.toggle('is-active', game.selectedTowerType === type);
        button.classList.toggle('is-locked', game.credits < def.cost && game.selectedTowerType !== type);
      });

      this.dom.abilityBar.querySelectorAll('[data-ability]').forEach((button) => {
        const state = game.getAbilityState(button.dataset.ability);
        if (!state) return;
        const cooling = state.cooldown > 0;
        button.classList.toggle('is-cooling', cooling);
        button.classList.toggle('is-disabled', !state.ready);
        const cd = button.querySelector('.nf-ability-cd');
        if (cd) cd.textContent = cooling ? Math.ceil(state.cooldown) : '';
        button.title = `${state.def.name} — ${state.def.desc} (${state.def.cost} Energie, ${Math.ceil(state.maxCooldown)}s Abklingzeit)`;
      });

      const placementActive = game.selectedTowerType || game.pendingAbility;
      this.dom.placementHint.classList.toggle('nf-hidden', !placementActive);
      if (game.pendingAbility) {
        const ability = NF.ABILITY_MAP[game.pendingAbility];
        this.dom.placementText.textContent = `${ability.name}: ZIEL WÄHLEN`;
      } else if (game.selectedTowerType) {
        const def = NF.TOWER_DEFS[game.selectedTowerType];
        this.dom.placementText.textContent = `${def.name} · FREIE FLÄCHE · ◈${def.cost}`;
      }
    }

    updateInspectorAffordability() {
      const tower = this.game.selectedTower;
      if (!tower) return;
      const upgradeButton = this.dom.inspector.querySelector('[data-inspector-action="upgrade"]');
      if (upgradeButton) {
        const cost = this.game.getUpgradeCost(tower);
        upgradeButton.disabled = tower.isMaxLevel || this.game.credits < cost;
      }
      this.dom.inspector.querySelectorAll('[data-inspector-action="spec"]').forEach((button) => {
        const cost = this.game.getSpecCost(tower);
        button.disabled = this.game.credits < cost;
      });
    }

    renderInspector(force = false) {
      const tower = this.game.selectedTower;
      if (!tower) {
        this.lastInspectorSignature = '';
        this.dom.inspector.innerHTML = `
          <div class="nf-inspector-empty">
            <div class="nf-inspector-emblem">⌖</div>
            <strong>KEIN TURM AUSGEWÄHLT</strong>
            <p>Wähle eine Turmklasse und platziere sie auf einer freien Fläche. Verkaufte Türme geben ihre Fläche wieder frei. Klicke einen Turm an, um ihn zu verbessern.</p>
          </div>
        `;
        this.dom.inspector.classList.remove('is-open');
        return;
      }

      const def = tower.def;
      const stats = this.game.getTowerStats(tower);
      const nextStats = tower.level < 5 ? this.game.getTowerStats(tower, tower.level + 1) : null;
      const upgradeCost = this.game.getUpgradeCost(tower);
      const specCost = this.game.getSpecCost(tower);
      const signature = `${tower.typeId}:${tower.level}:${tower.spec}:${tower.targeting}:${upgradeCost}:${specCost}`;
      if (!force && signature === this.lastInspectorSignature) return;
      this.lastInspectorSignature = signature;

      const spec = tower.spec ? def.specs[tower.spec] : null;
      const color = spec ? spec.color : def.color;
      this.dom.inspector.style.setProperty('--tower-color', color);
      const pips = Array.from({ length: 5 }, (_, index) => `<i class="${index < tower.level ? 'is-on' : ''}"></i>`).join('');
      const nextPreview = nextStats
        ? `<div class="nf-target-row"><span>NÄCHSTES LEVEL</span><b style="color:var(--nf-cyan);font-family:var(--nf-font-display);font-size:8px">+${Math.round(nextStats.damage - stats.damage)} DMG · ${nextStats.fireRate.toFixed(2)}/s · ${Math.round(nextStats.range)} RNG</b></div>`
        : `<div class="nf-target-row"><span>STATUS</span><b style="color:var(--nf-yellow);font-family:var(--nf-font-display);font-size:8px">MAX LEVEL</b></div>`;

      let specHtml = '';
      if (tower.level >= 3 && !tower.spec) {
        specHtml = `
          <div class="nf-section-title" style="margin:10px 0 6px">SPEZIALISIERUNG</div>
          <div class="nf-spec-list">
            ${Object.entries(def.specs).map(([id, entry]) => `
              <div class="nf-spec-card">
                <b style="color:${entry.color}">${entry.name}</b>
                <p>${entry.desc}</p>
                <button type="button" data-inspector-action="spec" data-spec="${id}" ${this.game.credits < specCost ? 'disabled' : ''}>WÄHLEN · ◈${specCost}</button>
              </div>
            `).join('')}
          </div>
        `;
      } else if (tower.level < 3) {
        specHtml = `<div class="nf-target-row"><span>SPEZIALISIERUNG</span><b style="color:var(--nf-dim);font-family:var(--nf-font-display);font-size:7px">AB LEVEL 3</b></div>`;
      } else if (spec) {
        specHtml = `
          <div class="nf-spec-card is-selected" style="margin-top:9px">
            <b style="color:${spec.color}">${spec.name}</b>
            <p>${spec.desc}</p>
          </div>
        `;
      }

      this.dom.inspector.innerHTML = `
        <div class="nf-inspector-head">
          <div>
            <h3>${def.icon} ${def.name}</h3>
            <small>${def.role} · ${TOWER_ROLE_LABELS[tower.typeId]}</small>
          </div>
          <span class="nf-inspector-level">LV ${tower.level}</span>
        </div>
        <div class="nf-upgrade-pips" style="margin-top:8px">${pips}</div>
        <div class="nf-stat-grid">
          <div><span>SCHADEN</span><b>${Math.round(stats.damage)}</b></div>
          <div><span>FEUERRATE</span><b>${stats.fireRate.toFixed(2)}/s</b></div>
          <div><span>REICHWEITE</span><b>${Math.round(stats.range)}</b></div>
          <div><span>DPS</span><b>${Math.round(stats.dps)}</b></div>
          <div><span>KILLS</span><b>${tower.kills}</b></div>
          <div><span>GESAMTSCHADEN</span><b>${NF.formatNumber(tower.damageDealt)}</b></div>
          <div><span>INVESTIERT</span><b>◈ ${NF.formatNumber(tower.invested)}</b></div>
          <div><span>VERKAUF</span><b>◈ ${this.game.getSellValue(tower)}</b></div>
        </div>
        ${nextPreview}
        <div class="nf-inspector-actions">
          <button type="button" class="nf-btn ${tower.isMaxLevel ? '' : 'nf-btn-primary'}" data-inspector-action="upgrade" ${tower.isMaxLevel || this.game.credits < upgradeCost ? 'disabled' : ''}>
            <span><b>${tower.isMaxLevel ? 'MAXIMALES LEVEL' : `UPGRADE · LV ${tower.level + 1}`}</b><small>${tower.isMaxLevel ? 'Alle Upgrades abgeschlossen' : `Kosten: ◈ ${upgradeCost}`}</small></span>
          </button>
          <button type="button" class="nf-btn nf-btn-danger" data-inspector-action="sell"><span><b>VERKAUFEN</b><small>Rückerstattung: ◈ ${this.game.getSellValue(tower)}</small></span></button>
        </div>
        <div class="nf-target-row">
          <span>ZIELPRIORITÄT</span>
          <button type="button" data-inspector-action="target">${TARGET_LABELS[tower.targeting]}</button>
        </div>
        ${specHtml}
      `;
      this.dom.inspector.classList.add('is-open');

      this.dom.inspector.querySelector('[data-inspector-action="upgrade"]').addEventListener('click', () => {
        const result = this.game.upgradeSelectedTower();
        if (!result.ok) {
          this.toast(result.reason, 'pink');
          this.audio.play('error');
        }
        this.renderInspector(true);
      });
      this.dom.inspector.querySelector('[data-inspector-action="sell"]').addEventListener('click', () => {
        const result = this.game.sellSelectedTower();
        if (!result.ok) {
          this.toast(result.reason, 'pink');
          this.audio.play('error');
        } else {
          this.toast(`TURM VERKAUFT · +◈${result.value}`, 'gold');
        }
        this.renderInspector(true);
      });
      this.dom.inspector.querySelector('[data-inspector-action="target"]').addEventListener('click', () => {
        this.game.cycleTargeting();
        this.renderInspector(true);
      });
      this.dom.inspector.querySelectorAll('[data-inspector-action="spec"]').forEach((button) => {
        button.addEventListener('click', () => {
          const result = this.game.chooseSpecialization(button.dataset.spec);
          if (!result.ok) {
            this.toast(result.reason, 'pink');
            this.audio.play('error');
          } else {
            this.toast(`SPEZIALISIERUNG: ${result.tower.def.specs[button.dataset.spec].name}`, 'green');
          }
          this.renderInspector(true);
        });
      });
    }

    // -----------------------------------------------------------------------
    // Keyboard helpers
    // -----------------------------------------------------------------------

    handleEscape() {
      if (!this.dom.modalRoot.classList.contains('nf-hidden')) {
        this.closeModal();
        return true;
      }
      if (this.game.pendingAbility || this.game.selectedTowerType) {
        this.game.cancelAction();
        return true;
      }
      if (this.game.state === 'playing' || this.game.state === 'paused') {
        this.openPause();
        return true;
      }
      return false;
    }

    triggerAbility(index) {
      const ability = NF.ABILITIES[index];
      if (!ability) return;
      this.audio.unlock();
      this.audio.play('click');
      const result = this.game.activateAbility(ability.id);
      if (!result.ok) {
        this.toast(result.reason || 'FÄHIGKEIT NICHT BEREIT', 'pink');
        this.audio.play('error');
      } else if (result.needsTarget) {
        this.toast(`${ability.name}: ZIEL WÄHLEN`, 'gold');
      }
      this.updateHUD();
    }
  }

  NF.UI = UI;
})();
