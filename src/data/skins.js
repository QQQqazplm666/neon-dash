// ============================================================
// skins.js —— 皮肤数据表（纯数据，不含任何逻辑）
//
// 约定：
//   · id      存档里记录的就是它，一旦发布不要改（改了等于玩家掉皮肤）
//   · price   钱包金币售价，0 分两种（用户要求：旧的图片皮肤下线、得意胖子免费领取）：
//             classic 默认拥有（开局就在 ownedSkins 里）；
//             fatblob 免费但【不默认拥有】—— 必须在商城卡片上手动点「免费领取」
//             才会写进 ownedSkins。免费 ≠ 默认拥有。
//   · colors  body 主体色 / bodyDark 渐变暗端 / bodyLight 渐变亮端
//             glow 外发光 / eye 眼睛 / trail 拖尾粒子色 / ground 地面投影色(可选)
//   · shape   几何形状，绘制逻辑在 entities/player.js 的 pathSkinShape()
//   · effect  可选特效，纯表现：pulse 脉冲光晕 / ghost 残影 / spark 火花 / shimmer 流光
//   · trailWidth 拖尾粗细倍率（只影响粒子大小，不影响判定）
//   · image   可选，图片皮肤的内嵌 data URI（来自 data/skin-images.js）。
//             有 image 时 entities/player.js 用 drawImage 画这张图，形状/眼睛
//             等程序化部分自动让位；colors 依旧负责外发光、拖尾、商城配色。
//
// 【重要】皮肤只影响外观。玩家的命中盒永远是 config.PLAYER_WIDTH/HEIGHT
// 决定的那个矩形（player.hitbox()），任何皮肤都不会改动它，也不会改动
// 速度、重力、分数等任何数值。
//
// 【重要】本数组必须按 price 非递减排列（tests/smoke.mjs 有断言）。
// 全表只有 classic 与 fatblob 两款是 0 价（相邻放在最前面）：classic 默认拥有，
// fatblob 必须在商城里免费领取。其余价格的皮肤一律 > 0。
// 商城展示用 skinsByPrice() 排序，但数组本身的顺序是「价格梯度」的声明。
//
// 【v1.3 网络热梗系列】kun / menglei / wulianbian / dianyao / gaoyuan / panda
// 六款是「抽象梗化造型」：只用现有 shape/effect 组合，靠配色 + 形状 + 特效
// 表达梗的气质，不画任何现实人物的脸或形象，也不使用现实人物姓名。
//
// 【v1.4 图片皮肤系列】fatblob / iceblob 两款是**内嵌图片皮肤**：
// 位图由用户提供，经 tools/make-skin-images.py 处理成 96×120 的 RGBA 精灵，
// 再 base64 内嵌进 data/skin-images.js（不新增图片文件、不引用外链，断网可玩）。
// 其余 13 款仍是 Canvas 程序化绘制。图片皮肤同样只影响外观：绘制时按精灵
// 矩形铺满，判定盒与数值一个字都不动。两款皮肤名与描述都不含真实人物姓名。
// ============================================================

import { SKIN_IMAGES } from './skin-images.js';

export const DEFAULT_SKIN_ID = 'classic';

