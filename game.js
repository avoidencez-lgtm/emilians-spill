/*
 * Gorilla-rytter — et HTML5 Canvas-spill for Emilian (6).
 *
 * Systemoversikt:
 *  - BOOT:       henter canvas, setter logisk oppløsning 480x270, skalerer til viewport.
 *  - SCENE:      tre scener: TITLE, PLAY, GAMEOVER (med pos-score-feiring).
 *  - ENTITIES:   spiller (gorilla + human-rytter), elefanter, t-rex-boss, pickups,
 *                fotballer, partikler. Alle tegnes med fillRect (Minecraft-blokk-stil).
 *  - CONTROLS:   touch + mus + tastatur. Tap=hopp, SLÅ-knapp eller X=slag.
 *  - RENDER:     bakgrunn (himmel, sol, fjell, skyer), bakke (gress/jord), HUD.
 *  - AUDIO:      WebAudio-beeps for jump/punch/pickup/boss/win. Stum-knapp i HUD.
 *  - LIFECYCLE:  requestAnimationFrame med fast dt-clamp. Ingen GC-churn i hot loop.
 */

(() => {
  'use strict';

  // -------------------------------------------------------------------------
  // BOOT
  // -------------------------------------------------------------------------
  const W = 480, H = 270;            // logical resolution
  const GROUND_Y = 220;              // top of ground in logical pixels
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
  // AUDIO  (WebAudio beeps, all <200ms, family-friendly)
  // -------------------------------------------------------------------------
  let audioCtx = null;
  let muted = false;
  function ensureAudio() {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (e) { audioCtx = null; }
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  }
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
    pancake:() => { beep(660, 0.08, 'sine', 0.15); setTimeout(() => beep(990, 0.10, 'sine', 0.15), 60); },
    mallow: () => { beep(523, 0.06, 'sine', 0.12); setTimeout(()=>beep(659, 0.06, 'sine', 0.12), 60); setTimeout(()=>beep(784, 0.10, 'sine', 0.12), 120); },
    boss:   () => { beep(110, 0.18, 'sawtooth', 0.18); setTimeout(() => beep(90, 0.18, 'sawtooth', 0.18), 100); },
    hurt:   () => { beep(180, 0.12, 'square', 0.18); setTimeout(() => beep(140, 0.14, 'square', 0.15), 80); },
    win:    () => { beep(523, 0.10, 'sine', 0.15); setTimeout(()=>beep(659, 0.10, 'sine', 0.15), 110); setTimeout(()=>beep(784, 0.10, 'sine', 0.15), 220); setTimeout(()=>beep(1046, 0.18, 'sine', 0.15), 330); },
    kick:   () => beep(380, 0.08, 'triangle', 0.14)
  };

  // -------------------------------------------------------------------------
  // INPUT
  // -------------------------------------------------------------------------
  const input = {
    pressed: false,        // finger/key currently down (jump-tap only now)
    tapQueued: false,      // edge-trigger for jump
    punchQueued: false,    // edge-trigger for punch (set by SLÅ button or X key)
    punchFlash: 0          // ms remaining of button-press flash for visual feedback
  };

  function pressBegin() {
    input.pressed = true;
    input.tapQueued = true;
    ensureAudio();
  }
  function pressEnd() {
    input.pressed = false;
  }

  // Bottom-right SLÅ button (always visible during PLAY). Big finger-target.
  const PUNCH_BTN = { w: 72, h: 56 };
  function punchBtnRect() {
    return { x: W - PUNCH_BTN.w - 6, y: H - PUNCH_BTN.h - 6, w: PUNCH_BTN.w, h: PUNCH_BTN.h };
  }
  // Football kick button (only during arena) — bottom-LEFT now so it doesn't
  // collide with the SLÅ button.
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
    // Mute toggle area: top-right 40x20 in logical coords (=> screen coords ratio).
    const rect = canvas.getBoundingClientRect();
    const t = e.changedTouches[0];
    const lx = (t.clientX - rect.left) * (W / rect.width);
    const ly = (t.clientY - rect.top)  * (H / rect.height);
    if (handleHudTap(lx, ly)) return;
    pressBegin();
  }, { passive: false });
  canvas.addEventListener('touchend', (e) => { e.preventDefault(); pressEnd(); }, { passive: false });
  canvas.addEventListener('touchcancel', (e) => { e.preventDefault(); pressEnd(); }, { passive: false });

  // Mouse (desktop testing)
  canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const lx = (e.clientX - rect.left) * (W / rect.width);
    const ly = (e.clientY - rect.top)  * (H / rect.height);
    if (handleHudTap(lx, ly)) return;
    pressBegin();
  });
  window.addEventListener('mouseup', () => pressEnd());

  // Keyboard fallback: Space=jump, X=punch (instant), M=mute
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.code === 'Space') { e.preventDefault(); pressBegin(); }
    else if (e.code === 'KeyX') {
      e.preventDefault();
      input.punchQueued = true;
      input.punchFlash = 0.12;
      ensureAudio();
    }
    else if (e.code === 'KeyM') { muted = !muted; }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') pressEnd();
  });

  function handleHudTap(lx, ly) {
    // Mute button top-right
    if (lx > W - 28 && lx < W - 4 && ly > 4 && ly < 24) {
      muted = !muted;
      return true;
    }
    // On title/gameover, any tap starts the game — handled by scene logic
    if (scene === 'TITLE' || scene === 'GAMEOVER') {
      startGame();
      return true;
    }
    // SLÅ punch button (bottom-right, always visible during play)
    if (scene === 'PLAY' && pointInRect(lx, ly, punchBtnRect())) {
      input.punchQueued = true;
      input.punchFlash = 0.12;
      ensureAudio();
      return true;
    }
    // Football kick button (bottom-left, only during arena)
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
    scrollSpeed: 80,    // px/sec
    spawnTimer: 0,
    pickupTimer: 0,
    bossTimer: 30,      // first boss at 30s
    bossActive: false,
    footballTime: 0,    // remaining seconds in arena
    footballNext: 60,
    superTime: 0,       // marshmallow super
    flashText: null,    // {text,timer,color}
    cameraShake: 0
  };
  const player = {
    x: 80, y: GROUND_Y - 40,
    vy: 0,
    w: 32, h: 40,       // gorilla body
    onGround: true,
    jumpsLeft: 2,
    punching: 0,        // remaining seconds of punch swing
    punchCooldown: 0,   // seconds until next punch can fire
    facing: 1,
    runFrame: 0
  };
  // Reusable pools
  const elephants = [];
  const pickups = [];
  const particles = [];
  const footballs = [];
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
    state.spawnTimer = 1.5;
    state.pickupTimer = 2.0;
    state.bossTimer = 30;
    state.bossActive = false;
    state.footballTime = 0;
    state.footballNext = 60;
    state.superTime = 0;
    state.flashText = null;
    state.cameraShake = 0;
    player.x = 80; player.y = GROUND_Y - 40;
    player.vy = 0; player.onGround = true; player.jumpsLeft = 2;
    player.punching = 0; player.punchCooldown = 0;
    elephants.length = 0;
    pickups.length = 0;
    particles.length = 0;
    footballs.length = 0;
    boss = null;
  }

  function startGame() {
    ensureAudio();
    resetState();
    scene = 'PLAY';
  }

  function endGame() {
    scene = 'GAMEOVER';
    sfx.win();
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
      knocked: 0,            // sec remaining of being knocked back
      bobT: Math.random() * 6
    });
  }
  function spawnPickup() {
    const kinds = ['coconut', 'coconut', 'coconut', 'pancake', 'mallow'];
    const k = kinds[(Math.random() * kinds.length) | 0];
    pickups.push({
      x: W + 16,
      y: GROUND_Y - 60 - Math.random() * 90,
      w: 14, h: 14,
      kind: k,
      bobT: Math.random() * 6
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
    flash('PASS PA! T-REX!', '#ff5b5b', 1.6);
  }
  function flash(text, color, dur) {
    state.flashText = { text, color, timer: dur || 1.2 };
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

  // -------------------------------------------------------------------------
  // UPDATE
  // -------------------------------------------------------------------------
  function update(dt) {
    if (scene !== 'PLAY') {
      // still let particles fade on menus
      updateParticles(dt);
      // consume edge events to avoid carrying into the next scene
      input.tapQueued = false;
      input.punchQueued = false;
      return;
    }

    state.time += dt;
    if (state.invuln > 0) state.invuln -= dt;
    if (state.comboTimer > 0) { state.comboTimer -= dt; if (state.comboTimer <= 0) state.combo = 0; }
    if (state.superTime > 0) state.superTime -= dt;
    if (state.cameraShake > 0) state.cameraShake -= dt;
    if (state.flashText) { state.flashText.timer -= dt; if (state.flashText.timer <= 0) state.flashText = null; }

    // Scroll speed ramps gently with time; super doubles it.
    const baseSpeed = 80 + Math.min(60, state.time * 1.2);
    state.scrollSpeed = baseSpeed * (state.superTime > 0 ? 1.6 : 1);
    state.scrollX += state.scrollSpeed * dt;

    // ---- INPUT: jump on tap edge, punch on dedicated SLÅ-button ----
    if (input.tapQueued) {
      input.tapQueued = false;
      if (player.jumpsLeft > 0) {
        player.vy = -200;
        player.jumpsLeft -= 1;
        player.onGround = false;
        if (player.jumpsLeft === 1) sfx.jump(); else sfx.djump();
      }
    }
    // Punch: instant on SLÅ-button tap (or X key). Cooldown prevents
    // double-firing on the same finger-press but keeps mashing snappy.
    if (player.punchCooldown > 0) player.punchCooldown -= dt;
    if (input.punchQueued && player.punchCooldown <= 0) {
      input.punchQueued = false;
      player.punching = 0.15;
      player.punchCooldown = 0.18;
      sfx.punch();
      doPunch();
    } else if (input.punchQueued) {
      // Drop the queue if we're still in cooldown so the next press is fresh
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
        state.spawnTimer = 1.4 + Math.random() * 1.6;
      }
    }
    state.pickupTimer -= dt;
    if (state.pickupTimer <= 0) {
      spawnPickup();
      state.pickupTimer = 2.0 + Math.random() * 2.0;
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
        e.x += 220 * dt; // fly off to the right
      } else {
        e.x += e.vx * dt;
      }
      // collide with player
      if (e.knocked <= 0 && state.invuln <= 0 && rectsOverlap(player, e)) {
        hitPlayer();
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
        // when contact, hurt player periodically
        if (state.invuln <= 0 && rectsOverlap(player, boss)) hitPlayer();
      }
      if (boss.x > W + 200 || boss.x < -120) { boss = null; state.bossActive = false; state.bossTimer = 30; }
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
      // hit elephants
      for (let j = elephants.length - 1; j >= 0; j--) {
        const e = elephants[j];
        if (e.knocked <= 0 && Math.abs(b.x - (e.x + e.w/2)) < e.w/2 + b.r && Math.abs(b.y - (e.y + e.h/2)) < e.h/2 + b.r) {
          knockElephant(e);
          state.score += scoreMul() * 2;
          flash('Mal!', '#ffffff', 0.7);
          footballs.splice(i, 1);
          break;
        }
      }
      if (b.y > GROUND_Y) { footballs.splice(i, 1); continue; }
      if (b.x > W + 20) footballs.splice(i, 1);
    }

    updateParticles(dt);

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

  function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function scoreMul() { return state.superTime > 0 ? 2 : 1; }

  function hitPlayer() {
    state.lives -= 1;
    state.invuln = 1.4;
    state.cameraShake = 0.4;
    state.combo = 0;
    sfx.hurt();
    flash('OOF!', '#ff8a65', 0.8);
    burst(player.x + player.w/2, player.y + player.h/2, '#ffeb3b', 8);
  }

  function doPunch() {
    // Reach in front of gorilla
    const reach = { x: player.x + player.w, y: player.y, w: 28, h: player.h };
    let hitSomething = false;
    for (const e of elephants) {
      if (e.knocked <= 0 && rectsOverlap(reach, e)) {
        knockElephant(e);
        hitSomething = true;
      }
    }
    if (boss && boss.knocked <= 0 && rectsOverlap(reach, boss)) {
      boss.hp -= 1;
      boss.knocked = 0.4;
      sparkle(boss.x + boss.w/2, boss.y);
      state.cameraShake = 0.2;
      if (boss.hp <= 0) {
        state.score += 50 * scoreMul();
        flash('+50 BRA JOBBA!', '#7cff7c', 1.4);
        burst(boss.x + boss.w/2, boss.y + boss.h/2, '#7cff7c', 18);
        boss = null;
        state.bossActive = false;
        state.bossTimer = 30;
        sfx.win();
      } else {
        // Re-engage: the knockback flings the boss to the right, but the contact
        // logic in update() zeroed its vx. Restore the approach speed so it walks
        // back into punch range — otherwise it freezes off-screen-right, can never
        // be hit the remaining times, and bossActive stays true forever (which also
        // stops all elephant spawns). See README: "Trenger 3 slag for a forsvinne".
        boss.vx = -50;
        flash('AU!', '#ffeb3b', 0.5);
      }
      hitSomething = true;
    }
    if (hitSomething) {
      state.combo += 1;
      state.comboTimer = 2.0;
      if (state.combo >= 3) flash('BRA!', '#ffeb3b', 0.6);
    }
  }

  function knockElephant(e) {
    e.knocked = 0.8;
    state.score += 1 * scoreMul() + state.combo;
    sparkle(e.x + e.w/2, e.y);
    burst(e.x + e.w/2, e.y + e.h/2, '#ffcccb', 8);
  }

  function collectPickup(p) {
    if (p.kind === 'coconut') {
      state.score += 10 * scoreMul();
      flash('+10', '#ffeb3b', 0.5);
      sfx.pickup();
    } else if (p.kind === 'pancake') {
      if (state.lives < 3) state.lives += 1;
      flash('+1 LIV!', '#ff7eb6', 0.8);
      sfx.pancake();
    } else if (p.kind === 'mallow') {
      state.superTime = 5.0;
      flash('SUPER!', '#ffffff', 0.9);
      sfx.mallow();
    }
    sparkle(p.x, p.y);
  }

  // -------------------------------------------------------------------------
  // RENDER
  // -------------------------------------------------------------------------
  const palette = {
    sky: '#5fb0ff',
    skyArena: '#7ec6ff',
    sun: '#ffe066',
    cloud: '#ffffff',
    mountain: '#4a6a8c',
    mountainShade: '#34506e',
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
    coconut: '#6b4423',
    coconutHair: '#3e2615',
    pancake: '#e8a85a',
    pancakeTop: '#ffd28a',
    pancakeSyrup: '#7a3b1a',
    mallow: '#ffe9f1',
    mallowEdge: '#ff9bbf',
    football: '#ffffff',
    footballSpot: '#000000',
    white: '#ffffff',
    black: '#000000',
    red: '#ff3b3b'
  };

  function px(x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x | 0, y | 0, w | 0, h | 0);
  }

  function render() {
    // shake
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

    ctx.restore();
  }

  function drawBackground() {
    // Sky — arena variant when football active
    ctx.fillStyle = state.footballTime > 0 ? palette.skyArena : palette.sky;
    ctx.fillRect(0, 0, W, H);

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
  }
  function drawCloud(x, y) {
    px(x,      y,    24, 8, palette.cloud);
    px(x + 8,  y-4,  16, 8, palette.cloud);
    px(x + 4,  y+8,  20, 4, palette.cloud);
  }
  function drawMountain(x, y) {
    // simple triangular blocky peak
    for (let i = 0; i < 8; i++) {
      const w = 80 - i * 10;
      px(x + i * 5, y + i * 5, w, 5, i < 2 ? palette.mountain : palette.mountainShade);
    }
  }

  function drawGround() {
    if (state.footballTime > 0) {
      // football pitch
      ctx.fillStyle = palette.pitch;
      ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
      // stripes
      const stripeOff = (state.scrollX % 40) | 0;
      for (let x = -stripeOff; x < W; x += 40) {
        px(x, GROUND_Y, 20, H - GROUND_Y, '#2e7d32');
      }
      // pitch line
      px(0, GROUND_Y, W, 2, palette.pitchLine);
    } else {
      // grass top + dirt
      ctx.fillStyle = palette.grass;
      ctx.fillRect(0, GROUND_Y, W, 8);
      ctx.fillStyle = palette.dirt;
      ctx.fillRect(0, GROUND_Y + 8, W, H - GROUND_Y - 8);
      // grass blades pattern moving with scroll
      const off = (state.scrollX % 16) | 0;
      for (let x = -off; x < W; x += 16) {
        px(x + 2,  GROUND_Y - 2, 2, 2, palette.grassDark);
        px(x + 8,  GROUND_Y - 3, 2, 3, palette.grassDark);
        px(x + 12, GROUND_Y - 1, 2, 1, palette.grassDark);
      }
      // dirt rocks
      const off2 = (state.scrollX % 80) | 0;
      for (let x = -off2; x < W; x += 80) {
        px(x + 20, GROUND_Y + 24, 6, 4, palette.dirtDark);
        px(x + 60, GROUND_Y + 40, 4, 3, palette.dirtDark);
      }
    }
  }

  function drawEntities() {
    // pickups
    for (const p of pickups) drawPickup(p);
    // footballs
    for (const b of footballs) drawFootball(b.x, b.y, b.r);
    // elephants
    for (const e of elephants) drawElephant(e);
    // boss
    if (boss) drawTrex(boss);
    // player
    drawGorillaPlayer();
    // particles
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 2));
      px(p.x, p.y, p.size, p.size, p.color);
    }
    ctx.globalAlpha = 1;
  }

  function drawGorillaPlayer() {
    // Flicker on invuln
    if (state.invuln > 0 && ((state.invuln * 20) | 0) % 2 === 0) return;

    const x = player.x | 0, y = player.y | 0;
    const bob = player.onGround ? Math.sin(player.runFrame) * 1 : 0;

    // Super trail (rainbow)
    if (state.superTime > 0) {
      const colors = ['#ff5b5b', '#ffb05b', '#ffeb5b', '#5bff5b', '#5bb0ff', '#b05bff'];
      for (let i = 0; i < 6; i++) {
        ctx.globalAlpha = 0.4 - i * 0.05;
        px(x - 6 - i * 6, y + 10 + i, 8, 16, colors[i]);
      }
      ctx.globalAlpha = 1;
    }

    // Gorilla body (32x40)
    // Legs
    const legSwing = player.onGround ? (Math.sin(player.runFrame) > 0 ? 2 : -2) : 0;
    px(x + 4,  y + 30 + bob, 8, 10, palette.gorilla);  // left leg
    px(x + 20, y + 30 + bob, 8, 10, palette.gorilla);  // right leg
    px(x + 4 + legSwing,  y + 38 + bob, 8, 2, palette.gorillaLight);
    px(x + 20 - legSwing, y + 38 + bob, 8, 2, palette.gorillaLight);
    // Torso
    px(x + 2, y + 14 + bob, 28, 18, palette.gorilla);
    // Belly
    px(x + 8, y + 18 + bob, 16, 12, palette.gorillaFace);
    // Arms — punch animation pushes one arm forward
    if (player.punching > 0) {
      px(x + 28, y + 14 + bob, 14, 8, palette.gorilla);    // extended arm
      px(x + 38, y + 12 + bob,  6, 12, palette.gorilla);   // fist
      // bright impact spark at the fist
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
    // Eyes
    px(x + 11, y + 7 + bob, 2, 2, palette.white);
    px(x + 19, y + 7 + bob, 2, 2, palette.white);
    px(x + 12, y + 8 + bob, 1, 1, palette.black);
    px(x + 20, y + 8 + bob, 1, 1, palette.black);

    // Human rider on top
    drawRider(x + 8, y - 14 + bob);
  }

  function drawRider(x, y) {
    // Body
    px(x + 4, y + 8, 10, 8, palette.humanShirt);
    // Head
    px(x + 5, y, 8, 8, palette.human);
    // Hair
    px(x + 5, y, 8, 2, palette.humanHair);
    px(x + 4, y + 2, 2, 2, palette.humanHair);
    // Eyes
    px(x + 7, y + 3, 1, 1, palette.black);
    px(x + 11, y + 3, 1, 1, palette.black);
    // Mouth (smile)
    px(x + 8, y + 5, 3, 1, palette.black);
    // Arms holding on
    px(x + 2, y + 10, 3, 4, palette.human);
    px(x + 13, y + 10, 3, 4, palette.human);
    // Legs gripping gorilla
    px(x + 5, y + 16, 3, 4, palette.humanShirt);
    px(x + 10, y + 16, 3, 4, palette.humanShirt);
  }

  function drawElephant(e) {
    const x = e.x | 0, y = e.y | 0;
    const bob = (Math.sin(e.bobT) * 1) | 0;
    // Body
    px(x + 4,  y + 8 + bob, 36, 18, palette.elephant);
    px(x + 4,  y + 22 + bob, 36, 4, palette.elephantShade);
    // Head
    px(x,      y + 6 + bob, 14, 18, palette.elephant);
    // Trunk
    px(x - 6,  y + 14 + bob, 6, 4, palette.elephant);
    px(x - 10, y + 18 + bob, 6, 4, palette.elephant);
    px(x - 10, y + 22 + bob, 4, 4, palette.elephantShade);
    // Eye
    px(x + 4,  y + 10 + bob, 2, 2, palette.white);
    px(x + 5,  y + 11 + bob, 1, 1, palette.black);
    // Ear
    px(x + 8,  y + 4 + bob, 8, 10, palette.elephantShade);
    // Tail
    px(x + 40, y + 12 + bob, 4, 2, palette.elephant);
    // Legs
    const legAlt = (Math.sin(e.bobT) > 0) ? 1 : -1;
    px(x + 6,  y + 24, 6, 6, palette.elephantShade);
    px(x + 16, y + 24, 6, 6, palette.elephantShade);
    px(x + 26, y + 24, 6, 6, palette.elephantShade);
    px(x + 34, y + 24, 6, 6, palette.elephantShade);
    // Happy expression when knocked (X eye + smile)
    if (e.knocked > 0) {
      px(x + 4, y + 10 + bob, 2, 1, palette.red);
      px(x + 4, y + 12 + bob, 2, 1, palette.red);
    }
  }

  function drawTrex(b) {
    const x = b.x | 0, y = b.y | 0;
    const bob = (Math.sin(state.time * 6) * 1) | 0;
    // Tail
    px(x + 40, y + 30 + bob, 14, 6, palette.trex);
    px(x + 50, y + 32 + bob, 6, 4, palette.trexShade);
    // Body
    px(x + 8, y + 16 + bob, 38, 22, palette.trex);
    px(x + 8, y + 34 + bob, 38, 4, palette.trexShade);
    // Head
    px(x, y + 4 + bob, 26, 18, palette.trex);
    px(x, y + 18 + bob, 22, 4, palette.trexShade);
    // Eye
    px(x + 16, y + 8 + bob, 3, 3, palette.white);
    px(x + 17, y + 9 + bob, 2, 2, palette.black);
    // Teeth
    px(x + 4, y + 20 + bob, 2, 2, palette.white);
    px(x + 8, y + 20 + bob, 2, 2, palette.white);
    px(x + 14, y + 20 + bob, 2, 2, palette.white);
    // Tiny arms
    px(x + 20, y + 22 + bob, 4, 6, palette.trex);
    // Legs
    px(x + 14, y + 38, 8, 18, palette.trexShade);
    px(x + 30, y + 38, 8, 18, palette.trexShade);
    px(x + 8, y + 54, 16, 2, palette.trexShade);
    px(x + 24, y + 54, 16, 2, palette.trexShade);
    // HP pips above
    for (let i = 0; i < b.hp; i++) {
      px(x + 4 + i * 8, y - 8, 6, 4, palette.red);
    }
  }

  function drawPickup(p) {
    const x = p.x | 0, y = (p.y + Math.sin(p.bobT) * 2) | 0;
    if (p.kind === 'coconut') {
      px(x, y, 14, 14, palette.coconut);
      px(x + 2, y + 2, 4, 4, palette.coconutHair);
      px(x + 8, y + 6, 4, 4, palette.coconutHair);
      px(x + 4, y + 9, 4, 4, palette.coconutHair);
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

  // -------------------------------------------------------------------------
  // HUD / SCREENS
  // -------------------------------------------------------------------------
  function drawText(text, x, y, color, size) {
    size = size || 8;
    ctx.fillStyle = color || palette.white;
    ctx.font = 'bold ' + size + 'px monospace';
    ctx.textBaseline = 'top';
    // shadow
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
    // Score
    drawText('POENG ' + state.score, 6, H - 14, palette.white, 8);
    // Combo
    if (state.combo >= 2) {
      drawText('x' + state.combo, 80, H - 14, '#ffeb3b', 8);
    }
    // Super timer
    if (state.superTime > 0) {
      drawText('SUPER ' + state.superTime.toFixed(1), 130, H - 14, '#ff7eb6', 8);
    }
    // Football arena timer (label) + kick button bottom-LEFT during arena
    if (state.footballTime > 0) {
      drawText('FOTBALL ' + Math.ceil(state.footballTime) + 's', 100, H - 14, palette.white, 8);
      const kb = kickBtnRect();
      px(kb.x, kb.y, kb.w, kb.h, '#ffffffcc');
      px(kb.x + 4, kb.y + 4, kb.w - 8, kb.h - 8, '#388e3c');
      drawFootball(kb.x + kb.w / 2, kb.y + 22, 12);
      drawText('SPARK', kb.x + 12, kb.y + kb.h - 14, palette.white, 7);
    }

    // SLÅ button bottom-RIGHT — always visible during PLAY. Big finger-target,
    // bright color so it cannot be missed. Briefly flashes lighter on press.
    {
      const b = punchBtnRect();
      const flashing = input.punchFlash > 0;
      px(b.x, b.y, b.w, b.h, '#ffffffcc');
      px(b.x + 4, b.y + 4, b.w - 8, b.h - 8, flashing ? '#ffb74d' : '#ef5350');
      // fist icon (blocky)
      const fx = b.x + b.w / 2 - 8;
      const fy = b.y + 14;
      px(fx,     fy,     16, 12, '#6d4c41');     // hand
      px(fx + 2, fy + 2, 12,  4, '#8d6e63');     // knuckles highlight
      px(fx + 4, fy + 8,  8,  2, '#3e2723');     // shadow
      drawText('SLÅ', b.x + b.w / 2 - 10, b.y + b.h - 14, palette.white, 9);
    }

    // Mute button (top-right)
    px(W - 28, 4, 24, 20, '#00000055');
    drawText(muted ? 'OFF' : 'LYD', W - 26, 8, '#ffffff', 7);

    // Flash text
    if (state.flashText) {
      const t = state.flashText;
      const sz = 14;
      ctx.font = 'bold ' + sz + 'px monospace';
      const m = ctx.measureText(t.text);
      const alpha = Math.min(1, t.timer * 2);
      ctx.globalAlpha = alpha;
      drawText(t.text, (W - m.width)/2, 70, t.color, sz);
      ctx.globalAlpha = 1;
    }
  }

  function drawTitleScreen() {
    // dim
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, W, H);
    drawTextCentered('GORILLA-RYTTER', 48, '#ffeb3b', 20);
    drawTextCentered('Trykk for a hoppe!', 100, palette.white, 10);
    drawTextCentered('Trykk SLÅ for a slass!', 118, palette.white, 10);
    drawTextCentered('Samle kokos og pannekaker!', 140, palette.white, 8);
    // pulsing
    const pulse = ((state.time * 2) | 0) % 2 === 0 ? '#ffffff' : '#ffeb3b';
    drawTextCentered('TRYKK FOR A SPILLE', 200, pulse, 12);
    // animate decorative gorilla in corner
  }

  function drawGameOverScreen() {
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, W, H);
    drawTextCentered('WOW!', 50, '#ffeb3b', 26);
    drawTextCentered('Du fikk ' + state.score + ' poeng!', 100, palette.white, 12);
    drawTextCentered('Bra jobba, Emilian!', 130, '#ff7eb6', 10);
    const pulse = ((state.time * 2) | 0) % 2 === 0 ? '#ffffff' : '#ffeb3b';
    drawTextCentered('SPILL IGJEN?', 190, pulse, 14);
    // sparkle particles auto-spawn for fun
    if (Math.random() < 0.4) {
      sparkle(Math.random() * W, 30 + Math.random() * 120);
    }
  }

  // -------------------------------------------------------------------------
  // LIFECYCLE
  // -------------------------------------------------------------------------
  let lastT = performance.now();
  function loop(now) {
    let dt = (now - lastT) / 1000;
    lastT = now;
    if (dt > 0.05) dt = 0.05;     // clamp big frames (tab refocus, etc.)
    state.time = (state.time || 0) + (scene === 'PLAY' ? 0 : dt);
    update(dt);
    render();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame((t) => { lastT = t; loop(t); });
})();
