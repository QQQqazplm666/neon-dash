// ============================================================
// play.js —— 核心玩法场景（v1.2 起同时承载「无尽模式」与「闯关模式」）
// 横向卷轴跑酷：玩家固定在屏幕左侧 25%，世界向左滚动。
// 分数 = 前进距离换算的分 + 金币分。
//
// 【v1.2 改动：一份代码两种模式】
//   两种模式复用这一个 PlayScene，唯一的分叉口是注入的 `rules` 对象：
//     · 无尽模式：endlessRules()，速度/难度直接引用 config 的同名函数
//       （rules.speedAt === C.speedAt）、gapMargin = 70、shields = Infinity，
//       撞到即死 —— 与 v1.1 逐字节等价。
//     · 闯关模式：levelRules(levelId)，每关自己的 length/速度曲线/生成配方/
//       容错护盾/通关条件，跑到 rules.length 即结算。
//   另外新增：容错护盾（撞击先扣盾，扣完才失败）、撞击破碎 + 减速 + 罚时、
//   通关闭环与 levelresult 结算、闯关不写 resume 快照、闯关分数不写全局最高分。
// ============================================================
import { Scene } from '../core/scenes.js';
import * as C from '../config.js';
import { Player } from '../entities/player.js';
import { Spawner } from '../entities/spawner.js';
import { HUD } from '../ui/hud.js';
import { getSkin } from '../data/skins.js';
import {
  endlessRules, levelRules, evalClear, evalStars,
} from '../data/levels.js';
import {
  clamp, lerp, makeStars,
  drawBackdrop, drawGround, drawVignette, drawScanlines,
} from '../core/fx.js';

// 无尽模式当年只有 4 套调色板，v1.2 追加了第 5 套（闯关 L5 用）。
// 为了「无尽模式的画面也不能有一丝漂移」，这里把无尽模式的难度参数按
// 3/(5−1) 缩放后再喂给 paletteAt —— p = d×0.75×4 = d×3，与旧版的
// p = d×3 逐档一致（Lead 复核：难度 < 0.9896 时逐档零差异）。
// 唯一差异在难度 ≥ 0.9896 的尾部（连续跑满 7 万像素之后）：旧版 4 套
// 调色板时索引会被收敛回 2:0（画面突然跳回第 3 套），现在是平滑落到 3:0。
// 这是修掉了旧版的一个跳变，不是新的漂移。
const ENDLESS_PALETTE_SPAN = 3;

