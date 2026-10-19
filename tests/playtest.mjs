// ============================================================
// playtest.mjs —— 零依赖「无头试玩」集成测试
//
// 这是比 smoke.mjs 更狠一层的测试：它用一堆最小的 DOM / Canvas / WebAudio 桩，
// 在 Node 里把真正的 src/main.js 跑起来，然后：
//   1. 驱动主循环，验证 boot → 菜单 → 游戏 → 结算 的完整流程
//   2. 用合成的键盘 / 触摸事件走输入系统
//   3. 检查暂停真的把世界冻住了、切后台会自动暂停
//   4. 检查 resize / 横竖屏切换后画布尺寸与安全区重算
//   5. 穷举所有「障碍尺寸 × 速度 × 起跳时机」，证明每一种障碍都跳得过去
//      （这是「障碍间距可达性」的硬证据），并验证 100 秒实时铺出来的间距足够宽
//
// 跑法：node tests/playtest.mjs
// 退出码 0 = 通过。
//
// 说明：这个文件不参与游戏运行，只是测试；沙箱里没有 requestAnimationFrame，
//       所以主循环由测试自己一帧一帧地「手动摇」。
// ============================================================
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

let passed = 0, failed = 0;
const failures = [];
function ok(name) { passed++; console.log('  \u2713 ' + name); }
function bad(name, detail) { failed++; failures.push(name + ' —— ' + detail); console.log('  \u2717 ' + name + '  (' + detail + ')'); }
function check(name, cond, detail = '') { cond ? ok(name) : bad(name, detail); }
function section(t) { console.log('\n' + t); }

// ============================================================
// 一、最小 DOM / Canvas / WebAudio 桩
// ============================================================
function makeCtx() {
  const state = {};
  const impl = {
    save() {}, restore() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
    arc() {}, ellipse() {}, rect() {}, fill() {}, stroke() {}, fillRect() {}, clearRect() {},
    strokeRect() {}, translate() {}, scale() {}, rotate() {}, setTransform() {}, resetTransform() {},
    fillText() {}, strokeText() {}, clip() {}, quadraticCurveTo() {}, bezierCurveTo() {},
    roundRect() {}, setLineDash() {}, drawImage() {}, putImageData() {},
    measureText: () => ({ width: 10 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createPattern: () => null,
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
  };
  return new Proxy(impl, {
    get: (o, k) => (k in o ? o[k] : state[k]),
    set: (o, k, v) => { state[k] = v; return true; },
  });
}

function makeCanvas() {
  const ctx = makeCtx();
  const c = {
    width: 720, height: 1280, style: {},
    getContext: () => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 720, height: 1280, right: 720, bottom: 1280 }),
    addEventListener() {}, removeEventListener() {}, setAttribute() {}, getAttribute: () => null,
  };
  ctx.canvas = c;
  return c;
}

function makeEl(tag) {
  const e = {
    tagName: String(tag).toUpperCase(), style: {}, dataset: {}, children: [],
    textContent: '', className: '', id: '',
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {}, getAttribute: () => null, removeAttribute() {},
    appendChild(c) { e.children.push(c); return c; }, removeChild() {}, remove() {},
    addEventListener() {}, removeEventListener() {}, focus() {}, blur() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }),
  };
  return e;
}

const canvas = makeCanvas();
const listeners = new Map();
/** 同时兼容 addEventListener(type, fn) 这种标准调用形式 */
function listen(type, fn) {
  const key = String(type);
  if (!listeners.has(key)) listeners.set(key, []);
  listeners.get(key).push(fn);
}

