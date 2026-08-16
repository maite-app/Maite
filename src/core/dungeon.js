/**
 * ダンジョン ── 作業量ぶんだけ深く潜り、深いほど良いものを持って帰る。
 *
 * **state には何も保存しない。** 到達した階層は traits から出る計算値で、
 * どの階で何を拾ったかは「その階の種」から毎回引き直す純関数
 * （skills.js / battle.js と同じ作り）。だから拾い物の中身や配分をいじっても
 * STATE_VERSION を上げずに済むし、events.jsonl を畳み直せば同じ装備が出る。
 *
 * 拾ったものを state に貯めるかどうかは DESIGN.md §9 の未決だった
 * ── **貯めずに済む形が見つかったので、貯めない。** 貯めると「消えると困る
 * もの」が増えて、ルールを変えるたびに移行の話になる。
 *
 * 留守番の土産（expedition.js）とは別物。あちらは**強さに一切関係しない**
 * 読みもので、こちらは実際にステータスに乗る。混ぜないこと。
 */
import { rngFrom, hashSeed } from './rng.js';
import { label, blurb, t } from './i18n.js';

/**
 * 作業量。**「打った文字数」は記録していない**ので（DESIGN.md §2b）、
 * 残っているもので測る ── 叩いた回数・受けた指示・こなしたセッション。
 *
 * 重みは「1 つあたりの重さ」で置いてある。セッションを 1 本立てるのは
 * ツールを 1 回叩くより 30 倍くらい大ごと、という感覚。
 */
export function effortFor(state) {
  const traits = state.traits || {};
  return (traits.toolCalls || 0) + (traits.prompts || 0) * 4 + (traits.sessions || 0) * 30;
}

/**
 * 到達階層。**平方根で伸ばす。**
 *
 * 線形にすると、1 年使った人の階層が 4 桁になって「深さ」の意味が消える。
 * 逆に対数だと、最初の 1 週間で伸びが止まって「潜っている感じ」が消える。
 *
 * 実測の目安（scripts/usage.mjs の分布から）：
 *
 *   1 日ぶん（200 回）      →  8 階
 *   3 週間ぶん（4,000 回）  → 37 階
 *   1 年ぶん（100,000 回）  → 158 階
 */
export function floorFor(state) {
  return Math.floor(Math.sqrt(effortFor(state)) / 2);
}

/**
 * 拾えるもの。**枠は 3 つだけ**（攻・守・速）にして、装備の話が
 * 「どれを着けるか」ではなく「何を拾ったか」で終わるようにしてある
 * ── 選ばせた瞬間に、育成のための操作が増える（DESIGN.md §3）。
 *
 * 名前は道具の名前をそのまま武具にしたもの。実在の人物・企業・製品を
 * 貶すものは入れない（expedition.js と同じ線）。
 */
