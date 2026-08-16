/**
 * 見た目 ── 何を着けていて、どこまで育ったか。
 *
 * ## なぜ要るのか
 *
 * **Lv15 から先、見た目が一切変わらなかった。** 触角（Lv3）・冠（Lv10）・
 * オーラ（Lv15）で打ち止めで、大きさすら Lv13 で頭打ち ── そこから Lv999 まで、
 * 同じ姿のままだった。Habitica の課題管理に立っている「Lv100 から上は上がらない
 * のに**見返りも無い**」の、見返りが無いほうがそのまま起きていた。
 *
 * 曲線を寝かせて数字が動くようにしても、**Lv50 と Lv500 の子が同じ姿**なら飽きる。
 *
 * ## どうやって数百通りにするか
 *
 * **絵を数百枚描かない。** 重ねる層を掛け算する（DESIGN.md §9 の「スプライトの
 * レイヤー化」）。
 *
 *   武器の型 6 × 守りの型 5 × 速さの型 4       =        120
 *   × それぞれの位 5 段（色）                  =     15,000
 *   × 育ちの段 9                               =    135,000
 *   × 顔まわりの小物 192                       = 25,920,000
 *   × 系統の色 5 × スキン 5 × 型の顔つき 16    =    103 億
 *
 * **どれも保存しない。** 装備は「個体の種 + 階」から毎回引き直す導出値
 * （dungeon.js）なので、潜るたびに勝手に変わる ── つまり**働いていれば、
 * 放っておいても姿が変わり続ける**。
 *
 * ここが返すのはクラス名の配列だけで、実際の絵は pet-svg.js、
 * 出し分けは style.css。**描画側で条件を書かない**（オーバーレイとスマホで
 * 別々に育つのを避ける）。
 */

/**
 * 育ちの段。**節目は実績（achievements.js）と同じ位置に置く** ──
 * 「熟練（Lv30）を獲った日に角が生えた」が揃っていないと、どちらも薄くなる。
 *
 * 0 … まだ何も付いていない
 * 1 … 触角（Lv3・系統が決まった合図）
 * 2 … 冠（Lv10）
 * 3 … オーラ（Lv15）
 * 4 … 角（Lv30・熟練）
 * 5 … 尾（Lv50・達人）
 * 6 … 浮く（Lv100・百階）
 * 7 … 二重のオーラ（Lv200・二百階）
 * 8 … 紋（Lv500・五百階）
 */
export const LOOK_TIERS = [
  { tier: 1, level: 3, id: 'antenna' },
  { tier: 2, level: 10, id: 'crown' },
  { tier: 3, level: 15, id: 'aura' },
  { tier: 4, level: 30, id: 'horns' },
  { tier: 5, level: 50, id: 'tail' },
  { tier: 6, level: 100, id: 'float' },
  { tier: 7, level: 200, id: 'halo' },
  { tier: 8, level: 500, id: 'sigil' },
];

/** そのレベルで開いている段（0..8）。 */
export function tierFor(level) {
  let tier = 0;
  for (const step of LOOK_TIERS) if (level >= step.level) tier = step.tier;
  return tier;
}

/**
 * 大きさ。**頭打ちを Lv13 から Lv999 に伸ばした。**
 *
 * 前は `min(1.12, 0.82 + level * 0.024)` で、**Lv13 で 1.12 に張り付いていた**
 * ── 一次で伸ばすと上限に当たるのが早すぎる。対数なら、伸び幅は小さいまま
 * 最後まで動き続ける。
 *
 * **上限 1.14 はオーバーレイの窓に合わせた数字。** 窓は 200x200 ちょうどで、
 * 装備はいちばん外で x=186 まで出る（翼）。拡大の基点が (100, 166) なので、
 * 1.14 を超えると 100 + (186-100) × s > 198 ── **窓の外に出て切れる**。
 * 大きくして見せるのではなく、**角・尾・輪・紋と装備のほうで育ちを見せる**。
 */
export const MAX_SCALE = 1.14;

export function scaleFor(level) {
  const grown = 0.86 + Math.log10(Math.max(1, level)) * 0.093;
  return Math.min(MAX_SCALE, Math.round(grown * 1000) / 1000);
}

