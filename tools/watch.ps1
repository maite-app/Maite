<#
.SYNOPSIS
  aipet を常駐で最新に保つ。

.DESCRIPTION
  クラウド側（Claude Code）が push したものを、ローカルが勝手に取り込む。
  やることは 3 つだけ。

    1. 一定間隔で fetch して、早送りできるときだけ取り込む
    2. 取り込んだら npm test を回す
    3. -Restart ならオーバーレイを入れ直す
    4. -Deploy なら、Worker の中身が変わっていたときだけ wrangler deploy

  **早送り（fast-forward）以外はやらない。** 手元に未 push のコミットや
  編集途中のファイルがあるとき、勝手に merge や rebase をして
  作業を巻き込むのが一番やってはいけないこと。その場合は黙って見送り、
  次の周回でまた見に行く。

  -Bridge を付けると、結果を status ブランチに push して返す。クラウド側から
  「ローカルで取り込めたか、テストが通ったか」が見えるようになる。
  失敗しても常駐は止めない（あくまでおまけ）。

.PARAMETER Branch
  追いかけるブランチ。省略時はいま checkout しているもの。

.PARAMETER Interval
  見に行く間隔（秒）。既定 60。

.PARAMETER Restart
  取り込んだらオーバーレイを起動し直す。

.PARAMETER Bridge
  結果を status ブランチに push して返す。

.PARAMETER Deploy
  Worker に焼き込まれるファイル（server/ と src/core/）が変わっていたときだけ、
  wrangler deploy を実行する。**テストが落ちた回はデプロイしない。**

.EXAMPLE
  cd C:\Users\user\aipet
  powershell -ExecutionPolicy Bypass -File tools\watch.ps1 -Bridge -Restart

.NOTES
  **このブランチに push できる人は、あなたの PC でコードを実行できる。**
  自分のリポジトリの自分のブランチだけを指すこと。
#>
param(
  [string]$Branch = "",
  [int]$Interval = 60,
  [switch]$Restart,
  [switch]$Bridge,
  [switch]$Deploy,
  [string]$StatusBranch = "status/local"
)

$ErrorActionPreference = "Continue"
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

function Log($message) {
  $stamp = Get-Date -Format "HH:mm:ss"
  Write-Host "[$stamp] $message"
}

# git.exe の実体を先に押さえる。
#
# ヘルパーを Git という名前にして中で `& git` を呼ぶと、PowerShell の関数名は
# 大文字小文字を区別しないので**自分自身を呼び続けて**「呼び出しの深さの
# オーバーフロー」で落ちる。名前を分け、実体のパスで呼ぶ。
$GitExe = (Get-Command git -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1).Source
if (-not $GitExe) {
  Write-Host "git が見つかりません。PATH を確認してください。"
  exit 1
}

function Invoke-Git {
  # 出力をそのまま返す。$LASTEXITCODE は呼び出し側で見る。
  & $GitExe @args 2>&1
}

if ($Branch -eq "") {
  $Branch = (Invoke-Git rev-parse --abbrev-ref HEAD | Select-Object -First 1).ToString().Trim()
}

Log "aipet watch"
Log "  リポジトリ : $repo"
Log "  ブランチ   : $Branch"
Log "  間隔       : $Interval 秒"
if ($Restart) { Log "  取り込んだらオーバーレイを入れ直す" }
if ($Deploy) { Log "  Worker の中身が変わったらデプロイする" }
if ($Bridge) { Log "  結果を $StatusBranch に返す" }
Log "止めるときは Ctrl+C"

$overlay = $null

function Restart-Overlay {
  if ($script:overlay -ne $null -and -not $script:overlay.HasExited) {
    Log "オーバーレイを止めます (PID $($script:overlay.Id))"
    try { Stop-Process -Id $script:overlay.Id -Force -ErrorAction Stop } catch { Log "  止められませんでした: $_" }
    Start-Sleep -Seconds 2
  }
  Log "オーバーレイを起動します"
  # npm は npm.cmd 経由でないと Start-Process から呼べない
  $script:overlay = Start-Process -FilePath "npm.cmd" -ArgumentList "start" -PassThru -WorkingDirectory $repo
}

<#
  Worker に焼き込まれるのは server/ 配下と、そこから import している src/core/。
  スマホページの CSS と JS は build:worker が server/src/assets.js に畳んで
  コミットされているので、server/ を見れば足りる。

  ここが変わっていない回（README だけ直した等）はデプロイしない ── 毎回上げると
  変更していないものまで差し替わるし、無駄に時間もかかる。
