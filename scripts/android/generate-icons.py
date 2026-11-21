"""Generate the Android launcher icons from the Mind brand mark.

Source: assets/mind-icon.png (opaque white background, blue M mark).
Outputs into src-tauri/gen/android/app/src/main/res/:
  mipmap-*/ic_launcher.png             legacy square icons
  mipmap-*/ic_launcher_round.png       legacy round icons
  mipmap-*/ic_launcher_foreground.png  adaptive foreground (mark only)
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "assets" / "mind-icon.png"
RES = ROOT / "src-tauri" / "gen" / "android" / "app" / "src" / "main" / "res"

DENSITIES = {
    "mdpi": 1.0,
    "hdpi": 1.5,
    "xhdpi": 2.0,
    "xxhdpi": 3.0,
    "xxxhdpi": 4.0,
}
LEGACY_DP = 48
ADAPTIVE_DP = 108


def crop_mark(source: Image.Image) -> Image.Image:
    """Crop the blue M mark out of the white source and restore its alpha.

    The source is a blue mark on a white card with a faint rounded border plus
    an outer shadow; only the central area is considered so neither leaks into
    the launcher icon. Pixels become opaque in proportion to how much bluer the
    blue channel is than red/green, which keeps the anti-aliased mark edges.
    """
    rgba = source.convert("RGBA")
    width, height = rgba.size
    pixels = rgba.load()

    def alpha_for(r: int, g: int, b: int) -> int:
        excess = b - max(r, g)
        if excess <= 2:
            return 0
        if excess >= 26:
            return 255
        return round((excess - 2) / 24.0 * 255.0)

    margin_x = round(width * 0.08)
    margin_y = round(height * 0.08)
    min_x, min_y, max_x, max_y = width, height, -1, -1
    marked: dict[tuple[int, int], int] = {}
    for y in range(margin_y, height - margin_y):
        for x in range(margin_x, width - margin_x):
            r, g, b, a = pixels[x, y]
            if a == 0:
                continue
            alpha = alpha_for(r, g, b)
            if alpha < 8:
                continue
            marked[(x, y)] = alpha
            min_x = min(min_x, x)
            min_y = min(min_y, y)
            max_x = max(max_x, x)
            max_y = max(max_y, y)
    if max_x < 0:
        raise SystemExit("no logo content found in assets/mind-icon.png")

    pad = 8
    min_x = max(margin_x, min_x - pad)
    min_y = max(margin_y, min_y - pad)
    max_x = min(width - margin_x - 1, max_x + pad)
    max_y = min(height - margin_y - 1, max_y + pad)

    out = Image.new("RGBA", (max_x - min_x + 1, max_y - min_y + 1), (0, 0, 0, 0))
    out_pixels = out.load()
    for (x, y), alpha in marked.items():
        if min_x <= x <= max_x and min_y <= y <= max_y:
            r, g, b, _ = pixels[x, y]
            out_pixels[x - min_x, y - min_y] = (r, g, b, alpha)
    return out


def fit_mark(mark: Image.Image, box: int) -> Image.Image:
    """Scale the mark so it fits inside a box x box square, preserving ratio."""
    w, h = mark.size
    scale = box / float(max(w, h))
    return mark.resize(
        (max(1, round(w * scale)), max(1, round(h * scale))),
        Image.LANCZOS,
    )


def rounded_tile(mark: Image.Image, size: int, corner_ratio: float = 0.22) -> Image.Image:
    tile = Image.new("RGBA", (size, size), (255, 255, 255, 255))
    draw = ImageDraw.Draw(tile)
    radius = round(size * corner_ratio)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    tile.putalpha(mask)

    logo = fit_mark(mark, round(size * 0.74))
    tile.alpha_composite(logo, ((size - logo.width) // 2, (size - logo.height) // 2))
    return tile


def round_tile(mark: Image.Image, size: int) -> Image.Image:
    tile = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, size - 1, size - 1], fill=255)
    white = Image.new("RGBA", (size, size), (255, 255, 255, 255))
    tile.paste(white, (0, 0), mask)

    logo = fit_mark(mark, round(size * 0.62))
    tile.alpha_composite(logo, ((size - logo.width) // 2, (size - logo.height) // 2))
    return tile


def foreground(mark: Image.Image, size: int) -> Image.Image:
    """Adaptive icon foreground: transparent, mark inside the 66dp safe zone."""
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    logo = fit_mark(mark, round(size * 0.56))
    canvas.alpha_composite(logo, ((size - logo.width) // 2, (size - logo.height) // 2))
    return canvas


def main() -> None:
    source = Image.open(SOURCE)
    mark = crop_mark(source)

    for name, density in DENSITIES.items():
        folder = RES / f"mipmap-{name}"
        folder.mkdir(parents=True, exist_ok=True)
        legacy = round(LEGACY_DP * density)
        rounded_tile(mark, legacy).save(folder / "ic_launcher.png", optimize=True)
        round_tile(mark, legacy).save(folder / "ic_launcher_round.png", optimize=True)
        adaptive = round(ADAPTIVE_DP * density)
        foreground(mark, adaptive).save(folder / "ic_launcher_foreground.png", optimize=True)
        print(f"{folder.name}: {legacy}px legacy, {adaptive}px foreground")

    (RES / "values" / "ic_launcher_background.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        "<resources>\n"
        '  <color name="ic_launcher_background">#FFFFFF</color>\n'
        "</resources>\n",
        encoding="utf-8",
    )
    (RES / "mipmap-anydpi-v26" / "ic_launcher_round.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
        '  <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n'
        '  <background android:drawable="@color/ic_launcher_background"/>\n'
        "</adaptive-icon>\n",
        encoding="utf-8",
    )
    print("done")


if __name__ == "__main__":
    main()
