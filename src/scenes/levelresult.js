// ============================================================
// levelresult.js —— 关卡结算页（v1.2 闯关模式）
// 显示本关的目标清单（逐条打勾/打叉）、星级、用时、分数与金币，
// 并给出「重试 / 下一关 / 选择关卡 / 回到主菜单」四个出口。
//
// 注意：闯关的金币会照常进钱包，但闯关分数【不写】全局最高分，
// 只记在 campaign.bestScore[levelId]（这样无尽模式的最高分不会被污染）。
// ============================================================
import { Scene } from '../core/scenes.js';
import * as C from '../config.js';
import { clamp, makeStars, drawBackdrop, drawNeonButton, pointInRect, roundRect } from '../core/fx.js';
import { LEVELS, getLevel } from '../data/levels.js';

const BTN_W = 300;
const BTN_H = 76;
const BTN_GAP_X = 20;
const BTN_GAP_Y = 16;

export class LevelResultScene extends Scene {
  enter(params = {}) {
    this.levelId = params.levelId || LEVELS[0].id;
    this.level = getLevel(this.levelId);
    this.passed = !!params.passed;
    this.stars = clamp(Math.floor(Number(params.stars) || 0), 0, 3);
    this.distance = Number(params.distance) || 0;
    this.length = Number(params.length) || this.level.length;
    this.coins = Number(params.coins) || 0;
    this.hits = Number(params.hits) || 0;
    this.elapsed = Number(params.elapsed) || 0;
    this.timePenalty = Number(params.timePenalty) || 0;
    this.score = Number(params.score) || 0;
    this.wallet = params.wallet !== undefined ? params.wallet : this.game.save.wallet;
    this.unlocked = params.unlocked !== undefined
      ? params.unlocked : this.game.save.data.campaign.unlocked;
    this.checks = Array.isArray(params.checks) ? params.checks : [];

    this.t = 0;
    this.countUp = 0;
    this.bgStars = makeStars(60, C.DESIGN_WIDTH, C.DESIGN_HEIGHT);
    this.buttons = this._buildButtons();
    this.sel = 0;
    this._layout();
  }

  get levelIndex() { return Math.max(0, LEVELS.findIndex((l) => l.id === this.levelId)); }

  /** 下一关：只有「已通关 + 存在下一关 + 下一关确实解锁了」才给按钮 */
  get nextLevel() {
    const i = this.levelIndex;
    if (!this.passed || i < 0 || i + 1 >= LEVELS.length) return null;
    if (this.unlocked < i + 2) return null;
    return LEVELS[i + 1];
  }

  _buildButtons() {
    const list = [{ id: 'retry', label: '重试本关', color: C.COLORS.neonCyan }];
    if (this.nextLevel) list.push({ id: 'next', label: '下一关', color: C.COLORS.neonGreen });
    list.push({ id: 'select', label: '选择关卡', color: C.COLORS.neonYellow });
    list.push({ id: 'menu', label: '回到主菜单', color: C.COLORS.neonPurple });
    return list;
  }

  _layout() {
    const W = C.DESIGN_WIDTH;
    const y0 = 900;
    for (let i = 0; i < this.buttons.length; i++) {
      const row = Math.floor(i / 2);
      const col = i % 2;
      this.buttons[i].rect = {
        x: (W - (BTN_W * 2 + BTN_GAP_X)) / 2 + col * (BTN_W + BTN_GAP_X),
        y: y0 + row * (BTN_H + BTN_GAP_Y),
        w: BTN_W,
        h: BTN_H,
      };
    }
  }

  _activate(id) {
    const g = this.game;
    g.audio.click();
    if (id === 'retry') {
      // 按当前关卡重建玩法场景（这正是 pause.js 那个 bug 的同款修法）
      g.scenes.replace('play', { mode: 'level', levelId: this.levelId });
    } else if (id === 'next') {
      const nxt = this.nextLevel;
      if (nxt) g.scenes.replace('play', { mode: 'level', levelId: nxt.id });
    } else if (id === 'select') {
      g.scenes.replace('levelselect');
    } else {
      g.scenes.clear();
      g.scenes.push('menu');
    }
  }

  update(dt) {
    this.t += dt;
    this.countUp = Math.min(1, this.countUp + dt * 1.4);
    const input = this.game.input;

    const p = input.pressPoint;
    if (p) {
      input.consume('jump');
      input.consume('confirm');
      for (const b of this.buttons) {
        if (pointInRect(p, b.rect)) { this.sel = this.buttons.indexOf(b); this._activate(b.id); return; }
      }
      return;
    }

    let moved = false;
    if (input.justPressed('up') || input.justPressed('left')) { this.sel = clamp(this.sel - 1, 0, this.buttons.length - 1); moved = true; }
    if (input.justPressed('down') || input.justPressed('right')) { this.sel = clamp(this.sel + 1, 0, this.buttons.length - 1); moved = true; }
    if (moved) {
      input.consume('jump');
      input.consume('confirm');
      this.game.audio.click();
      return;
    }

    // Esc / P 当作「选择关卡」
    if (input.justPressed('pause')) {
      input.consume('pause');
      this._activate('select');
      return;
    }

    if (input.justPressed('confirm')) {
      input.consume('confirm');
      input.consume('jump');
      const b = this.buttons[this.sel];
      if (b) this._activate(b.id);
    }
  }

