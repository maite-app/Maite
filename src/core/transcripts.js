/**
 * Claude Code の会話記録（`~/.claude/projects/**\/*.jsonl`）から、
 * aipet の events.jsonl と同じ形の**派生値だけ**を取り出す。
 *
 * 使い道は 2 つあって、どちらも同じ関数で足りる。
 *
 *   1. バランス調整のための実測（scripts/usage.mjs）
 *   2. hook を入れる前の作業を遡って取り込む
 *
 * **中身は一切持ち出さない。** 記録にはプロンプト本文もツールの引数も
 * ファイルパスも入っているが、ここが返すのは hook が書くのと同じ
 * 「時刻・種別・ツール名・成否・ハッシュ」だけ（DESIGN.md §2b 原則 1）。
 * 取り込みでルールが緩むと、プライバシーの主張がそこから崩れる。
 *
 * ハッシュ関数は引数で受け取る。ここに node:crypto を持ち込むと、
 * Worker から import できるファイルとの間に依存の差が出る。
 */

/** tool_result の中身は見ない。成否だけ拾う。 */
function resultsById(entries) {
  const out = new Map();
  for (const entry of entries) {
    const content = entry?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part?.type === 'tool_result' && part.tool_use_id) {
        out.set(part.tool_use_id, part.is_error !== true);
      }
    }
  }
  return out;
}

/** ユーザーの入力か（tool_result だけの user 行は「指示」ではない）。 */
function isRealPrompt(entry) {
  if (entry?.type !== 'user') return false;
  const content = entry?.message?.content;
  if (typeof content === 'string') return content.length > 0;
  if (!Array.isArray(content)) return false;
  return content.some((part) => part?.type === 'text' || typeof part === 'string');
}

/**
 * 記録 1 本 → イベントの配列。行の JSON はここで捨て、派生値だけ残す。
 *
 * hash は (文字列) => 短い文字列。呼び出し側が SHA-1 の先頭 8 文字などを渡す。
 */
export function eventsFromTranscript(text, hash = (s) => s) {
  const entries = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // 途中で切れた行。読めるところまでで十分。
    }
  }

  const results = resultsById(entries);
  const events = [];

  for (const entry of entries) {
    const t = Date.parse(entry?.timestamp || '');
    if (!Number.isFinite(t)) continue;
    const s = entry.sessionId ? hash(entry.sessionId) : undefined;
    const p = entry.cwd ? hash(entry.cwd) : undefined;

    if (isRealPrompt(entry)) {
      events.push({ t, e: 'UserPromptSubmit', s, p });
      continue;
    }

    const content = entry?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part?.type !== 'tool_use') continue;
      const ok = results.has(part.id) ? results.get(part.id) : true;
      events.push({ t, e: 'PostToolUse', s, p, tool: part.name, ok });
    }
  }

  // 1 本の記録の中でも、サブエージェントぶんが前後することがある
  events.sort((a, b) => a.t - b.t);
  return events;
}