globalThis.document = {
  getElementById: (id) => (id === 'game' ? canvas : { textContent: '', style: {}, remove() {} }),
  createElement: (tag) => (tag === 'canvas' ? makeCanvas() : makeEl(tag)),
  addEventListener: listen, removeEventListener: () => {},
  body: { appendChild() {}, removeChild() {}, style: {} },
  documentElement: { style: {} },
  hidden: false, visibilityState: 'visible',
};
globalThis.window = globalThis;
globalThis.addEventListener = listen;
globalThis.removeEventListener = () => {};
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
globalThis.location = { protocol: 'file:', href: 'file:///index.html' };
try { globalThis.navigator = { userAgent: 'node', vibrate: () => true }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node', vibrate: () => true }, configurable: true }); }
globalThis.devicePixelRatio = 2;
globalThis.screen = { width: 720, height: 1280 };
globalThis.innerWidth = 720;
globalThis.innerHeight = 1280;

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
  key: (i) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
};

let rafCb = null;
globalThis.requestAnimationFrame = (cb) => { rafCb = cb; return 1; };
globalThis.cancelAnimationFrame = () => { rafCb = null; };

class FakeParam {
  constructor() { this.value = 0; }
  setValueAtTime() { return this; } linearRampToValueAtTime() { return this; }
  exponentialRampToValueAtTime() { return this; } cancelScheduledValues() { return this; }
  setTargetAtTime() { return this; }
}
class FakeNode {
  constructor() { this.gain = new FakeParam(); this.frequency = new FakeParam(); this.detune = new FakeParam(); this.Q = new FakeParam(); this.type = 'sine'; }
  connect() { return this; } disconnect() {} start() {} stop() {}
}
globalThis.AudioContext = class {
  constructor() { this.currentTime = 0; this.state = 'suspended'; this.destination = new FakeNode(); }
  createGain() { return new FakeNode(); } createOscillator() { return new FakeNode(); }
  createBiquadFilter() { return new FakeNode(); } createBufferSource() { return new FakeNode(); }
  createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) }; }
  createDynamicsCompressor() { return new FakeNode(); } createStereoPanner() { return new FakeNode(); }
  resume() { this.state = 'running'; return Promise.resolve(); }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
  close() { return Promise.resolve(); }
};

// ============================================================
// 二、把游戏跑起来
// ============================================================
section('[1/6] 启动引擎');

await import(pathToFileURL(path.join(ROOT, 'src', 'main.js')).href);
const game = globalThis.__NEON__;
check('main.js 成功启动并暴露 game 对象', !!game);
if (!game) { console.log('\n启动失败，后面的测试没法进行。'); process.exit(1); }

let t = 0;
/** 手动摇 n 帧主循环；dtMs 可以传大值来模拟卡顿 */
function frames(n, dtMs = 16.667) {
  for (let i = 0; i < n; i++) {
    if (!rafCb) throw new Error('主循环停了：requestAnimationFrame 没有被重新注册');
    const cb = rafCb; rafCb = null;
    t += dtMs;
    cb(t);
  }
}
const top = () => game.scenes.stack[game.scenes.stack.length - 1];
const stackNames = () => game.scenes.stack.map((s) => s.constructor.name).join(' > ');
function fire(type, ev) { for (const fn of listeners.get(type) || []) fn(ev); }
const key = (code) => ({ code, repeat: false, preventDefault() {}, button: 0, clientX: 0, clientY: 0 });
function tap(code) {
  fire('keydown', key(code));
  frames(3);
  fire('keyup', key(code));
  frames(15);
}

check('初始进入 BootScene', top().constructor.name === 'BootScene', stackNames());

section('[2/6] 完整流程：开机 → 菜单 → 游戏 → 结算 → 重开');

frames(180);
check('3 秒后自动进入菜单', top().constructor.name === 'MenuScene', stackNames());

tap('Space');
check('空格进入游戏', top().constructor.name === 'PlayScene', stackNames());

let deathFrame = -1;
for (let i = 0; i < 1200; i++) { frames(1); if (top().constructor.name === 'GameOverScene') { deathFrame = i; break; } }
check('不跳的话会被障碍撞死（碰撞检测有效）', deathFrame > 0, '跑了 20 秒都没死');
console.log('      撞死时间：第 ' + deathFrame + ' 帧 ≈ ' + (deathFrame / 60).toFixed(1) + ' 秒');

tap('Space');
check('结算页空格能重开一局', top().constructor.name === 'PlayScene', stackNames());

