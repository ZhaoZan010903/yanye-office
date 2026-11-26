param([string]$OutputDirectory=(Join-Path $env:TEMP ('yanye-word-ribbon-'+[guid]::NewGuid())))
$ErrorActionPreference='Stop'
if(Test-Path -LiteralPath $OutputDirectory){throw '测试目录必须是新目录'}
$dir=(New-Item -ItemType Directory -Path $OutputDirectory).FullName
$path=Join-Path $dir 'workspace.docx'
. (Join-Path $PSScriptRoot 'word-native-app.ps1')
function Check-Editor([string]$stage) {
  node (Join-Path $PSScriptRoot 'word-reference-ui.mjs') $path $stage
  if($LASTEXITCODE){throw "砚页未通过 $stage"}
}
Check-Editor 'create'
foreach($program in 'KWPS.Application','Word.Application') {
  Use-Document $program $path $false {
    param($doc)
    if($doc.TablesOfContents.Count -ne 1 -or $doc.Footnotes.Count -ne 1 -or $doc.Endnotes.Count -ne 1) {throw "引用部件计数有误 $program"}
    if([math]::Abs($doc.PageSetup.LeftMargin-90.14) -gt 0.1) {throw "页边距有误 $program"}
    if(!$doc.Footnotes.Item(1).Range.Text.Contains('First footnote') -or !$doc.Endnotes.Item(1).Range.Text.Contains('Endnote body')) {throw "注释内容有误 $program"}
    if(!$doc.Bookmarks.Exists('BudgetRange') -or $doc.Bookmarks.Item('BudgetRange').Range.Text -ne "Alpha book`rBravo book") {throw "$program 跨段书签范围有误"}
    $reference=@($doc.Fields | Where-Object {$_.Type -eq 3})[0]
    if(!$reference) {throw "$program 缺少原生 REF 域"}
    [void]$reference.Update()
    if($reference.Result.Text -ne "Alpha book`rBravo book"){throw "$program 刷新 REF 域失败"}
    $doc.TablesOfContents.Item(1).Update()
    if(!$doc.TablesOfContents.Item(1).Range.Text.Contains('Heading one')) {throw "目录未更新 $program"}
    $range=$doc.Footnotes.Item(1).Range
    $range.InsertAfter($(if($program -eq 'KWPS.Application'){' WPS'}else{' Word'}))
    $doc.Save()
  }
  if(Get-Command rea -ErrorAction SilentlyContinue) {
    $evidence=Join-Path $dir ($program+'-rea.json')
    rea inspect-artifact $path --detail summary --evidence_output $evidence --token-limit 450 | Select-String 'evidence_id:' | Select-Object -First 1
    if($LASTEXITCODE){throw "REA 登记失败 $program"}
  }
  Check-Editor $program
}
Write-Output "同一 DOCX 成功往返。样本位置 $dir"
. (Join-Path $PSScriptRoot 'word-common-fields.ps1')
Test-CommonFields (Join-Path $dir 'common-fields.docx')
