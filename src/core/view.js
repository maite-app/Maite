import { moodFor, levelProgress, levelForExp, MAX_LEVEL, TRAIL_DAYS } from './growth.js';
import { dayKeyFor, dayNumberFor, boutStartFor, skyFor, BOUT_HOURS } from './clock.js';
import { CLASSES, CLASS_IDS } from './classes.js';
import { skillsFor, nextSkillHints, effectOf, tierOf, SKILLS, SKILL_IDS } from './skills.js';
import { currentBattle, BATTLE_UNLOCK_LEVEL } from './battle.js';
import { fighterFrom, statsFor } from './fighter.js';
import { unlockedList, lockedList, jobBadges, VISIBLE_IDS, ACHIEVEMENTS } from './achievements.js';
import { expeditionFor } from './expedition.js';
import { dungeonFor, describeFind, SLOTS } from './dungeon.js';
import { appearanceFor } from './appearance.js';
import { anniversaryFor } from './anniversary.js';
import { sleepTalkFor } from './sleeptalk.js';
import { dreamSeeds } from './dreams.js';
import { recapFor } from './recap.js';
import { nameFor } from './naming.js';
import { personaFor, TYPES } from './persona.js';
import { t, label, blurb, chrome, normalizeLang, fmtNum } from './i18n.js';
import { skinView } from './skins.js';

/**
 * state を「表示に必要なものだけ」に落とす。
 * オーバーレイ（IPC 経由）とスマホ用ページ（HTTP 経由）が同じものを見るように、
 * 変換はここ 1 箇所に置く。
 */

/**
 * 戦闘ログを日本語の行にする。
 *
 * 戦闘の中身（battle.js）は構造だけを吐き、文言はここで付ける。オーバーレイと
 * スマホで別々に文章を組み立てると、同じ戦いが 2 通りに読めてしまう。
 */
export function battleLines(battle, lang = 'ja') {
  if (!battle) return [];
  const nameOf = (side) => (side === 'you' ? battle.you.name : battle.foe.name);
  const otherOf = (side) => (side === 'you' ? battle.foe.name : battle.you.name);
  const lines = [];

  for (const entry of battle.log) {
    const who = nameOf(entry.side);
    const other = otherOf(entry.side);
    const hit = { who, other, amount: entry.amount, hp: entry.hp };
    switch (entry.kind) {
      case 'first':
      case 'night':
      case 'fortitude':
      case 'cleanse':
        lines.push(t(lang, `log.${entry.kind}`, { who }));
        break;
      case 'matchup':
        lines.push(t(lang, 'log.matchup', entry.text));
        break;
      case 'hit':
      case 'crit':
      case 'swift':
      case 'summon':
        lines.push(t(lang, `log.${entry.kind}`, hit));
        break;
      case 'weaken':
        lines.push(t(lang, 'log.weaken', { who, other }));
        break;
      case 'timeup':
        lines.push(t(lang, 'log.timeup'));
        break;
      case 'end':
        lines.push(
          battle.winner === 'draw'
            ? t(lang, 'log.drawEnd')
            : t(lang, 'log.end', { who: battle.winner === 'you' ? battle.you.name : battle.foe.name }),
        );
        break;
      default:
        break;
    }
  }
  return lines;
}

/**
 * 相手の強さを、どれだけ言葉にするか。
 *
 * **数字は出さない**（DESIGN.md §5d）。「あと何レベルで勝てる」が計算できると、
 * 負けた時点でその日の戦いは終わってしまう。代わりに、どれくらいの差だったかを
 * 手応えとして返す ── measurable ではないが、次に見る理由にはなる。
 */
function impressionFor(battle, lang) {
  const mine = battle.you.hp / battle.you.maxHp;
  const theirs = battle.foe.hp / battle.foe.maxHp;
  if (battle.winner === 'draw') return t(lang, 'impression.draw');
  if (battle.winner === 'you') {
    if (mine > 0.6) return t(lang, 'impression.winBig');
    if (mine > 0.25) return t(lang, 'impression.win');
    return t(lang, 'impression.winThin');
  }
  if (theirs > 0.6) return t(lang, 'impression.loseBig');
  if (theirs > 0.25) return t(lang, 'impression.lose');
  return t(lang, 'impression.loseThin');
}

/**
 * ふりかえりを、そのまま並べられる行にする。
 *
 * **数字だけを渡さない。** 描画側で「手を動かした日 12」と組み立てると、
 * そこに日本語が焼き付く（素のスクリプトなので i18n を読めない）。
 */
