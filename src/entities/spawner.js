// ============================================================
// spawner.js —— 障碍 / 金币 / 平台 / 弹簧生成器
//
// 关键设计：障碍之间的间距不能拍脑袋，必须做「可达性校验」。
// 推导：设滚动速度 S，一次完整跳跃的滞空时间 T（config.AIR_TIME），
//       那么一次跳跃最多前进 S*T 的距离。
//       如果玩家在障碍 A 的最后一刻起跳，落地会在 A 右边缘再往前 S*T，
//       所以 A 和下一个障碍 B 之间的空隙至少要能容纳这个距离，否则
//       玩家落地时已经撞上 B —— 那就成了无解关卡。
//       实际公式：最小空气空隙 = S * T + 安全余量
//       （用「整段滞空时间」而不是扣掉障碍宽度，宁可留宽松一点，
//         因为多留白只是看着稀疏，少留白就是死局。）
//       注意这个下限随速度线性增长，而速度上限被 config 锁死，
//       所以即使难度曲线改缓，可达性下限也永远跟着当前速度走，不会失效。
//       校验用的保守公式（见 verifyReachability）是
//         minGap = S * T - MAX_OBSTACLE_WIDTH + GAP_MARGIN，
//       生成本身留得比它宽，所以那条断言恒成立。
// 生成器每次算完空隙都会和这个下限取最大值。
//
// 一个容易踩的坑（v1.1 修掉）：间距是按「左边缘到左边缘」推进的，
// 而可达性看的是「上一根的右边缘 → 下一根的左边缘」。
// 不算上一根的宽度，实际空隙就比下限少了最多 MAX_OBSTACLE_WIDTH，
// 速度一涨就会凭空出现跳不过去的组合。
//
// 【v1.1 改动】
//   1) 难度进度不再自己算 distance/SPEED_RAMP_DISTANCE，而是由 play.js
//      统一传入 config.difficultyAt(distance) 的结果 —— 速度、间隔、高障碍
//      概率从此读同一个数，不可能再出现两条难度轴跑偏。
//   2) 障碍与金币改为「对象池」，吃掉的/出界的回收到池里复用，
//      运行时不再反复 new 对象（性能红线）。
//   3) 被吃掉的金币在本帧移动后立即从数组移除并回池，
//      修掉 README 里记的「taken 金币会一直留在数组里」的 TODO。
//   4) 障碍渐变缓存在对象上（障碍的 y 永远不变，竖向渐变可以长期复用），
//      不再每帧 createLinearGradient。
//   5) 可达性下限加「前瞻」：难度是涨的，间距被跳过时的速度比生成时更高，
//      所以按 distance + GAP_LEAD 处的速度算下限（详见 GAP_LEAD 注释）。
//   6) lastObstacleRight 每帧跟着世界左移 —— 不修的话空隙永远算成负数，
//      除了第一根障碍之外再也不会撒金币（金币经济直接废掉）。
//
// 【v1.2 改动（闯关模式）】
//   1) 间距/尺寸/概率/金币全部改从「配方（recipe）」读，配方由 play.js 注入：
//      无尽模式不注入 → 走 DEFAULT_RECIPE，逐字节等价于 v1.1 的写死常量。
//   2) computeNextGap / update 增加第 5 个参数 peakSpeed：闯关模式把本关速度上限
//      当地板，数学上保证 airGap ≥ AIR_TIME×peak + gapMargin，恒大于硬约束线。
//   3) 新增「组合（cluster）」间距：连跳/双连跳/高后低/三连，内部间距 =
//      reachSpeed × (AIR_TIME + comboReaction)，收尾后下一段 ×postComboMul。
//      无尽模式 comboChance = 0，永不触发。
//   4) 新增高障碍正上方的高空金币（highChance）与金币保底（pityGaps）。
//   5) breakObstacle()：护盾抵扣时把撞到的障碍移出并回池。
//
// 【v1.3 改动（本文件最大的一次改动）】
//   A. 金币分布修正（只对无尽模式生效，闯关模式走 V12 分支、逐字节不变）：
//      · 弧线两端压进「贴地档」（45~70px），弧顶夹到 ≤260px，任何一种金币
//        离地都不超过 COIN_HARD_TOP = 345（= 二段跳顶点）；
//      · 新增「地面线」图案（整条都在贴地档，跑着就能一路吃），
//        并由 groundForceDist 强制保底：连续 500px 没撒出金币时下一段必出；
//      · 数量随难度缓增（早期 2~4 颗 → 后期 5~8 颗），不再「要么 0 要么恒 5」；
//      · 高空金币改成「以障碍顶面为基准」，下沿永远高于障碍顶面 ≥24px，
//        彻底消灭「金币嵌在障碍盒子里」的重叠。
//   B. 三种新机制（由 DEFAULT_RECIPE.move / .deck / .spring 注入，
//      总开关 config.ENDLESS_MECHANICS；闯关模式这三项根本不存在 → 永不触发）：
//      · 移动障碍：水平巡逻（worstX/worstW 最坏包络）或垂直伸缩（有效高度只减不增）；
//      · 上下双层平台 + 坠落地形：单向平台（只从上方落上去）+ surfaceY() 契约；
//      · 弹簧跳板：SPRING_VELOCITY = 1520 → 顶点 444px > 430px 红线。
//      【红线】三者都只让游戏更安全：移动障碍的最坏包络仍然满足
//        minGap = speed×AIR_TIME − MAX_OBSTACLE_WIDTH + GAP_MARGIN；
//        垂直伸缩的有效高度恒 ≤ 静态高度；平台 deckH + 20 ≤ 二段跳顶点；
//        弹簧永远只是加分项，地面障碍的可达性仍按原有跳跃能力算。
// ============================================================
import {
  DESIGN_WIDTH, GROUND_Y, speedAt, PLAYER_X_RATIO, PLAYER_WIDTH,
  GRAVITY, FALL_MULTIPLIER, JUMP_VELOCITY, DOUBLE_JUMP_VELOCITY,
  SPAWN_INTERVAL_START, SPAWN_INTERVAL_MIN, AIR_TIME, GAP_MARGIN,
  MIN_OBSTACLE_WIDTH, MAX_OBSTACLE_WIDTH, MAX_OBSTACLE_HEIGHT,
  COIN_SPACING, FIRST_SPAWN_GAP, COLORS, BASE_SPEED,
  ENDLESS_MECHANICS, mechRamp,
  COIN_GROUND_LIFT, COIN_ARC_END_LIFT, COIN_ARC_TOP_MAX, COIN_HARD_TOP,
  COIN_SINGLE_JUMP_REACH,
  COIN_GROUND_GAP, COIN_FORCE_GROUND_DIST, COIN_ROUTE_WINDOW,
  COIN_RADIUS,
  COIN_HIGH_CLEARANCE, COIN_PATTERN_CHANCE,
  SPRING_VELOCITY, SPRING_WIDTH, SPRING_HEIGHT, SPRING_COOLDOWN,
  SPRING_CLEAR, SPRING_FEET_BAND,
  DECK_H, DECK_H_MARGIN, DECK_LEN, DECK_GAP_MIN, DECK_THICKNESS,
  DECK_EXIT_CLEAR, DECK_FALL_DELAY, DECK_FALL_GRAVITY, DECK_FALL_CHANCE,
  DECK_COIN_LIFT, SURFACE_TOL,
  MOVE_H_AMP, MOVE_V_RETRACT, MOVE_SPEED, MOVE_H_SHARE,
  MOVE_CHANCE_MAX, MOVE_RAMP, DECK_CHANCE_MAX, DECK_RAMP,
  SPRING_CHANCE_MAX, SPRING_RAMP,
} from '../config.js';
import { roundRect } from '../core/fx.js';

function rand(a, b) { return a + Math.random() * (b - a); }
/** 局部的 clamp（与 core/math.js 同义；这里只为了不引入额外依赖顺序） */
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

/** 单次跳跃的最大高度，用来区分「一段跳能过」和「必须二段跳」 */
export const SINGLE_JUMP_HEIGHT = 195;

/** 单跳顶点（由 config 的物理量算出来，不是写死的 195 —— 195 只是用于分类的圆整值） */
export const SINGLE_JUMP_APEX = (JUMP_VELOCITY * JUMP_VELOCITY) / (2 * GRAVITY);

/**
 * 【v1.3.1】弧线金币的两把尺子（放在这里而不是 config，因为它们是「生成策略」而不是玩法常量）。
 *
 * COIN_ARC_SPAN_MARGIN：一条弧线的水平跨度上限 = speed × AIR_TIME × 0.85。
 *   留 15% 余量，是因为玩家不会精确地在串头那一帧起跳 —— 早一点或晚一点起跳，
 *   整段抛物线在水平方向上会平移，跨度必须比「理论满跨」短一截才吃得完整。
 *
 * COIN_SWEET_MIN/MAX：把金币圆心在真实抛物线上再抬 8~12px 的「甜区」。
 *   不抬的话金币圆心正好压在玩家判定盒上沿，只有「脚底与金币恰好同高」的瞬间能碰到，
 *   一串 5~8 颗几乎不可能全部吃到。判定是「圆心到判定盒最近距离 ≤ r = 17」，
 *   而判定盒底边比脚底高 3px，所以「脚底比金币低 17 + 3 = 20px 以内」都算吃到；
 *   取 13px 及以下可保证甜区顶部仍 ≤ 单跳触碰天花板（见 config.COIN_SINGLE_JUMP_REACH）。
 */
export const COIN_ARC_SPAN_MARGIN = 0.85;
/** 收尾那颗「着地币」的时间点 = AIR_TIME × 0.985（仍在一次跳跃的滞空时间内，
 *  此时玩家已降到 rise ≈ 25px → 高度 clamp 到贴地档 45px）；
 *  它是弧线的最后一颗，让「弧线两端都是贴地档」这条旧不变量恢复，
 *  保底账 _lastBandD 才不会因为末颗悬空而往后飘（见 _spawnRouteV13 的收尾注释）。 */
