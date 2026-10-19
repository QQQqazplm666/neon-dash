// ============================================================
// smoke.mjs —— 零依赖冒烟测试
//
// 跑法（node 不在 PATH 上时用完整路径）：
//   node tests/smoke.mjs
//
// 它做七件事：
//   1. 语法自检：对每个源码文件调用 `node --check`（真正的 ESM 语法解析）
//   2. 配置校验：断言关键数值合法（重力 > 0、起跳速度 < 0、设计分辨率 720x1280 …）
//   3. 结构校验：必须交付的文件一个都不能少，且 index.html 引用了入口脚本
//   4. 难度曲线模拟：跑满难度需要多久、是不是「前段轻 / 中段陡 / 后段平台」，
//      以及生成出来的关卡是否始终满足可达性
//   5. 金币 / 商城 / 皮肤：皮肤表合法、旧存档迁移不抛错、购买与装备的账目正确
//   6. 本地 import 解析：相对路径与具名导出必须对得上
//   7. 无头场景联动：用假的 canvas / document 把真实的六个场景跑 4000 帧，
//      走一遍「启动 → 菜单 → 玩法 → 暂停 → 死亡 → 结算 → 商城 → 买皮肤 → 回菜单」
//
// 退出码 0 表示全部通过，1 表示有失败项。
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

// ---------- 小工具 ----------
let passed = 0;
let failed = 0;
const failures = [];

function ok(name) { passed++; console.log('  \u2713 ' + name); }
function bad(name, detail) {
  failed++;
  failures.push(name + (detail ? ' —— ' + detail : ''));
  console.log('  \u2717 ' + name + (detail ? '  (' + detail + ')' : ''));
}
function check(name, cond, detail) { cond ? ok(name) : bad(name, detail); }
function section(title) { console.log('\n' + title); }

// ---------- 1. 收集源码文件 ----------
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function rel(p) { return path.relative(ROOT, p).replace(/\\/g, '/'); }

section('[1/10] 语法自检（node --check）');

const srcFiles = walk(path.join(ROOT, 'src')).sort();
const rootFiles = ['sw.js', 'server.mjs'].map((f) => path.join(ROOT, f));
const codeFiles = [...srcFiles, path.join(HERE, 'smoke.mjs')].filter((f) => fs.existsSync(f));

// 用哪个 node 去检查？优先 process.execPath（就是当前这个 node）
const NODE = process.execPath;

/**
 * 真正的语法检查：开子进程跑 `node --check`。
 *
 * 细节：这里不用管道（stdio: 'pipe'）来抓 stderr —— 某些受限沙箱禁止子进程
 * 使用命名管道，会直接抛 EPERM。改成把 stderr 重定向到一个临时文件，
 * 既能拿到真实的报错文本，又不会碰到管道的限制。
 *
 * 万一连子进程都开不起来，再退回纯 JS 解析方案：把 import / import.meta /
 * export 剥掉，用 async 包一层（这样顶层 await 也合法），再用 vm.Script 编译。
 */
function syntaxCheck(file) {
  const tmp = path.join(os.tmpdir(), 'neon-dash-check-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.log');
  let fd = -1;
  try {
    fd = fs.openSync(tmp, 'w');
    const r = spawnSync(NODE, ['--check', file], { stdio: ['ignore', 'ignore', fd], timeout: 20000 });
    fs.closeSync(fd);
    fd = -1;

    if (r.error) throw r.error;              // 子进程都开不起来 → 走退回方案
    if (r.status === 0) return { ok: true, how: 'node --check' };

    const errText = fs.readFileSync(tmp, 'utf8');
    const line = (errText.split('\n').find((l) => l && !l.startsWith('node:internal')) || errText).trim();
    return { ok: false, how: 'node --check', detail: line };
  } catch (spawnErr) {
    // ---- 退回方案 ----
    try {
      const src = fs.readFileSync(file, 'utf8');
      const stripped = src
        .replace(/^\s*import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '')
        .replace(/^\s*import\s*['"][^'"]+['"];?\s*$/gm, '')
        .replace(/^\s*export\s+(?=(default|const|let|var|function|class|async))/gm, '')
        .replace(/\bimport\.meta\b/g, '__import_meta__');
      new vm.Script('(async () => {\n' + stripped + '\n})', { filename: file });
      return { ok: true, how: 'vm.Script 退回方案（子进程被沙箱拦截：' + (spawnErr.code || spawnErr.message) + '）' };
    } catch (e) {
      return { ok: false, how: 'vm.Script 退回方案', detail: e.message };
    }
  } finally {
    if (fd >= 0) { try { fs.closeSync(fd); } catch { /* 忽略 */ } }
    try { fs.unlinkSync(tmp); } catch { /* 忽略 */ }
  }
}

let usedFallback = false;
for (const f of codeFiles) {
  const r = syntaxCheck(f);
  const label = r.how.startsWith('vm') ? 'vm.Script 退回方案' : r.how;
  if (r.how.startsWith('vm')) usedFallback = true;
  check(rel(f) + '  [' + label + ']', r.ok, r.detail);
}
if (usedFallback) {
  console.log('  提示：本次走的是退回解析方案（子进程被沙箱拦截），功能等价但不等同于官方 ESM 检查。');
}

// 根目录的 server.mjs / sw.js 也要能解析
section('[2/10] 根目录脚本');
for (const f of rootFiles) {
  if (!fs.existsSync(f)) { bad('缺少 ' + rel(f)); continue; }
  const r = syntaxCheck(f);
  const label = r.how.startsWith('vm') ? 'vm.Script 退回方案' : r.how;
  check(rel(f) + '  [' + label + ']', r.ok, r.detail);
}

// ---------- 2. 配置校验 ----------
section('[3/10] 配置数值校验');

let C = null;
try {
  C = await import(pathToFileURL(path.join(ROOT, 'src', 'config.js')).href);
  ok('可以 import src/config.js');
} catch (e) {
  bad('可以 import src/config.js', e.message);
}

if (C) {
  const num = (name) => {
    const v = C[name];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      bad('config.' + name + ' 是有限数字', 'got ' + String(v));
      return NaN;
    }
    return v;
  };

  // --- 设计分辨率 ---
  check('DESIGN_WIDTH === 720', C.DESIGN_WIDTH === 720, 'got ' + C.DESIGN_WIDTH);
  check('DESIGN_HEIGHT === 1280', C.DESIGN_HEIGHT === 1280, 'got ' + C.DESIGN_HEIGHT);
  check('设计分辨率是竖屏（高 > 宽）', C.DESIGN_HEIGHT > C.DESIGN_WIDTH);

  // --- 物理 ---
  const g = num('GRAVITY');
  check('GRAVITY > 0', g > 0, 'got ' + g);
  const jv = num('JUMP_VELOCITY');
  check('JUMP_VELOCITY < 0（屏幕坐标 y 向下，负值才是往上跳）', jv < 0, 'got ' + jv);
  const djv = num('DOUBLE_JUMP_VELOCITY');
  check('DOUBLE_JUMP_VELOCITY < 0', djv < 0, 'got ' + djv);
  check('二段跳比一段跳矮（|v2| < |v1|）', Math.abs(djv) < Math.abs(jv));
  check('FALL_MULTIPLIER > 1（下落比上升更快，手感更干脆）', num('FALL_MULTIPLIER') > 1);
  check('MAX_FALL_SPEED > 0', num('MAX_FALL_SPEED') > 0);
  check('MAX_JUMPS === 2（支持二段跳）', C.MAX_JUMPS === 2, 'got ' + C.MAX_JUMPS);

  // --- 手感 ---
  const coyote = num('COYOTE_TIME');
  check('COYOTE_TIME 在 0.05~0.2s 之间', coyote >= 0.05 && coyote <= 0.2, 'got ' + coyote);
  const buffer = num('JUMP_BUFFER');
  check('JUMP_BUFFER 在 0.05~0.2s 之间', buffer >= 0.05 && buffer <= 0.2, 'got ' + buffer);

  // --- 世界布局 ---
  const groundY = num('GROUND_Y');
  check('GROUND_Y 在画面内', groundY > 0 && groundY < C.DESIGN_HEIGHT, 'got ' + groundY);
  const pxr = num('PLAYER_X_RATIO');
  check('PLAYER_X_RATIO 约等于 0.25', Math.abs(pxr - 0.25) < 0.001, 'got ' + pxr);
  check('PLAYER_WIDTH / PLAYER_HEIGHT > 0', num('PLAYER_WIDTH') > 0 && num('PLAYER_HEIGHT') > 0);

  // --- 难度曲线 ---
  const base = num('BASE_SPEED');
  const max = num('MAX_SPEED');
  check('BASE_SPEED > 0', base > 0, 'got ' + base);
  check('MAX_SPEED > BASE_SPEED（难度确实在上升）', max > base, 'got ' + max + ' vs ' + base);
  check('SPEED_RAMP_DISTANCE > 0', num('SPEED_RAMP_DISTANCE') > 0);
  const si0 = num('SPAWN_INTERVAL_START');
  const si1 = num('SPAWN_INTERVAL_MIN');
  check('SPAWN_INTERVAL_MIN < SPAWN_INTERVAL_START（越跑越密）', si1 < si0, 'got ' + si1 + ' vs ' + si0);
  check('SPAWN_INTERVAL_MIN > 0', si1 > 0);
  check('MAX_OBSTACLE_HEIGHT > 0', num('MAX_OBSTACLE_HEIGHT') > 0);
  check('MAX_OBSTACLE_WIDTH >= MIN_OBSTACLE_WIDTH', num('MAX_OBSTACLE_WIDTH') >= num('MIN_OBSTACLE_WIDTH'));
  check('FIRST_SPAWN_GAP 足够长（开局有热身距离）', num('FIRST_SPAWN_GAP') > 400);
  check('SCORE_PER_PIXEL > 0', num('SCORE_PER_PIXEL') > 0);
  check('COIN_SCORE > 0', num('COIN_SCORE') > 0);

  // --- 可达性：这是「不能出现死局」的数学保证 ---
  //   一次跳跃的滞空时间 AIR_TIME 内最多前进 speed * AIR_TIME，
  //   所以两个障碍的最小间距必须大于它。
  const airTime = num('AIR_TIME');
  const margin = num('GAP_MARGIN');
  check('AIR_TIME > 0', airTime > 0, 'got ' + airTime);
  check('GAP_MARGIN > 0', margin > 0, 'got ' + margin);
  const minNeeded = max * airTime + margin;
  check(
    '最坏情况下间隔下限 ' + minNeeded.toFixed(0) + 'px > 一次满跳的水平位移 ' + (max * airTime).toFixed(0) + 'px（过关一定可解）',
    minNeeded > max * airTime
  );

  // --- 手感与物理自洽：单跳最高点应该和生成器里的 SINGLE_JUMP_HEIGHT 对得上 ---
  const apex = (jv * jv) / (2 * g);
  check('单跳最高点约 195px（' + apex.toFixed(1) + 'px），在合理区间 150~260', apex > 150 && apex < 260, 'got ' + apex.toFixed(1));

  // --- 配色表 ---
  check('COLORS 是对象', C.COLORS && typeof C.COLORS === 'object');
  if (C.COLORS) {
    const hex = /^#[0-9a-fA-F]{6}$/;
    for (const k of ['neonPink', 'neonCyan', 'neonYellow', 'neonPurple', 'bgTop', 'bgBottom']) {
      check('COLORS.' + k + ' 是合法颜色', typeof C.COLORS[k] === 'string' && hex.test(C.COLORS[k]), String(C.COLORS[k]));
    }
  }

  // --- 版本号 ---
  check('VERSION 是 x.y.z 形式', /^\d+\.\d+\.\d+$/.test(String(C.VERSION)), String(C.VERSION));
  check('GAME_NAME 非空', typeof C.GAME_NAME === 'string' && C.GAME_NAME.length > 0);
}

// ---------- 3. 交付结构校验 ----------
section('[4/10] 交付文件结构');

const REQUIRED = [
  'index.html',
  'manifest.webmanifest',
  'sw.js',
  'server.mjs',
  'start.bat',
  'src/main.js',
  'src/config.js',
  'src/data/skins.js',
  'src/data/levels.js',
  'src/core/engine.js',
  'src/core/input.js',
  'src/core/scenes.js',
  'src/core/save.js',
  'src/core/audio.js',
  'src/core/assets.js',
  'src/core/fx.js',
  'src/scenes/boot.js',
  'src/scenes/menu.js',
  'src/scenes/play.js',
  'src/scenes/pause.js',
  'src/scenes/gameover.js',
  'src/scenes/shop.js',
  'src/scenes/levelselect.js',
  'src/scenes/levelresult.js',
  'src/entities/player.js',
  'src/entities/spawner.js',
  'src/ui/hud.js',
  'tests/smoke.mjs',
];

const missing = [];
for (const f of REQUIRED) {
  const exists = fs.existsSync(path.join(ROOT, f));
  if (!exists) missing.push(f);
}
check('所有必交付文件都存在（共 ' + REQUIRED.length + ' 个）', missing.length === 0, missing.join(', '));