export const SKINS = [
  {
    id: 'classic',
    name: '经典霓虹',
    desc: '出厂涂装，青蓝渐变',
    price: 0,
    colors: {
      body: '#00f0ff', bodyDark: '#0b6cff', bodyLight: '#7dfcff',
      glow: '#00f0ff', eye: '#06121a', trail: '#00f0ff', ground: '#000000',
    },
    shape: 'rounded',
    effect: 'none',
    trailWidth: 1,
  },
  {
    // —— v1.4 图片皮肤：得意胖子（用户提供位图，内嵌 data URI）——
    // 用户要求：旧的图片皮肤下线、得意胖子免费领取 —— 0 金币，但【不默认拥有】，
    // 必须在商城卡片上手动点「免费领取」才写进 ownedSkins。
    id: 'fatblob',
    name: '得意胖子',
    desc: '圆滚滚一只 · 满脸得意',
    price: 0,
    colors: {
      body: '#ffc22e', bodyDark: '#8a5a00', bodyLight: '#fff3c4',
      glow: '#ffcc4d', eye: '#2a1c00', trail: '#ffe07a', ground: '#1a1200',
    },
    shape: 'capsule',
    effect: 'pulse',
    trailWidth: 1.3,
    image: SKIN_IMAGES.fatblob,
  },
  {
    id: 'ember',
    name: '熔岩核心',
    desc: '胶囊造型，脉冲发热',
    price: 120,
    colors: {
      body: '#ff7a18', bodyDark: '#8c1400', bodyLight: '#ffd36b',
      glow: '#ff5a00', eye: '#2a0700', trail: '#ff9b3d', ground: '#1a0500',
    },
    shape: 'capsule',
    effect: 'pulse',
    trailWidth: 1.35,
  },
  {
    id: 'mint',
    name: '薄荷方糖',
    desc: '方正棱角，清爽绿光',
    price: 260,
    colors: {
      body: '#39ff88', bodyDark: '#0b7a44', bodyLight: '#b6ffd8',
      glow: '#39ff88', eye: '#04220f', trail: '#7dffb8', ground: '#02120a',
    },
    shape: 'square',
    effect: 'none',
    trailWidth: 0.9,
  },
  {
    // —— 网络热梗：篮球 · 唱跳 RAP ——
    id: 'kun',
    name: '篮球少年',
    desc: '唱跳 RAP 篮球 · 运球火花',
    price: 300,
    colors: {
      body: '#ff8a1e', bodyDark: '#7a2b00', bodyLight: '#ffd7a0',
      glow: '#ff7a18', eye: '#2a1200', trail: '#ffb347', ground: '#1a0a00',
    },
    shape: 'circle',
    effect: 'spark',
    trailWidth: 1.3,
  },
  {
    id: 'orb',
    name: '虚空能量球',
    desc: '球形能量体，自带残影',
    price: 420,
    colors: {
      body: '#a44cff', bodyDark: '#3a0a7a', bodyLight: '#d7b0ff',
      glow: '#c07dff', eye: '#150029', trail: '#a44cff', ground: '#0a0018',
    },
    shape: 'circle',
    effect: 'ghost',
    trailWidth: 1.2,
  },
  {
    // —— 网络热梗：偷家 · 残影突袭 ——
    id: 'menglei',
    name: '梦泪偷家',
    desc: '暗夜刺客 · 残影突袭',
    price: 450,
    colors: {
      body: '#7a5cff', bodyDark: '#1b0a4a', bodyLight: '#cfc0ff',
      glow: '#9d7dff', eye: '#0d0524', trail: '#b39bff', ground: '#080318',
    },
    shape: 'diamond',
    effect: 'ghost',
    trailWidth: 1.25,
  },
  {
    // —— v1.4 图片皮肤：冰淇淋胖子（用户提供位图，内嵌 data URI）——
    id: 'iceblob',
    name: '冰淇淋胖子',
    desc: '奶黄一团 · 举着冰淇淋',
    price: 500,
    colors: {
      body: '#ffe98a', bodyDark: '#a5761a', bodyLight: '#fffbe6',
      glow: '#ffe066', eye: '#33260a', trail: '#fff3b0', ground: '#1a1400',
    },
    shape: 'capsule',
    effect: 'shimmer',
    trailWidth: 1.2,
    image: SKIN_IMAGES.iceblob,
  },
  {
    // —— 网络热梗：五连鞭 · 电光 ——
    id: 'wulianbian',
    name: '闪电五连鞭',
    desc: '混元太极 · 五连鞭电光',
    price: 600,
    colors: {
      body: '#ffd93d', bodyDark: '#6b4a00', bodyLight: '#fffbe0',
      glow: '#ffe066', eye: '#2a1e00', trail: '#fff29b', ground: '#1a1400',
    },
    shape: 'square',
    effect: 'pulse',
    trailWidth: 1.4,
  },
  {
    id: 'prism',
    name: '棱镜菱晶',
    desc: '菱形切割，碰撞出火花',
    price: 700,
    colors: {
      body: '#ff2d95', bodyDark: '#7a0a45', bodyLight: '#ffd0e6',
      glow: '#ff2d95', eye: '#2b0417', trail: '#ffe95c', ground: '#14020c',
    },
    shape: 'diamond',
    effect: 'spark',
    trailWidth: 1.1,
  },
  {
    // —— 网络热梗：荧光摇摆 · 嘲讽 ——
    id: 'dianyao',
    name: '电摇嘲讽',
    desc: '荧光摇摆 · 嘲讽流光',
    price: 750,
    colors: {
      body: '#a7ff00', bodyDark: '#3d6b00', bodyLight: '#e8ffb0',
      glow: '#c6ff33', eye: '#142100', trail: '#d9ff66', ground: '#0c1400',
    },
    shape: 'capsule',
    effect: 'shimmer',
    trailWidth: 1.1,
  },
  {
    // —— 网络热梗：一眼纯真 · 高原蓝 ——
    id: 'gaoyuan',
    name: '高原少年',
    desc: '一眼纯真 · 藏蓝流光',
    price: 900,
    colors: {
      body: '#39c0ff', bodyDark: '#0a3b6b', bodyLight: '#bfe9ff',
      glow: '#6fd4ff', eye: '#04182a', trail: '#9ee2ff', ground: '#02121f',
    },
    shape: 'rounded',
    effect: 'shimmer',
    trailWidth: 1.05,
  },
  {
    // —— 网络热梗：黑白 · 墨镜 ——
    id: 'panda',
    name: '熊猫头',
    desc: '黑白熊猫 · 冷酷墨镜',
    price: 1000,
    colors: {
      body: '#f2f2f2', bodyDark: '#5a5a5a', bodyLight: '#ffffff',
      glow: '#ffffff', eye: '#0a0a0a', trail: '#e8e8e8', ground: '#101010',
    },
    shape: 'circle',
    effect: 'none',
    trailWidth: 1.0,
  },
  {
    id: 'hexa',
    name: '六角矩阵',
    desc: '蜂巢六边形，青绿脉冲',
    price: 1100,
    colors: {
      body: '#00ffc3', bodyDark: '#046b58', bodyLight: '#c6fff2',
      glow: '#00ffc3', eye: '#00241d', trail: '#39ff88', ground: '#00120e',
    },
    shape: 'hexagon',
    effect: 'pulse',
    trailWidth: 1.15,
  },
  {
    id: 'nova',
    name: '超新星',
    desc: '五角星形，金白流光',
    price: 1800,
    colors: {
      body: '#fff2b0', bodyDark: '#c98a00', bodyLight: '#ffffff',
      glow: '#ffe95c', eye: '#3a2600', trail: '#ffffff', ground: '#1a1200',
    },
    shape: 'star',
    effect: 'shimmer',
    trailWidth: 1.6,
  },
];

/** 所有合法皮肤 id（存档校验用） */
export const SKIN_IDS = SKINS.map((s) => s.id);

const BY_ID = new Map(SKINS.map((s) => [s.id, s]));

/** 按 id 取皮肤；id 非法或缺失时回退到默认皮肤，永不返回 undefined */
export function getSkin(id) {
  return BY_ID.get(id) || BY_ID.get(DEFAULT_SKIN_ID);
}

/** 皮肤是否真实存在（区别于 getSkin 的兜底行为） */
export function hasSkin(id) {
  return BY_ID.has(id);
}

/** 按价格从低到高排好的列表（商城展示用） */
export function skinsByPrice() {
  return SKINS.slice().sort((a, b) => a.price - b.price);
}