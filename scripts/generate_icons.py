#!/usr/bin/env python3
"""Génère les icônes PNG de l'extension sans dépendance externe (pas de PIL).

Dessine un mur de briques stylisé en trois couleurs (vert / ambre / rouge),
symbolisant les trois axes de qualification de RealityWall, sur fond marine.
Écrit un PNG RGBA minimal (IHDR + IDAT non filtré + IEND) via zlib, module
de la bibliothèque standard.
"""

from __future__ import annotations

import pathlib
import struct
import zlib

BACKGROUND = (15, 23, 42, 255)  # #0f172a
MORTAR = (15, 23, 42, 255)
BORDER = (30, 41, 59, 255)  # #1e293b
GREEN = (34, 197, 94, 255)  # #22c55e
AMBER = (245, 158, 11, 255)  # #f59e0b
RED = (239, 68, 68, 255)  # #ef4444

OUTPUT_DIR = pathlib.Path(__file__).resolve().parent.parent / "extension" / "icons"
SIZES = (16, 48, 128)


def _png_chunk(tag: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + tag
        + data
        + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


def _write_png(path: pathlib.Path, pixels: list[list[tuple[int, int, int, int]]]) -> None:
    height = len(pixels)
    width = len(pixels[0])

    raw = bytearray()
    for row in pixels:
        raw.append(0)  # filtre "None" pour chaque scanline
        for r, g, b, a in row:
            raw.extend((r, g, b, a))

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    idat = zlib.compress(bytes(raw), level=9)

    png = b"\x89PNG\r\n\x1a\n"
    png += _png_chunk(b"IHDR", ihdr)
    png += _png_chunk(b"IDAT", idat)
    png += _png_chunk(b"IEND", b"")

    path.write_bytes(png)


def _brick_wall_row_color(y: int, height: int) -> tuple[int, int, int, int]:
    band = y * 3 // height
    if band <= 0:
        return GREEN
    if band == 1:
        return AMBER
    return RED


def build_icon(size: int) -> list[list[tuple[int, int, int, int]]]:
    border = max(1, size // 16)
    wall_top = int(size * 0.30)
    wall_bottom = size - border
    wall_left = border
    wall_right = size - border

    brick_rows = 3
    row_height = max(1, (wall_bottom - wall_top) // brick_rows)
    mortar_thickness = max(1, size // 32)
    brick_width = max(2, size // 4)

    pixels: list[list[tuple[int, int, int, int]]] = []
    for y in range(size):
        row: list[tuple[int, int, int, int]] = []
        for x in range(size):
            if (
                x < border
                or x >= size - border
                or y < border
                or y >= size - border
            ):
                row.append(BORDER)
                continue

            if y < wall_top or x < wall_left or x >= wall_right or y >= wall_bottom:
                row.append(BACKGROUND)
                continue

            row_index = min(brick_rows - 1, (y - wall_top) // row_height)
            within_row_y = (y - wall_top) - row_index * row_height
            offset = (row_index % 2) * (brick_width // 2)
            within_row_x = (x - wall_left + offset) % brick_width

            if within_row_y < mortar_thickness or within_row_x < mortar_thickness:
                row.append(MORTAR)
            else:
                color = _brick_wall_row_color(wall_top + row_index * row_height, wall_bottom)
                row.append(color)

        pixels.append(row)

    return pixels


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    for size in SIZES:
        pixels = build_icon(size)
        output_path = OUTPUT_DIR / f"icon{size}.png"
        _write_png(output_path, pixels)
        print(f"Écrit {output_path} ({size}x{size})")


if __name__ == "__main__":
    main()