export class PlayScene extends Scene {
  enter(params = {}) {
    const g = this.game;
    // ---- 模式分流：唯一的分叉口 ----
    this.mode = params.mode === 'level' ? 'level' : 'endless';
    this.rules = this.mode === 'level' ? levelRules(params.levelId) : endlessRules();
    this.levelId = this.rules.levelId;
    this.level = this.rules.level;

    // 每局都用全新的对象，保证状态干净；皮肤只传给绘制用
    this.skin = getSkin(g.save.equippedSkin);
    this.player = new Player(g.fx, this.skin);
    this.spawner = new Spawner();
    if (this.rules.recipe) {
      // 闯关：注入本关配方后重新 reset，出生点/首次间距走关卡数值
      this.spawner.setRecipe(this.rules.recipe);
      this.spawner.reset();
    }
    this.hud = new HUD();
    this.hud.layout(g.engine);
    this.stars = makeStars(110, C.DESIGN_WIDTH, C.DESIGN_HEIGHT);

    this.time = 0;
    this.dead = false;
    this.finished = false;
    this.deadTimer = 0;
    this.camY = 0;
    this.distance = 0;
    this.coins = 0;
    this.score = 0;
    this.speed = this.rules.startSpeed;
    this.difficulty = 0;
    this.isRecord = false;
    this.wallet = g.save.wallet;

    // ---- v1.2 闯关专用状态 ----
    this.hits = 0;                 // 撞击次数（护盾抵扣也算一次）
    this.shields = this.rules.shields;   // 剩余容错护盾（无尽模式 = Infinity）
    this.invuln = 0;               // 撞击后的短暂无敌，防止连续扣盾
    this.speedMul = 1;             // 撞击减速倍率（无尽恒为 1）
    this.penaltyTimer = 0;         // 减速剩余时间
    this.timePenalty = 0;          // 限时关的累计罚时（秒）
    this.elapsed = 0;              // 本局实际游玩时间（不含暂停/命中停顿）
    this.cleared = false;          // 是否已通关（进入通关演出）
    this.clearTimer = 0;
    this.passed = false;           // 通关闭环判定结果
    this.starCount = 0;            // 星级（this.stars 已被星空粒子占用，故另起名字）
    this.checks = null;            // 结算页的目标清单
    this.unlocked = g.save.data.campaign.unlocked;

    // 从「继续游戏」进来时，分数和距离接着上次（只有无尽模式会带 resume）
    const resume = params.resume;
    if (resume) {
      this.distance = Math.max(0, resume.distance || 0);
      this.coins = Math.max(0, resume.coins || 0);
      this.score = Math.max(0, resume.score || 0);
      // 恢复出来的局，前方也要留出热身距离，避免一上来就撞
      this.difficulty = this.rules.difficultyAt(this.distance);
      this.speed = this.rules.speedAt(this.distance);
      this.spawner.nextGap = Math.max(this.rules.firstSpawnGap, this.speed * 1.5);
    }
    // 闯关模式【不写 resume 快照】——星级要求「从起点到终点的一次连续表现」，
    // 中途退出即放弃本关；也绝不能顺手把无尽模式的「继续」快照清掉。
    if (this.mode === 'endless') g.save.saveResume(null);
    this._recalcSpeed();

    // 窗口尺寸变化时重新摆放 HUD
    this._onResize = () => this.hud.layout(g.engine);
    g.engine.onResize = this._onResize;

    if (g.audio) {
      g.audio.resetCombo();          // 新一局的连吃计数从 0 开始
      g.audio.setMusicIntensity(this.difficulty);
      g.audio.startMusic();
    }
  }

  exit() {
    if (this.game.engine.onResize === this._onResize) this.game.engine.onResize = null;
    // 回菜单时音乐淡出，而不是硬切
    if (this.game.audio) this.game.audio.fadeOutMusic(0.5);
  }

  pause() { /* 被暂停覆盖层盖住时，什么都不用做：世界自然停住 */ }
  resume() { /* 回到游戏时也不需要特殊处理 */ }

  /** 由距离换算当前速度与难度进度（模式各自的曲线；再乘上撞击减速） */
  _recalcSpeed() {
    this.difficulty = this.rules.difficultyAt(this.distance);
    this.speed = this.rules.speedAt(this.distance) * this.speedMul;
  }

