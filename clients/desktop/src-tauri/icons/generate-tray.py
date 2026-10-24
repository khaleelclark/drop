"""Rasterize the canonical Drop launcher and tray with the existing stdlib PNG approach."""
import math
import json
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
svg = ET.parse(root / 'branding/drop-mark.svg').getroot()
path, polygon = svg
geometry = json.loads((root / 'branding/drop-drag/geometry.json').read_text())
assert svg.attrib['viewBox'] == '0 0 24 24'
assert path.attrib == {
    'd': 'M8 12.5H5V2.5H11L15 6.5M3 15.5V21.5H21V17.5', 'fill': 'none', 'stroke': 'currentColor',
    'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
}, 'Update this rasterizer when the canonical mark changes'
polylines = geometry['polylines']
cursor = geometry['filledPolygons'][0]
assert polylines == [[[8, 12.5], [5, 12.5], [5, 2.5], [11, 2.5], [15, 6.5]],
                     [[3, 15.5], [3, 21.5], [21, 21.5], [21, 17.5]]]
assert polygon.attrib == {'points': ' '.join(f'{x},{y}' for x, y in cursor), 'fill': 'currentColor'}
assert geometry['strokeWidth'] == 2
segments = [(a, b) for points in polylines for a, b in zip(points, points[1:])]
cursor_edges = list(zip(cursor, cursor[1:] + cursor[:1]))


def in_cursor(x, y):
    inside = False
    for (ax, ay), (bx, by) in cursor_edges:
        if distance(x, y, (ax, ay), (bx, by)) <= 1e-12:
            return True
        if (ay > y) != (by > y) and x < (bx-ax)*(y-ay)/(by-ay)+ax:
            inside = not inside
    return inside


def glyph(x, y):
    return any(distance(x, y, a, b) <= 1 for a, b in segments) or in_cursor(x, y)


assert glyph(5, 7) and glyph(12, 21.5) and glyph(13, 13) and glyph(12, 9.5)
assert not glyph(9, 10.5) and not glyph(8, 17.5)
size, samples = 32, 4
rgba = bytearray()
for py in range(size):
    for px in range(size):
        inside = 0
        for sy in range(samples):
            for sx in range(samples):
                x = (px + (sx + .5)/samples)*24/size
                y = (py + (sy + .5)/samples)*24/size
                inside += glyph(x, y)
        rgba.extend((0, 0, 0, round(255*inside/samples**2)))

# Transparent corners, filled cursor and antialiased stroke edges.
alpha = rgba[3::4]
assert alpha[0] == alpha[-1] == alpha[14*size+12] == 0
assert alpha[17*size+17] == 255
assert alpha[28*size+16] == 255
assert any(0 < value < 255 for value in alpha)
raw = b''.join(b'\0' + rgba[y*size*4:(y+1)*size*4] for y in range(size))
png = (b'\x89PNG\r\n\x1a\n'
       + chunk(b'IHDR', struct.pack('!IIBBBBB', size, size, 8, 6, 0, 0, 0))
       + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))
Path(__file__).with_name('tray-template.png').write_bytes(png)

# Match the web launcher's 4x4 white-on-navy coverage rasterization.
size = 512
raw = bytearray()
for py in range(size):
    raw.append(0)
    for px in range(size):
        x = (px + .5)*24/size
        y = (py + .5)*24/size
        alpha = 255 if math.hypot(max(6-x, 0, x-18), max(6-y, 0, y-18)) <= 6 else 0
        white = sum(glyph(((px+(sx+.5)/samples)*24/size-3)/.75,
                          ((py+(sy+.5)/samples)*24/size-3)/.75)
                    for sy in range(samples) for sx in range(samples)) / samples**2
        raw.extend((*[round(c+(255-c)*white) for c in (36,76,106)], alpha))
png = (b'\x89PNG\r\n\x1a\n'
       + chunk(b'IHDR', struct.pack('!IIBBBBB', size, size, 8, 6, 0, 0, 0))
       + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))
Path(__file__).with_name('icon.png').write_bytes(png)
print('Generated Drop desktop launcher and monochrome tray; no package build')
