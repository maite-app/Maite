/**
 * ことば。
 *
 * **表示文字列は 1 箇所で解決する。** 描画側（オーバーレイ / スマホ）で
 * 言語を分岐させると、同じ文が 2 通りに育っていく ── view.js が
 * 「もう読める形」に落として渡すのは、そのための決まりだった（§6）。
 * 言語もそこに乗せる。
 *
 * データ側の書き方はどこも同じ ── `ja` の隣に `en` を置く。
 *
 *     { ja: '鍛冶師', en: 'Smith', blurb: '一本を、打ち続けて仕上げる',
 *       blurbEn: 'One blade, hammered until it is finished' }
 *
 * 英語は**訳ではなく、英語で書き直したもの**。特に拾い物（expedition.js）は
 * 元がインターネットの言い回しなので、日本語から訳すと意味が死ぬ。
 */

/** 対応している言語。増やすときは、データ側の `<lang>` フィールドも一緒に増やす。 */
export const LANGS = ['ja', 'en'];

export const DEFAULT_LANG = 'ja';

/**
 * 設定・環境変数・ブラウザから来た値を、扱える言語に落とす。
 * `en-US` や `ja-JP` のような地域つきでも通す。分からなければ既定。
 */
export function normalizeLang(value) {
  if (typeof value !== 'string') return DEFAULT_LANG;
  const head = value.trim().toLowerCase().split(/[-_]/)[0];
  return LANGS.includes(head) ? head : DEFAULT_LANG;
}

/** データ 1 件を、その言語の見え方に落とす。無ければ日本語に落ちる。 */
export function label(entry, lang) {
  if (!entry) return '';
  return (lang === 'ja' ? entry.ja : entry[lang]) || entry.ja || '';
}

/** 同じく、説明のほう（`blurb` / `blurbEn`）。 */
export function blurb(entry, lang) {
  if (!entry) return '';
  if (lang === 'ja') return entry.blurb || '';
  const key = `blurb${lang[0].toUpperCase()}${lang.slice(1)}`;
  return entry[key] || entry.blurb || '';
}

/**
 * 画面の文言。データに紐づかない、地の文だけをここに置く。
 *
 * 値は文字列か、`{n}` を差し込む関数。日本語と英語で語順が違うので、
 * 「文を組み立てる側」ではなく「文そのもの」を言語ごとに持つ
 * ── 部品をつなぐ形にすると、英語だけ不自然な語順になる。
 */
