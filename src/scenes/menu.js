// ============================================================
// menu.js —— 主菜单
// 标题 / 开始（或继续）/ 商城 / 三个设置开关 / 最高分 / 钱包 / 操作说明。
// 触摸：点按钮就生效，点空白处直接开始游戏。
// 键盘：↑/↓ 选择按钮，空格或回车确认（默认选中的就是「开始游戏」）。
//
// 【v1.1 改动】
//   1) 新增「皮肤商城」入口。
//   2) 显示跨局钱包余额与当前皮肤名（金币有去处，玩家才知道攒钱干嘛）。
//   3) 按钮支持键盘上下选择，按回车操作选中的那一个。
//   4) 菜单不放背景音乐（音乐只在玩法里响，进玩法淡入、回菜单淡出）。
//
// 【v1.2 改动】
//   新增「闯关模式」入口（触摸 / ↑↓ 选择 / 回车都支持），点它进关卡选择页。
//   「开始游戏」依旧是无尽模式，行为与 v1.1 完全一致。
// ============================================================
import { Scene } from '../core/scenes.js';
import * as C from '../config.js';
import { getSkin } from '../data/skins.js';
import { LEVELS } from '../data/levels.js';
import { clamp, drawNeonButton, makeStars, drawBackdrop, pointInRect } from '../core/fx.js';

export class MenuScene extends Scene {
  enter() {
    this.t = 0;
    this.stars = makeStars(90, C.DESIGN_WIDTH, C.DESIGN_HEIGHT);
    this.buttons = this._buildButtons();
    // 默认选中「继续游戏」或「开始游戏」，这样空格/回车的手感和以前一致
    this.sel = 0;
    this._layout();
    // 菜单里不放背景音乐：如果刚是从玩法回来的，这里把它淡掉
    if (this.game.audio) this.game.audio.fadeOutMusic(0.5);
  }

  /** 从商城返回时重新读一遍钱包/皮肤，按钮上的文字要跟着更新 */
  resume() {
    this.buttons = this._buildButtons();
    this.sel = clamp(this.sel, 0, this.buttons.length - 1);
    this._layout();
  }

  /** 按钮列表：id 决定点击后干什么，文字在渲染时实时取（这样开关状态永远是新的） */
  _buildButtons() {
    const list = [];
    if (this.game.save.data.resume) list.push({ id: 'continue', color: C.COLORS.neonGreen });
    list.push({ id: 'start', color: C.COLORS.neonCyan });
    list.push({ id: 'campaign', color: C.COLORS.neonPink });   // v1.2：闯关模式入口
    list.push({ id: 'shop', color: C.COLORS.neonYellow });
    list.push({ id: 'sfx', color: C.COLORS.neonPurple });
    list.push({ id: 'music', color: C.COLORS.neonPurple });
    list.push({ id: 'vibrate', color: C.COLORS.neonPurple });
    return list;
  }

  _layout() {
    const W = C.DESIGN_WIDTH;
    const bw = 460;
    // 按钮变多时（v1.2 加了「闯关模式」）收紧一点，免得压到下面的操作说明
    const cramped = this.buttons.length >= 7;
    const bh = cramped ? 74 : 78;
    const gap = cramped ? 12 : 14;
    const total = this.buttons.length * bh + (this.buttons.length - 1) * gap;
    let y = Math.max(462, 720 - total / 2);
    for (const b of this.buttons) {
      b.rect = { x: (W - bw) / 2, y, w: bw, h: bh };
      y += bh + gap;
    }
  }

