// ============================================================
// pause.js —— 暂停覆盖层
// 它被 push 到游戏场景之上：游戏场景不会 update，但会继续 render，
// 所以背景是“停住的游戏画面”，而游戏状态一点都没丢。
// ============================================================
import { Scene } from '../core/scenes.js';
import * as C from '../config.js';
import { drawNeonButton, pointInRect } from '../core/fx.js';

export class PauseScene extends Scene {
  enter(params = {}) {
    this.play = params.play || null;   // 下层正在暂停的游戏场景
    this.t = 0;
    this.buttons = [
      { id: 'resume', label: '继续游戏', color: C.COLORS.neonCyan, active: true },
      { id: 'restart', label: '重新开始', color: C.COLORS.neonPurple },
      { id: 'menu', label: '回到主菜单', color: C.COLORS.neonPink },
    ];
    this._layout();
  }

  _layout() {
    const W = C.DESIGN_WIDTH;
    const bw = 420;
    const bh = 92;
    const gap = 24;
    const total = this.buttons.length * bh + (this.buttons.length - 1) * gap;
    let y = (C.DESIGN_HEIGHT - total) / 2 + 60;
    for (const b of this.buttons) {
      b.rect = { x: (W - bw) / 2, y, w: bw, h: bh };
      y += bh + gap;
    }
  }

  _activate(id) {
    const g = this.game;
    g.audio.click();
    if (id === 'resume') {
      g.scenes.pop();
    } else if (id === 'restart') {
      // 先把暂停层弹掉，再把游戏层换成全新的。
      // 【v1.2 修复】这里原来是 replace('play') 不带参数，闯关模式下按「重新开始」
      // 会被当成无尽模式重开。现在向正在暂停的那个游戏场景问一句重开参数：
      // 无尽 → undefined（行为与旧版逐字节一致）；闯关 → { mode:'level', levelId }。
      g.scenes.pop();
      const replay = this.play && this.play.replayParams ? this.play.replayParams() : undefined;
      g.scenes.replace('play', replay);
    } else if (id === 'menu') {
      // 回菜单前存一份快照，菜单上就能出现「继续游戏」
      if (this.play && this.play.snapshot) g.save.saveResume(this.play.snapshot());
      g.scenes.clear();
      g.scenes.push('menu');
    }
  }

  update(dt) {
    this.t += dt;
    const input = this.game.input;

    const p = input.pressPoint;
    if (p) {
      let hit = null;
      for (const b of this.buttons) {
        if (pointInRect(p, b.rect)) { hit = b; break; }
      }
      // 吃掉这次点击，别让它穿透到下面的游戏
      input.consume('jump');
      input.consume('confirm');
      if (hit) this._activate(hit.id);
      return;
    }

    // 键盘：Esc / P 直接继续，空格也继续
    if (input.justPressed('pause') || input.justPressed('confirm')) {
      input.consume('pause');
      input.consume('confirm');
      this._activate('resume');
    }
  }

  render(ctx) {
    const W = C.DESIGN_WIDTH;
    const H = C.DESIGN_HEIGHT;

    // 半透明遮罩
    ctx.save();
    ctx.fillStyle = 'rgba(5,3,15,0.72)';
    ctx.fillRect(0, 0, W, H);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 64px "Microsoft YaHei", system-ui, sans-serif';
    ctx.shadowColor = C.COLORS.neonCyan;
    ctx.shadowBlur = 24;
    ctx.fillStyle = C.COLORS.white;
    ctx.fillText('已暂停', W / 2, 470);
    ctx.shadowBlur = 0;

    // 顺便展示一下当前成绩
    if (this.play) {
      ctx.font = '700 30px "Microsoft YaHei", system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillText('当前分数 ' + this.play.score, W / 2, 540);
    }
    ctx.restore();

    for (const b of this.buttons) {
      drawNeonButton(ctx, b.rect, b.label, { color: b.color, active: b.active, fontSize: 36 });
    }
  }
}