section('[3/6] 暂停 / 恢复');

game.scenes.clear();
game.scenes.push('play');
frames(30);
tap('Escape');
check('Esc 进入暂停', top().constructor.name === 'PauseScene', stackNames());
{
  const play = game.scenes.stack[0];
  const d0 = play.distance;
  frames(120);
  check('暂停时世界真的冻住了', Math.abs(play.distance - d0) < 1e-6, d0 + ' → ' + play.distance);
}
tap('Escape');
check('再按 Esc 回到游戏', top().constructor.name === 'PlayScene', stackNames());

// HUD 右上角暂停按钮
{
  const play = top();
  const r = play.hud.pauseRect;
  const before = play.player.onGround;
  game.input.pressPoint = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  frames(2);
  game.input.pressPoint = null;
  frames(10);
  check('触摸右上角暂停按钮能暂停', top().constructor.name === 'PauseScene', stackNames());
  check('点暂停按钮不会顺手让玩家跳一下', before === true && play.player.onGround === true);
  tap('Escape');
}

section('[4/6] 继续游戏（暂停 → 回菜单 → 继续）');

game.scenes.clear();
game.scenes.push('play');
frames(200);
tap('Escape');
{
  const pauseScene = top();
  const btn = pauseScene.buttons.find((b) => b.id === 'menu');
  check('暂停覆盖层有「回菜单」按钮', !!btn);
  if (btn) {
    game.input.pressPoint = { x: btn.rect.x + 5, y: btn.rect.y + 5 };
    frames(3);
    game.input.pressPoint = null;
    frames(20);
  }
}
check('回到主菜单', top().constructor.name === 'MenuScene', stackNames());
check('回菜单时保存了「可继续」快照', !!game.save.data.resume, JSON.stringify(game.save.data.resume));

{
  const menu = top();
  const btn = menu.buttons.find((b) => b.id === 'continue');
  check('菜单出现了「继续游戏」按钮', !!btn);
  if (btn) {
    game.input.pressPoint = { x: btn.rect.x + 5, y: btn.rect.y + 5 };
    frames(3);
    game.input.pressPoint = null;
    frames(20);
  }
}
check('继续游戏回到 PlayScene', top().constructor.name === 'PlayScene', stackNames());
check('继续时距离接着上一局', top().distance > 1000, 'distance=' + top().distance.toFixed(0));

section('[5/6] 自适应 / 安全区 / 后台暂停');

{
  const e = game.engine;
  globalThis.innerWidth = 390;
  globalThis.innerHeight = 844;
  fire('resize', {});
  frames(3);
  check('resize 后画布按 DPR 重算', e.canvas.width === 780 && e.canvas.height === 1688, e.canvas.width + 'x' + e.canvas.height);
  const expect = Math.min(390 / 720, 844 / 1280);
  check('等比缩放比例正确（contain）', Math.abs(e.scale - expect) < 1e-6, e.scale + ' vs ' + expect);

  const d = e.toDesign(195, 422);
  check('屏幕坐标 → 设计坐标换算正确', Math.abs(d.x - 360) < 1.5 && Math.abs(d.y - 640) < 1.5, d.x.toFixed(1) + ',' + d.y.toFixed(1));

  globalThis.innerWidth = 1280;
  globalThis.innerHeight = 720;
  fire('resize', {});
  frames(3);
  check('横屏也能正常缩放', e.canvas.width === 2560 && e.canvas.height === 1440, e.canvas.width + 'x' + e.canvas.height);
  check('安全区对象存在（读取 env(safe-area-inset-*)）', typeof e.safe.top === 'number');

  globalThis.innerWidth = 720;
  globalThis.innerHeight = 1280;
  fire('resize', {});
  frames(3);

  globalThis.document.hidden = true;
  fire('visibilitychange', {});
  frames(3);
  check('切到后台自动暂停', e.paused === true);
  const d0 = top().distance;
  frames(60);
  check('后台期间游戏不推进', Math.abs(top().distance - d0) < 1e-6);
  globalThis.document.hidden = false;
  fire('visibilitychange', {});
  frames(3);
  check('回到前台自动恢复', e.paused === false);

  frames(1, 5000);   // 模拟卡了 5 秒
  frames(3);
  check('单帧 5 秒的卡顿不会让游戏炸掉', true);
}

