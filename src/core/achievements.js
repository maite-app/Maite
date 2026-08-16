import { TYPES } from './persona.js';

/*
 * **称号は大げさに、説明は素っ気なく。落差が笑いになる。**
 *
 * 説明のうしろに全角スペースで一拍おいて、短い一言を足してある（poalo・2026-08-16）。
 * 装備の名前（`dungeon.js` の「金曜反映の大槌」「責を問わぬ検証の法衣」）と同じ手触りで、
 * **実績だけが真面目なままだった**のを揃えた。
 *
 * 足すときの縛りは 3 つ:
 *   1. **称号の格は落とさない。** 落差は説明側で作る ── 両方くだけると、ただ軽いだけになる
 *   2. **数字を消さない。** 何をしたら取れたのかが分からなくなる
 *   3. **責めない。** 特に `rough` の側 ── うまくいかなかったほうの称号は、
 *      責める言葉を使わない・作業を止める理由にしない（CLAUDE.md）
 */

/**
 * 実績 ── 後から貼られるバッジ。
 *
 * **目標にはしない。** デイリーミッションを作らないと決めている以上（DESIGN.md §3, §5）、
 * 実績も「これを狙って作業を変える」ものであってはいけない。だから条件は全部
 * **普段どおり働いていれば勝手に満たされる量**にしてあり、期限も、連続日数も、
 * 取り逃がしも無い。振り返って「そんなに叩いたのか」と気づくためだけのもの。
 *
 * スキルや戦闘と違って、これだけは state に保存する。**獲得した瞬間**が要るため
 * ── 現在の traits からは「いつ超えたか」を復元できない。ただし記録するのは
 * events.jsonl を畳む途中の時刻なので、畳み直せば同じ時刻が再現される
 * （applyEvent の純粋性は保たれたまま）。
 */

/**
 * 条件は「その時点の state」だけを見る純粋な述語。
 * イベントの中身は見ない ── 見ると畳み直しで結果が変わりうる。
 *
 * 第 2 引数の ctx は growth.js から渡ってくる（上限レベルと、いまの型）。
 * ここから growth.js を import すると循環参照になるので、値のほうを受け取る。
 */
