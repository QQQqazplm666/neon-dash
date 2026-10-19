#!/usr/bin/env python3
# ============================================================
# tools/make-icons.py —— 生成 PWA / 安卓 / iOS 用的 PNG 图标
#
# 为什么需要这个脚本：
#   原来 manifest 里的图标是内联的 data: URI（为了"零外部文件"）。
#   浏览器能认，但打包工具（PWABuilder 等）必须按 URL 去下载图标文件，
#   拿到 data: URI 就没法生成安卓启动图标。所以这里把同一套霓虹设计
#   真正画成 PNG 文件。
#
# 这个脚本只在**开发时**用一次（改了图标设计才需要重跑），不是游戏运行依赖。
# 用法：python tools/make-icons.py
#
# 生成：
#   icons/icon-192.png             192×192   purpose: any
#   icons/icon-512.png             512×512   purpose: any
#   icons/icon-maskable-512.png    512×512   purpose: maskable（图案缩小到安全区）
#   icons/apple-touch-icon-180.png 180×180   iOS「添加到主屏幕」用
# ============================================================

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'icons'

BG_IN = (16, 12, 40)      # 背景中心色
BG_OUT = (5, 3, 15)       # 背景边缘色
CYAN = (0, 240, 255)
CYAN_LIGHT = (190, 252, 255)
PINK = (255, 45, 149)

# 设计稿坐标（512×512 画布，和 index.html 里的内联 SVG 同一套形状）
ZIGZAG = [(110, 350), (240, 130), (310, 260), (400, 170)]
BALL = (336, 372, 38)     # cx, cy, r


def _background(size):
    """深色底 + 从中心向外的径向渐变（安卓 maskable 要满幅、不能有透明）. """
    img = Image.new('RGB', (size, size), BG_OUT)
    draw = ImageDraw.Draw(img)
    center = size / 2
    max_r = size * 0.75
    steps = 72
    for i in range(steps, 0, -1):
        t = i / steps
        r = max_r * t
        color = tuple(
            int(BG_OUT[k] + (BG_IN[k] - BG_OUT[k]) * (1 - t)) for k in range(3)
        )
        draw.ellipse([center - r, center - r, center + r, center + r], fill=color)
    return img


def _mark_layer(size, scale):
    """把霓虹图案画到一张透明图层上（含外发光），图案按 scale 缩放并居中。"""
    layer = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)

    k = size / 512.0            # 512 设计空间 → 实际像素
    offset = size / 2.0 - 256 * k * scale

    def px(point):
        x, y = point
        return (x * k * scale + offset, y * k * scale + offset)

    pts = [px(p) for p in ZIGZAG]
    stroke = 30 * k * scale
    cx, cy, r = BALL
    bc = px((cx, cy))
    br = r * k * scale

    # 1) 外发光（画粗线 → 高斯模糊）
    draw.line(pts, fill=CYAN + (70,), width=int(stroke * 2.6), joint='curve')
    draw.ellipse(
        [bc[0] - br * 1.9, bc[1] - br * 1.9, bc[0] + br * 1.9, bc[1] + br * 1.9],
        fill=PINK + (80,),
    )
    layer = layer.filter(ImageFilter.GaussianBlur(stroke * 0.85))
    draw = ImageDraw.Draw(layer)

    # 2) 实心霓虹线 + 高光细线
    draw.line(pts, fill=CYAN + (255,), width=int(stroke), joint='curve')
    draw.line(pts, fill=CYAN_LIGHT + (95,), width=max(2, int(stroke * 0.26)), joint='curve')

    # 3) 实心粉球 + 高光点
    draw.ellipse([bc[0] - br, bc[1] - br, bc[0] + br, bc[1] + br], fill=PINK + (255,))
    hl = br * 0.34
    draw.ellipse(
        [bc[0] - hl * 1.5 - hl, bc[1] - hl * 1.5 - hl, bc[0] - hl * 1.5 + hl, bc[1] - hl * 1.5 + hl],
        fill=(255, 255, 255, 150),
    )
    return layer


def make(size, scale, path):
    img = _background(size).convert('RGBA')
    img.alpha_composite(_mark_layer(size, scale))
    img.convert('RGB').save(path, 'PNG', optimize=True)
    return path


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    jobs = [
        (192, 0.86, 'icon-192.png'),
        (512, 0.86, 'icon-512.png'),
        # maskable：图案收进中间安全区，四周留白，被裁成圆形也不会切到图案
        (512, 0.62, 'icon-maskable-512.png'),
        # iOS 会自己加圆角，所以也用满幅底
        (180, 0.82, 'apple-touch-icon-180.png'),
    ]
    for size, scale, name in jobs:
        p = make(size, scale, OUT / name)
        with Image.open(p) as im:
            print(f'生成 {p.relative_to(ROOT)}  {im.size[0]}x{im.size[1]}  {im.mode}  {p.stat().st_size} 字节')


if __name__ == '__main__':
    main()