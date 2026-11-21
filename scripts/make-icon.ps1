# Draws the app icon (public/icon.png, 256x256): a glass-blue rounded square with a
# white portcullis gate. Windows PowerShell + System.Drawing only, no packages.
# Run: powershell -File scripts/make-icon.ps1   (the result is committed, so this is
# only needed to change the icon).

Add-Type -AssemblyName System.Drawing

$size = 256
$out = Join-Path (Split-Path $PSScriptRoot -Parent) 'public\icon.png'
New-Item -ItemType Directory -Force (Split-Path $out -Parent) | Out-Null

$bmp = New-Object System.Drawing.Bitmap $size, $size
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.Clear([System.Drawing.Color]::Transparent)

function RoundedRect([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

# Body: diagonal blue to violet, like the app's backdrop.
$body = RoundedRect 8 8 240 240 56
$rect = New-Object System.Drawing.RectangleF 8, 8, 240, 240
$grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, ([System.Drawing.Color]::FromArgb(255, 78, 161, 255)), ([System.Drawing.Color]::FromArgb(255, 150, 96, 255)), 45
$g.FillPath($grad, $body)

# Glass sheen on the upper half.
$sheenRect = New-Object System.Drawing.RectangleF 8, 8, 240, 130
$sheen = New-Object System.Drawing.Drawing2D.LinearGradientBrush $sheenRect, ([System.Drawing.Color]::FromArgb(110, 255, 255, 255)), ([System.Drawing.Color]::FromArgb(0, 255, 255, 255)), 90
$sheen.WrapMode = 'TileFlipXY'
$g.SetClip($body)
$g.FillRectangle($sheen, 8, 8, 240, 124) # a hair shorter than the gradient, so no seam shows at its end
$g.ResetClip()

# Bright rim.
$rim = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(150, 255, 255, 255)), 3
$g.DrawPath($rim, $body)

# The gate: an arch with three bars (a portcullis).
$arch = New-Object System.Drawing.Drawing2D.GraphicsPath
$arch.AddLine(80, 196, 80, 120)
$arch.AddArc(80, 76, 96, 88, 180, 180)
$arch.AddLine(176, 120, 176, 196)
$white = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(245, 255, 255, 255)), 14
$white.LineJoin = 'Round'
$white.StartCap = 'Round'
$white.EndCap = 'Round'
$g.DrawPath($white, $arch)
$bar = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(225, 255, 255, 255)), 8
$bar.StartCap = 'Round'
$bar.EndCap = 'Round'
foreach ($x in 104, 128, 152) { $g.DrawLine($bar, $x, 112, $x, 196) }

$g.Dispose()
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
"wrote $out"
