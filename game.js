const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const BASE_W = 360, BASE_H = 220;
let W = BASE_W, H = BASE_H;

// --- fullscreen support ---
const gameWrap = document.getElementById('game-wrap');
const btnFullscreen = document.getElementById('btnFullscreen');

function resizeCanvas() {
  const holder = document.getElementById('canvas-holder');
  const rect = holder.getBoundingClientRect();
  const ratio = BASE_W / BASE_H;
  let cssW = rect.width, cssH = rect.width / ratio;
  if (gameWrap.classList.contains('fullscreen-mode')) {
    cssH = rect.height;
    cssW = cssH * ratio;
  }
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  W = BASE_W;
  H = BASE_H;
  ctx.setTransform(dpr * (canvas.width / dpr / BASE_W), 0, 0, dpr * (canvas.height / dpr / BASE_H), 0, 0);
}

function supportsRealFullscreen() {
  const el = document.documentElement;
  return !!(el.requestFullscreen || el.webkitRequestFullscreen);
}

function toggleFullscreen() {
  if (supportsRealFullscreen()) {
    const el = document.documentElement;
    const isFs = document.fullscreenElement || document.webkitFullscreenElement;
    if (!isFs) {
      const req = el.requestFullscreen || el.webkitRequestFullscreen;
      const result = req.call(el);
      if (result && typeof result.catch === 'function') {
        result.catch(() => togglePseudoFullscreen());
      }
    } else {
      (document.exitFullscreen || document.webkitExitFullscreen || function(){}).call(document);
    }
  } else {
    // iOS Safari and other browsers without element Fullscreen API support
    togglePseudoFullscreen();
  }
}

function togglePseudoFullscreen() {
  const isFs = gameWrap.classList.contains('fullscreen-mode');
  gameWrap.classList.toggle('fullscreen-mode', !isFs);
  document.body.classList.toggle('pseudo-fs-lock', !isFs);
  btnFullscreen.textContent = !isFs ? '⤓' : '⛶';
  setTimeout(resizeCanvas, 50);
}

btnFullscreen.addEventListener('click', toggleFullscreen);

function onFullscreenChange() {
  const isFs = document.fullscreenElement || document.webkitFullscreenElement;
  gameWrap.classList.toggle('fullscreen-mode', !!isFs);
  btnFullscreen.textContent = isFs ? '⤓' : '⛶';
  setTimeout(resizeCanvas, 50);
}
document.addEventListener('fullscreenchange', onFullscreenChange);
document.addEventListener('webkitfullscreenchange', onFullscreenChange);
window.addEventListener('resize', resizeCanvas);
window.addEventListener('orientationchange', () => setTimeout(resizeCanvas, 200));
resizeCanvas();

const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const livesEl = document.getElementById('lives');
const levelEl = document.getElementById('level');
const msgEl = document.getElementById('msg');
const levelUpEl = document.getElementById('levelUp');
const startOverlay = document.getElementById('startOverlay');
const btnStart = document.getElementById('btnStart');

let best = Number(localStorage.getItem('skyrunner_best') || 0);
bestEl.textContent = best;