  // ---------------- 逻辑更新 ----------------
  update(dt) {
    const g = this.game;
    this.time += dt;
    g.fx.update(dt);          // 特效永远在走（包括命中停顿期间）

    // 通关演出：世界冻住，0.9 秒后跳到结算页
    if (this.cleared) {
      this.clearTimer += dt;
      if (this.clearTimer >= 0.9 && !this.finished) {
        this.finished = true;
        g.scenes.replace('levelresult', this._resultParams());
      }
      return;
    }

    if (this.dead) {
      this.deadTimer += dt;
      this.player.updateDead(dt);
      if (this.deadTimer >= 0.7 && !this.finished) {
        this.finished = true;
        if (this.mode === 'level') {
          // 闯关失败也走结算页（容错耗尽 = 本关未完成，可立刻重试）
          g.scenes.replace('levelresult', this._resultParams());
        } else {
          g.scenes.replace('gameover', {
            score: this.score,
            best: g.save.data.bestScore,
            isRecord: this.isRecord,
            distance: this.distance,
            coins: this.coins,
            earned: this.earned || this.coins,
            wallet: g.save.wallet,
          });
        }
      }
      return;
    }

    // 命中停顿：世界冻结，但粒子和震动继续，打击感就来自这里
    if (g.fx.hitstopTimer > 0) return;

    const input = g.input;

    // 暂停按钮优先吃掉这次点击，否则点暂停会顺便跳一下
    const p = input.pressPoint;
    if (p && this.hud.hitPause(p)) {
      input.consume('jump');
      input.consume('confirm');
      g.audio.click();
      g.scenes.push('pause', { play: this });
      return;
    }
    if (input.justPressed('pause')) {
      input.consume('pause');
      g.audio.click();
      g.scenes.push('pause', { play: this });
      return;
    }

    // 跳跃：只记录“按下了”，真正的起跳由 player 里的缓冲/土狼时间决定
    if (input.justPressed('jump')) this.player.pressJump();

    // 撞击后的无敌与减速惩罚随时间衰减
    this.elapsed += dt;
    if (this.invuln > 0) this.invuln = Math.max(0, this.invuln - dt);
    if (this.penaltyTimer > 0) {
      this.penaltyTimer = Math.max(0, this.penaltyTimer - dt);
      if (this.penaltyTimer === 0) this.speedMul = 1;   // 减速结束，速度恢复
    }

    // 世界推进
    this._recalcSpeed();
    this.distance += this.speed * dt;

    // 【v1.3】「地面」从单个标量推广成「玩家脚下最高的可站表面」。
    //   用**当前脚底**（= 上一帧 update 之后的位置）和**当前 vy** 去问 spawner.surfaceY：
    //   vy < 0（上升中）时它一律只给 GROUND_Y → 从下方穿过平台时绝不会被吸附；
    //   已经穿到平台下面（脚底低于顶面超过容差）也不会被当成候选；
    //   再传一个 prevY 脚底做「穿越检测」→ 只有从上面掉下来才落得上平台。
    //   没有平台时它返回 C.GROUND_Y，所以闯关模式的行为与 v1.2 完全一致。
    const feetY = this.player.y + this.player.h;
    const prevFeetY = this.player.prevY + this.player.h;
    const surface = this.spawner.surfaceY(this.player.x + this.player.w / 2, feetY, this.player.vy, prevFeetY);

    // 【v1.3 弹簧跳板】下落中（或跑动中）脚底接触弹簧顶面 → 一次性弹起。
    // 弹簧永远是加分项：地面障碍的间距仍按原有跳跃能力算，不因它收紧。
    let sprung = false;
    if (this.player.alive) {
      const sv = this.spawner.triggerSprings(this.player.x, this.player.w, feetY, this.player.vy);
      if (sv) {
        this.player.vy = sv;
        this.player.onGround = false;
        this.player.jumpsLeft = C.MAX_JUMPS;
        this.player.coyote = 0;
        this.player.stretch = 0.34;
        sprung = true;
      }
    }

    this.player.update(dt, surface);

    // 音效跟着玩家事件走
    if (sprung) {
      if (g.audio.spring) g.audio.spring();
      g.fx.burst(this.player.x + this.player.w / 2, this.player.y + this.player.h, {
        count: 16, color: C.COLORS.neonGreen, speed: 320, life: 0.4, size: 4,
      });
    }
    if (this.player.justJumped) {
      if (this.player.lastJumpWasDouble) g.audio.doubleJump();
      else g.audio.jump();
    }
    if (this.player.justLanded) g.audio.land();

    this.spawner.update(dt, this.speed, this.difficulty, this.distance, this.rules.peakSpeed);
    if (g.audio) g.audio.setMusicIntensity(this.difficulty);

    // 相机轻微跟随（有延迟，所以是“跟”不是“焊死”）
    const target = clamp((C.GROUND_Y - C.PLAYER_HEIGHT - this.player.y) * 0.22, 0, 60);
    this.camY = lerp(this.camY, target, 1 - Math.pow(0.0025, dt));

    this._collide();

    this.score = Math.floor(this.distance * C.SCORE_PER_PIXEL) + this.coins * C.COIN_SCORE;
    this.wallet = g.save.wallet + this.coins;   // 结算前的“预计钱包”

    // 通关闭环：跑到本关终点就判定（无尽模式 length = Infinity，永不触发）
    if (this.distance >= this.rules.length) this._clear();
  }

