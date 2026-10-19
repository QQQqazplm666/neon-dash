#!/usr/bin/env python3
# ============================================================
# tools/make-skin-images.py —— 生成两款「图片皮肤」的精灵图（base64 内嵌）
#
# 为什么需要这个脚本：
#   两款新皮肤（得意胖子 / 冰淇淋胖子）是用户提供的位图，不是
#   程序化绘制的几何体。为了继续守住「整个游戏零外部素材 + 断网可玩 +
#   Service Worker 预缓存不用加图片」这条红线，这里把用户原图处理成
#   96×120 的 RGBA 小精灵，再 base64 内嵌进 src/data/skin-images.js。
#
#   和 tools/make-icons.py 一样：**只在开发时跑一次**（换了原图才需要重跑），
#   不是游戏运行依赖，Node 侧也不会去调用它。
#
# 用法：
#   python tools/make-skin-images.py
#   本机 python：用任意 Python 3 + Pillow 即可（记住 python.exe 的完整路径）
#
# 处理流程（三张一致，保证「精灵外形」统一）：
#   1) 居中裁剪成宽高比 0.8（玩家精灵是 46×58，比例 0.793，取 0.8 对齐）
#   2) LANCZOS 缩放到 96×120
#   3) 白底的两张抠掉白背景（见 remove_white_bg 的阈值说明）
#   4) 统一的圆角 alpha 蒙版（半径 12px，4 倍超采样 → 抗锯齿）
#   5) 存 PNG（不写任何文本块/元数据）→ 输出到 _verify/skins-src/out/ 供目视检查
#   6) 读回 PNG 字节 → base64 → 写 src/data/skin-images.js
#
# 注意：源图在 _verify/skins-src/（只读，本脚本绝不修改它）。
# ============================================================

import base64
import io
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent          # neon-dash/
WORKSPACE = ROOT.parent.parent                          # 工作区根目录（neon-dash 的上一层）

# 源图与目视检查输出都放在 _verify/skins-src/ 下
VERIFY = WORKSPACE / '_verify'
if not VERIFY.is_dir():
    VERIFY = ROOT.parent / '_verify'                    # 兜底：万一目录布局变了
SRC = VERIFY / 'skins-src'
OUT = SRC / 'out'

JS_OUT = ROOT / 'src' / 'data' / 'skin-images.js'

SPRITE_W = 96
SPRITE_H = 120
ASPECT = SPRITE_W / SPRITE_H                            # 0.8
CORNER_RADIUS = 12                                      # 圆角蒙版半径（px，按 96×120 计）
SS = 4                                                  # 圆角蒙版超采样倍数（抗锯齿）

# —— 白底抠图阈值（只对白底图生效）——
# 思路：白背景「亮且不饱和」，黄色主体「亮但饱和度高」，两者好分离。
#   「候选白」= value ≥ LOOSE_V 且 sat ≤ LOOSE_S；
#   只有「与画面边界连通的候选白」才会被抠掉 → 主体内部的浅色（比如那只
#   胖子的奶白色肚皮，sat≈0.22）只要被黄色包住，就不会被误伤。
#   （踩过的坑之一：LOOSE_S 放到 0.22 时，肚皮的边缘会和背景连成一片被整块抠掉。）
#
#   【踩过的坑之二 — 必须记住】「收缩 1px 去吃白边」会把**细的深色细节**（冰淇淋顶上
#   那圈深色描边只有 1~2px 宽、两侧都是透明背景）整条吃掉，在主体内部留下透明洞
#   （实测 57 个洞、bbox 18×11）。把阈值收到极紧（LOOSE_S=0.045）虽然能保住描边，但
#   主体的浅色柔边不再被抠 → 包围盒变大、角色被缩得更小、四周残留一圈白晕。
#   所以这里保留宽松阈值（柔边照旧被抠掉），改为在收缩时**保护深色像素**（见下面
#   remove_white_bg 的第 3 步）。
SEED_V = 0.95
SEED_S = 0.05
LOOSE_V = 0.85
LOOSE_S = 0.12
ERODE = 1                                               # 收缩 1px 吃白边，但深色像素受保护
EDGE_FEATHER = 0.7                                      # alpha 羽化半径（高斯模糊，px）