export const GEAR = [
  // 攻 ── 手を動かす道具
  { id: 'dagger-debug', slot: 'atk', ja: 'デバッガの短剣', en: "Debugger's Dagger", look: 'blade' },
  { id: 'blade-grep', slot: 'atk', ja: 'grep の大剣', en: 'Greatsword of grep', look: 'blade' },
  { id: 'rapier-sed', slot: 'atk', ja: 'sed の細剣', en: 'Rapier of sed', look: 'blade' },
  { id: 'whip-regex', slot: 'atk', ja: '正規表現の鞭', en: 'Regex Whip', look: 'whip' },
  { id: 'hammer-force', slot: 'atk', ja: '強制反映の戦槌', en: 'Warhammer of Force Push', look: 'hammer' },
  { id: 'fang-segfault', slot: 'atk', ja: 'セグフォの牙', en: 'Segfault Fang', look: 'whip' },
  { id: 'dart-oneliner', slot: 'atk', ja: 'ワンライナーの投げ矢', en: 'One-Liner Dart', look: 'lance' },
  { id: 'axe-refactor', slot: 'atk', ja: '大改修の斧', en: 'Refactoring Axe', look: 'axe' },
  /*
   * ここから下は、いま出回っている言い回しから。**線は変えていない**
   * ── 誰もが心当たりのある状況だけを取って、実在の人物・企業・製品を
   * 名指しで落とすものは入れない（DESIGN.md / expedition.js と同じ）。
   * 人ではなく**現象**のほうを拾う。
   */
  { id: 'scimitar-vibe', slot: 'atk', ja: '気分まかせの曲刀', en: 'Vibe-Coding Scimitar', look: 'blade' },
  { id: 'maul-friday', slot: 'atk', ja: '金曜反映の大槌', en: 'Friday-Deploy Maul', look: 'hammer' },
  { id: 'lance-zeroday', slot: 'atk', ja: 'ゼロデイの穂先', en: 'Zero-Day Lance', look: 'lance' },
  { id: 'bow-bisect', slot: 'atk', ja: '二分探索の弓', en: 'Bisecting Bow', look: 'bow' },

  // 守 ── 壊れないようにする道具
  { id: 'shield-types', slot: 'def', ja: '型定義の盾', en: 'Shield of Type Definitions', look: 'shield' },
  { id: 'mail-trycatch', slot: 'def', ja: 'try-catch の鎖帷子', en: 'Chainmail of try/catch', look: 'plate' },
  { id: 'cloak-rollback', slot: 'def', ja: 'ロールバックの外套', en: 'Cloak of Rollback', look: 'cloak' },
  { id: 'plate-tests', slot: 'def', ja: '回帰テストの鎧', en: 'Plate of Regression Tests', look: 'plate' },
  { id: 'wall-linter', slot: 'def', ja: 'linter の鉄壁', en: 'Linter Bulwark', look: 'ward' },
  { id: 'ward-sandbox', slot: 'def', ja: 'サンドボックスの結界', en: 'Sandbox Ward', look: 'ward' },
  { id: 'helm-review', slot: 'def', ja: 'レビューの兜', en: 'Helm of Code Review', look: 'helm' },
  { id: 'guard-backup', slot: 'def', ja: 'バックアップの守り', en: 'Aegis of Backups', look: 'shield' },
  { id: 'barrier-flag', slot: 'def', ja: '切り替え札の障壁', en: 'Feature-Flag Barrier', look: 'ward' },
  { id: 'shield-breaker', slot: 'def', ja: '遮断器の盾', en: 'Circuit-Breaker Shield', look: 'shield' },
  // 「準備金を積んでおけば何があっても大丈夫」という、あの手の話
  { id: 'cuirass-reserve', slot: 'def', ja: '戦略準備金の胴当て', en: 'Strategic-Reserve Cuirass', look: 'plate' },
  { id: 'robe-blameless', slot: 'def', ja: '責を問わぬ検証の法衣', en: 'Blameless Postmortem Robe', look: 'cloak' },

  // 速 ── 待たずに済ませる道具
  { id: 'ring-cache', slot: 'spd', ja: 'キャッシュの指輪', en: 'Ring of Cache', look: 'orb' },
  { id: 'boots-tab', slot: 'spd', ja: 'タブ補完の靴', en: 'Boots of Tab Completion', look: 'dash' },
  { id: 'feather-reload', slot: 'spd', ja: 'ホットリロードの羽根', en: 'Hot-Reload Feather', look: 'wing' },
  { id: 'charm-index', slot: 'spd', ja: '索引の護符', en: 'Charm of the Index', look: 'orb' },
  { id: 'mantle-cdn', slot: 'spd', ja: '辺境配信のマント', en: 'Mantle of the Edge', look: 'wing' },
  { id: 'amulet-memo', slot: 'spd', ja: 'メモ化のお守り', en: 'Amulet of Memoization', look: 'orb' },
  { id: 'spur-parallel', slot: 'spd', ja: '並列実行の拍車', en: 'Spurs of Parallelism', look: 'dash' },
  { id: 'lens-profiler', slot: 'spd', ja: 'プロファイラの眼鏡', en: "Profiler's Lens", look: 'lens' },
  { id: 'wing-canary', slot: 'spd', ja: 'カナリアの翼', en: 'Canary Wing', look: 'wing' },
  { id: 'charm-coldstart', slot: 'spd', ja: 'コールドスタートの護符', en: 'Cold-Start Charm', look: 'orb' },
  { id: 'sigil-token', slot: 'spd', ja: 'トークン節約の刻印', en: 'Token-Thrift Sigil', look: 'orb' },
  { id: 'pin-shipit', slot: 'spd', ja: '「とりあえず出す」の留め針', en: 'Ship-It Pin', look: 'dash' },

  /*
   * 2026 のぶん。**枠ごとの数を揃えたまま足す**（攻 12 / 守 12 / 速 12）──
   * 偏らせると、その枠だけ同じものばかり出る。
   */
  { id: 'blade-agent', slot: 'atk', ja: '委任の采配', en: 'Baton of Delegation', look: 'blade' },
  { id: 'lance-mcp', slot: 'atk', ja: '差し込み口の穂先', en: 'Socket Lance', look: 'lance' },
  { id: 'whip-prompt', slot: 'atk', ja: '巻物の鞭', en: 'Whip of the Long Scroll', look: 'whip' },
  { id: 'hammer-rename', slot: 'atk', ja: '改名の大槌', en: 'Rebranding Maul', look: 'hammer' },
  { id: 'plate-guardrail', slot: 'def', ja: '柵の胸当て', en: 'Guardrail Plate', look: 'plate' },
  { id: 'ward-context', slot: 'def', ja: '文脈の結界', en: 'Context Ward', look: 'ward' },
  { id: 'helm-human', slot: 'def', ja: '輪の中の兜', en: 'Helm of the Loop', look: 'helm' },
  { id: 'cloak-audit', slot: 'def', ja: '監査の外套', en: 'Audit Cloak', look: 'cloak' },
  { id: 'orb-handoff', slot: 'spd', ja: '受け渡しの珠', en: 'Handoff Orb', look: 'orb' },
  { id: 'wing-parallel-agent', slot: 'spd', ja: '同時起動の翼', en: 'Wings of the Fan-Out', look: 'wing' },
  { id: 'lens-trace', slot: 'spd', ja: '足跡たどりの眼鏡', en: 'Trace-Reading Lens', look: 'lens' },
  { id: 'dash-autonomy', slot: 'spd', ja: '自律の目盛り', en: 'Autonomy Dial', look: 'dash' },
];

