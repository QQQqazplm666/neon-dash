// player.js —— 玩家实体：跳跃手感、判定盒、残影拖尾，以及「按当前皮肤绘制」
//
// 【关于绘制复用】
//   本文件导出两个纯函数：
//     pathSkinShape(ctx, shape, x, y, w, h) —— 按皮肤形状构建路径
//     drawPlayerSprite(ctx, skin, opts)      —— 画一只完整皮肤（发光/本体/眼睛/特效）
//   商城预览必须调用同一个 drawPlayerSprite，避免出现「商城里长这样、玩起来长那样」。
//
// 【关于性能】
//   玩家的竖向渐变如果每帧 createLinearGradient 会很浪费。
//   这里把「本体 + 描边 + 高光」离屏烘焙成一张小贴图（每种皮肤/尺寸只烘焙一次），
//   每帧只做一次 drawImage，发光用 shadowBlur 实时叠加（这样脉冲特效还能动）。
//   这样既不违反「每帧不重复建渐变」，也比每帧画复杂路径更快。
import {
  COLORS, DESIGN_WIDTH, GROUND_Y, GRAVITY, FALL_MULTIPLIER, MAX_FALL_SPEED,
  JUMP_VELOCITY, DOUBLE_JUMP_VELOCITY, MAX_JUMPS, COYOTE_TIME, JUMP_BUFFER,
  PLAYER_WIDTH, PLAYER_HEIGHT, PLAYER_X_RATIO,
} from '../config.js';
import { getSkin } from '../data/skins.js';
import { clamp, lerp, roundRect } from '../core/fx.js';

// ---------- 皮肤形状与离屏贴图 ----------

/**
 * 按皮肤形状构建路径（路径以 (x,y) 为左上角、w×h 为包围盒）。
 * 所有形状的包围盒一致，因此判定盒与碰撞完全不受皮肤影响。
 */
export function pathSkinShape(ctx, shape, x, y, w, h) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  switch (shape) {
    case 'square':
      roundRect(ctx, x, y, w, h, 3);
      break;
    case 'capsule':
      roundRect(ctx, x, y, w, h, Math.min(w, h) / 2);
      break;
    case 'circle':
      ctx.beginPath();
      ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2);
      break;
    case 'diamond':
      ctx.beginPath();
      ctx.moveTo(cx, y);
      ctx.lineTo(x + w, cy);
      ctx.lineTo(cx, y + h);
      ctx.lineTo(x, cy);
      ctx.closePath();
      break;
    case 'hexagon':
      ctx.beginPath();
      ctx.moveTo(cx, y);
      ctx.lineTo(x + w, y + h * 0.26);
      ctx.lineTo(x + w, y + h * 0.74);
      ctx.lineTo(cx, y + h);
      ctx.lineTo(x, y + h * 0.74);
      ctx.lineTo(x, y + h * 0.26);
      ctx.closePath();
      break;
    case 'star': {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = (i % 2 === 0) ? 1 : 0.46;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const px = cx + Math.cos(a) * (w / 2) * r;
        const py = cy + Math.sin(a) * (h / 2) * r;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    }
    default: // 'rounded'
      roundRect(ctx, x, y, w, h, Math.min(w, h) * 0.28);
  }
}

const SPRITE_PAD = 4;                    // 给描边留的边距
const spriteCache = new Map();           // key: 皮肤id|宽x高 → 离屏 canvas

/** 取得（必要时烘焙）某皮肤某尺寸的本体贴图；无 DOM 时返回 null */
function getSprite(skin, w, h) {
  const key = skin.id + '|' + w + 'x' + h;
  const hit = spriteCache.get(key);
  if (hit) return hit;
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(w + SPRITE_PAD * 2);
  cv.height = Math.ceil(h + SPRITE_PAD * 2);
  const c = cv.getContext('2d');
  c.translate(SPRITE_PAD, SPRITE_PAD);
  const col = skin.colors;
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, col.bodyLight);
  g.addColorStop(0.55, col.body);
  g.addColorStop(1, col.bodyDark);
  pathSkinShape(c, skin.shape, 0, 0, w, h);
  c.fillStyle = g;
  c.fill();
  c.lineWidth = 3;
  c.strokeStyle = COLORS.white;
  c.stroke();
  // 顶部高光
  c.globalAlpha = 0.16;
  c.fillStyle = COLORS.white;
  roundRect(c, w * 0.16, h * 0.12, w * 0.68, h * 0.2, 4);
  c.fill();
  c.globalAlpha = 1;
  spriteCache.set(key, cv);
  if (spriteCache.size > 48) spriteCache.clear();   // 防止尺寸组合无限增长
  return cv;
}

/**
 * 画一只玩家皮肤。玩法与商城共用。
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} skin  skins.js 里的皮肤定义
 * @param {object} o     { x, y, w, h, time?, stretch?, alpha?, glow?, dim? }
 *                       x/y 为包围盒左上角；stretch>0 表示起跳拉伸/落地压扁
 */
