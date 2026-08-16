import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { emptyState, applyEvent } from '../src/core/growth.js';
import { viewModel } from '../src/core/view.js';
import { normalizeLang, t, label, blurb, chrome, MESSAGE_IDS, LANGS } from '../src/core/i18n.js';
import { FINDS, HAPPENINGS } from '../src/core/expedition.js';
import { GEAR, BOSSES } from '../src/core/dungeon.js';
import { TYPES, AXES } from '../src/core/persona.js';
import { SKILLS } from '../src/core/skills.js';
import { CLASSES } from '../src/core/classes.js';
import { ACHIEVEMENTS } from '../src/core/achievements.js';

const T0 = new Date('2026-08-13T09:00:00').getTime();
const CJK = /[　-ヿ㐀-䶿一-鿿＀-￯]/;

/** そこそこ育った個体を作る（技も実績も戦闘も出る状態）。 */
function grown() {
  let state = emptyState(T0);
  for (let d = 0; d < 20; d += 1) {
    const start = T0 + d * 86400000;
    state = applyEvent(state, { t: start, e: 'UserPromptSubmit', s: `d${d}` });
    for (let i = 0; i < 200; i += 1) {
      const tool = ['Read', 'Grep', 'Bash', 'Edit', 'Task', 'WebSearch'][i % 6];
      const t2 = start + i * 20000;
      state = applyEvent(state, { t: t2, e: 'PostToolUse', s: `d${d}`, tool, ok: i % 9 !== 0 });
      if (i % 9 === 0) state = applyEvent(state, { t: t2 + 1000, e: 'PostToolUse', s: `d${d}`, tool, ok: true });
      if (i % 20 === 19) state = applyEvent(state, { t: t2 + 500, e: 'UserPromptSubmit', s: `d${d}` });
    }
  }
  return state;
}

/** view の中の文字列を、どこにあったかが分かる形で全部拾う。 */
function strings(value, path = '', out = []) {
  if (typeof value === 'string') out.push([path, value]);
  else if (Array.isArray(value)) value.forEach((v, i) => strings(v, `${path}[${i}]`, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) strings(v, path ? `${path}.${k}` : k, out);
  }
  return out;
}

test('言語の指定は地域つきでも通り、知らない言語は既定に落ちる', () => {
  assert.equal(normalizeLang('en-US'), 'en');
  assert.equal(normalizeLang('ja_JP'), 'ja');
  assert.equal(normalizeLang('EN'), 'en');
  assert.equal(normalizeLang('fr-FR'), 'ja');
  for (const bad of [null, undefined, 42, {}, '']) assert.equal(normalizeLang(bad), 'ja');
});

test('英語で見たら、画面に日本語が一文字も出ない', () => {
  // **これが英語対応の本体。** 一箇所でも `ja` を直に読んでいると、
  // そこだけ日本語のまま出る ── 実際に起きたので、まとめて縛る。
  const view = viewModel(grown(), T0 + 20 * 86400000, { lang: 'en' });

  // 読み（yomi）は日本語の名前を読むためのもので、英語では画面に出さない
  const allowed = new Set(['persona.yomi', 'persona.rhythm.yomi']);

  const leaks = strings(view)
    .filter(([path]) => !allowed.has(path) && !/\.yomi$/.test(path))
    .filter(([, value]) => CJK.test(value));

  assert.deepEqual(leaks, [], `英語の画面に日本語が残っている:\n${leaks.map(([p, v]) => `  ${p} = ${v}`).join('\n')}`);
});

test('日本語で見たら、いままでどおり日本語が出る', () => {
  const view = viewModel(grown(), T0 + 20 * 86400000, { lang: 'ja' });
  assert.ok(CJK.test(view.persona.label));
  assert.ok(CJK.test(view.text['panel.today']));
  assert.ok(view.skills.length > 0);
  for (const skill of view.skills) assert.ok(CJK.test(skill.label), `${skill.id} が日本語になっていない`);
});

