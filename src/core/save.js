// ============================================================
// save.js —— 本地存档（localStorage）
// 存：最高分、游玩次数、累计距离/金币、跨局钱包、已拥有/已装备皮肤、
//     设置开关、以及可选的“继续游戏”快照。
// 所有读取都做了容错：存档损坏、隐私模式禁用 localStorage 都不会让游戏崩溃。
//
// 【向后兼容迁移】
//   存储键名一直是 neon-dash.save.v1（不换键，旧玩家的分数才不会丢）。
//   v1.1 新增了 wallet / ownedSkins / equippedSkin 三个字段，
//   迁移策略是「缺什么补什么」：
//     · 旧存档没有这些字段 → 用 defaultSave() 的值兜底
//     · 字段类型不对（手改存档、NaN、数组里混进数字）→ 逐个清洗成合法值
//     · equippedSkin 不在 ownedSkins 里 → 强制回退到默认皮肤（防止白嫖/脏数据）
//   整个过程包在 try/catch 里，任何一步出问题都只是回退到默认存档，绝不抛错。
//
//   v1.2 新增了 campaign（闯关进度）一个字段，SAVE_VERSION 2 → 3。
//   迁移只做「字段级」的补全与清洗：
//     · 旧档没有 campaign → 补默认值（从第 1 关开始）
//     · campaign 被改坏（比如 stars 是数组）→ 【只重置 campaign】，
//       wallet / bestScore / ownedSkins / settings / resume 一律原样保留
//   存储键名不变，所以老玩家的分数、金币、皮肤、设置、继续快照都不会丢。
// ============================================================
import { DEFAULT_SKIN_ID, SKINS, hasSkin } from '../data/skins.js';
import { LEVELS } from '../data/levels.js';

export const STORAGE_KEY = 'neon-dash.save.v1';
export const SAVE_VERSION = 3;
export const INITIAL_WALLET = 0;       // 新玩家钱包余额

/** 一份全新的存档长什么样 */
export function defaultSave() {
  return {
    version: SAVE_VERSION,
    bestScore: 0,
    playCount: 0,
    totalDistance: 0,
    totalCoins: 0,
    wallet: INITIAL_WALLET,            // 跨局钱包：结算时把本局金币存进来
    // 用户要求：旧的图片皮肤下线、得意胖子免费领取 —— 初始拥有列表【只有 classic】。
    // price === 0 的 fatblob 是「免费但要手动领取」，绝不放进这里，
    // 否则开局就自动拥有、商城里也就领不了了（免费 ≠ 默认拥有）。
    ownedSkins: [DEFAULT_SKIN_ID],     // 默认皮肤开局就拥有
    equippedSkin: DEFAULT_SKIN_ID,     // 当前装备（只影响外观）
    settings: {
      sfx: true,      // 音效
      music: true,    // 音乐
      vibrate: true,  // 震动（仅支持 navigator.vibrate 的设备）
    },
    resume: null,     // 中途退出时的快照 { score, distance, coins }
    // v1.2：闯关模式进度。unlocked = 已解锁到第几关（1..5）
    campaign: { unlocked: 1, stars: {}, bestScore: {}, cleared: 0 },
  };
}

export class Save {
  constructor(storage) {
    // 允许注入自定义 storage（方便测试）；默认用浏览器的 localStorage
    if (storage) {
      this.storage = storage;
    } else {
      try {
        this.storage = typeof localStorage !== 'undefined' ? localStorage : null;
      } catch (e) {
        this.storage = null;   // 某些隐私模式下访问 localStorage 会直接抛错
      }
    }
    this.data = defaultSave();
    this.available = !!this.storage;
  }

