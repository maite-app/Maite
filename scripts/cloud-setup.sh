#!/bin/sh
# 🎯 クラウドのセッションでも、同じ 1 匹が育つようにする。
#
# ## なぜ要るか
#
# 経験値は Claude Code のフックが道具を振るうたびに書く 1 行から溜まる。
# そのフックは **PC の `~/.claude/settings.json` に入っている。**
#
# クラウドのセッション（claude.ai/code・スマホ・ブラウザ）は**毎回まっさらな箱**で
# 立ち上がるので、フックが無い。つまり **そこでどれだけ働いても 1 経験値も入らない。**
# 2026-08-16、丸 1 日ぶんの作業が丸ごと数えられていなかった。
#
# 箱は使い捨てなので、**立ち上がるたびに入れ直す**しかない。これはそのための 1 枚。
# 環境の「セットアップスクリプト」に置いておけば、以後は勝手に効く。
#
# ## 置いてあるものは公開リポジトリから取る
#
# セッションによっては aipet の中身を持っていない（intake だけ、など）。
# 公開している側から取れば、**どのセッションでも同じ手順で入る。**
#
# ## 🔴 送り先が無ければ、何もしない
#
# `AIPET_ENDPOINT` と `AIPET_TOKEN` が無ければ**黙って終わる**（exit 0）。
# 設定していない人の環境を、勝手に触らないため。
#
# ⚠️ **`set -e` を外さないこと。** 途中で失敗したまま進むと、
#    「入ったつもりで入っていない」がいちばん気づけない壊れ方になる。

set -e

if [ -z "$AIPET_ENDPOINT" ] || [ -z "$AIPET_TOKEN" ]; then
  echo "[maite] AIPET_ENDPOINT / AIPET_TOKEN が無いので、何もしません"
  exit 0
fi

BASE="${MAITE_RAW_BASE:-https://raw.githubusercontent.com/maite-app/Maite/main}"
# ⚠️ 仕掛けは ~/.aipet（記録の置き場）と分けておく。
#    混ぜると、記録を消したいときに仕掛けごと消える
HOME_DIR="${HOME:-/root}"
KIT="$HOME_DIR/.maite-hook"

mkdir -p "$KIT/hooks" "$KIT/scripts"

# install-hooks.mjs は自分の場所からの相対で ../hooks/aipet-hook.mjs を見る。
# 同じ形に置けば、リポジトリの中と同じものがそのまま動く（作り直さない）
curl -fsSL "$BASE/hooks/aipet-hook.mjs"      -o "$KIT/hooks/aipet-hook.real.mjs"
curl -fsSL "$BASE/scripts/install-hooks.mjs" -o "$KIT/scripts/install-hooks.mjs"

# 🔴 **Node の fetch は HTTPS_PROXY を見ない。**
#
#    クラウドの箱は外向きの通信をプロキシ経由に強制している。curl は環境変数を
#    見るので通るが、Node 22 の fetch（undici）は既定で見に行かない。
#    その結果 **403 で黙って落ちる** ── 記録は溜まるのに 1 件も送られない、
#    という気づきにくい壊れ方になる（2026-08-16 に実際に踏んだ）。
#
#    直すのに 2 つの環境変数が要るが、**フック本体も settings.json の書き方も
#    触りたくない**（PC 側は素の Node で動いており、あちらにこの事情は無い）。
#    そこで、install-hooks が見に行く名前に**包み紙**を置き、そこから環境変数を
#    足して本体を呼ぶ。包み紙はこの箱にしか無いので、PC 側には何の影響も無い。
cat > "$KIT/hooks/aipet-hook.mjs" <<'WRAPPER'
// クラウドの箱でだけ要る包み紙。中身は aipet-hook.real.mjs（本体）。
// Node の fetch にプロキシと CA を教えてから本体を呼ぶ。
// ⚠️ 本体を書き換えないこと。PC 側にこの事情は無い。
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const real = fileURLToPath(new URL('./aipet-hook.real.mjs', import.meta.url));
const r = spawnSync(process.execPath, [real, ...process.argv.slice(2)], {
  stdio: 'inherit',   // 標準入力（Claude Code が渡す JSON）もそのまま通す
  env: {
    ...process.env,
    NODE_USE_ENV_PROXY: '1',
    // 実験的機能の警告が毎回 stderr に出る。フックの出力を汚さないため黙らせる
    NODE_NO_WARNINGS: '1',
    NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS || '/root/.ccr/ca-bundle.crt',
  },
});
process.exit(r.status ?? 0);
WRAPPER

node "$KIT/scripts/install-hooks.mjs"

echo "[maite] クラウドのこの箱でも経験値が入ります（送り先: ${AIPET_ENDPOINT%%:*}://…）"