const MESSAGES = {
  ja: {
    /*
     * **文体を揃える。** 前は「〜します」と「〜した」が同じ画面に並んでいて、
     * それだけで日本語がおかしく読めた。ここは全部**常体・体言止め**で通す
     * ── 短くなるし、ゲームの画面はそのほうが締まる。
     *
     * **格調は上げるが、意味は曇らせない。** 根拠を出すのがこのアプリの芯なので
     * （DESIGN.md §8c）、それらしいだけで何を見ているか分からない言葉にはしない。
     */

    // 気分
    'mood.working': '働いている',
    'mood.thinking': '思案中',
    'mood.calling': '呼んでいる',
    'mood.idle': '手すき',
    'mood.sleeping': '眠っている',

    // 章の見出し
    'panel.today': '今日',
    'panel.hexagon': '能力値',
    'panel.name': 'この名の由来',
    'panel.style': '流儀',
    'panel.skills': '覚えた技',
    'panel.dungeon': '迷宮',
    'panel.battle': '直近の一戦',
    'panel.expedition': '留守のあいだ',
    'panel.trail': 'この 2 週間',
    'panel.achievements': '称号',
    'panel.history': '歩み',
    'panel.recap': 'ひと月のふりかえり',

    // 章のまとまり（目次の見出し）
    'group.now': 'いま',
    'group.self': 'この子のこと',
    'group.power': 'できること',
    'group.events': 'できごと',
    'group.record': '記録',

    'row.dailyExp': '今日の経験値',
    'row.mood': 'ようす',
    'foot': '読むだけの画面 · 配信しているのは自分の PC',

    // 名前と型
    'persona.unsettled': '見定めの途中',
    'persona.hint': '使い込むほどに、その流儀から名が定まる',
    'persona.note':
      'この 2 週間の使い方から決まる。流儀が変われば、名のほうが変わる ── 打った言葉の中身は一文字も見ていない',
    'persona.since': ({ day }) => `${day}から この名`,
    'persona.changed': ({ day, before }) => `${day}から。それまでは ${before}`,
    'jobs.count': ({ n }) => (n === 1 ? '歩んだ道' : `歩んだ道 ${n}`),
    // その職としての位。全体のレベルとは別に貯まる
    'jobs.level': ({ n }) => `Lv${n}`,
    'jobs.note': '全体の位とは別に、その職として稼いだぶんが貯まる',
    'badge.rough': 'うまくいかなかったほう',
    'badge.locked': ({ n }) => `ほかに ${n} つ、まだ`,

    // レベルと経験値
    'level.into': ({ into, span }) => `${into} / ${span}`,
    'level.next': ({ n }) => `次の位まで ${n}`,
    'level.max': '極みに到達',
    'exp.unit': ({ n }) => `${n} 経験値`,

    // この 2 週間
    'trail.empty': '静かな 2 週間だった',
    'trail.summary': ({ days, worked, trend }) => `${days} 日のうち ${worked} 日、手を動かした ── ${trend}`,
    'trail.up': '先週より乗っている',
    'trail.down': '先週のほうが走っていた',
    'trail.flat': '先週と変わらぬ調子',

    // 流儀
    'style.recovery': '空振りから立て直した割合',
    'style.stumble': '道具が空振りした割合',
    'style.perSession': 'ひと続きで振るう道具の数',
    'style.perPrompt': 'ひと言で動く道具の数',
    'style.age': '生まれてから',
    'style.days': ({ n }) => `${n} 日`,
    'style.times': ({ n }) => `${n} 回`,
    'style.chasing': ({ ja, n }) => `${ja}まで あと ${n} 回`,
    'style.none': 'まだ道具を手にしていない',

    // **何を見た数字なのかを、その場に書く。** 無いと「つまずいた割合って何？」で終わる
    'note.recovery': '空振りした道具を、そのまま通し直せた割合',
    'note.stumble': '振るった道具のうち、返事が返らなかった割合',
    'note.perSession': '席に着いてから離れるまでに、道具を振るう回数',
    'note.perPrompt': 'ひと言の指示から、道具が動く回数',

    // 六角形の 6 軸。**1 文字で置く**（頂点の外に置くので、長いと図が潰れる）
    'hex.atk': '攻',
    'hex.def': '守',
    'hex.spd': '速',
    'hex.skill': '技',
    'hex.depth': '深',
    'hex.keep': '続',
    'hex.note': '内側の輪が、同じ位の平均。外に出ているところが得意',

    // 図の頂点は 1 文字のまま、下の行には**通じる名前**を出す
    'hexfull.atk': '攻撃',
    'hexfull.def': '守り',
    'hexfull.spd': '速さ',
    'hexfull.skill': '技',
    'hexfull.depth': '深さ',
    'hexfull.keep': '継続',
    'note.atk': '押し込む力（装備込み）',
    'note.def': '受け止める力（装備込み）',
    'note.spd': '先に動く力（装備込み）',
    'note.skill': '覚えた技の段位を、全部足したもの',
    'note.depth': '迷宮のどこまで潜ったか',
    'note.keep': 'この 2 週間で手を動かした日',
    'hex.mult': ({ n }) => `平均の ${n} 倍`,

    // 迷宮
    'dungeon.floor': ({ n }) => `地下 ${n} 階`,
    'dungeon.none': 'まだ潜っていない',
    'dungeon.equipped': '身に着けているもの',
    'dungeon.recent': '近ごろの拾いもの',
    'dungeon.bonus': ({ n }) => `+${n}%`,
    'dungeon.at': ({ n }) => `${n} 階`,
    'dungeon.note': '深く潜るほど良き品が出る。優れたものは、自ら持ち替える',
    'dungeon.bosses': '越えてきた主',
    'dungeon.passed': ({ floor, name }) => `地下 ${floor} 階 · ${name}`,

    // 技
    'skill.remaining': ({ n, unit }) => `あと ${n} ${unit}`,
    'skill.max': '極めた',
    'skill.none': 'まだ技は芽吹いていない',
    'skill.effectHead': 'いま',

    // 技が実際に動かす数字。出どころは skills.js の SKILL_POWER（battle.js と同じ）
    'skilleffect.fortitude': ({ pct }) =>
      pct >= 100 ? '倒れる一撃を、一戦に 1 度だけ必ず耐える' : `倒れる一撃を、一戦に 1 度だけ ${pct}% で耐える`,
    'skilleffect.summon': ({ pct }) => `${pct}% で分身が追撃する`,
    'skilleffect.foresight': ({ pct }) => `素早さ +${pct}%`,
    'skilleffect.nightVision': ({ pct }) => `未明の一戦だけ、攻撃と素早さ +${pct}%`,
    'skilleffect.mnemonic': ({ n }) => `かけられた弱体を ${n} 度まで振り払う`,

    // 一戦
    'battle.locked': ({ level }) => `Lv${level} から手合わせが始まる`,
    'battle.every': ({ hours }) => `${hours} 時間ごとに一戦`,
    'battle.practice': '稽古台',
    'battle.practiceNote': 'まだ好敵手が少ない。いまは稽古台との手合わせ',
    'battle.vs': ({ name, className }) => `vs ${name}（${className}）`,
    'battle.win': '勝ち',
    'battle.lose': '負け',
    'battle.draw': '引き分け',
    'battle.turns': ({ n }) => `${n} ターン`,
    'battle.nightTag': '未明',
    'battle.note': '相手の強さは伏せてある。分からないから、また見に来る',

    // 留守のあいだ
    'trip.head': ({ hours }) => `${hours} 時間の留守に、こんなものを拾ってきた`,
    'trip.one': ({ ja }) => `${ja}を拾ってきた`,
    'trip.many': ({ n }) => `みやげ ${n} つ`,
    /*
     * 久しぶりに画面を出したときの一言。**動かない文字だけ**にしてある
     * ── 増えた数は描画側でしか分からないので、そちらで「Lv7 → Lv13」のように
     * 数字だけを足す（言葉はここから出る。pet.js に日本語を焼き付けない）。
     */
    'away.gear': '装備',

    /*
     * ふりかえり。**後ろ向きにしか書かない** ── 目安も次の目標も前月との
     * 勝ち負けも出さない（出した瞬間、追い立てになる。DESIGN.md §5b）。
     */
    'recap.span': ({ from, to }) => `${from} 〜 ${to}`,
    'recap.worked': '手を動かした日',
    'recap.exp': '積んだ経験値',
    'recap.tools': '振るった道具',
    'recap.prompts': '受けた指示',
    'recap.sessions': '席に着いた回数',
    'recap.best': 'いちばん多かった日',
    'recap.bestValue': ({ day, n }) => `${day}（${n} 経験値）`,
    'recap.days': ({ n }) => `${n} 日`,
    'recap.note': '過ぎたぶんだけ。目安も、次の目標も出さない',

    // 記念日 ── 一緒にいた長さだけで決まる。逃しても何も減らない
    'anniv.days': ({ n }) => `今日で、一緒に ${n} 日`,
    'anniv.years': ({ n }) => (n === 1 ? '今日で、一緒に 1 年' : `今日で、一緒に ${n} 年`),

    /*
     * 寝言。**責めない・急かさない**（DESIGN.md §5 の表現の線）── 「まだ
     * 終わってない」の類を入れた瞬間、静かな画面が仕事の続きになる。
     * 出どころは「最後に動いた道具」だけで、中身は読んでいない。
     */
    'sleep.build1': '…とおった……',
    'sleep.build2': '…もういっかい……',
    'sleep.read1': '…あと、すこし……',
    'sleep.read2': '…そこ、みてた……',
    'sleep.write1': '…なおした……',
    'sleep.write2': '…ここ、こう……',
    'sleep.out1': '…とおくまで……',
    'sleep.plain1': 'むにゃ……',
    'sleep.plain2': '…すぅ……',
    'sleep.plain3': '…ん……',

    /*
     * 夢。**過ぎたことを、静かに思い出しているだけ**にする ── 「まだ終わって
     * いない仕事の夢」を入れると、眠っている絵まで仕事の続きになる。
     */
    'dream.boss': ({ ja }) => `…${ja}の、夢……`,
    'dream.job': ({ ja }) => `…${ja}だった ころの……`,
    'dream.gear': ({ ja }) => `…${ja}を、まだ……`,
    'dream.floor': ({ ja }) => `…地下 ${ja} 階の、あかり……`,
    'dream.badge': ({ ja }) => `…${ja}の、日の……`,

    // 称号
    'achievement.count': ({ got, total }) => `${got} / ${total}`,
    'achievement.locked': 'まだ手にしていないもの',

    // 戦闘ログの 1 行ずつ。**文そのものを言語ごとに持つ**（語順が違うので）
    'log.first': ({ who }) => `先手は${who}`,
    'log.night': ({ who }) => `未明の戦い。${who}の目が冴えている`,
    'log.hit': ({ who, other, amount, hp }) => `${who}の攻撃 ${amount}（${other} 残り ${hp}）`,
    'log.crit': ({ who, other, amount, hp }) => `${who}の会心の一撃 ${amount}（${other} 残り ${hp}）`,
    'log.swift': ({ who, other, amount, hp }) => `${who}が速さで押し込む ${amount}（${other} 残り ${hp}）`,
    'log.summon': ({ who, other, amount, hp }) => `${who}の分身が追撃 ${amount}（${other} 残り ${hp}）`,
    'log.fortitude': ({ who }) => `${who}は倒れずに耐えた（残り 1）`,
    'log.weaken': ({ who, other }) => `${who}が${other}の攻撃を鈍らせた`,
    'log.cleanse': ({ who }) => `${who}が弱体を振り払った`,
    'log.timeup': '時間切れ。残る体力で判定',
    'log.end': ({ who }) => `${who}の勝ち`,
    'log.drawEnd': '引き分け',
    'log.matchup': (m) => `${m.winner.ja}は${m.loser.ja}に強い ── ${m.reason.ja}`,

    // 手応え（相手の強さは数字で出さない）
    'impression.draw': '相打ちだった',
    'impression.winBig': '危なげなかった',
    'impression.win': '競り勝った',
    'impression.winThin': '辛くも凌いだ',
    'impression.loseBig': 'まるで歯が立たなかった',
    'impression.lose': '押し切られた',
    'impression.loseThin': 'あと一歩だった',

    // 吹き出し
    'say.levelup': ({ level }) => `Lv${level}！`,
    'say.job': ({ before, after }) => `${before} → ${after}`,
    'say.achievements': ({ n }) => `称号 ${n} つ！`,
    'say.gear': ({ label }) => `${label} を身に着けた！`,
    'say.floor': ({ n }) => `地下 ${n} 階！`,
    'say.boss': ({ name }) => `${name} を越えた`,

    // 歩み
    'trait.toolCalls': '道具を振るった回数',
    'trait.prompts': '受けた指示',
    'trait.sessions': 'ひと続きの作業',
    'trait.comebacks': '空振りから立て直した回数',
    'trait.failures': '空振りした回数',
    'trait.compacts': '長丁場を越えた回数',
    'trait.nightOwl': '未明の作業',
    'trait.none': 'まだ何もしていない',
    'note.toolCalls': 'Bash・Read・Edit … 全部あわせた数',
    'note.prompts': 'こちらから投げた言葉の数',
    'note.sessions': '席に着いた回数。45 分空けて戻れば、次の 1 回',
    'note.comebacks': '空振りした道具を、そのまま通し直した数',
    'note.failures': '振るったが、返事が返らなかった数',
    'note.compacts': 'compact をまたいで続いた作業の数',
    'note.nightOwl': '0 時から 5 時のあいだに動いた数',
  },
  en: {
    'mood.working': 'working',
    'mood.thinking': 'thinking',
    'mood.calling': 'waiting for you',
    'mood.idle': 'idle',
    'mood.sleeping': 'asleep',

    'panel.today': 'Today',
    'panel.name': 'Why this name',
    'panel.style': 'How you work',
    'panel.skills': 'Skills',
    'panel.battle': 'Latest bout',
    'panel.expedition': 'While you were away',
    'panel.trail': 'The last two weeks',
    'panel.achievements': 'Titles',
    'panel.history': 'All time',
    'panel.recap': 'The last month',

    // 節をまとめる見出し（ja と同じ 5 つ）
    'group.now': 'Now',
    'group.self': 'Who they are',
    'group.power': 'What they can do',
    'group.events': 'What happened',
    'group.record': 'The record',

    'row.dailyExp': 'EXP today',
    'row.mood': 'Right now',
    'foot': 'Read-only · served from your own machine',

    'persona.unsettled': 'still forming',
    'persona.hint': 'Keep working — a name will grow out of how you work',
    'persona.note':
      'Decided by the last two weeks of tool use. Change how you work and the name changes with it — not one character of your prompts is ever read',
    'persona.since': ({ day }) => `Called this since ${day}`,
    'persona.changed': ({ day, before }) => `Since ${day}. Before that, ${before}`,
    'jobs.count': ({ n }) => (n === 1 ? 'Roles held' : `Roles held · ${n}`),
    'jobs.level': ({ n }) => `Lv${n}`,
    'jobs.note': 'Each role levels on its own, apart from the overall level',
    'badge.rough': 'The ones that did not go well',
    'badge.locked': ({ n }) => `${n} more, not yet`,

    'level.into': ({ into, span }) => `${into} / ${span} EXP`,
    'level.next': ({ n }) => `${n} EXP to next level`,
    'level.max': 'At the cap',
    'exp.unit': ({ n }) => `${n} EXP`,

    'trail.empty': 'A quiet two weeks',
    'trail.summary': ({ days, worked, trend }) => `Worked ${worked} of ${days} days — ${trend}`,
    'trail.up': 'picking up from last week',
    'trail.down': 'last week ran harder',
    'trail.flat': 'about the same as last week',

    'style.recovery': 'Recovered after stumbling',
    'style.stumble': 'Tool calls that failed',
    'style.perSession': 'Tools per session',
    'style.perPrompt': 'Tools per instruction',
    'style.age': 'Age',
    'style.days': ({ n }) => `${n} days`,
    'style.times': ({ n }) => `${n}`,
    'style.chasing': ({ ja, n }) => `${n} more to overtake ${ja}`,
    'style.none': 'No tools used yet',

    'note.recovery': 'Share of failed tool calls you got through on the spot',
    'note.stumble': 'Share of tool calls that came back with nothing',
    'note.perSession': 'Tool calls between sitting down and walking away',
    'note.perPrompt': 'Tool calls set off by one instruction',

    // 「1 times to go」を出さない。英語では単複がそのまま雑さに見える
    'panel.hexagon': 'Stats',
    'hex.atk': 'ATK',
    'hex.def': 'DEF',
    'hex.spd': 'SPD',
    'hex.skill': 'SKL',
    'hex.depth': 'DPT',
    'hex.keep': 'GRT',
    'hex.note': 'The middle ring is the average pet at your level',

    'hexfull.atk': 'Attack',
    'hexfull.def': 'Defence',
    'hexfull.spd': 'Speed',
    'hexfull.skill': 'Skill',
    'hexfull.depth': 'Depth',
    'hexfull.keep': 'Streak',
    'note.atk': 'How hard it pushes (gear included)',
    'note.def': 'How much it takes (gear included)',
    'note.spd': 'How often it moves first (gear included)',
    'note.skill': 'Every skill tier, added up',
    'note.depth': 'How far down the dungeon it has gone',
    'note.keep': 'Days worked in the last two weeks',
    'hex.mult': ({ n }) => `${n}x the average`,

    'panel.dungeon': 'The Dungeon',
    'dungeon.floor': ({ n }) => `Floor ${n}`,
    'dungeon.none': 'Not down there yet',
    'dungeon.equipped': 'Equipped',
    'dungeon.recent': 'Recent finds',
    'dungeon.bonus': ({ n }) => `+${n}%`,
    'dungeon.at': ({ n }) => `floor ${n}`,
    'dungeon.note': 'Deeper floors drop better gear. Anything better is equipped for you',
    'dungeon.bosses': 'Left behind',
    'dungeon.passed': ({ floor, name }) => `Floor ${floor} · ${name}`,

    // 「1 times to go」を出さない。英語では単複がそのまま雑さに見える
    'skill.remaining': ({ n, unit }) => `${n} ${n === '1' ? String(unit).replace(/s$/, '') : unit} to go`,
    'skill.max': 'mastered',
    'skill.none': 'No skills yet',
    'skill.effectHead': 'Now',

    'skilleffect.fortitude': ({ pct }) =>
      pct >= 100 ? 'Always survives one killing blow per bout' : `Survives one killing blow per bout ${pct}% of the time`,
    'skilleffect.summon': ({ pct }) => `A double strikes ${pct}% of the time`,
    'skilleffect.foresight': ({ pct }) => `Speed +${pct}%`,
    'skilleffect.nightVision': ({ pct }) => `Attack and speed +${pct}% in night bouts only`,
    'skilleffect.mnemonic': ({ n }) => `Shakes off up to ${n} weakening spells`,

    'battle.locked': ({ level }) => `Sparring starts at Lv${level}`,
    'battle.every': ({ hours }) => `A bout every ${hours} hours`,
    'battle.practice': 'sparring partner',
    'battle.practiceNote': 'Not enough real opponents yet — this was a sparring partner',
    'battle.vs': ({ name, className }) => `vs ${name} (${className})`,
    'battle.win': 'win',
    'battle.lose': 'loss',
    'battle.draw': 'draw',
    'battle.turns': ({ n }) => `${n} turns`,
    'battle.nightTag': 'before dawn',
    'battle.note': "The opponent's level is never shown. Not knowing is why you come back and look",

    'trip.head': ({ hours }) => `${hours} hours of house-sitting turned up:`,
    'trip.one': ({ ja }) => `Found ${ja}`,
    'trip.many': ({ n }) => `${n} things brought back`,
    'away.gear': 'Gear',

    'recap.span': ({ from, to }) => `${from} – ${to}`,
    'recap.worked': 'Days you worked',
    'recap.exp': 'Experience earned',
    'recap.tools': 'Tools swung',
    'recap.prompts': 'Instructions given',
    'recap.sessions': 'Times you sat down',
    'recap.best': 'Biggest day',
    'recap.bestValue': ({ day, n }) => `${day} (${n} exp)`,
    'recap.days': ({ n }) => `${n} days`,
    'recap.note': 'Only what already happened. No targets, no comparisons',

    'anniv.days': ({ n }) => `${n} days together, as of today`,
    'anniv.years': ({ n }) => (n === 1 ? 'One year together, as of today' : `${n} years together, as of today`),

    'sleep.build1': '...it passed...',
    'sleep.build2': '...one more time...',
    'sleep.read1': '...almost there...',
    'sleep.read2': '...I was looking...',
    'sleep.write1': '...fixed it...',
    'sleep.write2': '...like this, here...',
    'sleep.out1': '...far away...',
    'sleep.plain1': 'mnh...',
    'sleep.plain2': '...hh...',
    'sleep.plain3': '...mm...',

    'dream.boss': ({ ja }) => `...dreaming of ${ja}...`,
    'dream.job': ({ ja }) => `...back when I was ${ja}...`,
    'dream.gear': ({ ja }) => `...still holding the ${ja}...`,
    'dream.floor': ({ ja }) => `...the lights on floor ${ja}...`,
    'dream.badge': ({ ja }) => `...the day of ${ja}...`,

    'achievement.count': ({ got, total }) => `${got} / ${total}`,
    'achievement.locked': 'Not yet',

    'log.first': ({ who }) => `${who} moves first`,
    'log.night': ({ who }) => `A bout before dawn. ${who} is wide awake`,
    'log.hit': ({ who, other, amount, hp }) => `${who} hits for ${amount} (${other} at ${hp})`,
    'log.crit': ({ who, other, amount, hp }) => `${who} lands a critical for ${amount} (${other} at ${hp})`,
    'log.swift': ({ who, other, amount, hp }) => `${who} presses the speed for ${amount} (${other} at ${hp})`,
    'log.summon': ({ who, other, amount, hp }) => `${who}'s double follows up for ${amount} (${other} at ${hp})`,
    'log.fortitude': ({ who }) => `${who} refuses to fall (1 HP left)`,
    'log.weaken': ({ who, other }) => `${who} dulls ${other}'s attack`,
    'log.cleanse': ({ who }) => `${who} shakes it off`,
    'log.timeup': 'Time. Decided on remaining HP',
    'log.end': ({ who }) => `${who} wins`,
    'log.drawEnd': 'Draw',
    'log.matchup': (m) => `${m.winner.en} has the edge on ${m.loser.en} — ${m.reason.en}`,

    'impression.draw': 'Both went down together',
    'impression.winBig': 'Never in danger',
    'impression.win': 'Won the close one',
    'impression.winThin': 'Scraped through',
    'impression.loseBig': 'Never stood a chance',
    'impression.lose': 'Pushed over',
    'impression.loseThin': 'One step short',

    'say.levelup': ({ level }) => `Lv${level}!`,
    'say.job': ({ before, after }) => `${before} → ${after}`,
    'say.achievements': ({ n }) => `${n} badges!`,
    'say.gear': ({ label }) => `Equipped ${label}!`,
    'say.floor': ({ n }) => `Floor ${n}!`,
    'say.boss': ({ name }) => `Past ${name}`,

    'trait.toolCalls': 'Tool calls',
    'trait.prompts': 'Instructions received',
    'trait.sessions': 'Sessions',
    'trait.comebacks': 'Recoveries after a failure',
    'trait.failures': 'Failures',
    'trait.compacts': 'Long hauls survived',
    'trait.nightOwl': 'Small hours',
    'trait.none': 'Nothing yet',
    'note.toolCalls': 'Bash, Read, Edit — all of them together',
    'note.prompts': 'Things you asked for',
    'note.sessions': 'Times you sat down. Back after 45 minutes counts as the next one',
    'note.compacts': 'Runs that carried across a compact',
    'note.comebacks': 'Failed tool calls you got through on the spot',
    'note.failures': 'Tool calls that came back with nothing',
    'note.nightOwl': 'Work done between midnight and 5am',
  },
};