export const SLOTS = ['atk', 'def', 'spd'];

const GEAR_BY_ID = Object.fromEntries(GEAR.map((g) => [g.id, g]));

/**
 * 位。**深いほど良いものが出る**が、上の位は最後まで珍しいままにしてある
 * ── 毎回「秘」が出るなら、それは「並」と同じことになる。
 */
/**
 * 位。**深いほど良いものが出る**が、上の位は最後まで珍しいままにしてある
 * ── 毎回レジェンドが出るなら、それはコモンと同じことになる。
 *
 * **呼び名はゲームの共通語に寄せた。** 前は 並 / 上 / 稀 / 秘 だったが、
 * 「稀」と「秘」のどちらが上か、初見では読めない。コモン〜レジェンドなら
 * 説明が要らないし、色（灰→緑→青→紫→金）もそのまま通じる。
 *
 * `rank` は色の強さ（0..4）。CSS 側は `r-<id>` で受ける。
 */
export const RARITIES = [
  { id: 'common', rank: 0, ja: 'コモン', en: 'Common', mult: 1 },
  { id: 'uncommon', rank: 1, ja: 'アンコモン', en: 'Uncommon', mult: 1.8 },
  { id: 'rare', rank: 2, ja: 'レア', en: 'Rare', mult: 3 },
  { id: 'mystic', rank: 3, ja: 'ミスティック', en: 'Mystic', mult: 5 },
  { id: 'legend', rank: 4, ja: 'レジェンド', en: 'Legend', mult: 8 },
];

const RARITY_BY_ID = Object.fromEntries(RARITIES.map((r) => [r.id, r]));