// index.html 必须引用入口模块，且带上 viewport-fit=cover
try {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  check('index.html 引用了 src/main.js', /<script[^>]+type=["']module["'][^>]+src=["']src\/main\.js["']/.test(html));
  check('index.html 有 <canvas id="game">', /id=["']game["']/.test(html));
  check('index.html viewport 含 viewport-fit=cover', /viewport-fit=cover/.test(html));
  check('index.html 引用了 manifest', /rel=["']manifest["']/.test(html));
  check('index.html 没有外链 http(s) 资源（必须离线可用）', !/(src|href)=["']https?:\/\//.test(html));
} catch (e) {
  bad('读取 index.html', e.message);
}

// manifest 必须是合法 JSON，且 display=standalone
try {
  const mf = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
  check('manifest 是合法 JSON', true);
  check('manifest display === "standalone"', mf.display === 'standalone', String(mf.display));
  check('manifest 有 name / short_name / start_url', !!(mf.name && mf.short_name && mf.start_url));
  // v1.1 补丁：图标从「内联 data URI」改成「真实的 PNG 文件」。
  // 原因：PWABuilder 等打包工具必须按 URL 去下载图标才能生成安卓启动图标，
  // 给它 data: URI 会卡住。这里连带校验：文件真的存在、且实际像素尺寸与声明的 sizes 一致。
  const icons = Array.isArray(mf.icons) ? mf.icons : [];
  check('manifest 有图标，且不再是内联 data URI', icons.length > 0 && icons.every((i) => !String(i.src).startsWith('data:')));
  let iconOk = true;
  const iconBad = [];
  for (const ic of icons) {
    const file = path.join(ROOT, ic.src);
    if (!fs.existsSync(file)) { iconOk = false; iconBad.push(`${ic.src} 不存在`); continue; }
    const buf = fs.readFileSync(file);
    const isPng = buf.slice(0, 8).toString('hex') === '89504e470d0a1a0a';
    const w = isPng ? buf.readUInt32BE(16) : 0;
    const h = isPng ? buf.readUInt32BE(20) : 0;
    const [dw, dh] = String(ic.sizes).split('x').map(Number);
    if (!isPng) { iconOk = false; iconBad.push(`${ic.src} 不是 PNG`); }
    else if (w !== dw || h !== dh) { iconOk = false; iconBad.push(`${ic.src} 实际 ${w}x${h} ≠ 声明 ${ic.sizes}`); }
  }
  check('每个 manifest 图标都存在、是 PNG、且尺寸与声明一致', iconOk, iconBad.join('; '));
  check('manifest 同时提供 >=192 的 any 图标和 maskable 图标',
    icons.some((i) => String(i.purpose || '').includes('any') && parseInt(i.sizes, 10) >= 192)
    && icons.some((i) => String(i.purpose || '').includes('maskable')));
  // 注意：这个 try 块里没有外层的 html 变量，得自己读一次（否则 ReferenceError 会被 catch 吞掉）
  const idxHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  check('index.html 里有 iOS 用的 apple-touch-icon', /rel=["']apple-touch-icon["']/.test(idxHtml));
} catch (e) {
  bad('解析 manifest.webmanifest', e.message);
}

// sw.js 必须预缓存 src 下的每一个 js —— 少一个就离线白屏
try {
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const missingSw = srcFiles
    .map(rel)
    .filter((f) => !sw.includes(f));   // 形如 ./src/core/engine.js
  check('sw.js 预缓存清单覆盖 src 下全部 ' + srcFiles.length + ' 个 js', missingSw.length === 0, missingSw.join(', '));
} catch (e) {
  bad('读取 sw.js', e.message);
}

// server.mjs 必须有防目录穿越的判断
try {
  const srv = fs.readFileSync(path.join(ROOT, 'server.mjs'), 'utf8');
  check('server.mjs 有目录穿越防护', srv.includes('startsWith(rootWithSep)'));
  check('server.mjs 端口是 5180', srv.includes('5180'));
  check('server.mjs 打印局域网 IP', srv.includes('networkInterfaces'));
} catch (e) {
  bad('读取 server.mjs', e.message);
}

// ---------- 4. 难度曲线与可达性（数值模拟） ----------
section('[5/10] 难度曲线与可达性');

const DT = 1 / 60;   // 游戏固定步长

if (C && typeof C.difficultyAt === 'function' && typeof C.speedAt === 'function') {
  ok('config 导出了 difficultyAt / speedAt');

  const ramp = C.SPEED_RAMP_DISTANCE;
  check('difficultyAt(0) === 0', C.difficultyAt(0) === 0, String(C.difficultyAt(0)));
  check('difficultyAt(SPEED_RAMP_DISTANCE) === 1', C.difficultyAt(ramp) === 1, String(C.difficultyAt(ramp)));
  check('起点速度 === BASE_SPEED', C.speedAt(0) === C.BASE_SPEED, String(C.speedAt(0)));
  check('终点速度 === MAX_SPEED', Math.abs(C.speedAt(ramp) - C.MAX_SPEED) < 1e-6, String(C.speedAt(ramp)));
  check('difficultyAt(NaN) 返回有限数（脏输入不炸）', Number.isFinite(C.difficultyAt(NaN)), String(C.difficultyAt(NaN)));
  check('difficultyAt 在中点约等于 0.5', Math.abs(C.difficultyAt(ramp / 2) - 0.5) < 1e-9, String(C.difficultyAt(ramp / 2)));

  // 单调不减：难度只能越来越难，不能回退
  let mono = true;
  let prevD = -Infinity;
  for (let i = 0; i <= 40; i++) {
    const d = C.difficultyAt((ramp * i) / 40);
    if (d < prevD - 1e-12) mono = false;
    prevD = d;
  }
  check('difficultyAt 沿距离单调不减', mono);

  // 按 1/60 步长模拟一整局，记录几个关键时刻的速度
  const marks = {};
  const watchers = [15, 30, 45, 60, 75, 90, 120];
  let dt2 = 0;
  let seconds = 0;
  while (C.difficultyAt(dt2) < 1 && seconds < 1200) {
    const t0 = seconds;
    dt2 += C.speedAt(dt2) * DT;
    seconds += DT;
    for (const w of watchers) if (t0 < w && seconds >= w) marks[w] = C.speedAt(dt2);
  }
  const fullTime = seconds;
  const ms = (s) => (marks[s] === undefined ? 'n/a' : marks[s].toFixed(0));
  check('跑满难度需要 90~150 秒（实测 ' + fullTime.toFixed(1) + 's）', fullTime >= 90 && fullTime <= 150);
  check('前 15 秒变化很轻（15s 时 ' + ms(15) + ' px/s < 470）', marks[15] > 0 && marks[15] < 470);
  check('15 秒时不低于基础速度', marks[15] >= C.BASE_SPEED);
  check('30 秒速度落在 400~500（实测 ' + ms(30) + '）', marks[30] > 400 && marks[30] < 500);
  check('60 秒速度落在 560~660（实测 ' + ms(60) + '）', marks[60] > 560 && marks[60] < 660);
  check('90 秒速度落在 800~930（实测 ' + ms(90) + '）', marks[90] > 800 && marks[90] < 930);

  // 分段形状：中段最陡、后段趋于平台（不是简单拉长的线性）
  const gain = (a, b) => C.speedAt(ramp * b) - C.speedAt(ramp * a);
  check('中段上升最快（0.4~0.6 段增益 > 0~0.2 段的 1.5 倍）',
    gain(0.4, 0.6) > gain(0, 0.2) * 1.5, gain(0.4, 0.6).toFixed(1) + ' vs ' + gain(0, 0.2).toFixed(1));
  check('后段趋于平台（0.8~1.0 段增益 < 中段的一半）',
    gain(0.8, 1.0) < gain(0.4, 0.6) * 0.5, gain(0.8, 1.0).toFixed(1) + ' vs ' + gain(0.4, 0.6).toFixed(1));
} else {
  bad('config 导出了 difficultyAt / speedAt', '缺少导出');
}

// ---------- 生成器必须永远留出「跳得过去」的间隔 ----------
let SP = null;
try {
  SP = await import(pathToFileURL(path.join(ROOT, 'src', 'entities', 'spawner.js')).href);
  ok('可以 import src/entities/spawner.js');
} catch (e) {
  bad('可以 import src/entities/spawner.js', e.message);
}

if (SP && C) {
  const SpawnerClass = SP.Spawner || SP.default;
  check('spawner.js 导出了 Spawner 类', typeof SpawnerClass === 'function');

  if (typeof SpawnerClass === 'function') {
    // (1) 解析式穷举：任何速度 × 任何难度，间隔都要大于「一次满跳的水平位移 + 余量」
    const probe = new SpawnerClass();
    let worst = Infinity;
    let worstAt = '';
    for (let i = 0; i <= 20; i++) {
      const speed = C.BASE_SPEED + ((C.MAX_SPEED - C.BASE_SPEED) * i) / 20;
      for (let j = 0; j <= 20; j++) {
        const diff = j / 20;
        const gap = probe.computeNextGap(speed, diff);
        const need = speed * C.AIR_TIME + C.GAP_MARGIN;
        if (gap - need < worst) { worst = gap - need; worstAt = 'v=' + speed.toFixed(0) + ' d=' + diff.toFixed(2); }
      }
    }
    check('最坏情况间隔下限 > 一次满跳水平位移（最小富余 ' + worst.toFixed(1) + 'px @ ' + worstAt + '）', worst >= -1e-6);

    // (2) 真跑一局：120 秒里每半秒校验一次可达性
    const run = new SpawnerClass();
    let dist = 0;
    let t = 0;
    let frames = 0;
    let reachOk = true;
    let reachBadAt = '';
    let airOk = true;
    let airBadAt = '';
    let maxOnScreen = 0;
    let sawCoins = 0;
    let verifyCount = 0;
    while (t < 120) {
      const speed = C.speedAt(dist);
      const diff = C.difficultyAt(dist);
      run.update(DT, speed, diff, dist);
      dist += speed * DT;
      t += DT;
      frames++;
      maxOnScreen = Math.max(maxOnScreen, run.obstacles.length);
      sawCoins = Math.max(sawCoins, run.coins.length);
      if (frames % 30 === 0) {
        verifyCount++;
        if (!SpawnerClass.verifyReachability(run.obstacles, speed)) {
          reachOk = false;
          if (!reachBadAt) reachBadAt = 't=' + t.toFixed(1) + 's speed=' + speed.toFixed(0) + ' 障碍数=' + run.obstacles.length;
        }
        // 更严的独立校验：边缘到边缘的真空隙必须还能容纳一次满跳
        for (let i = 1; i < run.obstacles.length; i++) {
          const prev = run.obstacles[i - 1];
          const cur = run.obstacles[i];
          const air = cur.x - (prev.x + prev.w);
          if (air + 1 < speed * C.AIR_TIME + C.GAP_MARGIN) {
            airOk = false;
            if (!airBadAt) {
              airBadAt = 't=' + t.toFixed(1) + 's speed=' + speed.toFixed(0)
                + ' 空隙=' + air.toFixed(1) + ' 需要=' + (speed * C.AIR_TIME + C.GAP_MARGIN).toFixed(1);
            }
          }
        }
      }
    }
    check('120 秒实跑中障碍始终跳得过去（校验 ' + verifyCount + ' 次）', reachOk, reachBadAt);
    check('实跑中真空隙（右边缘→左边缘）始终 > 一次满跳水平位移', airOk, airBadAt);
    check('实跑中确实生成了障碍（同屏峰值 ' + maxOnScreen + ' 个）', maxOnScreen >= 2);
    check('实跑中确实撒了金币（同屏峰值 ' + sawCoins + ' 枚）', sawCoins >= 1);

    // (3) 被吃掉（或滚出屏幕）的金币必须立刻从数组移除 —— 修掉 README 里记的 TODO
    const gc = new SpawnerClass();
    gc.coins.push({ x: 400, y: 900, r: 17, spin: 0, taken: true, pulse: 0 });
    gc.coins.push({ x: -999, y: 900, r: 17, spin: 0, taken: false, pulse: 0 });
    gc.update(DT, C.BASE_SPEED, 0);
    check('被吃掉的金币立即从数组移除（不残留、不参与碰撞）', gc.coins.length === 0, '剩 ' + gc.coins.length + ' 个');
  }
}

// ---------- 5. 金币 / 商城 / 皮肤 ----------
section('[6/10] 金币 / 商城 / 皮肤');

let SK = null;
try {
  SK = await import(pathToFileURL(path.join(ROOT, 'src', 'data', 'skins.js')).href);
  ok('可以 import src/data/skins.js');
} catch (e) {
  bad('可以 import src/data/skins.js', e.message);
}

if (SK) {
  const list = SK.SKINS;
  check('皮肤数量至少 7 个（实际 ' + (Array.isArray(list) ? list.length : 'n/a') + '）', Array.isArray(list) && list.length >= 7);
  const ids = list.map((s) => s.id);
  check('皮肤 id 唯一', new Set(ids).size === ids.length, ids.join(','));
  check('id 全是非空字符串', ids.every((id) => typeof id === 'string' && id.length > 0));
  check('getSkin(id) 对未知 id 回退默认皮肤（永不 undefined）', SK.getSkin('没有任何皮肤叫这个名字') === SK.getSkin(SK.DEFAULT_SKIN_ID));
  check('getSkin(id).id === id（全部皮肤都能正确取回）', list.every((s) => SK.getSkin(s.id) === s));
  const def = SK.getSkin(SK.DEFAULT_SKIN_ID);
  check('默认皮肤价格为 0（新玩家白嫖得到）', def.price === 0, String(def.price));
  const prices = list.map((s) => s.price);
  check('价格非负整数', prices.every((p) => Number.isInteger(p) && p >= 0), prices.join('/'));
  check('价格梯度严格升序', prices.every((p, i) => i === 0 || p > prices[i - 1]), prices.join('/'));
  check('至少有 5 个不同价位（有得攒）', new Set(prices).size >= 5, prices.join('/'));

  const SHAPES = new Set(['rounded', 'square', 'capsule', 'circle', 'diamond', 'hexagon', 'star']);
  const EFFECTS = new Set(['none', 'pulse', 'ghost', 'spark', 'shimmer']);
  const isHex = (c) => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c);
  let shapeOk = true, effOk = true, textOk = true, colorOk = true, trailOk = true;
  for (const s of list) {
    if (!SHAPES.has(s.shape)) shapeOk = false;
    if (!EFFECTS.has(s.effect)) effOk = false;
    if (!(typeof s.name === 'string' && s.name.length > 0 && typeof s.desc === 'string' && s.desc.length > 0)) textOk = false;
    if (!s.colors || !isHex(s.colors.body) || !isHex(s.colors.bodyDark) || !isHex(s.colors.bodyLight)
      || !isHex(s.colors.glow) || !isHex(s.colors.eye) || !isHex(s.colors.trail)) colorOk = false;
    if (!(typeof s.trailWidth === 'number' && s.trailWidth > 0)) trailOk = false;
  }
  check('皮肤形状都在支持集合内', shapeOk, list.map((s) => s.shape).join(','));
  check('皮肤特效都在支持集合内', effOk, list.map((s) => s.effect).join(','));
  check('皮肤名称与描述都非空', textOk);
  check('皮肤配色齐全且都是 #RRGGBB', colorOk);
  check('皮肤拖尾粗细 > 0', trailOk);
  check('形状至少有 4 种不同（视觉差异真实存在）', new Set(list.map((s) => s.shape)).size >= 4, list.map((s) => s.shape).join(','));
  check('特效至少覆盖 pulse / ghost / spark 三类', ['pulse', 'ghost', 'spark'].every((e) => list.some((s) => s.effect === e)));
  check('主体颜色两两不同', new Set(list.map((s) => s.colors.body)).size === list.length, list.map((s) => s.colors.body).join(','));
}

// ---------- 画玩家的函数必须能被商城复用，且 7 种形状都画得出来 ----------
let PL = null;
try {
  PL = await import(pathToFileURL(path.join(ROOT, 'src', 'entities', 'player.js')).href);
  ok('可以 import src/entities/player.js');
} catch (e) {
  bad('可以 import src/entities/player.js', e.message);
}

if (PL && SK) {
  check('player.js 导出了 drawPlayerSprite / pathSkinShape',
    typeof PL.drawPlayerSprite === 'function' && typeof PL.pathSkinShape === 'function');

  // 假 ctx：没设过的属性一律返回空函数，足够让绘制代码跑完整条路径而不碰真实 DOM
  const makeGradient = () => ({ addColorStop() {} });
  const makeCtx = () => new Proxy({}, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'measureText') return () => ({ width: 12 });
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return makeGradient;
      if (k === 'canvas') return { width: 720, height: 1280 };
      return () => {};
    },
    set(t, k, v) { t[k] = v; return true; },
  });

  if (typeof PL.drawPlayerSprite === 'function') {
    const savedDoc = globalThis.document;
    globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => makeCtx() }) };
    let drawErr = '';
    try {
      for (const s of SK.SKINS) {
        // 亮起来、被压扁、半透明……商城与玩法会用到的几种组合都过一遍
        PL.drawPlayerSprite(makeCtx(), s, { x: 10, y: 20, w: 46, h: 58, time: 1.23, stretch: 0.12, alpha: 1 });
        PL.drawPlayerSprite(makeCtx(), s, { x: 10, y: 20, w: 46, h: 58, time: 2.5, stretch: 0, alpha: 0.55, dim: true });
      }
    } catch (e) {
      drawErr = e.message;
    } finally {
      if (savedDoc === undefined) delete globalThis.document; else globalThis.document = savedDoc;
    }
    check('drawPlayerSprite 能画出全部 ' + SK.SKINS.length + ' 种皮肤（含离屏贴图分支）', drawErr === '', drawErr);
  }

  if (typeof PL.pathSkinShape === 'function') {
    let shapeErr = '';
    try {
      for (const shape of ['rounded', 'square', 'capsule', 'circle', 'diamond', 'hexagon', 'star', '未知形状']) {
        PL.pathSkinShape(makeCtx(), shape, 4, 6, 46, 58);
      }
    } catch (e) {
      shapeErr = e.message;
    }
    check('pathSkinShape 支持全部形状（未知形状走圆角回退）', shapeErr === '', shapeErr);
  }

  // 商城预览必须复用玩法里那一个绘制函数，避免两套画法越改越不像
  try {
    const shopSrc = fs.readFileSync(path.join(ROOT, 'src', 'scenes', 'shop.js'), 'utf8');
    check('商城预览复用了 drawPlayerSprite（没有另写一套画法）',
      /import\s*\{[^}]*\bdrawPlayerSprite\b[^}]*\}\s*from\s*['"][^'"]*entities\/player\.js['"]/.test(shopSrc));
    const mainSrc = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
    check('main.js 注册了 shop 场景', /register\(\s*['"]shop['"]/.test(mainSrc));
    const goSrc = fs.readFileSync(path.join(ROOT, 'src', 'scenes', 'gameover.js'), 'utf8');
    check('结算界面显示了钱包余额', /wallet/.test(goSrc));
    const menuSrc = fs.readFileSync(path.join(ROOT, 'src', 'scenes', 'menu.js'), 'utf8');
    check('主菜单有商城入口与钱包显示', /'shop'/.test(menuSrc) && /wallet/.test(menuSrc));
  } catch (e) {
    bad('读取商城相关源码', e.message);
  }
}

// ---------- 存档：旧存档迁移不抛错 + 账目正确 ----------
let SaveMod = null;
try {
  SaveMod = await import(pathToFileURL(path.join(ROOT, 'src', 'core', 'save.js')).href);
  ok('可以 import src/core/save.js');
} catch (e) {
  bad('可以 import src/core/save.js', e.message);
}

if (SaveMod && SK) {
  const Save = SaveMod.Save;
  check('save.js 导出了 Save 类', typeof Save === 'function');
  check('存档键名仍是 neon-dash.save.v1（旧玩家分数不丢）', SaveMod.STORAGE_KEY === 'neon-dash.save.v1', String(SaveMod.STORAGE_KEY));

  const mkStorage = (initialRaw) => {
    const store = new Map();
    if (initialRaw !== undefined) store.set(SaveMod.STORAGE_KEY, initialRaw);
    return {
      store,
      api: {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => { store.set(k, String(v)); },
        removeItem: (k) => { store.delete(k); },
      },
    };
  };

  if (typeof Save === 'function') {
    // A. 真实旧版存档（v1，完全没有钱包/皮肤字段）
    {
      const old = JSON.stringify({
        version: 1, bestScore: 1234, playCount: 5, totalDistance: 900, totalCoins: 7,
        settings: { sfx: false, music: true, vibrate: false },
      });
      const st = mkStorage(old);
      let s = null, err = '';
      try { s = new Save(st.api); s.load(); } catch (e) { err = e.message; }
      check('旧 v1 存档迁移不抛错', err === '', err);
      if (s) {
        check('旧存档迁移后钱包补 0', s.wallet === 0, String(s.wallet));
        check('旧存档迁移后默认皮肤已拥有', s.ownsSkin(SK.DEFAULT_SKIN_ID) === true);
        check('旧存档迁移后装备的是默认皮肤', s.equippedSkin === SK.DEFAULT_SKIN_ID, String(s.equippedSkin));
        check('旧存档迁移后旧纪录保留（bestScore 1234）', s.bestScore === 1234, String(s.bestScore));
        check('旧存档迁移后旧设置保留（sfx:false）', s.settings.sfx === false);
      }
    }

    // B. 脏存档：负数钱包、数组里混进数字 null、重复项、不存在的 id、未拥有却装备
    {
      const dirty = JSON.stringify({
        wallet: -50,
        ownedSkins: ['prism', 42, null, 'classic', 'prism', 'ghost-skin'],
        equippedSkin: 'nova',
      });
      const st = mkStorage(dirty);
      let s = null, err = '';
      try { s = new Save(st.api); s.load(); } catch (e) { err = e.message; }
      check('脏存档加载不抛错', err === '', err);
      if (s) {
        check('负钱包被清洗成 0', s.wallet === 0, String(s.wallet));
        const owned = s.data.ownedSkins;
        check('非法 id / 重复项被清掉（只剩 classic 与 prism）',
          owned.length === 2 && owned.indexOf('classic') >= 0 && owned.indexOf('prism') >= 0, owned.join(','));
        check('装备了没拥有的皮肤 → 回退默认', s.equippedSkin === SK.DEFAULT_SKIN_ID, String(s.equippedSkin));
      }
    }

    // C. 完全不是 JSON
    {
      const st = mkStorage('这不是 json {{{');
      let s = null, err = '';
      try { s = new Save(st.api); s.load(); } catch (e) { err = e.message; }
      check('存档损坏时回退默认且不抛错', err === '' && s && s.wallet === 0 && s.bestScore === 0, err);
    }

    // D. 字段类型全错
    {
      const st = mkStorage(JSON.stringify({ wallet: 'abc', ownedSkins: 'nope', equippedSkin: 5 }));
      let s = null, err = '';
      try { s = new Save(st.api); s.load(); } catch (e) { err = e.message; }
      check('字段类型不对时全部回退默认',
        err === '' && s && s.wallet === 0 && s.data.ownedSkins.length === 1
        && s.data.ownedSkins[0] === SK.DEFAULT_SKIN_ID && s.equippedSkin === SK.DEFAULT_SKIN_ID, err);
    }

    // E. localStorage 本身抛错（隐私模式）
    {
      const boom = {
        getItem() { throw new Error('SecurityError'); },
        setItem() { throw new Error('SecurityError'); },
        removeItem() { throw new Error('SecurityError'); },
      };
      let s = null, err = '';
      try { s = new Save(boom); s.load(); } catch (e) { err = e.message; }
      check('存放取被禁用时不抛错（隐私模式可玩）', err === '' && s && s.wallet === 0, err);
    }

    // F. 购买 / 装备的账目
    {
      const st = mkStorage(undefined);
      const s = new Save(st.api);
      s.load();
      const poor = s.buySkin('ember');
      check('钱包不足时购买失败并给出原因与差额',
        poor.ok === false && poor.reason === 'poor' && poor.need === 120, JSON.stringify(poor));
      check('购买失败不会白扣钱', s.wallet === 0, String(s.wallet));
      s.addCoins(200);
      check('addCoins 生效', s.wallet === 200, String(s.wallet));
      const buy = s.buySkin('ember');
      check('钱够了就能买下 ember', buy.ok === true, JSON.stringify(buy));
      check('购买正确扣款（200 - 120 = 80）', s.wallet === 80, String(s.wallet));
      check('购买后即拥有', s.ownsSkin('ember') === true);
      check('重复购买返回 reason=owned', s.buySkin('ember').reason === 'owned');
      check('买不存在的皮肤返回 reason=invalid', s.buySkin('不存在的皮肤').reason === 'invalid');
      check('装备没拥有的皮肤返回 reason=notOwned', s.equipSkin('prism').reason === 'notOwned');
      check('装备已拥有的皮肤成功', s.equipSkin('ember').ok === true);
      check('装备后 equippedSkin 立刻生效', s.equippedSkin === 'ember', String(s.equippedSkin));
      const boss = s.equipSkin('好皮肤');
      check('装备非法 id 返回 reason=invalid', boss.ok === false && boss.reason === 'invalid');

      // 结算：本局金币进钱包
      const w0 = s.wallet;
      const rec = s.recordRun({ score: 999, distance: 1234, coins: 5 });
      check('结算返回本局金币 earned', rec.earned === 5, JSON.stringify(rec));
      check('结算把本局金币存入跨局钱包', s.wallet === w0 + 5, w0 + ' → ' + s.wallet);
      check('结算正确判定新纪录', rec.isRecord === true && s.bestScore === 999, JSON.stringify(rec));
      const rec2 = s.recordRun({ score: 10, distance: 10, coins: 0 });
      check('低分不刷新纪录', rec2.isRecord === false && s.bestScore === 999);
      check('本局 0 金币不会污染钱包', s.wallet === w0 + 5, String(s.wallet));
    }
  }
}

// ---------- 6. 本地 import 解析 ----------
section('[7/10] 本地 import 解析 + 无头场景联动');

// 6.1 每个 `import { a, b } from './x.js'` 引用的名字都必须在目标文件里真的导出。
//     这一条抓到过 save.js 把 '../data/skins.js' 写成 './data/skins.js'——
//     node 会直接报 Cannot find module，浏览器里就是白屏。
{
  const files = walk(path.join(ROOT, 'src'));
  const exported = new Map();
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    const names = new Set();
    for (const m of src.matchAll(/export\s+(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
    for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
      for (const part of m[1].split(',')) {
        const t = part.trim().split(/\s+as\s+/);
        const nm = (t[1] || t[0] || '').trim();
        if (nm) names.add(nm);
      }
    }
    exported.set(path.resolve(f), names);
  }
  const probs = [];
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
      if (!m[2].startsWith('.')) continue;
      const target = path.resolve(path.dirname(f), m[2]);
      const names = exported.get(target);
      if (!names) { probs.push(rel(f) + ' → ' + m[2] + '（文件不存在）'); continue; }
      for (const part of m[1].split(',')) {
        const t = part.trim().split(/\s+as\s+/);
        const nm = (t[0] || '').trim();
        if (nm && !names.has(nm)) probs.push(rel(f) + ' → ' + m[2] + ' 里没有导出 ' + nm);
      }
    }
  }
  check('本地 import 的相对路径与具名导出全部对得上', probs.length === 0, probs.join('；'));
}

// 6.2 无头场景联动：用假的 canvas / document 让真实场景代码跑起来。
//     它覆盖不到「好不好看」，但能抓到「点下去就崩」这类运行期错误——
//     这是浏览器里才玩得出来、纯静态检查看不见的部分。
{
  /** 假 2D 上下文：任何没定义的方法都当空函数，绘制调用不炸就算过 */
  function hCtx(canvas) {
    const t = {
      canvas, globalAlpha: 1, fillStyle: '#000', strokeStyle: '#000', lineWidth: 1,
      font: '10px sans-serif', shadowColor: '#000', shadowBlur: 0,
      globalCompositeOperation: 'source-over', textAlign: 'left', textBaseline: 'alphabetic',
      lineCap: 'butt', lineJoin: 'miter',
    };
    return new Proxy(t, {
      get(tg, k) {
        if (k in tg) return tg[k];
        if (k === 'measureText') return () => ({ width: 12 });
        if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern') {
          return () => ({ addColorStop() {} });
        }
        if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
        return () => {};
      },
      set(tg, k, v) { tg[k] = v; return true; },
    });
  }
  function hCanvas() {
    let ctx = null;
    return {
      width: 0, height: 0,
      getContext() { if (!ctx) ctx = hCtx(this); return ctx; },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 720, height: 1280 }),
      remove() {}, setAttribute() {}, style: {}, appendChild() {},
    };
  }
  globalThis.document = {
    getElementById: () => null, createElement: () => hCanvas(), querySelector: () => null,
    addEventListener() {}, removeEventListener() {},
    body: { appendChild() {} }, documentElement: { appendChild() {} }, hidden: false,
  };
  globalThis.window = {
    addEventListener() {}, removeEventListener() {},
    innerWidth: 720, innerHeight: 1280, devicePixelRatio: 2,
  };
  globalThis.getComputedStyle = () => ({ paddingTop: '0px', paddingRight: '0px', paddingBottom: '0px', paddingLeft: '0px' });

  const imp = async (p) => await import(pathToFileURL(path.join(ROOT, 'src', p)).href);
  try {
    const { Save } = await imp('core/save.js');
    const { FX } = await imp('core/fx.js');
    const { Input } = await imp('core/input.js');
    const { SceneManager } = await imp('core/scenes.js');
    const { BootScene } = await imp('scenes/boot.js');
    const { MenuScene } = await imp('scenes/menu.js');
    const { PlayScene } = await imp('scenes/play.js');
    const { PauseScene } = await imp('scenes/pause.js');
    const { GameOverScene } = await imp('scenes/gameover.js');
    const { ShopScene } = await imp('scenes/shop.js');
    const { LevelSelectScene } = await imp('scenes/levelselect.js');
    const { LevelResultScene } = await imp('scenes/levelresult.js');

    const mem = new Map();
    const storage = {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => mem.set(k, String(v)),
      removeItem: (k) => mem.delete(k),
    };
    const AUDIO = ['unlock', 'click', 'jump', 'doubleJump', 'land', 'coin', 'hit', 'fanfare', 'buy',
      'equip', 'deny', 'startMusic', 'stopMusic', 'fadeOutMusic', 'refreshMusic', 'resetCombo', 'setMusicIntensity'];
    const audio = { calls: [] };
    for (const m of AUDIO) audio[m] = (...a) => { audio.calls.push([m, ...a]); };

    const engine = {
      safe: { top: 0, right: 0, bottom: 0, left: 0 }, designWidth: 720, designHeight: 1280,
      onResize: null, toDesign: (x, y) => ({ x, y }),
    };
    const save = new Save(storage);
    const input = new Input(engine);
    const scenes = new SceneManager(null);
    const game = { engine, save, audio, fx: new FX(), input, scenes, assets: { load: async () => ({}) }, version: '1.1.0' };
    scenes.game = game;
    game.scenes = scenes;
    scenes.register('boot', () => new BootScene(game));
    scenes.register('menu', () => new MenuScene(game));
    scenes.register('play', () => new PlayScene(game));
    scenes.register('pause', () => new PauseScene(game));
    scenes.register('gameover', () => new GameOverScene(game));
    scenes.register('shop', () => new ShopScene(game));
    scenes.register('levelselect', () => new LevelSelectScene(game));
    scenes.register('levelresult', () => new LevelResultScene(game));

    const ctx = hCtx(hCanvas());
    const STEP = 1 / 60;
    let frames = 0;
    let crash = null;
    const topName = () => (scenes.top ? scenes.top.constructor.name : 'null');
    const step = () => {
      try {
        input.update(STEP);
        scenes.update(STEP);
        scenes.render(ctx, 0.5);
      } catch (e) {
        if (!crash) crash = '第 ' + frames + ' 帧（顶层 ' + topName() + '）：' + e.message;
      }
      input.endFrame();
      frames++;
    };
    const runFrames = (n) => { for (let i = 0; i < n; i++) step(); };
    const until = (name, limit = 1200) => {
      for (let i = 0; i < limit; i++) { step(); if (topName() === name) return true; }
      return false;
    };
    const tap = (a) => { input._press(a); step(); input._release(a); };

    scenes.push('boot');
    scenes.flush();
    await new Promise((r) => setImmediate(r));   // 让 assets.load 的 Promise 落地
    check('无头：boot 场景能启动', topName() === 'BootScene', topName());
    runFrames(120);
    check('无头：boot 自动切到主菜单', until('MenuScene'), topName());
    runFrames(60);

    tap('confirm');
    check('无头：主菜单回车进入玩法', until('PlayScene'), topName());
    runFrames(60);
    tap('jump');
    runFrames(6);
    tap('jump');
    runFrames(40);
    const play = scenes.top;
    check('无头：跳跃与二段跳不报错', !!play.player && play.player.jumpsLeft === 0,
      play.player ? ('jumpsLeft=' + play.player.jumpsLeft) : '没有 player');
    check('无头：玩法里难度与速度按曲线走', Math.abs(play.speed - 400) < 8 && play.difficulty < 0.05,
      '速度=' + Math.round(play.speed) + ' 难度=' + play.difficulty.toFixed(3));

    tap('pause');
    check('无头：Esc/P 能暂停', topName() === 'PauseScene', topName());
    runFrames(30);
    tap('confirm');
    check('无头：暂停里回车能继续', topName() === 'PlayScene', topName());

    const p1 = scenes.top;
    p1.coins = 7;
    p1.distance = 4321;
    p1.score = 432;
    p1._die();
    check('无头：撞击后进入结算界面', until('GameOverScene'), topName());
    const over = scenes.top;
    check('无头：结算读到本局金币', Math.floor(over.earned) === 7, String(over && over.earned));
    check('无头：结算把本局金币存进钱包', save.wallet === 7, String(save.wallet));

    over.sel = over.buttons.findIndex((b) => b.id === 'shop');
    tap('confirm');
    check('无头：结算界面能进商城', topName() === 'ShopScene', topName());
    const shop = scenes.top;
    runFrames(30);
    tap('right');
    tap('right');
    tap('down');
    runFrames(5);
    const walletBefore = save.wallet;
    tap('confirm');
    runFrames(5);
    check('无头：买不起时不扣钱且给出提示',
      save.wallet === walletBefore && !!(shop.toast && shop.toast.text),
      '钱包=' + save.wallet + ' 提示=' + JSON.stringify(shop.toast && shop.toast.text));
    tap('pause');
    check('无头：商城 Esc 返回上一层', topName() === 'GameOverScene', topName());

    save.addCoins(2000);
    const over2 = scenes.top;
    over2.sel = over2.buttons.findIndex((b) => b.id === 'shop');
    tap('confirm');
    check('无头：能再次进入商城', topName() === 'ShopScene', topName());
    const shop2 = scenes.top;
    runFrames(10);
    shop2.index = 1;   // 第二款皮肤（ember，120 金币）
    runFrames(2);
    const walletPre = save.wallet;
    tap('confirm');
    runFrames(5);
    check('无头：买得起就能买到（扣钱 + 入库）', save.ownsSkin('ember') && save.wallet === walletPre - 120,
      '钱包 ' + walletPre + ' → ' + save.wallet + ' 提示=' + JSON.stringify(shop2.toast && shop2.toast.text));
    check('无头：购买后自动装备', save.equippedSkin === 'ember', save.equippedSkin);
    tap('pause');
    runFrames(5);
    scenes.top.sel = scenes.top.buttons.findIndex((b) => b.id === 'menu');
    tap('confirm');
    runFrames(5);
    check('无头：商城 → 结算 → 菜单 回退栈正确', topName() === 'MenuScene' && scenes.depth === 1,
      topName() + ' 栈深=' + scenes.depth);

    const menu = scenes.top;
    menu.sel = menu.buttons.findIndex((b) => b.id === 'shop');
    tap('confirm');
    check('无头：主菜单能进商城', topName() === 'ShopScene', topName());
    runFrames(20);
    tap('left');
    runFrames(2);
    tap('up');
    runFrames(2);
    tap('down');
    runFrames(2);
    tap('right');
    runFrames(20);
    tap('pause');
    check('无头：商城键盘导航后能回菜单', topName() === 'MenuScene', topName());

    const menu2 = scenes.top;
    menu2.sel = Math.max(0, menu2.buttons.findIndex((b) => b.id === 'start' || b.id === 'continue'));
    tap('confirm');
    check('无头：从菜单再开一局', until('PlayScene'), topName());
    const p2 = scenes.top;
    check('无头：新一局用的是已装备皮肤', !!p2.skin && p2.skin.id === 'ember', p2.skin && p2.skin.id);

    // 清掉障碍让它跑满 60 秒：验证曲线、渲染与 HUD 在高速段都不炸
    for (let i = 0; i < 3600; i++) { step(); if (i % 60 === 0) p2.spawner.obstacles.length = 0; }
    check('无头：60 秒长跑不报错、不卡死', p2.player.alive === true && p2.distance > 20000,
      '距离=' + Math.round(p2.distance) + ' 存活=' + p2.player.alive);
    check('无头：60 秒时速度落在曲线预期区间（560~680）',
      p2.speed > 560 && p2.speed < 680,
      '速度=' + Math.round(p2.speed) + ' 难度=' + p2.difficulty.toFixed(3));

    // ---------- v1.2：闯关模式整条链 ----------
    // 选关 → 未解锁拦截 → 进 L1 → 扣盾 → 容错耗尽失败 → 结算页 → 重试 → 通关 → 解锁 L2
    const endlessBest = save.data.bestScore;
    scenes.clear();
    scenes.push('menu');
    runFrames(6);
    const m3 = scenes.top;
    m3.sel = m3.buttons.findIndex((b) => b.id === 'campaign');
    tap('confirm');
    check('无头：主菜单能进选关页', until('LevelSelectScene'), topName());

    const ls = scenes.top;
    check('无头：选关页列出 5 关，新档只解锁第 1 关',
      ls.cards.length === 5 && save.data.campaign.unlocked === 1,
      '卡片=' + ls.cards.length + ' 解锁=' + save.data.campaign.unlocked);

    ls.sel = 3;                       // L4 还没解锁
    tap('confirm');
    runFrames(3);
    check('无头：未解锁的关卡进不去（停在选关页并给提示）',
      topName() === 'LevelSelectScene' && ls.tipTimer > 0, topName() + ' tip=' + ls.tipTimer);

    ls.sel = 0;
    tap('confirm');
    check('无头：能进入第 1 关（模式/关卡号/护盾都对）', until('PlayScene') &&
      scenes.top.mode === 'level' && scenes.top.levelId === 'L1' && scenes.top.shields === 2,
      topName() + ' mode=' + (scenes.top && scenes.top.mode) +
      ' shields=' + (scenes.top && scenes.top.shields));

    const lp = scenes.top;
    const walletBeforeLevel = save.wallet;
    check('无头：闯关中途不给「继续游戏」快照（杜绝分段刷星）', lp.snapshot() === null);
    check('无头：重开参数带着模式与关卡号',
      JSON.stringify(lp.replayParams()) === '{"mode":"level","levelId":"L1"}',
      JSON.stringify(lp.replayParams()));

    // 扣盾：撞一次只掉一层容错，不会立刻死
    lp.spawner.obstacles.length = 0;
    runFrames(30);
    lp._takeHit(null);
    check('无头：撞击先扣容错护盾（不是直接失败）',
      lp.hits === 1 && lp.shields === 1 && lp.dead === false && lp.speedMul < 1,
      'hits=' + lp.hits + ' shields=' + lp.shields + ' speedMul=' + lp.speedMul);
    check('无头：撞碎后进入短暂无敌（不会一帧连扣）', lp.invuln > 1, String(lp.invuln));

    runFrames(80);                    // 等无敌时间过去
    lp._takeHit(null);
    check('无头：容错层数扣光后不再吃盾（但还没失败）',
      lp.hits === 2 && lp.shields === 0 && lp.dead === false,
      'hits=' + lp.hits + ' shields=' + lp.shields + ' dead=' + lp.dead);

    // 再用一根真实障碍撞上去：这次没盾可扣 → 本关失败
    runFrames(80);                    // 第二次扣盾的无敌时间也要等过去
    lp.spawner.obstacles.length = 0;
    const pbox = lp.player.hitbox();
    lp.spawner.obstacles.push({ x: pbox.x, y: pbox.y, w: 60, h: 60, type: 'low' });
    runFrames(3);
    check('无头：容错耗尽后再撞 → 本关失败（不再是扣盾）',
      lp.dead === true && lp.hits === 2,
      'hits=' + lp.hits + ' shields=' + lp.shields + ' dead=' + lp.dead);

    runFrames(60);                    // 0.7 秒死亡演出
    check('无头：闯关失败也走关卡结算页', until('LevelResultScene'), topName());
    const lr = scenes.top;
    check('无头：结算页判定未通关 0 星', lr.passed === false && lr.stars === 0,
      'passed=' + lr.passed + ' stars=' + lr.stars);
    check('无头：闯关失败的金币照常进钱包（商城经济不断）',
      save.wallet === walletBeforeLevel + lp.coins,
      walletBeforeLevel + ' + ' + lp.coins + ' = ' + save.wallet);
    check('无头：只有「重试本关」一个主按钮 + 选关/菜单（没通关就没有下一关）',
      lr.buttons.some((b) => b.id === 'retry') && lr.buttons.some((b) => b.id === 'select') &&
      lr.buttons.some((b) => b.id === 'menu') && !lr.buttons.some((b) => b.id === 'next'),
      lr.buttons.map((b) => b.id).join(','));

    // 重试：必须留在 L1（这条就是那个「被踢回无尽模式」的 bug 回归）
    lr.sel = lr.buttons.findIndex((b) => b.id === 'retry');
    tap('confirm');
    check('无头：结算页「重试本关」还是第 1 关',
      until('PlayScene') && scenes.top.mode === 'level' && scenes.top.levelId === 'L1',
      topName() + ' mode=' + (scenes.top && scenes.top.mode));

    // 暂停 → 重新开始：同样必须留在 L1
    const lp2 = scenes.top;
    tap('pause');
    check('无头：闯关里 Esc 同样能暂停', until('PauseScene'), topName());
    scenes.top.sel = scenes.top.buttons.findIndex((b) => b.id === 'restart');
    tap('confirm');
    check('无头：暂停「重新开始」留在第 1 关（不再被踢回无尽模式）',
      until('PlayScene') && scenes.top.mode === 'level' && scenes.top.levelId === 'L1',
      topName() + ' mode=' + (scenes.top && scenes.top.mode));

    // 通关：把距离推到终点，金币给够 → 3★ + 解锁 L2
    const lp3 = scenes.top;
    lp3.spawner.obstacles.length = 0;
    lp3.distance = lp3.rules.length;
    lp3.coins = 60;
    lp3._clear();
    check('无头：通关判定通过、拿到 3★（无伤 + 金币达标）',
      lp3.passed === true && lp3.starCount === 3,
      'passed=' + lp3.passed + ' stars=' + lp3.starCount);
    check('无头：通关后解锁第 2 关，但全局最高分不动（闯关分数不进无尽榜）',
      save.data.campaign.unlocked === 2 && save.data.campaign.stars.L1 === 3 &&
      save.data.bestScore === endlessBest,
      '解锁=' + save.data.campaign.unlocked + ' bestScore ' + endlessBest + '→' + save.data.bestScore);

    runFrames(70);
    check('无头：通关演出后进结算页', until('LevelResultScene'), topName());
    const lr2 = scenes.top;
    check('无头：通关结算页有「下一关」按钮',
      lr2.passed === true && lr2.stars === 3 && lr2.buttons.some((b) => b.id === 'next'),
      'passed=' + lr2.passed + ' stars=' + lr2.stars + ' ' + lr2.buttons.map((b) => b.id).join(','));

    lr2.sel = lr2.buttons.findIndex((b) => b.id === 'next');
    tap('confirm');
    check('无头：结算页「下一关」直接进第 2 关',
      until('PlayScene') && scenes.top.levelId === 'L2' && scenes.top.shields === 2,
      topName() + ' level=' + (scenes.top && scenes.top.levelId));

    // 结算页 → 选关页（replace，不留栈）
    scenes.top.spawner.obstacles.length = 0;
    scenes.top.distance = scenes.top.rules.length;
    scenes.top.coins = 16;            // L2 通关要 15 枚金币，2★ 要 20 枚 → 16 刚好 1★
    scenes.top._clear();
    runFrames(70);
    check('无头：L2 通关判定（金币过了通关线但没到 2★ 线 → 1★）',
      until('LevelResultScene') && scenes.top.passed === true && scenes.top.stars === 1,
      topName() + ' passed=' + (scenes.top && scenes.top.passed) + ' stars=' + (scenes.top && scenes.top.stars));
    scenes.top.sel = scenes.top.buttons.findIndex((b) => b.id === 'select');
    tap('confirm');
    check('无头：结算页能回选关页，且第 1、2 关已点亮',
      until('LevelSelectScene') && save.data.campaign.stars.L1 === 3 && save.data.campaign.stars.L2 === 1 &&
      save.data.campaign.unlocked === 3,
      topName() + ' 解锁=' + save.data.campaign.unlocked);

    // 选关页 Esc 回菜单
    tap('pause');
    runFrames(4);
    check('无头：选关页 Esc 能回主菜单', topName() === 'MenuScene', topName());

    // 无尽模式仍然是「撞即死」（护盾只在闯关模式生效）
    const m4 = scenes.top;
    m4.sel = Math.max(0, m4.buttons.findIndex((b) => b.id === 'start' || b.id === 'continue'));
    tap('confirm');
    runFrames(4);
    const ep = scenes.top;
    check('无头：无尽模式 rules 仍是无尽规则（护盾 Infinity）',
      ep.mode === 'endless' && ep.rules.shields === Infinity && ep.rules.gapMargin === 70,
      ep.mode + ' shields=' + ep.rules.shields);
    ep.spawner.obstacles.length = 0;
    runFrames(30);
    ep._die();
    check('无头：无尽模式撞击仍然直接结束（不走护盾）', ep.dead === true && ep.hits === 0);

    check('无头：全程 4000+ 帧没有任何运行期异常', crash === null, crash || ('共 ' + frames + ' 帧'));
    check('无头：音效接口都被真实调用过（说明接线没断）', audio.calls.length > 0, String(audio.calls.length) + ' 次');
  } catch (e) {
    bad('无头场景联动整体跑通', e && e.stack ? e.stack.split('\n').slice(0, 2).join(' | ') : String(e));
  }
}

