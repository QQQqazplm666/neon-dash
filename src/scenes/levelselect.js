// ============================================================
// levelselect.js —— 关卡选择页（v1.2 闯关模式）
// 从主菜单 push 进来，列出 5 关：编号 / 名称 / 目标 / 最佳星级。
// 未解锁的关卡显示 🔒 并且点不动（只抖一下提示），解锁后显示最佳星级。
//
// 操作：
//   触摸 —— 点卡片直接进关，点底部「返回主菜单」回菜单
//   键盘 —— ↑↓ / ←→ 选择，回车 / 空格确认，Esc / P 返回
// ============================================================
import { Scene } from '../core/scenes.js';
import * as C from '../config.js';
import { clamp, makeStars, drawBackdrop, drawNeonButton, pointInRect, roundRect } from '../core/fx.js';
import { LEVELS, goalBadges, levelRunSeconds } from '../data/levels.js';

const CARD_W = 560;
const CARD_H = 124;
const CARD_GAP = 18;

export class LevelSelectScene extends Scene {
  enter() {
    this.t = 0;
    this.stars = makeStars(70, C.DESIGN_WIDTH, C.DESIGN_HEIGHT);
    this.shakeTimer = 0;        // 点了未解锁关卡时的提示动画
    this.tipTimer = 0;
    // 默认选中「第一个还没解锁的关卡」，也就是玩家的下一个目标
    const camp = this.game.save.data.campaign;
    this.sel = clamp(camp.unlocked - 1, 0, LEVELS.length - 1);
    this._layout();
  }

  /** 从关卡结算页返回时刷新星级/解锁状态 */
  resume() {
    const camp = this.game.save.data.campaign;
    this.sel = clamp(Math.max(this.sel, camp.unlocked - 1), 0, LEVELS.length - 1);
    this._layout();
  }

  _layout() {
    const safe = this.game.engine.safe;
    const y0 = safe.top + 282;
    this.cards = LEVELS.map((lv, i) => ({
      level: lv,
      index: i,
      rect: { x: (C.DESIGN_WIDTH - CARD_W) / 2, y: y0 + i * (CARD_H + CARD_GAP), w: CARD_W, h: CARD_H },
    }));
    this.backRect = { x: (C.DESIGN_WIDTH - 360) / 2, w: 360, h: 72 };
    this.backRect.y = y0 + LEVELS.length * (CARD_H + CARD_GAP) + 16;
    this.backLabel = '返回主菜单';
  }

  // ---------------- 交互 ----------------
  _locked(index) {
    return index + 1 > this.game.save.data.campaign.unlocked;
  }

  _enter(index) {
    const g = this.game;
    const lv = LEVELS[index];
    if (this._locked(index)) {
      // 未解锁：不静默失败，抖一下并给出提示
      g.audio.click();
      this.shakeTimer = 0.45;
      this.tipTimer = 2.2;
      return;
    }
    g.audio.click();
    // 进关用 replace：选关页不该留在栈里被重复渲染
    g.scenes.replace('play', { mode: 'level', levelId: lv.id });
  }

  _activateCard(hit) {
    this.sel = hit.index;
    this._enter(hit.index);
  }

  update(dt) {
    this.t += dt;
    if (this.shakeTimer > 0) this.shakeTimer = Math.max(0, this.shakeTimer - dt);
    if (this.tipTimer > 0) this.tipTimer = Math.max(0, this.tipTimer - dt);

    const input = this.game.input;
    const p = input.pressPoint;
    if (p) {
      input.consume('jump');
      input.consume('confirm');
      if (pointInRect(p, this.backRect)) {
        this.game.audio.click();
        this.game.scenes.pop();
        return;
      }
      for (const c of this.cards) {
        if (pointInRect(p, c.rect)) { this._activateCard(c); return; }
      }
      return;
    }

    // 键盘方向键：上/下逐关移动，左/右翻页式移动（一次 2 关）
    let moved = false;
    if (input.justPressed('up')) { this.sel = clamp(this.sel - 1, 0, LEVELS.length - 1); moved = true; }
    if (input.justPressed('down')) { this.sel = clamp(this.sel + 1, 0, LEVELS.length - 1); moved = true; }
    if (input.justPressed('left')) { this.sel = clamp(this.sel - 2, 0, LEVELS.length - 1); moved = true; }
    if (input.justPressed('right')) { this.sel = clamp(this.sel + 2, 0, LEVELS.length - 1); moved = true; }
    if (moved) {
      // ↑/W 会同时触发 jump/confirm，必须吃掉，否则选择时会顺手进关
      input.consume('jump');
      input.consume('confirm');
      this.game.audio.click();
      return;
    }

    // Esc / P：返回主菜单
    if (input.justPressed('pause')) {
      input.consume('pause');
      this.game.audio.click();
      this.game.scenes.pop();
      return;
    }

    // 回车 / 空格：进入选中的关卡
    if (input.justPressed('confirm')) {
      input.consume('confirm');
      input.consume('jump');
      this._enter(this.sel);
    }
  }

  // ---------------- 渲染 ----------------
  _starsText(n) {
    let s = '';
    for (let i = 0; i < 3; i++) s += i < n ? '★' : '☆';
    return s;
  }

