Add-Type -AssemblyName System.Drawing

function New-RoundedRectPath([int]$X, [int]$Y, [int]$W, [int]$H, [int]$R) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = [Math]::Max(1, $R * 2)
  $path.AddArc($X, $Y, $d, $d, 180, 90)
  $path.AddArc($X + $W - $d, $Y, $d, $d, 270, 90)
  $path.AddArc($X + $W - $d, $Y + $H - $d, $d, $d, 0, 90)
  $path.AddArc($X, $Y + $H - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  return $path
}

function Export-Icon([int]$Size, [string]$OutPath) {
  $bmp = New-Object System.Drawing.Bitmap $Size, $Size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)

  $pad = [Math]::Max(1, [int]($Size * 0.06))
  $radius = [Math]::Max(2, [int]($Size * 0.22))
  $bgBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 232, 84, 26))
  $goldBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 255, 255, 255))
  $inkPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 232, 84, 26), [Math]::Max(1.5, $Size / 16.0))
  $inkPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $inkPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round

  $bg = New-RoundedRectPath $pad $pad ($Size - 2 * $pad) ($Size - 2 * $pad) $radius
  $g.FillPath($bgBrush, $bg)

  $bx = [int]($Size * 0.20)
  $by = [int]($Size * 0.22)
  $bw = [int]($Size * 0.60)
  $bh = [int]($Size * 0.40)
  $br = [Math]::Max(2, [int]($Size * 0.09))
  $bubble = New-RoundedRectPath $bx $by $bw $bh $br
  $g.FillPath($goldBrush, $bubble)

  $p1 = New-Object System.Drawing.Point (($bx + [int]($bw * 0.22)), ($by + $bh - 1))
  $p2 = New-Object System.Drawing.Point (($bx + [int]($bw * 0.40)), ($by + $bh - 1))
  $p3 = New-Object System.Drawing.Point (($bx + [int]($bw * 0.16)), ($by + $bh + [int]($Size * 0.14)))
  $tail = New-Object System.Drawing.Drawing2D.GraphicsPath
  $tail.AddPolygon(@($p1, $p2, $p3))
  $g.FillPath($goldBrush, $tail)

  $y1 = $by + [int]($bh * 0.38)
  $y2 = $by + [int]($bh * 0.64)
  $g.DrawLine($inkPen, ($bx + [int]($bw * 0.18)), $y1, ($bx + [int]($bw * 0.82)), $y1)
  $g.DrawLine($inkPen, ($bx + [int]($bw * 0.18)), $y2, ($bx + [int]($bw * 0.60)), $y2)

  $dir = Split-Path -Parent $OutPath
  if (-not (Test-Path $dir)) {
    New-Item -ItemType Directory -Path $dir | Out-Null
  }
  $bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $bmp.Dispose()
  $bgBrush.Dispose()
  $goldBrush.Dispose()
  $inkPen.Dispose()
}

$root = Split-Path -Parent $PSScriptRoot
$iconDir = Join-Path $root "icons"
foreach ($size in 16, 32, 48, 128) {
  Export-Icon $size (Join-Path $iconDir "icon$size.png")
}

Write-Output "icons generated"
