param([Parameter(Mandatory=$true)][string]$Samples)
$ErrorActionPreference='Stop'
$Samples=(Resolve-Path -LiteralPath $Samples).Path
if ((Split-Path (Split-Path $Samples -Parent) -Leaf) -notlike 'yanye-formats-*' -or (Split-Path $Samples -Leaf) -ne 'samples') {
  throw '请选择 format-desktop.mjs 生成的样本文件夹。'
}
. "$PSScriptRoot/word-native-app.ps1"
$rea=Join-Path $env:LOCALAPPDATA 'Programs/REA/bin/rea.cmd'
function Snapshot($stage) {
  foreach($ext in 'doc','xls','ppt') {
    $inputFile=Join-Path $Samples ("Format sample."+$ext)
    $report=Join-Path $Samples ("rea-"+$stage+"-"+$ext+".json")
    & $rea inspect-artifact $inputFile --format json | Set-Content -LiteralPath $report -Encoding utf8
    if($LASTEXITCODE){
      $failure=Get-Content -Raw -LiteralPath $report | ConvertFrom-Json
      if($failure.category -ne 'unsupported_target'){throw "REA 无法读取 $ext 样本"}
      # REA does not parse Compound File Binary internals. Keep its actual result
      # and identify each binary revision separately for the native read-back.
      (Get-FileHash -LiteralPath $inputFile -Algorithm SHA256).Hash | Set-Content -LiteralPath ($report+'.sha256') -Encoding ascii
    }
  }
}

function Use-BookOrDeck($program,$file,$isBook,[scriptblock]$edit) {
  $before=@((Get-Process).Id)
  $app=New-Object -ComObject $program
  $owned=$false
  try {
    [uint32]$appId=0
    if($app.Hwnd){[void][YanYeRevisionApp]::GetWindowThreadProcessId([IntPtr]$app.Hwnd,[ref]$appId)}
    if($isBook){$collection=$app.Workbooks}else{$collection=$app.Presentations}
    $owned=$appId -and ($appId -notin $before) -and $collection.Count -eq 0
    if($isBook){$doc=$collection.Open($file,0,$false)}else{$doc=$collection.Open($file,0,0,0)}
    try {& $edit $doc} finally {if($isBook){$doc.Close($false)}else{$doc.Close()}}
  } finally {
    if($owned -and $collection.Count -eq 0){$app.Quit()}
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($app)
  }
}
Snapshot 'yanye'
foreach($stage in 'wps','microsoft','verify'){
  $w=if($stage -eq 'microsoft'){'Word.Application'}else{'KWPS.Application'}
  $e=if($stage -eq 'microsoft'){'Excel.Application'}else{'KET.Application'}
  $p=if($stage -eq 'microsoft'){'PowerPoint.Application'}else{'KWPP.Application'}
  $expected=if($stage -eq 'wps'){'revised'}elseif($stage -eq 'microsoft'){'wps'}else{'microsoft'}
  Use-Document $w (Join-Path $Samples 'Format sample.doc') $false {
    param($doc)
    if($doc.Content.Text -notmatch $expected -or !$doc.Range(0,6).Font.Bold){throw "$w DOC 原文或粗体变化"}
    if($stage -ne 'verify'){$doc.Paragraphs.Item(1).Range.InsertBefore("$stage ");$doc.Save()}
  }
  Use-BookOrDeck $e (Join-Path $Samples 'Format sample.xls') $true {
    param($book)
    $sheet=$book.Worksheets.Item(1)
    if($sheet.Range('B1').Formula -ne '=A1*2' -or $sheet.Range('B1').Value2 -ne 42){throw "$e XLS 公式或结果变化"}
    if($stage -ne 'wps' -and $sheet.Range('C1').Text -ne $expected){throw "$e XLS 没有读到上次保存的改动"}
    if($stage -ne 'verify'){$sheet.Range('C1').Formula=$stage;$book.Save()}
  }
  Use-BookOrDeck $p (Join-Path $Samples 'Format sample.ppt') $false {
    param($deck)
    $shape=@($deck.Slides.Item(1).Shapes | Where-Object {$_.HasTextFrame -and $_.TextFrame.TextRange.Text -match 'Format sample'})[0]
    if(!$shape -or $shape.TextFrame.TextRange.Text -notmatch $expected -or $shape.TextFrame.TextRange.Characters(1,3).Font.Size -ne 18){throw "$p PPT 内容或字号变化"}
    if($stage -ne 'verify'){[void]$shape.TextFrame.TextRange.InsertAfter(" $stage");$deck.Save()}
  }
  if($stage -ne 'verify'){Snapshot $stage}
  Write-Output "$stage DOC / XLS / PPT read back passed"
}
