// ============================================================
// levels.js —— 闯关模式的 5 关数据表（纯数据 + 纯函数，零依赖）
//
// 设计依据：docs/关卡设计.md（§2 / §3）。这里只放「数据」和「可被测试直接
// 引用的纯函数」，不含任何渲染/输入/存档逻辑，因此 tests/smoke.mjs 可以
// 直接 import 本文件复算关卡数值。
//
// 单位约定：
//   length / rampDistance / firstSpawnGap / gapMargin  → 设计像素（HUD 里与「米」1:1）
//   startSpeed / peakSpeed                             → 设计像素/秒
//   intervalStart / intervalEnd / comboReaction        → 秒
//   高度/宽度/金币高度                                  → 设计像素
//
// 【可达性红线】闯关模式生成时的速度地板用「本关自己的 peakSpeed」，
//   而不是全局 MAX_SPEED（否则低关卡会被按 980 撑稀）。证明：
//     关卡速度恒满足 speed ≤ peakSpeed；
//     生成时 airGap ≥ AIR_TIME×peakSpeed + gapMargin = 0.70×peak + 90；
//     而硬约束线 minGap(speed) = 0.70×speed − 26 ≤ 0.70×peak − 26 < 0.70×peak + 90。
//   故硬约束在数学上恒成立（等价实现见 spawner.computeNextGap 的 peakSpeed 参数）。
// ============================================================
import { ease, AIR_TIME, BASE_SPEED, MAX_SPEED, SPEED_RAMP_DISTANCE,
  GAP_MARGIN, FIRST_SPAWN_GAP, difficultyAt, speedAt } from '../config.js';

/** 关卡通用安全余量（px）：地板 = AIR_TIME×peak + 90 > 硬约束 AIR_TIME×speed − 26 */
export const LEVEL_GAP_MARGIN = 90;
/** 关卡模式把出生点再往右推 60px，给高速关留出更多「看见障碍」的时间（零风险，不进可达性公式） */
export const LEVEL_SPAWN_PAD = 140;
/** 通关条件类型枚举（UI 图标 / 文案用） */
export const GOAL_KINDS = { DISTANCE: 'distance', COINS: 'coins', TIME: 'time', NOHIT: 'nohit' };