export const COIN_ARC_LAND_MARGIN = 0.985;
/** 甜区范围：13px + 判定盒 3px = 16px < 金币半径 17px，留 1px 余量，
 *  所以「抬 13px」这种最坏情况下，玩家脚底仍在金币中心下方 16px 以内 → 判定必然成立。 */
export const COIN_SWEET_MIN = 8;
export const COIN_SWEET_MAX = 13;
/** 甜区相对真实轨迹的最大偏移（= COIN_SWEET_MAX），断言用来说明「甜区没把金币顶出天花板」。 */
export const COIN_SWEET_MAX_SAFE = COIN_SWEET_MAX;
/** 二段跳顶点（在单跳顶点上再补一跳）= 196.2 + 148.9 = 345.1px */
export const DOUBLE_JUMP_APEX = SINGLE_JUMP_APEX + (DOUBLE_JUMP_VELOCITY * DOUBLE_JUMP_VELOCITY) / (2 * GRAVITY);

/**
 * 平台可达性判据（自测与生成共用同一把尺子）：
 * 站在地面二段跳能踩到平台顶 + 20px 余量，或者该平台入口有弹簧。
 * v1.3 的 DECK_H 上限 324 就是按 `324 + 20 ≤ 345.1` 定的。
 */
export function deckReachable(deckH) {
  return deckH + DECK_H_MARGIN <= DOUBLE_JUMP_APEX;
}

// ---------------- 金币配方：v1.2（旧）与 v1.3（修正） ----------------
/**
 * v1.2 的金币参数：弧线两端 60~96px、弧顶再抬 50~92px。
 * 实测问题（_verify/coin-diagnostic.mjs，200 次模拟）：
 *   贴地跑可吃的只占 9.2%、数量恒被钳到 5、无尽模式最长 5944px 没金币。
 * 这里是「总开关关掉时的回滚分支」，闯关模式也一直用它。
 */
const V12_COINS = {
  chance: 0.62, countMin: 2, countMax: 5,
  lift: [60, 96], arc: [50, 92],
  highChance: 0, highLift: [220, 280],
  pityGaps: 0,                 // 0 = 不启用保底（无尽模式保持原行为）
};

/**
 * v1.3 的金币参数（无尽模式）——每一条都对着一个实测出来的毛病：
 *   · arcEndLift 压进贴地档（45~70 ≤ PLAYER_HEIGHT + r = 75）→ 跑着也吃得到；
 *   · 【v1.3.1】弧线高度不再由 arcTopMax 决定，而是由「当前速度 + 真实跳跃抛物线」反推，
 *     硬上限 COIN_SINGLE_JUMP_REACH = 216.173 = 单跳触碰天花板；
 *     旧的 arcTopMax = 260 比这个天花板还高 44px，正是「明明跳了却吃不到」的根因；
 *   · groundForceDist 强制保底 → 连续无金币的空白被压到远小于 1500px；
 *   · countStart/countEnd 随难度线性插值 → 早期稀疏、后期密集（「缓增」）。
 */
const V13_COINS = {
  mode: 'v13',
  chance: 0.72,
  countStart: [2, 4],            // 难度 0：2~4 颗
  countEnd: [5, 8],              // 难度 1：5~8 颗
  arcEndLift: COIN_ARC_END_LIFT, // 弧线两端（= 贴地档）
  arc: [70, 190],                // 【已不参与生成】旧的正弦弧高；现由抛物线反推
  arcTopMax: COIN_ARC_TOP_MAX,   // 【已不参与生成】旧的 260 上限；真上限见 COIN_SINGLE_JUMP_REACH
  patternChance: COIN_PATTERN_CHANCE,
  groundForceDist: COIN_FORCE_GROUND_DIST,
  groundGap: COIN_GROUND_GAP,    // 只是写进配方给文档/自测引用
  highChance: 0.35,
  highLift: [220, 280],          // 兼容字段：真正的高度由「障碍顶面 + highClearance」决定
  highClearance: COIN_HIGH_CLEARANCE,
  highTop: COIN_HARD_TOP,
  pityGaps: 3,                   // 连续 3 个空隙没金币 → 下一个必出
};

/** 三种新机制的配方（无尽模式）。总开关关掉时整块为 undefined → 全部失效。 */
const V13_MOVE = {
  enabled: true,
  chanceAt: (t) => MOVE_CHANCE_MAX * mechRamp(t, MOVE_RAMP[0], MOVE_RAMP[1]),
  hAmp: MOVE_H_AMP, vRetract: MOVE_V_RETRACT, speed: MOVE_SPEED, hShare: MOVE_H_SHARE,
};
const V13_DECK = {
  enabled: true,
  chanceAt: (t) => DECK_CHANCE_MAX * mechRamp(t, DECK_RAMP[0], DECK_RAMP[1]),
  h: DECK_H, len: DECK_LEN, gapMin: DECK_GAP_MIN, thickness: DECK_THICKNESS,
  exitClear: DECK_EXIT_CLEAR, fallChance: DECK_FALL_CHANCE,
  fallDelay: DECK_FALL_DELAY, coinLift: DECK_COIN_LIFT,
};
const V13_SPRING = {
  enabled: true,
  chanceAt: (t) => SPRING_CHANCE_MAX * mechRamp(t, SPRING_RAMP[0], SPRING_RAMP[1]),
  width: SPRING_WIDTH, height: SPRING_HEIGHT,
};

/**
 * 默认配方 —— 无尽模式的配方（v1.2 那些写死的常量 + v1.3 的新机制）。
 * 【红线】总开关 config.ENDLESS_MECHANICS === false 时：
 *   coins 回到 V12_COINS、move/deck/spring 变成 undefined、tallChanceAt 不变，
 *   而 spawn()/update() 里的新分支都「不消耗任何随机数、不改任何间距」，
 *   于是无尽模式的随机序列与 v1.2 逐字节一致 —— 这就是「一键回滚」。
 * 闯关模式永远走 V12 分支（levelRecipe 里没有 mode/move/deck/spring 字段）。
 */
const DEFAULT_RECIPE = {
  intervalStart: SPAWN_INTERVAL_START,
  intervalEnd: SPAWN_INTERVAL_MIN,
  tallChanceAt: (t) => 0.08 + 0.34 * t,
  lowWidth: [MIN_OBSTACLE_WIDTH, 78],
  lowHeight: [50, 132],
  tallWidth: [58, MAX_OBSTACLE_WIDTH],
  tallHeight: [SINGLE_JUMP_HEIGHT + 20, MAX_OBSTACLE_HEIGHT],
  comboChance: 0, comboReaction: 0, postComboMul: 1, tripleChance: 0,
  tallFollowMul: 1.12,
  gapMargin: GAP_MARGIN,
  spawnPad: 80,
  firstSpawnGap: FIRST_SPAWN_GAP,
  coins: ENDLESS_MECHANICS ? V13_COINS : V12_COINS,
  // 三种新机制：总开关关掉 → undefined → 生成器完全不碰
  move: ENDLESS_MECHANICS ? V13_MOVE : undefined,
  deck: ENDLESS_MECHANICS ? V13_DECK : undefined,
  spring: ENDLESS_MECHANICS ? V13_SPRING : undefined,
};

/** 导出给自测/文档引用（无尽模式的配方就是它） */
export { DEFAULT_RECIPE, V12_COINS, V13_COINS };

/**
 * 可达性校验的「前瞻距离」。
 * 难度是越跑越快的，所以生成间距时不能只看**此刻**的速度：
 * 这个间距真正被跳过，是在「再跑过约一个间距 + 从出生点到玩家的 600px」之后，
 * 那时候的速度已经涨了一点点。取一个保守的前瞻量（约 1800px），
 * 按那个时候的速度算下限，速度涨上来才不会出现「生成时跳得过、跑到了跳不过」。
 * 副作用很小：起步阶段（speedAt(1800) ≈ 401px/s）几乎不改变间距。
 */
export const GAP_LEAD = 1800;

/** 玩家屏幕 x（把「屏幕坐标」换成「世界距离坐标」时要用） */
const PLAYER_SCREEN_X = DESIGN_WIDTH * PLAYER_X_RATIO;

export class Spawner {
  constructor() {
    this.obstacles = [];
    this.coins = [];
    this.platforms = [];      // v1.3：上下双层平台 / 坠落地形
    this.springs = [];        // v1.3：弹簧跳板
    this._obsPool = [];       // 回收池：出界的障碍放这里等复用
    this._coinPool = [];      // 回收池：金币同理
    this._platPool = [];      // 回收池：平台
    this._springPool = [];    // 回收池：弹簧
    this.recipe = null;       // null = 无尽模式的默认配方（见 DEFAULT_RECIPE）
    this.reset();
  }

  /** 注入关卡配方；传 null 就回到无尽模式分支 */
  setRecipe(recipe) {
    this.recipe = recipe || null;
    return this;
  }

  /** 当前生效的配方（无尽模式时是 DEFAULT_RECIPE） */
  _recipe() { return this.recipe || DEFAULT_RECIPE; }