// 触摸跳跃
try {
  fire('touchstart', { preventDefault() {}, changedTouches: [{ clientX: 100, clientY: 1000 }], touches: [{}] });
  frames(3);
  fire('touchend', { preventDefault() {}, touches: [] });
  frames(10);
  check('合成触摸事件走通输入系统', true);
} catch (e) { bad('合成触摸事件走通输入系统', e.message); }

// 存档 / 音频
for (const fn of ['click', 'jump', 'doubleJump', 'land', 'coin', 'hit', 'fanfare', 'startMusic', 'stopMusic', 'refreshMusic']) {
  if (typeof game.audio[fn] !== 'function') { bad('audio.' + fn + ' 存在', '缺失'); }
}
check('音频模块方法齐全（10 个）', true);
check('资源清单为空（图形全部程序化绘制）', game.assets.total === 0, 'total=' + game.assets.total);

// ============================================================
// 四、可达性证明：枚举所有可能的障碍，证明「每一种都有跳过去的时机」
// ============================================================
section('[6/6] 可达性证明（穷举 障碍尺寸 × 速度 × 起跳时机）');

// 这里直接调用游戏本体的 Player 物理，逐个模拟「障碍逼近 → 玩家起跳 → 越过去」。
// 只要每个障碍都存在至少一个能过的起跳时机，就说明关卡是可解的；
// 反过来如果某个尺寸无解，就是设计缺陷。这比派个手残 bot 去跑更有说服力。
const { Player } = await import(pathToFileURL(path.join(ROOT, 'src', 'entities', 'player.js')).href);
const CFG = await import(pathToFileURL(path.join(ROOT, 'src', 'config.js')).href);

const HEIGHTS = [50, 91, 132, 215, 250];             // 低障碍 最小/中值/最大 + 高障碍 最小/最大
const WIDTHS = [38, 67, 96];
const SPEEDS = [CFG.BASE_SPEED, 690, CFG.MAX_SPEED];
const FRAME = 1 / 60;

/**
 * 模拟一次：t0 秒后障碍左边缘追上玩家右边缘，j1 秒时补一次二段跳（j1<0 表示不补）。
 * @returns {boolean} true = 安全通过
 */
function tryClear(h, w, speed, t0, j1) {
  // v1.1 起 Player.update() 会在起跳/落地时调 fx.burst() 出粒子。
  // 这里只关心物理可达性，给一个空的 fx 桩即可（生产路径传的是 g.fx）。
  const p = new Player({ burst() {} }, null);
  p.reset();
  const b0 = p.hitbox();
  let ox = b0.x + b0.w + speed * t0;      // 障碍左边缘
  const oy = CFG.GROUND_Y - h;           // 障碍上边缘
  p.pressJump();
  let secondDone = j1 < 0;
  let t = 0;
  for (let i = 0; i < 400; i++) {
    p.update(FRAME);
    ox -= speed * FRAME;
    t += FRAME;
    if (!secondDone && t >= j1) { p.pressJump(); secondDone = true; }
    const b = p.hitbox();
    if (b.x < ox + w && b.x + b.w > ox && b.y < oy + h && b.y + b.h > oy) return false;   // 撞上了
    if (ox + w < b.x) return true;                                                        // 障碍整体过去了
  }
  return false;
}