export const LEVELS = [
  {
    id: 'L1', name: '霓虹起步', theme: '学会在什么时候按一下',
    paletteIndex: 0,                    // 锁定 BG_PALETTES[0]（紫蓝）
    length: 10200,                      // px
    startSpeed: 340, peakSpeed: 440, rampDistance: 4000,   // ramp ≈ 10.3s，纯跑 24.4s
    firstSpawnGap: 1200,                // px（≥ startSpeed×2.2 的热身空路）
    shields: 2,
    gapMargin: LEVEL_GAP_MARGIN,
    spawn: {
      intervalStart: 1.35, intervalEnd: 1.10,   // s；反应余量 0.65→0.40
      tallChance: 0,                            // 本关不出高障碍
      lowWidth: [44, 70], lowHeight: [50, 110],
      tallWidth: [58, 96], tallHeight: [215, 250],   // 未使用（tallChance = 0）
      comboChance: 0, comboReaction: 0.45, postComboMul: 1.55, tripleChance: 0,
      tallFollowMul: 1.15,
    },
    coins: {
      chance: 0.70, countMin: 3, countMax: 5,
      lift: [52, 84], arc: [40, 70],
      highChance: 0, highLift: [220, 268],      // 高空币（需二段跳）本关不启用
      pityGaps: 3,
    },
    goal: { distance: 10200, coins: 0, maxHits: 2, time: 0 },
    star2Coins: 16, star3Coins: 16,
  },

  {
    id: 'L2', name: '高墙初现', theme: '第二下跳才是关键',
    paletteIndex: 1,                    // 青蓝
    length: 15000,
    startSpeed: 380, peakSpeed: 520, rampDistance: 6000,   // ramp 13.3s，纯跑 30.6s
    firstSpawnGap: 1400,
    shields: 2,
    gapMargin: LEVEL_GAP_MARGIN,
    spawn: {
      intervalStart: 1.30, intervalEnd: 1.05,   // 反应余量 0.60→0.35
      tallChance: 0.15,
      lowWidth: [44, 74], lowHeight: [55, 120],
      tallWidth: [58, 88], tallHeight: [215, 232],   // > SINGLE_JUMP_HEIGHT(195)：必须二段跳
      comboChance: 0.15, comboReaction: 0.30, postComboMul: 1.55, tripleChance: 0,
      tallFollowMul: 1.18,
    },
    coins: {
      chance: 0.70, countMin: 3, countMax: 5,
      lift: [52, 84], arc: [40, 72],
      highChance: 0.20, highLift: [220, 268],
      pityGaps: 3,
    },
    goal: { distance: 15000, coins: 15, maxHits: 2, time: 0 },
    star2Coins: 20, star3Coins: 20,
  },

  {
    id: 'L3', name: '连跳节奏', theme: '落地就要再起跳',
    paletteIndex: 2,                    // 品红
    length: 21600,
    startSpeed: 430, peakSpeed: 620, rampDistance: 8600,   // ramp 16.4s，纯跑 37.4s
    firstSpawnGap: 1500,
    shields: 2,
    gapMargin: LEVEL_GAP_MARGIN,
    spawn: {
      intervalStart: 1.24, intervalEnd: 1.00,   // 反应余量 0.54→0.30
      tallChance: 0.25,
      lowWidth: [46, 80], lowHeight: [60, 128],
      tallWidth: [58, 92], tallHeight: [216, 238],
      comboChance: 0.28, comboReaction: 0.24, postComboMul: 1.55, tripleChance: 0,
      tallFollowMul: 1.20,
    },
    coins: {
      chance: 0.68, countMin: 3, countMax: 5,
      lift: [25, 92], arc: [40, 76],            // 双弧：贴地币 + 高空币 = 路线二选一
      highChance: 0.35, highLift: [222, 272],
      pityGaps: 3,
    },
    goal: { distance: 21600, coins: 22, maxHits: 0, time: 0 },   // 无伤关
    star2Coins: 25, star3Coins: 32,
  },

  {
    id: 'L4', name: '极速限时', theme: '每一秒都在被扣',
    paletteIndex: 3,                    // 橙红
    length: 31000,
    startSpeed: 490, peakSpeed: 740, rampDistance: 12400,  // ramp 20.2s，纯跑 45.3s
    firstSpawnGap: 1600,
    shields: 1,
    gapMargin: LEVEL_GAP_MARGIN,
    spawn: {
      intervalStart: 1.18, intervalEnd: 0.96,   // 反应余量 0.48→0.26
      tallChance: 0.34,
      lowWidth: [50, 86], lowHeight: [64, 132],
      tallWidth: [62, 96], tallHeight: [218, 244],
      comboChance: 0.40, comboReaction: 0.18, postComboMul: 1.55, tripleChance: 0,
      tallFollowMul: 1.22,
    },
    coins: {
      chance: 0.65, countMin: 3, countMax: 5,
      lift: [52, 88], arc: [44, 80],
      highChance: 0.45, highLift: [224, 278],
      pityGaps: 3,
    },
    goal: { distance: 31000, coins: 20, maxHits: 1, time: 50 },   // 50 = 45.30 × 1.104
    star2Coins: 31, star3Coins: 31,
    hitPenalty: { slowMul: 0.65, slowTime: 2.0, timeLoss: 2.0 },  // 限时关专用惩罚
  },

  {
    id: 'L5', name: '霓虹心脏', theme: '把前面四关合起来',
    paletteIndex: 4,                    // 第 5 套调色板（BG_PALETTES 里追加）
    length: 45600,
    startSpeed: 560, peakSpeed: 940, rampDistance: 18200,  // ramp 24.3s，纯跑 53.4s
    firstSpawnGap: 1800,
    shields: 1,
    gapMargin: LEVEL_GAP_MARGIN,
    spawn: {
      intervalStart: 1.12, intervalEnd: 0.92,   // 反应余量 0.42→0.22（人类下限，别再压）
      tallChance: 0.42,
      lowWidth: [54, 96], lowHeight: [70, 132],
      tallWidth: [64, 96], tallHeight: [220, 250],
      comboChance: 0.52, comboReaction: 0.12, postComboMul: 1.70, tripleChance: 0.25,
      tallFollowMul: 1.25,
    },
    coins: {
      chance: 0.62, countMin: 3, countMax: 5,
      lift: [52, 92], arc: [44, 84],
      highChance: 0.55, highLift: [226, 286],
      pityGaps: 3,
    },
    goal: { distance: 45600, coins: 30, maxHits: 1, time: 0 },
    star2Coins: 35, star3Coins: 35,
  },
];

