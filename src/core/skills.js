/**
 * スキル ── 作業ログから生える技。
 *
 * **state には保存しない。** traits と系統ベクトルから毎回導出する純関数にしてある。
 * 保存すると「いつ生えたか」を state に持つことになり、ルールを変えるたびに
 * STATE_VERSION を上げて畳み直す必要が出る。導出なら growth.js が唯一の真実の
 * ままで、閾値をいじっても events.jsonl から自動的に付き直る。
 *
 * 対応表は DESIGN.md §1。「テストを通した回数 → 検証の一閃」だけは未実装で、
 * 理由は下の注記に書いた。
 */

/**
 * 技の定義。
 *
 * kind:'count' … その回数がそのまま段位になる
 * kind:'ratio' … 比率で決まる。floor は母数の下限で、1 回中 1 回で 100% を
 *                取らせないために置いている（初日に最上位が生えると育つ実感が消える）
 *
 * 効果の大きさは battle.js が段位を見て決める ── ここは「何がどれだけ生えたか」
 * だけを持ち、戦闘の数字は持たない。
 */
export const SKILLS = {
  fortitude: {
    en: 'Fortitude',
    ja: '不屈',
    blurbEn: 'Survives a killing blow at 1 HP',
    blurb: '倒れる一撃を HP1 で耐える',
    fromEn: 'Times you fixed a failing tool on the spot',
    from: '空振りした道具を、その場で通し直した回数',
    unitEn: 'times',
    unit: '回',
    kind: 'count',
    // 3/20/80 だと **3 日で最上位**だった。立て直しは実測でツール呼び出しの
    // 約 9%（1 日 300 回叩けば 27 回）起きるので、3 回はその日のうちに埋まる。
    // 25 / 250 / 1500 で「2 日・2 週間・2 ヶ月」くらいの並びになる。
    thresholds: [25, 250, 1500],
    value: (s) => s.traits.comebacks,
  },
  summon: {
    en: 'Summon',
    ja: '召喚',
    blurbEn: 'A double strikes after you',
    blurb: '分身が追撃する',
    fromEn: 'Times you handed work to a subagent with Task',
    from: 'Task でサブエージェントに任せた回数',
    unitEn: 'times',
    unit: '回',
    kind: 'count',
    thresholds: [10, 60, 300],
    value: (s) => s.classVector.commander || 0,
  },
  foresight: {
    en: 'Foresight',
    ja: '先読み',
    blurbEn: 'Faster, and more likely to strike first',
    blurb: '素早さが上がり、先手を取りやすくなる',
    fromEn: 'Share of lookups (WebSearch / WebFetch / MCP)',
    from: '調べもの（WebSearch / WebFetch / MCP）の比率',
    unitEn: 'times',
    unit: '回',
    kind: 'ratio',
    // **比率の技は、母数が育つほど遠のく。** 0.12 は「調べものが全ツールの 8 回に 1 回」で、
    // Read と Grep が中心の使い方だと一生届かない（実測で必要な連続回数が 14,079 回）。
    // 窓（直近 N 件だけで見る）に変えるかは DESIGN.md §9 の未決 ── ここでは
    // しきい値だけを、実際に出ている比率の並びに寄せてある。
    thresholds: [0.05, 0.12, 0.25],
    floor: 5,
    value: (s) => s.classVector.seeker || 0,
    total: (s) => totalToolWork(s),
  },
  mnemonic: {
    en: 'Mnemonic',
    ja: '記憶術',
    blurbEn: 'Shakes off a weakening spell',
    blurb: 'かけられた弱体を振り払う',
    fromEn: 'Long hauls carried across a compact',
    from: 'compact をまたいで続けた長丁場の回数',
    unitEn: 'times',
    unit: '回',
    kind: 'count',
    thresholds: [1, 5, 20],
    value: (s) => s.traits.compacts,
  },
  nightVision: {
    en: 'Night Eyes',
    ja: '夜目',
    blurbEn: 'Attack and speed rise in night bouts',
    blurb: '夜の戦いで攻撃と素早さが上がる',
    fromEn: 'Share of work done between 0:00 and 5:00',
    from: '0〜5 時に作業した比率',
    unitEn: 'times',
    unit: '回',
    kind: 'ratio',
    // 0.2 は「作業の 5 回に 1 回が深夜」。0.4 に至っては昼に働くほうが珍しい人しか届かない。
    thresholds: [0.03, 0.1, 0.22],
    floor: 10,
    value: (s) => s.traits.nightOwl,
    total: (s) => totalWork(s),
  },

  /*
   * verifySlash（検証の一閃 / 確定命中）は保留。
   *
   * DESIGN.md §1 は「テストを通した回数」から生やすと書いているが、events.jsonl に
   * 入っているのはツール名と成否だけで、その Bash が何のコマンドだったかは
   * 残していない（§2b 原則 1）。今のログからは原理的に出せない。
   *
   * 出すなら hook 側で「テストらしいコマンドだったか」を真偽値に落として 1 フィールド
   * 増やすことになる ── 中身は保存しないままだが、hook が引数を覗く範囲は広がる。
   * プライバシーの線に触るので、勝手に決めずに保留する。
   */
};

