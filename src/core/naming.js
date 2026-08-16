/**
 * 名前。
 *
 * **名前は 1 つだけ。型（persona.js）から出た職が、そのままこの子の名前になる。**
 *
 * 前は 3 つ並べていた ── 種から決まる現実の職（大工・灯台守）、系統（学者）、
 * 型から出た二つ名（魔道書士）。全部それらしい肩書きなので、**どれがこの子の
 * 名前なのか読めなかった**。名前を型に一本化すると、
 *
 *   - 名前を見ればどう働いているかが分かる
 *   - 働き方が変われば**名前のほうが変わる**（放っておくと知らない間に変わっている）
 *
 * 引き換えに、種から決まる「その子だけの名前」は無くなった。同じ働き方の人は
 * 同じ名前になる ── 自分だけの名前が欲しい人は付け替える（`scripts/name.mjs`）。
 *
 * **起動時に名前は訊かない**（DESIGN.md §1）。入力欄を出した瞬間、起動直後に
 * 「まず名前を決めてください」という手続きが生まれる。付けたい人だけが後から付ける。
 * 付け替えた名前は成長の記録ではないので state ではなく設定に置く
 * （state に入れると、ルールを変えて畳み直すたびに消える）。
 */

import { label } from './i18n.js';
import { TYPES } from './persona.js';

/** 型が決まるまでの呼び名。まだ何者でもない。 */
export const NOVICE = { ja: '見習い', en: 'Novice' };

/** 付け替えた名前の長さの上限。長いと Lv と並んだときに画面からはみ出す。 */
export const NAME_MAX = 16;

/**
 * 付け替えた名前を、置いていい形に整える。おかしければ null（＝既定に戻る）。
 *
 * 改行やタブが混ざると表示が崩れるので落とす。中身は本人が決めたものなので、
 * 文字そのものには口を出さない。
 */
export function sanitizeName(value) {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!clean) return null;
  return [...clean].slice(0, NAME_MAX).join('');
}

/**
 * 表に出る名前。付け替えた名前があれば、そちらが勝つ。
 *
 * persona は persona.js の戻り値。まだ名乗れない（母数が足りない）うちは「見習い」。
 */
export function nameFor(persona, override = null, lang = 'ja') {
  const named = sanitizeName(override);
  if (named) return named;
  if (persona && persona.settled) {
    /*
     * **型そのものから引き直す。** view が言語に落とした persona（`label` 付き）で
     * 呼ばれることも、生の persona で呼ばれることも（fighter.js）あるので、
     * `label` が無ければ TYPES を引く ── ここを `persona.ja` に落としていた頃、
     * 英語の画面でも戦闘ログの中の自分の名前だけが日本語だった。
     */
    return persona.label || label(TYPES[persona.key], lang);
  }
  return NOVICE[lang] || NOVICE.ja;
}