export const ACHIEVEMENTS = {
  firstStep: {
    en: 'First Step', ja: 'はじめの一歩',
    blurbEn: 'Took your first instruction. Nothing has happened yet', blurb: '最初の指示を受けた　まだ 何もしていない',
    test: (s) => s.traits.prompts >= 1,
  },
  awakened: {
    en: 'Awakened', ja: '目覚め',
    blurbEn: 'Settled into a class. Nobody chose it', blurb: '系統が決まった　誰も決めていないのに 決まった',
    test: (s) => Boolean(s.classId),
  },
  phoenix: {
    en: 'Phoenix', ja: '不死鳥',
    blurbEn: 'Fixed a failing tool on the spot, with a straight face', blurb: '失敗したツールを その場で成功させ直した　何事もなかった顔で',
    test: (s) => s.traits.comebacks >= 1,
  },
  longHaul: {
    en: 'Long Haul', ja: '長丁場',
    blurbEn: 'Kept going across a compact. The first half is gone', blurb: 'compact をまたいで作業を続けた　前半の記憶は 無い',
    test: (s) => s.traits.compacts >= 1,
  },
  hundredHands: {
    en: 'Hundred Hands', ja: '百手',
    blurbEn: '100 tool calls. Still only a hundred', blurb: 'ツールを 100 回使った　まだ 百手',
    test: (s) => s.traits.toolCalls >= 100,
  },
  thousandHands: {
    en: 'Thousand Hands', ja: '千手',
    blurbEn: '1,000 tool calls. As many hands as the merciful one', blurb: 'ツールを 1,000 回使った　観音様と 同じ数',
    test: (s) => s.traits.toolCalls >= 1000,
  },
  tenThousandHands: {
    en: 'Ten Thousand Hands', ja: '万手',
    blurbEn: '10,000 tool calls. We stopped counting (we did not)', blurb: 'ツールを 10,000 回使った　数えるのは やめた（数えている）',
    test: (s) => s.traits.toolCalls >= 10000,
  },
  unbroken: {
    en: 'Unbroken', ja: '折れない心',
    blurbEn: 'Recovered 50 times. Bent, though', blurb: '50 回立て直した　折れかけては いる',
    test: (s) => s.traits.comebacks >= 50,
  },
  nightWatch: {
    en: 'Night Watch', ja: '夜警',
    blurbEn: '50 tool calls between 0:00 and 5:00. Guarding a screen', blurb: '0〜5 時に 50 回手を動かした　見張っていたのは 画面',
    test: (s) => s.traits.nightOwl >= 50,
  },
  marathon: {
    en: 'Marathon', ja: '完走',
    blurbEn: 'Survived 20 long hauls. Distance unknown', blurb: '長丁場を 20 回乗り切った　走った距離は 誰も知らない',
    test: (s) => s.traits.compacts >= 20,
  },
  centurion: {
    en: 'Centurion', ja: '百戦',
    blurbEn: '100 sessions. Seasoned by a hundred battles, minus the seasoning', blurb: '100 のセッションをこなした　百戦錬磨まで あと 錬磨',
    test: (s) => s.traits.sessions >= 100,
  },
  polymath: {
    en: 'Polymath', ja: '五道',
    blurbEn: 'Used tools from all five classes. A little of each', blurb: '5 つの系統すべてのツールを使った　どれも 少しずつ',
    test: (s) => Object.values(s.classVector).every((v) => v > 0),
  },
  journeyman: { en: 'Journeyman', ja: '一人前', blurbEn: 'Reached Lv10. A crown appears. Nothing else changes', blurb: 'Lv10 に届いた　冠が乗る　中身は そのまま', test: (s) => s.level >= 10 },
  veteran: { en: 'Veteran', ja: '熟練', blurbEn: 'Reached Lv30', blurb: 'Lv30 に届いた', test: (s) => s.level >= 30 },
  master: { en: 'Master', ja: '達人', blurbEn: 'Reached Lv50', blurb: 'Lv50 に届いた', test: (s) => s.level >= 50 },
  centenary: { en: 'Hundredth Floor', ja: '百階', blurbEn: 'Reached Lv100', blurb: 'Lv100 に届いた', test: (s) => s.level >= 100 },

  /*
   * ここから下は**長い尻尾**。
   *
   * 実測（1 日 250 ツールの働き方）で、上のぶんは **6 日で 8 個、40 日で 11 個**
   * 出てしまい、そこから先は何年やっても増えなかった ── 振り返って気づくための
   * ものが、最初の 1 週間で終わっていた。
   *
   * 足すぶんも条件は同じ考え方で、**期限も連続日数も進捗バーも付けない**
   * （付けた瞬間にデイリーミッションになる。DESIGN.md §5b）。ぜんぶ
   * 「普段どおり働いていれば、いつの間にか超えている量」に置いてある。
   */
  hundredThousandHands: {
    en: 'Hundred Thousand Hands', ja: '十万手',
    blurbEn: '100,000 tool calls', blurb: 'ツールを 100,000 回使った',
    test: (s) => s.traits.toolCalls >= 100000,
  },
  ironWill: {
    en: 'Iron Will', ja: '不撓',
    blurbEn: 'Recovered 1,000 times. Which is to say: fell 1,000 times', blurb: '1,000 回立て直した　1,000 回 転んだとも言う',
    test: (s) => s.traits.comebacks >= 1000,
  },
  thousandNights: {
    en: 'Thousand Nights', ja: '千夜',
    blurbEn: '1,000 tool calls between 0:00 and 5:00. Not one story was told', blurb: '0〜5 時に 1,000 回手を動かした　物語は 一つも生まれていない',
    test: (s) => s.traits.nightOwl >= 1000,
  },
  ultramarathon: {
    en: 'Ultramarathon', ja: '長征',
    blurbEn: 'Survived 200 long hauls. Nobody mentioned a destination', blurb: '長丁場を 200 回乗り切った　目的地の話は 出ていない',
    test: (s) => s.traits.compacts >= 200,
  },
  thousandSessions: {
    en: 'Thousand Sessions', ja: '千戦',
    blurbEn: '1,000 sessions. Undefeated at sitting down', blurb: '1,000 のセッションをこなした　席に着いた回数だけは 負けない',
    test: (s) => s.traits.sessions >= 1000,
  },
  allRounder: {
    en: 'All Five Ways', ja: '五道皆伝',
    blurbEn: '1,000 tool calls in every class. There is no certificate', blurb: '5 つの系統すべてを 1,000 回ずつ通った　皆伝の証は 特に無い',
    test: (s) => Object.values(s.classVector).every((v) => v >= 1000),
  },
  anniversary: {
    en: 'One Year', ja: '一周年',
    blurbEn: 'A year together. No party was planned', blurb: '相棒になって 1 年が経った　祝う準備は していない',
    // 放置でも進む。だから「やらせる」力を持たない ── ここに置いていい種類のもの。
    test: (s) => s.bornAt > 0 && s.lastEventAt - s.bornAt >= 365 * 24 * 60 * 60 * 1000,
  },
  /*
   * **うまくいかなかったほうの記録。**
   *
   * 良い数字だけ貼ると、褒めるためだけの飾りになる ── 実際にやっているのは
   * 空振りと戻りの繰り返しなので、そちらも残しておくほうが振り返りとして正しい。
   *
   * 3 つとも守っていること：**狙って取れない**（取りに行く意味が無い量にしてある）、
   * **人を落とさない**（責める言葉を使わない。落とす相手はここには居ない）、
   * **止めない**（「休んでいい」までは言うが、作業を止める理由にはしない）。
   */
  mistakesWereMade: {
    en: 'Mistakes Were Made', ja: 'やらかし',
    blurbEn: '100 tool calls came back with nothing. We will blame the tools', blurb: '100 回 道具が空を切った　道具のせいに しておく',
    rough: true,
    test: (s) => s.traits.failures >= 100,
  },
  emptySwings: {
    en: 'A Thousand Empty Swings', ja: '空振り千本',
    blurbEn: '1,000 tool calls came back with nothing — and you kept going. Swings count as practice',
    blurb: '1,000 回空を切って それでも手を止めなかった　素振りも 練習のうち',
    rough: true,
    test: (s) => s.traits.failures >= 1000,
  },
  overtime: {
    en: 'Called It A Day', ja: '働きすぎ',
    blurbEn: 'Hit the daily cap. That is enough for one day',
    blurb: 'ひと日の上限まで稼いだ　もう休んでいい',
    rough: true,
    test: (s, ctx) => Boolean(ctx.dailyCap) && s.daily.exp >= ctx.dailyCap,
  },
  theLongWayRound: {
    en: 'The Long Way Round', ja: '遠回り',
    blurbEn: 'More swings missed than caught, 300 times over. A road is a road',
    blurb: '立て直した数より 空を切った数のほうが多いまま 300 回を越えた　道は 道',
    rough: true,
    test: (s) => s.traits.failures >= 300 && s.traits.failures > s.traits.comebacks,
  },

  farHall: { en: 'Two Hundredth Floor', ja: '二百階', blurbEn: 'Reached Lv200', blurb: 'Lv200 に届いた', test: (s) => s.level >= 200 },
  skyward: { en: 'Five Hundredth Floor', ja: '五百階', blurbEn: 'Reached Lv500', blurb: 'Lv500 に届いた', test: (s) => s.level >= 500 },
  summit: { en: 'Summit', ja: '頂', blurbEn: 'Climbed to the cap', blurb: '上限まで登りきった', test: (s, ctx) => s.level >= ctx.maxLevel },
};