/** 系統ベクトルの総和。比率の母数（= 系統が付くツールを使った回数）。 */
function totalToolWork(state) {
  let sum = 0;
  for (const v of Object.values(state.classVector)) sum += v;
  return sum;
}

/** 実作業の総数。nightOwl と同じ数え方（プロンプトとツール呼び出し）に揃える。 */
function totalWork(state) {
  return state.traits.prompts + state.traits.toolCalls;
}

/**
 * 技が実際に動かす数字。
 *
 * **ここが唯一の出どころ。** 前は battle.js が中に定数を抱えていて、画面には
 * 「素早さが上がり、先手を取りやすくなる」としか出せなかった ── どれだけ上がるかが
 * 見えないと、技が本当に効いているのか確かめようがない（「覚えた技は本当に効果
 * あるん？」）。battle.js はここから読み、画面もここから文を組む。
 *
 * 段位（1..3）を掛けて使うものは `perTier`、段位ごとに飛ぶものは表で持つ。
 */
export const SKILL_POWER = {
  // 倒れる一撃を、1 戦に 1 回だけ耐える確率
  fortitude: { chance: { 1: 0.45, 2: 0.75, 3: 1 } },
  // 分身が追撃する確率（段位ぶん）
  summon: { perTier: 0.12 },
  // 素早さに乗る割合（段位ぶん）
  foresight: { perTier: 0.1 },
  // 未明の一戦だけ、攻撃と素早さに乗る割合（段位ぶん）
  nightVision: { perTier: 0.06 },
  // 振り払える弱体の回数＝段位そのもの
  mnemonic: { perTier: 1 },
};

export const SKILL_IDS = Object.keys(SKILLS);

/**
 * その段位で実際に何が起きるか。**言語は持たない**（差し込む数字だけ返す）。
 *
 * 生えていなければ null。画面はこれを i18n の文に入れて「素早さ +20%」まで出す
 * ── 効き目が数字で見えないと、技は名前だけの飾りになる。
 */
export function effectOf(id, tier) {
  if (!tier) return null;
  const power = SKILL_POWER[id];
  if (!power) return null;
  if (id === 'fortitude') return { key: id, pct: Math.round(power.chance[tier] * 100) };
  if (id === 'mnemonic') return { key: id, n: power.perTier * tier };
  return { key: id, pct: Math.round(power.perTier * tier * 100) };
}

/** いまの段位 0..3。0 は「まだ生えていない」。 */
export function tierFor(state, id) {
  const def = SKILLS[id];
  const value = def.value(state);

  if (def.kind === 'ratio') {
    const total = def.total(state);
    if (value < def.floor || total <= 0) return 0;
    const ratio = value / total;
    let tier = 0;
    for (const t of def.thresholds) if (ratio >= t) tier += 1;
    return tier;
  }

  let tier = 0;
  for (const t of def.thresholds) if (value >= t) tier += 1;
  return tier;
}

/**
 * 次の段位まで、あと何回その作業をすればいいか。上限まで来ていれば null。
 *
 * 比率の技は「1 回やると分母も 1 増える」ので、そのぶんを含めて解く
 * （(v+n)/(t+n) >= th を n について解く）。母数の下限にも届いていなければ、
 * 遠いほうを採る。
 */
export function remainingFor(state, id) {
  const def = SKILLS[id];
  const tier = tierFor(state, id);
  if (tier >= def.thresholds.length) return null;

  const target = def.thresholds[tier];
  const value = def.value(state);

  if (def.kind !== 'ratio') return Math.max(1, Math.ceil(target - value));

  const total = def.total(state);
  const byRatio = target >= 1 ? Infinity : (target * total - value) / (1 - target);
  const byFloor = def.floor - value;
  return Math.max(1, Math.ceil(Math.max(byRatio, byFloor)));
}

function describe(state, id) {
  const def = SKILLS[id];
  const tier = tierFor(state, id);
  const remaining = remainingFor(state, id);
  return {
    id,
    tier,
    ja: def.ja,
    blurb: def.blurb,
    from: def.from,
    // 「あと N 回」。次が無ければ null（＝ここが上限）
    remaining,
    unit: def.unit,
    maxTier: def.thresholds.length,
  };
}

/**
 * いま生えているスキルを返す。tier の高い順、同率は定義順。
 * 純関数（state を読むだけ）。
 */
export function skillsFor(state) {
  return SKILL_IDS.map((id) => describe(state, id))
    .filter((s) => s.tier > 0)
    .sort((a, b) => b.tier - a.tier || SKILL_IDS.indexOf(a.id) - SKILL_IDS.indexOf(b.id));
}

/** 戦闘側から「この技を持っているか」を引くための索引。持っていなければ 0。 */
export function tierOf(skills, id) {
  const hit = skills.find((s) => s.id === id);
  return hit ? hit.tier : 0;
}

/**
 * まだ生えていない技と、そこまでの残り。
 *
 * **残り回数を出すのは技だけ**（実績には出さない）。技は「働き方がそのまま形に
 * 出る」ものなので、あと何をすれば変わるかが見えていい。実績に同じものを付けると
 * 期限のあるミッションに近づく（DESIGN.md §5b）。
 */
export function nextSkillHints(state) {
  return SKILL_IDS.map((id) => describe(state, id)).filter((s) => s.tier === 0);
}
