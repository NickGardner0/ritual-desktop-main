#!/usr/bin/env python3
"""Build app icons from the Eclipse SVG brand mark."""

from __future__ import annotations

from io import BytesIO
from pathlib import Path
import subprocess

from PIL import Image, ImageDraw, ImageFilter


def _render_svg(svg_path: Path, size: int) -> Image.Image:
    result = subprocess.run(
        [
            "rsvg-convert",
            "-w",
            str(size),
            "-h",
            str(size),
            str(svg_path),
        ],
        check=True,
        capture_output=True,
    )
    return Image.open(BytesIO(result.stdout)).convert("RGBA")


def _composite_center(base: Image.Image, overlay: Image.Image, dx: int = 0, dy: int = 0) -> None:
    x = (base.width - overlay.width) // 2 + dx
    y = (base.height - overlay.height) // 2 + dy
    base.alpha_composite(overlay, (x, y))


def _hex_to_rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))


def _vertical_gradient(width: int, height: int, top_hex: str, bottom_hex: str) -> Image.Image:
    top = _hex_to_rgb(top_hex)
    bottom = _hex_to_rgb(bottom_hex)
    grad = Image.new("RGBA", (width, height))
    draw = ImageDraw.Draw(grad)
    for y in range(height):
        t = y / max(1, height - 1)
        r = int(top[0] + (bottom[0] - top[0]) * t)
        g = int(top[1] + (bottom[1] - top[1]) * t)
        b = int(top[2] + (bottom[2] - top[2]) * t)
        draw.line([(0, y), (width, y)], fill=(r, g, b, 255))
    return grad


def _build_rounded_tile(size: int) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    inset = int(size * 0.09)
    tile_size = size - (inset * 2)
    radius = int(tile_size * 0.22)

    shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw_shadow = ImageDraw.Draw(shadow)
    draw_shadow.rounded_rectangle(
        (inset, inset + int(size * 0.014), inset + tile_size, inset + tile_size + int(size * 0.014)),
        radius=radius,
        fill=(0, 0, 0, 150),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(30))
    canvas.alpha_composite(shadow)

    tile = _vertical_gradient(tile_size, tile_size, "#111111", "#040404")
    mask = Image.new("L", (tile_size, tile_size), 0)
    draw_mask = ImageDraw.Draw(mask)
    draw_mask.rounded_rectangle((0, 0, tile_size - 1, tile_size - 1), radius=radius, fill=255)
    tile.putalpha(mask)

    edge = ImageDraw.Draw(tile)
    edge.rounded_rectangle(
        (2, 2, tile_size - 3, tile_size - 3),
        radius=max(0, radius - 2),
        outline=(255, 255, 255, 26),
        width=3,
    )
    edge.rounded_rectangle(
        (3, 3, tile_size - 4, tile_size - 4),
        radius=max(0, radius - 3),
        outline=(0, 0, 0, 110),
        width=1,
    )

    highlight = Image.new("RGBA", (tile_size, tile_size), (0, 0, 0, 0))
    draw_hl = ImageDraw.Draw(highlight)
    draw_hl.ellipse(
        (int(tile_size * 0.08), int(tile_size * 0.02), int(tile_size * 0.92), int(tile_size * 0.42)),
        fill=(255, 255, 255, 34),
    )
    highlight = highlight.filter(ImageFilter.GaussianBlur(24))
    tile.alpha_composite(highlight)

    canvas.alpha_composite(tile, (inset, inset))
    return canvas


def build_desktop_master(eclipse_svg_white: Path, size: int = 1024) -> Image.Image:
    canvas = _build_rounded_tile(size)
    logo_size = int(size * 0.52)
    logo = _render_svg(eclipse_svg_white, logo_size)

    logo_shadow = Image.new("RGBA", (logo_size, logo_size), (0, 0, 0, 0))
    shadow_alpha = logo.split()[-1]
    logo_shadow.paste((0, 0, 0, 80), (0, 0), shadow_alpha)
    logo_shadow = logo_shadow.filter(ImageFilter.GaussianBlur(8))

    _composite_center(canvas, logo_shadow, dy=int(size * 0.01))
    _composite_center(canvas, logo)
    return canvas


