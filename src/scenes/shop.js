// ============================================================
// shop.js —— 皮肤商城场景
// 用单局吃到的金币（存在跨局钱包里）购买皮肤，买到的皮肤可以随时装备。
//
// 【设计要点】
//   1) 皮肤预览必须复用玩法里的 drawPlayerSprite —— 商城里看到什么样，
//      跑起来就是什么样（绝对不写第二套画法）。
//   2) 皮肤只影响外观：这里不做任何数值改动，装备完立刻生效（下一局就换皮）。
//   3) 金币不足时按钮变灰 + 明确提示「还差多少」，绝不静默失败。
//
// 【操作】
//   键盘：←/→ 左右选、↑/↓ 上下选、回车 购买或装备、Esc 返回菜单
//   触摸：点卡片选中 → 点右下「购买 / 装备」按钮；点「返回菜单」回菜单
// ============================================================
import { Scene } from '../core/scenes.js';
import * as C from '../config.js';
import { skinsByPrice } from '../data/skins.js';
import { drawPlayerSprite } from '../entities/player.js';
import {
  clamp, roundRect, pointInRect, drawNeonButton,
  makeStars, drawBackdrop, drawVignette, drawScanlines,
} from '../core/fx.js';

// ---- 卡片网格布局（设计坐标 720×1280） ----
const COLS = 2;
const CARD_W = 296;
const CARD_H = 176;
const GAP_X = 28;
const GAP_Y = 18;
// 【v1.3 分页】皮肤变多（13 款）以后，原来「所有卡片一路往下排、按钮排在最后一行下面」
// 的做法会把按钮顶到屏幕外（13 款 = 7 行 → 按钮落在 y≈1580，设计高度只有 1280）。
// 所以改成固定每页 2×4 = 8 张：按钮位置由 ROWS 算死、翻页只换卡片，按钮永远不动。
const ROWS = 4;
const PER_PAGE = COLS * ROWS;

export class ShopScene extends Scene {
  enter() {
    const g = this.game;
    this.list = skinsByPrice();          // 按价格从低到高排列
    this.index = this._indexOfEquipped();
    this.page = this._pageOf(this.index);   // 默认翻到「当前装备」所在的那一页
    this.time = 0;
    this.stars = makeStars(90, C.DESIGN_WIDTH, C.DESIGN_HEIGHT);
    this.toast = null;                   // { text, color, timer }
    this._layout(g.engine);
    if (g.audio) g.audio.fadeOutMusic(0.35);   // 商城里不放背景音乐
  }

  exit() { /* 离开时不需要额外清理 */ }

  /** 当前装备的皮肤在列表里的位置（进来时默认选中它） */
  _indexOfEquipped() {
    const equipped = this.game.save.equippedSkin;
    for (let i = 0; i < this.list.length; i++) if (this.list[i].id === equipped) return i;
    return 0;
  }

