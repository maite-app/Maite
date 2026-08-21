# クラウドの Claude Code でも育てる

`claude.ai/code` のセッションはクラウドのコンテナで走る。コンテナは毎回作り直されるので `~/.claude/settings.json` も `~/.aipet/` も残らない。だから**立ち上がるたびに入れ直す**必要がある。

先に [server/README.md](../server/README.md) の手順でサーバーを立てておくこと。
**サーバーが無いと、記録はコンテナと一緒に消える**（送り先が無いので溜まるだけ）。

入れ方は 2 つある。**推奨は 1 のほう。**

---

## 1. 環境のセットアップスクリプトに 1 行（推奨）

Claude Code の環境設定の「セットアップスクリプト」に、これを置く。

```sh
curl -fsSL https://raw.githubusercontent.com/maite-app/Maite/main/scripts/cloud-setup.sh | sh
```

リポジトリを持っている環境なら、取りに行かずにこれでもいい。

```sh
sh path/to/Maite/scripts/cloud-setup.sh
```

箱が立ち上がるたびに `~/.claude/settings.json` へ入れ直す。

**2 のやり方より確実な理由が 3 つある。**

- 🔴 **作業場所がどこでも効く。** 2 はリポジトリの中の設定なので、
  セッションが**その 1 つ上のフォルダ**で開かれていると読まれない
  （複数のリポジトリを横断するセッションで実際に起きた ── 1 週間ぶん、
  丸ごと 0 件だった）
- **リポジトリを汚さない。** `.claude/settings.json` を commit しなくていい
- 🔴 **Node の `fetch` は `HTTPS_PROXY` を見ない。** クラウドの箱は外向きを
  プロキシに強制していることがあり、そのままだと **403 で黙って落ちる**
  ── 記録は溜まるのに 1 件も送られない。セットアップスクリプトは
  そのための包み紙を挟む（フック本体は書き換えない）

合言葉（下記）が無くても**記録だけは始める**。送るのは揃ってからでいい。

---

## 2. リポジトリの中に置く

育てたいリポジトリに、この 2 つをコピーする。

```
.claude/settings.json     ← cloud/settings.json
.claude/aipet-hook.mjs    ← hooks/aipet-hook.mjs
```

```sh
mkdir -p .claude
cp path/to/aipet/cloud/settings.json .claude/settings.json
cp path/to/aipet/hooks/aipet-hook.mjs .claude/aipet-hook.mjs
```

`hooks/aipet-hook.mjs` は Node の標準モジュールしか使わない 1 枚ものなので、これだけ置けば動く。`settings.json` のほうは `$CLAUDE_PROJECT_DIR` 経由でそれを呼ぶので、クローン先のパスが毎回変わっても効く。

## 環境変数を入れる

Claude Code の環境設定に 2 つ足す（PC の `config.json` と同じ値）。

```
AIPET_ENDPOINT = https://aipet.xxxx.workers.dev
AIPET_TOKEN    = 自分のトークン
```

コンテナは毎回作り直されるのでファイルは置けない。環境変数なら一度入れれば以後のセッション全部に効く。

**どちらか片方でも欠けていると、hook は記録するだけで一切送らない。** 事故で外に出ることはない。

## 効いているか

セッション中に：

```sh
cat ~/.aipet/events.jsonl | tail -5
```

`PostToolUse` が並んでいれば記録されている。`Stop` のタイミングで送信が走るので、少し待ってからスマホのページを開くと反映されている。

## 二重にならないのか

ならない。`cloud/settings.json` は hook を `--cloud` 付きで呼び、
`--cloud` で呼ばれた hook は次の 2 つのどちらかに当たると黙って終わる。

- `AIPET_ENDPOINT` が無い（＝ PC。下記）
- `~/.maite-hook/hooks/aipet-hook.mjs` がある（＝ **1 のやり方で箱ごと
  入れてある**。両方が発火すると 1 つの操作が 2 回記録される ── しかも
  2 回の `i` は別々の乱数なので、サーバー側の重複弾きもすり抜ける）

**1 と 2 を両方やっても大丈夫。** 箱ごとのほうが勝つ。

PC ではユーザー設定（`~/.claude/settings.json`）の hook が既に動いていて、
設定は環境変数ではなく `~/.aipet/config.json` から読む。だから PC でこの
リポジトリを開いても、リポジトリ側の hook は黙って素通りする。

**例外**：PC 側で `AIPET_ENDPOINT` を環境変数として設定した場合は、両方が
発火して二重に記録される。PC では `config.json` を使うこと。

## 注意

- **記録はコンテナの中に溜まる。** 送信できていないぶんはコンテナが消えると失われる。送信は `Stop` / `SessionEnd` / `PreCompact` のたびに走るので、実際に取りこぼすのは「最後の応答のあと、何もせずコンテナが消えた」ぶんだけ。
- **`.claude/settings.json` はリポジトリに入る**（2 のやり方の場合）。そのリポジトリで作業する人全員に hook が効く。共同開発しているリポジトリには置かないこと（他人の作業が自分のペットに入る）。1 のやり方ならこの心配は無い。