def build_tray_icon(eclipse_svg_black: Path, size: int) -> Image.Image:
    # Menu bar template icon: clean Eclipse mark, no badge/background.
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    logo_size = int(size * 0.97)
    # Oversample and downsample to keep the SVG geometry crisp at tiny sizes.
    logo = _render_svg(eclipse_svg_black, size * 4).resize(
        (logo_size, logo_size),
        Image.Resampling.LANCZOS,
    )
    _composite_center(canvas, logo)
    return canvas


def build_ios_master(eclipse_svg_white: Path, size: int = 1024) -> Image.Image:
    # iOS app icons should be opaque.
    canvas = _vertical_gradient(size, size, "#111111", "#040404").convert("RGB")
    logo_size = int(size * 0.54)
    logo = _render_svg(eclipse_svg_white, logo_size)
    x = (size - logo_size) // 2
    y = (size - logo_size) // 2
    canvas.paste(logo.convert("RGB"), (x, y), logo.split()[-1])
    return canvas


def save_sizes(master: Image.Image, output_dir: Path, sizes: list[tuple[str, int]]) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    for filename, size in sizes:
        resized = master.resize((size, size), Image.Resampling.LANCZOS)
        resized.save(output_dir / filename, "PNG")


def main() -> None:
    repo_root = Path(__file__).resolve().parents[3]
    ritual_icon_dir = repo_root / "apps/desktop/ritual-icon"
    tauri_icons_dir = repo_root / "apps/desktop/src-tauri/icons"
    ios_icon_dir = repo_root / "apps/ios-companion/Resources/Assets.xcassets/AppIcon.appiconset"
    eclipse_svg_black = repo_root / "apps/desktop/ritual-icon/assets/eclipse.svg"
    eclipse_svg_white = repo_root / "apps/desktop/ritual-icon/assets/eclipse_white.svg"

    desktop_master = build_desktop_master(eclipse_svg_white, size=1024)
    ios_master = build_ios_master(eclipse_svg_white, size=1024)

    # Desktop source assets
    desktop_master.save(ritual_icon_dir / "icon_1024.png", "PNG")
    desktop_master.resize((256, 256), Image.Resampling.LANCZOS).save(ritual_icon_dir / "icon_256.png", "PNG")
    ios_master.save(ritual_icon_dir / "StoreLogo.png", "PNG")
    desktop_master.save(ritual_icon_dir / "icon.png", "PNG")
    desktop_master.save(
        ritual_icon_dir / "icon.ico",
        format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )

    # Tauri bundle icons
    save_sizes(
        desktop_master,
        tauri_icons_dir,
        [("32x32.png", 32), ("128x128.png", 128), ("128x128@2x.png", 256)],
    )
    desktop_master.save(tauri_icons_dir / "icon.png", "PNG")
    desktop_master.save(
        tauri_icons_dir / "icon.ico",
        format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )

    # Menu bar tray icon (non-template, full color)
    tray_1x = build_tray_icon(eclipse_svg_black, 18)
    tray_2x = build_tray_icon(eclipse_svg_black, 36)
    tray_1x.save(tauri_icons_dir / "tray-iconTemplate.png", "PNG")
    tray_2x.save(tauri_icons_dir / "tray-iconTemplate@2x.png", "PNG")

    # iOS companion icon
    ios_icon_dir.mkdir(parents=True, exist_ok=True)
    ios_master.save(ios_icon_dir / "AppIcon.png", "PNG")

    print("Generated polished Eclipse-based icons:")
    print(f"- {ritual_icon_dir / 'icon_1024.png'}")
    print(f"- {tauri_icons_dir / '32x32.png'}")
    print(f"- {tauri_icons_dir / '128x128.png'}")
    print(f"- {tauri_icons_dir / '128x128@2x.png'}")
    print(f"- {tauri_icons_dir / 'icon.png'}")
    print(f"- {tauri_icons_dir / 'icon.ico'}")
    print(f"- {ios_icon_dir / 'AppIcon.png'}")
    print("Next: run generate_iconset.py + iconutil to rebuild Ritual.icns.")


if __name__ == "__main__":
    main()
