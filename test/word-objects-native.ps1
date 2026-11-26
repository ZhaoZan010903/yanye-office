param([Parameter(Mandatory=$true)][string]$Directory,[ValidateSet('wps','word')][string]$Stage,[switch]$VerifyOnly)
$ErrorActionPreference='Stop'
. "$PSScriptRoot/word-native-app.ps1"
$prog=if($Stage -eq 'wps'){'KWPS.Application'}else{'Word.Application'}
$advanced=Join-Path $Directory 'advanced.docx'
$label=if($Stage -eq 'wps'){'WPS'}else{'Word'}
Use-Document $prog $advanced $false {
  param($doc)
  if($doc.Shapes.Count -ne 1){throw "$label expected one native floating shape, got $($doc.Shapes.Count)"}
  $shape=$doc.Shapes.Item(1)
  if([Math]::Abs($shape.Width-160) -gt 1){throw "$label shape width $($shape.Width)"}
  if([Math]::Abs($shape.Left-210) -gt 1 -or [Math]::Abs($shape.Top-12) -gt 1 -or [Math]::Abs($shape.Height-48) -gt 1){throw "$label floating shape geometry differs"}
  if([Math]::Abs($doc.PageSetup.PageWidth-595.3) -gt 1 -or [Math]::Abs($doc.PageSetup.LeftMargin-72) -gt 1){throw "$label page size or margins differ"}
  if($doc.Fields.Count -ne 1 -or $doc.Fields.Item(1).Code.Text -notmatch 'MERGEFIELD'){throw "$label did not recognize MERGEFIELD"}
  if($Stage -eq 'word' -and $doc.OMaths.Count -ne 1){throw "Word OMaths count $($doc.OMaths.Count)"}
  if(!$VerifyOnly){
    $doc.Paragraphs.Item(1).Range.InsertBefore("$label ")
    $doc.Save()
  }
  Write-Output "$label verified A4 and 72 pt margins; floating box (210,12) 160 x 48 pt; merge template"
}
$tracked=Join-Path $Directory 'tracked.docx'
foreach($accept in @($false,$true)){
  Use-Document $prog $tracked $false {
    param($doc)
    if($doc.Revisions.Count -lt 2){throw "$label did not open both native comparison edits"}
    if($accept){$doc.Revisions.AcceptAll();$expected='Revised body'}else{$doc.Revisions.RejectAll();$expected='Original body'}
    if($doc.Paragraphs.Item(1).Range.Text.Trim() -ne $expected){throw "$label revisions did not yield $expected"}
  }
}
Use-Document $prog (Join-Path $Directory 'letters.docx') $false {
  param($doc)
  if($doc.Sections.Count -ne 2 -or $doc.Shapes.Count -ne 2 -or $doc.Fields.Count -ne 0){throw "$label could not read all merged records"}
  $plain=$doc.Content.Text
  if($plain -notmatch '林岚' -or $plain -notmatch 'Li, Li'){throw "$label could not read Chinese and quoted CSV values"}
}
Use-Document $prog (Join-Path $Directory 'report.docx') $false {
  param($doc)
  if($doc.Tables.Count -ne 1 -or $doc.Tables.Item(1).Rows.Count -ne 2){throw "$label missing comparison report rows"}
}
Write-Output "$label opened merged letters and report, accepted and rejected the tracked comparison"
