"""Rasterize the canonical Ribbon Z alpha mask with the existing stdlib PNG approach."""
import math
import struct
import xml.etree.ElementTree as ET
import zlib
from pathlib import Path


def chunk(kind, data):
    return (struct.pack('!I', len(data)) + kind + data
            + struct.pack('!I', zlib.crc32(kind + data) & 0xffffffff))


def distance(x, y, a, b):
    ax, ay = a
    bx, by = b
    t = max(0, min(1, ((x-ax)*(bx-ax) + (y-ay)*(by-ay))
                  / ((bx-ax)**2 + (by-ay)**2)))
    return math.hypot(x-ax-t*(bx-ax), y-ay-t*(by-ay))


root = Path(__file__).resolve().parents[4]
svg = ET.parse(root / 'branding/zing-mark.svg').getroot()
path, = svg.findall('{http://www.w3.org/2000/svg}path')
assert svg.attrib['viewBox'] == '0 0 24 24'
assert path.attrib == {
    'd': 'M6 6.5H18L6 17.5H18', 'fill': 'none', 'stroke': 'currentColor',
    'stroke-width': '3', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
}, 'Update this rasterizer when the canonical mark changes'
points = [(6, 6.5), (18, 6.5), (6, 17.5), (18, 17.5)]
size, samples = 32, 4
rgba = bytearray()
for py in range(size):
    for px in range(size):
        inside = 0
        for sy in range(samples):
            for sx in range(samples):
                x = (px + (sx + .5)/samples)*24/size
                y = (py + (sy + .5)/samples)*24/size
                inside += min(distance(x, y, a, b)
                              for a, b in zip(points, points[1:])) <= 1.5
        rgba.extend((0, 0, 0, round(255*inside/samples**2)))

# Transparent corners/gaps, solid bars/diagonal and antialiased stroke edges.
alpha = rgba[3::4]
assert alpha[0] == alpha[-1] == alpha[16*size+8] == 0
assert alpha[8*size+16] == alpha[16*size+16] == 255
assert any(0 < value < 255 for value in alpha)
raw = b''.join(b'\0' + rgba[y*size*4:(y+1)*size*4] for y in range(size))
png = (b'\x89PNG\r\n\x1a\n'
       + chunk(b'IHDR', struct.pack('!IIBBBBB', size, size, 8, 6, 0, 0, 0))
       + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))
Path(__file__).with_name('tray-template.png').write_bytes(png)
