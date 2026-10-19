// ============================================================
// gameover.js —— 结算界面
// 显示本局分数 / 最高分 / 新纪录提示 / 本局金币与钱包余额，
// 可以再来一局、去商城花掉刚赚的金币、或者回主菜单。
//
// 【v1.1 改动】
//   1) 新增「本局金币 +X　·　钱包 Y」一行，金币的去向一目了然。
//   2) 新增「皮肤商城」按钮（刚赚到金币就能顺手花），键盘 ↑/↓ 也能选中。
//   3) 钱包余额在渲染时实时从存档读取，从商城买完回来不会显示旧数字。
// ============================================================
import { Scene } from '../core/scenes.js';
import * as C from '../config.js';
import { drawNeonButton, pointInRect, makeStars, drawBackdrop, clamp } from '../core/fx.js';

export class GameOverScene extends Scene {
  enter(params = {}) {
    this.score = Math.floor(params.score || 0);
    this.best = Math.floor(params.best || 0);
    this.isRecord = !!params.isRecord;
    this.distance = Math.floor(params.distance || 0);
    this.coins = Math.floor(params.coins || 0);
    // 本局实际进钱包的金币（正常情况下就等于本局金币数）
    this.earned = Math.floor(params.earned === undefined ? this.coins : params.earned);

    this.t = 0;
    this.countUp = 0;          // 分数滚动动画
    this.stars = makeStars(70, C.DESIGN_WIDTH, C.DESIGN_HEIGHT);

    this.buttons = [
      { id: 'retry', label: '再来一局', color: C.COLORS.neonCyan, active: true },
      { id: 'shop', label: '皮肤商城', color: C.COLORS.neonYellow },
      { id: 'menu', label: '回到主菜单', color: C.COLORS.neonPurple },
    ];
    this.sel = 0;              // 键盘选中的按钮（默认「再来一局」，和回车的老手感一致）
    this._layout();
    // 结算界面不放背景音乐
    if (this.game.audio) this.game.audio.fadeOutMusic(0.3);
  }

  /** 从商城返回时钱包会变，重排一下（数字本身是在 render 里实时读的） */
  resume() {
    this._layout();
  }

  _layout() {
    const W = C.DESIGN_WIDTH;
    const bw = 420;
    const bh = 84;
    const gap = 20;
    let y = 806;
    for (const b of this.buttons) {
      b.rect = { x: (W - bw) / 2, y, w: bw, h: bh };
      y += bh + gap;
    }
  }

  _activate(id) {
    const g = this.game;
    g.audio.click();
    if (id === 'retry') g.scenes.replace('play');
    else if (id === 'shop') g.scenes.push('shop');   // 压栈：返回时还在结算界面
    else {
      g.save.saveResume(null);
      g.scenes.clear();
      g.scenes.push('menu');
    }
  }

  update(dt) {
    this.t += dt;
    // 分数从 0 滚到最终分，有点仪式感
    this.countUp = Math.min(this.score, this.countUp + Math.max(1, this.score * dt * 2.2));

    const input = this.game.input;
    const p = input.pressPoint;
    if (p) {
      let hit = null;
      for (const b of this.buttons) {
        if (pointInRect(p, b.rect)) { hit = b; break; }
      }
      input.consume('jump');
      input.consume('confirm');
      if (hit) { this.sel = this.buttons.indexOf(hit); this._activate(hit.id); }
      return;
    }

    // ↑/↓（或 ←/→）选择按钮，回车确认
    let moved = false;
    if (input.justPressed('up') || input.justPressed('left')) { this.sel = clamp(this.sel - 1, 0, this.buttons.length - 1); moved = true; }
    if (input.justPressed('down') || input.justPressed('right')) { this.sel = clamp(this.sel + 1, 0, this.buttons.length - 1); moved = true; }
    if (moved) {
      input.consume('jump');
      input.consume('confirm');
      this.game.audio.click();
      return;
    }

    if (input.justPressed('confirm')) {
      input.consume('confirm');
      input.consume('jump');
      this._activate(this.buttons[this.sel].id);
    }
  }

  render(ctx) {
    const W = C.DESIGN_WIDTH;
    const H = C.DESIGN_HEIGHT;

    drawBackdrop(ctx, this.stars, this.t, this.t * 70, 0.15, W, H);
    ctx.fillStyle = 'rgba(5,3,15,0.55)';
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // 标题
    const isRec = this.isRecord;
    ctx.font = '900 76px "Microsoft YaHei", system-ui, sans-serif';
    ctx.shadowColor = isRec ? C.COLORS.neonYellow : C.COLORS.neonPink;
    ctx.shadowBlur = 26;
    ctx.fillStyle = C.COLORS.white;
    ctx.fillText(isRec ? '新纪录！' : '游戏结束', W / 2, 296);
    ctx.shadowBlur = 0;

    // 本局分数（滚动）
    ctx.font = '900 130px "Microsoft YaHei", system-ui, sans-serif';
    ctx.shadowColor = C.COLORS.neonCyan;
    ctx.shadowBlur = 30;
    ctx.fillStyle = C.COLORS.white;
    ctx.fillText(String(Math.floor(this.countUp)), W / 2, 448);
    ctx.shadowBlur = 0;
    ctx.font = '600 26px "Microsoft YaHei", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText('本局得分', W / 2, 522);

    // 明细
    ctx.font = '600 30px "Microsoft YaHei", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText('距离 ' + this.distance + ' m', W / 2, 578);

    // —— 金币收益：本局金币 +X / 钱包 Y（钱包实时读存档） ——
    const wallet = this.game.save.wallet;
    ctx.font = '700 30px "Microsoft YaHei", system-ui, sans-serif';
    ctx.shadowColor = C.COLORS.neonYellow;
    ctx.shadowBlur = 14;
    ctx.fillStyle = C.COLORS.neonYellow;
    ctx.fillText('本局金币 +' + this.earned + '　·　钱包 ' + wallet, W / 2, 632);
    ctx.shadowBlur = 0;

    ctx.font = '700 34px "Microsoft YaHei", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillText('最高分  ' + this.best, W / 2, 700);

    if (isRec) {
      ctx.font = '700 26px "Microsoft YaHei", system-ui, sans-serif';
      ctx.fillStyle = C.COLORS.neonGreen;
      const pulse = 0.6 + 0.4 * Math.sin(this.t * 5);
      ctx.globalAlpha = pulse;
      ctx.fillText('★ 打破了之前的记录 ★', W / 2, 748);
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    for (let i = 0; i < this.buttons.length; i++) {
      const b = this.buttons[i];
      drawNeonButton(ctx, b.rect, b.label, {
        color: b.color,
        active: b.active || i === this.sel,
        fontSize: 34,
      });
    }

    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = '500 22px "Microsoft YaHei", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillText('空格 / 点击按钮 继续　·　↑↓ 选择', W / 2, clamp(H - 110, 0, H));
    ctx.restore();
  }
}