test('文言はどの言語でも同じ ID が揃っている', () => {
  // 片方にしか無い ID は、その言語でだけ英語（または日本語）が出る事故になる
  // どの ID にも渡る、当たり障りのない差し込み一式（log.matchup だけ形が違う）
  const params = {
    n: 1, name: 'x', className: 'y', who: 'a', other: 'b', amount: 1, hp: 1,
    into: 1, span: 2, day: 'd', before: 'e', after: 'f', level: 1, got: 1,
    total: 2, days: 1, worked: 1, trend: 'z', hours: 1, ja: 'j', unit: 'u',
    winner: { ja: 'あ', en: 'A' }, loser: { ja: 'い', en: 'B' }, reason: { ja: 'う', en: 'C' },
  };
  for (const lang of LANGS) {
    for (const id of MESSAGE_IDS) {
      const value = t(lang, id, params);
      assert.equal(typeof value, 'string');
      assert.notEqual(value, id, `${lang} に ${id} が無い`);
      if (lang === 'en') assert.ok(!CJK.test(value), `${lang}/${id} に日本語が混ざっている: ${value}`);
      /*
       * **逆も見る。** 日本語の表を書き直したときに 1 行だけ英語のまま残り
       * （`'mood.working': 'working'`）、日本語で見ているのにそこだけ英語が
       * 出ていた。「英語の単語だけでできている」を落とせば掴まる ── Lv・EXP
       * のような、日本語の中に混ざる短い語は素通りさせる。
       */
      if (lang === 'ja' && /[a-z]{4,}/i.test(value)) {
        assert.ok(CJK.test(value), `ja/${id} が英語のまま残っている: ${value}`);
      }
    }
  }
});

test('データの英語が抜けていない', () => {
  // `ja` の隣に `en` を置く決まり（i18n.js）。抜けると日本語に落ちて、そこだけ日本語で出る
  const tables = [
    ['CLASSES', CLASSES],
    ['SKILLS', SKILLS],
    ['ACHIEVEMENTS', ACHIEVEMENTS],
    ['TYPES', TYPES],
    ['FINDS', Object.fromEntries(FINDS.map((f) => [f.id, f]))],
    ['HAPPENINGS', Object.fromEntries(HAPPENINGS.map((h, i) => [String(i), h]))],
  ];
  for (const [name, table] of tables) {
    for (const [id, entry] of Object.entries(table)) {
      assert.ok(entry.en, `${name}.${id} に en が無い`);
      assert.ok(!CJK.test(entry.en), `${name}.${id} の en に日本語が混ざっている: ${entry.en}`);
      if (entry.blurb) assert.ok(entry.blurbEn, `${name}.${id} に blurbEn が無い`);
      if (entry.from) assert.ok(entry.fromEn, `${name}.${id} に fromEn が無い`);
    }
  }
  // 軸そのものに名前は無い（寄ったほうの側が名前になる）。左右と根拠に en が要る
  for (const axis of AXES) {
    for (const side of ['left', 'right']) {
      assert.ok(axis[side].en, `${axis.id}.${side} に en が無い`);
      assert.ok(axis[side].blurbEn, `${axis.id}.${side} に blurbEn が無い`);
      assert.ok(!CJK.test(axis[side].en), `${axis.id}.${side} の en に日本語が混ざっている`);
    }
    assert.ok(axis.fromEn, `${axis.id} に fromEn が無い`);
  }
});

test('拾い物は「誰もが心当たりのある状況」だけ ── 名指しで貶さない', () => {
  // DESIGN.md / expedition.js の編集方針。**人・会社・製品を落とすものは入れない。**
  // 実装ではなく方針を縛るテストなので、増やすときはここも読むこと。
  assert.ok(FINDS.length >= 60, '拾い物が減っている');
  const ids = FINDS.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length, '拾い物の id が重複している');
  for (const find of FINDS) {
    assert.ok(find.ja && find.en, `${find.id} の名前が欠けている`);
    assert.ok(typeof find.weight === 'number' && find.weight > 0, `${find.id} の重みが無い`);
  }
  // レアは「たまに出る」もの。半分がレアなら、レアではない
  const rare = FINDS.filter((f) => f.rare).length;
  assert.ok(rare > 0 && rare < FINDS.length * 0.35, `レアの割合がおかしい（${rare}/${FINDS.length}）`);
});

