#!/usr/bin/env python3
"""Generate Anvil's app icons: a forge-lit anvil, iron on near-black.

Pure standard library (math + zlib + struct) so it runs anywhere with no
pip installs. Renders at 4x supersample and box-downscales for clean edges.
Adapted from lumen/tools/gen_icons.py.

    python tools/gen_icons.py

Writes icons/icon-192.png, icon-512.png, icon-maskable-512.png, icon-180.png.

The maskable variant draws the mark smaller (MASKABLE_SCALE) so the horn
survives Android's circle crop -- the anvil is a wide mark, so unlike Lumen's
radially-centred sun it cannot share one file between "any" and "maskable".

All geometry uses fixed coordinates, so regenerating is deterministic.
"""
import math
import os
import struct
import zlib

# Palette. BG matches theme_color / background_color in manifest.json.
BG        = (0x0a, 0x0a, 0x0a)
IRON      = (0x9a, 0xa3, 0xad)   # lit top faces
IRON_DARK = (0x4e, 0x55, 0x5e)   # shadowed body
EMBER     = (0xe8, 0x6a, 0x1f)   # forge glow
SPARK     = (0xff, 0xc2, 0x6b)   # spark cores

SS = 4  # supersample factor

NORMAL_SCALE   = 0.80
MASKABLE_SCALE = 0.62

# Sparks: (x, y, radius) in mark space. Fixed, never random.
SPARKS = [
    (-0.62, -0.46, 0.055),
    (-0.44, -0.62, 0.038),
    (-0.72, -0.24, 0.032),
    (-0.28, -0.52, 0.028),
    (-0.54, -0.33, 0.022),
]


def smoothstep(edge0, edge1, x):
    if edge0 == edge1:
        return 0.0 if x < edge0 else 1.0
    t = (x - edge0) / (edge1 - edge0)
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def band(v, lo, hi, feather):
    """Soft 1-D slab: 1 inside [lo, hi], falling off over `feather`."""
    return smoothstep(lo - feather, lo + feather, v) * \
           smoothstep(hi + feather, hi - feather, v)


def shade(nx, ny):
    """RGB float tuple for a point in normalized mark space, [-1, 1], y down."""
    out = list(BG)
    f = 0.012  # feather width, in mark units

    # --- Forge glow under the face -------------------------------------
    gx, gy = nx, (ny - 0.10) * 1.5
    glow = math.exp(-((math.hypot(gx, gy) / 0.62) ** 2)) * 0.22
    out = list(lerp(out, EMBER, glow))

    # --- Base: trapezoid foot ------------------------------------------
    # Half-width tapers from 0.52 at the bottom to 0.34 at the top.
    base_t = smoothstep(0.60, 0.34, ny)          # 0 at bottom, 1 at top
    base_hw = 0.52 - 0.18 * base_t
    base = band(ny, 0.34, 0.60, f) * band(nx, -base_hw, base_hw, f)
    out = list(lerp(out, IRON_DARK, base))
    # Lit top edge of the base
    out = list(lerp(out, IRON, base * band(ny, 0.34, 0.39, f) * 0.55))

    # --- Waist ----------------------------------------------------------
    waist_hw = 0.20
    waist = band(ny, 0.06, 0.36, f) * band(nx, -waist_hw, waist_hw, f)
    out = list(lerp(out, IRON_DARK, waist))

    # --- Horn: cone tapering left off the slab --------------------------
    # Vertical half-thickness shrinks to a point at nx = -0.92.
    horn_t = smoothstep(-0.92, -0.30, nx)        # 0 at the tip, 1 at the body
    horn_half = 0.015 + 0.105 * horn_t
    horn_mid = -0.12 + 0.030 * (1.0 - horn_t)    # tip rides slightly low
    horn = band(nx, -0.92, -0.28, f) * \
        band(ny, horn_mid - horn_half, horn_mid + horn_half, f)
    out = list(lerp(out, IRON_DARK, horn))
    out = list(lerp(out, IRON, horn * band(ny, horn_mid - horn_half,
                                           horn_mid - horn_half + 0.045, f)))

    # --- Face slab ------------------------------------------------------
    # Slight taper: wider at the top face than underneath.
    slab_t = smoothstep(0.06, -0.24, ny)         # 1 at the top
    slab_hw = 0.50 + 0.12 * slab_t
    slab = band(ny, -0.24, 0.08, f) * band(nx, -slab_hw, slab_hw, f)
    # Bevel for free: vertical lerp from lit top to shadowed underside.
    bevel = smoothstep(-0.24, 0.08, ny)
    slab_col = lerp(IRON, IRON_DARK, bevel)
    out = list(lerp(out, slab_col, slab))
    # Bright working face along the very top
    out = list(lerp(out, IRON, slab * band(ny, -0.24, -0.17, f) * 0.85))

    # --- Sparks ---------------------------------------------------------
    for sx, sy, sr in SPARKS:
        d = math.hypot(nx - sx, ny - sy)
        s = math.exp(-((d / sr) ** 2))
        out = list(lerp(out, EMBER, min(1.0, s * 0.85)))
        out = list(lerp(out, SPARK, min(1.0, s * s * 0.95)))

    return out


def render(size, scale):
    """Return raw PNG scanlines (filter byte 0, 8-bit RGB) for one icon."""
    big = size * SS
    half = big / 2.0
    acc = [[0.0, 0.0, 0.0] for _ in range(size * size)]
    for by in range(big):
        ny = ((by + 0.5 - half) / half) / scale
        oy = by // SS
        for bx in range(big):
            nx = ((bx + 0.5 - half) / half) / scale
            r, g, b = shade(nx, ny)
            idx = oy * size + (bx // SS)
            acc[idx][0] += r
            acc[idx][1] += g
            acc[idx][2] += b
    n = SS * SS
    raw = bytearray()
    for y in range(size):
        raw.append(0)
        for x in range(size):
            p = acc[y * size + x]
            raw.append(max(0, min(255, int(p[0] / n + 0.5))))
            raw.append(max(0, min(255, int(p[1] / n + 0.5))))
            raw.append(max(0, min(255, int(p[2] / n + 0.5))))
    return bytes(raw)


def write_png(path, size, raw):
    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data +
                struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff))
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)  # 8-bit RGB
    idat = zlib.compress(raw, 9)
    with open(path, "wb") as f:
        f.write(sig)
        f.write(chunk(b"IHDR", ihdr))
        f.write(chunk(b"IDAT", idat))
        f.write(chunk(b"IEND", b""))


# name, size, mark scale
TARGETS = [
    ("icon-192.png",          192, NORMAL_SCALE),
    ("icon-512.png",          512, NORMAL_SCALE),
    ("icon-maskable-512.png", 512, MASKABLE_SCALE),
    ("icon-180.png",          180, NORMAL_SCALE),
]


def main():
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out = os.path.join(here, "icons")
    os.makedirs(out, exist_ok=True)
    for name, size, scale in TARGETS:
        write_png(os.path.join(out, name), size, render(size, scale))
        print(f"wrote icons/{name}")


if __name__ == "__main__":
    main()
