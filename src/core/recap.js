/**
 * ふりかえり ── **ひと月ぶんを、1 枚にまとめて返す。**
 *
 * ## なぜ要るのか
 *
 * 育つのは分単位・日単位なので、**眺めているあいだは何も起きていないように
 * 見える。** 「この 2 週間」の棒は出しているが、あれは今の調子を見るもので、
 * 「ここまで来た」を見せるものではない。
 *
 * 放置で育つのが芯なら、**ときどき「こんなに積んだ」を返す**のが、いちばん
 * 素直な見返りになる。
 *
 * ## 目標にしない
 *
 * **後ろ向きにしか書かない。** 出すのは「あった」ことだけで、目安も、次の
 * 目標も、前月との勝ち負けも出さない ── 「先月より少ない」と書いた瞬間、
 * それは追い立てになる（DESIGN.md §5b）。
 *
 * **連続日数も出さない。** 出すと「途切れさせないために開く」が生まれる
 * ── 実績で禁じているのと同じ理由（HANDOFF §2g）。
 *
 * ## 何も保存しない
 *
 * 材料は `state.days`（growth.js が畳む途中で刻んでいる 40 日ぶん）だけ。
 * **ここが増えても state は 1 バイトも増えない。**
 */

import { dayKeyFor, dayNumberFor } from './clock.js';

/** ふりかえりが見る日数。 */
export const RECAP_DAYS = 30;

/**
 * 直近 `RECAP_DAYS` 日のまとめ。まだ足りなければ null。
 *
 * `days` … `state.days`（`{ '2026-08-15': { exp, tools, prompts, sessions } }`）
 *
 * **手を動かした日が 5 日に満たないうちは返さない** ── 始めたばかりの人に
 * 「30 日で 2 日でした」と返すのは、まとめではなくただの成績表になる。
 */
export function recapFor(days, now, tzOffset = null) {
  if (!days) return null;

  const today = dayNumberFor(now, tzOffset);
  const from = today - (RECAP_DAYS - 1);

  const inRange = Object.entries(days)
    .map(([key, value]) => ({ key, ...value, n: dayNumberOf(key) }))
    .filter((day) => day.n >= from && day.n <= today)
    .sort((a, b) => a.n - b.n);

  const worked = inRange.filter((day) => (day.exp || 0) > 0);
  if (worked.length < 5) return null;

  const sum = (pick) => worked.reduce((acc, day) => acc + (day[pick] || 0), 0);

  // いちばん多かった日。**同点なら新しいほう**（古い自慢を掘り返さない）
  let best = worked[0];
  for (const day of worked) if ((day.exp || 0) >= (best.exp || 0)) best = day;

  return {
    days: RECAP_DAYS,
    from: dayKeyFor(now - (RECAP_DAYS - 1) * 86400000, tzOffset),
    to: dayKeyFor(now, tzOffset),
    workedDays: worked.length,
    exp: sum('exp'),
    tools: sum('tools'),
    prompts: sum('prompts'),
    sessions: sum('sessions'),
    best: { day: best.key, exp: best.exp || 0, tools: best.tools || 0 },
  };
}

/** 「2026-08-15」を、足し引きできる日数に直す。 */
function dayNumberOf(key) {
  const [y, m, d] = String(key).split('-').map(Number);
  if (!y || !m || !d) return -1;
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}
