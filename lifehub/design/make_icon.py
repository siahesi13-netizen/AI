"""產生 App 圖示（純 Python，無外部套件）。用法：python3 lifehub/design/make_icon.py"""
import zlib, struct, os
BG, CLAY, SAGE, COCOA, WHITE = (0xF3,0xEC,0xE0), (0xE3,0xCF,0xB8), (0xC9,0xD0,0xBA), (0x8A,0x6B,0x4A), (0xFF,0xFD,0xF9)
def color(x, y):  # 座標以 512 為基準；由下往上疊
    c = BG
    if (x-338)**2 + (y-178)**2 <= 92**2: c = CLAY                                   # 圓
    if (118 <= x <= 298 and y >= 262) or (x-208)**2 + (y-262)**2 <= 90**2: c = SAGE  # 拱形
    if (x-356)**2 + (y-512)**2 <= 158**2:                                            # 半圓（85% 不透明）
        c = tuple(round(COCOA[i]*.85 + c[i]*.15) for i in range(3))
    if (x-208)**2 + (y-262)**2 <= 22**2: c = WHITE                                   # 小圓點
    return c
def render(size, ss=3):
    rows = []
    for py in range(size):
        row = bytearray([0])
        for px in range(size):
            r = g = b = 0
            for sy in range(ss):
                for sx in range(ss):
                    c = color((px + (sx+.5)/ss) * 512/size, (py + (sy+.5)/ss) * 512/size)
                    r += c[0]; g += c[1]; b += c[2]
            n = ss*ss; row += bytes((r//n, g//n, b//n))
        rows.append(bytes(row))
    raw = b''.join(rows)
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
out = os.path.join(os.path.dirname(__file__), '..', '..', 'docs')
for name, size in (('icon-512.png', 512), ('icon-192.png', 192), ('apple-touch-icon.png', 180)):
    open(os.path.join(out, name), 'wb').write(render(size)); print(name)