/**
 * その階での位の出方。深さで良いほうに寄る。
 *
 * 1 階の時点でレジェンドが出ると、そのあと何を拾っても嬉しくない。逆に深さで
 * 際限なく寄せると、深い人の画面がレジェンドだらけになる ── 頭打ちを置いてある。
 *
 * **レジェンドは、いちばん深くても 25 回に 1 回まで。** 5 段に増やしたぶん
 * ミスティックが前の「秘」の位置（最深部で 12%）を引き継ぎ、その上に
 * ほとんど出ない段を 1 つ足した形にしてある ── 上が詰まっていないと、
 * 潜り続ける理由が階の数字だけになる。
 */
function rarityFor(rng, floor) {
  const roll = rng();
  // 頭打ちに届くのは 100 階あたり。50 階で止めていた頃は、3 週間で
  // 拾い物の質が固定されて「深く潜る意味」が階の数字だけになっていた
  // 浅いうちは 0。**レジェンドだけは、深さそのものが入場料**になっている
  const legend = Math.min(0.04, Math.max(0, floor - 10) / 4000);
  const mystic = legend + Math.min(0.12, floor / 900);
  const rare = mystic + Math.min(0.32, 0.04 + floor / 300);
  const uncommon = rare + 0.3;
  if (roll < legend) return RARITY_BY_ID.legend;
  if (roll < mystic) return RARITY_BY_ID.mystic;
  if (roll < rare) return RARITY_BY_ID.rare;
  if (roll < uncommon) return RARITY_BY_ID.uncommon;
  return RARITY_BY_ID.common;
}

/**
 * 装備が乗せる割合。**割合にする**のは、ステータスがレベルに比例して
 * 伸びるから ── 固定値だと、育つほど装備が誤差になる。
 *
 * 頭打ちは 1 枠あたり +40%。ここを外すと、年単位で使った個体の数字だけが
 * 別の桁になる。
 */
export const MAX_BONUS = 0.4;

export function bonusFor(rarity, floor) {
  return Math.min(MAX_BONUS, rarity.mult * 0.012 * (1 + floor / 50));
}

/**
 * 宿り ── 装備の中身。**同じ〈grep の大剣〉でも、中身が違う。**
 *
 * 拾い物の種類を増やしても、増えるのは名前の数だけで「1 個あたりの深さ」は
 * 変わらない。**深さは掛け算でしか増えない** ── 24 の装備 × 4 の位 ×
 * 12 の宿りが 0〜2 個で、組み合わせは数千通りになる。しかも増えたのは
 * 定義 12 行ぶんで、保存するものは相変わらず何も無い。
 *
 * 中身は 2 通りしかない。
 *
 * - `spread` … その装備の取り分を、どの枠に配り直すか。攻の武器に「軽さ」が
 *   宿れば速さにも乗る ── **同じ枠の装備でも、形が変わる**
 * - `skill` … 技を 1 段上げる。既にある段位の仕組み（`tierOf`）に乗るだけなので、
 *   戦闘のルールは 1 行も増えない
 *
 * **戦闘に新しい条件を足さない**のが線。「夜だけ効く」「格上にだけ効く」は
 * 書けてしまうが、そのたびに `scripts/balance.mjs` の測る軸が増えて、
 * どの数字が効いているのか誰にも分からなくなる。
 */