  /**
   * @param {object} [recipe] 可选：重置的同时注入配方（不传则沿用当前配方）
   */
  reset(recipe) {
    if (recipe !== undefined) this.setRecipe(recipe);
    const r = this._recipe();
    // 回收现场：把还活着的对象全部退回池子，避免残留状态
    for (const o of this.obstacles) this._obsPool.push(o);
    for (const c of this.coins) this._coinPool.push(c);
    for (const p of this.platforms) this._platPool.push(p);
    for (const s of this.springs) this._springPool.push(s);
    this.obstacles.length = 0;
    this.coins.length = 0;
    this.platforms.length = 0;
    this.springs.length = 0;
    this.travelled = 0;              // 距离上一次生成的推进距离
    this.nextGap = r.firstSpawnGap;  // 开局先给一段空路热身（关卡模式可以更长）
    // 「上一个障碍的右边缘」——它跟着世界一起向左滚动，所以每帧要减去 dx。
    // 初始化成出生点，等于假装开局前就有一根障碍，第一根障碍前面就不会撒金币。
    this.lastObstacleRight = DESIGN_WIDTH + (r.spawnPad || 80);
    this.lastWasTall = false;
    this._lastWidth = 0;             // 上一根障碍的宽度（间距是「边缘到边缘」，必须减掉它）
    this._lastAmp = 0;               // 上一根障碍的水平巡逻幅度（间距里要预留 2 倍幅度）
    this._lastSpeed = BASE_SPEED;    // 上一帧速度（_rollMove 的幅度安全上限要用）
    // ---- 组合（cluster）状态：连跳 / 双连跳 / 高后低 / 三连 ----
    this.comboLeft = 0;              // 这一组还有几根要接着生成
    this._postCombo = false;         // 上一根收尾了 → 下一段是「恢复段」（间距 ×postComboMul）
    this._coinDry = 0;               // 连续多少个间隙没撒出金币（金币保底用）
    // ---- v1.3 新状态 ----
    this._distAcc = 0;               // distance 参数缺省时的距离累加器（自测/无头场景用）
    this._now = 0;                   // 当前已跑距离（金币的「世界距离坐标」要用）
    this._lastDifficulty = 0;        // 当前难度进度（金币数量缓增要用）
    this._lastBandD = 0;             // 上一次「贴地档金币」出现的距离坐标（保底用，见 _spawnRouteV13）
    this._deckTravelled = 0;         // 距离上一段平台的推进距离
    this._deckNextGap = 2400;        // 第一段平台要等一会儿（概率那时还是 0）
    this._deckBlock = 0;             // >0 表示「平台区」占着这段路，禁止生成障碍
  }

  // ---------------- 对象池 ----------------
  _takeObstacle() {
    return this._obsPool.pop() ||
      { x: 0, y: 0, w: 0, h: 0, hEff: 0, type: 'low', hue: '', grd: null, combo: false,
        mv: null, amp: 0, omega: 0, phase: 0, baseX: 0,
        worstX: 0, worstW: 0, worstH: 0 };
  }
  _takeCoin() {
    return this._coinPool.pop() || { x: 0, y: 0, r: 17, spin: 0, taken: false, pulse: 0 };
  }
  _takePlatform() {
    return this._platPool.pop() ||
      { x: 0, y: 0, w: 0, h: 0, kind: 'deck', deckH: 0, armed: false, timer: 0,
        fallDelay: 0.3, fell: false, vy: 0, shake: 0, grd: null };
  }
  _takeSpring() {
    return this._springPool.pop() || { x: 0, y: 0, w: 0, h: 0, cool: 0, squash: 0, onDeck: false, pulse: 0 };
  }

  /**
   * 计算「上一个障碍右边缘」到「下一个障碍左边缘」的空气空隙（不含障碍自身宽度）。
   * 注意 update() 里会再加上上一根障碍的宽度，因为生成间距是按「左边缘到左边缘」
   * 推进的，而可达性看的是玩家真正要飞过的那段空隙。
   * @param {number} speed 当前滚动速度
   * @param {number} difficulty 难度进度 0..1（config.difficultyAt 的结果）
   * @param {number} [distance] 当前已跑距离（用来按「到达时」的速度做前瞻校验）
   * @param {number} [peakSpeed] 本关速度上限（闯关模式传入：地板直接按终点速度撑住，
   *   数学上保证 airGap ≥ AIR_TIME×peak + gapMargin > 硬约束线；无尽模式不传）
   */
  computeNextGap(speed, difficulty, distance, peakSpeed) {
    const r = this._recipe();
    const t = difficulty;
    const interval = r.intervalStart + (r.intervalEnd - r.intervalStart) * t;
    // 按时间间隔换算出的间距
    const byTime = speed * interval;
    // 可达性下限：即使按最坏情况起跳也必须跳得过去。
    // 闯关模式：地板恒取本关 peakSpeed（关卡速度永远不会超过它）；
    // 无尽模式：按「前瞻之后」与当前速度的较大者（难度在涨，按到达时算才安全）。
    let reachSpeed;
    if (Number.isFinite(peakSpeed)) {
      reachSpeed = Math.max(speed, peakSpeed);
    } else {
      const ahead = Number.isFinite(distance) ? speedAt(distance + GAP_LEAD) : speed;
      reachSpeed = Math.max(speed, ahead);
    }
    const byReachability = reachSpeed * AIR_TIME + r.gapMargin;
    // 组合内部（下一根还是同一组的成员）：用「落地立刻再起跳」的显式下界，
    // 且同样按 reachSpeed 撑住 —— 连跳只会比常规间距更宽，不会更紧。
    if (this.comboLeft > 0) {
      return Math.max(reachSpeed * (AIR_TIME + r.comboReaction), byReachability);
    }
    let gap = Math.max(byTime, byReachability);
    // 上一根是高障碍（要二段跳）时，多留一点喘息空间
    if (this.lastWasTall) gap *= r.tallFollowMul;
    return gap;
  }

  /**
   * 【B1 红线】水平巡逻障碍要在空隙里左右往复，所以这段空隙必须按「最坏位置」预留：
   *   最坏空隙 = cur.worstX − (prev.worstX + prev.worstW)
   *            = (cur.x − ampCur) − (prev.x − ampPrev + prev.w + 2·ampPrev)
   *            = 名义空隙 − ampPrev − ampCur
   * 于是预留量 = ampPrev + ampCurMax。
   * ampPrev 是已知的（上一根自己的幅度），ampCur 未知 → 取配方上限 hAmp[1] 这个上界。
   * 代价只有「空隙稍微变宽」——难度与可达性红线一丝都不会松。
   * 概率还是 0 时返回 0（前 ~20 秒空隙与 v1.2 完全一样，也省掉多余的变宽）。
   */
  _moveReserve(t, speed) {
    const mv = this._recipe().move;
    if (!mv || !mv.enabled || typeof mv.chanceAt !== 'function') return 0;
    // 下一根的幅度上界：既受配方 hAmp[1] 限制，也受「低速时摆不开」的安全上限限制
    const cap = Math.min(mv.hAmp[1], this._moveAmpCap(speed, MIN_OBSTACLE_WIDTH));
    const next = mv.chanceAt(t) > 0 ? cap : 0;
    return (this._lastAmp || 0) + next;
  }

  /**
   * @param {number} dt
   * @param {number} speed 当前速度
   * @param {number} difficulty 难度进度 0..1
   * @param {number} [distance] 当前已跑距离（透传给间距计算做前瞻校验）
   * @param {number} [peakSpeed] 本关速度上限（闯关模式传入）
   */
  update(dt, speed, difficulty, distance, peakSpeed) {
    const dx = speed * dt;

    // 0) 记下「已经跑到哪儿了」：金币的绝对距离坐标、难度进度、强制保底都要用。
    //    distance 缺省（自测/无头场景只传 3 个参数）时用累加值兜底，保证坐标单调推进。
    this._distAcc += dx;
    this._now = Number.isFinite(distance) ? distance : this._distAcc;
    if (Number.isFinite(difficulty)) this._lastDifficulty = difficulty;
    this._lastSpeed = speed;      // 供 _rollMove 推导「水平巡逻的安全幅度上限」

    // 1) 让所有东西向左移动，并回收出界的（吃掉的金币也在这里顺手清掉）
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const o = this.obstacles[i];
      this._stepObstacle(o, dx, dt);
      if (o.worstX + o.worstW < -80) {
        this.obstacles.splice(i, 1);
        this._obsPool.push(o);
      }
    }
    for (let i = this.coins.length - 1; i >= 0; i--) {
      const c = this.coins[i];
      c.x -= dx;
      c.spin += dt * 5;
      c.pulse = (c.pulse || 0) + dt * 3;
      if (c.taken || c.x + c.r < -60) {     // ← 吃掉的立刻回收，不再占数组
        this.coins.splice(i, 1);
        this._coinPool.push(c);
      }
    }
    // 弹簧：跟世界一起左移，冷却回弹
    for (let i = this.springs.length - 1; i >= 0; i--) {
      const s = this.springs[i];
      s.x -= dx;
      if (s.cool > 0) s.cool = Math.max(0, s.cool - dt);
      if (s.squash > 0) s.squash = Math.max(0, s.squash - dt * 3.5);
      s.pulse = (s.pulse || 0) + dt * 4;
      if (s.x + s.w < -60) {
        this.springs.splice(i, 1);
        this._springPool.push(s);
      }
    }
    // 平台：左移；坠落地形还要抖动 / 下落
    for (let i = this.platforms.length - 1; i >= 0; i--) {
      const p = this.platforms[i];
      this._stepPlatform(p, dx, dt);
      if (p.x + p.w < -140 || p.y > GROUND_Y + 90) {
        this.platforms.splice(i, 1);
        this._platPool.push(p);
      }
    }

    // 2) 平台调度：按「推进距离」排期，一段平台占住 L + exitClear 这段路
    this._deckBlock = Math.max(0, this._deckBlock - dx);
    if (this._deckEnabled()) {
      this._deckTravelled += dx;
      if (this._deckTravelled >= this._deckNextGap) {
        this._deckTravelled = 0;
        this._deckNextGap = this._spawnDeck(difficulty);
      }
    }