  // ---------------- 碰撞 ----------------
  _collide() {
    const g = this.game;
    // 刚扣过盾的短暂无敌：让玩家有机会从障碍里脱身，也避免一帧连扣
    if (this.invuln > 0) return;
    const box = this.player.hitbox();
    const px2 = box.x + box.w;
    const py2 = box.y + box.h;

    // 障碍：相交 → 有容错护盾就先扣盾（撞碎），否则失败。
    // 【注意】无尽模式 shields = Infinity，但那里必须是「撞即死」，
    // 所以这里按模式判断，而不是只看 shields 的数值。
    for (const o of this.spawner.obstacles) {
      if (o.x < px2 && o.x + o.w > box.x && o.y < py2 && o.y + o.h > box.y) {
        if (this.mode === 'level' && this.shields > 0) this._takeHit(o);
        else this._die();
        return;
      }
    }

    // 金币：圆心到玩家矩形的最近距离
    for (const c of this.spawner.coins) {
      if (c.taken) continue;
      const nx = clamp(c.x, box.x, px2);
      const ny = clamp(c.y, box.y, py2);
      const dx = c.x - nx;
      const dy = c.y - ny;
      if (dx * dx + dy * dy <= c.r * c.r) {
        c.taken = true;
        this.coins += 1;
        g.audio.coin();                    // 连吃时音高逐个升高
        const skin = this.skin;
        g.fx.text(c.x, c.y - 18, '+' + C.COIN_SCORE, C.COLORS.neonYellow, { size: 30, life: 0.75 });
        g.fx.burst(c.x, c.y, 9, C.COLORS.neonYellow, { speed: 170, life: 0.36, size: 3.5, gravity: 500 });
        // 皮肤特效：spark 额外迸出一圈本色粒子
        if (skin.effect === 'spark') {
          g.fx.burst(c.x, c.y, 5, skin.colors.glow, { speed: 120, life: 0.3, size: 3, gravity: 260 });
        }
        if (g.save.settings.vibrate && navigator.vibrate) navigator.vibrate(12);
      }
    }
  }

  /**
   * 扣一层容错护盾（只在闯关模式调用）。
   * 表现：障碍当场破碎 + 轻量震动/闪白 + 减速 + 限时关额外罚时。
   */
  _takeHit(o) {
    const g = this.game;
    const p = this.rules.hitPenalty;
    this.shields -= 1;
    this.hits += 1;
    this.invuln = 1.2;                                     // 1.2s 内不再扣盾
    this.speedMul = p ? p.slowMul : 0.75;                  // 撞了会明显变慢
    this.penaltyTimer = p ? p.slowTime : 1.2;
    if (p && p.timeLoss) this.timePenalty += p.timeLoss;   // L4：限时关额外罚时

    if (o) this.spawner.breakObstacle(o);                  // 障碍被撞碎，不再二次伤害

    const cx = o ? o.x + o.w / 2 : this.player.x;
    const cy = o ? o.y + o.h / 2 : this.player.y;
    g.fx.shake(16, 0.3);
    g.fx.hitstop(0.08);
    g.fx.flash(0.14, C.COLORS.neonGreen);
    g.fx.damage(0.22);
    g.fx.burst(cx, cy, 16, C.COLORS.neonGreen, { speed: 300, life: 0.5, size: 4.5, gravity: 1100 });
    g.fx.text(cx, cy - 40, '−1 容错', C.COLORS.neonGreen, { size: 30, life: 0.9 });
    g.audio.hit();
    if (g.save.settings.vibrate && navigator.vibrate) navigator.vibrate(35);
  }

