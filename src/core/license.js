/**
 * 引き換え券 ── 売るのは「遡れる範囲」であって、EXP の量ではない（DESIGN.md §6b）。
 *
 * Claude Code は `~/.claude/projects` に全セッションの記録を残している。
 * hook を入れる前の作業がそこに全部あるので、畳めば「本当に働いた通りの
 * レベル」から始められる。**その遡れる幅だけを売る。**
 *
 *   無料      直近 30 日
 *   1 ドル    さらに 30 日ぶん遡れる（重ねて買える）
 *   `all` 券  全期間（自分用・引き換え用）
 *
 * **1 本 30 日ずつ伸びる形にしてある。** 「一度払えば全部」だと、買う理由が
 * 一生に一度しか来ない ── 30 日ずつなら、もっと前まで遡りたくなったときに
 * また 1 ドルを払う理由がその都度できる。しかも**払って増えるのは「見える
 * 範囲」だけ**で、そこから出る EXP は本当に働いたぶんそのままなので、
 * 何本重ねても「同じログなら同じレベル」は崩れない。
 *
 * **同じログを入れたら同じレベルが出る。** ルールは全員同じで、公開して困る
 * ところが 1 つも無い。課金した人は本当に強いが、それは長く働いていたからで、
 * 係数が優遇されているからではない ── §1（戦闘力の出どころは作業ログ）が
 * 1 ミリも崩れない。
 *
 * ## どこまで守れるか、正直なところ
 *
 * ここでやっているのは**署名の検証だけ**。鍵は Ed25519 で署名してあるので
 * 「それらしい文字列」を打ち込んでも通らないし、1 本漏れても他人の鍵は作れない。
 *
 * **ソースを書き換えれば外せる。** それは分かっていて、それでいい ──
 * `state.json` も `events.jsonl` も手元にあるので、どんな作りにしても
 * 手元で完結する検証は必ず外せる。外せない形にするにはサーバーで畳むしかなく、
 * それは「自分の PC の中だけで完結する」という前提のほうを捨てることになる。
 *
 * だから狙いは**うっかり共有される鍵を止めること**であって、
 * 本気で外す人を止めることではない。$1 の買い物に掛ける鍵としては、ここが上限。
 */
import crypto from 'node:crypto';

/** 無料で遡れる日数。 */
export const FREE_DAYS = 30;

/**
 * 鍵 1 本で伸びる日数。**1 ドル 1 本 = 30 日。**
 *
 * 無料ぶんと同じ幅にしてあるのは、「いま見えている範囲がもう 1 つぶん増える」
 * が、いちばん説明の要らない売り方だから。
 */
export const REACH_DAYS_PER_KEY = 30;

/**
 * 鍵を検証する公開鍵（PEM）。**空のまま配ってよい。**
 *
 * 空のときは「課金の口がまだ開いていない」という意味になり、誰も課金者として
 * 扱われない ── 無料の範囲だけが動く。売り始めるときに `scripts/license.mjs
 * --init` で対を作り、出てきた公開鍵をここに貼る。**秘密鍵はリポジトリに置かない**
 * （`--init` は `~/.aipet` の外に書き出す）。
 */
export const PUBLIC_KEYS = [];

/**
 * `AIPET-<何を開けるか>-<注文番号>.<署名>`
 *
 * **何を開けるかを id の頭に持たせる。** ここを分けておかないと、鍵が
 * 「全部入り」の 1 種類にしかならない ── スキンを 2 本目として売るときに
 * （§6c）、遡れる範囲の鍵で全部開いてしまう。
 *
 *   reach-1234         遡れる範囲
 *   skin_ember-1234    スキン 1 つ
 *   all-1234           全部（自分用・引き換え用）
 */
const KEY_SHAPE = /^AIPET-([A-Za-z0-9_-]{6,64})\.([A-Za-z0-9_-]{40,200})$/;

/** 「何を開けるか」。id の最初の `-` より前。 */
export function grantOf(id) {
  return String(id || '').split('-')[0];
}