// --- audio (Web Audio API, no external files) ---
let actx;
function beep(freq, dur, type = 'square', vol = 0.06) {
  try {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = actx.createOscillator();
    const gain = actx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = vol;
    osc.connect(gain);
    gain.connect(actx.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
    osc.stop(actx.currentTime + dur);
  } catch (e) {}
}
const sfx = {
  jump: () => beep(520, 0.12, 'square', 0.05),
  coin: () => beep(880, 0.1, 'triangle', 0.06),
  hit: () => beep(120, 0.25, 'sawtooth', 0.08),
  shield: () => beep(660, 0.18, 'sine', 0.07),
  level: () => { beep(660, 0.1); setTimeout(() => beep(880, 0.15), 100); }
};

let player, obstacles, coins, shields, particles, clouds, mountains;
let score, lives, speed, running, frame, level, combo, moveDir, shake;

function initGame() {
  player = { x: 60, y: H - 54, w: 24, h: 30, vy: 0, onGround: true, invuln: 0, shielded: 0, squash: 1 };
  obstacles = [];
  coins = [];
  shields = [];
  particles = [];
  clouds = Array.from({ length: 4 }, (_, i) => ({ x: i * 110, y: 20 + (i % 2) * 20, s: 0.6 + Math.random() * 0.5 }));
  mountains = Array.from({ length: 3 }, (_, i) => ({ x: i * 160, h: 30 + Math.random() * 25 }));
  score = 0; lives = 3; speed = 3.0; frame = 0; level = 1; combo = 0; moveDir = 0; shake = 0;
  running = true;
  scoreEl.textContent = 0;
  livesEl.textContent = lives;
  levelEl.textContent = level;
  msgEl.textContent = '';
}

function spawnObstacle() {
  const type = Math.random() < 0.5 ? 'ground' : 'air';
  if (type === 'ground') obstacles.push({ x: W, y: H - 46, w: 18, h: 26, type: 'ground' });
  else obstacles.push({ x: W, y: H - 96, w: 24, h: 20, type: 'air' });
}
function spawnCoin() { coins.push({ x: W, y: H - 60 - Math.random() * 50, r: 6, taken: false, spin: 0 }); }
function spawnShield() { if (Math.random() < 0.25) shields.push({ x: W, y: H - 70 - Math.random() * 30, r: 8, taken: false }); }

function addParticles(x, y, color, n = 8) {
  for (let i = 0; i < n; i++) {
    particles.push({ x, y, vx: (Math.random() - 0.5) * 5, vy: (Math.random() - 0.5) * 5 - 1, life: 22, color });
  }
}

function jump() {
  if (!running) return;
  if (player.onGround) {
    player.vy = -10;
    player.onGround = false;
    player.squash = 1.3;
    sfx.jump();
  }
}

function setMove(dir) { moveDir = dir; }

btnStart.addEventListener('click', () => {
  startOverlay.style.display = 'none';
  initGame();
  requestAnimationFrame(loop);
});

const btnJumpEl = document.getElementById('btnJump');
const bl = document.getElementById('btnLeft'), br = document.getElementById('btnRight');

// --- Robust pointer-based controls (works for touch, mouse, and pen) ---
function bindHold(el, onDown, onUp) {
  let activeId = null;
  el.addEventListener('pointerdown', e => {
    e.preventDefault();
    activeId = e.pointerId;
    try { el.setPointerCapture(activeId); } catch (err) {}
    onDown();
  });
  const release = e => {
    if (activeId === null || (e.pointerId !== undefined && e.pointerId !== activeId)) return;
    activeId = null;
    onUp();
  };
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
  el.addEventListener('pointerleave', release);
  // Prevent the ghost click/context menu on long-press for mobile browsers
  el.addEventListener('contextmenu', e => e.preventDefault());
}

bindHold(btnJumpEl, jump, () => {});
bindHold(bl, () => setMove(-1), () => { if (moveDir === -1) setMove(0); });
bindHold(br, () => setMove(1), () => { if (moveDir === 1) setMove(0); });

// Safety net: if the finger/pointer is released anywhere on screen, stop movement
window.addEventListener('pointerup', () => {}, { passive: true });

window.addEventListener('keydown', e => {
  if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); jump(); }
  if (e.code === 'ArrowLeft') moveDir = -1;
  if (e.code === 'ArrowRight') moveDir = 1;
});
window.addEventListener('keyup', e => {
  if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') moveDir = 0;
});
canvas.addEventListener('pointerdown', e => { e.preventDefault(); jump(); });