test('中身を読まない約束は、英語でも書いてある', () => {
  // 「プロンプトの中身は見ていない」の但し書きは、翻訳のときに落ちやすい
  for (const lang of LANGS) {
    const note = chrome(lang)['persona.note'];
    assert.ok(note && note.length > 20, `${lang} に型の但し書きが無い`);
  }
});

test('言語が違っても、同じログからは同じ強さが出る', () => {
  // 表示だけの話であって、成長や戦闘の結果が言語で変わってはいけない
  const state = grown();
  const now = T0 + 20 * 86400000;
  const ja = viewModel(state, now, { lang: 'ja' });
  const en = viewModel(state, now, { lang: 'en' });
  assert.equal(ja.level, en.level);
  assert.equal(ja.exp, en.exp);
  assert.equal(ja.persona.key, en.persona.key);
  assert.equal(ja.battle?.winner, en.battle?.winner);
  assert.deepEqual(ja.skills.map((s) => `${s.id}:${s.tier}`), en.skills.map((s) => `${s.id}:${s.tier}`));
  assert.deepEqual(ja.achievements.map((a) => a.id), en.achievements.map((a) => a.id));
  assert.deepEqual(
    ja.expedition?.finds.map((f) => f.id),
    en.expedition?.finds.map((f) => f.id),
  );
});

test('label / blurb は、その言語が無ければ日本語に落ちる', () => {
  assert.equal(label({ ja: 'あ', en: 'a' }, 'en'), 'a');
  assert.equal(label({ ja: 'あ' }, 'en'), 'あ');
  assert.equal(label(null, 'en'), '');
  assert.equal(blurb({ blurb: 'い', blurbEn: 'b' }, 'en'), 'b');
  assert.equal(blurb({ blurb: 'い' }, 'en'), 'い');
});

test('型の軸は、寄っているほうの意味を必ず出す', () => {
  /*
   * 「籠る ←→ 出て行く」は、名前だけ見ても何のことか分からない。**どちらに
   * 寄っているかは既に出しているので、そちらの意味を一行足すだけで読める**
   * ── ところが personaFor が返す軸から説明（blurb）が落ちていて、
   * この行はずっと空のまま出ていなかった。空でも例外は出ないので気づけない。
   */
  const state = grown();
  for (const lang of LANGS) {
    const view = viewModel(state, T0 + 20 * 86400000, { lang });
    assert.ok(view.persona.settled, '母数が足りず、型が決まっていない');
    for (const axis of view.persona.axes) {
      assert.ok(axis.meaning, `${lang}/${axis.id} の意味が空`);
      // 寄っているほうの説明であること（逆側を出すと、まるごと嘘になる）
      const leaning = axis.code === axis.left.code ? axis.left : axis.right;
      assert.equal(axis.meaning, leaning.blurb, `${axis.id} が逆側の意味を出している`);
      // 根拠も一緒に出す。無いと占いになる
      assert.ok(axis.from, `${lang}/${axis.id} の根拠が空`);
    }
  }
});

