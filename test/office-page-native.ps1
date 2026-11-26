param(
  [Parameter(Mandatory)][ValidateSet('Word.Application','KWPS.Application')][string]$Program,
  [Parameter(Mandatory)][string]$Sample
)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'word-native-app.ps1')
Use-Document $Program $Sample $false {
  param($doc)
  foreach ($side in -1,-2,-3,-4) {
    if ($doc.Sections.Item(1).Borders.Item($side).LineStyle -ne 7) { throw "$Program 未读到双线页面边框" }
  }
  if ($doc.Background.Fill.ForeColor.RGB -ne 0xdff4fa) { throw "$Program 未读到页面底色" }
  $doc.Range(0,0).InsertBefore("$Program ")
  $doc.Save()
}
