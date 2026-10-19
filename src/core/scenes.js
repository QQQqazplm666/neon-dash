// ============================================================
// scenes.js —— 栈式场景管理器
// 场景像一叠卡片：只有最上面那张会 update，但所有卡片都会 render，
// 所以「暂停」可以做成覆盖在游戏上的一层，而不会丢掉游戏状态。
//
// 生命周期：enter(params) -> update(dt)/render(ctx, alpha)
//           -> pause()/resume() -> exit()
// ============================================================

export class Scene {
  constructor(game) { this.game = game; }
  /** 进入场景，params 是 push/replace 传进来的参数 */
  enter(params) { void params; }
  /** 逻辑更新，dt 固定为 1/60 秒 */
  update(dt) { void dt; }
  /** 渲染，alpha 是固定步长之间的插值系数（0..1） */
  render(ctx, alpha) { void ctx; void alpha; }
  /** 离开场景（彻底销毁时） */
  exit() {}
  /** 被上层场景盖住时调用 */
  pause() {}
  /** 上层场景弹出后重新回到最前面时调用 */
  resume() {}
}

export class SceneManager {
  constructor(game) {
    this.game = game;
    this.stack = [];
    this.factories = new Map();
    this._ops = [];   // 延迟执行的操作（避免在遍历中修改数组）
  }

  /** 注册场景：factory 是一个返回场景实例的函数，例如 () => new MenuScene() */
  register(name, factory) {
    this.factories.set(name, factory);
    return this;
  }

  get top() { return this.stack[this.stack.length - 1] || null; }
  /** 倒数第二层（暂停场景用它拿到下面的游戏场景） */
  get below() { return this.stack[this.stack.length - 2] || null; }
  get depth() { return this.stack.length; }

  // ---------------- 对外 API（都是延迟执行的） ----------------
  push(name, params) { this._ops.push({ op: 'push', name, params }); }
  pop() { this._ops.push({ op: 'pop' }); }
  replace(name, params) { this._ops.push({ op: 'replace', name, params }); }
  /** 清空整个场景栈（回主菜单时用） */
  clear() { this._ops.push({ op: 'clear' }); }

  /** 立刻执行排队中的场景切换（启动时用，避免第一帧是黑屏） */
  flush() { this._flush(); }

  // ---------------- 每帧调用 ----------------
  update(dt) {
    const s = this.top;
    if (s) s.update(dt);
    this._flush();
  }

  render(ctx, alpha) {
    for (let i = 0; i < this.stack.length; i++) {
      this.stack[i].render(ctx, alpha);
    }
  }

  // ---------------- 具体执行 ----------------
  _create(name, params) {
    const f = this.factories.get(name);
    if (!f) throw new Error('未注册的场景: ' + name);
    const scene = f();
    scene.game = this.game;
    void params;
    return scene;
  }

  _flush() {
    if (this._ops.length === 0) return;
    const ops = this._ops;
    this._ops = [];
    for (const o of ops) {
      if (o.op === 'push') {
        const below = this.top;
        if (below) below.pause();
        const scene = this._create(o.name, o.params);
        this.stack.push(scene);
        scene.enter(o.params);
      } else if (o.op === 'pop') {
        const scene = this.stack.pop();
        if (scene) scene.exit();
        const below = this.top;
        if (below) below.resume();
      } else if (o.op === 'replace') {
        const scene = this.stack.pop();
        if (scene) scene.exit();
        const next = this._create(o.name, o.params);
        this.stack.push(next);
        next.enter(o.params);
      } else if (o.op === 'clear') {
        while (this.stack.length) {
          const scene = this.stack.pop();
          scene.exit();
        }
      }
    }
  }
}