  _layout(engine) {
    const safe = (engine && engine.safe) || { top: 0, left: 0, right: 0 };
    const W = (engine && engine.designWidth) || C.DESIGN_WIDTH;
    this.pageCount = Math.max(1, Math.ceil(this.list.length / PER_PAGE));
    this.page = clamp(this.page || 0, 0, this.pageCount - 1);
    const gridW = COLS * CARD_W + (COLS - 1) * GAP_X;
    const left = (W - gridW) / 2;
    // 顶部区域重新排距：原来钱包 y=safe.top+84 和标题 y=safe.top+92 只差 8px，
    // 两者都以屏幕中线为中心 → 一定是叠在一起的一团字（以前没人真跑过商城界面）。
    // 现在自上而下依次是：标题 92 → 钱包 158 → 副标题 202 → 页码 246 → 卡片区 278。
    const top = safe.top + 278;
    this.cards = [];
    // 只排当前页的卡片；槽位 slot → 全局索引 page×PER_PAGE+slot
    const first = this.page * PER_PAGE;
    const n = Math.min(PER_PAGE, Math.max(0, this.list.length - first));
    for (let slot = 0; slot < n; slot++) {
      const col = slot % COLS;
      const row = Math.floor(slot / COLS);
      this.cards.push({
        x: left + col * (CARD_W + GAP_X),
        y: top + row * (CARD_H + GAP_Y),
        w: CARD_W,
        h: CARD_H,
      });
    }
    // 按钮区：主操作（购买/装备）+ 返回菜单。
    // 按钮 y 按「满页行数 ROWS」算死（不用当前页的实际行数），翻页时按钮不会跳。
    const btnY = top + ROWS * (CARD_H + GAP_Y) + 8;
    this.actionRect = { x: left, y: btnY, w: 340, h: 84 };
    this.backRect = { x: left + gridW - 250, y: btnY, w: 250, h: 84 };
    this.walletY = safe.top + 158;
    this.hintY = btnY + 116;
    // 翻页按钮：顶部钱包两侧的 ‹ ›（只有一页时不显示也不响应）
    this.prevRect = { x: left, y: safe.top + 56, w: 92, h: 60 };
    this.nextRect = { x: left + gridW - 92, y: safe.top + 56, w: 92, h: 60 };
    this.pageY = safe.top + 246;           // 页码提示，落在副标题与卡片区之间
    return this.cards;
  }

  // ---------------- 逻辑 ----------------
  update(dt) {
    const g = this.game;
    const input = g.input;
    this.time += dt;
    g.fx.update(dt);
    if (this.toast) {
      this.toast.timer -= dt;
      if (this.toast.timer <= 0) this.toast = null;
    }

    // —— 键盘导航：四个方向都只移动选中项 ——
    let moved = false;
    if (input.justPressed('left')) { this._move(-1); moved = true; }
    if (input.justPressed('right')) { this._move(1); moved = true; }
    if (input.justPressed('up')) { this._move(-COLS); moved = true; }
    if (input.justPressed('down')) { this._move(COLS); moved = true; }
    if (moved) {
      // ↑ 会同时触发 up 和 confirm，这里把 confirm 吃掉，避免一按↑就买东西
      input.consume('confirm');
      input.consume('jump');
      g.audio.click();
      return;
    }

    // —— Esc / P 返回菜单 ——
    if (input.justPressed('pause')) {
      input.consume('pause');
      this._back();
      return;
    }

    // —— 触摸 / 鼠标：点卡片选中、点按钮操作 ——
    const p = input.pressPoint;
    if (p) {
      input.consume('jump');
      input.consume('confirm');
      if (pointInRect(p, this.backRect)) { this._back(); return; }
      if (this.pageCount > 1) {
        if (pointInRect(p, this.prevRect)) { this._turnPage(-1); return; }
        if (pointInRect(p, this.nextRect)) { this._turnPage(1); return; }
      }
      for (let slot = 0; slot < this.cards.length; slot++) {
        if (pointInRect(p, this.cards[slot])) {
          const gi = this.page * PER_PAGE + slot;   // 槽位 → 列表全局索引
          if (this.index !== gi) { this.index = gi; g.audio.click(); }
          else { this._primary(); }   // 再点一次已选中的卡片 = 快捷操作
          return;
        }
      }
      if (pointInRect(p, this.actionRect)) { this._primary(); return; }
      return;
    }

    // —— 回车：购买或装备 ——
    if (input.justPressed('confirm')) {
      input.consume('confirm');
      input.consume('jump');
      this._primary();
    }
  }

  /** 移动选中项（越界时夹紧，不循环，避免误操作）；跨页会自动翻页 */
  _move(delta) {
    this._setIndex(clamp(this.index + delta, 0, this.list.length - 1));
  }

  /** 全局索引落在第几页 */
  _pageOf(index) { return Math.floor(index / PER_PAGE); }

  /** 选中第 i 款皮肤：跨页就重排卡片，保证「选中的一定是屏幕上看得见的那张」 */
  _setIndex(i) {
    const next = clamp(i, 0, this.list.length - 1);
    const page = this._pageOf(next);
    this.index = next;
    if (page !== this.page) {
      this.page = page;
      this._layout(this.game.engine);
    }
  }

