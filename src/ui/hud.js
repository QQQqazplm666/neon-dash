// ============================================================
// hud.js —— 抬头显示
// 左上角：分数 / 距离 / 金币 / 速度条 / 钱包余额；右上角：可点击的暂停按钮。
// 右上角的位置会避开刘海屏安全区（engine.safe）。
//
// 【v1.1 改动】
//   1) 分数变化时有「跳动」反馈（放大 + 发光增强）。
//   2) 吃到金币时金币数旁边弹出 +1 并让金币图标弹一下。
//   3) 显示钱包余额（本局金币会实时叠加进去，玩家能立刻看到收益）。
//   4) 速度条的量程从 config 的 MAX_SPEED 读，不再硬编码 980。
//   条目的动画时间用传入的 time 自减，HUD 不需要额外的 update 调用。
//
// 【v1.2 改动】
//   闯关模式多一条「目标行」（关卡名 + 目标进度 + 进度条）和右侧的「容错小圆点」。
//   无尽模式不传 state.goal，整段代码不执行，外观与 v1.1 逐像素一致。
// ============================================================
import { DESIGN_WIDTH, COLORS, MAX_SPEED, COIN_SCORE } from '../config.js';
import { roundRect, pointInRect } from '../core/fx.js';

export class HUD {
  constructor() {
    this.pauseRect = { x: 0, y: 0, w: 88, h: 88 };
    this.scorePop = 0;      // 分数跳动（1 → 0 衰减）
    this.coinPop = 0;       // 金币反馈
    this.coinDelta = 0;     // 最近一次吃到金币的数量
    this._lastScore = 0;
    this._lastCoins = 0;
    this._t = 0;
    this.layout();
  }

  /** 根据屏幕安全区重新摆放暂停按钮（在 enter 和窗口 resize 时调用） */
  layout(engine) {
    const safe = (engine && engine.safe) || { top: 0, right: 0 };
    const size = 88;
    const margin = 26;
    const w = (engine && engine.designWidth) || DESIGN_WIDTH;
    this.pauseRect = {
      x: w - safe.right - margin - size,
      y: safe.top + margin,
      w: size,
      h: size,
    };
    return this.pauseRect;
  }

  /** 判断一次按下是否落在暂停按钮上 */
  hitPause(p) { return pointInRect(p, this.pauseRect); }

