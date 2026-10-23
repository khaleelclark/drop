"""Generate Android Ribbon Z PNGs with the existing web generator's stdlib approach."""
import math
import struct
import zlib
from pathlib import Path
from xml.etree import ElementTree

ANDROID = Path(__file__).resolve().parent
mark = ElementTree.parse(ANDROID.parents[1] / "branding/zing-mark.svg").getroot()
path = mark.find("{http://www.w3.org/2000/svg}path")
assert mark.get("viewBox") == "0 0 24 24"
assert path is not None and path.get("d") == "M6 6.5H18L6 17.5H18"
assert path.get("stroke-width") == "3"
assert path.get("stroke-linecap") == path.get("stroke-linejoin") == "round"
POINTS = [(6, 6.5), (18, 6.5), (6, 17.5), (18, 17.5)]
ACCENT = (36, 76, 106)  # Navy; matches the shared launcher accent #244C6A.


def chunk(kind, data):
    return struct.pack("!I", len(data)) + kind + data + struct.pack("!I", zlib.crc32(kind + data) & 0xffffffff)


def distance(x, y, a, b):
    ax, ay = a; bx, by = b
    t = max(0, min(1, ((x-ax)*(bx-ax) + (y-ay)*(by-ay)) / ((bx-ax)**2 + (by-ay)**2)))
    return math.hypot(x-ax-t*(bx-ax), y-ay-t*(by-ay))


def coverage(value):
    return max(0, min(1, value))


def png(size, foreground=False, round_icon=False):
    raw = bytearray()
    span = 36 if foreground else 24
    for py in range(size):
        raw.append(0)
        for px in range(size):
            x = (px + .5) * span / size - (6 if foreground else 0)
            y = (py + .5) * span / size - (6 if foreground else 0)
            white = coverage((1.5 - min(distance(x, y, a, b) for a, b in zip(POINTS, POINTS[1:]))) * size / span + .5)
            if foreground:
                raw.extend((255, 255, 255, round(255 * white)))
            else:
                edge = (math.hypot(x-12, y-12) - 12) if round_icon else (math.hypot(max(abs(x-12)-6, 0), max(abs(y-12)-6, 0)) - 6)
                alpha = round(255 * coverage(.5 - edge * size / 24))
                raw.extend((*[round(c + (255-c) * white) for c in ACCENT], alpha))
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack("!IIBBBBB", size, size, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


if __name__ == "__main__":
    assert distance(12, 6.5, POINTS[0], POINTS[1]) == 0
    assert distance(6, 5, POINTS[0], POINTS[1]) == 1.5
    resources = ANDROID / "src-tauri/gen/android/app/src/main/res"
    for density, size, foreground_size in (("mdpi", 48, 108), ("hdpi", 72, 162), ("xhdpi", 96, 216), ("xxhdpi", 144, 324), ("xxxhdpi", 192, 432)):
        directory = resources / f"mipmap-{density}"
        (directory / "ic_launcher.png").write_bytes(png(size))
        (directory / "ic_launcher_round.png").write_bytes(png(size, round_icon=True))
        (directory / "ic_launcher_foreground.png").write_bytes(png(foreground_size, foreground=True))
    (ANDROID / "src-tauri/icons/icon.png").write_bytes(png(192))
    print("Generated 16 Android Ribbon Z PNGs; navy; no APK build")
