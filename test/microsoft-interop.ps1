param([string]$Executable)
$ErrorActionPreference = 'Stop'
$workDir = Join-Path ([IO.Path]::GetTempPath()) ('yanye-mso-' + [guid]::NewGuid())
$null = New-Item -ItemType Directory -Path $workDir
$previous = $env:YANYE_OFFICE_FIXTURES
try {
  $excel = New-Object -ComObject Excel.Application
  try {
    $excel.Visible = $false
    $excel.DisplayAlerts = $false
    $book = $excel.Workbooks.Add()
    try {
      $sheet = $book.Worksheets.Item(1)
      $sheet.Name = '预算'
      $sheet.Range('A1').Formula = '=3'
      $sheet.Range('B1').Formula = '=A1*2'
      $book.SaveAs((Join-Path $workDir 'source.xlsx'),51)
    } finally { $book.Close($false) }
  } finally { $excel.Quit() }

  # PowerPoint may use an existing COM server. Only close the presentation created here.
  $ppt = New-Object -ComObject PowerPoint.Application
  $deck = $ppt.Presentations.Add(0)
  try {
    $slide = $deck.Slides.Add(1,1)
    $slide.Shapes.Title.TextFrame.TextRange.Text = '原始汇报'
    $deck.SaveAs((Join-Path $workDir 'source.pptx'),24)
  } finally { $deck.Close() }
  $null = [Runtime.InteropServices.Marshal]::FinalReleaseComObject($ppt)

  $env:YANYE_OFFICE_FIXTURES = $workDir
  $test = Join-Path $PSScriptRoot 'files-desktop.mjs'
  if ($Executable) { node $test $Executable } else { node $test }
  if ($LASTEXITCODE -ne 0) { throw '砚页桌面流程失败。' }

  $excel = New-Object -ComObject Excel.Application
  try {
    $excel.DisplayAlerts = $false
    $book = $excel.Workbooks.Open((Join-Path $workDir 'revised.xlsx'),0,$true)
    try {
      $sheet = $book.Worksheets.Item(1)
      if ($sheet.Range('B1').Formula -ne '=A1*2' -or $sheet.Range('B1').Value2 -ne 24) { throw 'Excel 重算核对失败。' }
    } finally { $book.Close($false) }
  } finally { $excel.Quit() }

  $ppt = New-Object -ComObject PowerPoint.Application
  $deck = $ppt.Presentations.Open((Join-Path $workDir 'revised.pptx'),-1,0,0)
  try {
    $texts = @($deck.Slides.Item(1).Shapes | Where-Object HasTextFrame | ForEach-Object { $_.TextFrame.TextRange.Text })
    if ($texts -notcontains '评审通过') { throw 'PowerPoint 可编辑标题核对失败。' }
  } finally {
    $deck.Close()
    $null = [Runtime.InteropServices.Marshal]::FinalReleaseComObject($ppt)
  }
  Write-Output 'Microsoft Excel 与 PowerPoint 原生生成 → 砚页编辑并写回 → 原生应用重新打开、重算及核对文字，通过。'
} finally {
  $env:YANYE_OFFICE_FIXTURES = $previous
  $resolved = (Resolve-Path -LiteralPath $workDir).Path
  if ([IO.Path]::GetDirectoryName($resolved) -eq [IO.Path]::GetTempPath().TrimEnd('\') -and [IO.Path]::GetFileName($resolved).StartsWith('yanye-mso-')) {
    Remove-Item -LiteralPath $resolved -Recurse -Force
  }
}
