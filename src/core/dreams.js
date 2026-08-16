/**
 * 夢 ── **眠っているあいだに、本当にあったことを見る。**
 *
 * ## なぜ寝言だけでは足りなかったか
 *
 * 寝言（sleeptalk.js）は「最後に動いた道具」から出るので、**その日のことしか
 * 言えない**。眠っている絵は静かでいいが、毎晩おなじ 3 通りだと、結局そこも
 * 止まって見える。
 *
 * 夢は**過去のほう**を向く ── 通ってきた職、越えてきた主、いま持っている
 * 道具、いちばん深く潜った階。どれも「この子が本当にやってきたこと」なので、
 * 出るたびに中身が違うし、長く一緒にいるほど夢の種類が増える。
 *
 * ## 何も足していない
 *
 * 見ているのは view が既に持っているものだけ（jobs / bosses / equipped /
 * floor）。**state にも events にも 1 バイトも足さない。**
 *
 * ## 責めない・急かさない
 *
 * 「まだ終わっていない仕事の夢」は入れない（DESIGN.md §5 の表現の線）。
 * 夢が催促になった瞬間、眠っている絵まで仕事の続きになる ── ここは
 * **過ぎたことを、静かに思い出しているだけ**の場所にする。
 */

/** 夢の材料。**新しいものから順に見る**（近い記憶ほど夢に出やすい）。 */
export const DREAM_KINDS = ['boss', 'job', 'gear', 'floor', 'badge'];

/**
 * いま見られる夢の種（`{ kind, ja }` の配列）。文にするのは view.js。
 *
 * `facts` … `{ jobs, bosses, equipped, floor, badges }`
 * どれも**表示用に解いたあとのもの**を渡す（ここで言語を触らない）。
 */
export function dreamSeeds(facts = {}) {
  const seeds = [];
  const bosses = facts.bosses || [];
  const jobs = facts.jobs || [];
  const equipped = facts.equipped || [];
  const badges = facts.badges || [];

  // 越えてきた主。いちばん珍しいので先に置く
  for (const boss of bosses.slice(0, 3)) {
    if (boss && boss.label) seeds.push({ kind: 'boss', ja: boss.label });
  }

  /*
   * 通ってきた職。**いまの職は入れない** ── 今日もそれをやっているものを
   * 夢に見ても、それは思い出ではない。
   */
  for (const job of jobs.slice(0, -1)) {
    if (job && job.label) seeds.push({ kind: 'job', ja: job.label });
  }

  // いま持っている道具
  for (const item of equipped) {
    if (item && item.label) seeds.push({ kind: 'gear', ja: item.label });
  }

  // いちばん深く潜った階。**1 階では出さない**（思い出になっていない）
  if (facts.floor >= 5) seeds.push({ kind: 'floor', ja: String(facts.floor) });

  // 獲った称号
  for (const badge of badges.slice(0, 3)) {
    if (badge && badge.label) seeds.push({ kind: 'badge', ja: badge.label });
  }

  return seeds;
}