  // ---------------- 渲染 ----------------
  /** 星级图标：逐颗弹出 + 轻微上下浮动 */
  _renderStars(ctx, cx, cy) {
    const size = 84;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 ' + size + 'px "Microsoft YaHei", system-ui, sans-serif';
    for (let i = 0; i < 3; i++) {
      const appear = clamp((this.t - 0.18 - i * 0.22) / 0.28, 0, 1);
      const earned = i < this.stars;
      const pop = appear * appear * (3 - 2 * appear);          // 平滑收尾
      const scale = 0.4 + 0.6 * pop;
      const x = cx + (i - 1) * (size + 8);
      const y = cy + (earned ? Math.sin(this.t * 2 + i) * 4 * pop : 0);
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(scale, scale);
      ctx.globalAlpha = appear * (earned ? 1 : 0.32);
      ctx.shadowColor = C.COLORS.neonYellow;
      ctx.shadowBlur = earned ? 26 : 0;
      ctx.fillStyle = earned ? C.COLORS.neonYellow : 'rgba(255,255,255,0.5)';
      ctx.fillText(earned ? '★' : '☆', 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }

  _renderChecks(ctx, x, y) {
    const lineH = 46;
    ctx.save();
    ctx.textBaseline = 'middle';
    for (let i = 0; i < this.checks.length; i++) {
      const c = this.checks[i];
      const yy = y + i * lineH;
      ctx.textAlign = 'left';
      ctx.font = '900 28px "Microsoft YaHei", system-ui, sans-serif';
      ctx.fillStyle = c.ok ? C.COLORS.neonGreen : C.COLORS.neonPink;
      ctx.fillText(c.ok ? '✓' : '✗', x, yy);
      ctx.font = '600 26px "Microsoft YaHei", system-ui, sans-serif';
      ctx.fillStyle = c.ok ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.5)';
      ctx.fillText(c.label, x + 40, yy);
      ctx.textAlign = 'right';
      ctx.font = '600 24px "Microsoft YaHei", system-ui, sans-serif';
      ctx.fillStyle = c.ok ? 'rgba(180,255,220,0.85)' : 'rgba(255,255,255,0.4)';
      ctx.fillText(String(c.value), x + 500, yy);
    }
    ctx.restore();
  }

  render(ctx) {
    const W = C.DESIGN_WIDTH;
    const H = C.DESIGN_HEIGHT;
    const safe = this.game.engine.safe;
    const pal = this.level.paletteIndex / (C.BG_PALETTES.length - 1);

    drawBackdrop(ctx, this.bgStars, this.t, this.t * 110, pal, W, H);

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // 标题
    ctx.font = '900 66px "Microsoft YaHei", system-ui, sans-serif';
    ctx.shadowColor = this.passed ? C.COLORS.neonGreen : C.COLORS.neonPink;
    ctx.shadowBlur = 26;
    ctx.fillStyle = C.COLORS.white;
    ctx.fillText(this.passed ? '关卡完成' : '挑战失败', W / 2, safe.top + 84);
    ctx.shadowBlur = 0;

    ctx.font = '700 28px "Microsoft YaHei", system-ui, sans-serif';
    ctx.fillStyle = C.COLORS.neonCyan;
    ctx.fillText(this.level.id + '　' + this.level.name, W / 2, safe.top + 140);

    // 星级
    this._renderStars(ctx, W / 2, safe.top + 250);

    // 分数 + 关键数据
    ctx.font = '800 52px "Microsoft YaHei", system-ui, sans-serif';
    ctx.fillStyle = C.COLORS.white;
    ctx.fillText(String(Math.floor(this.score * this.countUp)), W / 2, safe.top + 342);

    ctx.font = '600 24px "Microsoft YaHei", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    const totalTime = this.elapsed + this.timePenalty;
    let stat = '用时 ' + totalTime.toFixed(1) + 's';
    if (this.timePenalty > 0) stat += '（含罚时 ' + this.timePenalty.toFixed(1) + 's）';
    stat += '　·　金币 +' + this.coins + '　·　撞击 ' + this.hits;
    ctx.fillText(stat, W / 2, safe.top + 396);
    ctx.restore();

    // 目标清单
    const boxX = (W - 560) / 2;
    const boxY = safe.top + 436;
    ctx.save();
    roundRect(ctx, boxX - 24, boxY - 34, 560 + 48, Math.max(1, this.checks.length) * 46 + 52, 18);
    ctx.fillStyle = 'rgba(8,6,26,0.62)';
    ctx.fill();
    ctx.restore();
    this._renderChecks(ctx, boxX, boxY + 6);

    // 钱包 + 最高分口径说明
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '600 24px "Microsoft YaHei", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,240,160,0.9)';
    ctx.fillText('金币已存入钱包：' + this.wallet + '　·　闯关分数不计入无尽最高分',
      W / 2, boxY + Math.max(1, this.checks.length) * 46 + 60);

    if (this.passed && !this.nextLevel) {
      ctx.font = '700 26px "Microsoft YaHei", system-ui, sans-serif';
      ctx.fillStyle = C.COLORS.neonGreen;
      ctx.fillText('已经通关全部 ' + LEVELS.length + ' 关，恭喜！', W / 2, boxY + Math.max(1, this.checks.length) * 46 + 100);
    }
    ctx.restore();

    // 按钮
    for (let i = 0; i < this.buttons.length; i++) {
      const b = this.buttons[i];
      drawNeonButton(ctx, b.rect, b.label, {
        color: b.color, active: i === this.sel, fontSize: 30,
      });
    }

    // 底部提示
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const last = this.buttons[this.buttons.length - 1].rect;
    ctx.font = '500 22px "Microsoft YaHei", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillText('↑↓ / ←→ 选择　·　回车确认　·　Esc 选关', W / 2,
      Math.min(H - safe.bottom - 28, last.y + last.h + 56));
    ctx.restore();
  }
}