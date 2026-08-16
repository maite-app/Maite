/**
 * 寝言 ── **眠っているあいだに、たまに一言。**
 *
 * ## なぜ入れるのか
 *
 * 手が止まっている時間のほうが長い（DESIGN.md §5c）。眠っている絵は静かで
 * いいのだが、**眠りに入ったあとは何時間見ても同じ**で、そこだけ完全に
 * 止まっていた ── しぐさは足したが、しぐさは「動き」であって「その子らしさ」
 * ではない。
 *
 * 寝言なら、**直前に何をしていたかが寝顔に残る**。
 *
 * ## 中身は読まない
 *
 * 出どころは `lastTool`（どの道具が最後に動いたか）だけ。プロンプトも
 * コマンドも結果も見ていない ── **読まずに当てるから面白い**（DESIGN.md §8c
 * と同じ線）。だから寝言は「何をしていたか」までしか言えないし、
 * それでいい。
 *
 * ## 責めない・急かさない
 *
 * 「まだ終わってない」「早く直して」の類は入れない（DESIGN.md §5 の表現の線）。
 * 寝言が催促になった瞬間、静かな画面が仕事の続きになる。
 */

/** 道具の系統ごとの寝言。id は i18n の `sleep.<id>` に対応する。 */
export const SLEEP_LINES = {
  build: ['sleep.build1', 'sleep.build2'],
  read: ['sleep.read1', 'sleep.read2'],
  write: ['sleep.write1', 'sleep.write2'],
  out: ['sleep.out1'],
  plain: ['sleep.plain1', 'sleep.plain2', 'sleep.plain3'],
};

/** 道具を系統に寄せる。知らない道具は素の寝言に落とす。 */
export function familyOf(tool) {
  if (!tool) return 'plain';
  if (tool === 'Bash' || tool === 'BashOutput') return 'build';
  if (tool === 'Read' || tool === 'Grep' || tool === 'Glob') return 'read';
  if (tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit') return 'write';
  if (tool === 'WebSearch' || tool === 'WebFetch' || tool.startsWith('mcp__')) return 'out';
  return 'plain';
}

/**
 * いま出しうる寝言の id。**素の寝言は必ず混ぜる** ── 道具の寝言しか出ないと、
 * 毎晩ぴったり同じことを言う子になる。
 */
export function sleepTalkFor(lastTool) {
  const family = familyOf(lastTool);
  if (family === 'plain') return [...SLEEP_LINES.plain];
  return [...SLEEP_LINES[family], ...SLEEP_LINES.plain];
}
