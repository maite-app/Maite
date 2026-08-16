import fs from 'node:fs';
import { CONFIG_FILE } from './paths.js';
import { sanitizeName } from './naming.js';
import { normalizeLang } from './i18n.js';
import { reachFor } from './license.js';

/**
 * 同期の設定。既定は「同期しない」。
 *
 * 環境変数が最優先。クラウドの Claude Code はコンテナが毎回作り直されるので、
 * ファイルを置いておけない ── 環境変数なら環境設定に一度入れれば効く。
 */
export function loadConfig() {
  let file = {};
  try {
    // PowerShell の Set-Content -Encoding UTF8 は BOM を付ける。
    // 剥がさないと JSON.parse が落ちて、同期が黙って効かなくなる。
    file = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8').replace(/^﻿/, '')) || {};
  } catch {
    file = {};
  }

  const endpoint = process.env.AIPET_ENDPOINT || file.endpoint || null;
  const token = process.env.AIPET_TOKEN || file.token || null;

  /*
   * 付け替えた名前。**state ではなくここに置く。**
   *
   * state は events.jsonl を畳み直せばいつでも作り直せるものなので、
   * 成長の記録ではない値を混ぜると、ルールを変えて畳み直すたびに消える。
   * 名前は本人が決めたもので、ログから導けない ── 設定側の持ち物。
   */
  const name = sanitizeName(process.env.AIPET_NAME || file.name || null);

  /*
   * 画面のことば。**設定が無ければ機械の言語**に合わせる ── 英語圏の人が
   * 入れた直後に日本語が出ていると、そこで閉じられる。
   */
  const lang = normalizeLang(
    process.env.AIPET_LANG || file.lang || Intl.DateTimeFormat().resolvedOptions().locale,
  );

  /*
   * 引き換え券。**遡れる範囲だけが変わる**（DESIGN.md §6b / license.js）。
   * これも state ではなく設定側 ── 畳み直しで消えては困るし、
   * 成長の記録でもない。
   */
  const license = process.env.AIPET_LICENSE || file.license || null;

  /*
   * 鍵は何本でも持てる。2 本目以降がスキンになる想定なので（§6c）、
   * 1 本しか持てない形にはしない。古い `license`（1 本だけ）も読む。
   */
  const licenses = [
    ...(Array.isArray(file.licenses) ? file.licenses : []),
    ...(license ? [license] : []),
  ].filter((value) => typeof value === 'string' && value.trim());

  /** 着ているスキン。着られないものを指していたら既定に戻る（skins.js）。 */
  const skin = typeof (process.env.AIPET_SKIN || file.skin) === 'string' ? (process.env.AIPET_SKIN || file.skin) : null;

  return {
    endpoint: endpoint ? endpoint.replace(/\/+$/, '') : null,
    token: token || null,
    name,
    lang,
    license,
    licenses,
    skin,
    /** 遡れる日数（null なら全期間）。 */
    get reach() {
      return reachFor(licenses);
    },
    /** 両方揃って初めて外に出す。片方だけなら何もしない。 */
    get enabled() {
      return Boolean(endpoint && token);
    },
  };
}