function rectHit(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function triggerLevelUp() {
  levelUpEl.classList.remove('show');
  void levelUpEl.offsetWidth;
  levelUpEl.classList.add('show');
  sfx.level();
}

function loop() {
  if (!running) return;
  frame++;

  const newLevel = 1 + Math.floor(score / 100);
  if (newLevel !== level) { level = newLevel; levelEl.textContent = level; triggerLevelUp(); }

  ctx.save();
  if (shake > 0) {
    ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    shake *= 0.85;
    if (shake < 0.5) shake = 0;
  }
  ctx.clearRect(-10, -10, W + 20, H + 20);

  // sky gradient shifts subtly with level
  const hue = 230 + (level % 5) * 8;
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, `hsl(${hue}, 45%, 22%)`);
  grad.addColorStop(1, `hsl(${hue}, 40%, 12%)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // stars
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  for (let i = 0; i < 22; i++) {
    const sx = (i * 41 + frame * 0.3) % W;
    const sy = (i * 27) % (H - 60);
    ctx.fillRect(sx, sy, 1.5, 1.5);
  }

  // mountains (parallax)
  ctx.fillStyle = 'rgba(80,90,160,0.4)';
  mountains.forEach(m => {
    m.x -= speed * 0.2;
    if (m.x < -100) m.x += 300;
    ctx.beginPath();
    ctx.moveTo(m.x, H - 18);
    ctx.lineTo(m.x + 60, H - 18 - m.h);
    ctx.lineTo(m.x + 120, H - 18);
    ctx.closePath();
    ctx.fill();
  });

  // clouds (parallax)
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  clouds.forEach(c => {
    c.x -= speed * 0.35;
    if (c.x < -50) c.x = W + 20;
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, 22 * c.s, 9 * c.s, 0, 0, Math.PI * 2);
    ctx.fill();
  });

  // ground
  ctx.fillStyle = '#5a67c9';
  ctx.fillRect(0, H - 18, W, 2);
  ctx.fillStyle = 'rgba(90,103,201,0.15)';
  ctx.fillRect(0, H - 16, W, 16);

  // player physics
  player.x += moveDir * 3;
  player.x = Math.max(10, Math.min(W - player.w - 10, player.x));
  player.vy += 0.55;
  player.y += player.vy;
  if (player.y > H - 54) { player.y = H - 54; player.vy = 0; player.onGround = true; }
  player.squash += (1 - player.squash) * 0.2;
  if (player.invuln > 0) player.invuln--;
  if (player.shielded > 0) player.shielded--;

  // spawn
  if (frame % Math.max(42, 78 - Math.floor(speed * 5)) === 0) { spawnObstacle(); spawnShield(); }
  if (frame % 50 === 0) spawnCoin();

  obstacles.forEach(o => o.x -= speed);
  obstacles = obstacles.filter(o => o.x > -30);
  coins.forEach(c => { c.x -= speed; c.spin += 0.2; });
  coins = coins.filter(c => c.x > -20 && !c.taken);
  shields.forEach(s => s.x -= speed);
  shields = shields.filter(s => s.x > -20 && !s.taken);

  // collisions - obstacles
  for (const o of obstacles) {
    if (player.invuln === 0 && rectHit(player, o)) {
      if (player.shielded > 0) {
        player.shielded = 0;
        player.invuln = 40;
        addParticles(player.x + 12, player.y + 15, '#60beff', 10);
        sfx.shield();
      } else {
        lives--;
        livesEl.textContent = lives;
        player.invuln = 60;
        combo = 0;
        shake = 8;
        addParticles(player.x + 12, player.y + 15, '#e0553e');
        sfx.hit();
        if (lives <= 0) {
          running = false;
          best = Math.max(best, Math.floor(score));
          localStorage.setItem('skyrunner_best', best);
          bestEl.textContent = best;
          msgEl.textContent = '';
          drawEntities();
          ctx.restore();
          startOverlay.style.display = 'flex';
          document.getElementById('startTitle').textContent = 'GAME OVER';
          document.getElementById('startSub').textContent = 'Skor: ' + Math.floor(score) + '  •  Terbaik: ' + best;
          btnStart.textContent = 'MAIN LAGI';
          return;
        }
      }
    }
  }

  // collisions - coins
  for (const c of coins) {
    const dist = Math.hypot(c.x - (player.x + player.w / 2), c.y - (player.y + player.h / 2));
    if (dist < c.r + 15) {
      c.taken = true;
      combo++;
      score += 5 + Math.min(combo, 10);
      addParticles(c.x, c.y, '#ffd166', 6);
      sfx.coin();
    }
  }

  // collisions - shields
  for (const s of shields) {
    const dist = Math.hypot(s.x - (player.x + player.w / 2), s.y - (player.y + player.h / 2));
    if (dist < s.r + 15) {
      s.taken = true;
      player.shielded = 300;
      addParticles(s.x, s.y, '#60beff', 8);
      sfx.shield();
    }
  }

  score += 0.12 + level * 0.01;
  speed += 0.0018;
  scoreEl.textContent = Math.floor(score);

  drawEntities();
  ctx.restore();
  requestAnimationFrame(loop);
}

function drawEntities() {
  // particles
  particles.forEach(p => {
    ctx.globalAlpha = p.life / 22;
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x, p.y, 4, 4);
    p.x += p.vx; p.y += p.vy; p.vy += 0.15; p.life--;
  });
  ctx.globalAlpha = 1;
  particles = particles.filter(p => p.life > 0);

  // shields
  shields.forEach(s => {
    ctx.strokeStyle = '#60beff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(96,190,255,0.3)';
    ctx.fill();
  });

  // coins
  coins.forEach(c => {
    const sq = Math.abs(Math.cos(c.spin));
    ctx.fillStyle = '#ffd166';
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, c.r * sq + 1, c.r, 0, 0, Math.PI * 2);
    ctx.fill();
  });

  // obstacles (spikes)
  obstacles.forEach(o => {
    ctx.fillStyle = o.type === 'ground' ? '#e0553e' : '#c93a6e';
    ctx.beginPath();
    if (o.type === 'ground') {
      ctx.moveTo(o.x, o.y + o.h);
      ctx.lineTo(o.x + o.w / 2, o.y);
      ctx.lineTo(o.x + o.w, o.y + o.h);
    } else {
      ctx.moveTo(o.x, o.y);
      ctx.lineTo(o.x + o.w, o.y + o.h / 2);
      ctx.lineTo(o.x, o.y + o.h);
    }
    ctx.closePath();
    ctx.fill();
  });

  // player (simple ninja shape)
  const px = player.x, py = player.y, pw = player.w, ph = player.h * player.squash;
  const flicker = player.invuln > 0 && frame % 8 < 4;
  ctx.save();
  ctx.globalAlpha = flicker ? 0.4 : 1;
  ctx.fillStyle = '#60beff';
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(px, py + (player.h - ph), pw, ph, 6) : ctx.rect(px, py, pw, ph);
  ctx.fill();
  // headband
  ctx.fillStyle = '#e0553e';
  ctx.fillRect(px, py + ph * 0.15, pw, 4);
  // eye
  ctx.fillStyle = '#0a0c1e';
  ctx.fillRect(px + pw * 0.6, py + ph * 0.3, 4, 4);
  ctx.restore();

  if (player.shielded > 0) {
    ctx.strokeStyle = 'rgba(96,190,255,0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px + pw / 2, py + player.h / 2, pw * 0.9, 0, Math.PI * 2);
    ctx.stroke();
  }
}
