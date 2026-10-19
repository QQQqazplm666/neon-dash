// ============================================================
// fx.js —— 视觉特效层：屏幕震动、命中停顿、粒子、飘字、缓动函数
// 以及几个绘制小工具（圆角矩形、霓虹按钮、多层视差背景、霓虹地面、后期效果）。
//
// 【性能约定（重要）】
//   1. 所有 createLinearGradient / createRadialGradient / createPattern 的结果
//      都进缓存（按 ctx 弱引用分组），渲染循环里绝不重复创建。
//   2. 粒子与飘字带对象池，爆发时优先复用，不产生新的短命对象。
//   3. 后期效果只做「暗角 + 扫描线 + 受击闪光」三样轻量操作，
//      扫描线是几十条细线而不是整屏滤镜，避免移动端掉帧。
// ============================================================
import { COLORS, BG_PALETTES } from '../config.js';

// ---------------- 数学小工具 ----------------
export function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
export function lerp(a, b, t) { return a + (b - a) * t; }

// ---------------- 缓动函数 ----------------
export const Ease = {
  linear: (t) => t,
  inQuad: (t) => t * t,
  outQuad: (t) => t * (2 - t),
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  outBack: (t) => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  outElastic: (t) => {
    if (t === 0 || t === 1) return t;
    const c4 = (2 * Math.PI) / 3;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },
};

// ---------------- 渐变 / 图案缓存 ----------------
// 用 WeakMap 按 ctx 分组：ctx 被回收时缓存也一起走，不会泄漏。
const gradCache = new WeakMap();
function ctxCache(ctx) {
  let m = gradCache.get(ctx);
  if (!m) { m = new Map(); gradCache.set(ctx, m); }
  return m;
}
/** 取（必要时代建并缓存）一个渐变。key 必须包含所有影响渐变外观的量。 */
export function cachedGradient(ctx, key, make) {
  const m = ctxCache(ctx);
  let g = m.get(key);
  if (!g) {
    g = make(ctx);
    m.set(key, g);
    if (m.size > 160) m.clear();     // 兜底：缓存不会无限膨胀
  }
  return g;
}

// ---------------- 绘制小工具 ----------------
/** 画一个圆角矩形路径（自己实现，避免依赖 ctx.roundRect 的兼容性） */
export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