/** 何でも開ける鍵。自分用と、引き換え対応用に 1 つだけ置いてある。 */
export const GRANT_ALL = 'all';

function fromBase64Url(value) {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

export function toBase64Url(buffer) {
  return Buffer.from(buffer).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 鍵の形。中身の正しさまでは見ない（見るのは verifyLicense）。 */
export function parseLicense(value) {
  if (typeof value !== 'string') return null;
  const match = KEY_SHAPE.exec(value.trim());
  return match ? { id: match[1], signature: match[2] } : null;
}

/**
 * その鍵が本物か。公開鍵が 1 つも無ければ、常に false。
 *
 * **落ちない。** 壊れた鍵や壊れた公開鍵を渡されても例外にしない ── ここで
 * 落ちると、鍵を打ち間違えただけでアプリが起動しなくなる。
 */
export function verifyLicense(value, publicKeys = PUBLIC_KEYS) {
  const parsed = parseLicense(value);
  if (!parsed || !publicKeys || !publicKeys.length) return false;

  for (const pem of publicKeys) {
    try {
      const ok = crypto.verify(
        null,
        Buffer.from(parsed.id, 'utf8'),
        crypto.createPublicKey(pem),
        fromBase64Url(parsed.signature),
      );
      if (ok) return true;
    } catch {
      // 公開鍵のほうが壊れていても、次を試すだけ
    }
  }
  return false;
}

/**
 * 持っている鍵から「何を開けたか」を集める。
 *
 * 鍵は何本でも持てる（`config.json` の `licenses`）── 2 本目以降がスキンに
 * なる想定なので、1 本しか持てない形にはしない（§6c）。
 */
export function grantsFrom(licenses, publicKeys = PUBLIC_KEYS) {
  const list = Array.isArray(licenses) ? licenses : [licenses];
  const out = new Set();
  for (const value of list) {
    if (!verifyLicense(value, publicKeys)) continue;
    out.add(grantOf(parseLicense(value).id));
  }
  return out;
}

/**
 * 何本の鍵がその口を開けているか。**同じ鍵を 2 回書いても 1 本**
 * （id ごと数えるので、貼り付けの重複で日数が増えたりはしない）。
 */
export function countGrants(licenses, name, publicKeys = PUBLIC_KEYS) {
  const list = Array.isArray(licenses) ? licenses : [licenses];
  const ids = new Set();
  for (const value of list) {
    if (!verifyLicense(value, publicKeys)) continue;
    const { id } = parseLicense(value);
    if (grantOf(id) === name) ids.add(id);
  }
  return ids.size;
}

/** その口が開いているか。`all` の鍵は何にでも効く。 */
export function hasGrant(grants, name) {
  return Boolean(grants && (grants.has(name) || grants.has(GRANT_ALL)));
}

/**
 * 遡れる範囲。**日数だけを返す**（null は「全部」）。
 *
 * ここが返す値以外に、課金で変わるものは無い ── 係数も倍率も上限も同じ。
 * 何本重ねても増えるのは日数だけで、1 日あたりに入る EXP は無料の人と同じ。
 */
export function reachFor(licenses, publicKeys = PUBLIC_KEYS) {
  // `all` の券だけは全期間。自分用と、詫びに配るぶん
  if (hasGrant(grantsFrom(licenses, publicKeys), GRANT_ALL)) {
    return { days: null, unlocked: true, keys: 0 };
  }
  const keys = countGrants(licenses, 'reach', publicKeys);
  return {
    days: FREE_DAYS + keys * REACH_DAYS_PER_KEY,
    unlocked: keys > 0,
    keys,
  };
}

/** 鍵を作る側（`scripts/license.mjs`）。秘密鍵はリポジトリに置かない。 */
export function signLicense(id, privateKeyPem) {
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) throw new Error('id は英数字と - _ の 6〜64 文字');
  const signature = crypto.sign(null, Buffer.from(id, 'utf8'), crypto.createPrivateKey(privateKeyPem));
  return `AIPET-${id}.${toBase64Url(signature)}`;
}