  /** 翻页（‹ › 按钮或键盘走到页边界时用）：翻完把光标落到该页第一张 */
  _turnPage(delta) {
    const page = clamp(this.page + delta, 0, this.pageCount - 1);
    if (page === this.page) { this.game.audio.deny(); return; }
    this.page = page;
    this._layout(this.game.engine);
    this.index = clamp(this.page * PER_PAGE, 0, this.list.length - 1);
    this.game.audio.click();
  }

  _back() {
    this.game.audio.click();
    // 商城是用 push 压上来的，pop 回去后菜单会走 resume() 刷新钱包与皮肤名
    this.game.scenes.pop();
  }

  /** 主操作：已装备→提示；已拥有→装备；未拥有→购买（够钱就顺手装备） */
  _primary() {
    const g = this.game;
    const skin = this.list[this.index];
    if (!skin) return;

    if (g.save.equippedSkin === skin.id) {
      g.audio.click();
      this._say(skin.name + ' 已经是装备中的皮肤', C.COLORS.neonCyan);
      return;
    }

    if (g.save.ownsSkin(skin.id)) {
      const r = g.save.equipSkin(skin.id);
      if (r.ok) {
        g.audio.equip();
        this._say('已装备 ' + skin.name + '，下一局立刻生效', C.COLORS.neonGreen);
      } else {
        g.audio.deny();
        this._say('装备失败：' + this._reasonText(r.reason), C.COLORS.danger);
      }
      return;
    }

    const r = g.save.buySkin(skin.id);
    if (r.ok) {
      g.audio.buy();
      const e = g.save.equipSkin(skin.id);
      if (e.ok) g.audio.equip();
      this._say('已购买并装备 ' + skin.name + '（-' + skin.price + ' 金币）', C.COLORS.neonGreen);
    } else if (r.reason === 'poor') {
      g.audio.deny();
      this._say('金币不足：还差 ' + (r.need || 0) + ' 金币', C.COLORS.danger);
    } else {
      g.audio.deny();
      this._say('无法购买：' + this._reasonText(r.reason), C.COLORS.danger);
    }
  }

  _reasonText(reason) {
    if (reason === 'poor') return '金币不足';
    if (reason === 'owned') return '已经拥有该皮肤';
    if (reason === 'notOwned') return '还没有拥有该皮肤';
    return '皮肤不存在';
  }

  _say(text, color) {
    this.toast = { text, color: color || C.COLORS.white, timer: 2.2 };
  }

