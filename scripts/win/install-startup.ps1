#Requires -Version 5.1
<#
.SYNOPSIS
    PC が立ち上がったら相棒が自動で出てくるようにする（／やめる）。

.DESCRIPTION
    2つ登録する:
      1. スタートアップ フォルダへのショートカット（サインイン時に出る）
      2. 1分ごとの見張り（落ちていたら立ち上げ直す = watchdog.ps1）

    🎯 見張りが本命である。
       これがあると、スマホから「立ち上げ直して」を頼むときに
       **`Stop-Process` を1回送るだけで済む**（1分以内に機械が起こし直す）。
       橋は終わらないコマンドを壁で止めるので、この形でないと
       立ち上げ直しは PC の前でしかできない。

    ⚠️ 管理者権限は要らない（自分のスタートアップとタスクだけ）。

.PARAMETER Remove
    自動起動と見張りをやめる。

.EXAMPLE
    .\scripts\win\install-startup.ps1

.EXAMPLE
    .\scripts\win\install-startup.ps1 -Remove
#>
[CmdletBinding()]
param([switch]$Remove, [switch]$NoStart)

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Target    = Join-Path $ScriptDir 'start-aipet.cmd'
$Watchdog  = Join-Path $ScriptDir 'watchdog.ps1'
$Startup   = [Environment]::GetFolderPath('Startup')
$Link      = Join-Path $Startup 'Maite.lnk'
$TaskName  = 'aipet-watchdog'

if ($Remove) {
  if (Test-Path $Link) {
    Remove-Item $Link -Force
    Write-Host "自動起動をやめました: $Link" -ForegroundColor Yellow
  } else {
    Write-Host "もともと登録されていません: $Link" -ForegroundColor Gray
  }
  & schtasks /Delete /TN $TaskName /F 2>&1 | Out-Null
  Write-Host "見張りも外しました（登録が無ければ何もしません）" -ForegroundColor Yellow
  Write-Host "※いま出ている相棒はそのままです。消したければ窓を閉じてください" -ForegroundColor DarkGray
  exit 0
}

if (-not (Test-Path $Target))   { Write-Host "⛔ 見つかりません: $Target" -ForegroundColor Red; exit 2 }
if (-not (Test-Path $Watchdog)) { Write-Host "⛔ 見つかりません: $Watchdog" -ForegroundColor Red; exit 2 }
if (-not (Test-Path $Startup -PathType Container)) {
  Write-Host "⛔ スタートアップ フォルダが見つかりません: $Startup" -ForegroundColor Red; exit 2
}

$shell = New-Object -ComObject WScript.Shell
$sc = $shell.CreateShortcut($Link)
$sc.TargetPath       = $Target
$sc.WorkingDirectory = $ScriptDir
$sc.WindowStyle      = 7   # 最小化。相棒の窓は別に出るので、これは裏方
$sc.Description      = 'Maite — Claude Code の作業ログから育つデスクトップ相棒'
$sc.Save()

# 🔴 schtasks の /TR は **261文字まで**。処理を埋め込むと必ず溢れる
#    （2026-08-15 に実際に溢れた）。中身は watchdog.ps1 に置き、
#    タスクからはそのファイルを呼ぶだけにする。
#    引用符を含む文字列は、二重引用符の中でエスケープしようとしない。
#    単引用符で挟んで連結すれば、エスケープ自体が要らない。
$cmd = 'powershell.exe -NoProfile -WindowStyle Hidden -File "' + $Watchdog + '"'

# native の stderr で止まらないよう、ここだけ緩める
$prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
& schtasks /Create /TN $TaskName /TR $cmd /SC MINUTE /MO 1 /F 2>&1 | Out-Null
$rc = $LASTEXITCODE
$ErrorActionPreference = $prev

Write-Host ""
Write-Host "  登録しました" -ForegroundColor Green
Write-Host "  自動起動 : $Link"
if ($rc -eq 0) {
  Write-Host "  見張り   : $TaskName（1分ごと。落ちていたら立ち上げ直す）" -ForegroundColor Green
  Write-Host ""
  Write-Host "  ＝ これ以降、スマホからの「立ち上げ直し」は" -ForegroundColor Cyan
  Write-Host "     electron を止めるだけで済みます（1分以内に戻ります）" -ForegroundColor Cyan
} else {
  Write-Host "  ※見張りの登録は失敗しました（自動起動だけ有効です）" -ForegroundColor DarkYellow
}

if (-not $NoStart) {
  $Root = (Resolve-Path (Join-Path $ScriptDir '..\..')).Path
  $already = Get-CimInstance Win32_Process -Filter "Name='electron.exe'" |
    Where-Object { $_.CommandLine -like "*$Root*" }
  if ($already) {
    Write-Host "  相棒はもう出ています（触りません）"
  } else {
    Start-Process -FilePath $Target -WindowStyle Minimized
    Write-Host "  いま立ち上げました"
  }
}
Write-Host ""
Write-Host "  やめるとき: .\scripts\win\install-startup.ps1 -Remove" -ForegroundColor DarkGray
Write-Host ""
exit 0
