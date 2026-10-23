"""Generate install icons from the canonical branding/zing-mark.svg ribbon Z."""
import math
import struct
import zlib
from pathlib import Path

def chunk(kind, data):
    return struct.pack('!I', len(data)) + kind + data + struct.pack('!I', zlib.crc32(kind + data) & 0xffffffff)

def distance(x, y, a, b):
    ax, ay = a; bx, by = b
    t = max(0, min(1, ((x-ax)*(bx-ax) + (y-ay)*(by-ay)) / ((bx-ax)**2 + (by-ay)**2)))
    return math.hypot(x-ax-t*(bx-ax), y-ay-t*(by-ay))

points = [(48,52),(144,52),(48,140),(144,140)]
for size in (192, 512):
    raw = bytearray()
    for py in range(size):
        raw.append(0)
        for px in range(size):
            x = (px+.5)*192/size; y = (py+.5)*192/size
            alpha = 255 if math.hypot(max(48-x, 0, x-144), max(48-y, 0, y-144)) <= 48 else 0
            white = min(distance(x,y,a,b) for a,b in zip(points, points[1:])) < 12
            raw.extend((255,255,255,alpha) if white else (36,76,106,alpha))
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!IIBBBBB',size,size,8,6,0,0,0)) + chunk(b'IDAT', zlib.compress(raw,9)) + chunk(b'IEND',b'')
    (Path(__file__).resolve().parent.parent / 'public' / f'icon-{size}.png').write_bytes(png)