  /** 新的一局开始时清掉上一局的残留动画状态 */
  reset() {
    this.scorePop = 0;
    this.coinPop = 0;
    this.coinDelta = 0;
    this._lastScore = 0;
    this._lastCoins = 0;
    this._t = 0;
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {{score:number,distance:number,coins:number,wallet?:number,speed:number,hint?:number,
   *          goal?:{label:string,progress:number,ok:boolean,danger:boolean}|null,
   *          shields?:number|null,shieldsMax?:number|null,levelName?:string}} state
   * @param {import('../core/engine.js').Engine} engine
   * @param {number} time 累计时间（同时用来推动 HUD 自己的动画）
   * @param {boolean} showPause 死亡后就不画暂停按钮了
   */
  render(ctx, state, engine, time = 0, showPause = true) {
    const safe = (engine && engine.safe) || { top: 0, left: 0 };
    const left = safe.left + 30;
    const top = safe.top + 34;

    // —— 用时间差推进动画（不依赖外部调用 update） ——
    const dt = Math.max(0, Math.min(0.1, time - this._t));
    this._t = time;
    this.scorePop = Math.max(0, this.scorePop - dt * 3.2);
    this.coinPop = Math.max(0, this.coinPop - dt * 1.8);

    if (state.score !== this._lastScore) {
      if (state.score > this._lastScore) this.scorePop = 1;
      this._lastScore = state.score;
    }
    if (state.coins !== this._lastCoins) {
      const add = state.coins - this._lastCoins;
      if (add > 0) {
        this.coinPop = 1;
        this.coinDelta += add;
      }
      this._lastCoins = state.coins;
    }

    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    // —— 分数（跳动时整个数字放大一点，带一点弹性的收尾） ——
    const pop = this.scorePop;
    const scale = 1 + 0.16 * pop * pop;
    ctx.save();
    ctx.translate(left, top);
    ctx.scale(scale, scale);
    ctx.font = '800 64px "Microsoft YaHei", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillText(String(state.score), 3, 3);
    ctx.shadowColor = COLORS.neonCyan;
    ctx.shadowBlur = 16 + 22 * pop;
    ctx.fillStyle = COLORS.white;
    ctx.fillText(String(state.score), 0, 0);
    ctx.restore();
    ctx.shadowBlur = 0;

    // —— 距离 ——
    ctx.font = '600 26px "Microsoft YaHei", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText('距离 ' + Math.floor(state.distance) + ' m', left, top + 74);

    // —— 金币（吃到时图标弹一下，右边冒出 +N） ——
    const coinR = 9 * (1 + 0.45 * this.coinPop);
    ctx.save();
    ctx.shadowColor = COLORS.neonYellow;
    ctx.shadowBlur = 14 + 18 * this.coinPop;
    ctx.fillStyle = COLORS.neonYellow;
    ctx.beginPath();
    ctx.arc(left + 13, top + 126, coinR, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(left + 10.5, top + 123, coinR * 0.34, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText('× ' + state.coins, left + 32, top + 114);

    if (this.coinPop > 0.02) {
      ctx.globalAlpha = this.coinPop;
      ctx.fillStyle = COLORS.neonYellow;
      ctx.font = '800 28px "Microsoft YaHei", system-ui, sans-serif';
      ctx.fillText('+' + this.coinDelta * COIN_SCORE, left + 120, top + 112 - (1 - this.coinPop) * 22);
      ctx.globalAlpha = 1;
    }

    // —— 速度条：让玩家直观看到“越来越快” ——
    if (engine) {
      const barW = 150;
      const ratio = Math.min(1, (state.speed || 0) / MAX_SPEED);
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      roundRect(ctx, left, top + 158, barW, 8, 4);
      ctx.fill();
      ctx.fillStyle = ratio > 0.7 ? COLORS.neonPink : COLORS.neonCyan;
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 10;
      roundRect(ctx, left, top + 158, Math.max(6, barW * ratio), 8, 4);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;

      // —— 钱包余额（本局金币已经算在里面，所以跑一局就能看到涨） ——
      if (state.wallet !== undefined) {
        ctx.font = '600 24px "Microsoft YaHei", system-ui, sans-serif';
        ctx.fillStyle = 'rgba(255,240,160,0.9)';
        ctx.fillText('钱包 ' + state.wallet, left, top + 182);
      }
    }

    // —— 暂停按钮 ——
    if (showPause) {
      const r = this.pauseRect;
      ctx.globalAlpha = 0.85;
      roundRect(ctx, r.x, r.y, r.w, r.h, 20);
      ctx.fillStyle = 'rgba(10,10,40,0.6)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.stroke();
      ctx.fillStyle = COLORS.white;
      ctx.fillRect(r.x + r.w / 2 - 14, r.y + r.h / 2 - 16, 10, 32);
      ctx.fillRect(r.x + r.w / 2 + 4, r.y + r.h / 2 - 16, 10, 32);
      ctx.globalAlpha = 1;
    }

    // —— 闯关模式：关卡名 + 目标进度 + 右侧容错小圆点 ——
    // 无尽模式 state.goal 为 null，这一整段都不执行，画面与 v1.1 完全一致。
    if (state.goal) {
      const w = (engine && engine.designWidth) || DESIGN_WIDTH;
      const cx = w / 2;
      const gy = 250;

      if (state.levelName) {
        ctx.textAlign = 'center';
        ctx.font = '600 22px "Microsoft YaHei", system-ui, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillText(state.levelName, cx, gy - 34);
      }

      // 目标文字：达标=绿、告急=粉、进行中=白
      ctx.textAlign = 'center';
      ctx.font = '700 28px "Microsoft YaHei", system-ui, sans-serif';
      ctx.fillStyle = state.goal.danger
        ? COLORS.neonPink
        : (state.goal.ok ? COLORS.neonGreen : 'rgba(255,255,255,0.85)');
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 14;
      ctx.fillText(state.goal.label, cx, gy);
      ctx.shadowBlur = 0;

      // 进度条
      const barW = 300;
      const barX = cx - barW / 2;
      const barY = gy + 24;
      const ratio = Math.max(0, Math.min(1, state.goal.progress || 0));
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      roundRect(ctx, barX, barY, barW, 8, 4);
      ctx.fill();
      ctx.fillStyle = state.goal.ok ? COLORS.neonGreen : COLORS.neonCyan;
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 10;
      roundRect(ctx, barX, barY, Math.max(6, barW * ratio), 8, 4);
      ctx.fill();
      ctx.shadowBlur = 0;

      // 右侧容错小圆点：还剩几个护盾一目了然，撞碎一个就变空心
      const max = state.shieldsMax || 0;
      if (max > 0) {
        const right = w - safe.right - 30;
        const y = gy - 26;
        const r = 9;
        const stepX = 26;
        ctx.textAlign = 'right';
        ctx.font = '600 20px "Microsoft YaHei", system-ui, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.fillText('容错', right - (max - 1) * stepX - r - 8, y);
        for (let i = 0; i < max; i++) {
          const x = right - (max - 1 - i) * stepX;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          if (i < (state.shields || 0)) {
            ctx.fillStyle = COLORS.neonGreen;
            ctx.shadowColor = COLORS.neonGreen;
            ctx.shadowBlur = 12;
            ctx.fill();
            ctx.shadowBlur = 0;
          } else {
            ctx.lineWidth = 2;
            ctx.strokeStyle = 'rgba(255,255,255,0.3)';
            ctx.stroke();
          }
        }
      }
      ctx.textAlign = 'left';
    }

    // —— 开局操作提示（跑一段后自动淡出） ——
    if (state.hint) {
      const a = Math.max(0, Math.min(1, state.hint));
      ctx.globalAlpha = a * (0.75 + 0.25 * Math.sin(time * 3));
      ctx.textAlign = 'center';
      ctx.font = '700 30px "Microsoft YaHei", system-ui, sans-serif';
      ctx.fillStyle = COLORS.neonCyan;
      const cx = ((engine && engine.designWidth) || DESIGN_WIDTH) / 2;
      ctx.fillText('点击屏幕 / 空格 跳跃', cx, 300);
      ctx.font = '600 24px "Microsoft YaHei", system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillText('空中再点一次可以二段跳', cx, 344);
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }
}