  /** 读档：坏数据一律回退到默认值 */
  load() {
    const base = defaultSave();
    if (!this.storage) { this.data = base; return this.data; }
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) { this.data = base; return this.data; }
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') { this.data = base; return this.data; }
      // 用默认值兜底，旧版本存档缺少的字段会自动补上
      this.data = Object.assign({}, base, parsed);
      this.data.settings = Object.assign({}, base.settings, parsed.settings || {});
      // 类型纠正，防止手改存档导致 NaN
      this.data.bestScore = Number(this.data.bestScore) || 0;
      this.data.playCount = Number(this.data.playCount) || 0;
      this.data.totalDistance = Number(this.data.totalDistance) || 0;
      this.data.totalCoins = Number(this.data.totalCoins) || 0;
      this.data.settings.sfx = this.data.settings.sfx !== false;
      this.data.settings.music = this.data.settings.music !== false;
      this.data.settings.vibrate = this.data.settings.vibrate !== false;
      if (this.data.resume && typeof this.data.resume !== 'object') this.data.resume = null;
      this._migrateWalletAndSkins(base);
      this._migrateCampaign();
      this.data.version = SAVE_VERSION;   // 迁移完成，标记为当前版本
    } catch (e) {
      console.warn('[save] 存档读取失败，已重置：', e);
      this.data = base;
    }
    return this.data;
  }

  /**
   * v1.1 迁移：钱包 + 皮肤字段。任何脏数据都清洗成合法值，绝不抛错。
   * 单独抽成方法，方便测试直接构造旧存档验证。
   *
   * 【用户要求：旧的图片皮肤下线、得意胖子免费领取】这里【没有】任何「price === 0 就等于
   * 已拥有」的逻辑（以前也没有），只保证 classic 默认拥有；已被下线的皮肤 id
   * 会被 hasSkin() 过滤掉，若它正好是 equippedSkin，就会自动回退到 classic。
   */
  _migrateWalletAndSkins(base) {
    // ---- 钱包：必须是 >= 0 的整数 ----
    let wallet = Number(this.data.wallet);
    if (!Number.isFinite(wallet) || wallet < 0) wallet = base.wallet;
    this.data.wallet = Math.floor(wallet);

    // ---- 已拥有皮肤：必须是「数组 + 合法 id + 去重」 ----
    const owned = [];
    const seen = new Set();
    const rawOwned = Array.isArray(this.data.ownedSkins) ? this.data.ownedSkins : [];
    for (const item of rawOwned) {
      if (typeof item !== 'string' || !hasSkin(item) || seen.has(item)) continue;
      seen.add(item);
      owned.push(item);
    }
    if (!seen.has(DEFAULT_SKIN_ID)) owned.unshift(DEFAULT_SKIN_ID);   // 默认皮肤永远算拥有
    this.data.ownedSkins = owned;

    // ---- 已装备皮肤：必须真实存在且确实拥有，否则回退默认 ----
    const equipped = this.data.equippedSkin;
    this.data.equippedSkin = (typeof equipped === 'string' && owned.indexOf(equipped) >= 0)
      ? equipped
      : DEFAULT_SKIN_ID;
  }

  /**
   * v1.2 迁移：闯关进度 campaign。任何脏数据都只重置 campaign 本身，
   * 绝不动 wallet / bestScore / totalCoins / ownedSkins / settings / resume。
   */
  _migrateCampaign() {
    const n = LEVELS.length;
    const fresh = () => ({ unlocked: 1, stars: {}, bestScore: {}, cleared: 0 });
    const c = this.data.campaign;
    const objOk = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
    if (!objOk(c) || !objOk(c.stars) || !objOk(c.bestScore)) {
      this.data.campaign = fresh();     // 非法 → 只重置 campaign
      return;
    }

    // 逐关清洗：星级 0..3、最高分 >= 0；只认识 LEVELS 里存在的关卡 id
    const stars = {};
    const bestScore = {};
    for (const lv of LEVELS) {
      const s = Number(c.stars[lv.id]);
      if (Number.isFinite(s) && s >= 0) stars[lv.id] = Math.min(3, Math.floor(s));
      const b = Number(c.bestScore[lv.id]);
      if (Number.isFinite(b) && b >= 0) bestScore[lv.id] = Math.floor(b);
    }

    // 已通关数：以星级表为准，并与存档里记的值取较大者（防止手改档把进度改小）
    let passCount = 0;
    for (const lv of LEVELS) if ((stars[lv.id] || 0) > 0) passCount++;
    let cleared = Number(c.cleared);
    if (!Number.isFinite(cleared) || cleared < 0) cleared = 0;
    cleared = Math.min(n, Math.max(Math.floor(cleared), passCount));
    let unlocked = Number(c.unlocked);
    if (!Number.isFinite(unlocked)) unlocked = 1;
    unlocked = Math.min(n, Math.max(1, Math.floor(unlocked), cleared + 1));

    this.data.campaign = { unlocked, stars, bestScore, cleared };
  }

  /** 写档：失败也不抛错（存储满了 / 隐私模式） */
  save() {
    if (!this.storage) return false;
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.data));
      return true;
    } catch (e) {
      console.warn('[save] 存档写入失败：', e);
      return false;
    }
  }

  /** 清空存档 */
  reset() {
    this.data = defaultSave();
    if (this.storage) {
      try { this.storage.removeItem(STORAGE_KEY); } catch (e) { /* 忽略 */ }
    }
  }

  get settings() { return this.data.settings; }
  get bestScore() { return this.data.bestScore; }
  get wallet() { return this.data.wallet; }
  get equippedSkin() { return this.data.equippedSkin; }

  /** 切换一个设置项并立即保存 */
  setSetting(key, value) {
    if (!(key in this.data.settings)) return;
    this.data.settings[key] = !!value;
    this.save();
  }

  // ---------------- 金币与皮肤 ----------------
  /**
   * 加币（结算、活动奖励都用它）。传入负数会被忽略，防止手滑洗钱。
   * @returns {number} 加完之后的钱包余额
   */
  addCoins(n) {
    const add = Math.floor(Number(n) || 0);
    if (add > 0) this.data.wallet += add;
    this.save();
    return this.data.wallet;
  }

  /** 是否已拥有某皮肤 */
  ownsSkin(id) {
    return this.data.ownedSkins.indexOf(id) >= 0;
  }

  /**
   * 买皮肤：钱包不够 / 已经拥有 / id 非法都返回明确原因，绝不静默失败。
   * 【用户要求：得意胖子免费领取】price === 0 时这里就是「免费领取」：
   * 扣 0 金币、写进 ownedSkins、立刻存档（调用方通常紧接着 equipSkin 装备）。
   * 注意：能领到的前提是【尚未拥有】—— 0 价不等于默认拥有。
   * @returns {{ok:boolean, reason?:string, skin?:object, wallet:number}}
   */
  buySkin(id) {
    if (!hasSkin(id)) return { ok: false, reason: 'invalid', wallet: this.data.wallet };
    if (this.ownsSkin(id)) return { ok: false, reason: 'owned', wallet: this.data.wallet };
    const price = skinPrice(id);
    if (this.data.wallet < price) {
      return { ok: false, reason: 'poor', wallet: this.data.wallet, need: price - this.data.wallet };
    }
    this.data.wallet -= price;
    this.data.ownedSkins.push(id);
    this.save();
    return { ok: true, wallet: this.data.wallet, price };
  }

  /**
   * 装备皮肤：只有已拥有的才能装备，否则返回原因。
   * @returns {{ok:boolean, reason?:string}}
   */
  equipSkin(id) {
    if (!hasSkin(id)) return { ok: false, reason: 'invalid' };
    if (!this.ownsSkin(id)) return { ok: false, reason: 'notOwned' };
    this.data.equippedSkin = id;
    this.save();
    return { ok: true };
  }

  /**
   * 一局结束后记录成绩：本局金币在结算时存入跨局钱包。
   * @param {{score:number,distance:number,coins:number,updateBest?:boolean}} run
   *   updateBest = false 时不更新全局最高分（闯关模式走 recordLevel，不走这里；
   *   这个开关只是给「不想污染无尽最高分」的调用方留的口子）。
   */
  recordRun(run) {
    const score = Math.max(0, Math.floor(run.score || 0));
    const coins = Math.max(0, Math.floor(run.coins || 0));
    const updateBest = !(run && run.updateBest === false);
    this.data.playCount += 1;
    this.data.totalDistance += Math.max(0, Math.floor(run.distance || 0));
    this.data.totalCoins += coins;
    this.data.wallet += coins;                 // ← 本局金币进钱包
    const isRecord = updateBest && score > this.data.bestScore;
    if (isRecord) this.data.bestScore = score;
    this.data.resume = null;
    this.save();
    return { isRecord, best: this.data.bestScore, wallet: this.data.wallet, earned: coins };
  }

  /**
   * 闯关结算：写 campaign 进度，金币照常入钱包（商城经济不能断），
   * 但【不写全局 bestScore】—— 闯关分数只记在 campaign.bestScore[levelId]。
   * @param {{levelId:string, stars:number, score:number, coins:number}} run
   * @returns {{ok:boolean, reason?:string, stars:number, best:number,
   *            wallet:number, unlocked:number, cleared:number}}
   */
  recordLevel(run) {
    const levelId = run && typeof run.levelId === 'string' ? run.levelId : '';
    const level = LEVELS.find((l) => l.id === levelId);
    if (!level) {
      return { ok: false, reason: 'invalid', stars: 0, best: 0,
        wallet: this.data.wallet, unlocked: this.data.campaign.unlocked,
        cleared: this.data.campaign.cleared };
    }
    const stars = Math.max(0, Math.min(3, Math.floor(Number(run.stars) || 0)));
    const score = Math.max(0, Math.floor(Number(run.score) || 0));
    const coins = Math.max(0, Math.floor(Number(run.coins) || 0));

    const c = this.data.campaign;
    c.stars[levelId] = Math.max(Number(c.stars[levelId]) || 0, stars);      // 只增不减
    c.bestScore[levelId] = Math.max(Number(c.bestScore[levelId]) || 0, score);

    // 已通关数 = 星级表里 ≥1★ 的关数；与旧值取大，解锁数跟着走
    let passCount = 0;
    for (const lv of LEVELS) if ((Number(c.stars[lv.id]) || 0) > 0) passCount++;
    c.cleared = Math.min(LEVELS.length, Math.max(c.cleared, passCount));
    c.unlocked = Math.min(LEVELS.length, Math.max(1, c.cleared + 1));

    this.data.totalCoins += coins;
    this.data.wallet += coins;                 // ← 闯关金币照常进钱包
    this.save();
    return { ok: true, stars: c.stars[levelId], best: c.bestScore[levelId],
      wallet: this.data.wallet, unlocked: c.unlocked, cleared: c.cleared };
  }

  /** 保存“继续游戏”的快照 */
  saveResume(snapshot) {
    this.data.resume = snapshot ? {
      score: Math.floor(snapshot.score || 0),
      distance: Math.max(0, Math.floor(snapshot.distance || 0)),
      coins: Math.max(0, Math.floor(snapshot.coins || 0)),
    } : null;
    this.save();
  }
}

// 局部小工具：价格只在 skins.js 里定义，这里不抄一份（抄了迟早会不一致）
function skinPrice(id) {
  for (const s of SKINS) if (s.id === id) return s.price;
  return 0;
}