# PNG 体积控制：每张 data URI 要 ≤ 30KB（base64 后），所以 PNG 目标 ≤ 22KB
TARGET_PNG = 22 * 1024
QUANTIZE_STEPS = (256, 192, 128, 96, 64)                 # 超预算就逐级减色

# 抠图前先把原图等比缩到工作分辨率（最长边），兼顾速度与边缘质量
WORK_MAX = 512
# contain 模式：主体四周留出的透明边（px），保证「整体塞进画布、一点不被裁」
PAD = 2

# 两款图片皮肤：源文件 → 输出名 → 是否抠白底（两款都是白底，都要抠）
#   注：按用户要求，只有上面这两款会上线；cover 分支保留备用（早期版本用过）。
JOBS = [
    ('blob-smug.png', 'fatblob', True),
    ('blob-cream.png', 'iceblob', True),
]


def hsv_of(r, g, b):
    """返回 (value, sat)，都在 0~1；sat 用 (max-min)/max 的「饱和度」定义。"""
    mx = max(r, g, b)
    mn = min(r, g, b)
    val = mx / 255.0
    sat = (mx - mn) / mx if mx > 0 else 0.0
    return val, sat


def center_crop(img, aspect):
    """居中裁剪到指定宽高比（不缩放）。"""
    w, h = img.size
    if w / h > aspect:                                  # 太宽 → 裁左右
        new_w = int(round(h * aspect))
        left = (w - new_w) // 2
        return img.crop((left, 0, left + new_w, h))
    new_h = int(round(w / aspect))                      # 太高 → 裁上下
    top = (h - new_h) // 2
    return img.crop((0, top, w, top + new_h))


def remove_white_bg(img, feather=EDGE_FEATHER, erode=ERODE):
    """
    把「与画面边界连通的白色背景」变成透明。

    做法分三步：
      1) 用宽松阈值（亮 + 不饱和）做候选掩膜，从四条边灌水（floodfill）取出与
         边界连通的白色区域 —— 主体内部的浅色（奶白肚皮）与边界不连通，安全。
      2) 连通区域内的像素二分处理：够白（≥ SEED）直接 alpha=0，过渡像素（抗锯齿
         边缘）也给低 alpha，避免出现一圈生硬的白边。
      3) 把不透明区整体收缩 erode 像素再高斯羽化 feather 像素：吃掉残留的 1px
         白边，同时边缘保持柔和（不会出现锯齿状的硬切）。
    """
    img = img.convert('RGBA')
    w, h = img.size
    src = img.load()

    # —— 1) 候选掩膜 + 从边界灌水，取出连通白背景 ——
    loose = Image.new('L', (w, h), 0)
    lp = loose.load()
    for y in range(h):
        for x in range(w):
            r, g, b, _a = src[x, y]
            val, sat = hsv_of(r, g, b)
            lp[x, y] = 255 if (val >= LOOSE_V and sat <= LOOSE_S) else 0

    # 往外扩 1px 白边，从 (0,0) 灌水：整圈边界都被连上，一次填充就能覆盖全部背景
    padded = Image.new('L', (w + 2, h + 2), 255)
    padded.paste(loose, (1, 1))
    ImageDraw.floodfill(padded, (0, 0), 128)
    flooded = padded.crop((1, 1, w + 1, h + 1)).load()

    # —— 2) 连通区域内按「白度」给 alpha ——
    alpha = Image.new('L', (w, h), 255)
    ap = alpha.load()
    for y in range(h):
        for x in range(w):
            if flooded[x, y] != 128:                    # 不在连通背景里 → 原样保留
                continue
            r, g, b, _a = src[x, y]
            val, sat = hsv_of(r, g, b)
            if val >= SEED_V and sat <= SEED_S:
                ap[x, y] = 0                            # 铁定是背景
            else:
                # 过渡带（抗锯齿边缘）：越白越透明，留一点点 alpha 让边缘不至于硬切
                t = (val - LOOSE_V) / max(1e-6, SEED_V - LOOSE_V)
                t = min(1.0, max(0.0, t))
                t = t * t * (3 - 2 * t)                 # smoothstep
                ap[x, y] = int(round(255 * (1 - 0.9 * t)))

    # —— 3) 收缩 + 羽化 ——
    # 【关键】收缩（MinFilter）只允许作用在「亮」像素上：白边一定是亮的，但主体上的
    # 细深色描边（冰淇淋顶部那圈，1~2px 宽、两侧都是透明背景）也是亮的反面 ——
    # 无条件收缩会把它整条吃掉，留下透明洞。所以先把「明显深色」的像素保护起来：
    # 收缩结果与「原 alpha 的深色部分」取较亮者。
    if erode > 0:
        shrunk = alpha.filter(ImageFilter.MinFilter(erode * 2 + 1))
        dark = Image.new('L', (w, h), 0)
        dp = dark.load()
        for y in range(h):
            for x in range(w):
                r, g, b, _a = src[x, y]
                if max(r, g, b) < 140:                  # 明显深色 → 多半是描边/阴影，不许被吃掉
                    dp[x, y] = 255
        alpha = ImageChops.lighter(shrunk, ImageChops.multiply(alpha, dark))
    if feather > 0:
        alpha = alpha.filter(ImageFilter.GaussianBlur(feather))
    img.putalpha(ImageChops.multiply(img.getchannel('A'), alpha))
    return img


