const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const scoreEl = document.getElementById('score');
const livesEl = document.getElementById('lives');
const levelEl = document.getElementById('level');
const restartBtn = document.getElementById('restart');

const difficultySelect = document.getElementById('difficulty');
const enemyCountInput = document.getElementById('enemyCount');
const enemySpeedInput = document.getElementById('enemySpeed');
const spawnRateInput = document.getElementById('spawnRate');
const bulletSpeedInput = document.getElementById('bulletSpeed');

const enemyCountValue = document.getElementById('enemyCountValue');
const enemySpeedValue = document.getElementById('enemySpeedValue');
const spawnRateValue = document.getElementById('spawnRateValue');
const bulletSpeedValue = document.getElementById('bulletSpeedValue');

const SETTINGS_KEY = 'tank-battle-settings';

const TILE = 24;
const GRID = 26;
const WORLD = TILE * GRID;

const DIRS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const PRESETS = {
  easy: { enemyCount: 8, enemySpeed: 55, spawnRate: 1400, bulletSpeed: 230 },
  normal: { enemyCount: 12, enemySpeed: 70, spawnRate: 1100, bulletSpeed: 250 },
  hard: { enemyCount: 18, enemySpeed: 95, spawnRate: 800, bulletSpeed: 290 },
};

let settings = loadSettings();
let keys = new Set();

let player;
let enemies;
let bullets;
let particles;
let walls;
let steel;
let water;
let base;

let score = 0;
let lives = 3;
let level = 1;
let enemiesSpawned = 0;
let enemiesKilled = 0;
let spawnTimer = 0;
let invincibleTimer = 0;
let gameOver = false;
let win = false;

let last = performance.now();

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    const merged = {
      ...PRESETS.normal,
      ...saved,
    };
    const detected = detectPreset(merged);
    return {
      ...merged,
      difficulty: saved.difficulty || detected || 'custom',
    };
  } catch {
    return { ...PRESETS.normal, difficulty: 'normal' };
  }
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function detectPreset(s) {
  for (const [name, preset] of Object.entries(PRESETS)) {
    if (
      preset.enemyCount === Number(s.enemyCount) &&
      preset.enemySpeed === Number(s.enemySpeed) &&
      preset.spawnRate === Number(s.spawnRate) &&
      preset.bulletSpeed === Number(s.bulletSpeed)
    ) return name;
  }
  return null;
}

function syncSettingsUI() {
  difficultySelect.value = settings.difficulty;
  enemyCountInput.value = String(settings.enemyCount);
  enemySpeedInput.value = String(settings.enemySpeed);
  spawnRateInput.value = String(settings.spawnRate);
  bulletSpeedInput.value = String(settings.bulletSpeed);

  enemyCountValue.textContent = settings.enemyCount;
  enemySpeedValue.textContent = settings.enemySpeed;
  spawnRateValue.textContent = settings.spawnRate;
  bulletSpeedValue.textContent = settings.bulletSpeed;
}

function markCustomIfNeeded() {
  settings.difficulty = detectPreset(settings) || 'custom';
  difficultySelect.value = settings.difficulty;
}

function createMap() {
  walls = new Set();
  steel = new Set();
  water = new Set();

  for (let x = 0; x < GRID; x++) {
    steel.add(`${x},0`);
    steel.add(`${x},${GRID - 1}`);
  }
  for (let y = 0; y < GRID; y++) {
    steel.add(`0,${y}`);
    steel.add(`${GRID - 1},${y}`);
  }

  for (let y = 5; y < 20; y++) {
    if (y === 12 || y === 13) continue;
    walls.add(`8,${y}`);
    walls.add(`17,${y}`);
  }

  for (let x = 5; x < 21; x++) {
    if (x === 12 || x === 13) continue;
    walls.add(`${x},8`);
    walls.add(`${x},17`);
  }

  for (let x = 10; x <= 15; x++) {
    water.add(`${x},3`);
    water.add(`${x},4`);
  }

  base = { x: 12, y: 24, alive: true };
  walls.add('11,23');
  walls.add('12,23');
  walls.add('13,23');
  walls.add('11,24');
  walls.add('13,24');
}

