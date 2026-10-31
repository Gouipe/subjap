# Generates the extension icons (public/icons/icon-<size>.png): a white 字 on
# a vermilion rounded square, matching DESIGN.md (clap-vermilion, subtitle-white).
# Each size is drawn at 8x and downscaled so small sizes stay smooth.
#
# Usage: powershell -ExecutionPolicy Bypass -File scripts/generate-icons.ps1

Add-Type -AssemblyName System.Drawing

$outDir = Join-Path $PSScriptRoot "..\public\icons"
New-Item -ItemType Directory -Force $outDir | Out-Null

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

  # Glyph as a path, scaled so its ink box fills 72% of the icon, then centred.
  $text = New-Object System.Drawing.Drawing2D.GraphicsPath
  $family = New-Object System.Drawing.FontFamily "Yu Gothic UI"
  $text.AddString($glyph, $family, [int][System.Drawing.FontStyle]::Bold, 100, (New-Object System.Drawing.PointF 0, 0), [System.Drawing.StringFormat]::GenericTypographic)
  $bounds = $text.GetBounds()
  $fit = ($big * 0.72) / [Math]::Max($bounds.Width, $bounds.Height)
  $m = New-Object System.Drawing.Drawing2D.Matrix
  $m.Translate(($big - $bounds.Width * $fit) / 2, ($big - $bounds.Height * $fit) / 2)
  $m.Scale($fit, $fit)
  $m.Translate(-$bounds.X, -$bounds.Y)
  $text.Transform($m)
  $g.FillPath((New-Object System.Drawing.SolidBrush $foreground), $text)
  $g.Dispose()

  $icon = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($icon)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.DrawImage($canvas, 0, 0, $size, $size)
  $g.Dispose()

  $path = Join-Path $outDir "icon-$size.png"
  $icon.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $icon.Dispose()
  $canvas.Dispose()
  Write-Output "wrote $path"
}
