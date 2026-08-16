/**
 * 「その人にとっての今日」を決める。
 *
 * 成長のルールには**人間の 1 日**が 2 箇所で効いている ── 日次 EXP 上限の
 * 区切りと、夜更かし（0〜5 時）の判定。どちらも「機械のローカル時刻」で
 * 見ていたが、**Cloudflare Worker のローカル時刻は UTC** なので、PC と
 * サーバーで別の日を見ていた。
 *
 * 実際に起きたこと：日本時間の 9〜14 時（昼間）が Worker から見ると
 * 0〜5 時なので、**昼に働くほど「夜目」が育っていた**。判定が裏返っていた。
 *
 * 直し方はオフセットを外から渡せるようにするだけ。既定（null）は
 * これまでどおり機械のローカル時刻なので、PC 側の挙動は変わらない。
 */

/**
 * その時刻を「指定したオフセットの土地」で見たときの年月日と時。
 * offsetMinutes が null なら、動いている機械のローカル時刻で見る。
 */
export function partsFor(ts, offsetMinutes = null) {
  if (offsetMinutes === null || offsetMinutes === undefined || !Number.isFinite(offsetMinutes)) {
    const d = new Date(ts);
    return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), hour: d.getHours() };
  }
  // UTC に足してから UTC として読むと、その土地の壁時計になる
  const shifted = new Date(ts + offsetMinutes * 60000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
  };
}

/** 「2026-08-15」。日次 EXP 上限の区切りに使う。 */
export function dayKeyFor(ts, offsetMinutes = null) {
  const p = partsFor(ts, offsetMinutes);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** 20260815。その日の一戦の種に使う。 */
export function dayStampFor(ts, offsetMinutes = null) {
  const p = partsFor(ts, offsetMinutes);
  return p.year * 10000 + p.month * 100 + p.day;
}

/**
 * 1970-01-01 から数えた「その土地での日数」。連続した日が連続した整数になる。
 *
 * 20260815 のような日付印は日をまたぐと 20260901 のように飛ぶので、
 * 「今日は週の何日目か」を出すのに使えない。こちらは足し引きができる。
 */
export function dayNumberFor(ts, offsetMinutes = null) {
  const p = partsFor(ts, offsetMinutes);
  return Math.floor(Date.UTC(p.year, p.month - 1, p.day) / 86400000);
}

/**
 * 一戦の区切り。**1 日ではなく 2 時間ごと**に相手が変わる。
 *
 * 1 日 1 戦にしていた頃、昼に一度見たらその日はもう何も起きなかった
 * ── 眺めるものとしては静かすぎる。2 時間なら、席に戻るたびに
 * 「知らない間に一戦やっていた」がだいたい 1 回ある。
 *
 * **これも機械のローカル時刻を直接見ない。** Worker のローカルは UTC なので、
 * 見ないと PC とサーバーで別の一戦が出る（日次上限や夜更かしと同じ話）。
 */
export const BOUT_HOURS = 2;

/**
 * 1970-01-01 から数えた「その土地での一戦の通し番号」。
 * 連続した一戦が連続した整数になるので、足し引きができる。
 */
export function boutNumberFor(ts, offsetMinutes = null) {
  const p = partsFor(ts, offsetMinutes);
  const day = Math.floor(Date.UTC(p.year, p.month - 1, p.day) / 86400000);
  return day * (24 / BOUT_HOURS) + Math.floor(p.hour / BOUT_HOURS);
}

/** その一戦が始まった時刻（0, 2, 4 … 22）。夜更かし判定に使う。 */
export function boutHourFor(ts, offsetMinutes = null) {
  const p = partsFor(ts, offsetMinutes);
  return Math.floor(p.hour / BOUT_HOURS) * BOUT_HOURS;
}

/**
 * その一戦が始まった**実時刻**（ミリ秒）。「一戦が終わってから何分経ったか」を
 * 出すのに要る ── ケガ（appearance.js）は時間で勝手に治るので、経過が要る。
 *
 * `boutNumberFor` は通し番号、`boutHourFor` は壁時計の時。どちらも足し引きは
 * できても実時刻には戻せない（オフセットを掛け戻す必要がある）。
 */
export function boutStartFor(ts, offsetMinutes = null) {
  const p = partsFor(ts, offsetMinutes);
  const hour = Math.floor(p.hour / BOUT_HOURS) * BOUT_HOURS;
  if (offsetMinutes === null || offsetMinutes === undefined || !Number.isFinite(offsetMinutes)) {
    // 指定なしなら機械のローカル時刻。Date が夏時間ごと面倒を見てくれる
    return new Date(p.year, p.month - 1, p.day, hour).getTime();
  }
  // partsFor は「UTC に足して UTC として読む」ので、戻すときは引く
  return Date.UTC(p.year, p.month - 1, p.day, hour) - offsetMinutes * 60000;
}

/** 設定から読むときの窓口。数字にならないものは「指定なし」に倒す。 */
export function offsetFrom(value) {
  const n = Number(value);
  // ±14 時間より外は現実に存在しない。打ち間違いを黙って受けない。
  return Number.isFinite(n) && Math.abs(n) <= 14 * 60 ? n : null;
}

/**
 * その人にとっての「いま何時ごろか」。**背景の出し分けにだけ使う。**
 *
 * いちばん長く見ている画面は「何も起きていないオーバーレイ」なので
 * （DESIGN.md §5c）、そこが 1 日じゅう同じ色なのはもったいない。
 * 数字には一切効かない ── 効かせると「夜に働くと得」が生まれる。
 *
 * **機械のローカル時刻を直接見ない。** Worker のローカルは UTC なので、
 * 見ると PC とスマホで別の空になる（日次上限・夜更かしと同じ話）。
 */
export function skyFor(ts, offsetMinutes = null) {
  const h = partsFor(ts, offsetMinutes).hour;
  if (h < 5) return 'night';
  if (h < 8) return 'dawn';
  if (h < 16) return 'day';
  if (h < 19) return 'dusk';
  return 'night';
}

/** 付け替えのときに、前のぶんを外すための一覧。 */
export const SKIES = ['dawn', 'day', 'dusk', 'night'];