/*
 * **なった職。** 名前（＝型）が変わるたびに、その職に「なったことがある」印が残る。
 *
 * `state.jobs`（変わった記録）は直近ぶんしか持たないので、そちらが流れても
 * こちらは残る ── **どの職を渡り歩いたか**は、後から振り返るためのものだから。
 *
 * **まだなっていない職は一覧に出さない**（`hidden`）。出した瞬間に
 * 「16 個集める」チェックリストになり、集めるために働き方を変える話になる
 * ── それはデイリーミッションと同じ（DESIGN.md §5b）。
 * なった後に「そういえば あの頃は罠師だった」と気づくためだけに置く。
 */
for (const [key, type] of Object.entries(TYPES)) {
  ACHIEVEMENTS[`job:${key}`] = {
    ja: `${type.ja}になった`,
    en: `Became a ${type.en}`,
    blurb: type.blurb,
    blurbEn: type.blurbEn,
    hidden: true,
    job: true,
    test: (s, ctx) => Boolean(ctx.persona && ctx.persona.settled && ctx.persona.key === key),
  };
}

export const ACHIEVEMENT_IDS = Object.keys(ACHIEVEMENTS);

/** 一覧に出すもの（まだのものを見せる用）。なった職は earned になるまで隠す。 */
export const VISIBLE_IDS = ACHIEVEMENT_IDS.filter((id) => !ACHIEVEMENTS[id].hidden);