function tankRect(t) {
  return { x: t.x - 10, y: t.y - 10, w: 20, h: 20 };
}

function overlapsSolid(rect) {
  const x0 = Math.floor(rect.x / TILE);
  const y0 = Math.floor(rect.y / TILE);
  const x1 = Math.floor((rect.x + rect.w - 1) / TILE);
  const y1 = Math.floor((rect.y + rect.h - 1) / TILE);

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const key = `${x},${y}`;
      if (walls.has(key) || steel.has(key) || water.has(key)) return true;
    }
  }
  return false;
}

function tankCollideOther(t, list) {
  const a = tankRect(t);
  return list.some(other => {
    if (other === t || !other.alive) return false;
    const b = tankRect(other);
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  });
}

function canPlaceTankAt(x, y, blockedList = []) {
  const probe = { x, y };
  const rect = tankRect(probe);
  if (
    rect.x < TILE || rect.y < TILE ||
    rect.x + rect.w > WORLD - TILE ||
    rect.y + rect.h > WORLD - TILE ||
    overlapsSolid(rect)
  ) {
    return false;
  }
  return !tankCollideOther({ ...probe, alive: true }, blockedList);
}

function getFreeDirs(tank, blockedList = []) {
  return ['up', 'down', 'left', 'right'].filter(dir => {
    const d = DIRS[dir];
    const probe = { ...tank, x: tank.x + d.x * 6, y: tank.y + d.y * 6 };
    const rect = tankRect(probe);
    if (
      rect.x < TILE || rect.y < TILE ||
      rect.x + rect.w > WORLD - TILE ||
      rect.y + rect.h > WORLD - TILE ||
      overlapsSolid(rect)
    ) return false;
    return !tankCollideOther(probe, blockedList);
  });
}

function tryRelocateEnemy(enemy) {
  const offsets = [
    [0, 2], [0, 3], [1, 2], [-1, 2], [2, 1], [-2, 1], [2, 0], [-2, 0],
    [0, -2], [1, -2], [-1, -2], [3, 0], [-3, 0], [0, 4],
  ];

  for (const [ox, oy] of offsets) {
    const nx = enemy.x + ox * TILE;
    const ny = enemy.y + oy * TILE;
    const blockers = [player, ...enemies.filter(e => e !== enemy)];
    if (canPlaceTankAt(nx, ny, blockers)) {
      enemy.x = nx;
      enemy.y = ny;
      enemy.dir = 'down';
      enemy.stuckTime = 0;
      return true;
    }
  }
  return false;
}

function spawnPlayer() {
  player = {
    x: 12.5 * TILE,
    y: 22.5 * TILE,
    dir: 'up',
    speed: 115,
    cooldown: 0,
    alive: true,
  };
  invincibleTimer = 2;
}

function spawnEnemy() {
  if (enemiesSpawned >= settings.enemyCount) return;

  const spawns = [
    { x: 2.5 * TILE, y: 2.5 * TILE },
    { x: 12.5 * TILE, y: 2.5 * TILE },
    { x: 23.5 * TILE, y: 2.5 * TILE },
  ];

  const candidates = spawns.filter(pos => {
    if (!canPlaceTankAt(pos.x, pos.y, [player, ...enemies])) return false;
    return !enemies.some(e => e.alive && Math.hypot(e.x - pos.x, e.y - pos.y) < 34);
  });
  if (!candidates.length) return;

  const pos = candidates[Math.floor(Math.random() * candidates.length)];
  enemies.push({
    x: pos.x,
    y: pos.y,
    dir: 'down',
    speed: settings.enemySpeed,
    cooldown: 0.6 + Math.random() * 0.6,
    turnTimer: 0.8 + Math.random() * 1.2,
    stuckTime: 0,
    alive: true,
  });
  enemiesSpawned += 1;
}

