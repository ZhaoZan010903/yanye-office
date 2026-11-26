param([Parameter(Mandatory=$true)][string]$File)
$ErrorActionPreference='Stop'
if([IO.Path]::GetFileName($File) -ne 'line-numbers.docx'){throw '仅操作专项校样'}
. (Join-Path $PSScriptRoot 'word-native-app.ps1')
foreach($program in 'KWPS.Application','Word.Application'){
  Use-Document $program $File $false {
    param($doc)
    $first=$doc.Sections.Item(1).PageSetup.LineNumbering
    $second=$doc.Sections.Item(2).PageSetup.LineNumbering
    $expected=if($program -eq 'KWPS.Application'){5}else{7}
    if(!$first.Active -or !$second.Active -or $first.RestartMode -ne 1 -or $second.RestartMode -ne 1 -or $first.CountBy -ne 3 -or $second.CountBy -ne $expected){
      throw "$program 读取分节行号不符，第一节 $($first.CountBy)、第二节 $($second.CountBy)，重新编号模式 $($first.RestartMode)、$($second.RestartMode)。"
    }
    $second.CountBy=if($program -eq 'KWPS.Application'){7}else{8}
    $doc.Save()
    "$program 已核对两节行号并在原路径修改第二节间隔。"
  }
}