/** 画一颗霓虹按钮：返回的就是屏幕上真正可点的矩形 */
export function drawNeonButton(ctx, rect, label, opts = {}) {
  const { x, y, w, h } = rect;
  const color = opts.color || COLORS.neonCyan;
  const pad = 10;
  const disabled = !!opts.disabled;
  ctx.save();
  // 底
  roundRect(ctx, x, y, w, h, 18);
  ctx.fillStyle = disabled
    ? 'rgba(18,18,30,0.72)'
    : (opts.active ? 'rgba(0,240,255,0.18)' : 'rgba(10,10,40,0.72)');
  ctx.fill();
  // 霓虹描边
  ctx.shadowColor = color;
  ctx.shadowBlur = disabled ? 0 : (opts.active ? 20 : 10);
  ctx.lineWidth = opts.active ? 3 : 2;
  ctx.strokeStyle = disabled ? 'rgba(150,150,170,0.6)' : color;
  ctx.stroke();
  ctx.shadowBlur = 0;
  // 文字
  ctx.fillStyle = disabled ? 'rgba(190,190,205,0.75)' : (opts.textColor || COLORS.white);
  ctx.font = `700 ${opts.fontSize || 34}px "Microsoft YaHei", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + w / 2, y + h / 2 + (opts.sub ? -14 : 1));
  if (opts.sub) {
    ctx.fillStyle = disabled ? 'rgba(170,170,185,0.7)' : 'rgba(255,255,255,0.62)';
    ctx.font = '500 22px "Microsoft YaHei", system-ui, sans-serif';
    ctx.fillText(opts.sub, x + w / 2, y + h - pad - 16);
  }
  ctx.restore();
  return rect;
}

/** 判断一个点是否在矩形里（用于触摸点击判定） */
export function pointInRect(p, r) {
  return !!p && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

// ---------------- 背景配色（随距离渐变） ----------------
function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(r, g, b) {
  const n = (1 << 24) + (r << 16) + (g << 8) + b;
  return '#' + n.toString(16).slice(1);
}
function mixHex(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex(
    Math.round(A[0] + (B[0] - A[0]) * t),
    Math.round(A[1] + (B[1] - A[1]) * t),
    Math.round(A[2] + (B[2] - A[2]) * t),
  );
}
/** 混合 "r,g,b" 形式的颜色串（BG_PALETTES 里的 glow/city* 用这种写法） */
function mixTriplet(a, b, t) {
  const A = a.split(','), B = b.split(',');
  return `${Math.round(+A[0] + (+B[0] - +A[0]) * t)},${Math.round(+A[1] + (+B[1] - +A[1]) * t)},${Math.round(+A[2] + (+B[2] - +A[2]) * t)}`;
}

const PAL_STEPS = 16;                 // 两套配色之间切成 16 档，够顺滑又不会缓存爆掉
const palCache = new Map();
/**
 * 按难度进度取一套「混合后的」背景配色。
 * 结果按 (段, 档位) 缓存并复用同一个对象 —— 渲染循环里不会产生垃圾。
 */
export function paletteAt(difficulty) {
  const n = BG_PALETTES.length;
  const p = clamp(difficulty || 0, 0, 1) * (n - 1);
  let i = Math.floor(p);
  // 【v1.2 修复】顶到最后一档时必须能取到「最后一套配色」本身。
  // 原来这两处都写成 min(n-2, …)，索引永远到不了 n-1：于是 config 里为 L5
  // 追加的第 5 套配色永远取不到，L4 与 L5 会撞成同一套 3:0 配色。
  if (p >= n - 1) { i = n - 1; }
  else if (i > n - 2) i = n - 2;
  let step = Math.round((p - i) * PAL_STEPS);
  if (step >= PAL_STEPS && i < n - 1) { i = Math.min(n - 1, i + 1); step = 0; }
  const key = i + ':' + step;
  let pal = palCache.get(key);
  if (pal) return pal;
  const a = BG_PALETTES[i], b = BG_PALETTES[i + 1] || a, t = step / PAL_STEPS;
  pal = {
    key,
    top: mixHex(a.top, b.top, t),
    mid: mixHex(a.mid, b.mid, t),
    bottom: mixHex(a.bottom, b.bottom, t),
    glow: mixTriplet(a.glow, b.glow, t),
    cityFar: mixTriplet(a.cityFar, b.cityFar, t),
    cityNear: mixTriplet(a.cityNear, b.cityNear, t),
    edgeFar: mixHex(a.edgeFar, b.edgeFar, t),
    edgeNear: mixHex(a.edgeNear, b.edgeNear, t),
  };
  palCache.set(key, pal);
  return pal;
}

// ---------------- 背景：多层视差（星空 → 远景城市 → 近景霓虹地平线） ----------------
export function makeStars(count, w, h) {
  const stars = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      x: Math.random() * w,
      y: Math.random() * h * 0.72,
      z: 0.15 + Math.random() * 0.85,   // 视差深度：越大移动越快
      s: 1 + Math.random() * 2.2,
      a: 0.25 + Math.random() * 0.6,
      p: Math.random() * 6.28,          // 闪烁相位
    });
  }
  return stars;
}

// 一个稳定的伪随机（同样下标永远得到同样的值，用来生成不会闪烁的楼群）
function hash(i) {
  const n = Math.sin(i * 127.1) * 43758.5453;
  return n - Math.floor(n);
}

/**
 * 画背景。scrollX 是世界滚动距离，difficulty 决定配色阶段。
 * 视差一共四层：星空 0.06 → 远景楼群 0.18 → 近景楼群 0.38 → 霓虹地平线光束 0.55。
 */
export function drawBackdrop(ctx, stars, time, scrollX, difficulty, w, h) {
  const pal = paletteAt(difficulty);

  // 天空渐变（缓存；多画一圈，避免相机上下偏移时露边）
  const sky = cachedGradient(ctx, 'sky:' + pal.key, (c) => {
    const g = c.createLinearGradient(0, -160, 0, h + 160);
    g.addColorStop(0, pal.top);
    g.addColorStop(0.62, pal.mid);
    g.addColorStop(1, pal.bottom);
    return g;
  });
  ctx.fillStyle = sky;
  ctx.fillRect(-40, -200, w + 80, h + 400);

  // 地平线光晕（缓存）
  const glow = cachedGradient(ctx, 'glow:' + pal.key, (c) => {
    const g = c.createRadialGradient(w * 0.5, h * 0.8, 20, w * 0.5, h * 0.8, w * 0.95);
    g.addColorStop(0, `rgba(${pal.glow},0.26)`);
    g.addColorStop(0.55, `rgba(${pal.glow},0.08)`);
    g.addColorStop(1, `rgba(${pal.glow},0)`);
    return g;
  });
  ctx.fillStyle = glow;
  ctx.fillRect(-40, -200, w + 80, h + 400);

  // 星空（三层视差靠 z 区分）
  for (let i = 0; i < stars.length; i++) {
    const st = stars[i];
    const x = ((st.x - scrollX * 0.06 * st.z) % w + w) % w;
    ctx.globalAlpha = st.a * (0.55 + 0.45 * Math.sin(time * 2 + (st.p || i)));
    ctx.fillStyle = st.z > 0.7 ? COLORS.white : pal.edgeNear;
    ctx.fillRect(x, st.y, st.s, st.s);
  }
  ctx.globalAlpha = 1;

  // 两层霓虹城市剪影（配色跟着难度走）
  drawCityLayer(ctx, scrollX * 0.18, w, h, 150, 130, 300, `rgba(${pal.cityFar},0.6)`, pal.edgeFar, false);
  drawCityLayer(ctx, scrollX * 0.38, w, h, 118, 90, 240, `rgba(${pal.cityNear},0.92)`, pal.edgeNear, true);

  // 近景霓虹地平线：一道亮带 + 几束缓慢掠过的光柱
  const hy = h * 0.72;
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = pal.edgeNear;
  ctx.fillRect(-40, hy - 2, w + 80, 3);
  ctx.globalAlpha = 0.1;
  const beam = 260;
  const off = (scrollX * 0.55) % beam;
  for (let x = -off - beam; x < w + beam; x += beam) {
    ctx.fillRect(x, hy - 320, 34, 320);
  }
  ctx.restore();
}

function drawCityLayer(ctx, offset, w, h, spacing, minH, maxH, fill, edge, windows) {
  const first = Math.floor(offset / spacing) - 1;
  const count = Math.ceil(w / spacing) + 3;
  const base = h * 0.72;
  ctx.save();
  for (let k = 0; k < count; k++) {
    const i = first + k;
    const x = i * spacing - offset;
    const bw = spacing - 18;
    const bh = minH + hash(i) * (maxH - minH);
    const top = base - bh;
    ctx.fillStyle = fill;
    ctx.fillRect(x, top, bw, bh);
    ctx.fillStyle = edge;
    ctx.globalAlpha = 0.75;
    ctx.fillRect(x, top, bw, 3);
    ctx.globalAlpha = 1;
    if (windows) {
      // 亮着的窗户：用同一个伪随机算，保证不会逐帧乱闪
      ctx.globalAlpha = 0.35;
      for (let wy = top + 20; wy < base - 16; wy += 34) {
        for (let wx = x + 10; wx < x + bw - 14; wx += 26) {
          const r = hash(i * 97.3 + wx * 0.13 + wy * 0.07);
          if (r > 0.62) {
            ctx.fillStyle = r > 0.86 ? COLORS.neonCyan : edge;
            ctx.fillRect(wx, wy, 9, 12);
          }
        }
      }
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();
}

/**
 * 霓虹地面：暗底 + 滚动网格 + 辉光边缘线。
 * 网格用固定步长做世界坐标取模，滚动起来是连续的，不会跳。
 */
export function drawGround(ctx, scrollX, time, w, h, difficulty) {
  const pal = paletteAt(difficulty);
  const gy = 990;
  // 地面底
  const g = cachedGradient(ctx, 'ground', (c) => {
    const grd = c.createLinearGradient(0, gy - 4, 0, Math.max(h, gy + 260));
    grd.addColorStop(0, '#120726');
    grd.addColorStop(1, '#04010d');
    return grd;
  });
  ctx.fillStyle = g;
  ctx.fillRect(-40, gy, w + 80, Math.max(h, gy + 260) - gy);

  // 辉光边缘线
  ctx.save();
  ctx.shadowColor = pal.edgeNear;
  ctx.shadowBlur = 24;
  ctx.fillStyle = pal.edgeNear;
  ctx.fillRect(-40, gy - 3, w + 80, 4);
  ctx.restore();

  // 横向网格（透视：越远越密）
  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  let step = 12;
  for (let y = gy + 6; y < Math.max(h, gy + 300); y += step) {
    ctx.moveTo(-40, y);
    ctx.lineTo(w + 40, y);
    step *= 1.28;                       // 越往下间距越大，模拟透视
    if (step > 200) break;
  }
  ctx.stroke();

  // 纵向网格（随世界滚动）
  const span = 120;
  const off = ((scrollX % span) + span) % span;
  ctx.globalAlpha = 0.18;
  ctx.beginPath();
  for (let x = -off - span; x < w + span; x += span) {
    ctx.moveTo(x, gy);
    ctx.lineTo(x + 60, Math.max(h, gy + 300));   // 稍微斜一点更有纵深
  }
  ctx.stroke();
  ctx.restore();
}

// ---------------- 后期效果 ----------------
/** 暗角：把注意力收到画面中央（缓存的径向渐变，整屏只填一次） */
export function drawVignette(ctx, w, h) {
  const g = cachedGradient(ctx, 'vignette:' + w + 'x' + h, (c) => {
    const grd = c.createRadialGradient(w / 2, h * 0.52, h * 0.3, w / 2, h * 0.52, h * 0.78);
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(0.7, 'rgba(0,0,0,0.28)');
    grd.addColorStop(1, 'rgba(0,0,0,0.62)');
    return grd;
  });
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/** 扫描线：几十条细线，比整屏滤镜便宜得多，但足够有 CRT 味 */
export function drawScanlines(ctx, w, h, time) {
  ctx.save();
  ctx.globalAlpha = 0.055;
  ctx.fillStyle = '#000000';
  const gap = 16;
  const off = (time * 24) % gap;
  for (let y = -off; y < h; y += gap) ctx.fillRect(0, y, w, 2);
  ctx.restore();
}

// ============================================================
// FX —— 特效管理器（每个场景可以自己 new 一个，也可以用全局的）
// ============================================================
export class FX {
  constructor(maxParticles = 420) {
    this.particles = [];
    this.texts = [];
    this.maxParticles = maxParticles;
    this._pPool = [];        // 粒子对象池
    this._tPool = [];        // 飘字对象池
    this.shakePower = 0;
    this.shakeTime = 0;
    this.shakeDuration = 1;
    this.hitstopTimer = 0;   // > 0 时世界会被冻结（命中停顿）
    this.flashTimer = 0;
    this.flashDuration = 1;
    this.flashColor = COLORS.white;
    this.damageTimer = 0;    // 受击红光
    this.damageDuration = 1;
    this._t = 0;
  }

  // ---------- 触发类接口 ----------
  /** 屏幕震动：power 是最大偏移像素，duration 是持续时间（秒） */
  shake(power, duration = 0.4) {
    this.shakePower = Math.max(this.shakePower, power);
    this.shakeDuration = duration;
    this.shakeTime = Math.max(this.shakeTime, duration);
  }

  /** 命中停顿：让世界“卡”一下，打击感的关键 */
  hitstop(duration = 0.1) {
    this.hitstopTimer = Math.max(this.hitstopTimer, duration);
  }

  /** 全屏闪光（默认白，受击时可以传红） */
  flash(duration = 0.25, color = COLORS.white) {
    this.flashTimer = Math.max(this.flashTimer, duration);
    this.flashDuration = Math.max(duration, 0.001);
    this.flashColor = color;
  }

  /** 受击红屏：撞击瞬间用，和白色闪光叠加出“红白闪” */
  damage(duration = 0.32) {
    this.damageTimer = Math.max(this.damageTimer, duration);
    this.damageDuration = Math.max(duration, 0.001);
  }

  /**
   * 粒子爆发。
   * 兼容两种写法：burst(x, y, count, color, opts) 与 burst(x, y, opts)。
   */
  burst(x, y, count, color, opts = {}) {
    if (typeof count === 'object' && count !== null) {
      opts = count;
      count = opts.count || 10;
      color = opts.color || COLORS.white;
    }
    const speed = opts.speed || 220;
    const life = opts.life || 0.5;
    const size = opts.size || 4;
    const gravity = opts.gravity !== undefined ? opts.gravity : 900;
    const spread = opts.spread !== undefined ? opts.spread : Math.PI * 2;
    const dir = opts.dir !== undefined ? opts.dir : 0;
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= this.maxParticles) break;
      const ang = dir + (Math.random() - 0.5) * spread;
      const sp = speed * (0.35 + Math.random() * 0.85);
      const p = this._pPool.pop() || {};
      p.x = x; p.y = y;
      p.vx = Math.cos(ang) * sp;
      p.vy = Math.sin(ang) * sp;
      p.life = life; p.maxLife = life;
      p.size = size * (0.6 + Math.random() * 0.8);
      p.color = color;
      p.gravity = gravity;
      p.drag = opts.drag !== undefined ? opts.drag : 1.6;
      this.particles.push(p);
    }
  }

  /** 飘字（比如 +10） */
  text(x, y, str, color = COLORS.white, opts = {}) {
    const t = this._tPool.pop() || {};
    t.x = x; t.y = y; t.str = str; t.color = color;
    t.life = opts.life || 0.8;
    t.maxLife = t.life;
    t.vy = opts.vy !== undefined ? opts.vy : -90;
    t.size = opts.size || 30;
    this.texts.push(t);
  }

  clearParticles() {
    for (const p of this.particles) this._pPool.push(p);
    for (const t of this.texts) this._tPool.push(t);
    this.particles.length = 0;
    this.texts.length = 0;
  }

  reset() {
    this.clearParticles();
    this.shakePower = 0; this.shakeTime = 0; this.hitstopTimer = 0;
    this.flashTimer = 0; this.damageTimer = 0;
  }

  // ---------- 每帧更新 ----------
  update(dt) {
    this._t += dt;
    if (this.hitstopTimer > 0) this.hitstopTimer = Math.max(0, this.hitstopTimer - dt);
    if (this.flashTimer > 0) this.flashTimer = Math.max(0, this.flashTimer - dt);
    if (this.damageTimer > 0) this.damageTimer = Math.max(0, this.damageTimer - dt);
    if (this.shakeTime > 0) {
      this.shakeTime = Math.max(0, this.shakeTime - dt);
      if (this.shakeTime === 0) this.shakePower = 0;
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        this._pPool.push(p);
        continue;
      }
      p.vy += p.gravity * dt;
      const d = Math.max(0, 1 - p.drag * dt);
      p.vx *= d; p.vy *= d;
      p.x += p.vx * dt; p.y += p.vy * dt;
    }

    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.life -= dt;
      if (t.life <= 0) {
        this.texts.splice(i, 1);
        this._tPool.push(t);
        continue;
      }
      t.y += t.vy * dt;
      t.vy *= Math.max(0, 1 - 2.2 * dt);
    }
  }

  // ---------- 取震动偏移 ----------
  shakeOffset() {
    if (this.shakeTime <= 0 || this.shakePower <= 0) return ZERO_OFFSET;
    const k = this.shakeTime / this.shakeDuration;   // 越接近爆炸瞬间越强
    const p = this.shakePower * k * k;
    ZERO_OFFSET.x = (Math.random() * 2 - 1) * p;
    ZERO_OFFSET.y = (Math.random() * 2 - 1) * p;
    return ZERO_OFFSET;
  }

  // ---------- 绘制 ----------
  render(ctx) {
    for (const p of this.particles) {
      const a = clamp(p.life / p.maxLife, 0, 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      const s = p.size * (0.4 + 0.6 * a);
      ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
    }
    ctx.globalAlpha = 1;

    for (const t of this.texts) {
      const a = clamp(t.life / t.maxLife, 0, 1);
      const pop = 1 + 0.18 * (1 - a);      // 出现瞬间稍微放大一点，更有反馈
      ctx.globalAlpha = a;
      ctx.font = `800 ${Math.round(t.size * pop)}px "Microsoft YaHei", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillText(t.str, t.x + 2, t.y + 2);
      ctx.fillStyle = t.color;
      ctx.fillText(t.str, t.x, t.y);
    }
    ctx.globalAlpha = 1;
  }

  /** 受击红光：画在世界之上、HUD 之下 */
  renderDamage(ctx, w, h) {
    if (this.damageTimer <= 0) return;
    const k = this.damageTimer / this.damageDuration;
    ctx.globalAlpha = clamp(k * 0.5, 0, 0.5);
    ctx.fillStyle = COLORS.danger;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
  }

  /** 全屏闪光（颜色由 flash() 决定） */
  renderFlash(ctx, w, h) {
    if (this.flashTimer <= 0) return;
    const k = this.flashTimer / this.flashDuration;
    ctx.globalAlpha = clamp(k * 0.75, 0, 0.75);
    ctx.fillStyle = this.flashColor;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
  }
}

// 复用的偏移对象：shakeOffset() 每帧都调用，不该每次都 new
const ZERO_OFFSET = { x: 0, y: 0 };