export const IMBUES = [
  // 枠を寄せる ── その装備が得意なほうに、さらに寄る
  { id: 'keen', ja: '鋭さ', en: 'Keen', blurb: '刃が通る', blurbEn: 'It bites deeper', spread: { atk: 1, def: 0, spd: 0 } },
  { id: 'solid', ja: '堅さ', en: 'Solid', blurb: '受けが利く', blurbEn: 'It holds the line', spread: { atk: 0, def: 1, spd: 0 } },
  { id: 'light', ja: '軽さ', en: 'Light', blurb: '手が早くなる', blurbEn: 'It moves before you do', spread: { atk: 0, def: 0, spd: 1 } },

  // 枠を散らす ── 攻の武器が守りにも効く、のような「形が変わる」宿り
  { id: 'balanced', ja: '釣り合い', en: 'Balanced', blurb: 'どこにも偏らない', blurbEn: 'Nothing leans', spread: { atk: 1, def: 1, spd: 1 } },
  { id: 'wary', ja: '用心', en: 'Wary', blurb: '攻めながら守る', blurbEn: 'Guards while it strikes', spread: { atk: 1, def: 2, spd: 0 } },
  { id: 'restless', ja: '落ち着かなさ', en: 'Restless', blurb: '止まっていられない', blurbEn: 'It will not sit still', spread: { atk: 1, def: 0, spd: 2 } },
  { id: 'patient', ja: '辛抱', en: 'Patient', blurb: '待って、確かめる', blurbEn: 'Waits, and makes sure', spread: { atk: 0, def: 2, spd: 1 } },

  // 技を 1 段上げる ── 既にある段位の仕組みに乗るだけ
  { id: 'unyielding', ja: '不屈の宿り', en: 'the Unyielding', blurb: '倒れにくくなる', blurbEn: 'Harder to put down', skill: 'fortitude' },
  { id: 'twinned', ja: '分身の宿り', en: 'the Twinned', blurb: '追撃が増える', blurbEn: 'The double comes more often', skill: 'summon' },
  { id: 'farsight', ja: '先読みの宿り', en: 'the Farseeing', blurb: '先手を取りやすい', blurbEn: 'Moves first more often', skill: 'foresight' },
  { id: 'remembered', ja: '記憶の宿り', en: 'the Remembered', blurb: '弱体を振り払う', blurbEn: 'Shakes off what sticks', skill: 'mnemonic' },
  { id: 'nightborn', ja: '夜目の宿り', en: 'the Nightborn', blurb: '未明に冴える', blurbEn: 'Sharp before dawn', skill: 'nightVision' },
];

const IMBUE_BY_ID = Object.fromEntries(IMBUES.map((i) => [i.id, i]));

/**
 * 宿りが 1 つ乗ると、その装備の取り分がどれだけ増えるか。
 *
 * **増やすのは総量ではなく、配り方のほう**が主。0.35 は「宿り 2 つで 1.7 倍」で、
 * 位が 1 段上がるより少し弱いくらい ── ここを大きくすると、位の差が誤差になる。
 */
const IMBUE_BOOST = 0.35;

/** 宿りの数。深いほど 2 つ乗りやすいが、無宿りも最後まで残る。 */
function imbueCountFor(rng, floor) {
  const roll = rng();
  const two = Math.min(0.3, floor / 400);
  const one = two + Math.min(0.45, 0.12 + floor / 200);
  if (roll < two) return 2;
  if (roll < one) return 1;
  return 0;
}

/**
 * その階で拾ったもの。階と個体の種だけで決まるので、何度呼んでも同じ。
 * 1 階につき 1 つ。
 */
export function findAt(seed, floor) {
  const rng = rngFrom(hashSeed(`${seed}:floor:${floor}`));
  const item = GEAR[Math.floor(rng() * GEAR.length)];
  const rarity = rarityFor(rng, floor);
  const bonus = bonusFor(rarity, floor);

  // 宿りは同じものを 2 つ付けない（「鋭さ・鋭さ」は 1 つと同じことなので）
  const imbues = [];
  const want = imbueCountFor(rng, floor);
  for (let i = 0; i < want; i += 1) {
    const pickedId = IMBUES[Math.floor(rng() * IMBUES.length)].id;
    if (!imbues.includes(pickedId)) imbues.push(pickedId);
  }

  const found = { ...item, floor, rarity: rarity.id, bonus, imbues };
  found.weight = weightOf(found);
  found.total = found.weight.atk + found.weight.def + found.weight.spd;
  return found;
}

/**
 * その拾い物ぶんの、枠ごとの取り分。
 *
 * 素の装備は自分の枠にだけ乗る。宿りが付くと、そのぶんが宿りの配分で散る
 * ── **同じ枠の装備でも、中身で形が変わる**のはここ。
 *
 * 技を上げる宿り（`skill`）は枠に乗らない。あちらは段位のほうで効く。
 */
