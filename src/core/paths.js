import os from 'node:os';
import path from 'node:path';

/**
 * aipet のデータは全部ここ。ホーム直下の 1 ディレクトリに閉じる。
 * ここから外に出るものは無い（Phase 1 で同期を足すときも opt-in）。
 */
export const ROOT = process.env.AIPET_HOME || path.join(os.homedir(), '.aipet');

export const EVENTS_FILE = path.join(ROOT, 'events.jsonl');
export const STATE_FILE = path.join(ROOT, 'state.json');
export const CONFIG_FILE = path.join(ROOT, 'config.json');
export const CURSOR_FILE = path.join(ROOT, 'cursor.json');

/**
 * サーバーへ送った位置。hook（hooks/aipet-hook.mjs）が同じ名前で書いている
 * ── あちらは依存を持てないので、パスを共有せず同じ文字列を持っている。
 * **名前を変えるなら両方**。
 */
export const PUSH_CURSOR_FILE = path.join(ROOT, 'push-cursor.json');
/** 送信の結果（hook が書く。status.mjs が読む）。 */
export const SYNC_STATUS_FILE = path.join(ROOT, 'sync-status.json');

/**
 * LAN 配信のアドレス。**オーバーレイが書いて、status.mjs が読む。**
 *
 * Windows の Electron はコンソールに UTF-8 のまま吐くので、日本語環境
 * （CP932）だと `▶ スマホ用ページを開きました…` ごと化けて、**肝心の URL が
 * 読めない**（node で走らせる scripts/ は化けない）。読める側から出せるように、
 * 立てたアドレスをファイルに置いておく。
 */
export const SERVE_FILE = path.join(ROOT, 'serve.json');