function fire(tank, fromEnemy = false) {
  if (!tank.alive) return;
  const d = DIRS[tank.dir];
  bullets.push({
    x: tank.x + d.x * 14,
    y: tank.y + d.y * 14,
    dx: d.x,
    dy: d.y,
    speed: settings.bulletSpeed,
    fromEnemy,
    alive: true,
  });
}

function resetGame() {
  score = 0;
  lives = 3;
  level = 1;
  gameOver = false;
  win = false;
  enemiesSpawned = 0;
  enemiesKilled = 0;
  spawnTimer = 0;

  bullets = [];
  particles = [];
  enemies = [];

  createMap();
  spawnPlayer();
  for (let i = 0; i < 3; i++) spawnEnemy();

  renderHud();
}

function renderHud() {
  scoreEl.textContent = String(score);
  livesEl.textContent = String(lives);
  levelEl.textContent = String(level);
}

function step(dt) {
  if (gameOver || win) return;

  invincibleTimer = Math.max(0, invincibleTimer - dt);
  spawnTimer += dt;
  if (spawnTimer * 1000 >= settings.spawnRate && enemiesSpawned < settings.enemyCount) {
    spawnTimer = 0;
    spawnEnemy();
  }

  updatePlayer(dt);
  updateEnemies(dt);
  updateBullets(dt);

  particles = particles.filter(p => (p.life -= dt) > 0);

  if (!base.alive || lives <= 0) {
    gameOver = true;
  }

  if (enemiesKilled >= settings.enemyCount && enemies.every(e => !e.alive)) {
    win = true;
  }
}

function moveTank(tank, dt, blockedList = []) {
  const d = DIRS[tank.dir];
  const oldX = tank.x;
  const oldY = tank.y;
  tank.x += d.x * tank.speed * dt;
  tank.y += d.y * tank.speed * dt;

  const rect = tankRect(tank);
  if (
    rect.x < TILE || rect.y < TILE ||
    rect.x + rect.w > WORLD - TILE ||
    rect.y + rect.h > WORLD - TILE ||
    overlapsSolid(rect) ||
    tankCollideOther(tank, blockedList)
  ) {
    tank.x = oldX;
    tank.y = oldY;
    return false;
  }
  return true;
}

function updatePlayer(dt) {
  if (!player.alive) return;
  player.cooldown -= dt;

  let moved = false;
  if (keys.has('arrowup') || keys.has('w')) {
    player.dir = 'up';
    moved = moveTank(player, dt, enemies);
  } else if (keys.has('arrowdown') || keys.has('s')) {
    player.dir = 'down';
    moved = moveTank(player, dt, enemies);
  } else if (keys.has('arrowleft') || keys.has('a')) {
    player.dir = 'left';
    moved = moveTank(player, dt, enemies);
  } else if (keys.has('arrowright') || keys.has('d')) {
    player.dir = 'right';
    moved = moveTank(player, dt, enemies);
  }

  if ((keys.has(' ') || keys.has('j')) && player.cooldown <= 0) {
    fire(player, false);
    player.cooldown = 0.28;
  }

  if (!moved) {
    // snap slight drift for retro feel
    player.x = Math.round(player.x / 2) * 2;
    player.y = Math.round(player.y / 2) * 2;
  }
}

function updateEnemies(dt) {
  enemies.forEach(enemy => {
    if (!enemy.alive) return;

    enemy.cooldown -= dt;
    enemy.turnTimer -= dt;

    if (enemy.turnTimer <= 0) {
      const options = ['up', 'down', 'left', 'right'];
      enemy.dir = options[Math.floor(Math.random() * options.length)];
      enemy.turnTimer = 0.7 + Math.random() * 1.2;

      // bias toward player
      if (Math.random() < 0.45) {
        const dx = player.x - enemy.x;
        const dy = player.y - enemy.y;
        enemy.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
      }
    }

    const moved = moveTank(enemy, dt, [player, ...enemies]);
    if (!moved) {
      enemy.stuckTime = (enemy.stuckTime || 0) + dt;
      const freeDirs = getFreeDirs(enemy, [player, ...enemies]);
      if (freeDirs.length) {
        enemy.dir = freeDirs[Math.floor(Math.random() * freeDirs.length)];
      } else {
        enemy.dir = 'down';
      }
      enemy.turnTimer = 0.25;

      if (enemy.stuckTime > 0.8) {
        tryRelocateEnemy(enemy);
      }
    } else {
      enemy.stuckTime = 0;
    }

    if (enemy.cooldown <= 0) {
      fire(enemy, true);
      enemy.cooldown = 0.8 + Math.random() * 0.8;
    }
  });
}

