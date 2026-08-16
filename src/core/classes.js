/**
 * 系統（クラス）。
 *
 * 見た目と将来の戦闘スタイルは、この 5 本のベクトルの「どれが伸びたか」で決まる。
 * ツールの使用分布そのものが個性になるので、ユーザーは育成のために
 * 特別な操作を一切しない ── 普通に Claude Code を使うだけ。
 */
export const CLASSES = {
  artisan: {
    ja: '職人',
    en: 'Artisan',
    hue: 24,
    tools: ['Bash', 'BashOutput', 'KillShell'],
    blurb: 'コマンドを叩いて手を動かす',
    blurbEn: 'Runs commands and works with their hands',
  },
  seeker: {
    ja: '探索者',
    en: 'Seeker',
    hue: 190,
    tools: ['WebSearch', 'WebFetch'],
    blurb: '外の世界を調べに行く',
    blurbEn: 'Goes out to find what is not here',
  },
  architect: {
    ja: '建築家',
    en: 'Architect',
    hue: 275,
    tools: ['Write', 'Edit', 'NotebookEdit'],
    blurb: 'コードを組み上げる',
    blurbEn: 'Builds the thing, line by line',
  },
  scholar: {
    ja: '学者',
    en: 'Scholar',
    hue: 130,
    tools: ['Read', 'Grep', 'Glob'],
    blurb: '読んで理解する',
    blurbEn: 'Reads until it makes sense',
  },
  commander: {
    ja: '統率者',
    en: 'Commander',
    hue: 340,
    tools: ['Task', 'Agent', 'Workflow'],
    blurb: '仲間を呼んで任せる',
    blurbEn: 'Calls in help and hands the work over',
  },
};

export const CLASS_IDS = Object.keys(CLASSES);

/** ツール名 → 系統。未知のツールは null（EXP は入るが系統は動かない）。 */
const TOOL_TO_CLASS = new Map();
for (const [id, def] of Object.entries(CLASSES)) {
  for (const tool of def.tools) TOOL_TO_CLASS.set(tool, id);
}

export function classForTool(toolName) {
  if (!toolName) return null;
  if (TOOL_TO_CLASS.has(toolName)) return TOOL_TO_CLASS.get(toolName);
  // mcp__github__create_issue のような MCP ツールは外部接触なので探索者に寄せる
  if (toolName.startsWith('mcp__')) return 'seeker';
  return null;
}

/**
 * 系統は Lv3 まで確定しない（それ未満は「見習い」）。
 * 確定後も分布が大きく傾けば乗り換わる ── 開発スタイルが変われば見た目も変わる。
 */
export const CLASS_UNLOCK_LEVEL = 3;

export function dominantClass(vector, level) {
  if (level < CLASS_UNLOCK_LEVEL) return null;
  let best = null;
  let bestScore = 0;
  for (const id of CLASS_IDS) {
    const score = vector[id] || 0;
    if (score > bestScore) {
      best = id;
      bestScore = score;
    }
  }
  return bestScore > 0 ? best : null;
}
