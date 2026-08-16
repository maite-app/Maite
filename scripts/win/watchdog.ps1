#Requires -Version 5.1
<#
.SYNOPSIS
    見張り。オーバーレイが動いていなければ立ち上げ直す。

.DESCRIPTION
    1分ごとのタスクから呼ばれる（登録は install-startup.ps1）。
    やることは2つだけ ── 動いているか見て、いなければ起こす。

    🎯 なぜ要るか:
       オーバーレイは Electron のアプリなので、**立ち上げ直すには
       「終わらないコマンド」を叩く必要がある**。ところが**使う人は PC の前に**
       居ないので、スマホの橋（hq の ops/）から頼むことになる ── そして橋は
       終わらないコマンドを壁で止める（向こうに Ctrl+C を押す人がいないため）。

       壁を緩めて通すのは筋が悪い。**「止める」だけがスマホから届けば、
       起こすのは機械の仕事にできる。** それがこのファイル。
       つまり橋から見た「立ち上げ直し」は、ただの `Stop-Process` になる。

       ついでに、PC を再起動したあと相棒が消えたままになる問題も消える。

    ⚠️ 何も出力しない。タスクから静かに走るものなので、成功時は黙る。
       立ち上げ直した時だけ、その旨を残す（下の $Log）。
#>
$ErrorActionPreference = 'SilentlyContinue'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root      = (Resolve-Path (Join-Path $ScriptDir '..\..')).Path
$Target    = Join-Path $ScriptDir 'start-aipet.cmd'
$Log       = Join-Path $ScriptDir 'watchdog.log'   # .gitignore 済み

# 🔴 名前だけで判定しない。electron.exe は他のアプリも使う。
#    **このリポの場所を含んでいるか**まで見る。
$running = Get-CimInstance Win32_Process -Filter "Name='electron.exe'" |
  Where-Object { $_.CommandLine -like "*$Root*" }

if ($running) { exit 0 }
if (-not (Test-Path $Target)) { exit 0 }

Start-Process -FilePath $Target -WindowStyle Minimized
"$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') 相棒が居なかったので立ち上げ直しました" |
  Out-File -FilePath $Log -Append -Encoding UTF8