/**
 * 使い込み ── **一緒にいた長さが、そのまま傷になる。**
 *
 * ## これは「劣化」であって「衰え」ではない
 *
 * 長く使った道具に傷が入り、体に古傷が増える。**性能は 1 も落ちない。**
 * 歴戦の証であって、罰ではない。
 *
 * **放置で弱らせない**（DESIGN.md §3）── 休んだら体力が落ちる・レベルの
 * 上がりが鈍る、はやらないと決めている。やった瞬間、これは「世話をしないと
 * いけないもの」になり、**見守ってくれる側**から**世話される側**に移る。
 * 「普段どおり仕事をするだけでいい」が壊れる。
 *
 * だからここが見ているのは**経過日数だけ**で、休んでいた日も同じように数える
 * ── 離れていた時間も、一緒にいた時間のうち。
 *
 * 0 … おろしたて
 * 1 … 使い込まれてきた（30 日）
 * 2 … 年季が入った（120 日）
 * 3 … 満身創痍（1 年）
 */
export const PATINA_DAYS = [30, 120, 365];

export function patinaFor(ageDays) {
  let step = 0;
  for (const at of PATINA_DAYS) if (ageDays >= at) step += 1;
  return step;
}

/**
 * ケガ ── **負けた一戦から、しばらくのあいだだけ。**
 *
 * 「久しぶりに見たら怪我して帰ってきていた」を作るためのもの。
 *
 * ## なぜ罰にならないか
 *
 * **何もしなくても勝手に治る。** 手当ての操作は無いし、その間 弱ってもいない
 * （数字には 1 も効かない）── 治すために開く理由を作らないので、
 * 「世話をしないといけないもの」にならない（DESIGN.md §3）。
 *
 * **保存もしない。** 一戦は 2 時間ごとの種から導出しているので、負けたかどうかも、
 * その一戦がいつ終わったかも計算で出る ── だから state は 1 バイトも増えない。
 *
 * 効き目はもう 1 つある：**戦闘ログを読みに行く理由**になる。いま戦闘は
 * 「たまに見かけるしぐさ」まで降ろしてあるので（DESIGN.md §5c）、
 * 開かない人は一戦の中身を一生見ない ── 傷が付いていれば「何があった」と思う。
 *
 * ## なぜ 1 時間なのか
 *
 * 一戦は 2 時間ごとで、実際に育てた個体の勝率は 45〜65%（CLAUDE.md の線）。
 * **一戦まるごと（2 時間）を傷のままにすると、だいたい 4 割の時間は傷だらけ**
 * になる ── それはもう「ケガをしている子」ではなく「そういう見た目の子」で、
 * 見かけたときの「何があった」が消える。半分に切ると 2 割前後 ──
 * たまに見かける量に落ちて、しかも**開いているあいだに治っていくのが見える**。
 */
export const HURT_HOURS = 1;

/**
 * いまケガをしているか。0 なら無傷、1..2 で深さ。
 *
 * `battle` は view の一戦（`{ winner, startedAt }`）。**負けたときだけ**で、
 * 引き分けは付かない。一戦が始まってから `HURT_HOURS` で消える ──
 * 半分を過ぎたら浅くなる（治りかけ）。
 */
export function hurtFor(battle, now) {
  if (!battle || battle.winner !== 'foe' || !battle.startedAt) return 0;
  const hours = (now - battle.startedAt) / 3600000;
  if (hours < 0 || hours >= HURT_HOURS) return 0;
  return hours < HURT_HOURS / 2 ? 2 : 1;
}

