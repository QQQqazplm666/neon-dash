// ============================================================
// config.js —— 全局配置（所有“魔法数字”都集中在这里，方便调参）
//
// 坐标单位是「设计像素」：不管手机屏幕多大，游戏内部永远按 720x1280 来画，
// 引擎（core/engine.js）负责把这套坐标等比缩放并居中到真实屏幕上。
// ============================================================

export const GAME_NAME = '霓虹冲刺';        // 中文标题
export const GAME_NAME_EN = 'NEON DASH';    // 英文副标题
export const VERSION = '1.3.0';             // 存档版本 / 显示用版本号

// ---------------- 设计分辨率（竖屏优先） ----------------
export const DESIGN_WIDTH = 720;
export const DESIGN_HEIGHT = 1280;

// ---------------- 世界布局 ----------------
export const GROUND_Y = 990;             // 地面在屏幕中的 y 坐标（往下是地面）
export const PLAYER_X_RATIO = 0.25;      // 玩家固定在屏幕宽度的 25% 处

// ---------------- 物理与手感参数 ----------------
export const GRAVITY = 2600;             // 上升时的重力加速度（必须 > 0）
export const FALL_MULTIPLIER = 1.45;     // 下落时把重力放大，落地更干脆
export const MAX_FALL_SPEED = 1700;      // 最大下落速度（防止穿模）
export const JUMP_VELOCITY = -1010;      // 起跳速度（负号表示向上）
export const DOUBLE_JUMP_VELOCITY = -880;// 二段跳速度
export const MAX_JUMPS = 2;              // 允许的跳跃次数（2 = 二段跳）
export const COYOTE_TIME = 0.1;          // 土狼时间：离开地面后仍能起跳的宽限
export const JUMP_BUFFER = 0.12;         // 跳跃缓冲：落地前提前按键也算数
export const PLAYER_WIDTH = 46;
export const PLAYER_HEIGHT = 58;

// ---------------- 难度曲线（v1.1 重做：放缓 + S 形平滑） ----------------
//
// 【为什么改】旧版是「速度随距离线性上升」，13000 像素跑满难度。
//   按旧参数估算：平均速度 ≈ (400+980)/2 = 690 像素/秒，
//   所以 13000 / 690 ≈ 19 秒就跑满最高速 —— 玩家反馈「难度进展太快」。
//
// 【新目标】跑到接近最高速要 90~120 秒；前 ~15 秒几乎不变（新手喘息），
//   中段稳定上升，后段趋于平台。所以这里不用直线，改用 S 形的
//   smoothstep 曲线：  d(p) = p²·(3 − 2p)      （p = 距离 / SPEED_RAMP_DISTANCE，夹在 0..1）
//   它的导数 d'(p) = 6p(1−p) 在 p=0 和 p=1 处都是 0，也就是
//   「开头几乎不加速、结尾自动趋于平台」，而 p=0.5 处导数最大 = 1.5，
//   中段上升最明显 —— 正好是要的“分段感”，而且是连续可导的，不会突变。
//
// 【距离 → 时间换算依据】
//   曲线对距离的平均值 = ∫₀¹ p²(3−2p) dp = 0.5，所以跑完 SPEED_RAMP_DISTANCE
//   这段路的平均速度 ≈ BASE_SPEED + (MAX_SPEED − BASE_SPEED) × 0.5
//                                  = 400 + 580 × 0.5 = 690 像素/秒。
//   想要「跑满难度」用时 ≈ 100 秒，就需要 SPEED_RAMP_DISTANCE ≈ 690 × 100 = 69000。
//   取整为 70000；按固定步长 1/60 秒数值积分实测：
//     · 15 秒时速度仅 400 → 412（几乎没变，给新手喘息）
//     · 30 秒 449 ／ 45 秒 512 ／ 60 秒 604 ／ 75 秒 726 ／ 90 秒 863
//     · 101.7 秒达到「最高速的 95%」，约 115 秒封顶 MAX_SPEED
//   （tests/smoke.mjs 里有对应断言：跑满难度所需时间必须落在 90~150 秒。）
export const BASE_SPEED = 400;           // 起始滚动速度（设计像素/秒）
export const MAX_SPEED = 980;            // 速度上限
export const SPEED_RAMP_DISTANCE = 70000;// 跑完这段距离后达到最高速（见上方推导）

