param(
  [Parameter(Mandatory = $true)][string]$Source,
  [Parameter(Mandatory = $true)][string]$LogoOut,
  [Parameter(Mandatory = $true)][string]$IconOut
)

Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;

public static class MindBrand {
    public static string Prepare(string srcPath, string logoPath, string iconPath) {
        using (var src = new Bitmap(srcPath)) {
            int W = src.Width, H = src.Height;
            int minX = W, minY = H, maxX = -1, maxY = -1;
            for (int y = 0; y < H; y++) {
                for (int x = 0; x < W; x++) {
                    var c = src.GetPixel(x, y);
                    int mn = Math.Min(c.R, Math.Min(c.G, c.B));
                    if (mn < 244) {
                        if (x < minX) minX = x;
                        if (y < minY) minY = y;
                        if (x > maxX) maxX = x;
                        if (y > maxY) maxY = y;
                    }
                }
            }
            if (maxX < 0) throw new Exception("no logo content found");

            int pad = 8;
            minX = Math.Max(0, minX - pad);
            minY = Math.Max(0, minY - pad);
            maxX = Math.Min(W - 1, maxX + pad);
            maxY = Math.Min(H - 1, maxY + pad);
            int cw = maxX - minX + 1, ch = maxY - minY + 1;

            var rgba = new Color[cw * ch];
            for (int y = 0; y < ch; y++) {
                for (int x = 0; x < cw; x++) {
                    var c = src.GetPixel(minX + x, minY + y);
                    int mn = Math.Min(c.R, Math.Min(c.G, c.B));
                    int a;
                    if (mn >= 250) a = 0;
                    else if (mn <= 237) a = 255;
                    else a = (int)Math.Round((250 - mn) / 13.0 * 255.0);
                    rgba[y * cw + x] = Color.FromArgb(a, c.R, c.G, c.B);
                }
            }

            // Decontaminate semi-transparent edge pixels with nearby opaque colour
            // so the mark has no white halo on dark backgrounds.
            var opaque = new bool[cw * ch];
            for (int i = 0; i < rgba.Length; i++) opaque[i] = rgba[i].A >= 250;
            for (int y = 0; y < ch; y++) {
                for (int x = 0; x < cw; x++) {
                    var c = rgba[y * cw + x];
                    if (c.A == 0 || c.A >= 250) continue;
                    Color replacement = c;
                    bool found = false;
                    for (int r = 1; r <= 8 && !found; r++) {
                        for (int dy = -r; dy <= r && !found; dy++) {
                            for (int dx = -r; dx <= r && !found; dx++) {
                                if (Math.Abs(dx) != r && Math.Abs(dy) != r) continue;
                                int nx = x + dx, ny = y + dy;
                                if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
                                if (opaque[ny * cw + nx]) {
                                    replacement = rgba[ny * cw + nx];
                                    found = true;
                                }
                            }
                        }
                    }
                    rgba[y * cw + x] = Color.FromArgb(c.A, replacement.R, replacement.G, replacement.B);
                }
            }

            using (var logo = new Bitmap(cw, ch, PixelFormat.Format32bppArgb)) {
                for (int y = 0; y < ch; y++)
                    for (int x = 0; x < cw; x++)
                        logo.SetPixel(x, y, rgba[y * cw + x]);
                logo.Save(logoPath, ImageFormat.Png);

                int S = 1024, radius = 230;
                using (var icon = new Bitmap(S, S, PixelFormat.Format32bppArgb)) {
                    using (var g = Graphics.FromImage(icon)) {
                        g.SmoothingMode = SmoothingMode.AntiAlias;
                        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                        g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                        g.Clear(Color.Transparent);
                        using (var path = new GraphicsPath()) {
                            int d = radius * 2;
                            path.AddArc(0, 0, d, d, 180, 90);
                            path.AddArc(S - d, 0, d, d, 270, 90);
                            path.AddArc(S - d, S - d, d, d, 0, 90);
                            path.AddArc(0, S - d, d, d, 90, 90);
                            path.CloseFigure();
                            using (var brush = new SolidBrush(Color.White)) g.FillPath(brush, path);
                            using (var pen = new Pen(Color.FromArgb(12, 16, 34, 70), 2f))
                                g.DrawPath(pen, path);
                        }
                        double targetW = S * 0.80;
                        double scale = targetW / cw;
                        int dw = (int)Math.Round(cw * scale);
                        int dh = (int)Math.Round(ch * scale);
                        g.DrawImage(logo, new Rectangle((S - dw) / 2, (S - dh) / 2, dw, dh));
                    }
                    icon.Save(iconPath, ImageFormat.Png);
                }
            }
            return "cropped " + cw + "x" + ch;
        }
    }
}
"@

$result = [MindBrand]::Prepare($Source, $LogoOut, $IconOut)
Write-Output $result
