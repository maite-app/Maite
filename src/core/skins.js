/**
 * スキン ── 見た目の重ね着。
 *
 * **数字に一切触らない**（DESIGN.md §6c）。EXP もステータスも技も装備も、
 * スキンで 1 も動かない ── §1（戦闘力の出どころは作業ログ）を崩さないための線で、
 * ここが緩んだ瞬間「課金で強くなる」になる。
 *
 * **別のキャラにしない。** この子は自分の働き方から出てきた個体なので、
 * 着せ替えで別物になったら愛着の土台が消える。だから触るのは 3 枚だけ：
 *
 *   1. 色（`tokens`）      … CSS の変数を差し替える。系統色（--hue）を上書きするかは
 *                            スキンごとに選ぶ ── 上書きしないスキンは、系統の色が
 *                            そのまま透ける（「働き方が色に出る」を残せる）
 *   2. 模様（`texture`）   … 体の上に薄く重ねる 1 枚。体の形に切り抜かれる
 *   3. 小物（`trinket`）   … 体に付く小さいもの 1 つ
 *
 * **顔つきには触らない**（§8c）。目つきと口元は型（persona.js）が決めるもので、
 * そこを買えるようにすると「働き方が顔に出る」がお金で上書きできてしまう。
 *
 * 選んだスキンは state ではなく設定に置く（名前や言語と同じ）── 成長の記録では
 * ないので、畳み直しで消えては困る。
 */
import { label, blurb } from './i18n.js';

/*
 * **鍵を確かめるのは PC だけ。**
 *
 * 鍵の検証は Ed25519（`license.js`）で、`node:crypto` が要る。Worker は
 * 標準では持っていないので、view から辿れる場所に置くと**本番が起動時に
 * 落ちる**（`wrangler deploy --dry-run` が nodejs_compat を要求して発覚した）。
 *
 * 直し方は「サーバーにも crypto を積む」ではなく、**確かめる場所を 1 つに
 * する**ほう ── PC が着るものを決めて、その id だけを送る。サーバーは
 * 送られてきた id を絵に落とすだけで、鍵を見る必要がそもそも無い
 * （書き込めるのはトークンを持っている本人だけなので、境界はそちら側にある）。
 *
 *   PC        wardrobe.js の skinFor(config) … 鍵を見て決める
 *   Worker    このファイルの skinById(id)      … 引くだけ（crypto を触らない）
 *
 * **このファイルから license.js を import しない。** すると view.js 経由で
 * Worker に crypto が入り、そこで本番が落ちる。鍵の要る関数は wardrobe.js。
 */

/**
 * 並び順がそのまま画面の並び。**既定（`plain`）を先頭から動かさない。**
 *
 * `free: true` は誰でも着られる。1 枚だけ無料の色違いを置いてあるのは、
 * 着替えられること自体が伝わらないと、有料のほうも存在に気づかれないから。
 *
 * `hue` を持たないスキンは、**系統の色をそのまま通す** ── 学者は緑、
 * 職人は橙のまま、質感だけが変わる。
 */
export const SKINS = [
  {
    id: 'plain',
    ja: '素',
    en: 'Plain',
    blurb: '生まれたままの姿　系統の色がそのまま出る',
    blurbEn: 'As it was born. The class colour shows through',
    free: true,
    tokens: {},
  },
  {
    id: 'mono',
    ja: '墨',
    en: 'Sumi',
    blurb: '色を落として 輪郭だけで見せる',
    blurbEn: 'Colour drained; only the outline speaks',
    free: true,
    tokens: { sat: '6%', light: '58%', darkLight: '34%' },
    texture: 'grain',
  },
  {
    id: 'ember',
    ja: '熾火',
    en: 'Ember',
    blurb: '消えかけて まだ熱い',
    blurbEn: 'Almost out, still hot',
    tokens: { hue: 16, sat: '72%', light: '58%', darkLight: '34%', ink: 'hsl(14 60% 16%)' },
    texture: 'ember',
    trinket: 'spark',
  },
  {
    id: 'frost',
    ja: '霜',
    en: 'Frost',
    blurb: '朝いちばんの 白い息',
    blurbEn: 'The first white breath of the morning',
    tokens: { hue: 196, sat: '55%', light: '72%', darkLight: '48%', ink: 'hsl(205 45% 24%)' },
    texture: 'frost',
    trinket: 'breath',
  },
  {
    id: 'dusk',
    ja: '宵',
    en: 'Dusk',
    blurb: '日が落ちてから いちばん捗る',
    blurbEn: 'Gets going once the sun is down',
    tokens: { hue: 268, sat: '48%', light: '52%', darkLight: '30%', ink: 'hsl(265 40% 88%)' },
    texture: 'stars',
    trinket: 'moth',
  },
];

export const SKIN_IDS = SKINS.map((s) => s.id);
export const SKIN_BY_ID = Object.fromEntries(SKINS.map((s) => [s.id, s]));
export const DEFAULT_SKIN = 'plain';

/** id を引くだけ。**鍵を見ない**ので Worker からも呼べる。 */
export function skinById(id) {
  return SKIN_BY_ID[typeof id === 'string' ? id : ''] || SKIN_BY_ID[DEFAULT_SKIN];
}

/**
 * 描画側に渡す 1 枚ぶん。CSS のクラス名と、色の差し替えだけ。
 *
 * **受け取るのは「もう決まった id」。** 鍵を見るのは呼ぶ側（PC）の仕事で、
 * ここでは見ない ── 上の注記のとおり、Worker に crypto を持ち込まないため。
 */
export function skinView(id, lang = 'ja') {
  const skin = skinById(id);
  return {
    id: skin.id,
    label: label(skin, lang),
    blurb: blurb(skin, lang),
    // 系統の色を上書きするか。しないスキンは、働き方の色がそのまま透ける
    keepsClassHue: skin.tokens.hue === undefined,
    tokens: skin.tokens,
    texture: skin.texture || null,
    trinket: skin.trinket || null,
  };
}
