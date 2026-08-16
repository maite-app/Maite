# クラウドの Claude Code でも育てる

`claude.ai/code` のセッションはクラウドのコンテナで走る。コンテナは毎回作り直されるので `~/.claude/settings.json` も `~/.aipet/` も残らない。そのぶん、必要なものは全部リポジトリの中に置く。

先に [server/README.md](../server/README.md) の手順でサーバーを立てておくこと。

## 置く

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

## PC と二重にならないのか

ならない。`cloud/settings.json` は hook を `--cloud` 付きで呼び、hook は
`--cloud` かつ `AIPET_ENDPOINT` が無い環境では何もせずに終わる。

PC ではユーザー設定（`~/.claude/settings.json`）の hook が既に動いていて、
設定は環境変数ではなく `~/.aipet/config.json` から読む。だから PC でこの
リポジトリを開いても、リポジトリ側の hook は黙って素通りする。

**例外**：PC 側で `AIPET_ENDPOINT` を環境変数として設定した場合は、両方が
発火して二重に記録される。PC では `config.json` を使うこと。

## 注意

- **記録はコンテナの中に溜まる。** 送信できていないぶんはコンテナが消えると失われる。送信は `Stop` / `SessionEnd` / `PreCompact` のたびに走るので、実際に取りこぼすのは「最後の応答のあと、何もせずコンテナが消えた」ぶんだけ。
- **`.claude/settings.json` はリポジトリに入る。** そのリポジトリで作業する人全員に hook が効く。共同開発しているリポジトリには置かないこと（他人の作業が自分のペットに入る）。