test('話題ものを入れても、名指しで落とさない', () => {
  /*
   * 流行りの言い回しを入れていくと、いちばん滑りやすいのがここ。
   * **人ではなく現象のほうを書く** ── 「深夜の一言で相場が動く」は書けるが、
   * 誰がと書いた瞬間、それは別のものになる（DESIGN.md / expedition.js の線）。
   *
   * 完全な検査はできないので、**いちばん名前が出やすいところだけ**を止める。
   * 名前が要る書き方を思いついたときに、ここで一度立ち止まれれば足りる。
   */
  const NAMED = [
    'Musk', 'マスク氏', 'Bezos', 'Zuckerberg', 'Altman', 'Trump', 'トランプ',
    'OpenAI', 'ChatGPT', 'Google', 'グーグル', 'Meta', 'Twitter', 'ツイッター',
    'Microsoft', 'Apple', 'Amazon', 'Tesla', 'テスラ', 'Nvidia', 'Oracle',
  ];
  const tables = [
    ['FINDS', FINDS],
    ['HAPPENINGS', HAPPENINGS],
    ['GEAR', GEAR],
    ['BOSSES', BOSSES],
  ];
  for (const [name, rows] of tables) {
    for (const row of rows) {
      const text = [row.ja, row.en, row.blurb, row.blurbEn].filter(Boolean).join(' ');
      for (const word of NAMED) {
        assert.ok(
          !text.includes(word),
          `${name}.${row.id} が「${word}」を名指ししている ── 人ではなく現象のほうを書く`,
        );
      }
    }
  }

  /*
   * **落とす言葉そのものも止める。** 皮肉と侮辱は違う ── 皮肉は状況に向かい、
   * 侮辱は人に向かう。向かう先が人になっていたら、それは入れない。
   */
  const SLURS = ['バカ', '馬鹿', 'アホ', '無能', 'クソ', 'ゴミ', 'idiot', 'stupid', 'moron', 'useless', 'garbage'];
  for (const [name, rows] of tables) {
    for (const row of rows) {
      const text = [row.ja, row.en, row.blurb, row.blurbEn].filter(Boolean).join(' ');
      for (const word of SLURS) {
        assert.ok(!text.toLowerCase().includes(word.toLowerCase()), `${name}.${row.id} に「${word}」がある`);
      }
    }
  }
});

test('留守のまとめの言葉は i18n から出ている（pet.js に焼き付けない）', () => {
  /*
   * pet.js は素のスクリプト（ES モジュールを読めない）。**そこで文を組み立てると
   * 日本語が焼き付いて、英語にしても日本語のままになる** ── 足してよいのは
   * 数字と記号（`Lv7 → Lv13`, `+2`）だけで、言葉は view.text から引く。
   */
  const src = fs.readFileSync(new URL('../src/renderer/pet.js', import.meta.url), 'utf8');
  const used = [...src.matchAll(/text\['([\w.]+)'\]/g)].map((m) => m[1]);
  assert.ok(used.length, 'view.text を一度も引いていない');
  for (const lang of ['ja', 'en']) {
    const table = chrome(lang);
    for (const id of used) {
      assert.equal(typeof table[id], 'string', `${lang} に ${id} が無い（差し込みの要る文は引けない）`);
    }
  }

  // 留守のまとめが引いているぶんは、名指しでも押さえておく
  for (const id of ['panel.expedition', 'away.gear', 'panel.achievements', 'dungeon.bosses']) {
    assert.ok(used.includes(id), `${id} を引かずに文を作っている`);
  }
});

test('拾い物には必ず観察記録が付いている（名前だけにしない）', () => {
  /*
   * **面白いのは大層な名前のほうではなく、それが何か知らないまま真面目に
   * 観察している落差**（ピクミンのお宝の書き方）。名前だけ並べると「へえ」で
   * 終わるので、一言のほうを本体にする。
   *
   * 足すときに書き忘れると、その 1 個だけ黙って空欄で出る ── ここで止める。
   */
  for (const find of FINDS) {
    assert.ok(find.blurb, `FINDS.${find.id} に観察記録が無い`);
    assert.ok(find.blurbEn, `FINDS.${find.id} に英語の観察記録が無い`);
    // 名前をなぞっただけの一言は、無いのと同じ
    assert.notEqual(find.blurb, find.ja, `FINDS.${find.id} の一言が名前と同じ`);
    // 吹き出しにも入る長さに収める
    assert.ok(find.blurb.length <= 34, `FINDS.${find.id} の一言が長い（${find.blurb}）`);
  }

  // 拾ったものは view まで一言つきで届く（途中で落とさない）
  const state = grown();
  state.lastEventAt = T0 - 6 * 3600000;
  state.lastEventKind = 'Stop';
  const view = viewModel(state, T0, { lang: 'ja' });
  assert.ok(view.expedition, '留守の記録が出ていない');
  for (const find of view.expedition.finds) {
    assert.ok(find.note, `${find.id} の一言が view まで届いていない`);
  }
});