export function weightOf(find) {
  const out = { atk: 0, def: 0, spd: 0 };
  if (!find) return out;
  out[find.slot] = find.bonus;

  for (const id of find.imbues || []) {
    const imbue = IMBUE_BY_ID[id];
    if (!imbue || !imbue.spread) continue;
    const share = imbue.spread.atk + imbue.spread.def + imbue.spread.spd;
    if (share <= 0) continue;
    const extra = find.bonus * IMBUE_BOOST;
    for (const slot of SLOTS) out[slot] += (extra * imbue.spread[slot]) / share;
  }

  // 1 枠あたりの頭打ちは素の装備と同じ。宿りで抜けられては意味がない
  for (const slot of SLOTS) out[slot] = Math.min(MAX_BONUS, out[slot]);
  return out;
}

/** その拾い物が上げる技と、上げ幅（同じ技に 2 つ宿れば 2 段）。 */
export function skillBoostOf(find) {
  const out = {};
  for (const id of (find && find.imbues) || []) {
    const imbue = IMBUE_BY_ID[id];
    if (imbue && imbue.skill) out[imbue.skill] = (out[imbue.skill] || 0) + 1;
  }
  return out;
}

/**
 * 主 ── 25 階ごとにいる。
 *
 * **狙えない。** 潜る深さは作業量で決まるので（`floorFor`）、主に会うために
 * できることは「普段どおり働く」しかない ── 実績と同じ線（DESIGN.md §5b）で、
 * 期限も取り逃がしも無いし、進捗バーも出さない。
 *
 * それでも実績とは別に置いているのは、**通過点は振り返るものではなく、
 * 道の形そのもの**だから。「地下 100 階で〈締切の亡霊〉を抜けた」は、
 * 何かを達成した話ではなく、そこまで潜ったという事実の言い換えになっている。
 *
 * 誰がいるかは (個体の種 + 階) から導出する。**人によって並びが違う。**
 * 全員に同じ主を置くと、階層が攻略表になる。
 */
export const BOSS_EVERY = 25;