export function drawPlayerSprite(ctx, skin, o) {
  const w = o.w, h = o.h;
  const x = o.x, y = o.y;
  const time = o.time || 0;
  const stretch = o.stretch || 0;
  const alpha = o.alpha === undefined ? 1 : o.alpha;
  const col = skin.colors;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  if (stretch) {
    // 以脚底为基准做挤压拉伸：拉长时变窄、压扁时变宽
    ctx.translate(w / 2, h);
    ctx.scale(1 - stretch * 0.55, 1 + stretch);
    ctx.translate(-w / 2, -h);
  }

  // 外发光强度：pulse 特效让光晕呼吸
  let blur = 22;
  let glowAlpha = 1;
  if (skin.effect === 'pulse') {
    const pulse = 0.5 + 0.5 * Math.sin(time * 6);
    blur = 14 + pulse * 20;
  }
  if (skin.effect === 'shimmer') {
    glowAlpha = 0.85 + 0.15 * Math.sin(time * 9);
  }
  if (o.dim) glowAlpha *= 0.55;

  const sprite = getSprite(skin, w, h);
  if (sprite) {
    ctx.shadowColor = col.glow;
    ctx.shadowBlur = blur;
    ctx.globalAlpha = alpha * glowAlpha;
    ctx.drawImage(sprite, -SPRITE_PAD, -SPRITE_PAD, w + SPRITE_PAD * 2, h + SPRITE_PAD * 2);
    ctx.shadowBlur = 0;
  } else {
    // 无 DOM（理论上只发生在测试环境）时的降级画法
    pathSkinShape(ctx, skin.shape, 0, 0, w, h);
    ctx.fillStyle = col.body;
    ctx.fill();
  }
  ctx.globalAlpha = alpha;

  // 彩色流光：沿形体扫过的一条斜光带（裁剪在形体内部）
  if (skin.effect === 'shimmer') {
    ctx.save();
    pathSkinShape(ctx, skin.shape, 0, 0, w, h);
    ctx.clip();
    const bx = ((time * 0.9) % 1.6 - 0.3) * (w + h);
    ctx.globalAlpha = alpha * 0.35;
    ctx.fillStyle = COLORS.white;
    ctx.beginPath();
    ctx.moveTo(bx, -h);
    ctx.lineTo(bx + w * 0.28, -h);
    ctx.lineTo(bx + w * 0.28 - h, h);
    ctx.lineTo(bx - h, h);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // 眼睛（会眨）
  const blink = Math.sin(time * 4) > 0.94 ? 0.15 : 1;
  const ew = w * 0.17;
  const eh = h * 0.2 * blink;
  const ey = h * 0.4;
  ctx.fillStyle = col.eye;
  ctx.shadowColor = col.eye;
  ctx.shadowBlur = 10;
  roundRect(ctx, w * 0.24 - ew / 2, ey, ew, eh, 3);
  ctx.fill();
  roundRect(ctx, w * 0.68 - ew / 2, ey, ew, eh, 3);
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.restore();
}

// ---------- 玩家实体 ----------

export class Player {
  /**
   * @param {import('../core/fx.js').FX} fx
   * @param {object} [skin] 当前装备的皮肤（只影响外观）
   */
  constructor(fx, skin) {
    this.fx = fx;
    this.w = PLAYER_WIDTH;
    this.h = PLAYER_HEIGHT;
    this.x = DESIGN_WIDTH * PLAYER_X_RATIO - this.w / 2;
    // 残影预分配（红线：每帧不 new 对象）
    this.ghosts = [];
    for (let i = 0; i < 6; i++) this.ghosts.push({ y: 0, stretch: 0, age: 1, on: false });
    this.ghostIndex = 0;
    this.ghostTimer = 0;
    this.setSkin(skin);
    this.reset();
  }

  /** 换皮肤（只改外观，绝不动任何数值） */
  setSkin(skin) {
    this.skin = getSkin(skin && skin.id ? skin.id : skin);
  }

  reset() {
    this.prevY = GROUND_Y - this.h;
    this.y = this.prevY;
    this.vy = 0;
    this.onGround = true;
    this.jumpsLeft = MAX_JUMPS;
    this.coyote = 0;
    this.buffer = 0;
    this.stretch = 0;
    this.alive = true;
    this.runPhase = 0;
    this.justJumped = false;
    this.justLanded = false;
    this.lastJumpWasDouble = false;
    this.landingImpact = 0;
    for (const g of this.ghosts) g.on = false;
    this.ghostTimer = 0;
  }

  /** 判定盒：永远基于固定的 w/h，与皮肤无关 */
  hitbox() {
    return { x: this.x + 7, y: this.y + 5, w: this.w - 14, h: this.h - 8 };
  }

  /**
   * @param {number} dt 秒
   * @param {number} groundY 地面 Y（玩家脚底）
   */
  update(dt, groundY) {
    this.justJumped = false;
    this.justLanded = false;
    if (!this.alive) { this.updateDead(dt); return; }

    const GRAVITY_UP = GRAVITY;
    const FALL_MULT = FALL_MULTIPLIER;
    const JUMP_V = JUMP_VELOCITY;
    const DJUMP_V = DOUBLE_JUMP_VELOCITY;
    const MAX_FALL = MAX_FALL_SPEED;

    // 土狼时间 / 跳跃缓冲
    this.coyote = this.onGround ? COYOTE_TIME : Math.max(0, this.coyote - dt);
    this.buffer = Math.max(0, this.buffer - dt);
    if (this.buffer > 0 && (this.onGround || this.coyote > 0 || this.jumpsLeft > 0)) {
      if (this.onGround || this.coyote > 0) {
        this.vy = JUMP_V;
        this.jumpsLeft = MAX_JUMPS - 1;
        this.lastJumpWasDouble = false;
      } else {
        this.vy = DJUMP_V;
        this.jumpsLeft = 0;
        this.lastJumpWasDouble = true;
      }
      this.onGround = false;
      this.coyote = 0;
      this.buffer = 0;
      this.justJumped = true;
      this.stretch = 0.3;
      this.fx.burst(this.x + this.w / 2, this.y + this.h, {
        count: this.lastJumpWasDouble ? 14 : 9,
        color: this.lastJumpWasDouble ? COLORS.neonPink : COLORS.neonCyan,
        speed: 260, life: 0.35, size: 4,
      });
    }

    const own = groundY - this.h;
    this.prevY = this.y;
    const g = this.vy > 0 ? GRAVITY_UP * FALL_MULT : GRAVITY_UP;
    this.vy = Math.min(MAX_FALL, this.vy + g * dt);
    this.y += this.vy * dt;
    if (this.y >= own) {
      if (!this.onGround) {
        this.justLanded = true;
        this.landingImpact = this.vy;
        this.stretch = Math.min(0.36, 0.12 + Math.max(0, this.vy - 200) / 2200);
        this.fx.burst(this.x + this.w / 2, groundY, {
          count: 10, color: COLORS.neonYellow, speed: 200, life: 0.3, size: 3,
        });
      }
      this.y = own;
      this.vy = 0;
      this.onGround = true;
      this.jumpsLeft = MAX_JUMPS;
    } else {
      this.onGround = false;
    }

    // 起跳拉伸自然回弹
    this.stretch *= Math.pow(0.0009, dt);
    if (this.stretch < 0.005) this.stretch = 0;

    this.runPhase += dt * 12;

    // 残影采样：世界向左滚动、玩家屏幕 X 不变，靠固定的向左台阶营造拖尾
    this.ghostTimer -= dt;
    if (this.ghostTimer <= 0) {
      this.ghostTimer = 0.04;
      const gs = this.ghosts[this.ghostIndex];
      gs.y = this.y;
      gs.stretch = this.stretch;
      gs.age = 0;
      gs.on = true;
      this.ghostIndex = (this.ghostIndex + 1) % this.ghosts.length;
    }
    for (const gs of this.ghosts) {
      if (gs.on) {
        gs.age += dt;
        if (gs.age > 0.3) gs.on = false;
      }
    }
  }

  /** 空中预留：受击后不再响应跳跃输入 */
  launch() { this.vy = -520; }

  updateDead(dt) {
    this.vy += GRAVITY * 1.2 * dt;   // 死亡后自由落体（加重一点，掉得更干脆）
    this.y += this.vy * dt;
    this.runPhase += dt * 20;
  }

  requestJump() { this.buffer = JUMP_BUFFER; }
  /** 兼容旧调用名（play.js 里用的是 pressJump） */
  pressJump() { this.requestJump(); }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} alpha 插值系数
   * @param {number} time 秒
   */
  render(ctx, alpha, time) {
    const skin = this.skin;
    const y = lerp(this.prevY, this.y, alpha);

    // 地面投影
    const shadowW = this.w * (1 - clamp((GROUND_Y - (y + this.h)) / 600, 0, 0.6));
    ctx.save();
    ctx.globalAlpha = 0.32;
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.ellipse(this.x + this.w / 2, GROUND_Y + 2, shadowW * 0.8, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 残影（从旧到新，越来越淡）
    for (let i = 0; i < this.ghosts.length; i++) {
      const gs = this.ghosts[i];
      if (!gs.on) continue;
      const t = clamp(gs.age / 0.3, 0, 1);
      const back = (i + 1) * 0.5;
      drawPlayerSprite(ctx, skin, {
        x: this.x - 14 - i * 9 - back * 4,
        y: gs.y,
        w: this.w,
        h: this.h,
        time,
        stretch: gs.stretch,
        alpha: (1 - t) * 0.26,
        dim: true,
      });
    }

    // 本体
    drawPlayerSprite(ctx, skin, {
      x: this.x,
      y,
      w: this.w,
      h: this.h,
      time,
      stretch: this.stretch,
      alpha: 1,
    });

    // 二段跳剩余次数提示（粉点，属于玩法信息，所有皮肤一致）
    if (!this.onGround && this.jumpsLeft > 0) {
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = skin.colors.glow;
      ctx.shadowColor = skin.colors.glow;
      ctx.shadowBlur = 8;
      for (let i = 0; i < this.jumpsLeft; i++) {
        ctx.beginPath();
        ctx.arc(this.x + this.w / 2 + (i - 0.5) * 11, y - 12, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }
}

export default Player;