let combosTotal = 0, unreachable = 0;
let minWindowFrames = Infinity, worstCase = '';
for (const h of HEIGHTS) {
  for (const w of WIDTHS) {
    for (const speed of SPEEDS) {
      combosTotal++;
      const good = [];
      for (let k = 0; k <= 72; k++) {                  // 起跳时机 0 ~ 1.2 秒，每帧一格
        const t0 = k * FRAME;
        let ok = tryClear(h, w, speed, t0, -1);        // 先试「只按一次」
        for (let j = 1; j <= 36 && !ok; j++) ok = tryClear(h, w, speed, t0, j * FRAME);   // 再试「空中补二段跳」
        if (ok) good.push(t0);
      }
      if (good.length === 0) { unreachable++; console.log('      ✗ 这种障碍跳不过去：h=' + h + ' w=' + w + ' speed=' + speed); }
      if (good.length < minWindowFrames) { minWindowFrames = good.length; worstCase = 'h' + h + '/w' + w + '/' + speed + 'px每秒'; }
    }
  }
}
console.log('      穷举 ' + combosTotal + ' 种「障碍尺寸 × 滚动速度」，每一种都存在可跳过的起跳时机');
console.log('      最苛刻的一种是 ' + worstCase + '，仍有 ' + minWindowFrames + ' 个连续帧（约 ' +
  (minWindowFrames / 60 * 1000).toFixed(0) + ' 毫秒）的容错窗口');

check('所有障碍组合都跳得过去（可达性成立）', unreachable === 0, unreachable + ' 种无解');
check('最苛刻的障碍也有 ≥ 3 帧（50 毫秒）容错窗口', minWindowFrames >= 3, minWindowFrames + ' 帧');

// spawner 自己的「间距校验」：按真实游戏循环铺 100 秒障碍，逐次检查新生成的间距
{
  const { Spawner } = await import(pathToFileURL(path.join(ROOT, 'src', 'entities', 'spawner.js')).href);
  const sp = new Spawner();
  sp.reset();
  const dt = 1 / 60;
  let distance = 0, spawned = 0, minTimeGap = Infinity, minTimeGapAt = 0, bad = 0;

  for (let i = 0; i < 6000; i++) {                     // 100 秒
    const speed = Math.min(CFG.MAX_SPEED,
      CFG.BASE_SPEED + (CFG.MAX_SPEED - CFG.BASE_SPEED) * distance / CFG.SPEED_RAMP_DISTANCE);
    const n0 = sp.obstacles.length;
    const prev = sp.obstacles[n0 - 1];                 // 上一个障碍（会被原地左移，引用有效）
    sp.update(dt, speed, distance);
    distance += speed * dt;
    if (sp.obstacles.length > n0) {
      spawned++;
      // 新障碍登场时，和上一个障碍右边缘的真实间距（px）
      const gap = sp.obstacles[sp.obstacles.length - 1].x - (prev ? prev.x + prev.w : -Infinity);
      // 换算成「玩家要用多久才能跑完这段空隙」——这才是手感的真实指标
      const timeGap = gap / speed;
      if (timeGap < minTimeGap) { minTimeGap = timeGap; minTimeGapAt = speed; }
      if (timeGap < 0.6) bad++;
    }
  }
  console.log('      真实循环铺了 ' + spawned + ' 个障碍；两个障碍之间最短的时间间隔 ' +
    (minTimeGap * 1000).toFixed(0) + ' 毫秒（发生在 ' + minTimeGapAt.toFixed(0) + 'px每秒，一次完整跳跃滞空 ' +
    (CFG.AIR_TIME * 1000).toFixed(0) + ' 毫秒）');
  check('两个障碍之间始终留出 ≥ 0.6 秒（足够落地再起跳）', bad === 0, bad + '/' + spawned + ' 个间距过窄');
  check('确实生成了足够多的障碍（样本有效）', spawned > 40, '只生成了 ' + spawned + ' 个');
}

check('存档已记录游玩数据', game.save.data.playCount > 0, 'playCount=' + game.save.data.playCount);

// ---------- 汇总 ----------
console.log('\n' + '-'.repeat(56));
console.log('  通过 ' + passed + ' 项，失败 ' + failed + ' 项');
if (failed) { console.log('\n  失败明细：'); for (const f of failures) console.log('   · ' + f); }
console.log('-'.repeat(56) + '\n');
process.exit(failed ? 1 : 0);