function explode(x, y, color = '#ffb703') {
  for (let i = 0; i < 10; i++) {
    particles.push({
      x,
      y,
      vx: (Math.random() - 0.5) * 100,
      vy: (Math.random() - 0.5) * 100,
      life: 0.3 + Math.random() * 0.25,
      color,
    });
  }
}

function hitTile(x, y) {
  const tx = Math.floor(x / TILE);
  const ty = Math.floor(y / TILE);
  const key = `${tx},${ty}`;

  if (walls.has(key)) {
    walls.delete(key);
    explode(tx * TILE + TILE / 2, ty * TILE + TILE / 2, '#fb8500');
    return true;
  }
  if (steel.has(key) || water.has(key)) {
    return true;
  }

  if (base.alive && tx === base.x && ty === base.y) {
    base.alive = false;
    explode(base.x * TILE + TILE / 2, base.y * TILE + TILE / 2, '#ef233c');
    return true;
  }
  return false;
}

function updateBullets(dt) {
  bullets.forEach(b => {
    if (!b.alive) return;
    b.x += b.dx * b.speed * dt;
    b.y += b.dy * b.speed * dt;

    if (b.x < TILE || b.y < TILE || b.x > WORLD - TILE || b.y > WORLD - TILE) {
      b.alive = false;
      return;
    }

    if (hitTile(b.x, b.y)) {
      b.alive = false;
      return;
    }

    if (b.fromEnemy) {
      if (player.alive && invincibleTimer <= 0 && Math.abs(player.x - b.x) < 12 && Math.abs(player.y - b.y) < 12) {
        b.alive = false;
        explode(player.x, player.y, '#e63946');
        lives -= 1;
        renderHud();
        if (lives > 0) spawnPlayer();
        else player.alive = false;
      }
    } else {
      enemies.forEach(enemy => {
        if (!enemy.alive || !b.alive) return;
        if (Math.abs(enemy.x - b.x) < 12 && Math.abs(enemy.y - b.y) < 12) {
          enemy.alive = false;
          b.alive = false;
          enemiesKilled += 1;
          score += 100;
          renderHud();
          explode(enemy.x, enemy.y, '#ffd166');
        }
      });
    }
  });

  // bullet vs bullet
  for (let i = 0; i < bullets.length; i++) {
    const a = bullets[i];
    if (!a.alive) continue;
    for (let j = i + 1; j < bullets.length; j++) {
      const b = bullets[j];
      if (!b.alive || a.fromEnemy === b.fromEnemy) continue;
      if (Math.abs(a.x - b.x) < 6 && Math.abs(a.y - b.y) < 6) {
        a.alive = false;
        b.alive = false;
        explode((a.x + b.x) / 2, (a.y + b.y) / 2, '#f1faee');
      }
    }
  }

  bullets = bullets.filter(b => b.alive);
}

function drawTile(x, y, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
}

function drawTank(t, colorBody, colorHead) {
  const x = t.x;
  const y = t.y;

  ctx.save();
  ctx.translate(x, y);

  const angle = {
    up: -Math.PI / 2,
    right: 0,
    down: Math.PI / 2,
    left: Math.PI,
  }[t.dir];
  ctx.rotate(angle);

  ctx.fillStyle = colorBody;
  ctx.fillRect(-10, -8, 20, 16);
  ctx.fillStyle = '#1b1b1b';
  ctx.fillRect(-9, -10, 5, 20);
  ctx.fillRect(4, -10, 5, 20);

  ctx.fillStyle = colorHead;
  ctx.fillRect(-4, -4, 8, 8);
  ctx.fillRect(2, -2, 12, 4);
  ctx.restore();
}