  _label(id) {
    const s = this.game.save.settings;
    // 注意：「继续游戏」的按钮存在时，存档里的快照理论上一定还在。
    // 但一旦进了游戏，快照就会被清掉，所以这里必须能容忍 resume 为 null，
    // 否则渲染到一半就会抛异常，整个主循环都会挂掉。
    if (id === 'continue') {
      const r = this.game.save.data.resume;
      return r ? '继续游戏  ' + r.score + ' 分' : '继续游戏';
    }
    if (id === 'start') return '开始游戏';
    if (id === 'campaign') {
      const c = this.game.save.data.campaign;
      // 没通关过就只显示「闯关模式」，通关过就顺带报一下进度
      return c.cleared > 0 ? '闯关模式  ' + c.cleared + '/' + LEVELS.length + ' 关' : '闯关模式';
    }
    if (id === 'shop') return '皮肤商城';
    if (id === 'sfx') return '音效：' + (s.sfx ? '开' : '关');
    if (id === 'music') return '音乐：' + (s.music ? '开' : '关');
    if (id === 'vibrate') {
      const supported = typeof navigator !== 'undefined' && !!navigator.vibrate;
      return '震动：' + (supported ? (s.vibrate ? '开' : '关') : '不支持');
    }
    return id;
  }

  /** 进游戏一律用 replace：菜单不该留在场景栈里被重复渲染 */
  _startGame(params) {
    // 传 undefined 而不是 null，好让 PlayScene 的默认参数 params = {} 生效
    this.game.scenes.replace('play', params || undefined);
  }

  _activate(id) {
    const g = this.game;
    g.audio.click();
    if (id === 'continue') {
      this._startGame({ resume: g.save.data.resume });
      return;
    }
    if (id === 'start') {
      g.save.saveResume(null);
      this._startGame(null);
      return;
    }
    if (id === 'campaign') {
      g.scenes.push('levelselect');   // 压栈：选关页返回时 pop 回菜单
      return;
    }
    if (id === 'shop') {
      g.scenes.push('shop');      // 压栈：返回时 pop 回菜单，菜单会走 resume() 刷新
      return;
    }
    const s = g.save.settings;
    if (id === 'sfx') g.save.setSetting('sfx', !s.sfx);
    else if (id === 'music') {
      g.save.setSetting('music', !s.music);
      // 菜单里不播背景音乐：打开时给一声确认音，音乐会在进玩法时响起
      if (g.save.settings.music) g.audio.equip();
      else g.audio.fadeOutMusic(0.2);
    } else if (id === 'vibrate') {
      g.save.setSetting('vibrate', !s.vibrate);
      if (g.save.settings.vibrate && navigator.vibrate) navigator.vibrate(30);
    }
  }

  update(dt) {
    this.t += dt;
    const input = this.game.input;

    // 触摸/鼠标：先看有没有点在按钮上
    const p = input.pressPoint;
    if (p) {
      let hit = null;
      for (const b of this.buttons) {
        if (pointInRect(p, b.rect)) { hit = b; break; }
      }
      // 这次点击已经被菜单吃掉了，不要再触发跳跃/确认
      input.consume('jump');
      input.consume('confirm');
      if (hit) {
        this.sel = this.buttons.indexOf(hit);
        this._activate(hit.id);
      } else {
        this.game.save.saveResume(null);
        this._startGame(null);
      }
      return;
    }

    // 键盘 ↑/↓ 选择按钮（↑ 同时会触发 jump/confirm，所以要一并吃掉）
    let moved = false;
    if (input.justPressed('up')) { this._move(-1); moved = true; }
    if (input.justPressed('down')) { this._move(1); moved = true; }
    if (moved) {
      input.consume('jump');
      input.consume('confirm');
      this.game.audio.click();
      return;
    }

    // 空格 / 回车：确认当前选中的按钮（默认就是「开始游戏」）
    if (input.justPressed('confirm')) {
      input.consume('confirm');
      input.consume('jump');
      const b = this.buttons[this.sel];
      if (b) this._activate(b.id);
    }
  }

  _move(delta) {
    this.sel = clamp(this.sel + delta, 0, this.buttons.length - 1);
  }