export const BOSSES = [
  { id: 'deadline', ja: '締切の亡霊', en: 'Wraith of the Deadline', blurb: '追いつかれると、何もかも雑になる', blurbEn: 'Catch its eye and everything gets sloppy' },
  { id: 'flaky', ja: '気まぐれな試験', en: 'The Flaky Suite', blurb: '同じことをして、違う顔をする', blurbEn: 'Same input, different mood' },
  { id: 'legacy', ja: '触れられぬ古層', en: 'The Untouched Stratum', blurb: '誰も読んでいないが、誰も消せない', blurbEn: 'Nobody reads it, nobody dares delete it' },
  { id: 'yak', ja: '毛を刈られる獣', en: 'The Shaven Beast', blurb: '刈っても刈っても、その下にまた毛がある', blurbEn: 'Shave it and there is more underneath' },
  { id: 'heisenbug', ja: '見ると消える虫', en: 'The Vanishing Bug', blurb: '調べようとした瞬間だけ、正しく動く', blurbEn: 'Behaves perfectly the moment you look' },
  { id: 'merge', ja: '三方向の裂け目', en: 'The Three-Way Rift', blurb: 'どちらを残しても、何かが失われる', blurbEn: 'Keep either side and something is lost' },
  { id: 'offbyone', ja: '一つずれた門番', en: 'The Off-By-One Gate', blurb: '数え始めをどこにするかで、通れたり通れなかったり', blurbEn: 'Passable or not, depending where you start counting' },
  { id: 'cascade', ja: '連鎖する赤', en: 'The Cascading Red', blurb: '1 つ直すと、2 つ赤くなる', blurbEn: 'Fix one and two more turn red' },
  { id: 'silence', ja: '黙って落ちるもの', en: 'The Silent Failure', blurb: '何も言わずに、何もしていない', blurbEn: 'Says nothing, does nothing' },
  { id: 'scope', ja: 'ふくれ続ける輪郭', en: 'The Ever-Widening Scope', blurb: '終わりに近づくほど、遠ざかる', blurbEn: 'The closer you get, the further it goes' },
  { id: 'cache', ja: '古いまま笑う鏡', en: 'The Stale Mirror', blurb: '正しく直したのに、直る前の姿を映す', blurbEn: 'You fixed it; it still shows the old you' },
  { id: 'race', ja: '順番を守らぬもの', en: 'The Out-Of-Order', blurb: '毎回ちがう順で来る。だから再現できない', blurbEn: 'Arrives in a new order each time' },
  // 12 体だと 300 階で一巡してしまう。深く潜る人のぶんを足す
  { id: 'quota', ja: '枠を配るもの', en: 'The Quota Keeper', blurb: 'あと少しというところで、今日のぶんは終わる', blurbEn: 'Ends your day right before the last step' },
  { id: 'slop', ja: 'それらしいだけの群れ', en: 'The Plausible Swarm', blurb: '全部それらしく見えるので、どれが嘘か分からない', blurbEn: 'All of it looks right, so you cannot tell which part lied' },
  { id: 'midnight', ja: '深夜に一言だけ言うもの', en: 'The Midnight Whisper', blurb: 'ひと言で相場が動く。中身は誰にも分からない', blurbEn: 'One line moves the market. Nobody knows what it meant' },
  { id: 'migration', ja: '終わらない移行', en: 'The Endless Migration', blurb: '新しいほうへ移した先で、また新しいほうが出る', blurbEn: 'You migrate to the new thing; a newer thing appears' },
  // 2026 のぶん。**現象のほうを書く**（i18n のテストが名指しを止める）
  { id: 'handoff', ja: '伝言の果て', en: 'The Long Handoff', blurb: '3 体目に届く頃には、別の話になっている', blurbEn: 'By the third relay it is a different task' },
  { id: 'washing', ja: '肩書きだけ替わるもの', en: 'The Retitled', blurb: '中身は去年のまま、名前だけ今年になる', blurbEn: 'Same insides, this year\u2019s name' },
  { id: 'overflow', ja: '溢れさせるもの', en: 'The Overflow', blurb: '溢れると、なぜか大事なほうから落ちる', blurbEn: 'When it spills, the important half goes first' },
  { id: 'polite', ja: '丁寧に食い違うもの', en: 'The Polite Disagreement', blurb: '全員が丁寧で、誰も同じことを言っていない', blurbEn: 'Everyone is courteous; nobody agrees' },
];

/** 25 階ごとの主。個体の種と階から決まるので、何度呼んでも同じ。 */
export function bossAt(seed, floor) {
  const rng = rngFrom(hashSeed(`${seed}:boss:${floor}`));
  return { ...BOSSES[Math.floor(rng() * BOSSES.length)], floor };
}

/**
 * ここまでに抜けてきた主。**古い順**（道として読む）。
 *
 * 「まだ会っていない主」は出さない ── 出した瞬間に「12 体そろえる」の話になる
 * （なった職を一覧に出さないのと同じ理由）。
 */
export function bossesUpTo(seed, floor) {
  const out = [];
  for (let f = BOSS_EVERY; f <= floor; f += BOSS_EVERY) out.push(bossAt(seed, f));
  return out;
}

/**
 * いま着けているもの。**枠ごとに一番強いものが自動で乗る。**
 *
 * 拾ったものを並べて選ばせない ── 選ばせると「良いものを狙って潜る」が
 * 生まれて、普段どおり仕事をするだけでよくなくなる（DESIGN.md §3）。
 * 深いほど良いものが出るので、放っておけば勝手に強くなっていく。
 */
