# aipet server

PC で作業しても、クラウドの Claude Code で作業しても、**同じ 1 匹が育つ**ようにするための合流点。
Cloudflare Workers + KV。この規模なら無料枠で足りる。

## 何が変わるか

| | サーバー無し | サーバー有り |
|---|---|---|
| PC での作業 | ✅ 育つ | ✅ 育つ |
| クラウドの Claude Code | ❌ 育たない | ✅ 育つ |
| スマホから見る | 同じ Wi-Fi のときだけ | どこからでも |

**代わりに、記録が自分の PC の外に出る。** 出るのは `events.jsonl` の中身そのまま ── イベント種別・ツール名・成否・ハッシュ化したセッション/プロジェクト ID だけで、プロンプト本文もパスも元から入っていない。送り先は自分の Cloudflare アカウントだけ。

## 立てる

Cloudflare の無料アカウントが要る（クレカ不要）。

```sh
cd server
npm install -g wrangler     # 入っていなければ
wrangler login              # ブラウザが開くので許可する
```

**1. KV を作る**

```sh
wrangler kv namespace create AIPET
```

出てきた `id = "..."` を `wrangler.toml` に貼る。

**2. ページの素材を固める**

```sh
cd ..
node scripts/build-worker-assets.mjs
```

`src/mobile/` を編集したら毎回これを実行する（Worker には静的ファイルの置き場が無いので、中身を文字列にして埋め込んでいる）。

**3. 出す**

```sh
cd server
wrangler deploy
```

`https://aipet.<自分のサブドメイン>.workers.dev` が出てくる。これが `<エンドポイント>`。

## つなぐ

**トークンを 1 本作る。** これが自分のペットの鍵になる。長い方がいい。

```sh
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

```powershell
# PowerShell
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

**PC 側** ── `~/.aipet/config.json` を作る：

```json
{
  "endpoint": "https://aipet.xxxx.workers.dev",
  "token": "さっき作ったトークン"
}
```

**クラウドの Claude Code 側** ── コンテナは毎回作り直されるのでファイルを置けない。環境設定で環境変数を 2 つ入れる：

```
AIPET_ENDPOINT = https://aipet.xxxx.workers.dev
AIPET_TOKEN    = さっき作ったトークン
```

あわせて、そのリポジトリに `.claude/settings.json` を置いて hook を有効にしておく（クラウドのコンテナには `~/.claude/settings.json` が無いため）。

**スマホから見る** ── ブラウザでこれを開く：

```
https://aipet.xxxx.workers.dev/p/<トークン>
```

ホーム画面に追加すればアプリのように使える。

## 仕組み

```
PC の hook ────┐
               ├──→ POST /ingest ──→ KV に追記 + その場で畳む
クラウドの hook ┘                          │
                                          ↓
スマホ ────────────→ GET /api/state ──→ 畳んだ状態を返す
```

- **畳むのは受信時。** 読むたびに全イベントを畳み直すと、増えたときに Worker の CPU 時間に収まらない
- **生ログも残す。** 成長ルールを変えたときに畳み直せるようにするため。`STATE_VERSION` が上がると、次の受信で自動的に全部計算し直される
- **イベント ID で二重を弾く。** 送信が失敗したら丸ごと再送する作りなので、重複は前提。同じ ID は数えない
- **時刻順に畳む。** 別の場所から遅れて届いたぶんが混ざるため。日次 EXP 上限が日付をまたいで正しく効くのに必要
- **トークンはハッシュにしてから KV のキーにする。** 万一 KV の中身が見えてもトークンは復元できない

## 送信のタイミング

hook は `Stop` / `SessionEnd` / `PreCompact` のときだけ、**切り離した別プロセス**で送信を仕掛ける。

hook 自身は Claude Code を同期でブロックするので、そこでネットワークを待つと本体が待たされる。ツール 1 回ごとに送るのも頻度が高すぎる。区切りでまとめて投げ、結果は待たない。

## タイムゾーン

Worker のローカル時刻は UTC。**指定しないと日本時間の 9〜14 時が「夜更かし」に数えられ**、日次 EXP 上限の区切りも PC 側と食い違う。

`wrangler.toml` の `[vars]` に入れてある（分。日本なら 540）：

```toml
[vars]
AIPET_TZ_OFFSET = "540"
```

別の土地なら書き換えて `npx wrangler deploy`。`STATE_VERSION` を上げてあるので、次に読んだ時点で生ログから新しい切り方で畳み直される。