def rounded_alpha(img, radius=CORNER_RADIUS):
    """叠一层圆角蒙版：四角透明，避免出现「方块感」。4 倍超采样保证圆角平滑。"""
    w, h = img.size
    big = Image.new('L', (w * SS, h * SS), 0)
    ImageDraw.Draw(big).rounded_rectangle(
        [0, 0, w * SS - 1, h * SS - 1], radius=radius * SS, fill=255
    )
    mask = big.resize((w, h), Image.LANCZOS)
    img.putalpha(ImageChops.multiply(img.getchannel('A'), mask))
    return img


def alpha_bbox(img, thresh=8):
    """不透明像素（alpha > thresh）的包围盒，空图返回 None。"""
    return img.getchannel('A').point(lambda a: 255 if a > thresh else 0).getbbox()


def process(src_path, cut_white):
    """
    源图 → 96×120 RGBA 精灵。

    白底图（两款黄色形象）走 **contain**（整体塞进）：
      先在原图等比缩到工作分辨率、抠掉白底，再按不透明主体的包围盒裁掉多余透明边，
      最后**整体等比塞进** 96×120（四周留 PAD 透明边）并居中。
      这样主体 —— 包括手里拿的冰淇淋 —— **绝不会被裁掉**。
      （踩过的坑：早先用「居中裁剪到 0.8 比例再铺满」会把 1.382 宽的原图左右各切掉
       约 20%，甜筒被切、头顶被切，所以白底图必须用 contain。）

    非白底图走 **cover**（铺满）：居中裁剪成 0.8 比例再铺满画布（保留备用分支）。
    """
    with Image.open(src_path) as raw:
        img = raw.convert('RGBA')

    if not cut_white:
        img = center_crop(img, ASPECT)
        img = img.resize((SPRITE_W, SPRITE_H), Image.LANCZOS)
        return rounded_alpha(img)

    # —— contain 分支 ——
    w, h = img.size
    k = min(1.0, WORK_MAX / max(w, h))
    work = img.resize((max(1, int(round(w * k))), max(1, int(round(h * k)))), Image.LANCZOS)
    work = remove_white_bg(work)

    box = alpha_bbox(work)
    if box:
        work = work.crop(box)

    avail_w = SPRITE_W - 2 * PAD
    avail_h = SPRITE_H - 2 * PAD
    s = min(avail_w / work.width, avail_h / work.height)
    nw = max(1, int(round(work.width * s)))
    nh = max(1, int(round(work.height * s)))
    work = work.resize((nw, nh), Image.LANCZOS)

    canvas = Image.new('RGBA', (SPRITE_W, SPRITE_H), (0, 0, 0, 0))
    canvas.paste(work, ((SPRITE_W - nw) // 2, (SPRITE_H - nh) // 2), work)
    return rounded_alpha(canvas)


def png_bytes(img):
    """编码成 PNG 字节（不写任何文本块/元数据；Pillow 默认就不写）。"""
    buf = io.BytesIO()
    img.save(buf, 'PNG', optimize=True)
    return buf.getvalue()


def encode_within_budget(img, budget=TARGET_PNG):
    """
    编码 PNG；超过体积预算就逐级减色（FASTOCTREE 保留 alpha）再试。
    96×120 的小精灵减色到 128 色肉眼几乎无差别，但体积能掉一大截。
    返回 (字节, 实际用到的颜色数)；颜色数 None 表示没减色。
    """
    data = png_bytes(img)
    if len(data) <= budget:
        return data, None
    for colors in QUANTIZE_STEPS:
        q = img.quantize(colors=colors, method=Image.FASTOCTREE).convert('RGBA')
        data = png_bytes(q)
        if len(data) <= budget:
            return data, colors
    return data, QUANTIZE_STEPS[-1]


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    entries = []
    for src_name, key, cut_white in JOBS:
        src_path = SRC / src_name
        if not src_path.is_file():
            raise SystemExit('找不到源图：%s' % src_path)
        img = process(src_path, cut_white)
        with Image.open(src_path) as raw:
            src_size = raw.size
        data, used_colors = encode_within_budget(img)
        out_path = OUT / (key + '.png')
        out_path.write_bytes(data)
        # 读回校验：尺寸 / 通道 / PNG 签名
        with Image.open(io.BytesIO(data)) as back:
            assert back.size == (SPRITE_W, SPRITE_H), back.size
            assert back.mode == 'RGBA', back.mode
        assert data[:8] == b'\x89PNG\r\n\x1a\n'
        entries.append((key, data))
        print('生成 %-42s 源 %dx%d → %dx%d  %6d 字节%s' % (
            str(out_path.relative_to(VERIFY.parent)), src_size[0], src_size[1],
            SPRITE_W, SPRITE_H, len(data),
            '' if used_colors is None else ('（减色到 %d 色）' % used_colors)))

    # —— 写 src/data/skin-images.js ——
    lines = [
        '// skin-images.js —— 两款图片皮肤的精灵图（base64 内嵌，零外部素材）',
        '//',
        '// 图片来源：由用户提供；经 tools/make-skin-images.py 处理（等比缩到工作分辨率 →',
        '// 抠白底 → 按主体包围盒裁掉透明边 → 整体塞进 96×120 → 圆角蒙版）后 base64 内嵌。',
        '// 采用「整体塞进」而不是「居中裁剪铺满」，保证角色和手里拿的东西不被裁掉。',
        '// 不新增任何运行时图片文件、不引用外链，因此断网可玩、Service Worker 的',
        '// 预缓存清单只需要多这一条 js，不用管图片。',
        '//',
        '// 【重要】图片只作外观显示，绝不影响判定与任何数值：玩家命中盒永远是',
        '// entities/player.js 的 hitbox()（x+7, y+5, w-14, h-8），与皮肤无关。',
        '// 【重要】本文件不含任何真实人物姓名。',
        '//',
        '// 重新生成：python tools/make-skin-images.py',
        '',
        'export const SKIN_IMAGES = {',
    ]
    for key, data in entries:
        uri = 'data:image/png;base64,' + base64.b64encode(data).decode('ascii')
        lines.append("  %s: '%s'," % (key, uri))
    lines.append('};')
    lines.append('')
    text = '\n'.join(lines)
    JS_OUT.write_text(text, encoding='utf-8')

    print('')
    print('写入 %s' % JS_OUT.relative_to(ROOT))
    for key, data in entries:
        print('  %-8s PNG %6d 字节  data URI %6d 字符  base64 后约 %.1f KB'
              % (key, len(data), len(base64.b64encode(data)) + 22, (len(base64.b64encode(data)) + 22) / 1024))
    print('  skin-images.js 合计 %d 字节（%.1f KB）'
          % (JS_OUT.stat().st_size, JS_OUT.stat().st_size / 1024))


if __name__ == '__main__':
    main()