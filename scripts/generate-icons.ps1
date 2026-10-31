# Generates the extension icons (public/icons/icon-<size>.png): a white 字 on
# a vermilion rounded square, matching DESIGN.md (clap-vermilion, subtitle-white).
# Each size is drawn at 8x and downscaled so small sizes stay smooth.
#
# Usage: powershell -ExecutionPolicy Bypass -File scripts/generate-icons.ps1

param(
  [string]$OutDir = (Join-Path $PSScriptRoot "..\public\icons"),
  # Share of the icon covered by the glyph's ink box.
  [double]$GlyphRatio = 0.76
)

Add-Type -AssemblyName System.Drawing

New-Item -ItemType Directory -Force $OutDir | Out-Null

# Load the real Bold face: asking GDI+ for "Yu Gothic UI" + Bold falls back to
# a lighter weight.
$fonts = New-Object System.Drawing.Text.PrivateFontCollection
$fonts.AddFontFile("$env:WINDIR\Fonts\YuGothB.ttc")
$family = $fonts.Families | Where-Object { $_.Name -eq "Yu Gothic UI" } | Select-Object -First 1

$background = [System.Drawing.ColorTranslator]::FromHtml("#FF624D")
$foreground = [System.Drawing.ColorTranslator]::FromHtml("#F4F1EA")
$glyph = [string][char]0x5B57 # 字
$scale = 8

foreach ($size in 16, 32, 48, 128) {
  $big = $size * $scale
  $canvas = New-Object System.Drawing.Bitmap $big, $big
  $g = [System.Drawing.Graphics]::FromImage($canvas)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)

  # Rounded square filling the whole canvas.
  $r = [int]($big * 0.22)
  $d = 2 * $r
  $square = New-Object System.Drawing.Drawing2D.GraphicsPath
  $square.AddArc(0, 0, $d, $d, 180, 90)
  $square.AddArc($big - $d, 0, $d, $d, 270, 90)
  $square.AddArc($big - $d, $big - $d, $d, $d, 0, 90)
  $square.AddArc(0, $big - $d, $d, $d, 90, 90)
  $square.CloseFigure()
  $g.FillPath((New-Object System.Drawing.SolidBrush $background), $square)

  # Glyph as a path, scaled to the requested ink box, then centred. The 16 px
  # icon draws its glyph later, hinted to the pixel grid, because a downscaled
  # glyph turns its 1 px strokes into a pink blur.
  $hinted = $size -le 16
  if (-not $hinted) {
    $text = New-Object System.Drawing.Drawing2D.GraphicsPath
    $text.AddString($glyph, $family, [int][System.Drawing.FontStyle]::Bold, 100, (New-Object System.Drawing.PointF 0, 0), [System.Drawing.StringFormat]::GenericTypographic)
    $bounds = $text.GetBounds()
    $fit = ($big * $GlyphRatio) / [Math]::Max($bounds.Width, $bounds.Height)
    $m = New-Object System.Drawing.Drawing2D.Matrix
    $m.Translate(($big - $bounds.Width * $fit) / 2, ($big - $bounds.Height * $fit) / 2)
    $m.Scale($fit, $fit)
    $m.Translate(-$bounds.X, -$bounds.Y)
    $text.Transform($m)
    $g.FillPath((New-Object System.Drawing.SolidBrush $foreground), $text)
  }
  $g.Dispose()

  $icon = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($icon)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.DrawImage($canvas, 0, 0, $size, $size)
  if ($hinted) {
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Default
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $font = New-Object System.Drawing.Font $family, ($size * 13 / 16), ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
    $format = New-Object System.Drawing.StringFormat
    $format.Alignment = [System.Drawing.StringAlignment]::Center
    $format.LineAlignment = [System.Drawing.StringAlignment]::Center
    $g.DrawString($glyph, $font, (New-Object System.Drawing.SolidBrush $foreground), (New-Object System.Drawing.RectangleF 0, 0.5, $size, $size), $format)
  }
  $g.Dispose()

  $path = Join-Path $OutDir "icon-$size.png"
  $icon.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $icon.Dispose()
  $canvas.Dispose()
  Write-Output "wrote $path"
}