// 生成节奏也跟着同一条难度曲线收紧（不再是另一条独立的直线），
// 这样“速度”和“障碍密度”两条难度轴永远同步，不会一个先到顶。
export const SPAWN_INTERVAL_START = 1.25;// 开局两个障碍之间的时间间隔（秒）
export const SPAWN_INTERVAL_MIN = 0.68;  // 最密集时的时间间隔（秒）
export const AIR_TIME = 0.70;            // 一次完整起跳的滞空时间（秒），用于可达性校验
export const GAP_MARGIN = 70;            // 可达性安全余量（设计像素）
export const MIN_OBSTACLE_WIDTH = 44;    // 障碍最小宽度
export const MAX_OBSTACLE_WIDTH = 96;    // 障碍最大宽度
export const MAX_OBSTACLE_HEIGHT = 250;  // 障碍最大高度（需要二段跳才能过）
export const COIN_SPACING = 58;          // 金币之间的水平间距
export const FIRST_SPAWN_GAP = 900;      // 开局先跑一段空路再出障碍

/**
 * smoothstep 缓动：把 p 夹到 0..1 后返回 p²(3−2p)。
 * v1.2 从 difficultyAt 里抽出来单独导出，好让闯关模式用「每关自己的
 * rampDistance」复用同一条曲线（行为与原先逐字节等价，纯重构）。
 */
export function ease(p) {
  if (!(p > 0)) p = 0;              // 同时挡住 NaN
  else if (p > 1) p = 1;
  return p * p * (3 - 2 * p);       // smoothstep：两端导数为 0，中段最陡
}

/**
 * 难度进度 0..1（S 形平滑曲线）。
 * 所有和难度相关的东西（速度、出障碍的间隔、高障碍概率）都读这一个函数，
 * 保证它们永远同步。纯函数，测试里可以直接引用。
 */
export function difficultyAt(distance) {
  return ease(distance / SPEED_RAMP_DISTANCE);
}

/** 当前速度（设计像素/秒）＝ 基础速度 + 速度区间 × 难度进度 */
export function speedAt(distance) {
  return BASE_SPEED + (MAX_SPEED - BASE_SPEED) * difficultyAt(distance);
}

// ---------------- 计分 ----------------
export const SCORE_PER_PIXEL = 0.1;      // 每前进 10 设计像素得 1 分
export const COIN_SCORE = 10;            // 每枚金币的分数

// ---------------- 霓虹配色表 ----------------
export const COLORS = {
  bgTop: '#0a0a1f',
  bgBottom: '#1b0b33',
  ground: '#0e0722',
  grid: '#00f0ff',
  neonPink: '#ff2d95',
  neonCyan: '#00f0ff',
  neonYellow: '#ffe95c',
  neonPurple: '#a44cff',
  neonGreen: '#39ff88',
  white: '#ffffff',
  danger: '#ff3b3b',
};

// ---------------- 背景主题（随距离渐变，纯视觉） ----------------
// drawBackdrop 会在相邻两套配色之间做交叉淡入，越跑越像换了个城市。
export const BG_PALETTES = [
  { top: '#0a0a1f', mid: '#170a2e', bottom: '#1b0b33', glow: '164,76,255', cityFar: '90,40,160', cityNear: '20,10,50', edgeFar: '#a44cff', edgeNear: '#00f0ff' },
  { top: '#05101f', mid: '#0b2540', bottom: '#123a52', glow: '0,150,255', cityFar: '30,70,140', cityNear: '8,22,50', edgeFar: '#39ff88', edgeNear: '#00f0ff' },
  { top: '#170521', mid: '#33103f', bottom: '#451240', glow: '255,45,149', cityFar: '120,25,110', cityNear: '30,8,40', edgeFar: '#ff2d95', edgeNear: '#ffe95c' },
  { top: '#1d0810', mid: '#3b1220', bottom: '#571a17', glow: '255,120,40', cityFar: '150,60,30', cityNear: '40,14,12', edgeFar: '#ffe95c', edgeNear: '#ff2d95' },
  // v1.2 追加：闯关 L5「霓虹心脏」专用（白热边缘 + 品红辉光）。
  // 闯关模式按 paletteIndex 锁定配色，玩家从 L1→L5 就是「越过深入城市核心」。
  { top: '#12061a', mid: '#2a0a3a', bottom: '#3d0a2a', glow: '255,60,200', cityFar: '140,30,150', cityNear: '26,6,40', edgeFar: '#ffffff', edgeNear: '#ff2d95' },
];

