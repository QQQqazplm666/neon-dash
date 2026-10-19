// ============================================================
// engine.js —— Canvas 引擎
// 职责：
//   1) 等比缩放：把 720x1280 的设计坐标适配到任意屏幕（等比 + 居中留黑边）
//   2) 固定步长更新（1/60 秒）+ 插值渲染，保证不同刷新率手感一致
//   3) requestAnimationFrame 主循环、暂停/继续、窗口尺寸变化
// ============================================================

let probeEl = null;

/** 读取刘海屏安全区（CSS env(safe-area-inset-*)），并换算成设计像素 */
function readSafeInsets(scale) {
  const zero = { top: 0, right: 0, bottom: 0, left: 0 };
  if (typeof document === 'undefined') return zero;
  if (!probeEl) {
    probeEl = document.createElement('div');
    probeEl.setAttribute('aria-hidden', 'true');
    // 用一个隐藏探针把 env() 的值“问”出来
    probeEl.style.cssText =
      'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
      'padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);';
    (document.body || document.documentElement).appendChild(probeEl);
  }
  const cs = getComputedStyle(probeEl);
  const s = scale || 1;
  return {
    top: (parseFloat(cs.paddingTop) || 0) / s,
    right: (parseFloat(cs.paddingRight) || 0) / s,
    bottom: (parseFloat(cs.paddingBottom) || 0) / s,
    left: (parseFloat(cs.paddingLeft) || 0) / s,
  };
}

export class Engine {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.designWidth = opts.width || 720;
    this.designHeight = opts.height || 1280;

    this.step = 1 / 60;        // 固定更新步长
    this.maxSteps = 5;         // 一帧最多补几步，防止切回标签页时“爆炸”
    this.acc = 0;              // 时间累加器
    this.lastTs = 0;
    this.running = false;
    this.paused = false;       // 暂停（比如切到后台）
    this.fps = 60;

    this.scale = 1;            // 设计像素 → CSS 像素 的比例
    this.offsetX = 0;          // 居中留边偏移（CSS 像素）
    this.offsetY = 0;
    this.dpr = 1;
    this.safe = { top: 0, right: 0, bottom: 0, left: 0 };  // 安全区（设计像素）

    this.onUpdate = null;      // (dt) => void     每个固定步长调用一次
    this.onRender = null;      // (alpha) => void  每个渲染帧调用一次
    this.onResize = null;      // () => void

    this._tick = this._tick.bind(this);
    this._onResize = this._onResize.bind(this);
    this._onVisibility = this._onVisibility.bind(this);

    window.addEventListener('resize', this._onResize);
    window.addEventListener('orientationchange', this._onResize);
    document.addEventListener('visibilitychange', this._onVisibility);

    this.resize();
  }

  // ---------------- 尺寸适配 ----------------
  resize() {
    const cssW = Math.max(1, window.innerWidth || this.designWidth);
    const cssH = Math.max(1, window.innerHeight || this.designHeight);
    // 手机上限制 DPR，避免像素太多导致卡顿
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.dpr = dpr;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);

    this.scale = Math.min(cssW / this.designWidth, cssH / this.designHeight);
    this.offsetX = (cssW - this.designWidth * this.scale) / 2;
    this.offsetY = (cssH - this.designHeight * this.scale) / 2;

    this.safe = readSafeInsets(this.scale);
    if (this.onResize) this.onResize();
  }

  _onResize() { this.resize(); }

  _onVisibility() {
    // 切到后台就暂停，切回来继续：防止 dt 累积导致的瞬移
    if (document.hidden) this.pause();
    else this.resume();
  }

  // ---------------- 坐标换算（输入用） ----------------
  /** 把鼠标/手指的屏幕坐标换算成游戏设计坐标 */
  toDesign(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: (clientX - r.left - this.offsetX) / this.scale,
      y: (clientY - r.top - this.offsetY) / this.scale,
    };
  }

  // ---------------- 主循环 ----------------
  start() {
    if (this.running) return;
    this.running = true;
    this.lastTs = performance.now();
    this.acc = 0;
    this._raf = requestAnimationFrame(this._tick);
  }

  stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
  }

  pause() { this.paused = true; }
  resume() {
    if (!this.paused) return;
    this.paused = false;
    // 清掉暂停期间累积的时间，避免“补帧雪崩”
    this.acc = 0;
    this.lastTs = performance.now();
  }

  _tick(ts) {
    if (!this.running) return;
    this._raf = requestAnimationFrame(this._tick);

    let dt = (ts - this.lastTs) / 1000;
    this.lastTs = ts;
    if (!isFinite(dt) || dt < 0) dt = 0;
    if (dt > 0.25) dt = 0.25;          // 单帧最多按 0.25 秒算
    if (this.fps) this.fps = this.fps * 0.9 + (1 / Math.max(dt, 1e-4)) * 0.1;

    if (this.paused) {
      // 暂停时仍然渲染（画面不黑），但不更新逻辑
      if (this.onRender) this.onRender(0);
      return;
    }

    this.acc += dt;
    let steps = 0;
    while (this.acc >= this.step && steps < this.maxSteps) {
      if (this.onUpdate) this.onUpdate(this.step);
      this.acc -= this.step;
      steps++;
    }
    if (steps === this.maxSteps) this.acc = 0;   // 追不上就放弃补偿

    const alpha = this.acc / this.step;          // 渲染插值系数 0..1
    if (this.onRender) this.onRender(alpha);
  }

  // ---------------- 渲染前后处理 ----------------
  /** 每帧渲染开始时调用：清屏 + 建立“设计坐标 → 屏幕坐标”的变换 */
  beginFrame() {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#05030f';                   // 留黑边的底色
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const s = this.scale * this.dpr;
    ctx.save();
    ctx.setTransform(s, 0, 0, s, this.offsetX * this.dpr, this.offsetY * this.dpr);
    // 裁剪到设计区域，避免特效溢到黑边上
    ctx.beginPath();
    ctx.rect(0, 0, this.designWidth, this.designHeight);
    ctx.clip();
    ctx.textBaseline = 'alphabetic';
  }

  /** 每帧渲染结束时调用 */
  endFrame() {
    this.ctx.restore();
  }
}