  // ---------------- 渲染 ----------------
  render(ctx, alpha) {
    const g = this.game;
    const W = C.DESIGN_WIDTH;
    const H = C.DESIGN_HEIGHT;
    const safe = (g.engine && g.engine.safe) || { top: 0, left: 0, right: 0 };

    // 背景：和玩法同一套视差背景，只是不进玩法、难度固定很低
    drawBackdrop(ctx, this.stars, this.time, this.time * 70, 0.12, W, H);
    drawVignette(ctx, W, H);
    drawScanlines(ctx, W, H, this.time);

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // —— 标题 ——
    ctx.font = '900 62px "Microsoft YaHei", system-ui, sans-serif';
    ctx.shadowColor = C.COLORS.neonPurple;
    ctx.shadowBlur = 24;
    ctx.fillStyle = C.COLORS.white;
    ctx.fillText('皮 肤 商 城', W / 2, safe.top + 92);
    ctx.shadowBlur = 0;

    // —— 钱包余额 ——
    const walletX = W / 2;
    ctx.font = '700 34px "Microsoft YaHei", system-ui, sans-serif';
    ctx.textAlign = 'left';
    const label = '钱包  ' + g.save.wallet;
    const labelW = ctx.measureText(label).width;
    const coinR = 13;
    const startX = walletX - (labelW + coinR * 2 + 10) / 2;
    ctx.shadowColor = C.COLORS.neonYellow;
    ctx.shadowBlur = 16;
    ctx.fillStyle = C.COLORS.neonYellow;
    ctx.beginPath();
    ctx.arc(startX + coinR, this.walletY, coinR, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath();
    ctx.arc(startX + coinR - 3.5, this.walletY - 3.5, coinR * 0.34, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = C.COLORS.white;
    ctx.fillText(label, startX + coinR * 2 + 10, this.walletY);

    ctx.textAlign = 'center';
    ctx.font = '500 22px "Microsoft YaHei", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText('皮肤只改变外观，不影响判定与任何数值', W / 2, safe.top + 202);

    // —— 皮肤卡片（只画当前页；动画相位用全局索引，翻页后不闪烁） ——
    for (let slot = 0; slot < this.cards.length; slot++) {
      const gi = this.page * PER_PAGE + slot;
      this._drawCard(ctx, this.list[gi], this.cards[slot], gi === this.index, gi);
    }

    // —— 翻页按钮 + 页码（只有一页时整块不出现） ——
    if (this.pageCount > 1) {
      drawNeonButton(ctx, this.prevRect, '‹', {
        color: C.COLORS.neonCyan, fontSize: 42, disabled: this.page === 0,
      });
      drawNeonButton(ctx, this.nextRect, '›', {
        color: C.COLORS.neonCyan, fontSize: 42, disabled: this.page >= this.pageCount - 1,
      });
      ctx.textAlign = 'center';
      ctx.font = '600 24px "Microsoft YaHei", system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillText(
        '第 ' + (this.page + 1) + ' / ' + this.pageCount + ' 页　·　共 ' + this.list.length + ' 款皮肤',
        W / 2, this.pageY,
      );
    }

    // —— 按钮 ——
    this._drawActionButton(ctx);
    drawNeonButton(ctx, this.backRect, '返回菜单', { color: C.COLORS.neonPurple, fontSize: 30 });

    // —— 操作提示 ——
    ctx.textAlign = 'center';
    ctx.font = '500 22px "Microsoft YaHei", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText('← → ↑ ↓ 选择　·　回车 购买 / 装备　·　‹ › 翻页　·　Esc 返回', W / 2, this.hintY);

    // —— 操作反馈（购买成功 / 金币不足都走这里，绝不静默） ——
    if (this.toast) {
      const a = clamp(this.toast.timer / 0.4, 0, 1);
      ctx.globalAlpha = a;
      ctx.font = '700 28px "Microsoft YaHei", system-ui, sans-serif';
      ctx.fillStyle = this.toast.color;
      ctx.shadowColor = this.toast.color;
      ctx.shadowBlur = 14;
      ctx.fillText(this.toast.text, W / 2, this.hintY + 46);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    } else {
      // 静态状态行：当前选中的皮肤该干什么
      ctx.font = '600 26px "Microsoft YaHei", system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillText(this._statusLine(), W / 2, this.hintY + 46);
    }

    ctx.restore();
  }

  /** 选中卡片时下方那句状态说明 */
  _statusLine() {
    const save = this.game.save;
    const skin = this.list[this.index];
    if (!skin) return '';
    if (save.equippedSkin === skin.id) return '当前装备：' + skin.name;
    if (save.ownsSkin(skin.id)) return '按回车装备「' + skin.name + '」';
    if (save.wallet >= skin.price) return '按回车花 ' + skin.price + ' 金币购买「' + skin.name + '」';
    return '「' + skin.name + '」还差 ' + (skin.price - save.wallet) + ' 金币，去跑一局赚金币吧';
  }

  /** 主操作按钮：买得起/已拥有才亮，买不起变灰并写明还差多少 */
  _drawActionButton(ctx) {
    const save = this.game.save;
    const skin = this.list[this.index];
    const r = this.actionRect;
    if (!skin) return;
    const equipped = save.equippedSkin === skin.id;
    const owned = save.ownsSkin(skin.id);
    const poor = !owned && save.wallet < skin.price;

    let label;
    let sub = '';
    let color = skin.colors.glow || C.COLORS.neonCyan;
    if (equipped) { label = '已装备'; sub = '去跑一局试试手感'; }
    else if (owned) { label = '装 备'; sub = '立即生效（下一局换皮）'; }
    else { label = '购买  ' + skin.price + ' 金币'; sub = poor ? '还差 ' + (skin.price - save.wallet) + ' 金币' : '余额 ' + save.wallet + ' → ' + (save.wallet - skin.price); }

    drawNeonButton(ctx, r, label, {
      color,
      sub,
      fontSize: 32,
      disabled: poor || equipped,
      active: !equipped && !poor,
    });
  }

  /** 画一张皮肤卡片（预览复用玩法里的同一个绘制函数） */
  _drawCard(ctx, skin, rect, selected, i) {
    const save = this.game.save;
    const equipped = save.equippedSkin === skin.id;
    const owned = save.ownsSkin(skin.id);
    const poor = !owned && save.wallet < skin.price;

    ctx.save();
    // 卡底
    roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 20);
    ctx.fillStyle = selected ? 'rgba(16,16,52,0.92)' : 'rgba(10,10,36,0.72)';
    ctx.fill();
    // 描边：选中时用皮肤本色的辉光
    ctx.lineWidth = selected ? 3 : 2;
    ctx.strokeStyle = selected ? (skin.colors.glow || C.COLORS.neonCyan) : 'rgba(255,255,255,0.22)';
    ctx.shadowColor = skin.colors.glow || C.COLORS.neonCyan;
    ctx.shadowBlur = selected ? 20 : 0;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // —— 预览：和玩法完全一致的画法 ——
    const pw = 46;
    const ph = 58;
    const px = rect.x + 34;
    const py = rect.y + (rect.h - ph) / 2;
    // 预览用的小底座
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = skin.colors.ground || skin.colors.glow;
    ctx.beginPath();
    ctx.ellipse(px + pw / 2, py + ph + 12, pw * 0.85, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    drawPlayerSprite(ctx, skin, {
      x: px, y: py, w: pw, h: ph,
      time: this.time + i * 0.7,
      // 未拥有的皮肤画得暗一点，一眼能区分「还没买」
      dim: !owned,
    });

    // —— 文字区 ——
    const tx = rect.x + 112;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '800 30px "Microsoft YaHei", system-ui, sans-serif';
    ctx.fillStyle = owned ? skin.colors.glow || C.COLORS.white : 'rgba(255,255,255,0.92)';
    ctx.fillText(skin.name, tx, rect.y + 40);

    ctx.font = '500 20px "Microsoft YaHei", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText(skin.desc, tx, rect.y + 76, rect.w - 118);

    // 状态 / 价格
    ctx.font = '700 24px "Microsoft YaHei", system-ui, sans-serif';
    if (equipped) {
      ctx.fillStyle = C.COLORS.neonGreen;
      ctx.fillText('★ 已装备', tx, rect.y + 122);
    } else if (owned) {
      ctx.fillStyle = C.COLORS.neonCyan;
      ctx.fillText('已拥有', tx, rect.y + 122);
    } else {
      ctx.fillStyle = poor ? C.COLORS.danger : C.COLORS.neonYellow;
      ctx.beginPath();
      ctx.arc(tx + 10, rect.y + 122, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillText(String(skin.price), tx + 28, rect.y + 122);
      if (poor) {
        ctx.font = '600 20px "Microsoft YaHei", system-ui, sans-serif';
        ctx.fillStyle = 'rgba(255,110,110,0.9)';
        ctx.fillText('金币不足', tx + 108, rect.y + 123);
      }
    }

    // 选中角标
    if (selected) {
      ctx.fillStyle = skin.colors.glow || C.COLORS.neonCyan;
      ctx.beginPath();
      ctx.moveTo(rect.x + rect.w - 26, rect.y + 12);
      ctx.lineTo(rect.x + rect.w - 12, rect.y + 12);
      ctx.lineTo(rect.x + rect.w - 12, rect.y + 26);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
}