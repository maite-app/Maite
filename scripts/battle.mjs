#!/usr/bin/env node
/**
 * 開発用。今日の 1 戦をターミナルに出す。
 *
 * Phase 1 で確かめたいのは「戦闘ログが面白いか」だけ（DESIGN.md §7）。
 * それを見るために Electron を起動する必要は無いし、環境によっては起動できない。
 *
 *   node scripts/battle.mjs                        # 手元の state で今日の 1 戦
 *   node scripts/battle.mjs --level 12             # Lv12 の架空の個体で見る
 *   node scripts/battle.mjs --level 20 --class seeker --days 5
 *   node scripts/battle.mjs --level 12 --skills    # 生えているスキルも出す
 *
 * AIPET_HOME を指定すれば本番のデータに触らずに試せる。
 */
import { emptyState, totalExpForLevel } from '../src/core/growth.js';
import { loadState } from '../src/core/state.js';
import { CLASSES, CLASS_IDS } from '../src/core/classes.js';
import { skillsFor } from '../src/core/skills.js';
import { fighterFrom } from '../src/core/fighter.js';
import { dailyBattle, BATTLE_UNLOCK_LEVEL } from '../src/core/battle.js';
import { battleLines } from '../src/core/view.js';

const args = process.argv.slice(2);

function flag(name, fallback = null) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
}

const DAY = 24 * 60 * 60 * 1000;
const level = Number(flag('level')) || 0;
const days = Number(flag('days')) || 1;
const classId = CLASS_IDS.includes(flag('class')) ? flag('class') : 'artisan';

/**
 * 架空の個体。実データを何日も貯めずに戦闘だけ見るための土台。
 * traits はレベルに対してそれっぽい量を入れておく（スキルが生える程度）。
 */
function previewState(lv, cid) {
  const state = emptyState(Date.now());
  state.exp = totalExpForLevel(lv);
  state.level = lv;
  state.classId = lv >= 3 ? cid : null;
  state.seed = 4242;
  state.classVector[cid] = lv * 20;
  state.classVector.commander = Math.round(lv * 1.5);
  state.classVector.seeker = Math.round(lv * 2.5);
  state.traits = {
    ...state.traits,
    toolCalls: lv * 25,
    prompts: lv * 4,
    sessions: lv,
    failures: lv * 3,
    comebacks: lv * 2,
    nightOwl: lv * 2,
    compacts: Math.floor(lv / 4),
  };
  return state;
}

const state = level > 0 ? previewState(level, classId) : loadState();
const you = fighterFrom(state);

console.log(
  `${you.name}  Lv${you.level}  ${you.class ? CLASSES[you.class].ja : '見習い'}` +
    `  atk${you.stats.atk} def${you.stats.def} spd${you.stats.spd}`,
);

if (args.includes('--skills')) {
  const skills = skillsFor(state);
  if (!skills.length) console.log('  スキル: まだ無い');
  for (const s of skills) console.log(`  ${s.ja} ${'★'.repeat(s.tier)}  ${s.blurb}`);
}

if (you.level < BATTLE_UNLOCK_LEVEL) {
  console.log(`\nLv${BATTLE_UNLOCK_LEVEL} になるまで練習試合は始まらない。`);
  process.exit(0);
}

for (let d = 0; d < days; d += 1) {
  const now = Date.now() + d * DAY;
  const battle = dailyBattle(state, now);
  const date = new Date(now).toLocaleDateString('ja-JP');

  console.log(
    `\n── ${date}  vs ${battle.opponent.name} Lv${battle.opponent.level}` +
      `（${battle.practice ? '練習相手' : 'ゴースト'}）${battle.night ? ' · 未明' : ''}`,
  );
  for (const line of battleLines(battle)) console.log(`   ${line}`);
  console.log(`   ${battle.turns} ターン`);
}
