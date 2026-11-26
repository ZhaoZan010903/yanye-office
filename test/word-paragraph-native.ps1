param([string]$OutputDirectory=(Join-Path $env:TEMP ('yanye-paragraph-'+[guid]::NewGuid())))
$ErrorActionPreference='Stop'
if (Test-Path -LiteralPath $OutputDirectory) {throw '用于往返测试的目录必须是新目录。'}
$folder=(New-Item -ItemType Directory -Path $OutputDirectory).FullName
$file=Join-Path $folder 'paragraph.docx'
$helper=Join-Path $PSScriptRoot 'word-paragraph-native.mjs'
$baseline="AlphaOne`rBravoTwo`rCharlieEnd`r"
$accepted="AlphaFirst`rSecondTwo`rCharlieEnd`r"

. (Join-Path $PSScriptRoot 'word-native-app.ps1')
function Check-Stage([string]$stage,[string]$path) {
  node $helper $path $stage
  if ($LASTEXITCODE) {throw "砚页回读失败 $stage"}
}
function Record-Sample([string]$label,[string]$path) {
  if (Get-Command rea -ErrorAction SilentlyContinue) {
    $evidence=Join-Path $folder ($label+'-evidence.json')
    $record=rea inspect-artifact $path --detail summary --evidence_output $evidence --token-limit 450
    if ($LASTEXITCODE) {throw "REA 样本登记失败 $label"}
    $record | Select-String 'evidence_id:' | Select-Object -First 1
  }
}

Use-Document 'KWPS.Application' $file $true {
  param($doc)
  $doc.Content.Text=$baseline.TrimEnd("`r")
  $doc.Range(5,8).Font.Bold=-1
  $doc.TrackRevisions=$true
  [void]$doc.Range(5,14).Delete()
  $doc.SaveAs([ref]([string]$file),[ref]16)
}
Record-Sample 'wps-deletion' $file
Check-Stage 'edit' $file
Copy-Item -LiteralPath $file -Destination (Join-Path $folder 'revision-checkpoint.docx')
Check-Stage 'individual' $file
foreach ($program in 'Word.Application','KWPS.Application') {
  Use-Document $program $file $false {
    param($doc)
    if (!$doc.TrackRevisions -or $doc.Revisions.Count -lt 2) {throw "$program 丢失修订"}
    $doc.Revisions.AcceptAll()
    if ($doc.Content.Text -cne $accepted) {throw "$program 接受后正文有误：$($doc.Content.Text)"}
  }
  Use-Document $program $file $false {
    param($doc)
    $doc.Revisions.RejectAll()
    if ($doc.Content.Text -cne $baseline -or $doc.Range(5,8).Font.Bold -ne -1) {throw "$program 拒绝后原段落或粗体有误"}
  }
}
Use-Document 'Word.Application' $file $false {
  param($doc)
  $end=$doc.Content.End-1
  $doc.Range($end,$end).InsertAfter(' word')
  $doc.Save()
}
Record-Sample 'word-saved' $file
Use-Document 'KWPS.Application' $file $false {
  param($doc)
  if (!$doc.Content.Text.Contains(' word')) {throw 'WPS 未读取 Word 的后续修改'}
  $doc.Revisions.RejectAll()
  if ($doc.Content.Text -cne $baseline -or $doc.Revisions.Count -ne 0) {throw 'WPS 拒绝后正文有误'}
  $doc.Save()
}
Check-Stage 'rejected' $file

$formatFile=Join-Path $folder 'format.docx'
Use-Document 'Word.Application' $formatFile $true {
  param($doc)
  $doc.Content.Text="AAA`rBBB`rCCC"
  $doc.Paragraphs.Item(2).Alignment=1
  $doc.Paragraphs.Item(3).Alignment=2
  $doc.TrackRevisions=$true
  [void]$doc.Range(1,6).Delete()
  $doc.SaveAs([ref]([string]$formatFile),[ref]16)
}
Record-Sample 'word-format-deletion' $formatFile
Check-Stage 'foreign-format' $formatFile
Use-Document 'Word.Application' $formatFile $false {
  param($doc)
  if ($doc.Paragraphs.Item(2).Alignment -ne 1 -or $doc.Paragraphs.Item(3).Alignment -ne 2 -or $doc.Revisions.Count -ne 0) {throw 'Word 未恢复原有段落格式'}
}
Write-Output "WPS → 砚页 → Word → WPS → 砚页同一路径保存通过。样本 $folder"