/**
 * 顔まわりの小物。**どれも働き方から出る。買えるものではない。**
 *
 * DESIGN.md §8c の「顔つきはスキンで買えない」は**お金で上書きさせない**という
 * 決まりであって、顔に何も足すなという話ではない ── ここに出るものは全部
 * 作業ログから生えているので、目つきや口元と出どころが同じ。だから顔に掛かって
 * よい（買えるスキンのほうは、いままでどおり顔に一切触らない）。
 *
 * **同じ場所のものは重ねない。** 段（`step`）が大きいほうだけが出る ──
 * 眼鏡とサングラスが同時に掛かったら、ただの絵の事故になる。

 * 🔴 **目元だけにする**（2026-08-16 の判断）。ひげ・マフラー・絆創膏・耳飾りを
 * 一度足したが、**素の顔の良さを消していた**ので枠ごと落とした。増やすなら
 * 「顔つきより目立たないか」を先に見る ── 顔が本体で、小物はおまけのほう。
 *
 * 条件は**普段どおり働いていれば、いつの間にか満たしている量**に置く
 * （実績と同じ縛り。狙って取りに行くものにしない）。
 */
export const ACCESSORIES = [
  /*
   * 目元 ── **サングラスは夜目から。** 0〜5 時に手を動かしてきた子が掛ける、
   * というのが唯一おかしくない出どころだった（眩しいのは朝のほう）。
   * 眼鏡は学者（Read / Grep / Glob）。
   */
  { id: 'glasses', spot: 'eyes', step: 1, from: (f) => f.classId === 'scholar' },
  { id: 'shades', spot: 'eyes', step: 2, from: (f) => f.nightTier >= 1 },
];

/**
 * いま出ている小物。**場所ごとに 1 つだけ**（段が大きいほうが勝つ）。
 *
 * `facts` … `{ ageDays, classId, nightTier, badges, traits }`
 */
export function accessoriesFor(facts) {
  const best = new Map();
  for (const item of ACCESSORIES) {
    if (!item.from(facts)) continue;
    const held = best.get(item.spot);
    if (!held || item.step > held.step) best.set(item.spot, item);
  }
  return [...best.values()].map((item) => item.id);
}

/**
 * 見た目を決めるクラス名。描画側はこれを `#stage` に付けるだけ。
 *
 * `equipped` は dungeon.js が返す装備（`{ slot, look, rarity }` を持つ）。
 * 空の枠は何も付けない ── まだ拾っていない枠は、素のまま見えていい。
 */
export function appearanceFor(level, equipped = [], facts = null) {
  const marks = [];
  const tier = tierFor(level);
  for (const step of LOOK_TIERS) if (tier >= step.tier) marks.push(`lk-${step.id}`);
  marks.push(`lk-t${tier}`);

  for (const item of equipped) {
    if (!item || !item.slot || !item.look) continue;
    // 型（何を持っているか）と、位（どれだけ光るか）を別のクラスで出す
    marks.push(`gw-${item.slot}-${item.look}`);
    if (item.rarity) marks.push(`gr-${item.slot}-${item.rarity}`);
  }

  const accessories = facts ? accessoriesFor(facts) : [];
  for (const id of accessories) marks.push(`ac-${id}`);

  // 使い込み。**見た目だけ**（数字には 1 も効かない）
  const patina = patinaFor(facts ? facts.ageDays || 0 : 0);
  marks.push(`pt-${patina}`);

  // 負けた一戦のあと、しばらくだけ。**勝手に治る**
  const hurt = facts ? hurtFor(facts.battle, facts.now || 0) : 0;
  if (hurt) marks.push(`hurt-${hurt}`);

  return { tier, scale: scaleFor(level), accessories, patina, hurt, marks };
}

/** 付け替えのときに、前のぶんを全部外すための一覧。 */
export function appearanceClasses(gear = []) {
  const out = LOOK_TIERS.map((s) => `lk-${s.id}`).concat(ACCESSORIES.map((a) => `ac-${a.id}`));
  for (let p = 0; p <= PATINA_DAYS.length; p += 1) out.push(`pt-${p}`);
  out.push('hurt-1', 'hurt-2');
  for (let t = 0; t <= LOOK_TIERS.length; t += 1) out.push(`lk-t${t}`);
  const slots = [...new Set(gear.map((g) => g.slot))];
  const looks = [...new Set(gear.map((g) => g.look))];
  const rarities = ['common', 'uncommon', 'rare', 'mystic', 'legend'];
  for (const slot of slots) {
    for (const look of looks) out.push(`gw-${slot}-${look}`);
    for (const rarity of rarities) out.push(`gr-${slot}-${rarity}`);
  }
  return out;
}
