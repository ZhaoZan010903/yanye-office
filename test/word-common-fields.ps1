function Test-CommonFields([string]$path) {
  foreach($program in 'KWPS.Application','Word.Application') {
    Use-Document $program $path $false {
      param($doc)
      if(!$doc.Content.Text.Contains('Edited Adjacent text')) {throw "$program 未读到普通域旁边的正文修改"}
      $fields=@($doc.Fields)
      $date=@($fields | Where-Object {$_.Type -eq 31})[0]
      if(!$date -or !$date.Locked -or $date.Result.Text -ne '2026' -or $date.Result.Font.Bold -ne -1) {throw "$program 丢失 DATE 缓存、锁定标记或粗体"}
      if(!$date.Code.Text.Contains('"yyyy"') -or !($fields | Where-Object {$_.Type -eq 33}) -or !($fields | Where-Object {$_.Type -eq 26})) {throw "$program 丢失 DATE 格式、PAGE 或 NUMPAGES 指令"}
      Write-Output "$program 普通文字域及相邻正文修改通过"
    }
  }
}