export function dungeonFor(state) {
  const floor = floorFor(state);
  const seed = state.seed || 0;

  const equipped = {};
  const finds = [];
  for (let f = 1; f <= floor; f += 1) {
    const found = findAt(seed, f);
    finds.push(found);
    const current = equipped[found.slot];
    /*
     * 比べるのは**その拾い物の総取り分**（宿りぶんを含む）。素の割合で比べると、
     * 「並だが宿りが 2 つ乗って結果的に強い」ものを一生着けないことになる
     * ── 中身を足した意味がそこで消える。
     * 同じ強さなら先に拾ったほうを残す（急に着替えたように見えない）。
     */
    if (!current || found.total > current.total) equipped[found.slot] = found;
  }

  return {
    floor,
    effort: effortFor(state),
    equipped,
    // 抜けてきた主。古い順 ── 道として読む
    bosses: bossesUpTo(seed, floor),
    // 次の主までの階数（**残りだけ。「あと何回叩けば」は出さない**）
    toNextBoss: BOSS_EVERY - (floor % BOSS_EVERY),
    // 深いところから順に。全部並べると、育つほど画面が読めなくなる
    recent: finds.slice(-8).reverse(),
    // 攻・守・速それぞれに乗る倍率（1.0 が素のまま）
    multipliers: multipliersOf(equipped),
    // 宿りぶんの段位（fighter.js が技に足す）
    skillBoost: skillBoostsOf(equipped),
  };
}

/**
 * 装備から、ステータスに掛ける倍率を出す。
 * **枠をまたいで足し合わせる** ── 攻の武器に「軽さ」が宿れば速さにも乗る。
 */
export function multipliersOf(equipped) {
  const out = { atk: 1, def: 1, spd: 1 };
  for (const slot of SLOTS) {
    const weight = weightOf(equipped && equipped[slot]);
    for (const target of SLOTS) out[target] += weight[target];
  }
  // 頭打ちは 1 枠あたり +40%。散らして抜けられては意味がない
  for (const target of SLOTS) out[target] = Math.min(1 + MAX_BONUS, out[target]);
  return out;
}

/** 着けている 3 つぶんの、技の底上げをまとめる。 */
export function skillBoostsOf(equipped) {
  const out = {};
  for (const slot of SLOTS) {
    for (const [id, step] of Object.entries(skillBoostOf(equipped && equipped[slot]))) {
      out[id] = (out[id] || 0) + step;
    }
  }
  return out;
}

/**
 * 装備ぶんの総取り分。練習相手を「同じくらい育った相手」にするのに使う
 * （bots.js）── ここを渡さないと、装備が増えるほど一方的に勝つ側に倒れる。
 * 宿りぶんも数に入れる（入れないと、宿りが乗るほど一方的になる）。
 */
export function gearWeightOf(equipped) {
  const multipliers = multipliersOf(equipped);
  let sum = 0;
  for (const slot of SLOTS) sum += multipliers[slot] - 1;
  return sum;
}

/** 表示用。位と階と乗せている割合、宿りまで文字にする。 */
export function describeFind(find, lang = 'ja') {
  const rarity = RARITY_BY_ID[find.rarity];
  const weight = weightOf(find);
  return {
    id: find.id,
    slot: find.slot,
    label: label(find, lang),
    // 見た目の型（appearance.js が読む）。剣なのか弓なのかで、絵が変わる
    look: GEAR_BY_ID[find.id] ? GEAR_BY_ID[find.id].look : null,
    rarity: find.rarity,
    rarityLabel: label(rarity, lang),
    floor: find.floor,
    bonus: find.bonus,
    percent: Math.round(find.bonus * 100),
    /*
     * 宿り。**必ず中身まで出す。** 名前だけ出して効果を隠すと、
     * 「どれが強いのか」を外の攻略サイトで調べる遊びになる ── そこまで行くと、
     * 普段どおり仕事をするだけでよくなくなる。
     */
    imbues: (find.imbues || []).map((id) => ({
      id,
      label: label(IMBUE_BY_ID[id], lang),
      blurb: blurb(IMBUE_BY_ID[id], lang),
    })),
    // 枠をまたいで乗るぶん（「攻 +6% 速 +2%」のように出す）
    weight: SLOTS.map((slot) => ({ slot, percent: Math.round(weight[slot] * 100) })).filter((w) => w.percent > 0),
    // オーバーレイの吹き出しに出す 1 行。**文はここで作る**
    // ── pet.js は素のスクリプトなので、あちらで組むと日本語が焼き付く
    say: t(lang, 'say.gear', { label: label(find, lang) }),
  };
}
