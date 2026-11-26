param([string]$Executable)
$ErrorActionPreference = 'Stop'
$folder = Join-Path ([IO.Path]::GetTempPath()) ('yanye-shape-native-' + [guid]::NewGuid())
$null = New-Item -ItemType Directory -Path $folder
$old = $env:YANYE_PRESENTATION_FIXTURES
try {
  $ppt = New-Object -ComObject PowerPoint.Application
  $deck = $ppt.Presentations.Add(0)
  try {
    $slide = $deck.Slides.Add(1,12)
    $shape = $slide.Shapes.AddShape(4,150,110,180,80)
    $shape.TextFrame.TextRange.Text = '流程起点'
    $shape.Fill.ForeColor.RGB = 0xc4b3a2
    $shape.Line.ForeColor.RGB = 0x664920
    $slide.SlideShowTransition.EntryEffect = 3849
    $slide.SlideShowTransition.AdvanceOnTime = -1
    $slide.SlideShowTransition.AdvanceTime = 3
    $second = $deck.Slides.Add(2,12)
    $second.Shapes.AddTextbox(1,60,70,220,80).TextFrame.TextRange.Text = 'Page 2'
    $null = $deck.Slides.Add(3,12)
    $deck.SaveAs((Join-Path $folder 'source.pptx'),24)
    $deck.SaveAs((Join-Path $folder 'source.pdf'),32)
  } finally {
    $deck.Close()
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($ppt)
  }
  $env:YANYE_PRESENTATION_FIXTURES = $folder
  $test = Join-Path $PSScriptRoot 'presentation-pdf-desktop.mjs'
  if ($Executable) { node $test $Executable } else { node $test }
  if ($LASTEXITCODE -ne 0) { throw '桌面编辑测试失败。' }
  $pdf = Join-Path $folder 'result.pdf'
  $info = pdfinfo -f 1 -l 1 $pdf
  if ($LASTEXITCODE -ne 0 -or !($info -match '^Pages:\s+2$') -or !($info -match '^Page\s+1 rot:\s+90$')) { throw 'Poppler 未读回两页与第一页的旋转角度。' }
  $preview = Join-Path $folder 'pdf-page-1'
  pdftoppm -f 1 -l 1 -singlefile -png -r 64 $pdf $preview
  if ($LASTEXITCODE -ne 0) { throw 'Poppler 页面渲染失败。' }
  Add-Type -AssemblyName System.Drawing
  $bitmap = [Drawing.Bitmap]::new("$preview.png")
  try {
    $yellow = 0
    for ($y=0; $y -lt $bitmap.Height; $y+=2) {
      for ($x=0; $x -lt $bitmap.Width; $x+=2) {
        $pixel = $bitmap.GetPixel($x,$y)
        if ($pixel.R -gt 200 -and $pixel.G -gt 150 -and ($pixel.R-$pixel.B) -gt 60) { $yellow++ }
      }
    }
    if ($yellow -lt 20) { throw 'Poppler 未渲染出预期的黄色 PDF 标注。' }
    Write-Output "Poppler 已核对页数和旋转并渲染第一页，抽样识别到 $yellow 个黄色标注像素。"
  } finally { $bitmap.Dispose() }
  foreach ($progId in @('PowerPoint.Application','KWPP.Application')) {
    $app = New-Object -ComObject $progId
    $reopened = $app.Presentations.Open((Join-Path $folder 'result.pptx'),-1,0,0)
    try {
      $objects = @($reopened.Slides.Item(1).Shapes | Where-Object HasTextFrame)
      $transition = $reopened.Slides.Item(1).SlideShowTransition
      if ($transition.EntryEffect -ne 257 -or !$transition.AdvanceOnTime -or [math]::Abs($transition.AdvanceTime - 0.5) -gt 0.05) { throw "$progId 未正确读取切入或自动换页时间。" }
      $diamond = $objects | Where-Object { $_.TextFrame.TextRange.Text -eq '复核通过' }
      $arrow = $objects | Where-Object { $_.TextFrame.TextRange.Text -eq '下一步' }
      $box = $objects | Where-Object { $_.TextFrame.TextRange.Text -eq '结项说明' }
      if (!$diamond -or $diamond.AutoShapeType -ne 4 -or $diamond.Rotation -ne 30 -or $diamond.Fill.ForeColor.RGB -ne 0xc4b3a2 -or $diamond.Line.ForeColor.RGB -ne 0x664920) { throw "$progId 图形类型、填充、线色或旋转未保真。" }
      if (!$arrow -or $arrow.AutoShapeType -ne 33) { throw "$progId 箭头形状未保留。" }
      if (!$box -or $box.TextFrame.TextRange.Font.Name -ne 'Georgia' -or !$box.TextFrame.TextRange.Font.Bold -or $box.TextFrame.TextRange.ParagraphFormat.Alignment -ne 3) { throw "$progId 文本框字体、粗体或右对齐未保留。" }
      Write-Output "$progId 已读回可编辑的菱形、箭头、两种颜色、旋转角度与格式化文本框。"
    } finally {
      $reopened.Close()
      [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($app)
    }
  }
} finally {
  $env:YANYE_PRESENTATION_FIXTURES = $old
  $resolved = (Resolve-Path -LiteralPath $folder).Path
  if ([IO.Path]::GetDirectoryName($resolved) -eq [IO.Path]::GetTempPath().TrimEnd('\') -and [IO.Path]::GetFileName($resolved).StartsWith('yanye-shape-native-')) {
    Remove-Item -LiteralPath $resolved -Recurse -Force
  }
}