function recapView(state, now, tzOffset, lang) {
  const recap = recapFor(state.days, now, tzOffset);
  if (!recap) return null;
  const fmt = (n) => fmtNum(n, lang);
  const day = (key) => key.slice(5).replace('-', '/');
  return {
    span: t(lang, 'recap.span', { from: day(recap.from), to: day(recap.to) }),
    note: t(lang, 'recap.note'),
    rows: [
      { id: 'worked', label: t(lang, 'recap.worked'), value: t(lang, 'recap.days', { n: recap.workedDays }) },
      { id: 'exp', label: t(lang, 'recap.exp'), value: fmt(recap.exp) },
      { id: 'tools', label: t(lang, 'recap.tools'), value: fmt(recap.tools) },
      { id: 'prompts', label: t(lang, 'recap.prompts'), value: fmt(recap.prompts) },
      { id: 'sessions', label: t(lang, 'recap.sessions'), value: fmt(recap.sessions) },
      {
        id: 'best',
        label: t(lang, 'recap.best'),
        value: t(lang, 'recap.bestValue', { day: day(recap.best.day), n: fmt(recap.best.exp) }),
      },
    ],
  };
}

/** 戦闘を表示用に落とす。生の log は落として、読める行だけ渡す。 */
function battleView(state, now, tzOffset, lang) {
  const battle = currentBattle(state, now, { tzOffset, lang });
  if (!battle) return null;
  const foeClass = battle.opponent.class ? CLASSES[battle.opponent.class] : null;
  const className = foeClass ? label(foeClass, lang) : null;
  return {
    // 練習相手であることは必ず出す。黙ると信用が飛ぶ（DESIGN.md §4）
    practice: battle.practice,
    winner: battle.winner,
    turns: battle.turns,
    night: battle.night,
    // オーバーレイが「この試合はもう見せたか」を覚えるのに使う
    stamp: battle.stamp,
    /*
     * その一戦が始まった実時刻。**ケガ（appearance.js）が勝手に治るのに要る。**
     * 「何分前の出来事か」が出ないと、負けた印を消すきっかけが作れない。
     */
    startedAt: boutStartFor(now, tzOffset),
    opponent: {
      name: battle.opponent.name,
      // level は**わざと渡さない**。系統は相性に効くので見せる。
      className,
    },
    // 「vs だれ（系統）· 未明」まで組んで渡す
    head:
      (className
        ? t(lang, 'battle.vs', { name: battle.opponent.name, className })
        : `vs ${battle.opponent.name}`) + (battle.night ? ` · ${t(lang, 'battle.nightTag')}` : ''),
    // 練習相手のときだけ出す但し書き。黙ると信用が飛ぶ
    note: battle.practice ? t(lang, 'battle.practiceNote') : '',
    impression: impressionFor(battle, lang),
    // 勝ち負けの一言。オーバーレイがそのまま吹き出しに出す
    result: t(lang, `battle.${battle.winner === 'you' ? 'win' : battle.winner === 'foe' ? 'lose' : 'draw'}`),
    you: battle.you,
    foe: battle.foe,
    lines: battleLines(battle, lang),
  };
}

/**
 * 「何をしてきたか」を読める形にする。
 *
 * 合計値だけ並べても働き方は見えない。系統の内訳と、そこから出る比率
 * （立て直し率・つまずき率）まで出して初めて「こういう使い方をしていた」が読める。
 *
 * **全部 traits と系統ベクトルからの割り算。** state には何も足していない。
 */