// ---------- 纯函数（可被 tests/smoke.mjs 直接引用） ----------

/** 按 id 取关卡；查不到时回退第 1 关（永不 undefined） */
export function getLevel(id) { return LEVELS.find((l) => l.id === id) || LEVELS[0]; }

/** 关卡难度进度 0..1（复用与无尽模式同一条 smoothstep） */
export function levelDifficultyAt(level, distance) {
  return ease(distance / level.rampDistance);
}

/** 关卡当前速度（设计像素/秒）；上确界就是 peakSpeed */
export function levelSpeedAt(level, distance) {
  return level.startSpeed + (level.peakSpeed - level.startSpeed) * levelDifficultyAt(level, distance);
}

/**
 * 纯跑时长（秒）——测试用它自动核算关卡特长有没有被改动。
 * 依据：smoothstep 在 [0,1] 上的积分恰为 0.5，所以爬升段的平均速度
 * 精确等于 (start + peak) / 2，无需数值积分。
 */
export function levelRunSeconds(level) {
  const rampAvg = (level.startSpeed + level.peakSpeed) / 2;
  return level.rampDistance / rampAvg + (level.length - level.rampDistance) / level.peakSpeed;
}

/** 可达性地板（px）：恒大于硬约束线 AIR_TIME×speed − MAX_OBSTACLE_WIDTH + GAP_MARGIN */
export function levelGapFloor(level) {
  return AIR_TIME * level.peakSpeed + level.gapMargin;
}

/** 组合内部的最小间距（px）：连跳不许比「落地立刻再起跳」更紧 */
export function levelComboGap(level, speed) {
  return speed * (AIR_TIME + level.spawn.comboReaction);
}

/** 估算障碍数（经济自洽校验用；按平均速度 × 平均间隔估算，是偏保守的上界） */
export function expectedObstacles(level) {
  const avgSpeed = (level.startSpeed + level.peakSpeed) / 2;
  const avgInterval = (level.spawn.intervalStart + level.spawn.intervalEnd) / 2;
  return level.length / (avgSpeed * avgInterval);
}

/** 估算金币供给（枚）：障碍数 × 撒币概率 × 平均数量 */
export function expectedCoinSupply(level) {
  const avgCount = (level.coins.countMin + level.coins.countMax) / 2;
  return expectedObstacles(level) * level.coins.chance * avgCount;
}

/**
 * 通关判定（纯函数）。必要条件永远是「跑到终点」，其余是附加项：
 *   passed = distance ≥ goal.distance
 *         && coins    ≥ goal.coins
 *         && hits     ≤ goal.maxHits
 *         && (goal.time === 0 || elapsed + timePenalty ≤ goal.time)
 * @returns {{passed:boolean, checks:Array<{id:string,label:string,ok:boolean,value:string}>}}
 */
export function evalClear(level, run) {
  const g = level.goal;
  const r = run || {};
  const distance = r.distance || 0;
  const coins = r.coins || 0;
  const hits = r.hits || 0;
  const elapsed = r.elapsed || 0;
  const timePenalty = r.timePenalty || 0;
  const totalTime = elapsed + timePenalty;

  const checks = [
    { id: 'distance', label: '跑到终点', ok: distance >= g.distance,
      value: Math.floor(distance) + ' / ' + g.distance },
  ];
  if (g.coins > 0) {
    checks.push({ id: 'coins', label: '金币 ≥ ' + g.coins, ok: coins >= g.coins,
      value: coins + ' / ' + g.coins });
  }
  if (g.maxHits < 99) {
    checks.push({ id: 'hits', label: '撞击 ≤ ' + g.maxHits, ok: hits <= g.maxHits,
      value: String(hits) + ' / ' + g.maxHits });
  }
  if (g.time > 0) {
    checks.push({ id: 'time', label: '限时 ' + g.time + 's', ok: totalTime <= g.time,
      value: totalTime.toFixed(1) + 's' });
  }
  return { passed: checks.every((c) => c.ok), checks };
}

