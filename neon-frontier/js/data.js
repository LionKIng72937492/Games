/* ==========================================================================
   NEON FRONTIER: LAST DEFENSE — data layer
   All static game data lives here. The engine reads these definitions but
   never mutates them. Keeping balance values in one place makes the game
   easy to tune without touching rendering or UI code.
   ========================================================================== */

(() => {
  'use strict';

  const NF = window.NF = window.NF || {};

  NF.VERSION = '1.0.0';
  NF.WORLD = { width: 1280, height: 720 };
  NF.TAU = Math.PI * 2;

  // Free tower placement. The path is 58px wide, so the tower centre must
  // stay clear of its half-width plus the tower base and a small safety gap.
  NF.BUILD = {
    margin: 30,
    pathWidth: 58,
    coreRadius: 58,
    towerRadius: 25,
    gap: 5
  };
  NF.BUILD.pathHalfWidth = NF.BUILD.pathWidth / 2;
  NF.BUILD.pathClearance = NF.BUILD.pathHalfWidth + NF.BUILD.towerRadius + NF.BUILD.gap;
  NF.BUILD.towerClearance = NF.BUILD.towerRadius * 2 + NF.BUILD.gap;
  NF.BUILD.towerClearanceSq = NF.BUILD.towerClearance * NF.BUILD.towerClearance;
  NF.BUILD.coreClearance = NF.BUILD.coreRadius + NF.BUILD.towerRadius + NF.BUILD.gap;

  // -------------------------------------------------------------------------
  // Small shared helpers
  // -------------------------------------------------------------------------

  NF.clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  NF.lerp = (a, b, t) => a + (b - a) * t;
  NF.dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
  NF.dist2 = (x1, y1, x2, y2) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return dx * dx + dy * dy;
  };
  NF.rand = (min, max) => min + Math.random() * (max - min);
  NF.randInt = (min, max) => Math.floor(NF.rand(min, max + 1));
  NF.pick = (list) => list[Math.floor(Math.random() * list.length)];
  NF.clamp01 = (value) => NF.clamp(value, 0, 1);
  NF.formatNumber = (value) => {
    const number = Math.round(Number(value) || 0);
    if (Math.abs(number) >= 1000000) return `${(number / 1000000).toFixed(1)}M`;
    if (Math.abs(number) >= 10000) return `${(number / 1000).toFixed(1)}K`;
    return String(number);
  };
  NF.formatTime = (seconds) => {
    const total = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
    return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };
  NF.roman = (value) => ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][value - 1] || String(value);
  NF.deepClone = (value) => JSON.parse(JSON.stringify(value));
  NF.now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  NF.createSeededRandom = (seed) => {
    let state = seed >>> 0;
    return () => {
      state += 0x6D2B79F5;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  };

  NF.pointToSegmentDistance = (px, py, ax, ay, bx, by) => {
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq <= 0.0001) return NF.dist(px, py, ax, ay);
    const t = NF.clamp(((px - ax) * dx + (py - ay) * dy) / lengthSq, 0, 1);
    return NF.dist(px, py, ax + dx * t, ay + dy * t);
  };

  // -------------------------------------------------------------------------
  // Maps
  // -------------------------------------------------------------------------

  NF.MAPS = [
    {
      id: 'neon-city',
      name: 'NEON CITY',
      subtitle: 'Letzte Metropole',
      sector: 'SECTOR 01',
      threat: 'STANDARD',
      desc: 'Die letzte Stadt der Menschheit. Klare Sichtlinien, ein langer Verteidigungsweg durch das Herz der Metropole und freie Platzierung für jede Strategie.',
      theme: {
        bg: '#080b14',
        bg2: '#101827',
        accent: '#00f0ff',
        accent2: '#ff0077',
        path: '#0a1a28',
        pathEdge: '#00c9e8',
        grid: 'rgba(0, 240, 255, 0.07)',
        decor: 'city'
      },
      path: [
        { x: -70, y: 360 },
        { x: 160, y: 360 },
        { x: 160, y: 170 },
        { x: 420, y: 170 },
        { x: 420, y: 540 },
        { x: 680, y: 540 },
        { x: 680, y: 300 },
        { x: 930, y: 300 },
        { x: 930, y: 500 },
        { x: 1150, y: 500 }
      ],
      pads: [
        { x: 90, y: 260 }, { x: 260, y: 270 }, { x: 300, y: 370 }, { x: 300, y: 480 },
        { x: 520, y: 280 }, { x: 520, y: 440 }, { x: 570, y: 630 }, { x: 780, y: 430 },
        { x: 780, y: 560 }, { x: 1020, y: 390 }, { x: 1020, y: 590 }, { x: 1080, y: 300 },
        { x: 700, y: 180 }, { x: 400, y: 80 }, { x: 200, y: 80 }, { x: 880, y: 650 },
        { x: 1100, y: 620 }, { x: 650, y: 420 }
      ]
    },
    {
      id: 'cyber-factory',
      name: 'CYBER FACTORY',
      subtitle: 'Industrie-Komplex 7',
      sector: 'SECTOR 07',
      threat: 'HOCH',
      desc: 'Eine automatisierte Roboterfabrik. Enge Kurven und heiße Öfen verlangen eine flexible Verteidigung mit frei gewählten Turmpositionen.',
      theme: {
        bg: '#100b08',
        bg2: '#1c140d',
        accent: '#ff9d3c',
        accent2: '#ffe600',
        path: '#1c1208',
        pathEdge: '#ff9d3c',
        grid: 'rgba(255, 157, 60, 0.07)',
        decor: 'factory'
      },
      path: [
        { x: -70, y: 140 },
        { x: 230, y: 140 },
        { x: 230, y: 500 },
        { x: 470, y: 500 },
        { x: 470, y: 120 },
        { x: 720, y: 120 },
        { x: 720, y: 390 },
        { x: 950, y: 390 },
        { x: 950, y: 620 },
        { x: 1160, y: 620 }
      ],
      pads: [
        { x: 110, y: 260 }, { x: 350, y: 260 }, { x: 350, y: 600 }, { x: 570, y: 300 },
        { x: 570, y: 600 }, { x: 650, y: 240 }, { x: 830, y: 250 }, { x: 830, y: 500 },
        { x: 1050, y: 480 }, { x: 1050, y: 680 }, { x: 880, y: 680 }, { x: 720, y: 520 },
        { x: 260, y: 620 }, { x: 120, y: 560 }, { x: 600, y: 50 }, { x: 1000, y: 250 },
        { x: 1120, y: 400 }, { x: 800, y: 150 }
      ]
    },
    {
      id: 'void-station',
      name: 'VOID STATION',
      subtitle: 'Orbitale Festung',
      sector: 'SECTOR 00',
      threat: 'EXTREM',
      desc: 'Eine verlassene Raumstation am Rand des Schwarzen Lochs. Die verschachtelte Route zwingt zu kurzen, überlappenden Feuerlinien.',
      theme: {
        bg: '#070711',
        bg2: '#110d22',
        accent: '#b26bff',
        accent2: '#00ff66',
        path: '#0d0a1c',
        pathEdge: '#b26bff',
        grid: 'rgba(178, 107, 255, 0.075)',
        decor: 'space'
      },
      path: [
        { x: -70, y: 100 },
        { x: 1050, y: 100 },
        { x: 1050, y: 600 },
        { x: 260, y: 600 },
        { x: 260, y: 300 },
        { x: 760, y: 300 },
        { x: 760, y: 470 },
        { x: 520, y: 470 }
      ],
      pads: [
        { x: 150, y: 220 }, { x: 380, y: 220 }, { x: 620, y: 220 }, { x: 880, y: 220 },
        { x: 900, y: 380 }, { x: 900, y: 520 }, { x: 700, y: 680 }, { x: 450, y: 540 },
        { x: 180, y: 480 }, { x: 180, y: 380 }, { x: 380, y: 380 }, { x: 620, y: 380 },
        { x: 850, y: 680 }, { x: 1100, y: 680 }, { x: 1100, y: 520 }, { x: 600, y: 680 },
        { x: 320, y: 160 }, { x: 1000, y: 160 }
      ]
    }
  ];

  // The pads are legacy reference points kept for restoring old snapshots.
  // New runs use free placement and only use the path/core geometry below.
  // Precompute path segments and cumulative distance for every map.
  for (const map of NF.MAPS) {
    map.segments = [];
    map.length = 0;
    for (let i = 1; i < map.path.length; i += 1) {
      const a = map.path[i - 1];
      const b = map.path[i];
      const length = NF.dist(a.x, a.y, b.x, b.y);
      map.segments.push({ a, b, length, start: map.length });
      map.length += length;
    }
    map.core = map.path[map.path.length - 1];
  }

  NF.getMap = (id) => NF.MAPS.find((map) => map.id === id) || NF.MAPS[0];

  // -------------------------------------------------------------------------
  // Towers
  // -------------------------------------------------------------------------

  NF.TOWER_ORDER = ['pulse', 'cryo', 'plasma', 'hunter', 'arc'];

  NF.TOWER_DEFS = {
    pulse: {
      id: 'pulse',
      name: 'PULSE CANNON',
      short: 'PULSE',
      role: 'STANDARD DAMAGE',
      icon: '✦',
      color: '#00f0ff',
      color2: '#0077ff',
      cost: 90,
      desc: 'Schnelle Energieprojektile mit mittlerer Reichweite. Der zuverlässige Kern jeder Verteidigung.',
      base: {
        damage: 15,
        fireRate: 2.1,
        range: 155,
        projectileSpeed: 720,
        splash: 0,
        crit: 0.05,
        critMult: 1.8,
        slow: 0,
        slowDuration: 0,
        burnDps: 0,
        burnDuration: 0,
        missiles: 1,
        chains: 0,
        chainRange: 0,
        stunChance: 0,
        stunDuration: 0,
        armorPierce: 0,
        bossBonus: 0,
        bonusVsSlowed: 0,
        antiAir: 1
      },
      level: {
        damage: 0.30,
        fireRate: 0.10,
        range: 0.055,
        splash: 0.04,
        crit: 0.01
      },
      specs: {
        overdrive: {
          name: 'OVERDRIVE',
          color: '#7cf9ff',
          desc: 'Extrem hohe Feuerrate, etwas weniger Schaden pro Schuss. Perfekt gegen schnelle Ziele.',
          mult: { fireRate: 1.90, damage: 0.78, range: 1.05 },
          add: { crit: 0.03 }
        },
        power: {
          name: 'POWER CORE',
          color: '#ffe600',
          desc: 'Langsamere, aber massiv verstärkte Schüsse mit höherer Kritchance.',
          mult: { damage: 2.15, fireRate: 0.62, projectileSpeed: 1.10 },
          add: { crit: 0.06, critMult: 0.5 }
        }
      }
    },
    cryo: {
      id: 'cryo',
      name: 'CRYO TOWER',
      short: 'CRYO',
      role: 'SLOW / CONTROL',
      icon: '❄',
      color: '#7fe8ff',
      color2: '#2a76ff',
      cost: 110,
      desc: 'Eisblaue Energie verlangsamt Gegner im Zielgebiet. Unverzichtbar gegen schnelle Durchbrüche.',
      base: {
        damage: 8,
        fireRate: 1.45,
        range: 145,
        projectileSpeed: 520,
        splash: 55,
        crit: 0.03,
        critMult: 1.5,
        slow: 0.35,
        slowDuration: 2.1,
        burnDps: 0,
        burnDuration: 0,
        missiles: 1,
        chains: 0,
        chainRange: 0,
        stunChance: 0,
        stunDuration: 0,
        armorPierce: 0,
        bossBonus: 0,
        bonusVsSlowed: 0,
        antiAir: 1
      },
      level: {
        damage: 0.26,
        fireRate: 0.09,
        range: 0.05,
        splash: 0.07,
        crit: 0.005
      },
      specs: {
        permafrost: {
          name: 'PERMAFROST',
          color: '#c4f5ff',
          desc: 'Extrem starke Verlangsamung und längere Slow-Dauer. Kontrolle vor Schaden.',
          mult: { slow: 1.80, slowDuration: 1.75, splash: 1.15, damage: 0.85 }
        },
        shatter: {
          name: 'SHATTER',
          color: '#ffffff',
          desc: 'Zusätzlicher Schaden gegen bereits verlangsamte Gegner. Perfekte Synergie mit Cryo.',
          mult: { damage: 1.35, slow: 0.85, slowDuration: 0.90 },
          add: { bonusVsSlowed: 0.80 }
        }
      }
    },
    plasma: {
      id: 'plasma',
      name: 'PLASMA NOVA',
      short: 'PLASMA',
      role: 'AREA DAMAGE',
      icon: '◉',
      color: '#ff6b9d',
      color2: '#ff9d3c',
      cost: 150,
      desc: 'Explosive Plasmakugeln mit Flächenschaden und Brandeffekt. Ideal gegen dichte Gegnergruppen.',
      base: {
        damage: 26,
        fireRate: 0.80,
        range: 165,
        projectileSpeed: 430,
        splash: 72,
        crit: 0.04,
        critMult: 1.6,
        slow: 0,
        slowDuration: 0,
        burnDps: 4,
        burnDuration: 2,
        missiles: 1,
        chains: 0,
        chainRange: 0,
        stunChance: 0,
        stunDuration: 0,
        armorPierce: 0,
        bossBonus: 0,
        bonusVsSlowed: 0,
        antiAir: 1
      },
      level: {
        damage: 0.28,
        fireRate: 0.08,
        range: 0.05,
        splash: 0.08,
        crit: 0.005
      },
      specs: {
        supernova: {
          name: 'SUPERNOVA',
          color: '#ffd166',
          desc: 'Riesige Explosionen mit deutlich mehr Flächenschaden. Weniger Schüsse, mehr Wirkung.',
          mult: { splash: 1.80, damage: 1.35, fireRate: 0.90 }
        },
        inferno: {
          name: 'INFERNO',
          color: '#ff4d00',
          desc: 'Verstärkter Brand, der Gegner über längere Zeit ausbrennt. Auch gegen Bosse stark.',
          mult: { burnDps: 3.20, burnDuration: 2.00, splash: 1.20, damage: 0.90 }
        }
      }
    },
    hunter: {
      id: 'hunter',
      name: 'HUNTER MISSILE',
      short: 'HUNTER',
      role: 'HOMING / ANTI-AIR',
      icon: '➤',
      color: '#ffd75e',
      color2: '#ff0077',
      cost: 170,
      desc: 'Selbstlenkende Raketen mit hohem Einzelschaden. Verfolgt fliegende und schnelle Ziele.',
      base: {
        damage: 42,
        fireRate: 0.62,
        range: 235,
        projectileSpeed: 380,
        splash: 42,
        crit: 0.04,
        critMult: 1.7,
        slow: 0,
        slowDuration: 0,
        burnDps: 0,
        burnDuration: 0,
        missiles: 1,
        chains: 0,
        chainRange: 0,
        stunChance: 0,
        stunDuration: 0,
        armorPierce: 0,
        bossBonus: 1.15,
        bonusVsSlowed: 0,
        antiAir: 1.5
      },
      level: {
        damage: 0.29,
        fireRate: 0.09,
        range: 0.06,
        splash: 0.04,
        crit: 0.006
      },
      specs: {
        protocol: {
          name: 'HUNTER PROTOCOL',
          color: '#ffe98a',
          desc: 'Feuert zwei Raketen pro Salve und erhöht die Reichweite. Kontrolle über mehrere Ziele.',
          mult: { fireRate: 0.85, range: 1.20, damage: 0.90 },
          add: { missiles: 1 }
        },
        titan: {
          name: 'TITAN KILLER',
          color: '#ff7a00',
          desc: 'Massiver Schaden gegen Bosse und gepanzerte Ziele, mit verbesserter Panzerdurchdringung.',
          mult: { damage: 1.85, fireRate: 0.90 },
          add: { armorPierce: 0.35, bossBonus: 0.60 }
        }
      }
    },
    arc: {
      id: 'arc',
      name: 'ARC TOWER',
      short: 'ARC',
      role: 'CHAIN LIGHTNING',
      icon: 'ϟ',
      color: '#b26bff',
      color2: '#00f0ff',
      cost: 140,
      desc: 'Elektrische Blitze springen zwischen Gegnern. Perfekt gegen Schwärme und enge Gruppen.',
      base: {
        damage: 17,
        fireRate: 1.0,
        range: 150,
        projectileSpeed: 0,
        splash: 0,
        crit: 0.04,
        critMult: 1.6,
        slow: 0,
        slowDuration: 0,
        burnDps: 0,
        burnDuration: 0,
        missiles: 0,
        chains: 3,
        chainRange: 105,
        stunChance: 0.12,
        stunDuration: 0.35,
        armorPierce: 0,
        bossBonus: 0,
        bonusVsSlowed: 0,
        antiAir: 1
      },
      level: {
        damage: 0.27,
        fireRate: 0.09,
        range: 0.05,
        splash: 0,
        crit: 0.005
      },
      specs: {
        chain: {
          name: 'CHAIN REACTION',
          color: '#d4a6ff',
          desc: 'Mehr Kettensprünge und größere Sprungreichweite. Der Blitz findet fast immer ein Ziel.',
          mult: { damage: 0.90, chainRange: 1.25 },
          add: { chains: 3 }
        },
        overload: {
          name: 'OVERLOAD',
          color: '#ffe600',
          desc: 'Höherer Blitzschaden und eine deutlich stärkere Betäubungschance.',
          mult: { damage: 1.45, stunDuration: 1.30 },
          add: { stunChance: 0.25, chains: 1 }
        }
      }
    }
  };

  NF.getUpgradeCost = (def, currentLevel) => {
    const table = [0.70, 1.00, 1.40, 1.90];
    return Math.round(def.cost * table[Math.max(0, Math.min(3, currentLevel - 1))]);
  };

  NF.getSpecCost = (def) => Math.round(def.cost * 2.0);

  NF.getSellValue = (tower, sellBonus = 0) => Math.floor(tower.invested * (0.65 + sellBonus));

  // -------------------------------------------------------------------------
  // Enemies
  // -------------------------------------------------------------------------

  NF.ENEMY_DEFS = {
    scout: {
      id: 'scout',
      name: 'SCOUT DRONE',
      role: 'Schnell · wenig HP',
      hp: 34,
      speed: 105,
      radius: 11,
      reward: 7,
      coreDamage: 1,
      armor: 0,
      color: '#00f0ff',
      color2: '#0077ff',
      shape: 'scout',
      flying: false
    },
    assault: {
      id: 'assault',
      name: 'ASSAULT BOT',
      role: 'Ausbalanciert',
      hp: 85,
      speed: 62,
      radius: 15,
      reward: 11,
      coreDamage: 2,
      armor: 0.08,
      color: '#ff6b9d',
      color2: '#ff0077',
      shape: 'assault',
      flying: false
    },
    heavy: {
      id: 'heavy',
      name: 'HEAVY TANK',
      role: 'Langsam · gepanzert',
      hp: 360,
      speed: 34,
      radius: 24,
      reward: 32,
      coreDamage: 6,
      armor: 0.28,
      color: '#ffb347',
      color2: '#ff6b00',
      shape: 'heavy',
      flying: false
    },
    shield: {
      id: 'shield',
      name: 'SHIELD DRONE',
      role: 'Energieschild',
      hp: 120,
      shield: 90,
      speed: 54,
      radius: 16,
      reward: 18,
      coreDamage: 2,
      armor: 0.05,
      color: '#8b7dff',
      color2: '#5d3cff',
      shape: 'shield',
      flying: false,
      shieldRegen: 0.05
    },
    phantom: {
      id: 'phantom',
      name: 'PHANTOM',
      role: 'Schnell · tarnt sich',
      hp: 70,
      speed: 130,
      radius: 12,
      reward: 15,
      coreDamage: 2,
      armor: 0,
      color: '#ff4fd8',
      color2: '#7000ff',
      shape: 'phantom',
      flying: false,
      cloak: true
    },
    repair: {
      id: 'repair',
      name: 'REPAIR UNIT',
      role: 'Repariert Verbündete',
      hp: 110,
      speed: 48,
      radius: 15,
      reward: 20,
      coreDamage: 1,
      armor: 0.05,
      color: '#00ff66',
      color2: '#008f3a',
      shape: 'repair',
      flying: false,
      repair: true
    },
    swarm: {
      id: 'swarm',
      name: 'SWARM UNIT',
      role: 'Gruppe · niedrige HP',
      hp: 20,
      speed: 92,
      radius: 8,
      reward: 3,
      coreDamage: 1,
      armor: 0,
      color: '#ffe600',
      color2: '#ff9d00',
      shape: 'swarm',
      flying: false
    },
    elite: {
      id: 'elite',
      name: 'ELITE MECH',
      role: 'Gepanzert · Elite',
      hp: 520,
      shield: 120,
      speed: 42,
      radius: 26,
      reward: 55,
      coreDamage: 7,
      armor: 0.38,
      color: '#ff0077',
      color2: '#7000ff',
      shape: 'elite',
      flying: false,
      elite: true
    }
  };

  NF.ENEMY_ORDER = ['scout', 'assault', 'swarm', 'shield', 'heavy', 'phantom', 'repair', 'elite'];

  NF.getEnemyStats = (type, wave, difficulty) => {
    const def = NF.ENEMY_DEFS[type] || NF.ENEMY_DEFS.assault;
    const waveScale = 1 + (wave - 1) * 0.145;
    const hp = def.hp * waveScale * difficulty.hp;
    return {
      ...def,
      maxHp: hp,
      hp,
      speed: def.speed * difficulty.speed * (1 + (wave - 1) * 0.0035),
      shieldMax: (def.shield || 0) * waveScale * difficulty.hp,
      shield: (def.shield || 0) * waveScale * difficulty.hp,
      reward: Math.round(def.reward * difficulty.reward),
      coreDamage: def.coreDamage,
      armor: def.armor,
      wave
    };
  };

  // -------------------------------------------------------------------------
  // Bosses
  // -------------------------------------------------------------------------

  NF.BOSS_DEFS = {
    titan: {
      id: 'titan',
      name: 'TITAN-01',
      subtitle: 'Belagerungsmaschine',
      hp: 9000,
      speed: 24,
      radius: 48,
      reward: 500,
      coreDamage: 30,
      armor: 0.35,
      color: '#ffb347',
      color2: '#ff6b00',
      shape: 'titan',
      flying: false,
      boss: true,
      phases: 1,
      ability: 'seismic',
      abilityInterval: 8.5,
      desc: 'Ein gigantischer Kampfroboter mit schwerer Panzerung. Erschüttert Türme und ruft Verstärkung.'
    },
    void: {
      id: 'void',
      name: 'VOID DESTROYER',
      subtitle: 'Phasenkreuzer',
      hp: 15000,
      speed: 55,
      radius: 44,
      reward: 800,
      coreDamage: 35,
      armor: 0.15,
      shield: 5000,
      color: '#b26bff',
      color2: '#00f0ff',
      shape: 'void',
      flying: true,
      boss: true,
      phases: 2,
      ability: 'phase',
      abilityInterval: 7.5,
      desc: 'Ein fliegendes Kriegsschiff mit Energieschild. Wechselt die Phase und beschwört Phantome.'
    },
    omega: {
      id: 'omega',
      name: 'OMEGA CORE',
      subtitle: 'Finale Maschine',
      hp: 26000,
      speed: 32,
      radius: 56,
      reward: 1500,
      coreDamage: 50,
      armor: 0.30,
      shield: 8000,
      color: '#ff0077',
      color2: '#7000ff',
      shape: 'omega',
      flying: false,
      boss: true,
      phases: 3,
      ability: 'omega',
      abilityInterval: 6.5,
      desc: 'Der finale Maschinengegner. Drei Phasen, wechselnde Fähigkeiten und eine verheerende finale Explosion.'
    }
  };

  NF.getBossStats = (bossType, difficulty) => {
    const def = NF.BOSS_DEFS[bossType] || NF.BOSS_DEFS.titan;
    const hp = def.hp * difficulty.bossHp;
    return {
      ...def,
      maxHp: hp,
      hp,
      speed: def.speed * difficulty.speed,
      shieldMax: (def.shield || 0) * difficulty.bossHp,
      shield: (def.shield || 0) * difficulty.bossHp,
      reward: Math.round(def.reward * difficulty.reward),
      coreDamage: def.coreDamage
    };
  };

  // -------------------------------------------------------------------------
  // Difficulties
  // -------------------------------------------------------------------------

  NF.DIFFICULTIES = {
    easy: {
      id: 'easy',
      name: 'RECRUIT',
      label: 'EASY',
      color: '#00ff66',
      desc: 'Mehr Startguthaben, stabiler Kern und langsameres Gegnerwachstum. Ideal zum Einstieg.',
      hp: 0.80,
      speed: 0.92,
      count: 0.85,
      startCredits: 700,
      coreHP: 150,
      reward: 1.00,
      xp: 0.90,
      research: 0.90,
      bossHp: 0.80,
      bossEscort: 0.80,
      special: 0.70
    },
    normal: {
      id: 'normal',
      name: 'OPERATIVE',
      label: 'NORMAL',
      color: '#00f0ff',
      desc: 'Ausbalancierte Gegnerwerte, normale Startressourcen und das Referenz-Balancing.',
      hp: 1.00,
      speed: 1.00,
      count: 1.00,
      startCredits: 520,
      coreHP: 120,
      reward: 1.00,
      xp: 1.00,
      research: 1.00,
      bossHp: 1.00,
      bossEscort: 1.00,
      special: 1.00
    },
    hard: {
      id: 'hard',
      name: 'VETERAN',
      label: 'HARD',
      color: '#ffe600',
      desc: 'Mehr HP, höhere Geschwindigkeit, weniger Startguthaben und gefährlichere Gegnermischungen.',
      hp: 1.32,
      speed: 1.08,
      count: 1.15,
      startCredits: 400,
      coreHP: 100,
      reward: 1.15,
      xp: 1.15,
      research: 1.20,
      bossHp: 1.30,
      bossEscort: 1.20,
      special: 1.25
    },
    nightmare: {
      id: 'nightmare',
      name: 'EXTINCTION',
      label: 'NIGHTMARE',
      color: '#ff0077',
      desc: 'Brutale Gegner, knappe Ressourcen, zusätzliche Bossfähigkeiten. Nur für echte Kommandanten.',
      hp: 1.70,
      speed: 1.16,
      count: 1.30,
      startCredits: 320,
      coreHP: 85,
      reward: 1.35,
      xp: 1.35,
      research: 1.45,
      bossHp: 1.65,
      bossEscort: 1.45,
      special: 1.60
    }
  };

  NF.DIFFICULTY_ORDER = ['easy', 'normal', 'hard', 'nightmare'];

  // -------------------------------------------------------------------------
  // Wave composition
  // -------------------------------------------------------------------------

  NF.BOSS_WAVES = { 10: 'titan', 20: 'void', 30: 'omega' };
  NF.FINAL_WAVE = 30;

  NF.getWavePlan = (wave, difficulty) => {
    const bossType = NF.BOSS_WAVES[wave] || null;
    const types = [];

    if (bossType) {
      const escortCount = Math.round((8 + wave * 0.25) * difficulty.bossEscort);
      for (let i = 0; i < escortCount; i += 1) {
        const pool = wave >= 20 ? ['assault', 'shield', 'phantom', 'elite', 'heavy'] : ['scout', 'assault', 'swarm', 'shield'];
        types.push(pool[i % pool.length]);
      }
      types.push(`boss:${bossType}`);
    } else {
      const count = Math.max(4, Math.round((7 + wave * 1.35) * difficulty.count));
      const special = difficulty.special;
      const counts = {
        scout: 0,
        assault: 0,
        swarm: 0,
        shield: 0,
        heavy: 0,
        phantom: 0,
        repair: 0,
        elite: 0
      };

      counts.scout = Math.max(1, Math.round((3 + Math.max(0, 4 - wave) * 1.2) * difficulty.count));
      counts.assault = Math.max(1, Math.round((3 + Math.min(5, wave * 0.45)) * difficulty.count));
      if (wave >= 4) counts.swarm = Math.round((wave - 3) * 0.42 * special * difficulty.count);
      if (wave >= 6) counts.shield = Math.round((wave - 5) * 0.24 * special * difficulty.count);
      if (wave >= 7) counts.heavy = Math.round((wave - 6) * 0.22 * special * difficulty.count);
      if (wave >= 9) counts.phantom = Math.round((wave - 8) * 0.25 * special * difficulty.count);
      if (wave >= 11) counts.repair = Math.min(4, Math.round((wave - 10) * 0.18 * special));
      if (wave >= 14) counts.elite = Math.min(7, Math.round((wave - 13) * 0.16 * special));

      let used = 0;
      for (const type of NF.ENEMY_ORDER) used += counts[type] || 0;
      const filler = Math.max(0, count - used);
      counts.assault += Math.ceil(filler * 0.55);
      counts.scout += Math.floor(filler * 0.45);

      for (const type of NF.ENEMY_ORDER) {
        const amount = Math.max(0, counts[type] || 0);
        for (let i = 0; i < amount; i += 1) types.push(type);
      }

      // Shuffle the composition deterministically so every wave feels mixed
      // but remains reproducible for the same wave/difficulty pair.
      const random = NF.createSeededRandom(wave * 9173 + difficulty.id.length * 313);
      for (let i = types.length - 1; i > 0; i -= 1) {
        const j = Math.floor(random() * (i + 1));
        [types[i], types[j]] = [types[j], types[i]];
      }
    }

    const interval = bossType ? 1.05 : Math.max(0.24, 0.62 - wave * 0.008);
    const rewardCredits = Math.round((55 + wave * 14) * difficulty.reward + (bossType ? 180 : 0));
    const rewardResearch = Math.round((2 + Math.floor(wave / 4)) * difficulty.research + (bossType ? 10 : 0));

    return {
      wave,
      bossType,
      types,
      total: types.length,
      interval,
      rewardCredits,
      rewardResearch,
      isBoss: Boolean(bossType)
    };
  };

  // -------------------------------------------------------------------------
  // Technology tree (persistent research)
  // -------------------------------------------------------------------------

  NF.TECH_BRANCHES = [
    {
      id: 'offense',
      name: 'OFFENSIVE',
      color: '#ff0077',
      icon: '✦',
      desc: 'Direkter Turmschaden und kritische Treffer.',
      nodes: [
        { id: 'off1', name: 'Fokussierte Ladung', cost: 6, desc: '+8% Schaden aller Türme.', effect: { damage: 0.08 } },
        { id: 'off2', name: 'Kritische Matrix', cost: 10, desc: '+5% Kritchance für alle Türme.', effect: { crit: 0.05 }, req: 'off1' },
        { id: 'off3', name: 'Übertaktete Läufe', cost: 15, desc: '+7% Angriffsgeschwindigkeit.', effect: { fireRate: 0.07 }, req: 'off2' },
        { id: 'off4', name: 'Bossbrecher', cost: 22, desc: '+15% Schaden gegen Bosse.', effect: { bossDamage: 0.15 }, req: 'off3' }
      ]
    },
    {
      id: 'defense',
      name: 'DEFENSIVE',
      color: '#00f0ff',
      icon: '◈',
      desc: 'Der Energiekern und seine passive Verteidigung.',
      nodes: [
        { id: 'def1', name: 'Kernpanzerung', cost: 6, desc: '+25 maximale Kern-HP.', effect: { coreMax: 25 } },
        { id: 'def2', name: 'Nanitenschicht', cost: 10, desc: 'Kern regeneriert 0,4 HP pro Sekunde.', effect: { coreRegen: 0.4 }, req: 'def1' },
        { id: 'def3', name: 'Absorptionsfeld', cost: 15, desc: 'Kern erleidet 8% weniger Schaden.', effect: { coreArmor: 0.08 }, req: 'def2' },
        { id: 'def4', name: 'Notfallschild', cost: 22, desc: 'Kern erhält einen 20-Punkte-Schild pro Welle.', effect: { coreShield: 20 }, req: 'def3' }
      ]
    },
    {
      id: 'economy',
      name: 'WIRTSCHAFT',
      color: '#ffe600',
      icon: '◈',
      desc: 'Credits, Upgrades und langfristige Effizienz.',
      nodes: [
        { id: 'eco1', name: 'Beuteoptimierung', cost: 6, desc: '+10% Credits aus Kills.', effect: { credits: 0.10 } },
        { id: 'eco2', name: 'Modulare Bauweise', cost: 10, desc: 'Turm-Upgrades kosten 8% weniger.', effect: { upgradeDiscount: 0.08 }, req: 'eco1' },
        { id: 'eco3', name: 'Startreserve', cost: 15, desc: '+80 Start-Credits pro Runde.', effect: { startCredits: 80 }, req: 'eco2' },
        { id: 'eco4', name: 'Rückbauprotokoll', cost: 22, desc: '+10% Verkaufswert für Türme.', effect: { sellBonus: 0.10 }, req: 'eco3' }
      ]
    },
    {
      id: 'special',
      name: 'SPEZIALTECH',
      color: '#b26bff',
      icon: '⌬',
      desc: 'Fähigkeiten, Energie und verbotene Systeme.',
      nodes: [
        { id: 'spe1', name: 'Reaktorüberladung', cost: 6, desc: '+0,6 Energie-Regeneration pro Sekunde.', effect: { energyRegen: 0.6 } },
        { id: 'spe2', name: 'Fokuslinse', cost: 10, desc: '+15% Schaden aller Spezialfähigkeiten.', effect: { abilityPower: 0.15 }, req: 'spe1' },
        { id: 'spe3', name: 'Schnellzyklus', cost: 15, desc: '−10% Abklingzeit aller Fähigkeiten.', effect: { cooldownReduction: 0.10 }, req: 'spe2' },
        { id: 'spe4', name: 'Overclock-Protokoll', cost: 22, desc: 'Overcharge verstärkt Türme zusätzlich um 20%.', effect: { overchargeBoost: 0.20 }, req: 'spe3' }
      ]
    }
  ];

  NF.TECH_NODE_MAP = {};
  for (const branch of NF.TECH_BRANCHES) {
    for (const node of branch.nodes) {
      NF.TECH_NODE_MAP[node.id] = { ...node, branchId: branch.id, branchName: branch.name, color: branch.color };
    }
  }

  NF.getTechEffects = (owned = {}) => {
    const effects = {};
    for (const id of Object.keys(owned)) {
      if (!owned[id]) continue;
      const node = NF.TECH_NODE_MAP[id];
      if (!node) continue;
      for (const [key, value] of Object.entries(node.effect || {})) {
        effects[key] = (effects[key] || 0) + value;
      }
    }
    return effects;
  };

  // -------------------------------------------------------------------------
  // Permanent doctrine upgrades (level points)
  // -------------------------------------------------------------------------

  NF.DOCTRINE_UPGRADES = [
    {
      id: 'core',
      name: 'KERNINTEGRITÄT',
      icon: '◈',
      desc: '+20 maximale Kern-HP pro Stufe.',
      max: 5,
      effect: { coreMax: 20 }
    },
    {
      id: 'logistics',
      name: 'LOGISTIK',
      icon: '▣',
      desc: '+40 Start-Credits pro Stufe.',
      max: 5,
      effect: { startCredits: 40 }
    },
    {
      id: 'targeting',
      name: 'ZIELERFASSUNG',
      icon: '⌖',
      desc: '+3% Turmschaden pro Stufe.',
      max: 5,
      effect: { damage: 0.03 }
    },
    {
      id: 'reactor',
      name: 'REAKTOR',
      icon: 'ϟ',
      desc: '+0,5 Energie-Regeneration pro Stufe.',
      max: 5,
      effect: { energyRegen: 0.5 }
    },
    {
      id: 'salvage',
      name: 'BERGUNG',
      icon: '♻',
      desc: '+5% Verkaufswert pro Stufe.',
      max: 5,
      effect: { sellBonus: 0.05 }
    }
  ];

  NF.getDoctrineEffects = (levels = {}) => {
    const effects = {};
    for (const upgrade of NF.DOCTRINE_UPGRADES) {
      const level = Math.max(0, Math.min(upgrade.max, levels[upgrade.id] || 0));
      if (!level) continue;
      for (const [key, value] of Object.entries(upgrade.effect)) {
        effects[key] = (effects[key] || 0) + value * level;
      }
    }
    return effects;
  };

  // -------------------------------------------------------------------------
  // Active abilities
  // -------------------------------------------------------------------------

  NF.ABILITIES = [
    {
      id: 'orbital',
      name: 'ORBITAL STRIKE',
      short: 'ORBITAL',
      key: '1',
      icon: '☄',
      color: '#00f0ff',
      cost: 45,
      cooldown: 28,
      radius: 140,
      damage: 260,
      desc: 'Ein orbitaler Energiestrahl trifft den markierten Bereich und verursacht massiven Schaden.'
    },
    {
      id: 'emp',
      name: 'EMP BLAST',
      short: 'EMP',
      key: '2',
      icon: '⌁',
      color: '#b26bff',
      cost: 35,
      cooldown: 24,
      radius: 260,
      stun: 2.8,
      desc: 'Betäubt alle Gegner im Zielradius. Bosse werden nur kurzzeitig gelähmt.'
    },
    {
      id: 'repair',
      name: 'REPAIR PROTOCOL',
      short: 'REPAIR',
      key: '3',
      icon: '✚',
      color: '#00ff66',
      cost: 40,
      cooldown: 32,
      heal: 0.30,
      desc: 'Repariert 30% der maximalen Lebenspunkte des Energiekerns.'
    },
    {
      id: 'overcharge',
      name: 'OVERCHARGE',
      short: 'OVERCHARGE',
      key: '4',
      icon: '⚡',
      color: '#ffe600',
      cost: 50,
      cooldown: 36,
      duration: 8,
      rate: 1.8,
      desc: 'Erhöht für 8 Sekunden die Angriffsgeschwindigkeit aller Türme um 80%.'
    }
  ];

  NF.ABILITY_MAP = Object.fromEntries(NF.ABILITIES.map((ability) => [ability.id, ability]));

  // -------------------------------------------------------------------------
  // Achievements
  // -------------------------------------------------------------------------

  NF.ACHIEVEMENTS = [
    { id: 'first_blood', name: 'ERSTER KONTAKT', desc: 'Zerstöre den ersten Gegner.', icon: '✦' },
    { id: 'wave10', name: 'VORPOSTEN', desc: 'Erreiche Welle 10.', icon: '10' },
    { id: 'first_boss', name: 'TITANENJÄGER', desc: 'Besiege deinen ersten Boss.', icon: '☠' },
    { id: 'architect', name: 'ARCHITEKT', desc: 'Baue fünf Türme in einer Runde.', icon: '▦' },
    { id: 'centurion', name: 'CENTURION', desc: 'Zerstöre insgesamt 100 Gegner.', icon: '100' },
    { id: 'tech_pioneer', name: 'TECH-PIONIER', desc: 'Schalte fünf Technologie-Knoten frei.', icon: '⌬' },
    { id: 'nightmare_win', name: 'EXTINCTION', desc: 'Gewinne eine Runde auf NIGHTMARE.', icon: '☠' },
    { id: 'omega', name: 'OMEGA FALL', desc: 'Besiege den Omega Core.', icon: 'Ω' },
    { id: 'untouchable', name: 'UNBERÜHRT', desc: 'Besiege einen Boss ohne Kernschaden in dieser Welle.', icon: '◇' },
    { id: 'max_tower', name: 'MAXIMUM OUTPUT', desc: 'Bringe einen Turm auf Level 5.', icon: 'V' }
  ];

  // -------------------------------------------------------------------------
  // Cosmetic skins
  // -------------------------------------------------------------------------

  NF.SKINS = [
    { id: 'standard', name: 'STANDARD', desc: 'Werkslackierung der Verteidigungsdivision.', a: '#00f0ff', b: '#0077ff', unlock: null },
    { id: 'arctic', name: 'ARCTIC', desc: 'Freischaltung: Titan-01 besiegen.', a: '#b9f5ff', b: '#4b8cff', unlock: 'first_boss' },
    { id: 'solar', name: 'SOLAR', desc: 'Freischaltung: Welle 10 erreichen.', a: '#ffe600', b: '#ff6b00', unlock: 'wave10' },
    { id: 'void', name: 'VOID', desc: 'Freischaltung: Omega Core besiegen.', a: '#d4a6ff', b: '#7000ff', unlock: 'omega' }
  ];

  // -------------------------------------------------------------------------
  // Level curve
  // -------------------------------------------------------------------------

  NF.xpForNextLevel = (level) => 80 + (level - 1) * 65;

  NF.applyLevelUps = (profile) => {
    let gained = 0;
    while (profile.level < 30) {
      const needed = NF.xpForNextLevel(profile.level);
      if (profile.xp < needed) break;
      profile.xp -= needed;
      profile.level += 1;
      profile.doctrinePoints += 1;
      gained += 1;
    }
    if (profile.level >= 30) profile.xp = Math.min(profile.xp, NF.xpForNextLevel(30));
    return gained;
  };

  // -------------------------------------------------------------------------
  // Default profile / run snapshot templates
  // -------------------------------------------------------------------------

  NF.createDefaultProfile = () => ({
    version: 1,
    xp: 0,
    level: 1,
    doctrinePoints: 1,
    doctrine: {},
    tech: {},
    research: 0,
    achievements: {},
    settings: {
      music: 0.30,
      sfx: 0.70,
      particles: true,
      shake: true,
      damageNumbers: true,
      autoStart: false,
      speed: 1
    },
    selectedMap: 'neon-city',
    selectedDifficulty: 'normal',
    selectedSkin: 'standard',
    stats: {
      games: 0,
      wins: 0,
      losses: 0,
      bestWave: 0,
      totalKills: 0,
      bossKills: 0,
      totalPlayTime: 0,
      highScore: 0,
      bestDifficulty: '',
      favoriteTower: 'pulse',
      towerUses: { pulse: 0, cryo: 0, plasma: 0, hunter: 0, arc: 0 }
    },
    lastRun: null,
    createdAt: Date.now(),
    updatedAt: Date.now()
  });

  NF.createRunSnapshot = () => ({
    version: 1,
    mapId: 'neon-city',
    difficulty: 'normal',
    wave: 0,
    credits: 0,
    coreHp: 120,
    coreMax: 120,
    coreShield: 0,
    energy: 100,
    time: 0,
    score: 0,
    kills: 0,
    bossesKilled: 0,
    towers: [],
    towerUses: { pulse: 0, cryo: 0, plasma: 0, hunter: 0, arc: 0 },
    abilityCooldowns: {},
    overchargeTimer: 0,
    savedAt: Date.now()
  });

  // Convenience formatting used by both UI and renderer.
  NF.formatDuration = (seconds) => {
    if (seconds >= 60) return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
    return `${Math.ceil(seconds)}s`;
  };
})();
