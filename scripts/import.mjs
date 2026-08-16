#!/usr/bin/env node
/**
 * hook を入れる前の作業を、遡って取り込む。
 *
 * Claude Code は全セッションの記録を ~/.claude/projects に残している。
 * つまり aipet を入れる前の数ヶ月ぶんが、もう手元にある。畳めば
 * **実際に働いた通りのレベル**から始められる。
 *
 *   node scripts/import.mjs --dry        # 何が入るか見るだけ（既定）
 *   node scripts/import.mjs --write      # 実際に取り込む
 *   node scripts/import.mjs --write --days 30
 *
 * **遡れる範囲だけが課金の対象**（DESIGN.md §6b / src/core/license.js）。
 * 無料は直近 30 日、鍵があれば全期間。ここで変わるのは**入れるログの範囲**
 * だけで、畳み方も係数も全員同じ ── 同じログを入れたら同じレベルが出る。
 *
 * **取り込むのは派生値だけ**（src/core/transcripts.js）。記録にはプロンプト
 * 本文もツールの引数もパスも入っているが、hook が書くのと同じ
 * 「時刻・種別・ツール名・成否・ハッシュ」しか出てこない。
 *
 * **既存のイベントより古いものだけ入れる。** hook が既に書いたぶんと重なる
 * 期間を入れると二重に数えてしまう。境界より新しいものは黙って捨てる。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { eventsFromTranscript } from '../src/core/transcripts.js';
import { emptyState, applyEvents } from '../src/core/growth.js';
import { ROOT, EVENTS_FILE, STATE_FILE, CURSOR_FILE, PUSH_CURSOR_FILE } from '../src/core/paths.js';
import { loadConfig } from '../src/core/config.js';
import { FREE_DAYS, REACH_DAYS_PER_KEY } from '../src/core/license.js';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
};
const write = args.includes('--write');
const days = Number(flag('days')) || 0;
const SOURCE = process.env.CLAUDE_HOME || path.join(os.homedir(), '.claude', 'projects');
const hash = (value) => crypto.createHash('sha1').update(value).digest('hex').slice(0, 8);

function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.jsonl')) out.push(full);
  }
  return out;
}

function readExisting() {
  try {
    return fs
      .readFileSync(EVENTS_FILE, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

const files = walk(SOURCE);
if (!files.length) {
  console.error(`× 記録が見つかりませんでした: ${SOURCE}`);
  process.exit(0);
}

let found = [];
for (const file of files) {
  found.push(...eventsFromTranscript(fs.readFileSync(file, 'utf8'), hash));
}
found.sort((a, b) => a.t - b.t);

/*
 * 遡れる範囲。**--days を明示すればそれが勝つ**（狭めるぶんには誰でもできる）。
 * 指定が無ければ、鍵の有無で決まる ── 無料は直近 30 日、鍵があれば全期間。
 */
const reach = loadConfig().reach;
const limitDays = days > 0 ? days : reach.days;

let beyond = [];
if (limitDays) {
  const from = Date.now() - limitDays * 86400000;
  beyond = found.filter((e) => e.t < from);
  found = found.filter((e) => e.t >= from);
}

const existing = readExisting();
// 二重に数えないよう、既にあるログの先頭より古いものだけ入れる
const boundary = existing.length ? existing[0].t : Infinity;
const fresh = found.filter((e) => e.t < boundary);
const skipped = found.length - fresh.length;

const day = (t) => new Date(t).toISOString().slice(0, 10);
console.log(`記録 ${files.length} 本から ${found.length.toLocaleString('ja-JP')} 件`);
if (fresh.length) console.log(`  取り込む: ${fresh.length.toLocaleString('ja-JP')} 件（${day(fresh[0].t)} 〜 ${day(fresh[fresh.length - 1].t)}）`);
if (skipped) console.log(`  重なるので見送る: ${skipped.toLocaleString('ja-JP')} 件（${day(boundary)} 以降は hook が既に記録済み）`);
if (existing.length) console.log(`  いまある記録: ${existing.length.toLocaleString('ja-JP')} 件`);

/*
 * 範囲の外に何が残っているか。**一度だけ、事実として出す。**
 *
 * 出さないと「30 日ぶんしか無かった」と誤解されるし、毎回出したり
 * オーバーレイに出したりすれば、それは催促になる（DESIGN.md §3, §5）。
 * ここは自分で叩いたときにだけ動くコマンドなので、1 行だけ添える。
 */
if (beyond.length) {
  const months = Math.max(1, Math.round((Date.now() - beyond[0].t) / (30 * 86400000)));
  console.log(
    `\n  いま遡れるのは直近 ${limitDays} 日ぶん。それより前に ${beyond.length.toLocaleString('ja-JP')} 件（約 ${months} ヶ月ぶん）残っています`,
  );
  console.log(`  鍵 1 本で、さらに ${REACH_DAYS_PER_KEY} 日ぶん遡れます（node scripts/license.mjs status）`);
} else if (reach.days === null) {
  console.log('\n  引き換え券あり ── 全期間を遡ります');
} else if (reach.unlocked) {
  console.log(`\n  鍵 ${reach.keys} 本 ── 直近 ${reach.days} 日ぶんまで遡りました`);
}

if (!fresh.length) {
  console.log('\n入れるものがありません。');
  process.exit(0);
}

const merged = [...fresh, ...existing].sort((a, b) => a.t - b.t);
const after = applyEvents(emptyState(merged[0].t), merged);
const before = existing.length ? applyEvents(emptyState(existing[0].t), existing) : emptyState(Date.now());

console.log(`\n  Lv${before.level} → Lv${after.level}（EXP ${before.exp.toLocaleString('ja-JP')} → ${after.exp.toLocaleString('ja-JP')}）`);
console.log(`  ツール ${before.traits.toolCalls.toLocaleString('ja-JP')} → ${after.traits.toolCalls.toLocaleString('ja-JP')} 回`);
console.log(`  セッション ${before.traits.sessions} → ${after.traits.sessions} 本`);

if (!write) {
  console.log('\n（見ているだけです。実際に入れるなら --write）');
  process.exit(0);
}

fs.mkdirSync(ROOT, { recursive: true });
if (fs.existsSync(EVENTS_FILE)) {
  const backup = `${EVENTS_FILE}.before-import`;
  fs.copyFileSync(EVENTS_FILE, backup);
  console.log(`\n元のログを ${backup} に控えました`);
}

// 時刻順に書き直す。日次 EXP 上限は日付をまたいで効くので、順序が崩れると数字が変わる
fs.writeFileSync(EVENTS_FILE, merged.map((e) => JSON.stringify(e)).join('\n') + '\n');

// 畳んだ結果と読み位置は捨てる。次の起動が全部を畳み直す
fs.rmSync(STATE_FILE, { force: true });
fs.rmSync(CURSOR_FILE, { force: true });

// 送信位置も戻す。**ここを消し忘れると、取り込んだ過去はスマホに一生届かない**
// ── 送信は「何行目まで送ったか」で進むので、頭に 3 万件を挿し込むと、
// その 3 万件はもう送信済みの範囲に入ってしまう。PC だけ Lv30、スマホは Lv4 のまま。
// 送り直しても i（イベント ID）でサーバー側が重複を弾くので、二重には数えない。
fs.rmSync(PUSH_CURSOR_FILE, { force: true });

console.log(`✓ ${merged.length.toLocaleString('ja-JP')} 件を ${EVENTS_FILE} に書きました`);
console.log('  次にオーバーレイを起動すると、全部畳み直して Lv が付き直します');