function profileFor(state, now, lang) {
  const fmt = (n) => fmtNum(n, lang);
  const traits = state.traits;
  const total = CLASS_IDS.reduce((acc, id) => acc + (state.classVector[id] || 0), 0);

  const breakdown = CLASS_IDS.map((id) => ({
    id,
    label: label(CLASSES[id], lang),
    blurb: blurb(CLASSES[id], lang),
    hue: CLASSES[id].hue,
    count: state.classVector[id] || 0,
    share: total > 0 ? (state.classVector[id] || 0) / total : 0,
  }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count);

  // 2 番手が何回で追い抜くか。開発スタイルが変われば見た目も変わる、の目安
  let chasing = null;
  if (breakdown.length >= 2 && state.classId) {
    const [top, second] = breakdown;
    const need = top.count - second.count + 1;
    // 文はここで組む。描画側で `${a} が ${b} 回で` と書くと、そこに日本語が焼き付く
    chasing = { label: second.label, need, text: t(lang, 'style.chasing', { ja: second.label, n: fmt(need) }) };
  }

  const ageDays = state.bornAt ? Math.max(0, Math.floor((now - state.bornAt) / 86400000)) : 0;

  // 失敗したうち、その場で立て直せた割合
  const recovery = traits.failures > 0 ? traits.comebacks / traits.failures : null;
  // ツール呼び出しのうち、つまずいた割合
  const stumble = traits.toolCalls > 0 ? traits.failures / traits.toolCalls : null;
  // 1 セッションでどれだけ手を動かすか
  const toolsPerSession = traits.sessions > 0 ? traits.toolCalls / traits.sessions : null;
  // 1 つの指示でどれだけ手が動くか
  const toolsPerPrompt = traits.prompts > 0 ? traits.toolCalls / traits.prompts : null;

  const pct = (value) => (value === null ? null : `${Math.round(value * 100)}%`);
  const times = (value) => (value === null ? null : t(lang, 'style.times', { n: value.toFixed(1) }));

  return {
    breakdown,
    chasing,
    recovery,
    stumble,
    toolsPerSession,
    toolsPerPrompt,
    ageDays,
    /*
     * 「働き方」の行。**ラベルも値もここで文字にする。**
     * 描画側（素のスクリプト）で組むと、そこに単位ぶんの日本語が焼き付く。
     */
    rows: [
      { id: 'recovery', label: t(lang, 'style.recovery'), value: pct(recovery) },
      { id: 'stumble', label: t(lang, 'style.stumble'), value: pct(stumble) },
      { id: 'perSession', label: t(lang, 'style.perSession'), value: times(toolsPerSession) },
      { id: 'perPrompt', label: t(lang, 'style.perPrompt'), value: times(toolsPerPrompt) },
      { id: 'age', label: t(lang, 'style.age'), value: t(lang, 'style.days', { n: fmt(ageDays) }) },
    ]
      .filter((row) => row.value !== null)
      // **その数字が何を見たものかを、隣に書く。**「つまずいた割合って何？」で
      // 終わらせない ── 根拠を出すのがこのアプリの芯（DESIGN.md §8c）
      .map((row) => ({ ...row, note: t(lang, `note.${row.id}`) === `note.${row.id}` ? '' : t(lang, `note.${row.id}`) })),
  };
}

/**
 * ここ 2 週間の 1 日ごとの EXP。**働かなかった日も 0 として並べる。**
 *
 * 記録のある日だけ返すと、休んだ週が「無かったこと」になって詰まって見える
 * ── 空いている日が空いているまま見えるのが、この形の値打ち。
 *
 * ratio はその 2 週間で一番働いた日を 1 とした高さ。日次上限（1,500）を 1 に
 * しないのは、上限まで使う日が無い人の画面が全部ぺったんこになるから。
 */
function trailFor(state, now, tzOffset) {
  const days = state.days || {};
  const today = dayNumberFor(now, tzOffset);
  const out = [];
  for (let i = TRAIL_DAYS - 1; i >= 0; i -= 1) {
    const day = dayKeyFor((today - i) * 86400000, 0);
    out.push({ day, exp: (days[day] && days[day].exp) || 0 });
  }
  const peak = Math.max(1, ...out.map((d) => d.exp));
  for (const entry of out) entry.ratio = entry.exp / peak;
  return out;
}

/**
 * ここ 2 週間を 1 行にまとめる。**前半と後半を比べて「乗ってきた / 失速した」まで言う。**
 * 合計だけだと、それが多いのか少ないのかが読めない。
 */
function trailNoteFor(trail, lang) {
  const sum = trail.reduce((acc, d) => acc + d.exp, 0);
  if (!sum) return { total: '', note: t(lang, 'trail.empty') };

  const worked = trail.filter((d) => d.exp > 0).length;
  const half = Math.floor(trail.length / 2);
  const older = trail.slice(0, half).reduce((acc, d) => acc + d.exp, 0);
  const newer = trail.slice(half).reduce((acc, d) => acc + d.exp, 0);
  const trend = newer > older * 1.25 ? 'up' : newer * 1.25 < older ? 'down' : 'flat';

  return {
    total: t(lang, 'exp.unit', { n: fmtNum(sum, lang) }),
    note: t(lang, 'trail.summary', { days: trail.length, worked, trend: t(lang, `trail.${trend}`) }),
  };
}

/**
 * 表示用に落とす。
 *
 * name は「本人が付け替えた名前」。state ではなく設定（PC）や KV（サーバー）から
 * 来るので、引数で受け取る ── 成長の記録に混ぜると、畳み直すたびに消える。
 */
/**
 * 型に「いつ変わったか」を添える。
 *
 * 型そのものは導出だが、変わった瞬間だけは state に刻んである（growth.js の jobs）
 * ── **知らない間に変わっていたことに、後から気づけるように。**
 */
function jobHistory(persona, state, lang) {
  const jobs = Array.isArray(state.jobs) ? state.jobs : [];
  const current = jobs[jobs.length - 1] || null;
  const before = jobs.length >= 2 ? jobs[jobs.length - 2] : null;
  const since = current && current.key === persona.key ? current.at : null;
  const previous = before ? label(TYPES[before.key], lang) : null;

  /*
   * 「いつから この名前か」の 1 行。
   *
   * **日付だけは描画側で入れる。** ここで書くと、Worker のローカル（UTC）で
   * 日付が出て、日付の変わり目に PC と 1 日ずれる ── clock.js と同じ理由。
   * だから `{day}` を空けたまま渡し、見ている端末の暦で埋めてもらう。
   */
  let line = '';
  if (!persona.settled) line = t(lang, 'persona.hint');
  else if (previous && since) line = t(lang, 'persona.changed', { day: '{day}', before: previous });
  else if (since) line = t(lang, 'persona.since', { day: '{day}' });

  return {
    ...persona,
    // いまの名前になった時刻。初めて名乗った日でもある
    since,
    // 前は何と呼ばれていたか
    previous,
    line,
    history: jobs.map((job) => ({ label: label(TYPES[job.key], lang), at: job.at })),
  };
}

/*
 * データ 1 件を、その言語の見え方に落とす道具。**表示名は `label`**
 * ── `ja` という欄に英語が入っていると、次に読む人が必ず間違える。
 *
 * 元データの `ja` / `en` は落とす。**残しておくと必ず誰かがそれを描いて、
 * 英語の画面に日本語が 1 行だけ出る**（実際に skills と axes で起きた）。
 * 出ていく view には、もう解けた文字だけを載せる。
 */
const RAW_FIELDS = ['ja', 'en', 'blurbEn', 'fromEn', 'unitEn'];

function stripRaw(obj) {
  const out = { ...obj };
  for (const key of RAW_FIELDS) delete out[key];
  return out;
}
function localizeSkill(skill, lang) {
  const def = SKILLS[skill.id];
  const unit = pickUnit(def, lang);
  return {
    ...stripRaw(skill),
    label: label(def, lang),
    blurb: blurb(def, lang),
    from: pickFrom(def, lang),
    unit,
    // 「あと N 回」。上限まで来ていれば「極めた」、まだ生えていなければ空
    remainingText:
      skill.remaining === null || skill.remaining === undefined
        ? skill.tier
          ? t(lang, 'skill.max')
          : ''
        : t(lang, 'skill.remaining', { n: fmtNum(skill.remaining, lang), unit }),
    /*
     * **効き目を数字で出す。** 「素早さが上がり、先手を取りやすくなる」だけでは
     * 本当に効いているのか確かめようがない ── 数字は battle.js が実際に使う
     * ものと同じ出どころ（skills.js の SKILL_POWER）から組む。
     */
    effectText: (() => {
      const effect = effectOf(skill.id, skill.tier);
      return effect ? t(lang, `skilleffect.${effect.key}`, effect) : '';
    })(),
  };
}

function localizeBadge(badge, lang) {
  const def = ACHIEVEMENTS[badge.id];
  return { ...stripRaw(badge), label: label(def, lang), blurb: blurb(def, lang) };
}

function localizeAxis(axis, lang) {
  const left = { ...stripRaw(axis.left), label: label(axis.left, lang), blurb: blurb(axis.left, lang) };
  const right = { ...stripRaw(axis.right), label: label(axis.right, lang), blurb: blurb(axis.right, lang) };
  /*
   * **寄っているほうの中身を、その場に出す。**
   *
   * 「籠る ←→ 出て行く」「動かす ←→ 組み立てる」は、名前だけ見ても何のことか
   * 分からない（「よくわからん」と言われた）。どちらに寄っているかは既に出して
   * いるので、**そちらの意味を一行足すだけ**で読めるようになる ── 説明の言葉は
   * persona.js に元から書いてあった。
   */
  const leaning = axis.code === left.code ? left : axis.code === right.code ? right : null;
  return {
    ...stripRaw(axis),
    label: label(axis, lang),
    blurb: blurb(axis, lang),
    from: lang === 'ja' ? axis.from : axis.fromEn || axis.from,
    meaning: leaning ? leaning.blurb : '',
    left,
    right,
  };
}

function localizePersona(persona, lang) {
  const type = TYPES[persona.key];
  const out = {
    ...stripRaw(persona),
    label: label(type, lang),
    blurb: blurb(type, lang),
    // 読みは日本語の名前を読むためのもの。英語では出さない
    yomi: lang === 'ja' ? persona.yomi : '',
    rhythm: localizeAxis(persona.rhythm, lang),
    rhythmLabel: label(persona.rhythm, lang),
    rhythmBlurb: blurb(persona.rhythm, lang),
    title: persona.rhythmSettled
      ? lang === 'ja'
        ? `${label(type, lang)}（${label(persona.rhythm, lang)}）`
        : `${label(type, lang)} · ${label(persona.rhythm, lang)}`
      : label(type, lang),
    axes: persona.axes.map((axis) => localizeAxis(axis, lang)),
  };
  // 型そのものの日本語（rhythmJa）は、解けたあとは要らない
  delete out.rhythmJa;
  return out;
}

/**
 * 六角形の能力値。
 *
 * **形が読めることを優先する。** 生の数字（atk 77）を 6 つ並べても、それが
 * 高いのか低いのかは分からない ── 隣に「同じレベルの平均」が無いと比べようがない。
 * だから各軸は「同レベルの平均を 1 とした比」で描く。学者は守りが外に張り出し、
 * 探索者は速さが伸びる ── **働き方がそのまま形になる**。
 *
 * 6 つのうち 3 つ（攻・守・速）は装備が乗ったあとの値。潜るほど外に広がるので、
 * 「眺めているだけで大きくなっていく」がここに出る。
 */
const HEX_AXES = ['atk', 'def', 'spd', 'skill', 'depth', 'keep'];

/**
 * 目盛りの上限。1.0（同レベルの平均）が真ん中より外に来るように取ってある
 * ── 平均が真ん中だと、どの個体も同じ大きさの六角形に見える。
 *
 * **体力を軸に入れていない。** HP はレベルだけで決まる（battle.js の hpFor）ので、
 * 平均との比が誰でも常に 1.0 になる ── 動かない軸は、軸として置く意味がない。
 * 代わりに「続」（ここ 2 週間で何日動いたか）を入れてある。
 */
const HEX_MAX = 1.8;

function hexagonFor(state, trail, lang) {
  const level = levelForExp(state.exp);
  const fighter = fighterFrom(state);
  const dungeon = dungeonFor(state);

  // 同じレベルの「平均的な個体」。系統に寄っていない配分で出す
  const flat = Object.fromEntries(CLASS_IDS.map((id) => [id, 1]));
  const average = statsFor(level, flat);

  // 技は生えた段位の合計。半分まで育っていれば平均（＝1.0）
  const tiers = skillsFor(state).reduce((acc, s) => acc + s.tier, 0);
  const skillRatio = tiers / (SKILL_IDS.length * 3) / 0.5;

  /*
   * 深さは「そのレベルなら普通ここまで」を 1 とする。
   *
   * **指数は実測から出した。** 階層は作業量の平方根、レベルは EXP の 1/1.75 乗で
   * 伸びるので、階層はレベルより少しだけ遅く伸びる（level^0.875）。3.0 は
   * 「90 日ふつうに働いた個体（Lv45・地下 86 階）がちょうど 1.0 になる」係数。
   *
   * √(level×40) にしていた頃は、まじめに働く人が全員この軸で振り切っていた
   * ── **動かない軸は、軸として置く意味がない**（体力を外したのと同じ理由）。
   */
  const depthRef = Math.max(1, 3 * level ** 0.875);

  /*
   * 続は、ここ 2 週間で動いた日の割合。
   *
   * 割るのは 0.7（＝10 日／2 週間）。0.5 にしていた頃は、毎日働く人が
   * 振り切って動かなくなった。休みを取る人と、取らない人の差が出る位置に置く。
   */
  const workedDays = trail.filter((d) => d.exp > 0).length;
  const keepRatio = workedDays / Math.max(1, trail.length) / 0.7;

  const raw = {
    atk: fighter.stats.atk / average.atk,
    def: fighter.stats.def / average.def,
    spd: fighter.stats.spd / average.spd,
    skill: skillRatio,
    depth: dungeon.floor / depthRef,
    keep: keepRatio,
  };
  const value = {
    atk: fighter.stats.atk,
    def: fighter.stats.def,
    spd: fighter.stats.spd,
    skill: tiers,
    depth: dungeon.floor,
    keep: workedDays,
  };

  return HEX_AXES.map((id) => ({
    id,
    // 図の頂点に置くのは 1 文字（長いと図が潰れる）
    label: t(lang, `hex.${id}`),
    // 下の行に出すのは**読んで分かる名前**と、何を見た数字かの一行
    fullLabel: t(lang, `hexfull.${id}`),
    note: t(lang, `note.${id}`),
    // 生の値も渡す。**描画側が前回と比べて赤 / 緑に振る**のに使う
    value: value[id],
    /*
     * 同じレベルの平均と比べて何倍か。**数字そのものより、これが読ませたい値**
     * ── 「攻撃 45」だけでは強いのか弱いのか分からない。
     */
    multText: t(lang, 'hex.mult', { n: (Math.round(raw[id] * 10) / 10).toFixed(1) }),
    // 目盛りの上での位置（0..1）。頂点まで行ったら頭打ち
    ratio: Math.max(0.06, Math.min(1, raw[id] / HEX_MAX)),
  }));
}

/**
 * ダンジョン ── 潜った深さと、勝手に着いた装備。
 *
 * **選ばせない。** 拾ったものを並べて選ばせると「良いものを狙って潜る」が
 * 生まれて、普段どおり仕事をするだけでよくなくなる（DESIGN.md §3）。
 * ここに出るのは「いま何を着けているか」と「最近なにを拾ったか」だけ。
 */
function localizeDungeon(state, lang) {
  const dungeon = dungeonFor(state);
  return {
    floor: dungeon.floor,
    // 「地下 37 階」。差し込みのある文なので、ここで組んで渡す
    floorText: dungeon.floor ? t(lang, 'dungeon.floor', { n: dungeon.floor }) : t(lang, 'dungeon.none'),
    equipped: SLOTS.map((slot) => dungeon.equipped[slot])
      .filter(Boolean)
      .map((find) => describeFind(find, lang)),
    recent: dungeon.recent.map((find) => describeFind(find, lang)),
    /*
     * 抜けてきた主。**まだ会っていない主は出さない** ── 出した瞬間に
     * 「12 体そろえる」の話になる（なった職を一覧に出さないのと同じ理由）。
     */
    bosses: dungeon.bosses
      .slice()
      .reverse()
      .map((boss) => ({
        id: boss.id,
        floor: boss.floor,
        label: label(boss, lang),
        blurb: blurb(boss, lang),
        text: t(lang, 'dungeon.passed', { floor: boss.floor, name: label(boss, lang) }),
      })),
    multipliers: dungeon.multipliers,
  };
}

function localizeTrip(trip, lang) {
  if (!trip) return null;
  /*
   * **拾い物には一言を添える。** 名前だけ並べても「へえ」で終わる ──
   * 面白いのは大層な名前のほうではなく、**それが何か知らないまま真面目に
   * 観察している落差**（ピクミンのお宝の書き方）。
   *
   * 相棒は地下でこれを拾ってきただけで、それが PR なのか証明書なのかは
   * 知らない。だから「差し出したまま。まだ温かい」と書ける。
   */
  const finds = trip.finds.map((find) => ({
    id: find.id,
    label: label(find, lang),
    note: blurb(find, lang),
    rare: find.rare,
  }));
  return {
    ...stripRaw(trip),
    happening: label(trip.happening, lang),
    finds,
    head: t(lang, 'trip.head', { hours: Math.max(1, Math.round(trip.hours)) }),
    // オーバーレイの吹き出しに出す 1 行。**文はここで作る**
    // ── pet.js は素のスクリプトなので、あちらで組み立てると日本語が焼き付く。
    headline:
      finds.length === 1
        ? t(lang, 'trip.one', { ja: finds[0].label })
        : t(lang, 'trip.many', { n: finds.length }),
  };
}

function pickFrom(def, lang) {
  return lang === 'ja' ? def.from : def.fromEn || def.from;
}
function pickUnit(def, lang) {
  return lang === 'ja' ? def.unit : def.unitEn || def.unit;
}

export function viewModel(state, now = Date.now(), { tzOffset = null, name = null, lang = 'ja', skin = null } = {}) {
  const progress = levelProgress(state.exp);
  const speak = normalizeLang(lang);
  const klass = state.classId ? CLASSES[state.classId] : null;
  const persona = localizePersona(personaFor(state), speak);
  const trail = trailFor(state, now, tzOffset);
  const trailNote = trailNoteFor(trail, speak);
  /*
   * 渡り歩いた職。**その職としての位（レベル）を添える。**
   *
   * 全体が Lv10 でも、錬金術師としては Lv3・罠師としては Lv5、ということがある
   * ── そこに「どの道をどれだけ歩いたか」が出る。経験値は growth.js が
   * 職ごとに分けて貯めていて（state.jobExp）、レベルの出し方は全体と同じ曲線。
   */
  // 見た目に使う生の装備（localizeDungeon は言語を解いた形しか返さない）
  const dungeonNow = dungeonFor(state);
  // 夢の材料にも使うので、1 回だけ解いて使い回す
  const dungeonView = localizeDungeon(state, speak);
  // 見た目（ケガ）にも使うので、返り値の中で組み立てずに先に出しておく
  const battleNow = battleView(state, now, tzOffset, speak);
  // 今日が節目の日か。**日付の区切りは clock.js を通す**（Worker は UTC）
  const anniversary = anniversaryFor(state.bornAt, now, tzOffset);

  const jobs = jobBadges(state).map((badge) => {
    const key = badge.id.slice('job:'.length);
    const exp = (state.jobExp && state.jobExp[key]) || 0;
    return {
      ...localizeBadge(badge, speak),
      exp,
      level: levelForExp(exp),
      levelText: t(speak, 'jobs.level', { n: levelForExp(exp) }),
    };
  });
  /*
   * **なった職は、称号の一覧には出さない。** すぐ上の「歩んだ道」に位つきで
   * 並んでいるので、同じものが 2 か所に出ることになる（分母にも入っていない）。
   */
  const achievements = unlockedList(state)
    .filter((a) => !a.id.startsWith('job:'))
    .map((a) => localizeBadge(a, speak));
  const achievementsLocked = lockedList(state).map((a) => localizeBadge(a, speak));

  /*
   * 画面の文字。**動かない文字（chrome）と、いま解いた文を同じ袋に入れる。**
   * 描画側は「文を組み立てる」のではなく「引いて置く」だけになる ── 素の
   * スクリプトでは i18n.js を読めないので、ここで解いておかないと日本語が焼き付く。
   */
  const text = {
    ...chrome(speak),
    'level.into': t(speak, 'level.into', { into: progress.into, span: progress.span }),
    'level.next': progress.toNext ? t(speak, 'level.next', { n: progress.toNext }) : t(speak, 'level.max'),
    'exp.today': t(speak, 'exp.unit', { n: fmtNum(state.daily.exp, speak) }),
    'exp.trail': trailNote.total,
    'trail.note': trailNote.note,
    'jobs.count': jobs.length ? t(speak, 'jobs.count', { n: jobs.length }) : '',
    // まだのものは「ほかに 14 つ、まだ」の一行だけ。数は出すが、中身は並べない
    'badge.locked': achievementsLocked.length
      ? t(speak, 'badge.locked', { n: fmtNum(achievementsLocked.length, speak) })
      : '',
    'achievement.count': t(speak, 'achievement.count', {
      got: achievements.length,
      total: VISIBLE_IDS.length,
    }),
    'battle.locked': t(speak, 'battle.locked', { level: BATTLE_UNLOCK_LEVEL }),
    'battle.every': t(speak, 'battle.every', { hours: BOUT_HOURS }),
    'mood.now': t(speak, `mood.${moodFor(state, now)}`),
  };

  return {
    // **名前は型から出る。** 働き方が変われば、名前のほうが変わる
    name: nameFor(persona, name ?? state.name, speak),
    lang: speak,
    // 画面に出る文字。描画側は ES モジュールを読めないので、ここで解いて渡す
    text,
    level: progress.level,
    ratio: progress.ratio,
    into: progress.into,
    span: progress.span,
    toNext: progress.toNext,
    exp: state.exp,
    classId: state.classId,
    className: klass ? label(klass, speak) : null,
    classBlurb: klass ? blurb(klass, speak) : null,
    hue: klass ? klass.hue : null,
    seed: state.seed,
    mood: moodFor(state, now),
    traits: state.traits,
    dailyExp: state.daily.exp,
    trail,
    bornAt: state.bornAt,
    lastEventAt: state.lastEventAt,
    // いま動いている道具。見た目（暮らしのしぐさ）の出し分けにだけ使う
    lastTool: state.lastTool || null,
    /*
     * 空の色（朝焼け・昼・夕・夜）。**見た目だけで、数字には一切効かない**
     * ── 効かせると「夜に働くと得」が生まれる。
     */
    sky: skyFor(now, tzOffset),
    /*
     * ひと月のふりかえり。**後ろ向きにしか書かない**（recap.js）── 材料は
     * state.days（40 日ぶん）だけで、保存は 1 バイトも増えていない。
     */
    recap: recapView(state, now, tzOffset, speak),
    /*
     * 今日が記念日なら一言。**逃しても何も減らない**（次がいつかも出さない）
     * ── 一覧に並べると「あと何日」が見えて、目標になる（DESIGN.md §5b）。
     */
    anniversary: anniversary
      ? {
          days: anniversary.days,
          text: anniversary.years
            ? t(speak, 'anniv.years', { n: anniversary.years })
            : t(speak, 'anniv.days', { n: fmtNum(anniversary.days, speak) }),
        }
      : null,
    /*
     * 寝言。**文はここで解いて渡す** ── どれを出すかは描画側が選ぶが、
     * 言葉を組み立てさせない（素のスクリプトなので日本語が焼き付く）。
     */
    sleepTalk: sleepTalkFor(state.lastTool || null).map((id) => t(speak, id)),
    /*
     * 夢。**本当にあったことのほうを見る**（dreams.js）── 寝言はその日の
     * ことしか言えないので、毎晩おなじ 3 通りになっていた。
     *
     * 材料は view が既に持っているものだけ（通ってきた職・越えてきた主・
     * いま持っている道具・潜った階・獲った称号）。**state には何も足していない。**
     */
    dreams: dreamSeeds({
      /*
       * 職は**称号の文言（「錬金術師になった」）ではなく、職そのものの名前**を
       * 渡す ── そのままだと「錬金術師になっただった ころの」になる。
       */
      jobs: jobs.map((job) => ({ label: label(TYPES[job.id.slice('job:'.length)] || {}, speak) })),
      bosses: dungeonView.bosses,
      equipped: dungeonView.equipped,
      floor: dungeonNow.floor,
      badges: achievements,
    }).map((seed) => t(speak, `dream.${seed.kind}`, { ja: seed.ja })),
    skills: skillsFor(state).map((skill) => localizeSkill(skill, speak)),
    skillHints: nextSkillHints(state).map((skill) => localizeSkill(skill, speak)),
    battle: battleNow,
    battleUnlockLevel: BATTLE_UNLOCK_LEVEL,
    expedition: localizeTrip(expeditionFor(state, now), speak),
    // 潜った深さと、勝手に着いた装備。**保存はしていない**（毎回導出）
    dungeon: dungeonView,
    // 6 軸の能力値。**形が読めること**を優先して、同レベルの平均を 1 として描く
    hexagon: hexagonFor(state, trail, speak),
    /*
     * 見た目の重ね着。**描画側で条件を書かない** ── クラス名だけ渡して、
     * 実際の絵は pet-svg.js、出し分けは style.css に閉じる。
     *
     * 装備は毎回導出（保存していない）ので、**潜るたびに勝手に姿が変わる**。
     */
    look: appearanceFor(
      progress.level,
      SLOTS.map((slot) => dungeonNow.equipped[slot]).filter(Boolean),
      {
        // 顔まわりの小物も**働き方から出す**（買えるスキンとは出どころが違う）
        ageDays: state.bornAt ? Math.max(0, Math.floor((now - state.bornAt) / 86400000)) : 0,
        classId: state.classId,
        nightTier: tierOf(skillsFor(state), 'nightVision'),
        badges: achievements.length,
        traits: state.traits,
        // 直近の一戦に負けていたら、しばらくだけ傷が出る。**勝手に治る**
        battle: battleNow,
        now,
      },
    ),
    // 見た目の重ね着。**数字には一切効かない**（skins.js）。
    // 受け取るのは「もう決まった id」── 鍵を確かめるのは PC の仕事
    skin: skinView(skin, speak),
    profile: profileFor(state, now, speak),
    persona: jobHistory(persona, state, speak),
    achievements,
    achievementsLocked,
    // 総数は**見せているぶんだけ**。なった職は獲るまで数にも入れない
    // （分母に入れると「16 個埋める」チェックリストになる）
    achievementTotal: VISIBLE_IDS.length,
    // 渡り歩いた職。古い順 ── 道として読む
    jobs,
    maxLevel: MAX_LEVEL,
  };
}
