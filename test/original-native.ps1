param([string]$Executable)
$ErrorActionPreference = 'Stop'
$sampleDir = Join-Path ([IO.Path]::GetTempPath()) ('yanye-original-native-' + [guid]::NewGuid())
$null = New-Item -ItemType Directory -Path $sampleDir
$previous = $env:YANYE_ORIGINAL_OUTPUT
try {
  $env:YANYE_ORIGINAL_OUTPUT = $sampleDir
  $script = Join-Path $PSScriptRoot 'original-desktop.mjs'
  if ($Executable) { node $script $Executable } else { node $script }
  if ($LASTEXITCODE -ne 0) { throw '原版式副本生成失败。' }
  foreach ($prog in @('Word.Application','KWPS.Application')) {
    $app = New-Object -ComObject $prog
    try {
      $doc = $app.Documents.Open((Join-Path $sampleDir '版式副本.docx'),$false,$true)
      try {
        if (!$doc.Content.Text.StartsWith('新 & 名称') -or $doc.Fields.Count -ne 1) { throw "$prog 正文或域未保留。" }
        Write-Output "$prog 正文与域回读通过。"
      } finally { $doc.Close(0) }
    } finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($app) }
  }
  foreach ($prog in @('Excel.Application','KET.Application')) {
    $app = New-Object -ComObject $prog
    try {
      $book = $app.Workbooks.Open((Join-Path $sampleDir '版式副本.xlsx'),0,$true)
      try {
        $sheet = $book.Worksheets.Item(1)
        if ($sheet.Range('A1').Value2 -ne '新 & 名称' -or $sheet.Range('A2').Formula -notlike '*旧名称*') { throw "$prog 单元格或公式未保留。" }
        Write-Output "$prog 文字与公式回读通过。"
      } finally { $book.Close($false) }
    } finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($app) }
  }
  foreach ($prog in @('PowerPoint.Application','KWPP.Application')) {
    $app = New-Object -ComObject $prog
    try {
      $deck = $app.Presentations.Open((Join-Path $sampleDir '版式副本.pptx'),-1,0,0)
      try {
        if ($deck.Slides.Item(1).Shapes.Item(1).TextFrame.TextRange.Text -ne '新 & 名称') { throw "$prog 文本框回读失败。" }
        Write-Output "$prog 文本框回读通过。"
      } finally { $deck.Close() }
    } finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($app) }
  }
} finally {
  $env:YANYE_ORIGINAL_OUTPUT = $previous
  $target = (Resolve-Path -LiteralPath $sampleDir).Path
  if ([IO.Path]::GetDirectoryName($target) -eq [IO.Path]::GetTempPath().TrimEnd('\') -and [IO.Path]::GetFileName($target).StartsWith('yanye-original-native-')) {
    Remove-Item -LiteralPath $target -Recurse -Force
  }
}
