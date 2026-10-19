// ============================================================
// boot.js —— 启动场景
// 读存档、准备音频、等资源加载完，然后跳到主菜单。
// ============================================================
import { Scene } from '../core/scenes.js';
import * as C from '../config.js';
import { clamp, roundRect, drawBackdrop, makeStars } from '../core/fx.js';

export class BootScene extends Scene {
  enter() {
    this.progress = 0;
    this.text = '准备中…';
    this.timer = 0;
    this.ready = false;
    this.done = false;
    this.stars = makeStars(70, C.DESIGN_WIDTH, C.DESIGN_HEIGHT);

    // 静态的 loading 提示由 HTML 提供，引擎跑起来后就可以移除
    const el = document.getElementById('loading');
    if (el && el.parentNode) el.parentNode.removeChild(el);

    this.game.assets.load((p, t) => {
      this.progress = clamp(p, 0, 1);
      this.text = t || '';
    }).then(() => {
      this.ready = true;
      // 背景音乐不在这里启动：它只在玩法里响（进玩法淡入、回菜单淡出）
    }).catch((err) => {
      // 资源加载失败也不能卡死在启动页
      console.warn('[boot] 资源加载出错：', err);
      this.ready = true;
    });
  }

  update(dt) {
    this.timer += dt;
    // 至少停留 0.45 秒，否则进度条一闪而过很突兀
    if (this.ready && this.timer > 0.45 && !this.done) {
      this.done = true;
      this.game.scenes.replace('menu');
    }
  }

  render(ctx) {
    const W = C.DESIGN_WIDTH;
    const H = C.DESIGN_HEIGHT;
    drawBackdrop(ctx, this.stars, this.timer, this.timer * 40, 0.1, W, H);

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // 标题
    ctx.font = '900 92px "Microsoft YaHei", system-ui, sans-serif';
    ctx.shadowColor = C.COLORS.neonPink;
    ctx.shadowBlur = 30;
    ctx.fillStyle = C.COLORS.white;
    ctx.fillText(C.GAME_NAME, W / 2, H * 0.4);
    ctx.shadowBlur = 0;

    ctx.font = '700 34px "Microsoft YaHei", system-ui, sans-serif';
    ctx.fillStyle = C.COLORS.neonCyan;
    ctx.fillText(C.GAME_NAME_EN, W / 2, H * 0.4 + 70);

    // 进度条
    const bw = 420;
    const bx = (W - bw) / 2;
    const by = H * 0.62;
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    roundRect(ctx, bx, by, bw, 14, 7);
    ctx.fill();

    ctx.shadowColor = C.COLORS.neonCyan;
    ctx.shadowBlur = 18;
    ctx.fillStyle = C.COLORS.neonCyan;
    roundRect(ctx, bx, by, Math.max(10, bw * this.progress), 14, 7);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.font = '600 26px "Microsoft YaHei", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText(this.text + '  ' + Math.floor(this.progress * 100) + '%', W / 2, by + 52);

    ctx.restore();
  }
}