function render() {
  ctx.clearRect(0, 0, WORLD, WORLD);

  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, WORLD, WORLD);

  for (let x = 0; x < GRID; x++) {
    for (let y = 0; y < GRID; y++) {
      if ((x + y) % 2 === 0) {
        ctx.fillStyle = '#151515';
        ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
      }
    }
  }

  walls.forEach(k => {
    const [x, y] = k.split(',').map(Number);
    drawTile(x, y, '#b5651d');
    ctx.fillStyle = '#8a4b14';
    ctx.fillRect(x * TILE + 2, y * TILE + 2, TILE - 4, TILE - 4);
  });

  steel.forEach(k => {
    const [x, y] = k.split(',').map(Number);
    drawTile(x, y, '#6c757d');
  });

  water.forEach(k => {
    const [x, y] = k.split(',').map(Number);
    drawTile(x, y, '#1d4ed8');
  });

  if (base.alive) {
    drawTile(base.x, base.y, '#ffd166');
    ctx.fillStyle = '#7f5539';
    ctx.fillRect(base.x * TILE + 6, base.y * TILE + 6, 12, 12);
  } else {
    drawTile(base.x, base.y, '#4a0404');
  }

  enemies.forEach(e => e.alive && drawTank(e, '#d62828', '#f77f00'));
  if (player.alive) {
    const flash = invincibleTimer > 0 && Math.floor(invincibleTimer * 10) % 2 === 0;
    drawTank(player, flash ? '#f8f9fa' : '#2a9d8f', '#e9c46a');
  }

  ctx.fillStyle = '#f1faee';
  bullets.forEach(b => {
    ctx.fillRect(b.x - 2, b.y - 2, 4, 4);
  });

  particles.forEach(p => {
    p.x += p.vx * (1 / 60);
    p.y += p.vy * (1 / 60);
    ctx.globalAlpha = Math.max(0, p.life * 2);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    ctx.globalAlpha = 1;
  });

  if (gameOver || win) {
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.fillRect(0, 0, WORLD, WORLD);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.font = 'bold 48px sans-serif';
    ctx.fillText(win ? 'YOU WIN' : 'GAME OVER', WORLD / 2, WORLD / 2 - 10);
    ctx.font = '18px sans-serif';
    ctx.fillText('点击“重新开始”继续战斗', WORLD / 2, WORLD / 2 + 28);
  }
}

function loop(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;

  step(dt);
  render();

  requestAnimationFrame(loop);
}

function bindSetting(input, valueEl, field, applyReset = false) {
  input.addEventListener('input', e => {
    settings[field] = Number(e.target.value);
    valueEl.textContent = settings[field];
    markCustomIfNeeded();
    saveSettings();
    if (applyReset) resetGame();
  });
}

difficultySelect.addEventListener('change', e => {
  const d = e.target.value;
  settings.difficulty = d;
  if (d !== 'custom') {
    Object.assign(settings, PRESETS[d]);
  }
  syncSettingsUI();
  saveSettings();
  resetGame();
});

bindSetting(enemyCountInput, enemyCountValue, 'enemyCount', true);
bindSetting(enemySpeedInput, enemySpeedValue, 'enemySpeed', true);
bindSetting(spawnRateInput, spawnRateValue, 'spawnRate', true);
bindSetting(bulletSpeedInput, bulletSpeedValue, 'bulletSpeed', false);

restartBtn.addEventListener('click', resetGame);

window.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd', ' ', 'j'].includes(k)) {
    e.preventDefault();
  }
  keys.add(k);
});
window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));

syncSettingsUI();
resetGame();
requestAnimationFrame(loop);