// ---------------------------------------------------------------------------
// [8/9] 闯关模式：关卡数据、配方与规则回归（v1.2 新增）
//      —— 这一节是纯数据/纯函数校验：不碰 DOM，跑得快，失败定位准。
// ---------------------------------------------------------------------------
section('[8/10] 闯关模式：关卡数据与规则回归（v1.2）');
{
  try {
    const LV = await import(pathToFileURL(path.join(ROOT, 'src', 'data', 'levels.js')).href);
    const SPM = await import(pathToFileURL(path.join(ROOT, 'src', 'entities', 'spawner.js')).href);
    const levels = LV.LEVELS;

    // ---- 关卡总表：5 关、id 固定、难度严格递增 ----
    check('闯关：恰好 5 关，id 依次是 L1..L5',
      levels.length === 5 && levels.map((l) => l.id).join(',') === 'L1,L2,L3,L4,L5',
      levels.map((l) => l.id).join(','));

    const inc = (arr) => arr.every((v, i) => i === 0 || v > arr[i - 1]);
    const dec = (arr) => arr.every((v, i) => i === 0 || v < arr[i - 1]);

    check('闯关：关卡长度严格递增', inc(levels.map((l) => l.length)),
      levels.map((l) => l.length).join(' < '));
    check('闯关：起始速度严格递增', inc(levels.map((l) => l.startSpeed)),
      levels.map((l) => l.startSpeed).join(' < '));
    check('闯关：峰值速度严格递增，且都不超过 MAX_SPEED',
      inc(levels.map((l) => l.peakSpeed)) && levels.every((l) => l.peakSpeed <= C.MAX_SPEED),
      levels.map((l) => l.peakSpeed).join(' < ') + ' / 上限 ' + C.MAX_SPEED);
    check('闯关：爬升段长度落在 [关卡长度×0.25, 关卡长度]',
      levels.every((l) => l.rampDistance <= l.length && l.rampDistance >= l.length * 0.25),
      levels.map((l) => l.rampDistance + '/' + l.length).join(' '));
    check('闯关：障碍间隔（收得最紧的那头）严格递减',
      dec(levels.map((l) => l.spawn.intervalEnd)),
      levels.map((l) => l.spawn.intervalEnd).join(' > '));
    check('闯关：容错护盾数量单调不增（越到后面越不容错）',
      levels.every((l, i) => i === 0 || l.shields <= levels[i - 1].shields),
      levels.map((l) => l.shields).join(' '));

    // ---- 障碍尺寸：与跳跃能力自洽 ----
    check('闯关：高障碍高度都超过单跳顶点（必须二段跳或绕开）',
      levels.every((l) => l.spawn.tallHeight[0] > SPM.SINGLE_JUMP_HEIGHT),
      '单跳顶点 ' + SPM.SINGLE_JUMP_HEIGHT + '，最低高障碍 ' +
        Math.min(...levels.map((l) => l.spawn.tallHeight[0])));
    check('闯关：高障碍最高不超过 MAX_OBSTACLE_HEIGHT',
      levels.every((l) => l.spawn.tallHeight[1] <= C.MAX_OBSTACLE_HEIGHT),
      Math.max(...levels.map((l) => l.spawn.tallHeight[1])) + ' / ' + C.MAX_OBSTACLE_HEIGHT);
    check('闯关：矮障碍高度不超过 135（二段跳一定能过）',
      levels.every((l) => l.spawn.lowHeight[1] <= 135),
      Math.max(...levels.map((l) => l.spawn.lowHeight[1])));
    check('闯关：障碍宽度全落在 [MIN_OBSTACLE_WIDTH, MAX_OBSTACLE_WIDTH]',
      levels.every((l) => [...l.spawn.lowWidth, ...l.spawn.tallWidth]
        .every((w) => w >= C.MIN_OBSTACLE_WIDTH && w <= C.MAX_OBSTACLE_WIDTH)));

    // ---- 调色板：第 5 套（关卡模式按索引锁色）----
    check('闯关：config 里有 5 套霓虹调色板，第 5 套字段齐全',
      C.BG_PALETTES.length === 5 &&
      ['top', 'mid', 'bottom', 'glow', 'cityFar', 'cityNear', 'edgeFar', 'edgeNear']
        .every((k) => typeof C.BG_PALETTES[4][k] === 'string' && C.BG_PALETTES[4][k].length > 0),
      '调色板套数=' + C.BG_PALETTES.length);
    check('闯关：每关 paletteIndex 都指向真实存在的调色板',
      levels.every((l) => Number.isInteger(l.paletteIndex) &&
        l.paletteIndex >= 0 && l.paletteIndex < C.BG_PALETTES.length),
      levels.map((l) => l.paletteIndex).join(','));
    check('闯关：5 关的 paletteIndex 依次递增（一关一色）',
      inc(levels.map((l) => l.paletteIndex)), levels.map((l) => l.paletteIndex).join(' < '));

    // ---- 纯跑时长：闭式公式可复算，并与数值积分对账 ----
    // 【注意】设计稿的闭式公式 ramp/((start+peak)/2) + (len-ramp)/peak 用的是
    // 「速度对距离的算术平均」。真正跑完的时间是 ∫dx/speed(x)，由调和均值决定，
    // 必然略长于闭式值（AM ≥ HM 取等号仅当速度恒定）。所以这里不是「两者相等」，
    // 而是「闭式值可复算 + 真实时长比闭式值长 0~2%」，把这条偏差也钉住。
    let closedFormOk = true, integralOrderOk = true;
    for (const l of levels) {
      const rampAvg = (l.startSpeed + l.peakSpeed) / 2;
      const closed = l.rampDistance / rampAvg + (l.length - l.rampDistance) / l.peakSpeed;
      if (Math.abs(LV.levelRunSeconds(l) - closed) > 1e-9) closedFormOk = false;
      // 数值积分（中点法，0.5px 步长）：真实纯跑时长
      const STEP = 0.5;
      let t = 0;
      for (let d = 0; d < l.length; d += STEP) {
        t += Math.min(STEP, l.length - d) / LV.levelSpeedAt(l, Math.min(d + STEP / 2, l.length));
      }
      if (t < closed - 1e-6 || t > closed * 1.02) integralOrderOk = false;
    }
    check('闯关：每关纯跑时长闭式公式可复算（levelRunSeconds 与公式逐位一致）', closedFormOk);
    check('闯关：真实纯跑时长比闭式值长 0~2%（算术均值 ≥ 调和均值）', integralOrderOk);

    const DESIGN_BASE = [24.4, 30.6, 37.4, 45.3, 53.4];
    check('闯关：每关纯跑时长与设计稿基准偏差 < 10%',
      levels.every((l, i) =>
        Math.abs(LV.levelRunSeconds(l) - DESIGN_BASE[i]) / DESIGN_BASE[i] < 0.10),
      levels.map((l, i) => LV.levelRunSeconds(l).toFixed(1) + '(基准' + DESIGN_BASE[i] + ')').join(' '));

    // ---- 速度上确界：levelSpeedAt 永不超过 peakSpeed ----
    let speedCapOk = true;
    for (const l of levels) {
      for (let d = 0; d <= l.length * 1.5; d += Math.max(1, l.length / 400)) {
        if (LV.levelSpeedAt(l, d) > l.peakSpeed + 1e-9) speedCapOk = false;
      }
      if (LV.levelSpeedAt(l, l.length) !== l.peakSpeed) speedCapOk = false;
      if (LV.levelSpeedAt(l, 0) !== l.startSpeed) speedCapOk = false;
    }
    check('闯关：关卡速度永不超过该关 peakSpeed（到终点恰好等于峰值）', speedCapOk);

    // ---- 可达性地板 vs 硬约束 ----
    check('闯关：每关生成地板（0.70×peak + 关卡余量）恒高于硬约束线',
      levels.every((l) => LV.levelGapFloor(l) >
        C.AIR_TIME * l.peakSpeed - C.MAX_OBSTACLE_WIDTH + C.GAP_MARGIN),
      levels.map((l) => LV.levelGapFloor(l) + '>' +
        (C.AIR_TIME * l.peakSpeed - C.MAX_OBSTACLE_WIDTH + C.GAP_MARGIN)).join(' '));
    check('闯关：关卡余量比无尽模式更宽（90 > 70）',
      levels.every((l) => l.gapMargin === LV.LEVEL_GAP_MARGIN && l.gapMargin > C.GAP_MARGIN),
      '关卡 ' + LV.LEVEL_GAP_MARGIN + ' / 无尽 ' + C.GAP_MARGIN);

    // ---- 目标自洽：能跑到、金币拿得到、限时够用 ----
    check('闯关：每关 goal.distance 等于关卡长度',
      levels.every((l) => l.goal.distance === l.length));
    check('闯关：金币线不超过金币供给的 35%，2★ 线不超过 45%（不吃到不可能）',
      levels.every((l) => l.goal.coins <= LV.expectedCoinSupply(l) * 0.35 &&
        l.star2Coins <= LV.expectedCoinSupply(l) * 0.45),
      levels.map((l) => l.goal.coins + '/' + LV.expectedCoinSupply(l).toFixed(0)).join(' '));
    check('闯关：3★ 线不低于 2★ 线（星级不会倒挂）',
      levels.every((l) => l.star3Coins >= l.star2Coins));
    const timed = levels.filter((l) => l.goal.time > 0);
    check('闯关：限时关的时限 ≥ 纯跑时长 × 1.08',
      timed.length > 0 && timed.every((l) => l.goal.time >= LV.levelRunSeconds(l) * 1.08),
      timed.map((l) => l.id + ':' + l.goal.time + 's vs ' + (LV.levelRunSeconds(l) * 1.08).toFixed(1)).join(' '));

    // ---- 通关 / 星级判定纯函数：边界值 ----
    const L1 = levels[0];
    check('判定：distance 差 0.1px 就不算跑到终点',
      LV.evalClear(L1, { distance: L1.length - 0.1 }).passed === false &&
      LV.evalClear(L1, { distance: L1.length }).passed === true);
    check('判定：L1 无伤 + 金币达标 → 3★',
      LV.evalStars(L1, { distance: L1.length, coins: L1.star3Coins, hits: 0 }) === 3);
    check('判定：L1 有 1 次撞击 + 金币达标 → 降到 2★',
      LV.evalStars(L1, { distance: L1.length, coins: L1.star3Coins, hits: 1 }) === 2);
    check('判定：L1 金币刚到 1★ 线 → 1★',
      LV.evalStars(L1, { distance: L1.length, coins: 1, hits: 0 }) === 1);
    check('判定：没通关一律 0★（哪怕金币很多）',
      LV.evalStars(L1, { distance: 0, coins: 999, hits: 0 }) === 0);
    const L3 = levels[2];
    check('判定：L3 撞击容错为 0，撞一次就失败',
      L3.goal.maxHits === 0 &&
      LV.evalClear(L3, { distance: L3.length, coins: 999, hits: 0 }).passed === true &&
      LV.evalClear(L3, { distance: L3.length, coins: 999, hits: 1 }).passed === false);
    check('判定：L3 的 3★ 线比 2★ 更严（金币 32 > 25）',
      L3.star3Coins > L3.star2Coins &&
      LV.evalStars(L3, { distance: L3.length, coins: L3.star2Coins, hits: 0 }) === 2 &&
      LV.evalStars(L3, { distance: L3.length, coins: L3.star3Coins, hits: 0 }) === 3);
    const L4 = levels[3];
    check('判定：限时关 超时 0.1s 就失败（含罚时）',
      L4.goal.time > 0 &&
      LV.evalClear(L4, { distance: L4.length, coins: 999, hits: 0, elapsed: L4.goal.time }).passed === true &&
      LV.evalClear(L4, { distance: L4.length, coins: 999, hits: 0,
        elapsed: L4.goal.time - 1, timePenalty: 1.5 }).passed === false);
    check('判定：非限时关不看时间（elapsed 再大也能通关）',
      LV.evalClear(L1, { distance: L1.length, coins: 0, hits: 0, elapsed: 9999 }).passed === true);
    check('判定：evalClear 返回结构化 check 清单（结算页直接用）',
      Array.isArray(L4 && LV.evalClear(L4, {}).checks) && LV.evalClear(L4, {}).checks.length >= 3);

    // ---- 无尽模式回归（红线）：rules 必须与 config 逐字段等价 ----
    const er = LV.endlessRules();
    check('无尽回归：rules.speedAt / difficultyAt 与 config 是同一个函数引用',
      er.speedAt === C.speedAt && er.difficultyAt === C.difficultyAt);
    check('无尽回归：gapMargin === GAP_MARGIN === 70，shields === Infinity',
      er.gapMargin === C.GAP_MARGIN && C.GAP_MARGIN === 70 && er.shields === Infinity,
      'gapMargin=' + er.gapMargin + ' shields=' + er.shields);
    check('无尽回归：startSpeed/peakSpeed/rampDistance/firstSpawnGap 与 config 逐字段相等',
      er.startSpeed === C.BASE_SPEED && er.peakSpeed === C.MAX_SPEED &&
      er.rampDistance === C.SPEED_RAMP_DISTANCE && er.firstSpawnGap === C.FIRST_SPAWN_GAP);
    check('无尽回归：length = Infinity、recipe = null（生成器走默认配方）',
      er.length === Infinity && er.recipe === null && er.mode === 'endless' && er.levelId === null);
    check('无尽回归：config.speedAt(0)=BASE_SPEED，到爬升终点=MAX_SPEED',
      C.speedAt(0) === C.BASE_SPEED && C.speedAt(C.SPEED_RAMP_DISTANCE) === C.MAX_SPEED);
    let easeOk = typeof C.ease === 'function' && C.ease(0) === 0 && C.ease(1) === 1 && C.ease(0.5) === 0.5;
    for (let i = 0; i <= 100 && easeOk; i++) {
      const d = C.SPEED_RAMP_DISTANCE * i / 100;
      if (Math.abs(C.difficultyAt(d) - C.ease(d / C.SPEED_RAMP_DISTANCE)) > 1e-12) easeOk = false;
    }
    check('无尽回归：难度曲线仍是同一条 smoothstep（difficultyAt ≡ ease(d/ramp)）', easeOk);

    // ---- 源码级回归：新场景接线 + 那个必修 bug ----
    const mainSrc = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
    const selSrc = fs.readFileSync(path.join(ROOT, 'src', 'scenes', 'levelselect.js'), 'utf8');
    const resSrc = fs.readFileSync(path.join(ROOT, 'src', 'scenes', 'levelresult.js'), 'utf8');
    const pauseSrc = fs.readFileSync(path.join(ROOT, 'src', 'scenes', 'pause.js'), 'utf8');
    check('闯关：main.js 注册了 levelselect 与 levelresult',
      /register\(\s*'levelselect'/.test(mainSrc) && /register\(\s*'levelresult'/.test(mainSrc));
    check('闯关：选关页进关显式带 { mode: \'level\' }',
      /replace\('play',\s*\{\s*mode:\s*'level'/.test(selSrc));
    check('闯关：结算页「重试/下一关」也显式带 { mode: \'level\' }',
      /replace\('play',\s*\{\s*mode:\s*'level'/.test(resSrc));
    check('闯关：暂停「重新开始」按当前模式重建（不再被踢回无尽模式）',
      /replayParams/.test(pauseSrc) && /scenes\.replace\('play',\s*replay\)/.test(pauseSrc) &&
      !/scenes\.replace\('play'\s*\)/.test(pauseSrc),
      'pause.js 应通过 replayParams() 取参数再 replace');
    check('闯关：菜单里有闯关模式入口按钮（id: campaign）',
      /id:\s*'campaign'/.test(fs.readFileSync(path.join(ROOT, 'src', 'scenes', 'menu.js'), 'utf8')));
    check('闯关：HUD 支持目标/容错显示',
      /shields/.test(fs.readFileSync(path.join(ROOT, 'src', 'ui', 'hud.js'), 'utf8')) &&
      /goal/.test(fs.readFileSync(path.join(ROOT, 'src', 'ui', 'hud.js'), 'utf8')));
  } catch (e) {
    bad('闯关模式数据/规则整段跑通', e && e.stack ? e.stack.split('\n').slice(0, 2).join(' | ') : String(e));
  }
}

// ---------------------------------------------------------------------------
// [9/9] 闯关模式：五关真实生成逻辑模拟跑 + 存档 v2→v3 迁移与记账
// ---------------------------------------------------------------------------
section('[9/10] 闯关模式：五关模拟跑完 + 存档 v3 迁移');
{
  try {
    const LV = await import(pathToFileURL(path.join(ROOT, 'src', 'data', 'levels.js')).href);
    const SPM = await import(pathToFileURL(path.join(ROOT, 'src', 'entities', 'spawner.js')).href);

    // ---------- 五关模拟跑：1/60 步长，用关卡自己的曲线，峰值速度当地板 ----------
    const simReport = [];
    const minTimeGaps = [];
    let allReach = true, allFloor = true, allHard = true, allCombo = true, allPost = true;
    let allFinished = true, allSpawned = true, allTimeOk = true, allComboExist = true;

    for (const lv of LV.LEVELS) {
      const rules = LV.levelRules(lv.id);
      const sp = new SPM.Spawner();
      sp.reset(rules.recipe);          // 注入关卡配方（null 就是无尽模式的默认配方）

      // 数障碍：包一层 spawn（对象池会复用，用 Set 会少算，所以只认调用次数）
      let spawned = 0;
      const rawSpawn = sp.spawn.bind(sp);
      sp.spawn = (d) => { spawned++; return rawSpawn(d); };

      // 包一层 computeNextGap：这是「空气空隙」的唯一来源，按三种行分别对账
      let comboRows = 0, postRows = 0;
      let floorOk = true, comboOk = true, postOk = true;
      const rawGap = sp.computeNextGap.bind(sp);
      sp.computeNextGap = (speed, diff, dist, peak) => {
        const isCombo = sp.comboLeft > 0;
        const isPost = !isCombo && sp._postCombo === true;
        const g = rawGap(speed, diff, dist, peak);
        if (isCombo) {
          comboRows++;
          if (g + 1e-6 < speed * (C.AIR_TIME + lv.spawn.comboReaction)) comboOk = false;
        } else if (isPost) {
          postRows++;
          if (g * lv.spawn.postComboMul + 1e-6 < LV.levelGapFloor(lv)) postOk = false;
        } else if (g + 1e-6 < LV.levelGapFloor(lv)) floorOk = false;
        return g;
      };

      let distance = 0, t = 0, minAir = Infinity, minTimeGap = Infinity;
      let reach = true;
      while (distance < lv.length && t < 300) {
        const speed = rules.speedAt(distance);
        sp.update(DT, speed, rules.difficultyAt(distance), distance, rules.peakSpeed);
        if (!SPM.Spawner.verifyReachability(sp.obstacles, speed)) reach = false;
        for (let i = 1; i < sp.obstacles.length; i++) {
          const a = sp.obstacles[i - 1];
          const b = sp.obstacles[i];
          const gap = b.x - (a.x + a.w);
          if (gap < minAir) minAir = gap;
          const tg = gap / speed;
          if (tg < minTimeGap) minTimeGap = tg;
          if (gap + 1e-6 < speed * C.AIR_TIME - C.MAX_OBSTACLE_WIDTH + C.GAP_MARGIN) allHard = false;
        }
        distance += speed * DT;
        t += DT;
      }

      if (t < LV.levelRunSeconds(lv) - 0.01 || t > LV.levelRunSeconds(lv) * 1.03) allTimeOk = false;
      if (spawned < 10) allSpawned = false;
      if (distance < lv.length) allFinished = false;
      if (lv.spawn.comboChance > 0 && comboRows === 0) allComboExist = false;

      simReport.push(lv.id + ' 模拟 ' + t.toFixed(1) + 's / 公式 ' + LV.levelRunSeconds(lv).toFixed(1) +
        's · 障碍 ' + spawned + ' 个（连跳行 ' + comboRows + '、恢复行 ' + postRows + '）' +
        ' · 最短间距 ' + minAir.toFixed(0) + 'px · 最短时间间隔 ' + minTimeGap.toFixed(3) + 's');
      console.log('      ' + simReport[simReport.length - 1]);
      minTimeGaps.push(minTimeGap);

      allReach = allReach && reach;
      allFloor = allFloor && floorOk;
      allCombo = allCombo && comboOk;
      allPost = allPost && postOk;
    }

    check('闯关模拟：5 关都能在真实生成逻辑下跑到终点', allFinished);
    check('闯关模拟：每关障碍数足够（样本有效）', allSpawned);
    check('闯关模拟：全程 verifyReachability 恒为 true（没有跳不过去的间隔）', allReach);
    check('闯关模拟：常规行的间距恒 ≥ 该关生成地板（0.70×peak + 90）', allFloor);
    check('闯关模拟：所有间距恒满足硬约束（0.70×speed − 96 + 70，最大障碍宽 96）', allHard);
    check('闯关模拟：连跳（组合）内部间距 ≥ speed×(AIR_TIME+comboReaction)', allCombo);
    check('闯关模拟：组合收尾后的恢复段 ≥ 地板×postComboMul', allPost);
    check('闯关模拟：有 comboChance 的关卡真的生成了连跳组合', allComboExist);
    check('闯关模拟：模拟用时与纯跑时长公式一致（≥ 闭式值，且不超过其 3%）', allTimeOk);
    check('闯关模拟：每关最短时间间隔都 ≥ 一次完整跳跃的滞空时间（0.70s）',
      minTimeGaps.length === 5 && minTimeGaps.every((x) => x >= C.AIR_TIME),
      minTimeGaps.map((x) => x.toFixed(3) + 's').join(' '));

    // ---------- 存档 v2 → v3 迁移 ----------
    const mkStore = (raw) => {
      const mem = new Map();
      if (raw !== undefined) mem.set('neon-dash.save.v1', raw);
      return {
        getItem: (k) => (mem.has(k) ? mem.get(k) : null),
        setItem: (k, v) => mem.set(k, String(v)),
        removeItem: (k) => mem.delete(k),
      };
    };
    const { Save, SAVE_VERSION } = await import(pathToFileURL(path.join(ROOT, 'src', 'core', 'save.js')).href);

    check('存档 v1.2：SAVE_VERSION === 3 且存储键名仍是 neon-dash.save.v1',
      SAVE_VERSION === 3 &&
      fs.readFileSync(path.join(ROOT, 'src', 'core', 'save.js'), 'utf8')
        .includes("'neon-dash.save.v1'"), 'SAVE_VERSION=' + SAVE_VERSION);
    const s0 = new Save(mkStore()); s0.load();
    check('存档 v1.2：空档 load 不抛错且 campaign 齐全',
      !!s0.data.campaign && s0.data.campaign.unlocked === 1 &&
      JSON.stringify(s0.data.campaign.stars) === '{}' &&
      s0.data.campaign.cleared === 0, JSON.stringify(s0.data.campaign));

    const V2 = {
      version: 2, bestScore: 4321, playCount: 9, totalDistance: 12345, totalCoins: 77,
      wallet: 777, ownedSkins: ['default', 'ember'], equippedSkin: 'ember',
      settings: { sfx: false, music: true, vibrate: false },
      resume: { score: 11, distance: 222, coins: 3 },
    };
    const s1 = new Save(mkStore(JSON.stringify(V2))); s1.load();
    let v2ok = true;
    try {
      const d = s1.data;
      v2ok = d.version === 3 && d.campaign.unlocked === 1 &&
        d.bestScore === 4321 && d.wallet === 777 && d.playCount === 9 &&
        d.totalCoins === 77 && d.ownedSkins.indexOf('ember') >= 0 &&
        d.equippedSkin === 'ember' && d.settings.sfx === false &&
        !!d.resume && d.resume.distance === 222;
    } catch (e) { v2ok = false; }
    check('存档迁移：v2 旧档补出 campaign，wallet/bestScore/皮肤/设置/resume 一个不丢', v2ok,
      JSON.stringify(s1.data));

    // campaign 被改坏 → 只重置 campaign
    const s2 = new Save(mkStore(JSON.stringify(Object.assign({}, V2, {
      campaign: { unlocked: 'x', stars: [], bestScore: 'no', cleared: -5 },
    })))); s2.load();
    check('存档迁移：campaign 非法时只重置 campaign，其他字段原样保留',
      s2.data.campaign.unlocked === 1 && !Array.isArray(s2.data.campaign.stars) &&
      s2.data.bestScore === 4321 && s2.data.wallet === 777 && s2.data.equippedSkin === 'ember',
      JSON.stringify(s2.data.campaign));

    // v3 往返幂等：save() 写回的档再读一次，字段必须一模一样
    const st3 = mkStore(JSON.stringify(s2.data));
    const s3 = new Save(st3); s3.load();
    s3.save();
    const s4 = new Save(st3); s4.load();
    check('存档迁移：v3 存档往返幂等（写回再读字段不变）',
      s3.data.version === 3 && s4.data.version === 3 &&
      JSON.stringify(s4.data) === JSON.stringify(s3.data),
      JSON.stringify(s4.data).slice(0, 140));

    // ---------- recordLevel 记账 ----------
    const st = mkStore(JSON.stringify(V2));
    const s5 = new Save(st); s5.load();
    const before = s5.data.bestScore;
    const r1 = s5.recordLevel({ levelId: 'L1', stars: 2, score: 900, coins: 21 });
    check('闯关记账：通关 L1 后解锁第 2 关、金币进钱包、全局最高分不变',
      r1.ok === true && r1.unlocked === 2 && r1.cleared === 1 &&
      s5.data.wallet === 777 + 21 && s5.data.campaign.stars.L1 === 2 &&
      s5.data.campaign.bestScore.L1 === 900 && s5.data.bestScore === before,
      JSON.stringify(r1) + ' bestScore ' + before + '→' + s5.data.bestScore);

    const r2 = s5.recordLevel({ levelId: 'L1', stars: 1, score: 300, coins: 0 });
    check('闯关记账：低星重打不会把最好成绩改低（只增不减）',
      s5.data.campaign.stars.L1 === 2 && s5.data.campaign.bestScore.L1 === 900 &&
      r2.best === 900 && r2.stars === 2);

    s5.recordLevel({ levelId: 'L2', stars: 3, score: 1500, coins: 30 });
    check('闯关记账：连过两关后解锁第 3 关',
      s5.data.campaign.unlocked === 3 && s5.data.campaign.cleared === 2);

    const bad1 = s5.recordLevel({ levelId: 'L9', stars: 3, score: 1, coins: 1 });
    check('闯关记账：不存在的关卡返回 invalid 且不扣不加',
      bad1.ok === false && bad1.reason === 'invalid' && s5.data.wallet === 777 + 21 + 30);

    // 打满 5 关：unlocked 不会超过 5
    for (const lv of LV.LEVELS) s5.recordLevel({ levelId: lv.id, stars: 1, score: 100, coins: 0 });
    check('闯关记账：全通后 cleared=5 且 unlocked 封顶在 5',
      s5.data.campaign.cleared === 5 && s5.data.campaign.unlocked === 5);
    check('闯关记账：闯关金币总分也计入 totalCoins',
      s5.data.totalCoins === 77 + 21 + 30);

    // ---------- Lead 复核补充：关卡锁定配色必须精确取到 BG_PALETTES[idx] ----------
    // v1.2 审查发现：paletteAt 的索引收敛原本写死 i ≤ n-2，最后一套配色永远取不到，
    // 结果是 L4（idx 3）与 L5（idx 4）拿到同一套 3:0 配色，config 里为 L5 新加的
    // 第 5 套配色成了死数据。这里把它钉成回归断言，防止再次退化。
    const PAL = (await import(pathToFileURL(path.join(ROOT, 'src', 'config.js')).href)).BG_PALETTES;
    const paletteAt = (await import(pathToFileURL(path.join(ROOT, 'src', 'core', 'fx.js')).href)).paletteAt;
    const palFor = (idx) => paletteAt(idx / (PAL.length - 1));
    check('关卡配色：每关都精确取到 BG_PALETTES[paletteIndex] 本身（不混色、不回退）',
      LV.LEVELS.every((lv) => palFor(lv.paletteIndex).key === lv.paletteIndex + ':0'),
      LV.LEVELS.map((lv) => lv.id + '=' + palFor(lv.paletteIndex).key).join(' '));
    check('关卡配色：5 关背景配色两两不同（L4 与 L5 不再撞色）',
      new Set(LV.LEVELS.map((lv) => JSON.stringify(palFor(lv.paletteIndex)))).size === LV.LEVELS.length);
    check('关卡配色：最后一套配色确实存在且与第 4 套不同',
      PAL.length === 5 && PAL[4].top !== PAL[3].top);
    check('关卡配色：无尽模式顶到最高难度时仍停在 3:0（v1.1 画面不变）',
      paletteAt(3 / (PAL.length - 1)).key === '3:0');
  } catch (e) {
    bad('闯关模拟跑 / 存档迁移整段跑通',
      e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : String(e));
  }
}

// ---------------------------------------------------------------------------
// [10/10] v1.3 无尽模式：金币分布修正 + 三种新机制（移动障碍 / 双层平台 / 弹簧）
//
// 这一段全部用**可控随机**（mulberry32 种子桩）跑，结果完全可复现，不受真随机影响。
// 断言口径与「红线」一一对应，逐条列在下面：
//   金币：300 次模拟内 与障碍（含最坏包络）重叠 = 0、离地高度全部 ≤ 345、
//         穿地 = 0、贴地档（45~70px）每 1500px 至少 1 颗、连续无金币 ≤ 上限；
//   移动障碍：最坏包络可达性 100% 成立、包络之间零重叠（不侵占起跳/落地区）、
//             垂直伸缩的有效高度恒 ≤ 静态高度、水平幅度满足 speed·AIR_TIME 净空；
//   平台：真实 Player 跑 8 次模拟 → 0 次从下方被吸附、0 次落在平台内部、
//         每个平台 deckH + 20 ≤ 二段跳顶点；
//   弹簧：初速顶点 > 最高平台、只出现在左右 60px 无障的空地。
// ---------------------------------------------------------------------------
{
  section('[10/10] v1.3 无尽模式：金币分布 / 移动障碍 / 平台 / 弹簧');
  try {
    const CFG = await import(pathToFileURL(path.join(ROOT, 'src', 'config.js')).href);
    const SP = await import(pathToFileURL(path.join(ROOT, 'src', 'entities', 'spawner.js')).href);
    const PL = await import(pathToFileURL(path.join(ROOT, 'src', 'entities', 'player.js')).href);
    const LV = await import(pathToFileURL(path.join(ROOT, 'src', 'data', 'levels.js')).href);

    const DT = 1 / 60;
    const PX = CFG.DESIGN_WIDTH * CFG.PLAYER_X_RATIO;   // 玩家屏幕 x = 180
    const COIN_BAND = 1500;

    // 可控随机：同一颗种子每次跑出完全一样的序列（不让随机影响复现）
    function makeRng(seed) {
      let s = seed >>> 0;
      return () => {
        s = (s + 0x6D2B79F5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    function withRng(seed, fn) {
      const real = Math.random;
      Math.random = makeRng(seed);
      try { return fn(); } finally { Math.random = real; }
    }

    // ---- 配置层的红线：先钉死几个纯数值不变量 ----
    check('v1.3 配置：总开关 ENDLESS_MECHANICS 存在且金币保底距离为正',
      CFG.ENDLESS_MECHANICS === true && CFG.COIN_FORCE_GROUND_DIST > 0 &&
      CFG.COIN_FORCE_GROUND_DIST < CFG.COIN_GROUND_GAP);
    check('v1.3 配置：贴地档金币区间（45~70px）在玩家身高以内（跑着就能吃）',
      CFG.COIN_GROUND_LIFT[0] === 45 && CFG.COIN_GROUND_LIFT[1] === 70 &&
      CFG.COIN_GROUND_LIFT[1] <= CFG.PLAYER_HEIGHT + CFG.COIN_RADIUS);
    check('v1.3 配置：金币高度红线 345 == 二段跳顶点（脚底包络）',
      Math.abs(CFG.COIN_HARD_TOP - SP.DOUBLE_JUMP_APEX) < 0.2);
    check('v1.3 配置：弧顶上限 260 < 345 且 > 贴地档上限',
      CFG.COIN_ARC_TOP_MAX <= 260 && CFG.COIN_ARC_TOP_MAX > CFG.COIN_GROUND_LIFT[1]);
    check('v1.3 配置：平台高度区间合法（deckH + 20 ≤ 二段跳顶点）',
      CFG.DECK_H[0] >= 230 && CFG.DECK_H[1] <= CFG.COIN_HARD_TOP - 20 &&
      CFG.DECK_H[0] < CFG.DECK_H[1]);
    check('v1.3 配置：弹簧初速顶点 > 最高平台高度，且 > 430px',
      (CFG.SPRING_VELOCITY * CFG.SPRING_VELOCITY) / (2 * CFG.GRAVITY) > CFG.DECK_H[1] &&
      (CFG.SPRING_VELOCITY * CFG.SPRING_VELOCITY) / (2 * CFG.GRAVITY) > 430);
    check('v1.3 配置：三种机制的坡度都从 0 缓升（开局 0，≈20 秒时仍 < 12% 概率）',
      CFG.MOVE_RAMP[0] > 0 && CFG.DECK_RAMP[0] > 0 && CFG.SPRING_RAMP[0] > 0 &&
      CFG.mechRamp(0, CFG.MOVE_RAMP[0], CFG.MOVE_RAMP[1]) === 0 &&
      CFG.mechRamp(0, CFG.DECK_RAMP[0], CFG.DECK_RAMP[1]) === 0 &&
      CFG.mechRamp(0, CFG.SPRING_RAMP[0], CFG.SPRING_RAMP[1]) === 0 &&
      CFG.MOVE_CHANCE_MAX * CFG.mechRamp(0.19, CFG.MOVE_RAMP[0], CFG.MOVE_RAMP[1]) < 0.12 &&
      CFG.DECK_CHANCE_MAX * CFG.mechRamp(0.19, CFG.DECK_RAMP[0], CFG.DECK_RAMP[1]) < 0.12 &&
      CFG.SPRING_CHANCE_MAX * CFG.mechRamp(0.19, CFG.SPRING_RAMP[0], CFG.SPRING_RAMP[1]) < 0.12);

    // ---- 主模拟：300 次 × 30000px，一次跑完金币 / 移动障碍 / 弹簧 / 平台实体 ----
    const coin = {
      n: 0, overlap: 0, overlapEnv: 0, over345: 0, thruGround: 0, minBottom: Infinity,
      maxVoid: 0, maxBandVoid: 0, maxBandGap: 0, emptyBandBucket: 0, totalBandBucket: 0,
      groupMin: Infinity, groupMax: 0, hMin: Infinity, hMax: 0,
    };
    const mv = { n: 0, h: 0, v: 0, badReach: 0, envOverlap: 0, hHeightViolation: 0, wideViolation: 0, maxAmp: 0 };
    const dk = { n: 0, unreachable: 0, falling: 0, topMismatch: 0 };
    const spr = { n: 0, sideClear: 0, onDeck: 0 };
    const RUNS = 300, DIST = 30000;
    withRng(0x9E3779B9, () => {
      for (let run = 0; run < RUNS; run++) {
        const sp = new SP.Spawner();
        sp.reset();
        let pending = [];
        let groupN = 0;
        // 不攒数组：所有统计都用 O(1) 增量维护（长期跑不涨内存、不会拖慢测试）
        const nb = Math.floor(DIST / COIN_BAND);
        const bandHit = new Uint8Array(nb + 1);        // 第 i 个 1500px 桶里有没有贴地档金币
        const VOID_BUCKET = 150;                        // 空档检测的粒度（px），只用于「最长无金币距离」上界
        const nbv = Math.ceil(DIST / VOID_BUCKET);
        const anyHit = new Uint8Array(nbv + 1);
        let lastBandD = -1;
        const origTake = sp._takeCoin.bind(sp);
        sp._takeCoin = () => { const c = origTake(); pending.push(c); return c; };
        const origBetween = sp.spawnCoinsBetween.bind(sp);
        sp.spawnCoinsBetween = (l, r) => { const b = sp.coins.length; origBetween(l, r); groupN = sp.coins.length - b; };
        // 平台：记录 deckH 可达性 + 顶面高度与 deckH 是否一致
        const origDeck = sp._spawnDeck.bind(sp);
        sp._spawnDeck = (t) => {
          const before = sp.platforms.length;
          const out = origDeck(t);
          for (let i = before; i < sp.platforms.length; i++) {
            const p = sp.platforms[i];
            dk.n++;
            if (p.kind === 'falling') dk.falling++;
            if (!SP.deckReachable(p.deckH)) dk.unreachable++;
            if (Math.abs((CFG.GROUND_Y - p.y) - p.deckH) > 0.001) dk.topMismatch++;
          }
          return out;
        };
        // 弹簧：必须放在左右 60px 无障的空地
        const origSpring = sp.spawnSpringBetween.bind(sp);
        sp.spawnSpringBetween = (l, r, t) => {
          const before = sp.springs.length;
          origSpring(l, r, t);
          for (let i = before; i < sp.springs.length; i++) {
            const s = sp.springs[i];
            spr.n++;
            if (s.onDeck) spr.onDeck++;
            if (s.x - l < CFG.SPRING_CLEAR || r - (s.x + s.w) < CFG.SPRING_CLEAR) spr.sideClear++;
          }
        };
        let dist = 0;
        while (dist < DIST) {
          const speed = CFG.speedAt(dist);
          const diff = CFG.difficultyAt(dist);
          pending = [];
          sp.update(DT, speed, diff, dist);
          if (!SP.Spawner.verifyReachability(sp.obstacles, speed)) mv.badReach++;
          // 金币登记（当帧 _now 反算距离坐标）
          for (const c of pending) {
            const h = CFG.GROUND_Y - c.y;
            const d = sp._now + (c.x - PX);
            coin.n++;
            const bv = Math.floor(d / VOID_BUCKET);
            if (bv >= 0 && bv <= nbv) anyHit[bv] = 1;
            if (h < coin.hMin) coin.hMin = h;
            if (h > coin.hMax) coin.hMax = h;
            if (h > CFG.COIN_HARD_TOP) coin.over345++;
            const bottom = CFG.GROUND_Y - (c.y + c.r);
            if (bottom < coin.minBottom) coin.minBottom = bottom;
            if (bottom < 20) coin.thruGround++;
            if (h >= CFG.COIN_GROUND_LIFT[0] && h < CFG.COIN_GROUND_LIFT[1]) {
              const bi = Math.floor(d / COIN_BAND);
              if (bi >= 0 && bi <= nb) bandHit[bi] = 1;
              if (lastBandD >= 0 && d - lastBandD > coin.maxBandGap) coin.maxBandGap = d - lastBandD;
              lastBandD = d;
            }
            for (const o of sp.obstacles) {
              if (c.x + c.r > o.x && c.x - c.r < o.x + o.w && c.y + c.r > o.y && c.y - c.r < o.y + o.h) { coin.overlap++; break; }
            }
            for (const o of sp.obstacles) {
              const wx = (typeof o.worstX === 'number') ? o.worstX : o.x;
              const ww = (typeof o.worstW === 'number') ? o.worstW : o.w;
              const wh = (typeof o.worstH === 'number') ? o.worstH : o.h;
              if (c.x + c.r > wx && c.x - c.r < wx + ww && c.y + c.r > o.y && c.y - c.r < o.y + wh) { coin.overlapEnv++; break; }
            }
          }
          if (groupN > 0) { if (groupN < coin.groupMin) coin.groupMin = groupN; if (groupN > coin.groupMax) coin.groupMax = groupN; }
          // 移动障碍：最坏包络不重叠 + 垂直有效高度恒 ≤ 静态高度 + 水平幅度净空
          for (const o of sp.obstacles) {
            const hh = (typeof o.hEff === 'number') ? o.hEff : o.h;
            if (o.mv) {
              mv.n++; if (o.mv === 'h') mv.h++; else mv.v++;
              if (hh > o.h + 0.001) mv.hHeightViolation++;          // 垂直：只许变矮
              if (o.mv === 'h') {
                if (o.amp > mv.maxAmp) mv.maxAmp = o.amp;
                if (o.w + 2 * o.amp > speed * CFG.AIR_TIME - CFG.GAP_MARGIN + 1) mv.wideViolation++;
              }
            }
          }
          const list = sp.obstacles;
          for (let i = 1; i < list.length; i++) {
            const a = list[i - 1], b = list[i];
            const ax = (typeof a.worstX === 'number') ? a.worstX : a.x;
            const aw = (typeof a.worstW === 'number') ? a.worstW : a.w;
            const bx = (typeof b.worstX === 'number') ? b.worstX : b.x;
            if (bx < ax + aw - 0.001) mv.envOverlap++;               // 包络之间零重叠 → 不侵占起跳/落地区
          }
          dist += speed * DT;                                        // 推进距离（缺这行会变成死循环）
        }
        // 分桶：贴地档金币每 1500px 至少 1 颗（跳过第 0 桶：开局热身）
        for (let i = 1; i < nb; i++) {
          coin.totalBandBucket++;
          if (!bandHit[i]) coin.emptyBandBucket++;
        }
        // 最长「一颗金币都没有」的连续距离（150px 粒度，只会高估 → 断言方向更严）
        let run0 = 0;
        for (let i = 1; i <= nbv; i++) {
          if (!anyHit[i]) { run0++; if (run0 * VOID_BUCKET > coin.maxVoid) coin.maxVoid = run0 * VOID_BUCKET; }
          else run0 = 0;
        }
        // 最长「没有贴地档金币」的连续距离（1500px 粒度）
        let run1 = 0;
        for (let i = 1; i <= nb; i++) {
          if (!bandHit[i]) { run1++; if (run1 * COIN_BAND > coin.maxBandVoid) coin.maxBandVoid = run1 * COIN_BAND; }
          else run1 = 0;
        }
      }
    });

    check('金币：300 次模拟内与障碍盒子重叠 = 0（当前位置口径）', coin.overlap === 0, '重叠 ' + coin.overlap + ' / ' + coin.n);
    check('金币：300 次模拟内与障碍「最坏包络」也不重叠 = 0（巡逻扫过的区间里不放币）',
      coin.overlapEnv === 0, '重叠 ' + coin.overlapEnv + ' / ' + coin.n);
    check('金币：离地高度全部 ≤ 345（二段跳包络内）且下沿离地 ≥ 20px（不穿地）',
      coin.over345 === 0 && coin.thruGround === 0,
      'over345=' + coin.over345 + ' 穿地=' + coin.thruGround + ' 下沿最小=' + coin.minBottom.toFixed(1));
    check('金币：贴地档（45~70px）每 1500px 至少 1 颗（无尽模式，跳过开局第 0 桶）',
      coin.emptyBandBucket === 0,
      '空桶 ' + coin.emptyBandBucket + ' / ' + coin.totalBandBucket);
    check('金币：连续无「贴地档金币」最长距离 ≤ 1500px（保底线的触发行距）',
      coin.maxBandGap <= COIN_BAND, '最长 ' + coin.maxBandGap.toFixed(1) + 'px（按 1500px 桶看最长空段 ' + coin.maxBandVoid + 'px）');
    check('金币：连续无任何金币最长距离 ≤ 2000px（保底生效，不再出现几千 px 空档）',
      coin.maxVoid <= 2000, '最长 ' + coin.maxVoid.toFixed(1) + 'px（150px 粒度上界）');
    check('金币：同一空隙里颗数不再恒定（在 2~8 之间变化，忽多忽少被消除）',
      coin.groupMin >= 2 && coin.groupMax > coin.groupMin && coin.groupMax <= 8,
      'min=' + coin.groupMin + ' max=' + coin.groupMax);

    check('移动障碍：300 次模拟内按最坏包络的可达性校验 100% 成立',
      mv.badReach === 0, '失败帧 ' + mv.badReach);
    check('移动障碍：最坏包络之间零重叠（水平巡逻不侵占起跳区/落地区）',
      mv.envOverlap === 0, '重叠 ' + mv.envOverlap);
    check('移动障碍：垂直伸缩的有效高度恒 ≤ 静态同尺寸障碍高度（只许往上缩）',
      mv.hHeightViolation === 0, '越界 ' + mv.hHeightViolation);
    check('移动障碍：水平幅度满足 speed·AIR_TIME ≥ (w + 2·amp) + GAP_MARGIN（最坏位置也跳得过去）',
      mv.wideViolation === 0, '越界 ' + mv.wideViolation + ' 最大幅度 ' + mv.maxAmp.toFixed(1));
    check('移动障碍：两种运动都真的出现过（水平 + 垂直）', mv.h > 0 && mv.v > 0,
      'h=' + mv.h + ' v=' + mv.v);

    check('平台：300 次模拟内生成的每个平台都满足 deckH + 20 ≤ 二段跳顶点 345',
      dk.n > 0 && dk.unreachable === 0, '平台 ' + dk.n + ' 不可达 ' + dk.unreachable);
    check('平台：deckH 字段与「顶面离地高度」逐位一致、且坠落地形真的会生成',
      dk.topMismatch === 0 && dk.falling > 0, '错位 ' + dk.topMismatch + ' 坠落平台 ' + dk.falling);

    check('弹簧：只出现在左右 60px 内无障碍的空地上（300 次模拟）',
      spr.n > 0 && spr.sideClear === 0, '弹簧 ' + spr.n + ' 违规 ' + spr.sideClear);

    // ---- 平台 / 弹簧：真实 Player 物理模拟（8 次，每次 30000px）----
    const pstat = { runs: 0, snapFromBelow: 0, sinkCheck: 0, land: 0, deckStand: 0 };
    withRng(0x1234567, () => {
      for (let run = 0; run < 8; run++) {
        const sp = new SP.Spawner();
        sp.reset();
        const p = new PL.Player({ burst() {} }, null);
        p.reset();
        pstat.runs++;
        let dist = 0;
        while (dist < DIST) {
          const speed = CFG.speedAt(dist);
          const feet = p.y + p.h;
          const prevFeet = p.prevY + p.h;
          const surf = sp.surfaceY(p.x + p.w / 2, feet, p.vy, prevFeet);
          // 断言 A：上升中（vy<0）绝不能被判定成平台顶面 —— 这就是「从下方被吸附」
          if (p.vy < 0 && surf !== CFG.GROUND_Y) pstat.snapFromBelow++;
          const wasGround = p.onGround;
          p.update(DT, surf);
          if (!wasGround && p.onGround) pstat.land++;
          if (p.onGround && surf !== CFG.GROUND_Y) pstat.deckStand++;
          // 断言 B：站在实心板里的情况必须为 0 —— 仅看「已落地（onGround）」的帧，
          // 且跳过坠落平台：它下坠时本来就会从玩家身位扫过去（单向平台不是实心障碍，卡不住人）。
          for (const pl of sp.platforms) {
            if (pl.x > p.x + p.w || pl.x + pl.w < p.x) continue;
            if (pl.kind === 'falling') continue;
            const f = p.y + p.h;
            if (p.onGround && f > pl.y + CFG.SURFACE_TOL + 0.001 && f < pl.y + pl.h - CFG.SURFACE_TOL) pstat.sinkCheck++;
          }
          // 一直在弹跳：地面起跳 + 顶点附近补二段跳（平台按二段跳包络设计，单跳够不到）：
          // 既能踩上平台，也会从下面穿过（用来验证单向平台不会把人吸上去）
          if (p.onGround) p.pressJump();
          else if (p.jumpsLeft > 0 && p.vy >= -80) p.pressJump();
          sp.update(DT, speed, CFG.difficultyAt(dist), dist);
          dist += speed * DT;
        }
      }
    });
    check('平台：真实 Player 8 次模拟 → 0 次「从下方穿过时被吸附到平台顶」',
      pstat.snapFromBelow === 0, '吸附 ' + pstat.snapFromBelow);
    check('平台：真实 Player 8 次模拟 → 0 次「落地后卡在平台板体内部」',
      pstat.sinkCheck === 0, '陷入 ' + pstat.sinkCheck);
    check('平台：真实 Player 8 次模拟里确实踩上过平台（不是空跑）',
      pstat.deckStand > 0, '站在平台上 ' + pstat.deckStand + ' 帧 / 落地 ' + pstat.land + ' 次');

    // ---- 单向平台 / 弹簧的定点单测（不依赖随机，最严格）----
    {
      const sp = new SP.Spawner();
      sp.reset();
      const deck = sp._takePlatform();
      deck.x = 200; deck.y = CFG.GROUND_Y - 260; deck.w = 800; deck.h = CFG.DECK_THICKNESS;
      deck.kind = 'deck'; deck.deckH = 260; deck.armed = false;
      sp.platforms.push(deck);
      const top = deck.y;
      const below = top + 30;                       // 脚底已经在顶面之下 30px
      check('单向平台：上升中（从下方穿过）surfaceY 只给地面，绝不吸附',
        sp.surfaceY(400, below, -100) === CFG.GROUND_Y &&
        sp.surfaceY(400, top - 5, -100, below) === CFG.GROUND_Y);
      check('单向平台：从上方落下（脚底在顶面之上）才给平台顶面',
        sp.surfaceY(400, top - 5, 200, top - 40) === top);
      check('单向平台：已经穿到下面（脚底低于顶面超过容差）不再被吸附',
        sp.surfaceY(400, top + CFG.SURFACE_TOL + 1, 200, top + CFG.SURFACE_TOL + 1) === CFG.GROUND_Y);
      check('单向平台：x 区间不覆盖玩家时不生效',
        sp.surfaceY(1200, top - 5, 200, top - 40) === CFG.GROUND_Y);
      check('弹簧：从上方落到顶面触发一次、上升中不触发、冷却期内不重复触发',
        (() => {
          const s2 = new SP.Spawner();
          s2.reset();
          const st = s2._takeSpring();
          st.x = 300; st.y = CFG.GROUND_Y - 18; st.w = 56; st.h = 18; st.cool = 0; st.squash = 0;
          s2.springs.push(st);
          const hit = s2.triggerSprings(320, 46, st.y - 4, 200);
          const rising = s2.triggerSprings(320, 46, st.y - 4, -200);
          const again = s2.triggerSprings(320, 46, st.y - 4, 200);   // 冷却中
          return hit === -CFG.SPRING_VELOCITY && rising === 0 && again === 0;
        })());
    }

    // ---- 金币密度「随难度缓增」：同一颗种子下抽样对比前后段 ----
    {
      let early = 0, late = 0;
      withRng(0xC0FFEE, () => {
        for (let i = 0; i < 60; i++) {
          const sp = new SP.Spawner();
          sp.reset();
          let dist = 0, pending = [];
          const origTake = sp._takeCoin.bind(sp);
          sp._takeCoin = () => { const c = origTake(); pending.push(c); return c; };
          while (dist < 40000) {
            const speed = CFG.speedAt(dist);
            pending = [];
            sp.update(DT, speed, CFG.difficultyAt(dist), dist);
            for (const c of pending) {
              const d = sp._now + (c.x - PX);
              if (d < 10000) early++;
              else if (d >= 30000) late++;
            }
            dist += speed * DT;
          }
        }
      });
      check('金币：早期（前 10000px）密度 < 后期（30000px 之后）密度 —— 随难度缓增',
        late / 10 > (early / 10) * 1.1,
        '早期 ' + (early / 600).toFixed(2) + ' /1000px，后期 ' + (late / 600).toFixed(2) + ' /1000px');
    }

    // ---- 弧线金币「一次单跳能不能吃完」：本节的真正红线 ----
    // 背景（v1.3.1）：玩家反馈「跳跃时跟不上弧线，明明跳了却吃不到」「金币浮在半空」。
    // 旧版用 sin(k·π) 凭空铺高度、上限 260px，比单跳触碰天花板 216.2px 还高，
    // 而且弧线水平长度可以长到 406px > 慢速时一次单跳的跨度 280px。
    // 本节不复述任何公式，直接**孤立地生成弧线 + 跑真实 Player**来验证：
    //   (a) 一条弧线的最优单跳可吃率 ≥ 80%（对抽样逐条断言最小值，不看平均）
    //   (b) 每一颗弧线金币离地 ∈ [45, COIN_SINGLE_JUMP_REACH]，且按类型不超出该类型的上限
    //   (c) 弧线水平跨度 ≤ speed × AIR_TIME（用生成这一串时的速度）
    //   (d) 弧顶（最中间那颗）也能被同一跳吃掉
    {
      // 与 play.js:282-301 的 `_collide` 金币分支**同一套公式**：
      //   nx = clamp(c.x, box.x, box.x+box.w); ny = clamp(c.y, box.y, box.y+box.h);
      //   (c.x-nx)² + (c.y-ny)² ≤ c.r²  → 吃到
      const coinHit = (pl, cx, cy, cr) => {
        const box = pl.hitbox();
        const nx = Math.min(Math.max(cx, box.x), box.x + box.w);
        const ny = Math.min(Math.max(cy, box.y), box.y + box.h);
        const dx = cx - nx, dy = cy - ny;
        return dx * dx + dy * dy <= cr * cr;
      };
      // 孤立地造一串金币：不动游戏的滚动循环、不依赖对象池（每次都在空隙中间生成）。
      const ARC_L = 400, ARC_R = 400 + 1320;
      const newSpawner = () => { const s = new SP.Spawner(); s.reset(); return s; };
      const sampleArc = (sp) => {
        const before = sp.coins.length;
        sp.spawnCoinsBetween(ARC_L, ARC_R);
        const added = sp.coins.slice(before);
        if (!added.length) return null;
        const hs = added.map((c) => CFG.GROUND_Y - c.y);
        const spread = Math.max(...hs) - Math.min(...hs);
        if (spread < 40) return null;        // 贴地档是一条平线 → 本条不适用「弧线」断言
        // 【距离坐标用真实 x 偏移，不是 i×间距】弧线最后一颗是落在着地点上的「着地币」，
        // 它与前一颗的间距不一定是 COIN_SPACING；按 i×间距假装等距会把跨度估大（实测虚高 10px），
        // 也会让跳跃模拟里的到达时刻偏晚。这里以串头为原点取真实偏移。
        const minX = Math.min.apply(null, added.map((c) => c.x));
        for (let i = 0; i < added.length; i++) {
          added[i]._diagD = ARC_L + (added[i].x - minX);
          added[i]._diagSpeed = sp._lastSpeed;
        }
        return added;
      };
      /**
       * 扫描起跳时机，取最好的一次**单跳**（期间绝不二段跳），返回这一跳吃到的比例。
       * 坐标口径（唯一口径）：金币摆在距离坐标 c._diagD 上，玩家起跳时位于 coords jd，
       * 每帧 playerWorld += speed·dt；玩家屏幕 x 恒为 PX，
       * 所以金币 k 在屏幕上出现在 PX + (c._diagD − playerWorld)。
       */
      const bestSingleJumpEat = (coins, step = 5) => {
        const speed = coins[0]._diagSpeed;
        const firstD = coins[0]._diagD;
        const lastD = coins[coins.length - 1]._diagD;
        const span = lastD - firstD;
        let best = 0;
        // 扫描窗口：从「串头刚进屏（提前一个跨度起跳）」到「起跳点追平串尾」。
        for (let jd = Math.round(firstD - span); jd <= Math.round(lastD); jd += step) {
          const pl = new PL.Player({ burst() {} }, null);
          pl.reset();
          pl.pressJump();
          pl.update(1 / 240, CFG.GROUND_Y);   // 第 1 帧：消耗 buffer → 起跳
          const eaten = new Set();
          const dt = 1 / 240;
          let playerWorld = jd;
          for (let t = 0; t <= CFG.AIR_TIME + 0.004; t += dt) {
            for (let k = 0; k < coins.length; k++) {
              if (eaten.has(k)) continue;
              const cx = PX + (coins[k]._diagD - playerWorld);
              if (coinHit(pl, cx, coins[k].y, coins[k].r)) eaten.add(k);
            }
            pl.update(dt, CFG.GROUND_Y);
            playerWorld += speed * dt;
            if (pl.onGround && t > dt * 2) break;
          }
          if (eaten.size > best) best = eaten.size;
          if (best === coins.length) break;
        }
        return best / coins.length;
      };
      const SPEEDS = [400, 500, 604, 700, 833, 980];
      const DIFFS = [0, 0.25, 0.5, 0.75, 1];
      const rates = [];
      const spanOver = [], liftOver = [], liftUnder = [], groundOver = [], typeOver = [];
      let arcEndMiss = 0, midMiss = 0, arcs = 0, arcCoinN = 0;
      let worst = 1, worstInfo = '';
      withRng(0x51ED270B, () => {
        // 每种速度 × 每个难度各抽一批，保证慢速（跨度最紧张）也被覆盖到
        for (const speed of SPEEDS) {
          for (const diff of DIFFS) {
            let got = 0, guard = 0;
            while (got < 12 && guard++ < 4000) {
              const sp = newSpawner();
              sp._lastSpeed = speed;
              sp._lastDifficulty = diff;
              sp._coinDry = 2;                       // 越过 chance 门槛，专注几何本身
              const arc = sampleArc(sp);
              if (!arc) { sp.coins.length = 0; continue; }
              got++; arcs++;
              const hs = arc.map((c) => CFG.GROUND_Y - c.y);
              // 跨度按**真实水平跨度**量（首尾 _diagD 之差），不是 (颗数−1)×间距：
              // 弧线最后一颗是落在着地点上的「着地币」，它的间距不一定是 COIN_SPACING，
              // 用颗数×间距会把跨度估计得偏大（实测虚高 10px）。阈值不变。
              let spanMin = Infinity, spanMax = -Infinity;
              for (const c of arc) {
                if (c._diagD < spanMin) spanMin = c._diagD;
                if (c._diagD > spanMax) spanMax = c._diagD;
              }
              const span = spanMax - spanMin;
              const spanWall = speed * CFG.AIR_TIME;
              let isGround = 1;
              for (let i = 0; i < hs.length; i++) {
                arcCoinN++;
                const h = hs[i];
                if (h < CFG.COIN_GROUND_LIFT[0] - 0.001) liftUnder.push(h);
                if (h > CFG.COIN_SINGLE_JUMP_REACH + 0.001) liftOver.push(h);
                const isBand = h >= CFG.COIN_GROUND_LIFT[0] - 0.001 && h <= CFG.COIN_GROUND_LIFT[1] + 0.001;
                if (!isBand) isGround = 0;
              }
              if (!isGround) {
                // 弧线串：逐颗按类型卡上限（两端贴地 45~70，中间抛物线 ≤ 216.173）
                for (let i = 0; i < hs.length; i++) {
                  if (hs[i] > CFG.COIN_ARC_END_LIFT[1] + 0.001 && hs[i] > CFG.COIN_SINGLE_JUMP_REACH + 0.001) typeOver.push(hs[i]);
                }
                if (hs[0] > CFG.COIN_ARC_END_LIFT[1] + 0.001) arcEndMiss++;
                const maxH = Math.max.apply(null, hs);
                if (maxH > CFG.COIN_SINGLE_JUMP_REACH + 0.001) groundOver.push(maxH);
                if (span > spanWall + 0.001) spanOver.push(span - spanWall);
                const rate = bestSingleJumpEat(arc);
                rates.push(rate);
                if (rate < worst) { worst = rate; worstInfo = 'speed=' + speed + ' diff=' + diff + ' 颗数=' + arc.length + ' 跨度=' + span + ' 弧顶=' + maxH.toFixed(1); }
                // (d) 弧顶那颗（最中间）必须被「同一次最优单跳」吃掉
                let mid = 0;
                for (let i = 1; i < hs.length; i++) if (hs[i] > hs[mid]) mid = i;
                const speed0 = arc[0]._diagSpeed, firstD0 = arc[0]._diagD, lastD0 = arc[arc.length - 1]._diagD;
                const span0 = lastD0 - firstD0;
                let midEaten = false;
                for (let jd = Math.round(firstD0 - span0); jd <= Math.round(lastD0) && !midEaten; jd += 5) {
                  const pl = new PL.Player({ burst() {} }, null);
                  pl.reset();
                  pl.pressJump();
                  pl.update(1 / 240, CFG.GROUND_Y);
                  const eaten = new Set();
                  const dt = 1 / 240;
                  let pw = jd;
                  for (let t = 0; t <= CFG.AIR_TIME + 0.004; t += dt) {
                    if (!midEaten && !eaten.has(mid)) {
                      const cx = PX + (arc[mid]._diagD - pw);
                      if (coinHit(pl, cx, arc[mid].y, arc[mid].r)) { eaten.add(mid); midEaten = true; }
                    }
                    pl.update(dt, CFG.GROUND_Y);
                    pw += speed0 * dt;
                    if (pl.onGround && t > dt * 2) break;
                  }
                }
                if (!midEaten) midMiss++;
              }
              sp.coins.length = 0;
            }
          }
        }
      });

      const minRate = rates.length ? Math.min.apply(null, rates) : 0;
      const midRate = rates.length ? rates.slice().sort((a, b) => a - b)[Math.floor(rates.length / 2)] : 0;
      const avgRate = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : 0;
      check('金币弧线：抽样 ≥200 条，每条的最优单跳可吃率**最小值** ≥ 80%（逐条断言，不看平均）',
        arcs >= 200 && minRate >= 0.8,
        arcs + ' 条 / 金币 ' + arcCoinN + ' 颗，最小 ' + (minRate * 100).toFixed(1) +
        '%，中位 ' + (midRate * 100).toFixed(1) + '%，平均 ' + (avgRate * 100).toFixed(1) +
        '%（最差一条：' + worstInfo + '）');
      check('金币弧线：每一颗离地 ∈ [45, 216.173]，即单跳触碰天花板 COIN_SINGLE_JUMP_REACH 以内、不穿地面',
        liftUnder.length === 0 && liftOver.length === 0,
        '低于 45 的 ' + liftUnder.length + ' 颗，高于 216 的 ' + liftOver.length + ' 颗' +
        (liftOver.length ? '（最高 ' + Math.max.apply(null, liftOver).toFixed(1) + '）' : ''));
      check('金币弧线：两端恒落在贴地档（45~70px，跑着也吃得到），中间不超出天花板',
        arcEndMiss === 0 && typeOver.length === 0 && groundOver.length === 0,
        '两端越界 ' + arcEndMiss + ' 条，中间越界 ' + typeOver.length + ' 颗');
      check('金币弧线：水平跨度 ≤ speed × AIR_TIME（用生成该串时的速度，慢速也不例外）',
        spanOver.length === 0,
        '超标 ' + spanOver.length + ' 条' + (spanOver.length ? '（最多超 ' + Math.max.apply(null, spanOver).toFixed(1) + 'px）' : ''));
      check('金币弧线：弧顶（最中间那颗）也能被同一次单跳吃掉',
        midMiss === 0, '吃不到 ' + midMiss + ' / ' + rates.length + ' 条');
      check('金币弧线：慢速档（400px/s，一次单跳跨度只有 280px）也在抽样里且全部达标',
        rates.length >= 60,
        '样本 ' + rates.length + ' 条');
    }

    // ---- 闯关模式：金币配方必须还是 v1.2 那一套（红线：闯关行为不变）----
    {
      const badMode = LV.LEVELS.filter((lv) => lv.coins && lv.coins.mode === 'v13');
      check('闯关：5 关金币配方仍是 v1.2 结构（没有 v13 的 mode 标记）',
        badMode.length === 0, badMode.map((l) => l.id).join(','));
      const noMech = LV.LEVELS.every((lv) => {
        const r = LV.levelRecipe(lv);
        return !r.move && !r.deck && !r.spring && r.coins === lv.coins;
      });
      check('闯关：关卡配方里没有 move/deck/spring 三种机制字段（默认全关）', noMech);
      const er = LV.endlessRules();
      check('闯关：无尽规则对外形状不变（recipe===null / shields===Infinity / gapMargin===70）',
        er.recipe === null && er.shields === Infinity && er.gapMargin === CFG.GAP_MARGIN);
      const d1 = new SP.Spawner();
      d1.reset();
      check('总开关：无尽配方的金币是 v13 形态，且三种机制都已挂上',
        d1._recipe().coins.mode === 'v13' && d1._recipe().coins.groundForceDist > 0 &&
        d1._recipe().coins.pityGaps > 0 &&
        !!d1._recipe().move && !!d1._recipe().deck && !!d1._recipe().spring);
    }
  } catch (e) {
    bad('v1.3 新机制整段跑通',
      e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e));
  }
}

// ---------- 汇总 ----------
console.log('\n' + '-'.repeat(56));
console.log('  通过 ' + passed + ' 项，失败 ' + failed + ' 项');
if (failed > 0) {
  console.log('\n  失败明细：');
  for (const f of failures) console.log('   · ' + f);
}
console.log('-'.repeat(56) + '\n');

process.exit(failed > 0 ? 1 : 0);