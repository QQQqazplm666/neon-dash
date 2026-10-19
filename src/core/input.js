// ============================================================
// input.js —— 输入抽象层
// 把「触摸 / 鼠标 / 键盘」统一成这些动作：
//   jump    跳跃（也是确认）
//   confirm 确认
//   pause   暂停
//   up/down/left/right  菜单与商城的键盘导航
// 同时提供：是否按下、是否这一帧刚按下、按住多久、按下的坐标。
//
// 注意：上方向键（↑ / W）同时会触发 up 和 jump/confirm——
// 玩法里只关心 jump，菜单/商城里先处理 up 再把 confirm 消费掉，
// 这样「↑ 选上一项」和「↑ 跳跃」两套语义可以共存。
// ============================================================

const PREVENT_KEYS = ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'];

export class Input {
  constructor(engine) {
    this.engine = engine;
    this.actions = { jump: false, confirm: false, pause: false, up: false, down: false, left: false, right: false };
    this.pressed = new Set();     // 本帧刚按下（由 endFrame 清空）
    this.released = new Set();    // 本帧刚松开
    this.heldTime = { jump: 0, confirm: 0, pause: 0, up: 0, down: 0, left: 0, right: 0 };
    this.pressPoint = null;       // 最近一次按下时的设计坐标 {x, y}
    this.pointerDown = false;
    this.onFirstInput = null;     // 首次交互回调（用来解锁 AudioContext）
    this._firstDone = false;
    this._attached = false;
    this._bound = [];
  }

  // ---------------- 绑定事件 ----------------
  attach(target) {
    if (this._attached) return;
    this._attached = true;
    const t = target || document;

    const on = (el, type, fn, opts) => {
      el.addEventListener(type, fn, opts);
      this._bound.push([el, type, fn, opts]);
    };

    // ---- 触摸 ----
    on(t, 'touchstart', (e) => {
      e.preventDefault();                 // 阻止页面滚动 / 双击缩放
      const touch = e.changedTouches[0];
      if (!touch) return;
      this.pointerDown = true;
      this._press('jump', touch.clientX, touch.clientY);
      this._press('confirm', touch.clientX, touch.clientY);
    }, { passive: false });

    on(t, 'touchmove', (e) => { e.preventDefault(); }, { passive: false });
    on(document, 'touchend', (e) => {
      e.preventDefault();
      if (e.touches.length === 0) this.pointerDown = false;
      this._release('jump');
      this._release('confirm');
    }, { passive: false });
    on(document, 'touchcancel', () => {
      this.pointerDown = false;
      this._release('jump');
      this._release('confirm');
    });

    // ---- 鼠标 ----
    on(t, 'mousedown', (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      this.pointerDown = true;
      this._press('jump', e.clientX, e.clientY);
      this._press('confirm', e.clientX, e.clientY);
    });
    on(document, 'mouseup', () => {
      this.pointerDown = false;
      this._release('jump');
      this._release('confirm');
    });
    on(document, 'contextmenu', (e) => e.preventDefault());
    on(document, 'dblclick', (e) => e.preventDefault());
    // iOS 双指缩放
    on(document, 'gesturestart', (e) => e.preventDefault());

    // ---- 键盘 ----
    on(window, 'keydown', (e) => {
      if (e.repeat) { if (PREVENT_KEYS.indexOf(e.code) >= 0) e.preventDefault(); return; }
      const code = e.code;
      if (code === 'Space' || code === 'ArrowUp' || code === 'KeyW') {
        e.preventDefault();
        // ↑/W 同时也是「上」——菜单和商城会优先用它来选上一项
        if (code === 'ArrowUp' || code === 'KeyW') this._press('up');
        this._press('jump'); this._press('confirm');
      } else if (code === 'ArrowDown' || code === 'KeyS') {
        e.preventDefault();
        this._press('down');
      } else if (code === 'ArrowLeft' || code === 'KeyA') {
        e.preventDefault();
        this._press('left');
      } else if (code === 'ArrowRight' || code === 'KeyD') {
        e.preventDefault();
        this._press('right');
      } else if (code === 'Enter' || code === 'NumpadEnter') {
        e.preventDefault();
        this._press('confirm');
      } else if (code === 'Escape' || code === 'KeyP') {
        e.preventDefault();
        this._press('pause');
      }
    });
    on(window, 'keyup', (e) => {
      const code = e.code;
      if (code === 'Space' || code === 'ArrowUp' || code === 'KeyW') {
        if (code === 'ArrowUp' || code === 'KeyW') this._release('up');
        this._release('jump'); this._release('confirm');
      } else if (code === 'ArrowDown' || code === 'KeyS') {
        this._release('down');
      } else if (code === 'ArrowLeft' || code === 'KeyA') {
        this._release('left');
      } else if (code === 'ArrowRight' || code === 'KeyD') {
        this._release('right');
      } else if (code === 'Enter' || code === 'NumpadEnter') {
        this._release('confirm');
      } else if (code === 'Escape' || code === 'KeyP') {
        this._release('pause');
      }
    });
    on(window, 'blur', () => this.releaseAll());
  }

  detach() {
    for (const [el, type, fn, opts] of this._bound) el.removeEventListener(type, fn, opts);
    this._bound.length = 0;
    this._attached = false;
  }

  // ---------------- 内部状态修改 ----------------
  _press(action, clientX, clientY) {
    if (clientX !== undefined) {
      this.pressPoint = this.engine.toDesign(clientX, clientY);
    }
    if (!this.actions[action]) {
      this.pressed.add(action);
      this.heldTime[action] = 0;
    }
    this.actions[action] = true;
    if (!this._firstDone) {
      this._firstDone = true;
      if (this.onFirstInput) this.onFirstInput();
    }
  }

  _release(action) {
    if (!this.actions[action]) return;
    this.actions[action] = false;
    this.released.add(action);
  }

  releaseAll() {
    for (const k of Object.keys(this.actions)) {
      if (this.actions[k]) { this.actions[k] = false; this.released.add(k); }
    }
    this.pointerDown = false;
  }

  // ---------------- 查询接口 ----------------
  isDown(action) { return !!this.actions[action]; }
  justPressed(action) { return this.pressed.has(action); }
  justReleased(action) { return this.released.has(action); }
  /** 按住时长（秒） */
  held(action) { return this.heldTime[action] || 0; }

  /** 消费掉某个动作，后面的代码就不会再看到它（比如暂停按钮吃掉了这次点击） */
  consume(action) {
    this.pressed.delete(action);
    this.released.delete(action);
    this.actions[action] = false;
  }

  // ---------------- 每帧调用 ----------------
  /** 在场景 update 之前调用，累计按住时长 */
  update(dt) {
    for (const k of Object.keys(this.actions)) {
      if (this.actions[k]) this.heldTime[k] += dt;
    }
  }

  /** 在场景 update 之后调用，清掉“刚按下/刚松开”的标记 */
  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.pressPoint = null;
  }
}