    // 3) 到点了就生成下一个障碍
    this.lastObstacleRight -= dx;   // 右边缘跟着世界一起左移，否则永远算不出可用空隙
    this.travelled += dx;
    if (this.travelled >= this.nextGap) {
      this.travelled = 0;
      if (this._deckBlock > 0) {
        // 【B2 红线】平台区占着这段路（含出口后 exitClear）：障碍整体后移，
        // 保证「平台 x 区间 ±120px 缓冲内没有高障碍」与「出口后 250px 没有障碍」。
        this.nextGap = this._deckBlock + 40 + this.computeNextGap(speed, difficulty, distance, peakSpeed);
      } else {
        // 先放下这根障碍（spawn 会把它的宽度记进 _lastWidth），
        // 再按「这根障碍的右边缘 → 下一根的左边缘」算真正的空气空隙。
        this.spawn(difficulty);
        let g = this.computeNextGap(speed, difficulty, distance, peakSpeed);
        // 组合刚收尾 → 下一段是恢复段，额外放宽（无尽模式 postComboMul = 1，无影响）
        if (this._postCombo) {
          g *= this._recipe().postComboMul;
          this._postCombo = false;
        }
        // 水平巡逻的障碍要预留「最坏位置」的净空（见 _moveReserve）
        this.nextGap = g + this._lastWidth + this._moveReserve(difficulty, speed);
      }
    }