/** 桁区切りの出し方。日本語と英語で同じ形だが、言語を 1 箇所に閉じておく。 */
export function numberLocale(lang) {
  return lang === 'ja' ? 'ja-JP' : 'en-US';
}

/** 数字を、その言語の桁区切りで。 */
export function fmtNum(value, lang) {
  return Number(value || 0).toLocaleString(numberLocale(lang));
}

/** 文言を引く。無い ID は日本語に落ち、それも無ければ ID をそのまま返す。 */
export function t(lang, id, params) {
  const table = MESSAGES[lang] || MESSAGES[DEFAULT_LANG];
  const entry = table[id] ?? MESSAGES[DEFAULT_LANG][id];
  if (entry === undefined) return id;
  return typeof entry === 'function' ? entry(params || {}) : entry;
}

export const MESSAGE_IDS = Object.keys(MESSAGES[DEFAULT_LANG]);

/**
 * 画面の**動かない文字**（見出し・行のラベル・注記）をまとめて渡す。
 *
 * スマホのページと オーバーレイは素のスクリプトで、ES モジュール（この
 * ファイル）を読めない。だから view.js が言語で解いたものを一緒に送る
 * ── 文言の出どころを 2 つにしないための逃げ道。
 */
export function chrome(lang) {
  const table = MESSAGES[lang] || MESSAGES[DEFAULT_LANG];
  const out = {};
  for (const id of MESSAGE_IDS) {
    // 差し込みの要る文（関数）はここでは解けない。動かない文字だけ渡す
    const value = table[id] ?? MESSAGES[DEFAULT_LANG][id];
    if (typeof value === 'string') out[id] = value;
  }
  return out;
}