#>
function Needs-Deploy($from, $to) {
  $changed = Invoke-Git diff --name-only "$from" "$to"
  if ($LASTEXITCODE -ne 0) { return $false }
  foreach ($line in $changed) {
    $path = "$line".Trim()
    if ($path.StartsWith("server/") -or $path.StartsWith("src/core/")) { return $true }
  }
  return $false
}

function Invoke-Deploy {
  Log "  Worker の中身が変わっています。wrangler deploy"
  Push-Location (Join-Path $repo "server")
  # --yes を付けないと、wrangler が入っていない初回に確認待ちで止まる
  $out = & npx.cmd --yes wrangler deploy 2>&1
  $ok = ($LASTEXITCODE -eq 0)
  Pop-Location
  if ($ok) {
    Log "  デプロイしました"
  } else {
    Log "  デプロイに失敗しました"
    $out | Select-Object -Last 12 | ForEach-Object { Log "    $_" }
  }
  return $ok
}

function Publish-Status($commit, $testsOk, $note, $deployed = "skipped") {
  # おまけなので、失敗しても常駐そのものは絶対に止めない
  try {
    $dir = Join-Path $env:TEMP "aipet-status"
    if (-not (Test-Path $dir)) {
      Invoke-Git worktree add -B $StatusBranch $dir HEAD | Out-Null
      if ($LASTEXITCODE -ne 0) { Log "  status ブランチを作れませんでした"; return }
    }
    $payload = [ordered]@{
      at      = (Get-Date).ToString("o")
      branch  = $Branch
      commit  = $commit
      tests   = $testsOk
      deployed = $deployed
      note    = $note
      host    = "local"
    } | ConvertTo-Json
    # Set-Content -Encoding UTF8 は 5.1 だと BOM を書く。JSON の先頭に BOM が
    # 付くと、厳密なパーサが落ちる。BOM 無しの UTF-8 で書く。
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText((Join-Path $dir "watch-status.json"), $payload, $utf8NoBom)

    Push-Location $dir
    Invoke-Git add watch-status.json | Out-Null
    Invoke-Git -c user.name="aipet-watch" -c user.email="watch@local" commit -m "watch: $commit tests=$testsOk" | Out-Null
    Invoke-Git push -f origin "HEAD:$StatusBranch" | Out-Null
    if ($LASTEXITCODE -eq 0) { Log "  結果を $StatusBranch に返しました" } else { Log "  結果を返せませんでした" }
    Pop-Location
  } catch {
    Log "  結果を返す途中で失敗: $_"
    if ((Get-Location).Path -ne $repo) { Pop-Location }
  }
}

while ($true) {
  Invoke-Git fetch origin $Branch --quiet | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Log "fetch に失敗（回線か認証）。次の周回で見直します"
    Start-Sleep -Seconds $Interval
    continue
  }

  $local = (Invoke-Git rev-parse HEAD | Select-Object -First 1).ToString().Trim()
  $remote = (Invoke-Git rev-parse "origin/$Branch" | Select-Object -First 1).ToString().Trim()

  if ($local -eq $remote) {
    Start-Sleep -Seconds $Interval
    continue
  }

  Log "更新がありました: $($local.Substring(0,7)) -> $($remote.Substring(0,7))"

  $merge = Invoke-Git merge --ff-only "origin/$Branch"
  if ($LASTEXITCODE -ne 0) {
    # 手元に未 push のコミットか、編集中のファイルがある。巻き込まない。
    Log "  早送りできないので見送ります（手元の変更を壊さないため）"
    Log "  $merge"
    if ($Bridge) { Publish-Status $remote "skipped" "fast-forward できない" "skipped" }
    Start-Sleep -Seconds $Interval
    continue
  }

  Log "  取り込みました"

  Log "  npm test"
  $testOutput = & npm.cmd test 2>&1
  $testsOk = ($LASTEXITCODE -eq 0)
  if ($testsOk) {
    Log "  テスト通過"
  } else {
    Log "  テスト失敗（取り込みは済んでいます）"
    $testOutput | Select-Object -Last 15 | ForEach-Object { Log "    $_" }
  }

  # テストが落ちた回は上げない。壊れたものを本番に出さない。
  $deployed = "skipped"
  if ($Deploy -and $testsOk) {
    if (Needs-Deploy $local $remote) {
      if (Invoke-Deploy) { $deployed = "ok" } else { $deployed = "failed" }
    } else {
      $deployed = "not-needed"
    }
  } elseif ($Deploy -and -not $testsOk) {
    $deployed = "blocked-by-tests"
    Log "  テストが落ちているのでデプロイは見送ります"
  }

  if ($Restart) { Restart-Overlay }
  if ($Bridge) { Publish-Status $remote $testsOk "" $deployed }

  Start-Sleep -Seconds $Interval
}
