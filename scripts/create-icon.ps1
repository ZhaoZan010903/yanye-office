$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$yanyeAssets = Join-Path (Split-Path -Parent $PSScriptRoot) 'assets'
$null = New-Item -Type Directory -Path $yanyeAssets -Force
$yanyeSizes = @(16, 32, 48, 64, 128, 256)
$yanyeImages = @()

foreach ($yanyeSize in $yanyeSizes) {
    $yanyeBitmap = [System.Drawing.Bitmap]::new($yanyeSize, $yanyeSize)
    $yanyeGraphics = [System.Drawing.Graphics]::FromImage($yanyeBitmap)
    $yanyeBackground = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#CBD7B6'))
    $yanyePen = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml('#315640'), 17)
    $yanyeStream = [System.IO.MemoryStream]::new()
    $yanyeShape = [System.Drawing.Drawing2D.GraphicsPath]::new()
    try {
        $yanyeGraphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $yanyeGraphics.ScaleTransform($yanyeSize / 256, $yanyeSize / 256)
        $yanyeShape.AddArc(8, 8, 128, 128, 180, 90)
        $yanyeShape.AddArc(120, 8, 128, 128, 270, 90)
        $yanyeShape.AddArc(120, 120, 128, 128, 0, 90)
        $yanyeShape.AddArc(8, 120, 128, 128, 90, 90)
        $yanyeShape.CloseFigure()
        $yanyeGraphics.FillPath($yanyeBackground, $yanyeShape)
        $yanyePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
        $yanyePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
        $yanyeGraphics.DrawLine($yanyePen, 75, 155, 104, 101)
        $yanyeGraphics.DrawLine($yanyePen, 111, 159, 145, 96)
        $yanyeGraphics.DrawLine($yanyePen, 150, 152, 180, 96)
        $yanyeBitmap.Save($yanyeStream, [System.Drawing.Imaging.ImageFormat]::Png)
        $yanyeImages += ,$yanyeStream.ToArray()
    } finally {
        $yanyeShape.Dispose()
        $yanyeStream.Dispose()
        $yanyePen.Dispose()
        $yanyeBackground.Dispose()
        $yanyeGraphics.Dispose()
        $yanyeBitmap.Dispose()
    }
}

[System.IO.File]::WriteAllBytes((Join-Path $yanyeAssets 'yanye.png'), $yanyeImages[-1])
$yanyeIco = [System.IO.BinaryWriter]::new([System.IO.File]::Create((Join-Path $yanyeAssets 'yanye.ico')))
try {
    $yanyeIco.Write([uint16]0)
    $yanyeIco.Write([uint16]1)
    $yanyeIco.Write([uint16]$yanyeSizes.Count)
    $yanyeOffset = 6 + 16 * $yanyeSizes.Count
    for ($yanyeIndex = 0; $yanyeIndex -lt $yanyeSizes.Count; $yanyeIndex++) {
        $yanyeDimension = [byte]($yanyeSizes[$yanyeIndex] % 256)
        $yanyeIco.Write($yanyeDimension)
        $yanyeIco.Write($yanyeDimension)
        $yanyeIco.Write([byte]0)
        $yanyeIco.Write([byte]0)
        $yanyeIco.Write([uint16]1)
        $yanyeIco.Write([uint16]32)
        $yanyeIco.Write([uint32]$yanyeImages[$yanyeIndex].Length)
        $yanyeIco.Write([uint32]$yanyeOffset)
        $yanyeOffset += $yanyeImages[$yanyeIndex].Length
    }
    foreach ($yanyeImage in $yanyeImages) { $yanyeIco.Write([byte[]]$yanyeImage) }
} finally {
    $yanyeIco.Dispose()
}
