/**
 * 箪笥 ── 「どれを着られるか」を鍵から決める。
 *
 * **skins.js と分けてある。** 鍵の検証は Ed25519 で `node:crypto` が要り、
 * Worker は標準では持っていない。`view.js → skins.js` の線に混ぜると
 * **本番が起動時に落ちる**（`wrangler deploy --dry-run` が nodejs_compat を
 * 要求して発覚した）。
 *
 * だから確かめる場所を PC の 1 箇所に寄せた ── PC が着るものを決めて、
 * その id だけをサーバーに送る。サーバーは id を絵に落とすだけで、鍵を
 * 見る必要がそもそも無い（`look:<key>` に書けるのはトークンを持っている
 * 本人だけなので、境界はそちら側にある）。
 *
 * **このファイルを view.js から import しない。**
 */
import { label, blurb } from './i18n.js';
import { grantsFrom, hasGrant } from './license.js';
import { SKINS, SKIN_BY_ID, DEFAULT_SKIN } from './skins.js';

/** 鍵で開く名前。`skin_ember` のような形（license.js の grantOf）。 */
export function grantForSkin(id) {
  return `skin_${id}`;
}

/** 着られるか。無料のものは常に、それ以外は鍵があるとき。 */
export function canWear(id, grants) {
  const skin = SKIN_BY_ID[id];
  if (!skin) return false;
  return Boolean(skin.free) || hasGrant(grants, grantForSkin(id));
}

/**
 * いま着ているスキン。**着られないものを指していたら既定に戻す。**
 *
 * 鍵を外したときに「見た目だけ残る」ようにはしない ── 残すと、鍵の意味が
 * 「一度買えば設定ファイルを配れる」に変わる。逆に、指定が壊れていても
 * 落とさない（設定を手で書いて起動しなくなるほうが困る）。
 */
export function skinFor(config = {}, publicKeys = undefined) {
  const grants = grantsFrom(config.licenses ?? config.license ?? [], publicKeys);
  const wanted = typeof config.skin === 'string' ? config.skin : DEFAULT_SKIN;
  return SKIN_BY_ID[canWear(wanted, grants) ? wanted : DEFAULT_SKIN];
}

/** 表示用。着られないものも**名前だけは出す**（何が売っているか分からないと選べない）。 */
export function skinList(config = {}, lang = 'ja', publicKeys = undefined) {
  const grants = grantsFrom(config.licenses ?? config.license ?? [], publicKeys);
  const current = skinFor(config, publicKeys).id;
  return SKINS.map((skin) => ({
    id: skin.id,
    label: label(skin, lang),
    blurb: blurb(skin, lang),
    free: Boolean(skin.free),
    owned: canWear(skin.id, grants),
    current: skin.id === current,
  }));
}
