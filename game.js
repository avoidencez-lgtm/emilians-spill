/*
 * Gorilla-rytter — et HTML5 Canvas-spill for Emilian (6).
 *
 * Systemoversikt:
 *  - BOOT:       henter canvas, setter logisk oppløsning 480x270, skalerer til viewport.
 *  - SCENE:      tre scener: TITLE, PLAY, GAMEOVER (med poeng-feiring + konfetti).
 *  - ENTITIES:   spiller (gorilla + human-rytter), elefanter, t-rex-boss, pickups,
 *                fotballer, fugler, partikler/konfetti. Alle tegnes med fillRect.
 *  - CONTROLS:   touch + mus + tastatur. Tap=hopp, SLÅ-knapp eller X=slag.
 *  - POWERUP:    BANAN-meter. Full meter (eller marshmallow) => "GÅ BANANAS!"
 *                — udødelig regnbue-modus med x3 poeng og egen musikk.
 *  - AUDIO:      WebAudio. Glad loopende chiptune-melodi + beeps. LYD-knapp i HUD.
 *  - SAVE:       beste poengsum lagres i localStorage ("REKORD").
 *  - LIFECYCLE:  requestAnimationFrame med fast dt-clamp. Ingen GC-churn i hot loop.
 */

(() => {
  'use strict';

  // -------------------------------------------------------------------------
  // BOOT
  // -------------------------------------------------------------------------
  const W = 480, H = 270;            // logical resolution
  const GROUND_Y = 220;              // top of ground in logical pixels
  const BANANA_MAX = 6;              // bananas needed to fill the meter
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // Scale canvas to viewport while preserving aspect.
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const vw = window.innerWidth, vh = window.innerHeight;
    const scale = Math.min(vw / W, vh / H);
    canvas.width  = Math.floor(W * scale * dpr);
    canvas.height = Math.floor(H * scale * dpr);
    canvas.style.width  = Math.floor(W * scale) + 'px';
    canvas.style.height = Math.floor(H * scale) + 'px';
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
  }
  window.addEventListener('resize', resize);
  resize();

  // -------------------------------------------------------------------------
  // SAVE  (best score in localStorage)
  // -------------------------------------------------------------------------
  function loadBest() {
    try { return parseInt(localStorage.getItem('emilian_best') || '0', 10) || 0; }
    catch (e) { return 0; }
  }
  function saveBest(v) {
    try { localStorage.setItem('emilian_best', String(v)); } catch (e) {}
  }

  // -------------------------------------------------------------------------
  // AUDIO  (WebAudio beeps + a happy looping chiptune)
  // -------------------------------------------------------------------------
  let audioCtx = null;
  let muted = false;
  let musicStarted = false;

  function ensureAudio() {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (e) { audioCtx = null; }
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    if (audioCtx && !musicStarted) {
      musicStarted = true;
      music.nextTime = audioCtx.currentTime + 0.1;
      setInterval(scheduleMusic, 30);
    }
  }

  // One-shot beep (sound effects).
  function beep(freq, dur, type, vol) {
    if (muted || !audioCtx) return;
    const t0 = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type || 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(vol || 0.15, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }
  const sfx = {
    jump:   () => beep(540, 0.10, 'square', 0.10),
    djump:  () => beep(720, 0.10, 'square', 0.10),
    punch:  () => { beep(200, 0.08, 'square', 0.18); setTimeout(() => beep(120, 0.10, 'sawtooth', 0.15), 40); },
    pickup: () => { beep(880, 0.06, 'sine', 0.12); setTimeout(() => beep(1320, 0.08, 'sine', 0.12), 50); },
    banana: () => { beep(700, 0.05, 'square', 0.10); setTimeout(() => beep(1050, 0.07, 'square', 0.10), 45); },
    pancake:() => { beep(660, 0.08, 'sine', 0.15); setTimeout(() => beep(990, 0.10, 'sine', 0.15), 60); },
    star:   () => { beep(784, 0.05, 'sine', 0.12); setTimeout(()=>beep(988, 0.05, 'sine', 0.12), 50); setTimeout(()=>beep(1319, 0.10, 'sine', 0.12), 100); },
    boss:   () => { beep(110, 0.18, 'sawtooth', 0.18); setTimeout(() => beep(90, 0.18, 'sawtooth', 0.18), 100); },
    hurt:   () => { beep(180, 0.12, 'square', 0.18); setTimeout(() => beep(140, 0.14, 'square', 0.15), 80); },
    win:    () => { beep(523, 0.10, 'sine', 0.15); setTimeout(()=>beep(659, 0.10, 'sine', 0.15), 110); setTimeout(()=>beep(784, 0.10, 'sine', 0.15), 220); setTimeout(()=>beep(1046, 0.18, 'sine', 0.15), 330); },
    fanfare:() => { const s=[523,659,784,1046,1319]; s.forEach((f,i)=>setTimeout(()=>beep(f,0.16,'square',0.16),i*90)); },
    kick:   () => beep(380, 0.08, 'triangle', 0.14)
  };

  // --- Background music: a tiny note scheduler with lookahead -------------
  // Each tune entry is [freq(0=rest), beats]; bass plays roots on downbeats.
  const TUNE_NORMAL = {
    beat: 0.16,
    lead: [659,659,784,1047, 880,784,659,587, 523,659,784,880, 784,659,587,0],
    bass: [131,131,196,196, 175,175,196,131]
  };
  const TUNE_BANANA = {
    beat: 0.115,
    lead: [1047,988,1047,1175, 1047,880,784,880, 1047,1175,1319,1175, 1047,880,1047,0],
    bass: [262,262,196,196, 349,349,392,392]
  };
  const music = { tune: TUNE_NORMAL, idx: 0, nextTime: 0 };

  function setTune(t) { music.tune = t; /* keep idx so it flows */ }

  function playNote(freq, dur, when, type, vol) {
    if (!audioCtx) return;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(vol, when + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur * 0.92);
    o.connect(g).connect(audioCtx.destination);
    o.start(when);
    o.stop(when + dur);
  }

  function scheduleMusic() {
    if (!audioCtx) return;
    const ahead = audioCtx.currentTime + 0.15;
    // If we fell behind (tab was hidden), resync.
    if (music.nextTime < audioCtx.currentTime - 0.5) music.nextTime = audioCtx.currentTime + 0.05;
    let guard = 0;
    while (music.nextTime < ahead && guard++ < 32) {
      const tune = music.tune;
      const lead = tune.lead;
      const f = lead[music.idx % lead.length];  // each lead step is one beat
      const d = tune.beat;
      if (!muted && f > 0) playNote(f, d, music.nextTime, 'triangle', 0.05);
      if (!muted && (music.idx % 2) === 0) {
        const b = tune.bass[((music.idx / 2) | 0) % tune.bass.length];
        if (b > 0) playNote(b, tune.beat * 2, music.nextTime, 'sine', 0.045);
      }
      music.nextTime += d;
      music.idx++;
    }
  }

  // -------------------------------------------------------------------------
  // INPUT
  // -------------------------------------------------------------------------
  const input = {
    pressed: false,
    pressStart: 0,
    tapQueued: false,
    punchQueued: false,
    punchFlash: 0
  };

  function pressBegin(t) {
    input.pressed = true;
    input.pressStart = t;
    input.tapQueued = true;
    ensureAudio();
  }
  function pressEnd() { input.pressed = false; }

  const PUNCH_BTN = { w: 72, h: 56 };
  function punchBtnRect() {
    return { x: W - PUNCH_BTN.w - 6, y: H - PUNCH_BTN.h - 6, w: PUNCH_BTN.w, h: PUNCH_BTN.h };
  }
  const KICK_BTN = { w: 60, h: 56 };
  function kickBtnRect() {
    return { x: 6, y: H - KICK_BTN.h - 6, w: KICK_BTN.w, h: KICK_BTN.h };
  }
  function pointInRect(px, py, r) {
    return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
  }

  // Touch
  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const t = e.changedTouches[0];
    const lx = (t.clientX - rect.left) * (W / rect.width);
    const ly = (t.clientY - rect.top)  * (H / rect.height);
    if (handleHudTap(lx, ly)) return;
    pressBegin(performance.now());
  }, { passive: false });
  canvas.addEventListener('touchend', (e) => { e.preventDefault(); pressEnd(); }, { passive: false });
  canvas.addEventListener('touchcancel', (e) => { e.preventDefault(); pressEnd(); }, { passive: false });

  // Mouse (desktop testing)
  canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const lx = (e.clientX - rect.left) * (W / rect.width);
    const ly = (e.clientY - rect.top)  * (H / rect.height);
    if (handleHudTap(lx, ly)) return;
    pressBegin(performance.now());
  });
  window.addEventListener('mouseup', () => pressEnd());

  // Keyboard: Space=jump, X=punch, M=mute, F=football-kick
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.code === 'Space') { e.preventDefault(); pressBegin(performance.now()); }
    else if (e.code === 'KeyX') {
      e.preventDefault();
      input.punchQueued = true;
      input.punchFlash = 0.12;
      ensureAudio();
    }
    else if (e.code === 'KeyF') { if (state.footballTime > 0) kickFootball(); }
    else if (e.code === 'KeyM') { muted = !muted; }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') pressEnd();
  });

  function handleHudTap(lx, ly) {
    // Mute button top-right
    if (lx > W - 30 && lx < W - 2 && ly > 2 && ly < 26) {
      muted = !muted;
      return true;
    }
    if (scene === 'TITLE' || scene === 'GAMEOVER') {
      startGame();
      return true;
    }
    if (scene === 'PLAY' && pointInRect(lx, ly, punchBtnRect())) {
      input.punchQueued = true;
      input.punchFlash = 0.12;
      ensureAudio();
      return true;
    }
    if (state.footballTime > 0 && pointInRect(lx, ly, kickBtnRect())) {
      kickFootball();
      return true;
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // GAME STATE
  // -------------------------------------------------------------------------
  let scene = 'TITLE'; // TITLE | PLAY | GAMEOVER
  const state = {
    time: 0,
    score: 0,
    lives: 3,
    invuln: 0,
    combo: 0,
    comboTimer: 0,
    scrollX: 0,
    scrollSpeed: 80,
    spawnTimer: 0,
    pickupTimer: 0,
    birdTimer: 3,
    bossTimer: 30,
    bossActive: false,
    footballTime: 0,
    footballNext: 60,
    bananas: 0,          // 0..BANANA_MAX
    bananaMode: 0,       // remaining seconds of GÅ BANANAS rampage
    nextMilestone: 50,
    best: loadBest(),
    newRecord: false,
    flashText: null,
    screenFlash: 0,
    cameraShake: 0
  };
  const player = {
    x: 80, y: GROUND_Y - 40,
    vy: 0,
    w: 32, h: 40,
    onGround: true,
    jumpsLeft: 2,
    punching: 0,
    punchCooldown: 0,
    facing: 1,
    runFrame: 0
  };
  // Reusable pools
  const elephants = [];
  const pickups = [];
  const particles = [];
  const footballs = [];
  const birds = [];
  let boss = null;

  function resetState() {
    state.time = 0;
    state.score = 0;
    state.lives = 3;
    state.invuln = 0;
    state.combo = 0;
    state.comboTimer = 0;
    state.scrollX = 0;
    state.scrollSpeed = 80;
    state.spawnTimer = 2.0;
    state.pickupTimer = 1.4;
    state.birdTimer = 3;
    state.bossTimer = 30;
    state.bossActive = false;
    state.footballTime = 0;
    state.footballNext = 60;
    state.bananas = 0;
    state.bananaMode = 0;
    state.nextMilestone = 50;
    state.newRecord = false;
    state.flashText = null;
    state.screenFlash = 0;
    state.cameraShake = 0;
    player.x = 80; player.y = GROUND_Y - 40;
    player.vy = 0; player.onGround = true; player.jumpsLeft = 2;
    player.punching = 0; player.punchCooldown = 0;
    elephants.length = 0;
    pickups.length = 0;
    particles.length = 0;
    footballs.length = 0;
    birds.length = 0;
    boss = null;
  }

  function startGame() {
    ensureAudio();
    resetState();
    setTune(TUNE_NORMAL);
    scene = 'PLAY';
  }

  function endGame() {
    scene = 'GAMEOVER';
    setTune(TUNE_NORMAL);
    if (state.score > state.best) {
      state.best = state.score;
      state.newRecord = true;
      saveBest(state.best);
      confetti(60);
      sfx.fanfare();
    } else {
      confetti(28);
      sfx.win();
    }
  }

  // -------------------------------------------------------------------------
  // ENTITY SPAWNERS
  // -------------------------------------------------------------------------
  function spawnElephant() {
    elephants.push({
      x: W + 20,
      y: GROUND_Y - 30,
      w: 44, h: 30,
      vx: -(40 + Math.random() * 30),
      knocked: 0,
      bobT: Math.random() * 6
    });
  }
  function spawnPickup() {
    // Bananas are common (they fill the meter); coconut/star/pancake/mallow rarer.
    const kinds = ['banana', 'banana', 'banana', 'coconut', 'coconut', 'star', 'pancake', 'mallow'];
    const k = kinds[(Math.random() * kinds.length) | 0];
    pickups.push({
      x: W + 16,
      y: GROUND_Y - 60 - Math.random() * 90,
      w: 16, h: 16,
      kind: k,
      bobT: Math.random() * 6
    });
  }
  function spawnBird() {
    birds.push({
      x: W + 10,
      y: 30 + Math.random() * 80,
      vx: -(30 + Math.random() * 30),
      flap: Math.random() * 6,
      color: ['#ffffff', '#fff3b0', '#ffd1e8'][(Math.random() * 3) | 0]
    });
  }
  function spawnBoss() {
    state.bossActive = true;
    boss = {
      x: W + 20,
      y: GROUND_Y - 56,
      w: 52, h: 56,
      vx: -50,
      hp: 3,
      knocked: 0,
      stomp: 0
    };
    sfx.boss();
    flash('PASS PÅ! T-REX!', '#ff5b5b', 1.6);
  }
  function flash(text, color, dur) {
    state.flashText = { text, color, timer: dur || 1.2, born: state.time };
  }

  function kickFootball() {
    if (state.footballTime <= 0) return;
    footballs.push({
      x: player.x + player.w,
      y: player.y + 10,
      vx: 220, vy: -120,
      r: 6, t: 0
    });
    sfx.kick();
  }

  // Particle helpers
  function burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      particles.push({
        x, y,
        vx: (Math.random() - 0.5) * 160,
        vy: (Math.random() - 1) * 120,
        life: 0.6 + Math.random() * 0.4,
        color,
        size: 2 + (Math.random() * 2) | 0
      });
    }
  }
  function sparkle(x, y) {
    for (let i = 0; i < 4; i++) {
      particles.push({
        x, y,
        vx: (Math.random() - 0.5) * 60,
        vy: -20 - Math.random() * 40,
        life: 0.5,
        color: ['#ffeb3b', '#fff176', '#ffffff', '#ffd54f'][i],
        size: 2
      });
    }
  }
  const CONFETTI_COLORS = ['#ff5b5b', '#ffb05b', '#ffeb5b', '#5bff5b', '#5bb0ff', '#b05bff', '#ff7eb6', '#ffffff'];
  function confetti(n) {
    for (let i = 0; i < n; i++) {
      particles.push({
        x: Math.random() * W,
        y: -10 - Math.random() * 30,
        vx: (Math.random() - 0.5) * 90,
        vy: 40 + Math.random() * 120,
        life: 1.3 + Math.random() * 0.9,
        color: CONFETTI_COLORS[(Math.random() * CONFETTI_COLORS.length) | 0],
        size: 3 + ((Math.random() * 2) | 0)
      });
    }
  }

  // -------------------------------------------------------------------------
  // POWER-UP: GÅ BANANAS
  // -------------------------------------------------------------------------
  function triggerBananas() {
    state.bananaMode = 6.0;
    state.bananas = 0;
    setTune(TUNE_BANANA);
    flash('GÅ BANANAS!', '#ffeb3b', 1.5);
    confetti(34);
    state.cameraShake = 0.3;
    state.screenFlash = 0.25;
    sfx.win();
  }

  // -------------------------------------------------------------------------
  // UPDATE
  // -------------------------------------------------------------------------
  function update(dt) {
    if (scene !== 'PLAY') {
      updateParticles(dt);
      updateBirds(dt);
      input.tapQueued = false;
      input.punchQueued = false;
      return;
    }

    state.time += dt;
    if (state.invuln > 0) state.invuln -= dt;
    if (state.comboTimer > 0) { state.comboTimer -= dt; if (state.comboTimer <= 0) state.combo = 0; }
    if (state.cameraShake > 0) state.cameraShake -= dt;
    if (state.screenFlash > 0) state.screenFlash -= dt;
    if (state.flashText) { state.flashText.timer -= dt; if (state.flashText.timer <= 0) state.flashText = null; }

    // Banana rampage timer
    if (state.bananaMode > 0) {
      state.bananaMode -= dt;
      if (state.bananaMode <= 0) {
        state.bananaMode = 0;
        setTune(TUNE_NORMAL);
        flash('JIPPI!', '#7cff7c', 0.9);
      }
    }

    // Scroll speed ramps gently with time; bananas mode speeds it up.
    const baseSpeed = 80 + Math.min(60, state.time * 1.2);
    state.scrollSpeed = baseSpeed * (state.bananaMode > 0 ? 1.6 : 1);
    state.scrollX += state.scrollSpeed * dt;

    // ---- INPUT: jump on tap edge ----
    if (input.tapQueued) {
      input.tapQueued = false;
      if (player.jumpsLeft > 0) {
        player.vy = -200;
        player.jumpsLeft -= 1;
        player.onGround = false;
        if (player.jumpsLeft === 1) sfx.jump(); else sfx.djump();
      }
    }
    // Punch: instant on SLÅ-button tap (or X key), short cooldown.
    if (player.punchCooldown > 0) player.punchCooldown -= dt;
    if (input.punchQueued && player.punchCooldown <= 0) {
      input.punchQueued = false;
      player.punching = 0.15;
      player.punchCooldown = 0.18;
      sfx.punch();
      doPunch();
    } else if (input.punchQueued) {
      input.punchQueued = false;
    }
    if (player.punching > 0) player.punching -= dt;
    if (input.punchFlash > 0) input.punchFlash -= dt;

    // ---- PHYSICS: gorilla gravity ----
    player.vy += 600 * dt;
    player.y += player.vy * dt;
    if (player.y >= GROUND_Y - player.h) {
      player.y = GROUND_Y - player.h;
      player.vy = 0;
      player.onGround = true;
      player.jumpsLeft = 2;
    } else {
      player.onGround = false;
    }
    player.runFrame += dt * 8;

    // ---- SPAWNERS ----
    if (!state.bossActive) {
      state.spawnTimer -= dt;
      if (state.spawnTimer <= 0) {
        spawnElephant();
        // gentle ramp: spawns get a little closer over time, but never brutal
        const tighten = Math.min(0.6, state.time * 0.004);
        state.spawnTimer = (1.4 - tighten) + Math.random() * 1.6;
      }
    }
    state.pickupTimer -= dt;
    if (state.pickupTimer <= 0) {
      spawnPickup();
      state.pickupTimer = 1.6 + Math.random() * 1.8;
    }
    state.birdTimer -= dt;
    if (state.birdTimer <= 0) {
      spawnBird();
      state.birdTimer = 2.5 + Math.random() * 4;
    }

    // Boss every 30s
    if (!state.bossActive) {
      state.bossTimer -= dt;
      if (state.bossTimer <= 0) spawnBoss();
    }

    // Football arena every 60s
    if (state.footballTime > 0) {
      state.footballTime -= dt;
      if (state.footballTime <= 0) flash('Bra spilt!', '#ffeb3b', 1.2);
    } else {
      state.footballNext -= dt;
      if (state.footballNext <= 0) {
        state.footballTime = 15;
        state.footballNext = 60;
        flash('FOTBALL!', '#ffffff', 1.2);
      }
    }

    // ---- ELEPHANTS ----
    for (let i = elephants.length - 1; i >= 0; i--) {
      const e = elephants[i];
      e.bobT += dt * 4;
      if (e.knocked > 0) {
        e.knocked -= dt;
        e.x += 220 * dt;
      } else {
        e.x += e.vx * dt;
      }
      if (e.knocked <= 0 && rectsOverlap(player, e)) {
        if (state.bananaMode > 0) {
          // Plow straight through — bowl them over!
          knockElephant(e);
        } else if (state.invuln <= 0) {
          hitPlayer();
        }
      }
      if (e.x < -80 || e.x > W + 200) elephants.splice(i, 1);
    }

    // ---- BOSS ----
    if (boss) {
      boss.x += boss.knocked > 0 ? 240 * dt : boss.vx * dt;
      if (boss.knocked > 0) boss.knocked -= dt;
      if (boss.x < player.x + player.w + 6 && boss.knocked <= 0) {
        boss.vx = 0;
        boss.stomp += dt;
        if (rectsOverlap(player, boss)) {
          if (state.bananaMode > 0 && boss.knocked <= 0) {
            damageBoss();
          } else if (state.invuln <= 0) {
            hitPlayer();
          }
        }
      }
      if (boss && (boss.x > W + 200 || boss.x < -120)) { boss = null; state.bossActive = false; state.bossTimer = 30; }
    }

    // ---- PICKUPS ----
    for (let i = pickups.length - 1; i >= 0; i--) {
      const p = pickups[i];
      p.x -= state.scrollSpeed * dt;
      p.bobT += dt * 3;
      if (rectsOverlap(player, p)) {
        collectPickup(p);
        pickups.splice(i, 1);
        continue;
      }
      if (p.x < -20) pickups.splice(i, 1);
    }

    // ---- FOOTBALLS ----
    for (let i = footballs.length - 1; i >= 0; i--) {
      const b = footballs[i];
      b.t += dt;
      b.vy += 240 * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      for (let j = elephants.length - 1; j >= 0; j--) {
        const e = elephants[j];
        if (e.knocked <= 0 && Math.abs(b.x - (e.x + e.w/2)) < e.w/2 + b.r && Math.abs(b.y - (e.y + e.h/2)) < e.h/2 + b.r) {
          knockElephant(e);
          state.score += scoreMul() * 2;
          flash('Mål!', '#ffffff', 0.7);
          footballs.splice(i, 1);
          break;
        }
      }
      if (b.y > GROUND_Y) { footballs.splice(i, 1); continue; }
      if (b.x > W + 20) footballs.splice(i, 1);
    }

    updateParticles(dt);
    updateBirds(dt);
    checkMilestones();

    // ---- LIVES ----
    if (state.lives <= 0) endGame();
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 240 * dt;
    }
  }
  function updateBirds(dt) {
    for (let i = birds.length - 1; i >= 0; i--) {
      const b = birds[i];
      b.x += b.vx * dt;
      b.flap += dt * 8;
      if (b.x < -20) birds.splice(i, 1);
    }
  }

  function checkMilestones() {
    while (state.score >= state.nextMilestone) {
      flash(state.nextMilestone + ' POENG!', '#ffeb3b', 1.0);
      confetti(18);
      sfx.pickup();
      state.nextMilestone += 50;
    }
  }

  function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function scoreMul() { return state.bananaMode > 0 ? 3 : 1; }

  function hitPlayer() {
    state.lives -= 1;
    state.invuln = 1.4;
    state.cameraShake = 0.4;
    state.screenFlash = 0.2;
    state.combo = 0;
    sfx.hurt();
    flash('OOF!', '#ff8a65', 0.8);
    burst(player.x + player.w/2, player.y + player.h/2, '#ffeb3b', 8);
  }

  function damageBoss() {
    boss.hp -= 1;
    boss.knocked = 0.4;
    sparkle(boss.x + boss.w/2, boss.y);
    state.cameraShake = 0.2;
    if (boss.hp <= 0) {
      state.score += 50 * scoreMul();
      flash('+50 BRA JOBBA!', '#7cff7c', 1.4);
      burst(boss.x + boss.w/2, boss.y + boss.h/2, '#7cff7c', 18);
      confetti(20);
      boss = null;
      state.bossActive = false;
      state.bossTimer = 30;
      sfx.win();
    } else {
      flash('AU!', '#ffeb3b', 0.5);
    }
  }

  function doPunch() {
    const reach = { x: player.x + player.w, y: player.y, w: 28, h: player.h };
    let hitSomething = false;
    for (const e of elephants) {
      if (e.knocked <= 0 && rectsOverlap(reach, e)) {
        knockElephant(e);
        hitSomething = true;
      }
    }
    if (boss && boss.knocked <= 0 && rectsOverlap(reach, boss)) {
      damageBoss();
      hitSomething = true;
    }
    if (hitSomething) {
      state.combo += 1;
      state.comboTimer = 2.0;
      if (state.combo >= 3) flash('SUPER COMBO!', '#ffeb3b', 0.6);
    }
  }

  function knockElephant(e) {
    e.knocked = 0.8;
    state.score += 1 * scoreMul() + state.combo;
    sparkle(e.x + e.w/2, e.y);
    burst(e.x + e.w/2, e.y + e.h/2, '#ffcccb', 8);
  }

  function collectPickup(p) {
    if (p.kind === 'banana') {
      state.score += 5 * scoreMul();
      sfx.banana();
      if (state.bananaMode <= 0) {
        state.bananas = Math.min(BANANA_MAX, state.bananas + 1);
        if (state.bananas >= BANANA_MAX) triggerBananas();
        else flash('+1 BANAN!', '#ffeb3b', 0.5);
      } else {
        flash('+' + (5 * scoreMul()), '#ffeb3b', 0.4);
      }
    } else if (p.kind === 'coconut') {
      state.score += 10 * scoreMul();
      flash('+' + (10 * scoreMul()), '#ffeb3b', 0.5);
      sfx.pickup();
    } else if (p.kind === 'star') {
      state.score += 25 * scoreMul();
      flash('+' + (25 * scoreMul()) + ' STJERNE!', '#fff176', 0.8);
      confetti(14);
      sfx.star();
    } else if (p.kind === 'pancake') {
      if (state.lives < 3) state.lives += 1;
      flash('+1 LIV!', '#ff7eb6', 0.8);
      sfx.pancake();
    } else if (p.kind === 'mallow') {
      triggerBananas();
    }
    sparkle(p.x, p.y);
  }

  // -------------------------------------------------------------------------
  // RENDER
  // -------------------------------------------------------------------------
  const palette = {
    sky: '#5fb0ff',
    skyTop: '#3f93f0',
    skyArena: '#7ec6ff',
    sun: '#ffe066',
    cloud: '#ffffff',
    mountain: '#4a6a8c',
    mountainShade: '#34506e',
    hill: '#5fa463',
    hillDark: '#4a8a4e',
    grass: '#4caf50',
    grassDark: '#2e7d32',
    dirt: '#8b5a2b',
    dirtDark: '#6b4423',
    pitch: '#388e3c',
    pitchLine: '#f1f8e9',
    gorilla: '#2a2a2a',
    gorillaLight: '#4a4a4a',
    gorillaFace: '#7a5a48',
    human: '#ffd1a4',
    humanShirt: '#ff3b3b',
    humanHair: '#3a2410',
    elephant: '#9aa8b8',
    elephantShade: '#6e7e90',
    trex: '#5fbf5f',
    trexShade: '#3e8e3e',
    banana: '#ffd83b',
    bananaShade: '#e6a91e',
    bananaTip: '#6b4a17',
    coconut: '#6b4423',
    coconutHair: '#3e2615',
    pancake: '#e8a85a',
    pancakeTop: '#ffd28a',
    pancakeSyrup: '#7a3b1a',
    star: '#fff176',
    starEdge: '#ffd54f',
    mallow: '#ffe9f1',
    mallowEdge: '#ff9bbf',
    football: '#ffffff',
    footballSpot: '#000000',
    white: '#ffffff',
    black: '#000000',
    red: '#ff3b3b'
  };
  const RAINBOW = ['#ff5b5b', '#ffb05b', '#ffeb5b', '#5bff5b', '#5bb0ff', '#b05bff'];

  function px(x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x | 0, y | 0, w | 0, h | 0);
  }

  function render() {
    let ox = 0, oy = 0;
    if (state.cameraShake > 0) {
      ox = (Math.random() - 0.5) * 4;
      oy = (Math.random() - 0.5) * 4;
    }
    ctx.save();
    ctx.translate(ox, oy);

    drawBackground();
    drawGround();
    drawEntities();
    drawHUD();

    if (scene === 'TITLE') drawTitleScreen();
    else if (scene === 'GAMEOVER') drawGameOverScreen();

    // Full-screen flash (hurt / bananas), drawn last so it covers everything.
    if (state.screenFlash > 0) {
      ctx.globalAlpha = Math.min(0.6, state.screenFlash * 2);
      ctx.fillStyle = state.bananaMode > 0 ? '#fff7c2' : '#ffffff';
      ctx.fillRect(-6, -6, W + 12, H + 12);
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  function drawBackground() {
    // Sky gradient (two bands) — arena variant when football active.
    if (state.footballTime > 0) {
      ctx.fillStyle = palette.skyArena;
      ctx.fillRect(0, 0, W, H);
    } else if (state.bananaMode > 0) {
      // Soft rainbow bands during bananas mode
      const band = H / RAINBOW.length;
      const shift = (state.time * 2) % RAINBOW.length;
      for (let i = 0; i < RAINBOW.length; i++) {
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = RAINBOW[(i + (shift | 0)) % RAINBOW.length];
        ctx.fillRect(0, i * band, W, band + 1);
      }
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = palette.skyTop;
      ctx.fillRect(0, 0, W, H * 0.5);
      ctx.fillStyle = palette.sky;
      ctx.fillRect(0, H * 0.5, W, H * 0.5);
    }

    // Sun
    px(W - 60, 28, 24, 24, palette.sun);
    px(W - 64, 32, 4, 16, palette.sun);
    px(W - 36, 32, 4, 16, palette.sun);
    px(W - 56, 24, 16, 4, palette.sun);
    px(W - 56, 56, 16, 4, palette.sun);

    // Clouds (parallax)
    const cs = state.scrollX * 0.2;
    drawCloud(((100 - cs) % (W + 80) + W + 80) % (W + 80) - 40, 40);
    drawCloud(((260 - cs) % (W + 80) + W + 80) % (W + 80) - 40, 70);
    drawCloud(((400 - cs) % (W + 80) + W + 80) % (W + 80) - 40, 30);

    // Distant mountains (parallax)
    const ms = state.scrollX * 0.4;
    for (let i = 0; i < 6; i++) {
      const baseX = (i * 120 - (ms % 120)) - 120;
      drawMountain(baseX, 130);
    }

    // Rolling green hills (closer parallax)
    const hs = state.scrollX * 0.6;
    for (let i = 0; i < 7; i++) {
      const baseX = (i * 90 - (hs % 90)) - 90;
      drawHill(baseX, GROUND_Y - 26);
    }

    // Birds (decorative)
    for (const b of birds) drawBird(b);
  }
  function drawCloud(x, y) {
    px(x,      y,    24, 8, palette.cloud);
    px(x + 8,  y-4,  16, 8, palette.cloud);
    px(x + 4,  y+8,  20, 4, palette.cloud);
  }
  function drawMountain(x, y) {
    for (let i = 0; i < 8; i++) {
      const w = 80 - i * 10;
      px(x + i * 5, y + i * 5, w, 5, i < 2 ? palette.mountain : palette.mountainShade);
    }
  }
  function drawHill(x, y) {
    // simple blocky rounded hill
    px(x + 8,  y,      48, 6, palette.hill);
    px(x + 2,  y + 6,  60, 6, palette.hill);
    px(x,      y + 12, 64, 14, palette.hillDark);
  }
  function drawBird(b) {
    const x = b.x | 0, y = b.y | 0;
    const up = Math.sin(b.flap) > 0;
    px(x, y, 3, 2, b.color);                 // body
    if (up) { px(x - 4, y - 2, 4, 2, b.color); px(x + 3, y - 2, 4, 2, b.color); }
    else    { px(x - 4, y + 2, 4, 2, b.color); px(x + 3, y + 2, 4, 2, b.color); }
  }

  function drawGround() {
    if (state.footballTime > 0) {
      ctx.fillStyle = palette.pitch;
      ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
      const stripeOff = (state.scrollX % 40) | 0;
      for (let x = -stripeOff; x < W; x += 40) {
        px(x, GROUND_Y, 20, H - GROUND_Y, '#2e7d32');
      }
      px(0, GROUND_Y, W, 2, palette.pitchLine);
    } else {
      ctx.fillStyle = palette.grass;
      ctx.fillRect(0, GROUND_Y, W, 8);
      ctx.fillStyle = palette.dirt;
      ctx.fillRect(0, GROUND_Y + 8, W, H - GROUND_Y - 8);
      const off = (state.scrollX % 16) | 0;
      for (let x = -off; x < W; x += 16) {
        px(x + 2,  GROUND_Y - 2, 2, 2, palette.grassDark);
        px(x + 8,  GROUND_Y - 3, 2, 3, palette.grassDark);
        px(x + 12, GROUND_Y - 1, 2, 1, palette.grassDark);
      }
      const off2 = (state.scrollX % 80) | 0;
      for (let x = -off2; x < W; x += 80) {
        px(x + 20, GROUND_Y + 24, 6, 4, palette.dirtDark);
        px(x + 60, GROUND_Y + 40, 4, 3, palette.dirtDark);
      }
    }
  }

  function drawEntities() {
    for (const p of pickups) drawPickup(p);
    for (const b of footballs) drawFootball(b.x, b.y, b.r);
    for (const e of elephants) drawElephant(e);
    if (boss) drawTrex(boss);
    drawGorillaPlayer();
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 2));
      px(p.x, p.y, p.size, p.size, p.color);
    }
    ctx.globalAlpha = 1;
  }

  function drawGorillaPlayer() {
    if (state.invuln > 0 && ((state.invuln * 20) | 0) % 2 === 0) return;

    const x = player.x | 0, y = player.y | 0;
    const bob = player.onGround ? Math.sin(player.runFrame) * 1 : 0;

    // Ground shadow (only when low / on ground)
    if (player.y > GROUND_Y - player.h - 30) {
      const sh = Math.max(0, 1 - (GROUND_Y - player.h - player.y) / 30);
      ctx.globalAlpha = 0.25 * sh;
      px(x + 4, GROUND_Y - 3, player.w - 4, 4, '#000000');
      ctx.globalAlpha = 1;
    }

    // Rainbow trail in bananas mode
    if (state.bananaMode > 0) {
      for (let i = 0; i < 6; i++) {
        ctx.globalAlpha = 0.4 - i * 0.05;
        px(x - 6 - i * 6, y + 10 + i, 8, 16, RAINBOW[i]);
      }
      ctx.globalAlpha = 1;
    }

    // Legs
    const legSwing = player.onGround ? (Math.sin(player.runFrame) > 0 ? 2 : -2) : 0;
    px(x + 4,  y + 30 + bob, 8, 10, palette.gorilla);
    px(x + 20, y + 30 + bob, 8, 10, palette.gorilla);
    px(x + 4 + legSwing,  y + 38 + bob, 8, 2, palette.gorillaLight);
    px(x + 20 - legSwing, y + 38 + bob, 8, 2, palette.gorillaLight);
    // Torso
    px(x + 2, y + 14 + bob, 28, 18, palette.gorilla);
    // Belly
    px(x + 8, y + 18 + bob, 16, 12, palette.gorillaFace);
    // Arms — punch animation pushes one arm forward
    if (player.punching > 0) {
      px(x + 28, y + 14 + bob, 14, 8, palette.gorilla);
      px(x + 38, y + 12 + bob,  6, 12, palette.gorilla);
      const spark = ((state.time * 24) | 0) % 2 === 0 ? '#ffeb3b' : '#ffffff';
      px(x + 44, y + 10 + bob, 4, 4, spark);
      px(x + 42, y + 16 + bob, 4, 4, spark);
      px(x - 4,  y + 16 + bob,  6, 14, palette.gorilla);
    } else {
      const armSwing = player.onGround ? Math.sin(player.runFrame + Math.PI) * 2 : 0;
      px(x - 4, y + 16 + bob + armSwing,  6, 14, palette.gorilla);
      px(x + 28, y + 16 + bob - armSwing, 6, 14, palette.gorilla);
    }
    // Head
    px(x + 6, y + 2 + bob, 20, 14, palette.gorilla);
    px(x + 10, y + 6 + bob, 12, 8, palette.gorillaFace);
    px(x + 11, y + 7 + bob, 2, 2, palette.white);
    px(x + 19, y + 7 + bob, 2, 2, palette.white);
    px(x + 12, y + 8 + bob, 1, 1, palette.black);
    px(x + 20, y + 8 + bob, 1, 1, palette.black);

    drawRider(x + 8, y - 14 + bob);
  }

  function drawRider(x, y) {
    px(x + 4, y + 8, 10, 8, palette.humanShirt);
    px(x + 5, y, 8, 8, palette.human);
    px(x + 5, y, 8, 2, palette.humanHair);
    px(x + 4, y + 2, 2, 2, palette.humanHair);
    px(x + 7, y + 3, 1, 1, palette.black);
    px(x + 11, y + 3, 1, 1, palette.black);
    px(x + 8, y + 5, 3, 1, palette.black);
    px(x + 2, y + 10, 3, 4, palette.human);
    px(x + 13, y + 10, 3, 4, palette.human);
    px(x + 5, y + 16, 3, 4, palette.humanShirt);
    px(x + 10, y + 16, 3, 4, palette.humanShirt);
  }

  function drawElephant(e) {
    const x = e.x | 0, y = e.y | 0;
    const bob = (Math.sin(e.bobT) * 1) | 0;
    px(x + 4,  y + 8 + bob, 36, 18, palette.elephant);
    px(x + 4,  y + 22 + bob, 36, 4, palette.elephantShade);
    px(x,      y + 6 + bob, 14, 18, palette.elephant);
    px(x - 6,  y + 14 + bob, 6, 4, palette.elephant);
    px(x - 10, y + 18 + bob, 6, 4, palette.elephant);
    px(x - 10, y + 22 + bob, 4, 4, palette.elephantShade);
    px(x + 4,  y + 10 + bob, 2, 2, palette.white);
    px(x + 5,  y + 11 + bob, 1, 1, palette.black);
    px(x + 8,  y + 4 + bob, 8, 10, palette.elephantShade);
    px(x + 40, y + 12 + bob, 4, 2, palette.elephant);
    px(x + 6,  y + 24, 6, 6, palette.elephantShade);
    px(x + 16, y + 24, 6, 6, palette.elephantShade);
    px(x + 26, y + 24, 6, 6, palette.elephantShade);
    px(x + 34, y + 24, 6, 6, palette.elephantShade);
    if (e.knocked > 0) {
      px(x + 4, y + 10 + bob, 2, 1, palette.red);
      px(x + 4, y + 12 + bob, 2, 1, palette.red);
    }
  }

  function drawTrex(b) {
    const x = b.x | 0, y = b.y | 0;
    const bob = (Math.sin(state.time * 6) * 1) | 0;
    px(x + 40, y + 30 + bob, 14, 6, palette.trex);
    px(x + 50, y + 32 + bob, 6, 4, palette.trexShade);
    px(x + 8, y + 16 + bob, 38, 22, palette.trex);
    px(x + 8, y + 34 + bob, 38, 4, palette.trexShade);
    px(x, y + 4 + bob, 26, 18, palette.trex);
    px(x, y + 18 + bob, 22, 4, palette.trexShade);
    px(x + 16, y + 8 + bob, 3, 3, palette.white);
    px(x + 17, y + 9 + bob, 2, 2, palette.black);
    px(x + 4, y + 20 + bob, 2, 2, palette.white);
    px(x + 8, y + 20 + bob, 2, 2, palette.white);
    px(x + 14, y + 20 + bob, 2, 2, palette.white);
    px(x + 20, y + 22 + bob, 4, 6, palette.trex);
    px(x + 14, y + 38, 8, 18, palette.trexShade);
    px(x + 30, y + 38, 8, 18, palette.trexShade);
    px(x + 8, y + 54, 16, 2, palette.trexShade);
    px(x + 24, y + 54, 16, 2, palette.trexShade);
    for (let i = 0; i < b.hp; i++) {
      px(x + 4 + i * 8, y - 8, 6, 4, palette.red);
    }
  }

  function drawPickup(p) {
    const x = p.x | 0, y = (p.y + Math.sin(p.bobT) * 2) | 0;
    if (p.kind === 'banana') {
      // curved blocky banana
      px(x + 2,  y,      4, 3, palette.bananaTip);
      px(x + 4,  y + 2,  8, 4, palette.banana);
      px(x + 8,  y + 5,  6, 5, palette.banana);
      px(x + 10, y + 9,  4, 5, palette.banana);
      px(x + 4,  y + 4,  8, 2, palette.bananaShade);
      px(x + 8,  y + 8,  6, 2, palette.bananaShade);
    } else if (p.kind === 'coconut') {
      px(x, y, 14, 14, palette.coconut);
      px(x + 2, y + 2, 4, 4, palette.coconutHair);
      px(x + 8, y + 6, 4, 4, palette.coconutHair);
      px(x + 4, y + 9, 4, 4, palette.coconutHair);
    } else if (p.kind === 'star') {
      const blink = ((state.time * 6) | 0) % 2 === 0;
      const c = blink ? palette.star : palette.starEdge;
      px(x + 6, y, 4, 4, c);
      px(x + 2, y + 4, 12, 4, c);
      px(x, y + 6, 16, 3, c);
      px(x + 3, y + 9, 4, 4, c);
      px(x + 9, y + 9, 4, 4, c);
      px(x + 6, y + 5, 4, 3, palette.white);
    } else if (p.kind === 'pancake') {
      px(x, y + 4, 14, 8, palette.pancake);
      px(x, y + 4, 14, 2, palette.pancakeTop);
      px(x + 2, y, 10, 4, palette.pancakeTop);
      px(x + 4, y + 2, 4, 2, palette.pancakeSyrup);
    } else if (p.kind === 'mallow') {
      px(x, y, 14, 10, palette.mallow);
      px(x, y, 14, 2, palette.mallowEdge);
      px(x, y + 8, 14, 2, palette.mallowEdge);
      px(x + 4, y + 4, 2, 2, palette.mallowEdge);
      px(x + 8, y + 4, 2, 2, palette.mallowEdge);
    }
  }

  function drawFootball(x, y, r) {
    const ix = (x - r) | 0, iy = (y - r) | 0;
    const d = r * 2;
    px(ix, iy, d, d, palette.football);
    px(ix + 2, iy + 2, 2, 2, palette.footballSpot);
    px(ix + 8, iy + 4, 2, 2, palette.footballSpot);
    px(ix + 4, iy + 8, 2, 2, palette.footballSpot);
  }

  // small reusable banana icon for the meter / HUD
  function drawBananaIcon(x, y, lit) {
    if (lit) {
      px(x + 1, y, 2, 2, palette.bananaTip);
      px(x + 2, y + 1, 5, 3, palette.banana);
      px(x + 5, y + 3, 4, 4, palette.banana);
      px(x + 6, y + 6, 3, 3, palette.banana);
    } else {
      px(x + 2, y + 1, 5, 3, '#4a4a4a');
      px(x + 5, y + 3, 4, 4, '#4a4a4a');
      px(x + 6, y + 6, 3, 3, '#4a4a4a');
    }
  }

  // -------------------------------------------------------------------------
  // HUD / SCREENS
  // -------------------------------------------------------------------------
  function drawText(text, x, y, color, size) {
    size = size || 8;
    ctx.font = 'bold ' + size + 'px monospace';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#000000';
    ctx.fillText(text, x + 1, y + 1);
    ctx.fillStyle = color || palette.white;
    ctx.fillText(text, x, y);
  }
  function drawTextCentered(text, y, color, size) {
    size = size || 8;
    ctx.font = 'bold ' + size + 'px monospace';
    const m = ctx.measureText(text);
    drawText(text, (W - m.width) / 2, y, color, size);
  }
  function drawTextCenteredRainbow(text, y, size) {
    size = size || 8;
    ctx.font = 'bold ' + size + 'px monospace';
    const total = ctx.measureText(text).width;
    let cx = (W - total) / 2;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const col = RAINBOW[(i + ((state.time * 6) | 0)) % RAINBOW.length];
      drawText(ch, cx, y, col, size);
      cx += ctx.measureText(ch).width;
    }
  }

  function drawHUD() {
    if (scene !== 'PLAY') return;
    // Lives (pancakes)
    for (let i = 0; i < 3; i++) {
      const x = 6 + i * 18, y = 6;
      if (i < state.lives) {
        px(x, y + 4, 14, 8, palette.pancake);
        px(x, y + 4, 14, 2, palette.pancakeTop);
        px(x + 2, y, 10, 4, palette.pancakeTop);
        px(x + 4, y + 2, 4, 2, palette.pancakeSyrup);
      } else {
        px(x, y + 4, 14, 8, '#5a5a5a');
        px(x, y + 4, 14, 2, '#7a7a7a');
      }
    }

    // Banana meter (top center)
    if (state.bananaMode <= 0) {
      const bx = (W - BANANA_MAX * 12) / 2;
      for (let i = 0; i < BANANA_MAX; i++) {
        drawBananaIcon(bx + i * 12, 6, i < state.bananas);
      }
    } else {
      drawTextCentered('★ GÅ BANANAS! ' + Math.ceil(state.bananaMode) + 's ★', 6, '#ffeb3b', 9);
    }

    // Score
    drawText('POENG ' + state.score, 6, H - 14, palette.white, 8);
    // Best
    drawText('REKORD ' + state.best, W - 96, H - 14, '#ffd54f', 8);
    // Combo
    if (state.combo >= 2) {
      drawText('x' + state.combo, 96, H - 14, '#ffeb3b', 8);
    }

    // Football arena timer + kick button bottom-LEFT during arena
    if (state.footballTime > 0) {
      drawTextCentered('FOTBALL ' + Math.ceil(state.footballTime) + 's', H - 14, palette.white, 8);
      const kb = kickBtnRect();
      px(kb.x, kb.y, kb.w, kb.h, '#ffffffcc');
      px(kb.x + 4, kb.y + 4, kb.w - 8, kb.h - 8, '#388e3c');
      drawFootball(kb.x + kb.w / 2, kb.y + 22, 12);
      drawText('SPARK', kb.x + 12, kb.y + kb.h - 14, palette.white, 7);
    }

    // SLÅ button bottom-RIGHT — always visible during PLAY.
    {
      const b = punchBtnRect();
      const flashing = input.punchFlash > 0;
      px(b.x, b.y, b.w, b.h, '#ffffffcc');
      px(b.x + 4, b.y + 4, b.w - 8, b.h - 8, flashing ? '#ffb74d' : '#ef5350');
      const fx = b.x + b.w / 2 - 8;
      const fy = b.y + 14;
      px(fx,     fy,     16, 12, '#6d4c41');
      px(fx + 2, fy + 2, 12,  4, '#8d6e63');
      px(fx + 4, fy + 8,  8,  2, '#3e2723');
      drawText('SLÅ', b.x + b.w / 2 - 10, b.y + b.h - 14, palette.white, 9);
    }

    // Mute button (top-right)
    px(W - 28, 4, 24, 20, '#00000055');
    drawText(muted ? 'OFF' : 'LYD', W - 26, 8, '#ffffff', 7);

    // Flash text — pops in with a little scale-up.
    if (state.flashText) {
      const t = state.flashText;
      const sz = 14;
      const alpha = Math.min(1, t.timer * 2);
      ctx.globalAlpha = alpha;
      if (t.text === 'GÅ BANANAS!') drawTextCenteredRainbow(t.text, 70, sz);
      else drawTextCentered(t.text, 70, t.color, sz);
      ctx.globalAlpha = 1;
    }
  }

  function drawTitleScreen() {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, W, H);

    // Bouncing decorative gorilla + rider above the title
    const by = Math.sin(state.time * 3) * 4;
    const svX = player.x, svY = player.y, svPunch = player.punching, svRun = player.runFrame;
    player.x = W / 2 - 16; player.y = 78 + by; player.punching = 0; player.runFrame = state.time * 6;
    drawGorillaPlayer();
    player.x = svX; player.y = svY; player.punching = svPunch; player.runFrame = svRun;

    drawTextCentered('GORILLA-RYTTER', 30, '#ffeb3b', 20);
    drawTextCentered('Trykk = hopp   •   SLÅ = slag', 138, palette.white, 9);
    drawTextCentered('Samle bananer for GÅ BANANAS!', 156, '#ffd54f', 9);
    if (state.best > 0) drawTextCentered('REKORD: ' + state.best, 176, '#ff7eb6', 10);
    const pulse = ((state.time * 2) | 0) % 2 === 0 ? '#ffffff' : '#ffeb3b';
    drawTextCentered('TRYKK FOR Å SPILLE', 210, pulse, 13);
  }

  function drawGameOverScreen() {
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, W, H);
    if (state.newRecord) {
      drawTextCenteredRainbow('NY REKORD!', 40, 24);
    } else {
      drawTextCentered('WOW!', 40, '#ffeb3b', 26);
    }
    drawTextCentered('Du fikk ' + state.score + ' poeng!', 92, palette.white, 12);
    drawTextCentered('Beste: ' + state.best, 118, '#ffd54f', 10);
    drawTextCentered('Bra jobba, Emilian!', 142, '#ff7eb6', 10);
    const pulse = ((state.time * 2) | 0) % 2 === 0 ? '#ffffff' : '#ffeb3b';
    drawTextCentered('SPILL IGJEN?', 196, pulse, 14);
    if (Math.random() < 0.35) confetti(3);
  }

  // -------------------------------------------------------------------------
  // LIFECYCLE
  // -------------------------------------------------------------------------
  let lastT = performance.now();
  function loop(now) {
    let dt = (now - lastT) / 1000;
    lastT = now;
    if (dt > 0.05) dt = 0.05;
    if (scene !== 'PLAY') state.time += dt;  // keep menus animating
    update(dt);
    render();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame((t) => { lastT = t; loop(t); });
})();