  _die() {
    const g = this.game;
    if (this.dead) return;
    this.dead = true;
    this.deadTimer = 0;
    this.player.launch();

    // —— 手感四件套：震动 + 命中停顿 + 红白闪 + 音效 ——
    g.fx.shake(30, 0.5);
    g.fx.hitstop(0.12);
    g.fx.flash(0.28);
    g.fx.damage(0.36);
    g.fx.burst(this.player.x + this.player.w / 2, this.player.y + this.player.h / 2, 28,
      C.COLORS.neonPink, { speed: 430, life: 0.75, size: 5, gravity: 1500 });
    g.audio.hit();                          // hit() 内部会把连吃计数归零
    if (g.save.settings.vibrate && navigator.vibrate) navigator.vibrate(70);

    if (this.mode === 'level') {
      // 闯关失败：金币照常入钱包（否则商城经济断掉），但不写无尽最高分。
      const clear = evalClear(this.level, {
        distance: this.distance, coins: this.coins, hits: this.hits,
        elapsed: this.elapsed, timePenalty: this.timePenalty,
      });
      this.passed = false;
      this.starCount = 0;
      this.checks = clear.checks;
      const res = g.save.recordLevel({
        levelId: this.levelId, stars: 0, score: this.score, coins: this.coins,
      });
      this.wallet = res.wallet;
      this.unlocked = res.unlocked;
      return;
    }

    // 结算并写入存档（本局金币在 recordRun 里累加进钱包）
    const result = g.save.recordRun({ score: this.score, distance: this.distance, coins: this.coins });
    this.isRecord = result.isRecord;
    this.best = result.best;
    this.earned = result.earned !== undefined ? result.earned : this.coins;
    this.wallet = result.wallet !== undefined ? result.wallet : g.save.wallet;
    if (this.isRecord) g.audio.fanfare();
  }

  /** 通关闭环：判定 → 存档 → 播放演出 → 0.9s 后跳结算页 */
  _clear() {
    const g = this.game;
    if (this.cleared) return;
    this.cleared = true;
    this.clearTimer = 0;
    this.distance = Math.min(this.distance, this.rules.length);
    this.score = Math.floor(this.distance * C.SCORE_PER_PIXEL) + this.coins * C.COIN_SCORE;

    const clear = evalClear(this.level, {
      distance: this.distance, coins: this.coins, hits: this.hits,
      elapsed: this.elapsed, timePenalty: this.timePenalty,
    });
    this.passed = clear.passed;
    this.checks = clear.checks;
    this.starCount = evalStars(this.level, { passed: clear.passed, coins: this.coins, hits: this.hits });

    const res = g.save.recordLevel({
      levelId: this.levelId, stars: this.starCount, score: this.score, coins: this.coins,
    });
    this.wallet = res.wallet;
    this.unlocked = res.unlocked;

    g.fx.flash(0.3, clear.passed ? C.COLORS.neonGreen : C.COLORS.neonYellow);
    g.fx.burst(this.player.x + this.player.w / 2, this.player.y + this.player.h / 2, 34,
      clear.passed ? C.COLORS.neonGreen : C.COLORS.neonYellow,
      { speed: 420, life: 0.9, size: 5, gravity: 900 });
    if (clear.passed) g.audio.fanfare();
    else g.audio.hit();
  }

  /** 结算页需要的全部参数 */
  _resultParams() {
    return {
      levelId: this.levelId,
      passed: this.passed,
      stars: this.starCount,
      distance: this.distance,
      length: this.rules.length,
      coins: this.coins,
      hits: this.hits,
      elapsed: this.elapsed,
      timePenalty: this.timePenalty,
      score: this.score,
      earned: this.coins,
      wallet: this.wallet,
      unlocked: this.unlocked,
      checks: this.checks,
    };
  }