    // 4) 【金币保底】每帧检查一次「贴地档金币」的距离，超了就地补一条地面线。
    //    为什么不能只靠「空隙里强制生一串」：空隙本身有 550~950px 的抖动，
    //    再加上「这一串有 3~8 颗、最后一颗离下一串的头很远」，只按空隙做判断会
    //    错位（实测高难度段 1500px 里一颗贴地档金币都没有）。
    //    这里的判断点用**落点**的距离坐标，保证补出来的间距就是 forceDist 本身。
    this._refillCoins();
  }

  /** 下一根障碍可能到达的最坏左边缘（水平巡逻的左极限） */
  _gapRightX() {
    const r = this._recipe();
    const mv = r.move;
    const amp = (mv && mv.enabled && mv.hAmp) ? mv.hAmp[1] : 0;
    return DESIGN_WIDTH + (r.spawnPad || 80) - amp - 30;
  }

  /** [x0,x1] 这段路上有没有平台压着（用 for 循环，避免每帧建闭包） */
  _platInX(x0, x1) {
    const ps = this.platforms;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (p.x > x1 || p.x + p.w < x0) continue;
      return true;
    }
    return false;
  }

  /**
   * [x0,x1] 这段路上有没有平台正好压在「地面线金币」的高度带（45~70px）里。
   * 普通平台悬在 230~275px，跟贴地金币的 y 区间完全不相交，所以不算阻挡
   * ——平台下面照样可以跑着吃金币（平台是可选的上路，不是必经）。
   * 只有**下落中**的平台会一路扫过金币高度带，那才是真的会重叠。
   */
  _platInCoinBand(x0, x1) {
    const top = GROUND_Y - COIN_GROUND_LIFT[0] + COIN_RADIUS;   // 金币最高点的 y
    const bottom = GROUND_Y - COIN_GROUND_LIFT[1] - COIN_RADIUS; // 金币最低点的 y
    const ps = this.platforms;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (p.x > x1 || p.x + p.w < x0) continue;
      if (p.y + p.h < bottom || p.y > top) continue;
      return true;
    }
    return false;
  }

  /**
   * 【金币保底】补一条「地面线」：整条都落在贴地档（45~70px），跑着就能吃到。
   * 只允许放在「上一根障碍右边缘 → 下一根障碍最坏左边缘」之间 —— 这段路在
   * 任何时刻都不会有障碍（左边那根已经过去，右边那根只会出现在更右边），
   * 所以天然满足「金币不与障碍重叠」。起点贴着屏幕右侧放：调用时 leftX 往往
   * 早就滚到屏幕左边很远了，贴着 leftX 放会直接生成在画面外。
   */
  _refillCoins() {
    const cr = this._recipe().coins;
    if (!cr || cr.mode !== 'v13') return;
    const forceDist = cr.groundForceDist || COIN_FORCE_GROUND_DIST;
    if (!(forceDist > 0) || !(forceDist < Infinity)) return;

    const leftX = this.lastObstacleRight;
    const rightX = this._gapRightX();
    const space = rightX - leftX;
    if (space < COIN_SPACING * 2 + 80) return;
    if (this._platInCoinBand(leftX, rightX)) return;

    const maxCount = Math.floor((space - 80) / COIN_SPACING) + 1;
    // 保底线只撒 3 颗：它的职责是「补上一条跑着就能吃的路」，不是变相加密度。
    // 不变量只取决于**最后一颗**的位置（_lastBandD），颗数少不影响证明。
    const count = Math.max(2, Math.min(Math.min(3, cr.countEnd[0]), maxCount));
    const span = (count - 1) * COIN_SPACING;
    // 位置不是「随便挑一个」，而是**反解**出来的：让补出来的第一颗恰好离上一颗
    // 贴地档金币 forceDist 远 → 不变量「任意两颗贴地档金币 ≤ forceDist」直接成立。
    // 正常空隙里下一串会在 ~718px 后自己出现（< forceDist），所以根本轮不到补线，
    // 不会出现「一格里两串币」的忽多忽少。
    // 目标点还没到期（还在右边）就等下一帧；到期点被上一根障碍挡住时**只许往右挪**
    // （推迟一点点补），绝不许往左挪出这段路。「往右挪」会让下一期的到期点更靠右，
    // 于是下一帧必然落到「还没到期」分支，不会连刷；「往左挪」则会与 leftX 同步后退，
    // 两边一起以 16px/帧 左移 → 永远撞在左边界上，出现几千 px 的空档。
    const maxX = rightX - 24 - span;
    const dueX = PLAYER_SCREEN_X + (this._lastBandD + forceDist - this._now);
    if (dueX > maxX) return;               // 还没到期，等下一帧
    let startX = dueX;
    if (startX < leftX + 24) startX = leftX + 24;   // 被上一根障碍顶住 → 往右挪
    if (startX > maxX) return;             // 这一格实在放不下（空隙太窄）→ 等下一格

    const h = rand(cr.arcEndLift[0], cr.arcEndLift[1]);
    for (let i = 0; i < count; i++) {
      const c = this._takeCoin();
      c.x = startX + i * COIN_SPACING;
      c.y = GROUND_Y - h;
      c.r = 17;
      c.spin = Math.random() * 6;
      c.pulse = i * 0.4;
      c.taken = false;
      this.coins.push(c);
    }
    this._lastBandD = this._now + (startX + span - PLAYER_SCREEN_X);
  }

  /** 平台机制是否启用（总开关 + 配方） */
  _deckEnabled() {
    const dk = this._recipe().deck;
    return !!(dk && dk.enabled && typeof dk.chanceAt === 'function');
  }

  /**
   * 障碍每帧的推进：左移 + 运动。
   * 【B1 不变量】无论怎么动，都刷新 worstX/worstW/worstH 这组「最坏包络」字段：
   *   · 水平巡逻：最坏包络 = [baseX − amp, w + 2·amp]，可达性校验只看包络；
   *   · 垂直伸缩：bottom 永远钉在地面，有效高度 hEff ∈ [h·retract, h] —— 只减不增，
   *     所以「任何时刻的有效高度都不许超过静态同尺寸障碍的净空要求」恒成立，
   *     最坏高度直接就是静态高度 h；
   *   · 静止：包络 = 自己，与 v1.2 逐字节一致。
   */
  _stepObstacle(o, dx, dt) {
    o.x -= dx;
    if (o.mv === 'h') {
      o.baseX -= dx;
      o.phase += o.omega * dt;
      o.x = o.baseX + o.amp * Math.sin(o.phase);
      o.worstX = o.baseX - o.amp;
      o.worstW = o.w + o.amp * 2;
      o.worstH = o.h;
    } else if (o.mv === 'v') {
      o.phase += o.omega * dt;
      const k = 0.5 - 0.5 * Math.cos(o.phase);      // 0..1，从「全高」到「缩到最短」
      const he = o.h * (1 - o.amp * k);             // ∈ [h·(1−amp), h]：永远不超过静态高度
      o.hEff = he;
      o.y = GROUND_Y - he;
      o.worstX = o.x;
      o.worstW = o.w;
      o.worstH = o.h;
    } else {
      o.worstX = o.x;
      o.worstW = o.w;
      o.worstH = o.h;
    }
  }

  /**
   * 水平巡逻允许的最大幅度。【B1 红线推导】
   *   横向可覆盖的距离 = speed·AIR_TIME（整段滞空里玩家相对世界的位移）。
   *   要让玩家在**最坏位置**下还能把「障碍扫过的整条带子」越过去，需要
   *       speed·AIR_TIME ≥ (w + 2·amp) + GAP_MARGIN
   *   解出 amp ≤ (speed·AIR_TIME − GAP_MARGIN − w) / 2。
   *   低速时这个上限比 MOVE_H_AMP[0]=30 还小 → 干脆不出水平巡逻（退化成垂直伸缩），
   *   所以「加了移动障碍就把间距红线收紧」这件事永远不会发生。
   *   用 MIN_OBSTACLE_WIDTH 代入得到的是**全局上界**（cap 随 w 递减），_moveReserve 用它。
   */
  _moveAmpCap(speed, w) {
    const s = Number.isFinite(speed) && speed > 0 ? speed : BASE_SPEED;
    return Math.max(0, (s * AIR_TIME - GAP_MARGIN - w) / 2);
  }

  /**
   * 掷一次「这一根要不要动」。总开关关掉 / 配方没有 move / 概率还是 0 时
   * **一次 Math.random 都不消耗**，保证 v1.2 的随机序列逐字节不变。
   */
  _rollMove(t, w, h, speed) {
    const mv = this._recipe().move;
    if (!mv || !mv.enabled || typeof mv.chanceAt !== 'function') return null;
    const chance = mv.chanceAt(t);
    if (!(chance > 0)) return null;
    if (Math.random() >= chance) return null;
    const spd = rand(mv.speed[0], mv.speed[1]);
    const vMove = () => {
      const amp = 1 - rand(mv.vRetract[0], mv.vRetract[1]);
      // 有效高度的变化率峰值 = h·amp·omega/2 → 取 omega 让线速度落在 30~90 px/s
      return { mv: 'v', amp, omega: (2 * spd) / Math.max(40, h * amp), phase: Math.random() * Math.PI * 2 };
    };
    if (Math.random() < mv.hShare) {
      const amp = rand(mv.hAmp[0], mv.hAmp[1]);
      const cap = Math.min(mv.hAmp[1], this._moveAmpCap(speed, w));
      if (amp > cap) return vMove();       // 水平摆不开就退化成「只往上缩」，永远安全
      // omega = v/amp → 线速度峰值恰好就是 speed（30~90 px/s，匀速正弦，可预测）
      return { mv: 'h', amp, omega: spd / Math.max(1, amp), phase: Math.random() * Math.PI * 2 };
    }
    return vMove();
  }

  /** 生成一个障碍，并尽量在它前面的空隙里撒一串金币 / 放一块弹簧 */
  spawn(difficulty) {
    const t = difficulty;
    const r = this._recipe();
    const spawnX = DESIGN_WIDTH + (r.spawnPad || 80);

    // 高障碍的比例：关卡配方给固定值，无尽配方给「随难度上升」的函数
    const tallChance = typeof r.tallChance === 'number' ? r.tallChance : r.tallChanceAt(t);
    // 这一根是不是「组合」的成员（连跳/双连跳/高后低/三连 全靠间距表达）
    const isMember = this.comboLeft > 0;
    if (isMember) this.comboLeft--;

    const isTall = Math.random() < tallChance;
    const w = isTall ? rand(r.tallWidth[0], r.tallWidth[1]) : rand(r.lowWidth[0], r.lowWidth[1]);
    const h = isTall ? rand(r.tallHeight[0], r.tallHeight[1]) : rand(r.lowHeight[0], r.lowHeight[1]);

    // 【v1.3】先掷「这一根要不要动」：水平巡逻的障碍会向左多占 amp，
    // 金币和弹簧的右边界必须按这个包络收回来，否则会被巡逻中的障碍压住。
    const plan = this._rollMove(t, w, h, this._lastSpeed);
    const ampCur = plan && plan.mv === 'h' ? plan.amp : 0;

    // 先试着在前一个障碍和这一个之间放金币（这块区域一定没有障碍）
    this.spawnCoinsBetween(this.lastObstacleRight, spawnX - ampCur - 30);
    // 再试着在同一块空地上放一块弹簧（弹簧永远是加分项）
    this.spawnSpringBetween(this.lastObstacleRight, spawnX - ampCur - 30, t);

    const o = this._takeObstacle();
    o.x = spawnX;
    o.baseX = spawnX;
    o.y = GROUND_Y - h;
    o.w = w;
    o.h = h;
    o.hEff = h;
    o.type = isTall ? 'tall' : 'low';
    o.hue = isTall ? COLORS.neonPink : COLORS.neonPurple;
    o.grd = null;                      // 渐变与尺寸有关，换了尺寸就重做
    o.combo = isMember;                // 供自测/调试识别「组合内部间距」
    o.mv = plan ? plan.mv : null;
    o.amp = plan ? plan.amp : 0;
    o.omega = plan ? plan.omega : 0;
    o.phase = plan ? plan.phase : 0;
    // 最坏包络：水平巡逻要算进两侧极限，垂直伸缩只减不增（包络就是静态尺寸）
    o.worstX = spawnX - ampCur;
    o.worstW = w + ampCur * 2;
    o.worstH = h;
    this.obstacles.push(o);

    // 空格的「左边界」用最坏包络的右边缘：巡逻中的障碍随时可能占满整个包络
    this.lastObstacleRight = spawnX + o.worstW;
    this.lastWasTall = isTall;
    this._lastWidth = w;               // 供下一次间距计算减掉（边缘到边缘才是真空隙）
    this._lastAmp = ampCur;            // 供 _moveReserve 预留最坏净空

    // 组合编排：成员收尾 → 标记恢复段；不在组合里 → 按概率开一组新的
    if (isMember && this.comboLeft === 0) {
      this._postCombo = true;
    } else if (!isMember && r.comboChance > 0 && Math.random() < r.comboChance) {
      // 三连只在 postComboMul 最高的关出现（L5 tripleChance = 0.25）
      this.comboLeft = (r.tripleChance > 0 && Math.random() < r.tripleChance) ? 2 : 1;
    }

    // 高障碍正上方的「风险金币」：要二段跳才够得到，是给高手的额外奖励
    if (isTall) this.spawnHighCoins(o);

    return o;
  }

  /**
   * 高障碍正上方的高空金币（可选奖励，不影响通关）。
   * 【v1.3 修正】旧版 y 是绝对高度 220~286，而高障碍自身 215~250 高，
   * 金币下沿 = h − r 会嵌进障碍盒子（实测 L5 出现 1334 处重叠，玩家也吃不到）。
   * 现在改成「以障碍顶面为基准」：
   *     lo = max(highLift[0], o.h + clearance[0])     // 下沿至少高出顶面 24px > r = 17
   *     hi = min(highTop = 345, o.h + clearance[1])   // 整体不超过二段跳顶点
   * 两个约束一起保证：金币与障碍 AABB 永不相交，且离地高度 ≤ 345 红线。
   */
  spawnHighCoins(o) {
    const cr = this._recipe().coins;
    if (!cr || !(cr.highChance > 0) || !cr.highLift) return;
    if (Math.random() > cr.highChance) return;
    const clear = cr.highClearance || COIN_HIGH_CLEARANCE;
    const topCap = Math.min(cr.highTop || COIN_HARD_TOP, COIN_HARD_TOP);
    const loH = Math.min(topCap, Math.max(cr.highLift[0], o.h + clear[0]));
    let hiH = Math.min(topCap, Math.max(o.h + clear[1], loH));
    if (hiH <= loH) hiH = Math.min(topCap, loH + 8);
    const mid = (loH + hiH) / 2;
    const arc = (hiH - loH) / 2;
    const count = 3;
    const pad = 12;
    const span = Math.max(0, o.w - pad * 2);
    for (let i = 0; i < count; i++) {
      const k = count === 1 ? 0 : i / (count - 1);
      const c = this._takeCoin();
      c.x = o.x + pad + span * k;
      c.y = GROUND_Y - (mid + Math.sin(k * Math.PI) * arc);
      c.r = 17;
      c.spin = Math.random() * 6;
      c.pulse = i * 0.4;
      c.taken = false;
      this.coins.push(c);
    }
  }

  /**
   * 在两个 x 之间撒一串金币。
   * 分两条路：
   *   · cr.mode === 'v13'（无尽模式）→ _spawnRouteV13：贴地档 + 弧线 + 数量缓增 + 强制保底；
   *   · 否则（闯关模式 / 总开关关掉）→ 与 v1.2 逐字节一致的旧逻辑。
   */
  spawnCoinsBetween(leftX, rightX) {
    const cr = this._recipe().coins;
    if (cr && cr.mode === 'v13') { this._spawnRouteV13(cr, leftX, rightX); return; }

    const space = rightX - leftX;
    if (!Number.isFinite(space)) return;             // 防守：任何一边是 ±Infinity / NaN 都不放
    if (space < COIN_SPACING * 2 + 80) return;
    const pity = cr.pityGaps > 0 && this._coinDry + 1 >= cr.pityGaps;
    if (!pity && Math.random() > cr.chance) {        // 不是每次都有金币
      this._coinDry++;
      return;
    }

    const maxCount = Math.floor((space - 80) / COIN_SPACING) + 1;
    const count = Math.max(cr.countMin, Math.min(cr.countMax, maxCount));
    const span = (count - 1) * COIN_SPACING;
    const startX = leftX + (space - span) / 2;
    const lift = rand(cr.lift[0], cr.lift[1]);   // 离地高度
    const arcH = rand(cr.arc[0], cr.arc[1]);     // 弧线最高处再抬高多少

    for (let i = 0; i < count; i++) {
      const k = count === 1 ? 0 : i / (count - 1);
      const y = GROUND_Y - lift - Math.sin(k * Math.PI) * arcH;
      const c = this._takeCoin();
      c.x = startX + i * COIN_SPACING;
      c.y = y;
      c.r = 17;
      c.spin = Math.random() * 6;
      c.pulse = i * 0.4;
      c.taken = false;
      this.coins.push(c);
    }
    this._coinDry = 0;
  }

  /**
   * v1.3 的金币路线（无尽模式）。
   * 【不变量（写进 smoke 断言）】
   *   1) 每一颗金币离地 ∈ {arcEndLift ∪ 弧线抬升}，下沿 ≥ 45 − 17 = 28 > 20 → 不穿地面；
   *   2) 弧线金币离地恒 ≤ COIN_SINGLE_JUMP_REACH = 216.173 → **一条弧线一次单跳可吃**；
   *   3) 弧线两端恒落在贴地档（45~70 ≤ PLAYER_HEIGHT + r = 75）→ 跑着也吃得到；
   *   4) 距离坐标上，连续两次「有金币」的间隔 ≤ groundForceDist + 一个障碍间距，
   *      实测被压在 1500px 以内（diagnostic 的空桶统计就是量这个）；
   *   5) 金币只在 [leftX, rightX] 内摆放（两端各留 24/30px），而 leftX/rightX 已经
   *      按巡逻障碍的最坏包络收过 → 与障碍 AABB 永不相交。
   *
   * 【v1.3.1 修正：弧线改成「玩家真实跳跃抛物线」的等时采样】
   *   旧版用 `y = GROUND_Y − endH − sin(k·π)·arcH` 铺高度：既与速度无关，也不是抛物线，
   *   于是「水平位置 ↔ 竖直高度」的时间关系对不上，玩家反馈「跳跃时跟不上弧线」。
   *   现在反过来做：先按**当前速度**定水平跨度，再把第 i 颗放在 `t = i·COIN_SPACING / speed`
   *   时刻的真实跳跃高度上 —— 玩家只要在恰当的一刻起跳，整串就沿他的飞行轨迹排开。
   */
  _spawnRouteV13(cr, leftX, rightX) {
    const space = rightX - leftX;
    if (!Number.isFinite(space)) return;

    // 【为什么要有 routeWindow】平台区会把一个「空隙」拉长到 2000px 以上
    // （障碍被整体后移），如果按整段空隙居中撒币，就会在中间形成 800px+ 的空白。
    // 所以金币串只占空隙里的一小段，而且**永远贴着下一个障碍的左边缘**：
    // 这样每一根障碍前面都有币可吃，长空隙里的空白被压到最小。
    const windowW = Math.min(space - 48, cr.routeWindow || COIN_ROUTE_WINDOW);
    if (windowW < COIN_SPACING * 2 + 80) return;
    const winStart = Math.max(leftX + 24, rightX - 30 - windowW);

    // 保底只留「按空隙计数」这一层兜底；真正的不变量由每帧的 _refillCoins 负责，
    // 它用**落点**的距离坐标做判断（不会因为这一串有 3~8 颗而错位）。
    const pity = cr.pityGaps > 0 && this._coinDry + 1 >= cr.pityGaps;
    if (!pity && Math.random() > cr.chance) {
      this._coinDry++;
      return;
    }
    this._coinDry = 0;

    // ---------------- 1) 按「当前速度」定这一串有多长 ----------------
    // 一次单跳的水平跨度 = speed × AIR_TIME；留 15% 余量给起跳时机的误差
    // （玩家不会正好在串头起跳，早一点/晚一点都要还能吃到）。
    const speed = Number.isFinite(this._lastSpeed) && this._lastSpeed > 0 ? this._lastSpeed : BASE_SPEED;
    const spanMax = speed * AIR_TIME * COIN_ARC_SPAN_MARGIN;
    // 颗数 = 「一次单跳跨度内最多能塞几颗」（随速度缓增：400px/s → 5 颗，980px/s → 11 颗），
    // 再被配方里 countStart→countEnd 随难度插值出来的数夹住（越到后期越密），最后夹进
    // 这一格的可用宽度。间距恒为 COIN_SPACING = 58px，所以「颗数缓增」的意图完整保留。
    const maxCountBySpan = Math.floor(spanMax / COIN_SPACING) + 1;
    const maxCount = Math.min(Math.floor((windowW - 80) / COIN_SPACING) + 1, maxCountBySpan);
    // 数量随难度缓增：countStart → countEnd 线性插值（早期少、后期多）
    const t = this._lastDifficulty || 0;
    const lo = Math.round(cr.countStart[0] + (cr.countEnd[0] - cr.countStart[0]) * t);
    const hi = Math.round(cr.countStart[1] + (cr.countEnd[1] - cr.countStart[1]) * t);
    let count = Math.max(2, Math.min(Math.max(lo, hi), maxCount));
    if (count < lo) count = Math.min(lo, maxCount);

    const span = (count - 1) * COIN_SPACING;
    // 「地面线」（整条都在贴地档）优先；平台底下也强制走地面线 ——
    // 弧线最高 216px 仍然伸不进平台（平台底面 230~275px），但从平台下钻过去时
    // 跳起来吃币会顶到平台，所以维持「平台区只走地面线」不变。
    // 注意：Math.random() 必须**无条件**调用，否则随机序列会随平台出现与否漂移。
    const arcRoll = Math.random() < cr.patternChance;
    const ground = arcRoll || this._platInX(leftX, rightX);
    // 【收尾那颗「着地币」】弧线主体只覆盖一次跳跃的前 ~0.6s（span ≤ 0.595·speed），
    // 到那时玩家还在 120~140px 的空中 —— 于是弧线的最后一颗悬在半空，**不再是贴地档币**。
    // 旧版用 sin 铺高度（sin(π)=0），"天然"让弧线两端都落在贴地档，保底账因此一直是对的；
    // 换成真抛物线后这个副作用消失了，实测「连续无贴地档金币」最长距离从 1353px 回到 1597px
    // （既有断言 ≤1500px 直接失败）。修法不是把弧线掰弯（那会让一次单跳吃不完，见 smoke 的
    // 可吃率断言），而是补一颗**落在真实着地点上**的币：t = 0.985·AIR_TIME 时玩家已降到
    // rise ≈ 25px，这颗币高度被 clamp 到 45px → 回到贴地档，而它仍在同一条抛物线上、
    // 同一次单跳必然吃到（玩家落地那一刻正好经过它）。这样「弧线两端都是贴地档」的旧不变量恢复。
    const landD = speed * AIR_TIME * COIN_ARC_LAND_MARGIN;
    const tailGap = landD - span;
    // 只有位置放得下（留出与上一颗至少 0.4 个间距）才收尾，否则退回纯网格弧线。
    const hasLand = tailGap > COIN_SPACING * 0.4 && landD <= windowW;
    const layout = ground ? span : (hasLand ? landD : span);
    const startX = ground ? winStart : winStart + (windowW - layout) / 2;
    // 这一串里「最后一颗落在贴地档上的金币」的距离坐标（保底账）。
    let bandD = -1;

    if (ground) {
      // 贴地档：整条都落在 45~70px，跑着就能一路吃（原有行为，未改）。
      const h = rand(cr.arcEndLift[0], cr.arcEndLift[1]);
      for (let i = 0; i < count; i++) {
        const c = this._takeCoin();
        c.x = startX + i * COIN_SPACING;
        c.y = GROUND_Y - h;
        c.r = 17;
        c.spin = Math.random() * 6;
        c.pulse = i * 0.4;
        c.taken = false;
        this.coins.push(c);
      }
      bandD = this._now + (startX + span - PLAYER_SCREEN_X);   // 整条都在贴地档，取最后一颗
    } else {
      // ---------------- 2) 弧线 = 真实跳跃轨迹的等时采样 ----------------
      // 第 i 颗的水平距离 d = i·COIN_SPACING，换算成时间 t = d / speed；
      // 竖直抬升 rise 用与 player.js 完全同一套常量算：
      //   · 上升段（t ≤ |JUMP_VELOCITY| / GRAVITY）：rise = −JUMP_VELOCITY·t − ½·GRAVITY·t²
      //   · 下降段：rise = 单跳顶点 − ½·(GRAVITY·FALL_MULTIPLIER)·(t − 上升时长)²
      // 这样「水平位置 ↔ 竖直高度」就是玩家真实飞行的曲线，不再是凭空的正弦。
      const tRise = Math.abs(JUMP_VELOCITY) / GRAVITY;
      const apex = SINGLE_JUMP_APEX;
      // 抛物线采样：主体那些颗 + 收尾的「着地币」共用同一套高度公式。
      const arcLift = (ct) => {
        if (ct <= tRise) return -JUMP_VELOCITY * ct - 0.5 * GRAVITY * ct * ct;
        const td = ct - tRise;
        return apex - 0.5 * GRAVITY * FALL_MULTIPLIER * td * td;
      };
      const put = (dx, pulse) => {
        // 【为什么 +SWEET】纯轨迹上的金币圆心正好落在玩家判定盒的**上沿**，
        // 只有「脚底与金币同高」那一瞬间能碰到 —— 玩家需要打到极窄的一段才能吃满一串。
        // 抬高 8~13px 相当于给判定加一条「甜区」宽容带：判定公式是「圆心到判定盒最近距离 ≤ r」，
        // 而判定盒底边比脚底高 3px、金币半径 17px，所以「脚底比金币低 17 + 3 = 20px 以内」都算吃到；
        // 最坏的 13px 也只需玩家脚底低于金币 16px < 20px → 判定必然成立。
        const h = clamp(arcLift(dx / speed) + rand(COIN_SWEET_MIN, COIN_SWEET_MAX),
          COIN_GROUND_LIFT[0], COIN_SINGLE_JUMP_REACH);
        const c = this._takeCoin();
        c.x = startX + dx;
        c.y = GROUND_Y - h;
        c.r = 17;
        c.spin = Math.random() * 6;
        c.pulse = pulse;
        c.taken = false;
        this.coins.push(c);
        // 只把「真的落在贴地档上」的这颗记进保底账（下面统一写 _lastBandD）
        if (h < COIN_GROUND_LIFT[1]) bandD = this._now + (c.x - PLAYER_SCREEN_X);
      };
      for (let i = 0; i < count; i++) put(i * COIN_SPACING, i * 0.4);
      if (hasLand) put(landD, count * 0.4);   // 收尾那颗着地币（t = 0.985·AIR_TIME，高度落回贴地档）
    }
    // 【保底账只记「真的落在贴地档上的金币」，不记「这一串的最后一颗」】——本函数的记账红线。
    // _refillCoins 反解补线位置用的是 dueX = PX + (_lastBandD + forceDist − _now)，
    // 即「上一颗贴地档金币之后 forceDist」；它成立的前提是 _lastBandD 真的是**贴地档**金币。
    // 弧线的最后一颗悬在 150~210px 高空，若照旧无条件记它，deadline 会跟着往后飘最多 ~232px
    // （末尾高空段 + 屏幕提前量），可观测空档就被顶到 1500px 以上（实测回归 1575、最大 1597px）。
    // 弧线第一颗 rise=0 → clamp 到 45px，必是贴地档，所以弧线串永远供得上一颗贴地档币。
    this._lastBandD = bandD >= 0 ? bandD : this._now + (startX + span - PLAYER_SCREEN_X);
  }

  /**
   * 【B3】在空地上放一块弹簧跳板。
   * 红线：只落在「没有障碍的空地」上 —— 中心到两侧障碍各留 ≥ SPRING_CLEAR(60)px。
   * 弹簧永远只是加分项，不会因为它的存在而收紧任何间距。
   * 概率为 0（前 ~17 秒）时一次 Math.random 都不消耗。
   */
  spawnSpringBetween(leftX, rightX, t) {
    const sp = this._recipe().spring;
    if (!sp || !sp.enabled || typeof sp.chanceAt !== 'function') return;
    const chance = sp.chanceAt(t);
    if (!(chance > 0)) return;
    const space = rightX - leftX;
    if (!Number.isFinite(space)) return;
    if (space < SPRING_CLEAR * 2 + sp.width[1] + 40) return;
    if (Math.random() >= chance) return;
    const w = rand(sp.width[0], sp.width[1]);
    const h = rand(sp.height[0], sp.height[1]);
    const cx = (leftX + rightX) / 2;
    if (cx - w / 2 - leftX < SPRING_CLEAR) return;          // 左边 60px 内有障碍
    if (rightX - (cx + w / 2) < SPRING_CLEAR) return;       // 右边 60px 内有障碍
    const s = this._takeSpring();
    s.x = cx - w / 2;
    s.y = GROUND_Y - h;
    s.w = w;
    s.h = h;
    s.cool = 0;
    s.squash = 0;
    s.onDeck = false;
    s.pulse = Math.random() * 6;
    this.springs.push(s);
  }

  /**
   * 【B2】生成一段平台。
   * 不变量（全部写进 smoke 断言）：
   *   · deckH + 20 ≤ 二段跳顶点 345.1 → 站在地面二段跳必能踩上去；
   *   · 一段平台通过 _deckBlock 独占 [spawnX, spawnX+L+exitClear] 这段路，
   *     障碍被整体后移 → 「平台 ±120px 内没有高障碍」「出口后 250px 没有障碍」；
   *   · 下一段平台至少隔 L+exitClear+gapMin(260) → 平台之间永不重叠堆叠。
   * @returns {number} 距离下一段平台的推进距离
   */
  _spawnDeck(t) {
    const dk = this._recipe().deck;
    if (!dk || !dk.enabled || typeof dk.chanceAt !== 'function') return 1200;
    const chance = dk.chanceAt(t);
    if (!(chance > 0)) return 1200;                    // 概率还是 0：确定性重试，不消耗随机数
    if (Math.random() >= chance) return rand(900, 1600);

    const spawnX = DESIGN_WIDTH + (this._recipe().spawnPad || 80);
    const L = rand(dk.len[0], dk.len[1]);
    const deckH = Math.min(dk.h[1], rand(dk.h[0], dk.h[1]));
    const thickness = dk.thickness || DECK_THICKNESS;
    const exitClear = dk.exitClear || DECK_EXIT_CLEAR;
    const falling = Math.random() < (dk.fallChance || 0);

    const p = this._takePlatform();
    p.x = spawnX;
    p.y = GROUND_Y - deckH;
    p.w = L;
    p.h = thickness;
    p.deckH = deckH;
    p.kind = falling ? 'falling' : 'deck';
    p.armed = false;
    p.timer = 0;
    p.fell = false;
    p.vy = 0;
    p.shake = 0;
    p.grd = null;
    p.fallDelay = rand((dk.fallDelay || DECK_FALL_DELAY)[0], (dk.fallDelay || DECK_FALL_DELAY)[1]);
    this.platforms.push(p);

    // 占住这段路：障碍生成被推迟到「平台右边缘 + 250px」之后
    this._deckBlock = L + exitClear;

    // 平台前面（上一根障碍 → 平台左边缘）也补一串：平台区会把一个空隙拉得很长，
    // 不补的话这里会出现一段「只有平台、没有金币」的空白。
    this.spawnCoinsBetween(this.lastObstacleRight, spawnX - 40);

    // 平台顶面之上撒几颗金币（贴地档：站在平台上一路吃过去）
    const lift = dk.coinLift || DECK_COIN_LIFT;
    const n = Math.max(2, Math.min(8, Math.floor((L - 80) / COIN_SPACING) + 1));
    const startX = spawnX + (L - (n - 1) * COIN_SPACING) / 2;
    const coinH = rand(lift[0], lift[1]);
    for (let i = 0; i < n; i++) {
      const c = this._takeCoin();
      c.x = startX + i * COIN_SPACING;
      c.y = p.y - coinH;
      c.r = 17;
      c.spin = Math.random() * 6;
      c.pulse = i * 0.4;
      c.taken = false;
      this.coins.push(c);
    }

    // 平台入口的弹簧（纯加分项：不是踩上平台的必要条件，deckH 本身就已经可达）
    if (p.kind === 'deck' && Math.random() < 0.7) {
      const sw = rand(SPRING_WIDTH[0], SPRING_WIDTH[1]);
      const sh = rand(SPRING_HEIGHT[0], SPRING_HEIGHT[1]);
      const s = this._takeSpring();
      s.x = spawnX + 90 - sw / 2;
      s.y = p.y - sh;
      s.w = sw;
      s.h = sh;
      s.cool = 0;
      s.squash = 0;
      s.onDeck = true;
      s.pulse = Math.random() * 6;
      this.springs.push(s);
    }

    return L + exitClear + (dk.gapMin || DECK_GAP_MIN) + rand(600, 1800);
  }

  /** 平台每帧推进：左移；坠落地形抖动警示 → 受重力下落 → 出界回收 */
  _stepPlatform(p, dx, dt) {
    p.x -= dx;
    if (p.kind !== 'falling' || !p.armed) return;
    if (!p.fell) {
      p.timer += dt;
      p.shake = Math.min(1, p.timer / Math.max(0.001, p.fallDelay));
      if (p.timer >= p.fallDelay) { p.fell = true; p.vy = 0; }
    } else {
      p.vy += (DECK_FALL_GRAVITY) * dt;
      p.y += p.vy * dt;
    }
  }

  /**
   * 【B2 契约】把「地面」从单个标量推广成「玩家脚下最高的可站表面」。
   * 规则（严格按这一条，不许在别处打补丁）：
   *   在所有 x 区间覆盖玩家脚下、且「顶面不低于玩家当前脚底」（feetY ≤ p.y + 容差，
   *   即玩家在平台上方或刚穿过）、且「正在下落或刚踩上」（vy ≥ 0）的平台里取最高的顶面；
   *   没有平台就是 GROUND_Y。
   * 两种「卡死」都被这一条排除：
   *   · 从下方穿上去时 vy < 0 → 直接返回 GROUND_Y，绝不会被吸附到平台顶；
   *   · 已经穿到平台下面（feetY > p.y + 容差）→ 也不在候选里。
   * 副作用：脚下这层如果是「坠落地形」且玩家真的站上去了，就点亮它的计时器。
   * @param {number} cx 玩家中心 x（设计像素）
   * @param {number} feetY 玩家脚底 y（**移动前**的上一帧值）
   * @param {number} vy 玩家竖直速度（≥0 表示下落/站立）
   * @param {number} [prevFeetY] 再上一帧的脚底 y。给了就额外要求「上一帧也在顶面之上」，
   *        这样「从下方穿上去正好停在离顶面 2px 以内」也不会被吸附 —— 落地判定变成
   *        真正的「从上往下穿越顶面」，单向平台语义完全闭合。
   */
  surfaceY(cx, feetY, vy, prevFeetY) {
    let best = GROUND_Y;
    let hit = null;
    if (vy >= 0) {
      const half = PLAYER_WIDTH / 2;
      const x0 = cx - half;
      const x1 = cx + half;
      for (const p of this.platforms) {
        if (p.x > x1 || p.x + p.w < x0) continue;      // x 区间不覆盖玩家脚下
        if (feetY > p.y + SURFACE_TOL) continue;       // 脚底已经在顶面之下 → 不算（单向平台）
        // 上一帧也得在顶面之上（穿越检测）：只有「从上面掉下来」才允许落上去
        if (typeof prevFeetY === 'number' && prevFeetY > p.y + SURFACE_TOL) continue;
        if (p.y < best) { best = p.y; hit = p; }
      }
    }
    if (hit && hit.kind === 'falling' && !hit.armed &&
        Math.abs(feetY - hit.y) <= SURFACE_TOL + 1) {
      hit.armed = true;                                 // 第一次真正站上去 → 开始抖动倒计时
      hit.timer = 0;
    }
    return best;
  }

  /**
   * 【B3】弹簧触发。返回要设置的 vy（0 = 没触发）。
   * 触发条件：vy ≥ 0（下落中或跑动中，绝不在上升时触发，避免连环弹），
   *           x 区间与弹簧重叠，脚底落在弹簧顶面附近的一条带里
   *           （高出 ≤ SPRING_FEET_BAND，低到不超过弹簧底面 +6）。
   * 冷却：同一次接触只触发一次（0.30s 内不再触发；这段时间弹簧早被甩到画面外）。
   */
  triggerSprings(px, pw, feetY, vy) {
    if (!(vy >= 0)) return 0;
    for (const s of this.springs) {
      if (s.cool > 0) continue;
      if (px + pw < s.x || px > s.x + s.w) continue;
      if (feetY > s.y + s.h + 6) continue;               // 脚底已经掉到弹簧底下
      if (feetY < s.y - SPRING_FEET_BAND) continue;      // 脚底还离弹簧太高
      s.cool = SPRING_COOLDOWN;
      s.squash = 1;
      return -SPRING_VELOCITY;
    }
    return 0;
  }

  /** 撞碎一个障碍（闯关模式护盾抵扣时用）：从场上移除并回池 */
  breakObstacle(o) {
    const i = this.obstacles.indexOf(o);
    if (i >= 0) {
      this.obstacles.splice(i, 1);
      this._obsPool.push(o);
    }
  }

  /** 竞技场里剩下的金币数（未被吃掉的才算，HUD 显示用） */
  coinsLeft() {
    let n = 0;
    for (const c of this.coins) if (!c.taken) n++;
    return n;
  }

  render(ctx) {
    // ---- 平台：单向平台（青色，顶面一条亮边）/ 坠落地形（红橙 + 抖动） ----
    // 全部用纯色填充 + 描边发光：平台会随坠落改变 y，缓存竖向渐变会失效，
    // 与其每帧 createLinearGradient（性能红线禁止），不如干脆不用渐变。
    for (const p of this.platforms) {
      const falling = p.kind === 'falling';
      const jitter = falling && p.armed && !p.fell ? Math.sin(p.timer * 62) * 3.5 * p.shake : 0;
      const col = falling ? COLORS.danger : COLORS.neonCyan;
      ctx.save();
      ctx.translate(jitter, 0);
      ctx.fillStyle = falling ? 'rgba(120,20,26,0.75)' : 'rgba(4,44,60,0.82)';
      ctx.shadowColor = col;
      ctx.shadowBlur = 16;
      roundRect(ctx, p.x, p.y, p.w, p.h, 8);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = 3;
      ctx.strokeStyle = col;
      ctx.stroke();
      // 顶面亮边：这就是「可站表面」，让单向规则一眼看懂
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = falling ? COLORS.danger : COLORS.white;
      ctx.fillRect(p.x + 3, p.y - 3, p.w - 6, 4);
      // 单向提示：顶面上朝上的小箭头（能踩、能从下面穿过）
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = col;
      for (let x = p.x + 26; x < p.x + p.w - 18; x += 74) {
        ctx.beginPath();
        ctx.moveTo(x, p.y + p.h - 5);
        ctx.lineTo(x + 9, p.y + 8);
        ctx.lineTo(x + 18, p.y + p.h - 5);
        ctx.closePath();
        ctx.fill();
      }
      if (falling && p.armed && !p.fell) {          // 抖动警示：倒计时条
        ctx.globalAlpha = 1;
        ctx.fillStyle = COLORS.neonYellow;
        ctx.fillRect(p.x + 12, p.y - 12, (p.w - 24) * Math.min(1, p.timer / Math.max(0.001, p.fallDelay)), 5);
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    // ---- 弹簧跳板：底板 + 压缩的顶板（压缩量由 squash 驱动） ----
    for (const s of this.springs) {
      const comp = s.squash * s.h * 0.55;
      const glow = 0.5 + 0.5 * Math.sin(s.pulse * 2.2);
      ctx.save();
      ctx.fillStyle = 'rgba(6,40,24,0.9)';
      ctx.shadowColor = COLORS.neonGreen;
      ctx.shadowBlur = 10 + 10 * glow;
      roundRect(ctx, s.x, s.y + comp, s.w, Math.max(4, s.h - comp), 4);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = 2;
      ctx.strokeStyle = COLORS.neonGreen;
      ctx.stroke();
      // 顶面板（被踩下去的那一块）
      ctx.fillStyle = COLORS.neonGreen;
      ctx.globalAlpha = 0.9;
      roundRect(ctx, s.x - 3, s.y + comp - 3, s.w + 6, 6, 3);
      ctx.fill();
      // 弹簧纹（三条斜线，纯路径，不 new 对象）
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = COLORS.white;
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const yy = s.y + comp + 5 + i * 5;
        ctx.moveTo(s.x + 8, yy);
        ctx.lineTo(s.x + s.w - 8, yy - 3);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    // ---- 障碍：霓虹渐变块 + 描边发光 + 顶部高光 ----
    for (const o of this.obstacles) {
      const hh = o.mv === 'v' ? o.hEff : o.h;      // 伸缩障碍的真实高度
      if (o.mv === 'v') {
        // 伸缩障碍的 y 每帧都在变，竖向渐变没法长期缓存 → 用纯色（不违反「不许每帧建渐变」）
        ctx.save();
        ctx.fillStyle = 'rgba(60,10,90,0.92)';
        ctx.shadowColor = o.hue;
        ctx.shadowBlur = 18;
        roundRect(ctx, o.x, o.y, o.w, hh, 10);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.lineWidth = 5;
        ctx.strokeStyle = o.hue;
        ctx.stroke();
        ctx.lineWidth = 2;
        ctx.strokeStyle = COLORS.white;
        ctx.stroke();
        // 上下浮动的提示：上下双箭头
        ctx.fillStyle = o.hue;
        ctx.globalAlpha = 0.85;
        const mx = o.x + o.w / 2;
        ctx.beginPath();                            // 上箭头
        ctx.moveTo(mx, o.y + 8);
        ctx.lineTo(mx - 8, o.y + 20);
        ctx.lineTo(mx + 8, o.y + 20);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();                            // 下箭头
        ctx.moveTo(mx, o.y + hh - 8);
        ctx.lineTo(mx - 8, o.y + hh - 20);
        ctx.lineTo(mx + 8, o.y + hh - 20);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.restore();
        continue;
      }
      // 障碍的 y 从出生到消失都不变，所以竖向渐变可以缓存复用，不必每帧新建
      if (!o.grd) {
        const g = ctx.createLinearGradient(0, o.y, 0, o.y + hh);
        g.addColorStop(0, o.hue);
        g.addColorStop(0.55, 'rgba(60,10,90,0.92)');
        g.addColorStop(1, 'rgba(15,5,40,0.95)');
        o.grd = g;
      }
      ctx.save();
      ctx.fillStyle = o.grd;
      ctx.shadowColor = o.hue;
      ctx.shadowBlur = 18;
      roundRect(ctx, o.x, o.y, o.w, hh, 10);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = 3;
      ctx.strokeStyle = COLORS.white;
      ctx.stroke();
      // 顶部高光（一条亮边，让方块有体积感）
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = COLORS.white;
      roundRect(ctx, o.x + 4, o.y + 4, o.w - 8, 6, 3);
      ctx.fill();
      // 内部装饰条纹
      ctx.globalAlpha = 0.28;
      for (let yy = o.y + 20; yy < o.y + hh - 8; yy += 22) {
        ctx.fillRect(o.x + 8, yy, o.w - 16, 3);
      }
      // 水平巡逻提示：左右两个朝外的箭头 + 一条贯穿的轨道线
      if (o.mv === 'h') {
        ctx.globalAlpha = 0.55;
        ctx.strokeStyle = o.hue;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(o.x - o.amp, o.y + hh / 2);
        ctx.lineTo(o.x + o.w + o.amp, o.y + hh / 2);
        ctx.stroke();
        ctx.fillStyle = o.hue;
        ctx.beginPath();
        ctx.moveTo(o.x - o.amp, o.y + hh / 2);
        ctx.lineTo(o.x - o.amp + 12, o.y + hh / 2 - 8);
        ctx.lineTo(o.x - o.amp + 12, o.y + hh / 2 + 8);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(o.x + o.w + o.amp, o.y + hh / 2);
        ctx.lineTo(o.x + o.w + o.amp - 12, o.y + hh / 2 - 8);
        ctx.lineTo(o.x + o.w + o.amp - 12, o.y + hh / 2 + 8);
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    // ---- 金币：旋转闪烁 + 光晕（全部用同心圆叠出来，不建渐变） ----
    for (const c of this.coins) {
      if (c.taken) continue;
      const sx = Math.abs(Math.cos(c.spin)) * 0.75 + 0.25;   // 旋转的视觉效果
      const flash = 0.5 + 0.5 * Math.sin(c.pulse * 2.4);
      ctx.save();
      ctx.translate(c.x, c.y);
      // 光晕：三层同心圆，越外越淡（比每帧 createRadialGradient 便宜得多）
      ctx.globalAlpha = 0.16 + 0.1 * flash;
      ctx.fillStyle = COLORS.neonYellow;
      ctx.beginPath();
      ctx.arc(0, 0, c.r * 1.75, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.scale(sx, 1);
      ctx.shadowColor = COLORS.neonYellow;
      ctx.shadowBlur = 20;
      ctx.fillStyle = COLORS.neonYellow;
      ctx.beginPath();
      ctx.arc(0, 0, c.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.arc(0, 0, c.r * 0.52, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = COLORS.neonYellow;
      ctx.beginPath();
      ctx.arc(0, 0, c.r * 0.26, 0, Math.PI * 2);
      ctx.fill();
      // 高光点（随闪烁移动）
      ctx.globalAlpha = 0.55 + 0.45 * flash;
      ctx.fillStyle = COLORS.white;
      ctx.beginPath();
      ctx.arc(-c.r * 0.32, -c.r * 0.34, c.r * 0.16, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  /**
   * 只用于调试/自测：当前速度下所有障碍是否都满足可达性。
   * 【v1.3】改用「最坏包络」worstX/worstW：
   *   水平巡逻的障碍会左右移动，只有把两侧极限都算进去才能保证
   *   「无论它此刻停在哪，这一段空隙都跳得过去」。
   *   静止障碍的 worstX/worstW 就是 x/w → 与 v1.2 完全一致。
   * 这里刻意用文档里那条最保守的公式（减去最宽的障碍），
   * 生成时留的空气空隙比它更宽，所以这个断言必须永远成立。
   */
  static verifyReachability(obstacles, speed) {
    const minGap = speed * AIR_TIME - MAX_OBSTACLE_WIDTH + GAP_MARGIN;
    for (let i = 1; i < obstacles.length; i++) {
      const prev = obstacles[i - 1];
      const cur = obstacles[i];
      const px = prev.worstX !== undefined ? prev.worstX : prev.x;
      const pw = prev.worstW !== undefined ? prev.worstW : prev.w;
      const cx = cur.worstX !== undefined ? cur.worstX : cur.x;
      const gap = cx - (px + pw);
      if (gap < minGap * 0.999) return false;
    }
    return true;
  }
}

export default Spawner;