  _drawCard(ctx, card) {
    const { level: lv, index, rect } = card;
    const camp = this.game.save.data.campaign;
    const locked = this._locked(index);
    const unlocked = !locked;
    const bestStars = Math.max(0, Math.min(3, Number(camp.stars[lv.id]) || 0));
    const selected = index === this.sel;

    // 选中且点到未解锁关卡时的横向抖动
    let dx = 0;
    if (selected && this.shakeTimer > 0) {
      dx = Math.sin(this.t * 60) * 10 * (this.shakeTimer / 0.45);
    }

    ctx.save();
    ctx.translate(dx, 0);

    // 卡片底：未解锁压暗，选中加霓虹描边
    const color = locked ? '#3a2a55' : C.COLORS.neonCyan;
    ctx.save();
    ctx.globalAlpha = locked ? 0.55 : 1;
    roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 20);
    ctx.fillStyle = 'rgba(8,6,26,0.78)';
    ctx.fill();
    ctx.lineWidth = selected ? 3 : 2;
    ctx.strokeStyle = locked ? 'rgba(150,140,180,0.5)' : color;
    if (selected && !locked) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 22;
    }
    ctx.stroke();
    ctx.restore();

    // 左侧编号牌
    const badge = { x: rect.x + 18, y: rect.y + (rect.h - 84) / 2, w: 84, h: 84 };
    ctx.save();
    ctx.globalAlpha = locked ? 0.5 : 1;
    roundRect(ctx, badge.x, badge.y, badge.w, badge.h, 16);
    ctx.fillStyle = locked ? 'rgba(70,60,100,0.6)' : 'rgba(0,240,255,0.14)';
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 42px "Microsoft YaHei", system-ui, sans-serif';
    ctx.fillStyle = locked ? 'rgba(255,255,255,0.5)' : C.COLORS.white;
    ctx.fillText(String(index + 1), badge.x + badge.w / 2, badge.y + badge.h / 2 + 2);
    ctx.restore();

    // 名称 + 主题
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '800 34px "Microsoft YaHei", system-ui, sans-serif';
    ctx.fillStyle = locked ? 'rgba(255,255,255,0.45)' : C.COLORS.white;
    ctx.fillText(locked ? '未解锁' : lv.name, rect.x + 122, rect.y + 42);

    ctx.font = '500 21px "Microsoft YaHei", system-ui, sans-serif';
    ctx.fillStyle = locked ? 'rgba(255,255,255,0.32)' : 'rgba(255,255,255,0.55)';
    ctx.fillText(locked ? '先通关上一关' : lv.theme, rect.x + 122, rect.y + 78);

    if (!locked) {
      ctx.font = '600 20px "Microsoft YaHei", system-ui, sans-serif';
      ctx.fillStyle = 'rgba(180,255,220,0.75)';
      const badges = goalBadges(lv).map((b) => b.text).join('　');
      ctx.fillText(badges, rect.x + 122, rect.y + 106);
    }
    ctx.restore();

    // 右侧：锁 / 星级 / 纯跑时长
    ctx.save();
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    if (locked) {
      ctx.font = '48px "Microsoft YaHei", system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fillText('🔒', rect.x + rect.w - 26, rect.y + rect.h / 2);
    } else {
      ctx.font = '700 34px "Microsoft YaHei", system-ui, sans-serif';
      ctx.shadowColor = C.COLORS.neonYellow;
      ctx.shadowBlur = bestStars > 0 ? 14 : 0;
      ctx.fillStyle = bestStars > 0 ? C.COLORS.neonYellow : 'rgba(255,255,255,0.25)';
      ctx.fillText(this._starsText(bestStars), rect.x + rect.w - 26, rect.y + 44);
      ctx.shadowBlur = 0;
      ctx.font = '500 20px "Microsoft YaHei", system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      const sec = levelRunSeconds(lv);
      ctx.fillText('约 ' + sec.toFixed(1) + 's　·　目标 ' + lv.goal.distance, rect.x + rect.w - 26, rect.y + 84);
    }
    ctx.restore();

    ctx.restore();
  }

  render(ctx) {
    const W = C.DESIGN_WIDTH;
    const H = C.DESIGN_HEIGHT;
    const safe = this.game.engine.safe;
    const camp = this.game.save.data.campaign;

    drawBackdrop(ctx, this.stars, this.t, this.t * 120, 0.5, W, H);

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // 标题
    ctx.font = '900 70px "Microsoft YaHei", system-ui, sans-serif';
    ctx.shadowColor = C.COLORS.neonPink;
    ctx.shadowBlur = 26;
    ctx.fillStyle = C.COLORS.white;
    ctx.fillText('闯关模式', W / 2, safe.top + 96);
    ctx.shadowBlur = 0;

    ctx.font = '600 26px "Microsoft YaHei", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText('已通关 ' + camp.cleared + ' / ' + LEVELS.length + ' 关　·　金币 ' + this.game.save.wallet,
      W / 2, safe.top + 158);

    // 未解锁提示
    ctx.font = '600 24px "Microsoft YaHei", system-ui, sans-serif';
    ctx.globalAlpha = this.tipTimer > 0 ? Math.min(1, this.tipTimer) : 0;
    ctx.fillStyle = C.COLORS.neonPink;
    ctx.fillText('这一关还没解锁，先通关上一关吧', W / 2, safe.top + 206);
    ctx.globalAlpha = 1;
    ctx.restore();

    // 关卡卡片
    for (const c of this.cards) this._drawCard(ctx, c);

    // 返回按钮
    drawNeonButton(ctx, this.backRect, this.backLabel, {
      color: C.COLORS.neonPurple, active: false, fontSize: 30,
    });

    // 底部操作说明
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const infoY = Math.min(H - safe.bottom - 40, this.backRect.y + this.backRect.h + 52);
    ctx.font = '500 22px "Microsoft YaHei", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.42)';
    ctx.fillText('↑↓ / ←→ 选择　·　回车进入　·　Esc 返回', W / 2, infoY);
    ctx.restore();
  }
}