// ============================================================
// v1.3.0 —— 无尽模式三机制 + 金币分布修正
//
// 【总开关】ENDLESS_MECHANICS === false 时，无尽模式回到 v1.2 的
//   「配方 + 金币参数 + 随机序列」三件套（生成器走 DEFAULT_RECIPE 里
//   的 V12 分支），用于一键回滚 / A-B 对比。闯关模式永远走 v1.2 分支。
//
// 【本轮所有数字的推导依据】（都是可以从 config 里的物理量复算出来的）
//   单跳顶点   = JUMP_VELOCITY²/(2·GRAVITY)          = 1010²/5200 = 196.2
//   二段跳顶点 = 上面 + DOUBLE_JUMP_VELOCITY²/(2·G)  = 196.2 + 880²/5200 = 345.1
//   金币判定半径 r = 17（spawner 里的写死值，这里复述一遍当口径）
//   金币「贴地档」可达上限 = PLAYER_HEIGHT + r = 58 + 17 = 75
// ============================================================

/** 无尽模式三机制总开关（false = 回到 v1.2；闯关模式不受影响，永远关着） */
export const ENDLESS_MECHANICS = true;

/**
 * 难度进度 t ∈ 0..1 的「缓升窗口」：t ≤ t0 恒为 0，t ≥ t1 恒为 1，
 * 中间用 smoothstep（和 difficultyAt 同一条曲线），保证「越跑越花」而不是突然冒出来。
 * 窗口的 t0 换算成时间：difficultyAt(d)=t0 解出 d，再按速度曲线积分。
 *   t0 = 0.06 → d ≈ 10.3k px ≈ 19 秒（「前 ~20 秒基本不出现」就是这么来的）
 *   t0 = 0.05 → d ≈ 9.4k px  ≈ 17 秒
 *   t0 = 0.08 → d ≈ 12.2k px ≈ 22 秒
 */
export function mechRamp(t, t0, t1) {
  if (!(t > t0)) return 0;            // 同时挡住 NaN / undefined
  if (t >= t1) return 1;
  return ease((t - t0) / (t1 - t0));
}

// ---------------- 金币分布（v1.3 修正） ----------------
// 【旧版问题（_verify/coin-diagnostic.mjs 实测，200 次模拟）】
//   · 金币离地高度中位数 116px，贴地跑能吃到（≤75px）的只占 9.2%
//   · 金币数量恒被钳到 countMax=5，且 38% 的空隙一颗都不撒 → 「忽多忽少」
//   · 无尽模式最长连续无金币距离 5944px（pityGaps = 0）
//   · 高障碍正上方的金币用绝对高度 220~286，而障碍自身 215~250 高，
//     金币下沿嵌进障碍盒子 → 「重叠」且玩家根本吃不到（L5 实测 1334 处）
export const COIN_RADIUS = 17;                 // 金币判定半径（与 spawner 保持一致，测试引这个）
export const COIN_GROUND_LIFT = [45, 70];      // 贴地档：奔跑中就能吃（≤75），下沿 28px 不穿地面
export const COIN_ARC_END_LIFT = [45, 70];     // 弧线两端的高度（就在贴地档内 → 跳起来吃更多，不跳也吃得到）
// 【v1.3.1 修正】弧顶原来写 260，注释里声称「< 单跳包络 271」——那个 271 是错的。
// 真口径是「单跳触碰天花板」= 单跳顶点 + (判定盒底边高出脚底 3px) + 金币判定半径 17
//                                    = 196.173 + 3 + 17 = 216.173px。
// 也就是说离地 217~260px 的那一段**必须二段跳才吃得到**，而玩家反馈正是
// 「跳跃时跟不上弧线，明明跳了却吃不到」。现在弧线金币一律 ≤ 216（见 spawner._spawnRouteV13），
// 并且由 `COIN_SINGLE_JUMP_REACH` 反推出来（弧线的形状 = 玩家真实的跳跃抛物线），
// 不再出现「弧顶比单跳天花板还高」的情况。260 这个值只为旧的自测/文档引用保留。
export const COIN_ARC_TOP_MAX = 260;           // 【已不参与生成】弧线抬升的旧上限；真上限见 COIN_SINGLE_JUMP_REACH
// 单跳触碰天花板的三个组成部分（都是能在别处复算出来的量，写在这里免得又出现「271」这种拍脑袋的数）：
export const COIN_HITBOX_FEET_OFFSET = 3;      // player.hitbox() 的底边比脚底高 3px（spawner 里复述一遍当口径）
export const COIN_SINGLE_JUMP_APEX = (JUMP_VELOCITY * JUMP_VELOCITY) / (2 * GRAVITY);  // = 196.173px
// = 单跳顶点 196.173 + 判定盒 3 + 金币半径 17 = 216.173px。
// 为什么是「加」而不是「减」：金币圆心只要离判定盒**最近的边**不超过 r = 17 就算吃到（play.js._collide 的
// 圆心到矩形最近距离公式），所以玩家在单跳顶点时能碰到的最高金币圆心 = 顶点 + 3 + 17。
export const COIN_SINGLE_JUMP_REACH = COIN_SINGLE_JUMP_APEX + COIN_HITBOX_FEET_OFFSET + COIN_RADIUS;
export const COIN_HARD_TOP = 345;              // 任何金币离地的绝对上限（= 二段跳顶点，写进注释当红线）
export const COIN_GROUND_GAP = 1500;           // 无尽模式每 1500px 至少一条「地面线」（保底不变量的目标值）
export const COIN_FORCE_GROUND_DIST = 850;    // 保底触发的上限：任意两颗「贴地档金币」的距离不许超过它
export const COIN_ROUTE_WINDOW = 820;          // 一串金币最多占空隙里这么长（防止长空隙中间出现大段空白）
export const COIN_HIGH_CLEARANCE = [24, 62];   // 高空币下沿高出障碍顶面多少（修正重叠）
export const COIN_PATTERN_CHANCE = 0.30;       // 空隙里主动选「地面线」而不是「弧线」的概率