/**
 * 星级判定（纯函数）：
 *   0★ 未通关；1★ 通关；2★ 通关 + 金币 ≥ star2Coins；
 *   3★ 通关 + 金币 ≥ star3Coins + 0 撞击。
 * （L1/L2/L4/L5 的 star3Coins === star2Coins，于是 3★ 就是「★★ 且无伤」；
 *   L3 的 star3Coins 更严（32 > 25），对应设计稿「金币线加倍严格」。）
 */
export function evalStars(level, run) {
  const r = run || {};
  const passed = r.passed !== undefined ? r.passed : evalClear(level, r).passed;
  if (!passed) return 0;
  const coins = r.coins || 0;
  const hits = r.hits || 0;
  if (coins >= level.star3Coins && hits === 0) return 3;
  if (coins >= level.star2Coins) return 2;
  return 1;
}

/** 把 level 翻成「生成器配方」：spawner 只认这个对象，两种模式共用同一套生成代码 */
export function levelRecipe(level) {
  return Object.assign({}, level.spawn, {
    gapMargin: level.gapMargin,
    spawnPad: LEVEL_SPAWN_PAD,
    firstSpawnGap: level.firstSpawnGap,
    coins: level.coins,
  });
}

/** 闯关模式的规则对象（PlayScene 唯一的分叉口之一） */
export function levelRules(id) {
  const level = getLevel(id);
  return {
    mode: 'level',
    levelId: level.id,
    level,
    length: level.length,
    startSpeed: level.startSpeed,
    peakSpeed: level.peakSpeed,
    rampDistance: level.rampDistance,
    difficultyAt: (d) => levelDifficultyAt(level, d),
    speedAt: (d) => levelSpeedAt(level, d),
    firstSpawnGap: level.firstSpawnGap,
    gapMargin: level.gapMargin,
    shields: level.shields,
    goal: level.goal,
    paletteIndex: level.paletteIndex,
    star2Coins: level.star2Coins,
    star3Coins: level.star3Coins,
    hitPenalty: level.hitPenalty || null,
    recipe: levelRecipe(level),
  };
}

/**
 * 无尽模式的规则对象。
 * 【红线】这里必须与 config 逐字段等价：speedAt/difficultyAt 直接引用 config 的
 * 同名函数（同一函数引用），gapMargin === config.GAP_MARGIN(70)，shields = Infinity，
 * recipe = null（生成器走「默认配方 = 现有常量」分支）。任何漂移都会被 smoke 的
 * 回归断言抓住。
 */
export function endlessRules() {
  return {
    mode: 'endless',
    levelId: null,
    level: null,
    length: Infinity,
    startSpeed: BASE_SPEED,
    peakSpeed: MAX_SPEED,
    rampDistance: SPEED_RAMP_DISTANCE,
    difficultyAt: difficultyAt,
    speedAt: speedAt,
    firstSpawnGap: FIRST_SPAWN_GAP,
    gapMargin: GAP_MARGIN,
    shields: Infinity,
    goal: null,
    paletteIndex: null,
    star2Coins: null,
    star3Coins: null,
    hitPenalty: null,
    recipe: null,
  };
}

/** 通关条件图标 / 文案（选关页与结算页共用） */
export function goalBadges(level) {
  const g = level.goal;
  const out = [{ icon: '🏁', text: '跑完 ' + g.distance }];
  if (g.coins > 0) out.push({ icon: '◎', text: '金币 ' + g.coins });
  if (g.time > 0) out.push({ icon: '⏱', text: '限时 ' + g.time + 's' });
  if (g.maxHits === 0) out.push({ icon: '⛨', text: '无伤' });
  return out;
}