/**
 * 記念日 ── **一緒にいた長さだけで決まる、年に数回の一言。**
 *
 * ## なぜ入れるのか
 *
 * 育つものは全部「働いた量」から出ている（それが芯）。だから**何もしなくても
 * 積み上がるもの**が 1 つも無くて、休んでいた期間はまるごと空白だった
 * ── 使い込みの傷（appearance.js）と同じで、離れていた時間も一緒にいた時間の
 * うちに入れておきたい。
 *
 * ## 目標にならないようにする
 *
 * 実績（achievements.js）に置かなかったのは、**日数は狙って詰められるものでは
 * ない**割に、一覧に並ぶと「あと何日」が見えてしまうから ── 期限・連続日数・
 * 進捗バーを付けた瞬間にデイリーミッションになる（DESIGN.md §5b）。
 *
 * ここが返すのは**その日に出る一言だけ**で、次がいつかは出さない。
 * 数にも入らないし、逃しても何も減らない。
 *
 * ## 連続日数ではない
 *
 * 見ているのは `bornAt` からの経過日数だけ。**休んだ日も数える**ので、
 * 「途切れさせないために開く」が起きない。
 */

import { dayNumberFor } from './clock.js';

/**
 * 節目の日数。**ここから先は 1 年ごと**（`days % 365`）。
 *
 * 30 日を最初に置いたのは、使い込みの 1 段目（PATINA_DAYS の 30）と揃えるため
 * ── 「使い込まれてきた日に、一言あった」が重なっていないと、どちらも薄くなる。
 */
export const MILESTONE_DAYS = [30, 100, 200, 500, 1000];

/**
 * 今日が記念日なら `{ days, years }`、そうでなければ null。
 *
 * `years` は 1 年ちょうどの節目のときだけ入る（それ以外は null）。
 * **機械のローカル時刻を直接見ない** ── 日付の区切りは clock.js を通す
 * （Worker のローカルは UTC。CLAUDE.md）。
 */
export function anniversaryFor(bornAt, now, tzOffset = null) {
  if (!bornAt || !Number.isFinite(bornAt)) return null;
  const days = dayNumberFor(now, tzOffset) - dayNumberFor(bornAt, tzOffset);
  if (days <= 0) return null;
  if (days % 365 === 0) return { days, years: days / 365 };
  if (MILESTONE_DAYS.includes(days)) return { days, years: null };
  return null;
}