// ---------------- B3 弹簧跳板 ----------------
// 【为什么是 1520】顶点高度 = v²/(2·GRAVITY) = 1520²/5200 = 444.3px
//   红线要求 > 430px（任务要求 430px 起步；也远高于最高平台 DECK_H[1] = 275 + 20 的余量需求），留了 14px 富余。
export const SPRING_VELOCITY = 1520;
export const SPRING_WIDTH = [46, 64];
export const SPRING_HEIGHT = [16, 22];
export const SPRING_COOLDOWN = 0.30;           // 同一次接触只触发一次（落地前弹簧已被甩到画面外）
export const SPRING_CLEAR = 60;                // 弹簧左右 60px 内不许有障碍
export const SPRING_FEET_BAND = 26;            // 「脚底接触」判定带：脚底允许高出弹簧顶面 26px

// ---------------- B2 上下双层平台 + 坠落地形 ----------------
// 【可达性】DECK_H 上限 275，要求 deckH + 20 ≤ 二段跳顶点 345.1 → 275+20 = 295 ≤ 345.1 ✓
// 【为什么不是 330】平台顶面还要撒 45~70px 高的金币，金币的绝对离地高度
//   = deckH + 45~70，必须 ≤ 345（本次任务的硬红线）→ deckH ≤ 275。
//   （330 连它自己的 deckH+20 都会爆掉 345.1，所以 330 那个上界本来就不成立。）
export const DECK_H = [230, 275];
export const DECK_H_MARGIN = 20;               // 平台可达性余量（写进 smoke 断言）
export const DECK_LEN = [700, 1500];
export const DECK_GAP_MIN = 260;               // 平台之间最小空隙
export const DECK_THICKNESS = 26;
export const DECK_BUFFER = 120;                // 平台 x 区间 ±120px 不许有高障碍
export const DECK_EXIT_CLEAR = 250;            // 平台出口后 250px 地面不许有障碍
export const DECK_FALL_DELAY = [0.28, 0.45];   // 坠落地形抖动警示时长（秒）
export const DECK_FALL_GRAVITY = 3200;         // 坠落加速度（比玩家重力大，掉得更干脆）
export const DECK_FALL_CHANCE = 0.35;          // 平台里有多少是「坠落地形」
export const DECK_COIN_LIFT = [45, 70];        // 平台顶面之上撒币的高度（同样在贴地档内）
export const SURFACE_TOL = 2;                  // 单向平台「刚踩上」的容差（px）

// ---------------- B1 移动障碍 ----------------
export const MOVE_H_AMP = [30, 80];            // 水平巡逻幅度
export const MOVE_V_RETRACT = [0.55, 0.78];    // 垂直伸缩时「有效高度 / 静态高度」的下限
export const MOVE_SPEED = [30, 90];            // 运动速度 px/s
export const MOVE_H_SHARE = 0.5;               // 水平巡逻占多少（其余为垂直伸缩）

// ---------------- 三机制的概率缓升窗口 ----------------
export const MOVE_CHANCE_MAX = 0.50;
export const MOVE_RAMP = [0.06, 0.62];
export const DECK_CHANCE_MAX = 0.42;
export const DECK_RAMP = [0.08, 0.68];
export const SPRING_CHANCE_MAX = 0.34;
export const SPRING_RAMP = [0.05, 0.55];