/**
 * 満たした実績を state に刻む。**渡された state を直接書き換える。**
 *
 * applyEvent が structuredClone した後のオブジェクトに対して呼ぶ前提。
 * 外から単体で呼ぶものではない（純関数の境界は applyEvent 側にある）。
 *
 * 返すのは、この 1 イベントで新しく獲得した ID。
 */
export function stampUnlocked(state, now, ctx = {}) {
  const fresh = [];
  for (const id of ACHIEVEMENT_IDS) {
    if (state.achievements[id]) continue;
    if (ACHIEVEMENTS[id].test(state, ctx)) {
      state.achievements[id] = now;
      fresh.push(id);
    }
  }
  return fresh;
}

/** 獲得済みを新しい順に。表示用。 */
export function unlockedList(state) {
  return ACHIEVEMENT_IDS.filter((id) => state.achievements[id])
    .map((id) => ({
      id,
      ja: ACHIEVEMENTS[id].ja,
      blurb: ACHIEVEMENTS[id].blurb,
      // うまくいかなかったほう。並びは同じで、色だけ変える
      rough: Boolean(ACHIEVEMENTS[id].rough),
      at: state.achievements[id],
    }))
    .sort((a, b) => b.at - a.at);
}

/**
 * まだのもの。定義順（だいたい easy → hard に並べてある）。
 * **隠しぶん（なった職）は出さない** ── 集めに行くものにしないため。
 */
export function lockedList(state) {
  return VISIBLE_IDS.filter((id) => !state.achievements[id]).map((id) => ({
    id,
    ja: ACHIEVEMENTS[id].ja,
    blurb: ACHIEVEMENTS[id].blurb,
    rough: Boolean(ACHIEVEMENTS[id].rough),
  }));
}

/** なったことのある職。獲った順（古い順）に並べる ── 渡り歩いた道として読む。 */
export function jobBadges(state) {
  return ACHIEVEMENT_IDS.filter((id) => ACHIEVEMENTS[id].job && state.achievements[id])
    .map((id) => ({ id, ja: ACHIEVEMENTS[id].ja, blurb: ACHIEVEMENTS[id].blurb, at: state.achievements[id] }))
    .sort((a, b) => a.at - b.at);
}