  /** 离开到菜单时，把这一局存成“可继续”的快照（闯关模式不存） */
  snapshot() {
    if (this.mode === 'level') return null;   // 闯关中途退出 = 放弃本关，杜绝分段刷星
    return { score: this.score, distance: this.distance, coins: this.coins };
  }

  /**
   * 「重新开始」时要重放进 PlayScene 的参数。
   * 无尽模式返回 undefined（与 v1.1 的 replace('play') 无参数完全一致），
   * 闯关模式带回本关 id —— 这正是 pause.js 那个会掉回无尽模式的 bug 的修复依据。
   */
  replayParams() {
    if (this.mode === 'level') return { mode: 'level', levelId: this.levelId };
    return undefined;
  }

  /** 无尽模式旧口径的调色板参数（保持 v1.1 的画面完全不变） */
  _paletteParam() {
    if (this.mode === 'level') {
      return this.rules.paletteIndex / (C.BG_PALETTES.length - 1);
    }
    return this.difficulty * ENDLESS_PALETTE_SPAN / (C.BG_PALETTES.length - 1);
  }

  /** HUD 目标行 / 容错点所需的数据（无尽模式返回 null，HUD 保持原样） */
  _hudGoal() {
    const lv = this.level;
    if (!lv) return null;
    const goal = lv.goal;
    if (goal.time > 0) {
      const left = goal.time - (this.elapsed + this.timePenalty);
      return {
        label: '剩余 ' + Math.max(0, left).toFixed(1) + 's',
        progress: clamp(1 - left / goal.time, 0, 1),
        ok: left >= 0,
        danger: left < 5,
      };
    }
    if (goal.coins > 0) {
      return {
        label: '金币 ' + this.coins + ' / ' + goal.coins,
        progress: clamp(this.coins / goal.coins, 0, 1),
        ok: this.coins >= goal.coins,
        danger: false,
      };
    }
    return {
      label: '目标 ' + Math.floor(this.distance) + ' / ' + lv.length,
      progress: clamp(this.distance / lv.length, 0, 1),
      ok: this.distance >= lv.length,
      danger: false,
    };
  }

  // ---------------- 渲染 ----------------
  render(ctx, alpha) {
    const g = this.game;
    const sh = g.fx.shakeOffset();
    const W = C.DESIGN_WIDTH;
    const H = C.DESIGN_HEIGHT;
    const pal = this._paletteParam();

    ctx.save();
    ctx.translate(sh.x, sh.y + this.camY);

    // 背景：多层视差（星空 → 远景城市 → 近景霓虹地平线）
    // 无尽模式配色随距离渐变；闯关模式锁定本关调色板（L1→L5 = 越来越深入城市核心）
    drawBackdrop(ctx, this.stars, this.time, this.distance, pal, W, H);
    drawGround(ctx, this.distance, this.time, W, H, pal);
    this.spawner.render(ctx);
    this.player.render(ctx, alpha, this.time);
    g.fx.render(ctx);

    ctx.restore();

    // 后期处理不跟着抖动，免得画面边缘露白
    g.fx.renderDamage(ctx, W, H);
    g.fx.renderFlash(ctx, W, H);
    drawVignette(ctx, W, H);
    drawScanlines(ctx, W, H, this.time);

    this.hud.render(ctx, {
      score: this.score,
      distance: this.distance,
      coins: this.coins,
      wallet: this.wallet,
      speed: this.speed,
      // 提示一直留到第一个障碍快到的时候（约 1250px）再淡出
      hint: this.dead ? 0 : clamp(1 - this.distance / 1250, 0, 1),
      // v1.2：闯关模式的额外 HUD（无尽模式为 null/空，外观不变）
      mode: this.mode,
      levelName: this.level ? this.level.name : '',
      goal: this._hudGoal(),
      shields: Number.isFinite(this.shields) ? this.shields : null,
      shieldsMax: Number.isFinite(this.rules.shields) ? this.rules.shields : null,
    }, g.engine, this.time, !this.dead && !this.cleared);
  }
}