  render(ctx) {
    const W = C.DESIGN_WIDTH;
    const H = C.DESIGN_HEIGHT;
    const safe = this.game.engine.safe;

    // 背景（多层视差 + 随距离渐变的配色；菜单里难度取 0）
    drawBackdrop(ctx, this.stars, this.t, this.t * 90, 0.05, W, H);

    // 地面装饰线
    ctx.save();
    ctx.shadowColor = C.COLORS.neonCyan;
    ctx.shadowBlur = 24;
    ctx.fillStyle = C.COLORS.neonCyan;
    ctx.fillRect(0, C.GROUND_Y, W, 5);
    ctx.restore();

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // 标题（呼吸发光）
    const pulse = 0.5 + 0.5 * Math.sin(this.t * 2);
    ctx.font = '900 96px "Microsoft YaHei", system-ui, sans-serif';
    ctx.shadowColor = C.COLORS.neonPink;
    ctx.shadowBlur = 20 + pulse * 28;
    ctx.fillStyle = C.COLORS.white;
    ctx.fillText(C.GAME_NAME, W / 2, safe.top + 186);
    ctx.shadowBlur = 0;

    ctx.font = '800 36px "Microsoft YaHei", system-ui, sans-serif';
    ctx.fillStyle = C.COLORS.neonCyan;
    ctx.fillText(C.GAME_NAME_EN, W / 2, safe.top + 256);

    // 最高分
    ctx.font = '700 32px "Microsoft YaHei", system-ui, sans-serif';
    ctx.fillStyle = C.COLORS.neonYellow;
    ctx.fillText('最高分  ' + this.game.save.data.bestScore, W / 2, safe.top + 328);

    ctx.font = '500 24px "Microsoft YaHei", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillText('已游玩 ' + this.game.save.data.playCount + ' 局', W / 2, safe.top + 366);

    // 钱包 + 当前皮肤（金币有去处，玩家才知道攒钱干嘛）
    ctx.font = '600 26px "Microsoft YaHei", system-ui, sans-serif';
    ctx.shadowColor = C.COLORS.neonYellow;
    ctx.shadowBlur = 12;
    ctx.fillStyle = 'rgba(255,236,150,0.95)';
    ctx.fillText('金币 ' + this.game.save.wallet + '　·　皮肤 ' + getSkin(this.game.save.equippedSkin).name,
      W / 2, safe.top + 406);
    ctx.shadowBlur = 0;

    ctx.restore();

    // 按钮
    for (let i = 0; i < this.buttons.length; i++) {
      const b = this.buttons[i];
      const primary = b.id === 'start' || b.id === 'continue';
      drawNeonButton(ctx, b.rect, this._label(b.id), {
        color: b.color,
        active: primary || i === this.sel,
        fontSize: primary ? 36 : 32,
      });
      // 键盘选中的那一项加一个左侧小三角，鼠标用户不受影响
      if (i === this.sel) {
        ctx.save();
        ctx.fillStyle = b.color;
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        ctx.moveTo(b.rect.x - 20, b.rect.y + b.rect.h / 2 - 12);
        ctx.lineTo(b.rect.x - 20, b.rect.y + b.rect.h / 2 + 12);
        ctx.lineTo(b.rect.x - 4, b.rect.y + b.rect.h / 2);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }

    // 操作说明
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const infoY = Math.min(H - safe.bottom - 110, 1140);
    ctx.font = '600 26px "Microsoft YaHei", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText('手机：点击屏幕跳跃（空中再点一次 = 二段跳）', W / 2, infoY);
    ctx.fillText('电脑：空格 / ↑ 跳跃　·　P / Esc 暂停　·　↑↓ 选择按钮', W / 2, infoY + 38);
    ctx.font = '500 22px "Microsoft YaHei", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillText('v' + C.VERSION + '　零依赖 · 全离线可玩', W / 2, infoY + 80);
    ctx.restore();

    // 点空白处也能开始，给个淡淡的提示（放在按钮区和说明之间）
    ctx.save();
    ctx.globalAlpha = 0.3 + 0.22 * Math.sin(this.t * 3);
    ctx.textAlign = 'center';
    ctx.font = '600 22px "Microsoft YaHei", system-ui, sans-serif';
    ctx.fillStyle = C.COLORS.neonCyan;
    ctx.fillText('点击空白处直接开始', W / 2, clamp(infoY - 56, 0, H));
    ctx.restore();
  }
}