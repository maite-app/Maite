/**
 * 型 ── 「どう使っているか」から出る性格。
 *
 * **本文は一文字も読まない。** 読んでいるのは今までどおり
 * 「どの道具を何割・何時に・転けてからどうしたか」だけで、プロンプトも
 * ツールの引数も見ていない（DESIGN.md §2b）。それでも 4 つの軸に落とすと、
 * 使い方の癖はかなりはっきり出る ── **読まずに当てるから面白い**のであって、
 * 中身を覗いて当てても、それはただの盗み見になる。
 *
 * **保存しない。** skills.js と同じで traits と系統ベクトルからの導出。
 * だから閾値をいじっても STATE_VERSION を上げずに済むし、働き方が変われば
 * 型のほうが後から付いてくる。
 *
 * **4 文字のコードは出さない。** 測り方の骨格（4 つの軸 ＋ リズム）はよく知られた
 * 性格分類から借りているが、そのまま「INTJ-T」と出すと、**借りてきた診断の結果**に
 * 見える。ここで出したいのは診断結果ではなく、**その人の使い方から生えた一匹**なので、
 * 出るのは 32 通りの二つ名（炉守・図面士・斥候…）と、その根拠にした軸だけ。
 */
import { CLASS_IDS } from './classes.js';

/**
 * 型を決める窓（日）。**growth.js の TRAIL_DAYS と同じ数**にしてある。
 *
 * import しないのは、growth.js を読むと achievements.js 経由でここに戻ってきて
 * 循環するため（実際に `TYPES` の初期化前アクセスで落ちた）。ずれたら落ちる
 * テストを置いてあるので、片方だけ動かすことはできない。
 *
 * **保存している日数（growth.js の KEEP_DAYS = 40）とは別物。** 保存を伸ばした
 * ときに、ここも一緒に伸びて窓が壊れたことがある（下の windowsOf を読む）。
 */
export const WINDOW_DAYS = 14;

/**
 * 軸の定義。
 *
 * value は 0..1 で、**1 に近いほど右** に寄る。floor はその軸を
 * 名乗るのに要る母数 ── 3 回叩いただけで「あなたはこういう人です」と言われたら、
 * 当たっていても嘘くさい。
 *
 * 閾値は実測から置いた。手元の記録（scripts/usage.mjs）で出る分布は
 * 職人 49% / 建築家 28% / 学者 14% / 探索者 6% / 統率者 0%、深夜 18%。
 * ここを真ん中に置くと、ほとんどの人が同じ型になって意味が消える。
 */
export const AXES = [
  {
    id: 'reach',
    left: { code: 'in', ja: '籠る', en: 'Inward', blurb: '手元を読んで 自分で叩く', blurbEn: 'Reads what is here and runs it yourself' },
    right: { code: 'out', ja: '出て行く', en: 'Outward', blurb: '外を調べて 人に任せる', blurbEn: 'Looks outside and hands work over' },
    from: '調べもの（WebSearch / MCP）と Task の割合',
    fromEn: 'Share of lookups (WebSearch / MCP) and delegated Tasks',
    threshold: 0.12,
    floor: 60,
    total: (w) => classTotal(w),
    value: (w) => share(w, ['seeker', 'commander']),
  },
  {
    id: 'hand',
    left: { code: 'move', ja: '動かす', en: 'Run it', blurb: 'まず走らせて 返ってきたもので確かめる', blurbEn: 'Runs it first and learns from what comes back' },
    right: { code: 'build', ja: '組み立てる', en: 'Build it', blurb: '読んで筋を通してから書く', blurbEn: 'Reads, makes it make sense, then writes' },
    from: '実行（Bash）と 読み書き（Read / Edit）の比',
    fromEn: 'Running (Bash) against reading and writing (Read / Edit)',
    threshold: 0.66,
    floor: 60,
    total: (w) => classTotal(w),
    value: (w) => share(w, ['scholar', 'architect'], ['artisan', 'scholar', 'architect']),
  },
  {
    /*
     * **立て直し率で測ろうとして、やめた。** 「つまずいてから直した割合」は
     * ほとんどの人が 0.8 を超える（同じ道具はすぐまた使うので、10 分の窓に
     * 勝手に収まる）。軸として動かない値を性格ということはできない。
     *
     * 代わりに「1 回の指示で、どれだけ勝手に走らせるか」を見る。
     * これは人によって桁で変わるし、**そのまま任せ方の癖**になっている。
     */
    id: 'grip',
    left: { code: 'cut', ja: '刻む', en: 'Step by step', blurb: '細かく区切って そのつど確かめる', blurbEn: 'Small steps, checked one at a time' },
    right: { code: 'trust', ja: '委ねる', en: 'Hand it over', blurb: '大きく投げて 走らせておく', blurbEn: 'Throws it big and lets it run' },
    from: 'ひと言の指示で動く道具の数',
    fromEn: 'Tool calls per instruction you give',
    threshold: 0.5,
    floor: 20,
    total: (w) => w.prompts,
    // 12 回で半分。1 指示で 40 回を超えると振り切る
    value: (w) => softness(w.prompts > 0 ? w.tools / w.prompts : 0, 12),
  },
  {
    id: 'run',
    left: { code: 'spread', ja: '散らす', en: 'Scattered', blurb: '短いセッションを あちこちで何本も', blurbEn: 'Many short sessions, all over the place' },
    right: { code: 'through', ja: '走り切る', en: 'Sees it through', blurb: '一本のセッションを長く走る', blurbEn: 'One session, run long' },
    from: 'ひと続きの作業で どれだけ手を動かすか',
    fromEn: 'Tool calls per session',
    threshold: 0.5,
    floor: 3,
    total: (w) => w.sessions,
    // 60 回で半分。1 セッション 200 回を超えると振り切る（実測の中央値のあたり）
    value: (w) => softness(w.sessions > 0 ? w.tools / w.sessions : 0, 60),
  },
];

/**
 * 5 軸目 ── **リズム**。4 文字の後ろに付く（INTJ-凪 / INTJ-波）。
 *
 * 上の 4 つが「何をしているか」なのに対して、ここだけ**時間の形**を見る。
 * 日ごとの EXP（growth.js の days）のばらつきで、同じ型でも走り方が違う
 * ── 毎日おなじ調子で積む人と、乗った日に一気に持っていく人。
 *
 * **休んだ日は数えない。** 土日を休む人が全員「波」になってしまう。
 * 見るのは「働いた日のあいだで、量が揃っているか」のほう。
 */
export const RHYTHM = {
  id: 'rhythm',
  suffix: true,
  left: { code: 'calm', ja: '凪', en: 'Steady', blurb: '毎日おなじ調子で積む', blurbEn: 'Puts in about the same every day' },
  right: { code: 'wave', ja: '波', en: 'Surging', blurb: '乗った日に一気に持っていく', blurbEn: 'Takes it all in one run when the mood strikes' },
  from: '働いた日ごとの量の揃い方（この 2 週間）',
  fromEn: 'How even the daily output is, across the last two weeks',
  threshold: 0.5,
  // 5 日ぶん働いていないと、揃っているかどうかを言えない
  floor: 5,
  total: (w) => w.workedDays.length,
  value: (w) => softness(variation(w.workedDays), 0.55),
};

/** ばらつき（変動係数）。平均に対して、どれだけ散らばっているか。 */
function variation(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean <= 0) return 0;
  const spread = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(spread) / mean;
}

function classTotal(window) {
  let sum = 0;
  for (const id of CLASS_IDS) sum += window.cls[id] || 0;
  return sum;
}

/** ids の合計が、母数（既定は全系統）に占める割合。 */
function share(window, ids, over = CLASS_IDS) {
  let top = 0;
  let bottom = 0;
  for (const id of ids) top += window.cls[id] || 0;
  for (const id of over) bottom += window.cls[id] || 0;
  return bottom > 0 ? top / bottom : 0;
}

/**
 * 軸を測る材料をまとめる。**recent は直近 TRAIL_DAYS 日ぶん、lifetime は全期間。**
 *
 * 型は recent で決める ── 累計で決めていた頃は、続けるほど分母が育って
 * **二度と変わらなくなっていた**（1 年使った人の型は、以降どう働き方を変えても
 * 動かない）。放っておいたら知らない間に変わっているためには、窓で見るしかない。
 */
function windowsOf(state) {
  /*
   * **自分で窓を切る。** 前は `state.days` を丸ごと使っていて、「保存している
   * 日数 = 窓」という暗黙の前提に乗っていた ── ふりかえり（recap.js）のために
   * 保存を 40 日に伸ばした瞬間、**型が 40 日で決まるようになって窓が壊れた**
   * （テストが捕まえた）。
   *
   * 窓は TRAIL_DAYS のまま。ここを保存日数に引きずられないよう、明示的に切る。
   */
  const store = state.days || {};
  const days = Object.keys(store)
    .sort()
    .slice(-WINDOW_DAYS)
    .map((key) => store[key]);
  const recent = { cls: {}, tools: 0, prompts: 0, sessions: 0, workedDays: [] };
  for (const day of days) {
    recent.tools += day.tools || 0;
    recent.prompts += day.prompts || 0;
    recent.sessions += day.sessions || 0;
    for (const [id, n] of Object.entries(day.cls || {})) recent.cls[id] = (recent.cls[id] || 0) + n;
    if (day.exp > 0) recent.workedDays.push(day.exp);
  }

  const lifetime = {
    cls: state.classVector,
    tools: state.traits.toolCalls,
    prompts: state.traits.prompts,
    sessions: state.traits.sessions,
    workedDays: recent.workedDays,
  };
  return { recent, lifetime };
}

/**
 * 境目のすぐそば（±この幅）にいる間は、**これまでの自分**に倒す。
 *
 * 窓で見ると境目に乗った日から毎日ひっくり返る。「知らない間に変わっていた」は
 * いいが、「毎朝ちがう職になっている」は別物 ── ここでだけ長い目を使う。
 */
const HYSTERESIS = 0.06;

/** 0 以上の数を 0..1 に潰す。half でちょうど 0.5。 */
function softness(value, half) {
  return value <= 0 ? 0 : value / (value + half);
}

/**
 * 16 通りの二つ名。鍵は 4 軸の並び（reach.hand.grip.run）。
 *
 * **ここだけ空想の職に振ってある。** 呼び名（naming.js）は現実の職 ── 大工・
 * 灯台守・司書。系統（classes.js）は何をする子か ── 職人・学者。そこに三段目として
 * 「その働き方なら、あちらの世界では何をしている人か」を重ねる。
 * 並ぶと「大工　Lv14 ／ 学者 ／ 魔道書士」になり、現実の呼び名と空想の職が
 * 一段ずれて立つ。
 *
 * 割り当ては軸の意味そのまま ── 籠って手を動かす人は工房（鍛冶師・錬金術師）、
 * 籠って組み立てる人は書庫（魔道書士・結界師）、外に出て体で確かめる人は野
 * （竜騎士・狩人）、外を見て絵を描く人は空と海（占星術師・導師）。
 *
 * **系統（職人・探索者・建築家・学者・統率者）と技（召喚・不屈…）とは重ねない。**
 * 同じ語が別の意味で二度出ると、画面の壊れに見える。
 *
 * **借りてきた診断の名前はそのまま出さない。** 出した瞬間に「診断結果」に見えて、
 * 自分の子から生えたものに見えなくなる。
 */
export const TYPES = {
  // 籠る × 動かす ── 工房にこもって、手を動かす者
  'in.move.cut.through': { ja: '鍛冶師', yomi: 'かじし', blurb: '一本を 打ち続けて仕上げる', en: 'Smith', blurbEn: 'One blade, hammered until it is finished' },
  'in.move.cut.spread': { ja: '罠師', yomi: 'わなし', blurb: '仕掛けては次へ また仕掛ける', en: 'Trapper', blurbEn: 'Sets one, moves on, sets another' },
  'in.move.trust.through': { ja: '錬金術師', yomi: 'れんきんじゅつし', blurb: '仕込んで 煮えるまで離れない', en: 'Alchemist', blurbEn: 'Starts the brew and never leaves the pot' },
  'in.move.trust.spread': { ja: '傀儡師', yomi: 'くぐつし', blurb: '作って 動かして 放っておく', en: 'Puppeteer', blurbEn: 'Builds it, winds it up, lets it run' },

  // 籠る × 組み立てる ── 書庫にこもって、筋を通す者
  'in.build.cut.through': { ja: '魔道書士', yomi: 'まどうしょし', blurb: '一冊を 最後の行まで書き切る', en: 'Grimoirist', blurbEn: 'One volume, written to the last line' },
  'in.build.cut.spread': { ja: '呪紋師', yomi: 'じゅもんし', blurb: '気になった紋だけ刻んで また別の紋へ', en: 'Sigil-carver', blurbEn: 'Cuts the one glyph that caught the eye, then another' },
  'in.build.trust.through': { ja: '結界師', yomi: 'けっかいし', blurb: '張ってしまえば あとは守り続ける', en: 'Warder', blurbEn: 'Once the ward is up, it is kept up' },
  'in.build.trust.spread': { ja: '幻術師', yomi: 'げんじゅつし', blurb: '思いつくたびに 形が変わる', en: 'Illusionist', blurbEn: 'Changes shape with every new idea' },

  // 出て行く × 動かす ── 野に出て、体で確かめる者
  'out.move.cut.through': { ja: '竜騎士', yomi: 'りゅうきし', blurb: '踏み込んだら 決着まで降りない', en: 'Dragoon', blurbEn: 'Once committed, never dismounts' },
  'out.move.cut.spread': { ja: '狩人', yomi: 'かりうど', blurb: '見つけて 仕留めて すぐ次の獲物へ', en: 'Hunter', blurbEn: 'Finds it, takes it, moves to the next' },
  'out.move.trust.through': { ja: '獣使い', yomi: 'けものつかい', blurb: '連れて行って 任せて 着くまで見ている', en: 'Beastmaster', blurbEn: 'Brings them along, lets them work, sees it through' },
  'out.move.trust.spread': { ja: '傭兵', yomi: 'ようへい', blurb: '風の向いたところで 風の向くだけ', en: 'Sellsword', blurbEn: 'Wherever the wind blows, for as long as it blows' },

  // 出て行く × 組み立てる ── 外を見て、絵を描く者
  'out.build.cut.through': { ja: '占星術師', yomi: 'せんせいじゅつし', blurb: '空を測って 暦を引き切る', en: 'Astrologer', blurbEn: 'Measures the sky and finishes the chart' },
  'out.build.cut.spread': { ja: '吟遊詩人', yomi: 'ぎんゆうしじん', blurb: '見聞きしたぶんだけ 歌に足していく', en: 'Bard', blurbEn: 'Adds a verse for everything seen and heard' },
  'out.build.trust.through': { ja: '導師', yomi: 'どうし', blurb: '大きく示して 着くまで連れて行く', en: 'Wayfinder', blurbEn: 'Points at the far thing and walks you to it' },
  'out.build.trust.spread': { ja: '精霊使い', yomi: 'せいれいつかい', blurb: '呼んでは任せ 気の向く先へ流れる', en: 'Spiritcaller', blurbEn: 'Calls, hands it over, drifts where it goes' },
};

/**
 * リズム（5 軸目）は、二つ名の後ろに付く一言。
 * 「炉守（凪）」「炉守（波）」で、同じ二つ名でも走り方が違う。
 */
export const RHYTHM_LABEL = {
  calm: { ja: '凪', blurb: '毎日おなじ調子で積む' },
  wave: { ja: '波', blurb: '乗った日に一気に持っていく' },
};

/** その軸を名乗るだけの母数があるか。 */
function known(window, axis) {
  return axis.total(window) >= axis.floor;
}

/**
 * いまの型。母数が足りない軸は「まだ分からない」として片側に倒すが、
 * settled が false のあいだは**画面で断定しない**（見極め中と出す）。
 *
 * 累積の比率なので、使うほど分母が増えて動きにくくなる ── 初日は揺れるが、
 * 続けるほど落ち着く。ここに「一度決めたら変えない」を入れると、
 * 働き方を変えたときに型が付いてこなくなるので入れない。
 */
export function personaFor(state) {
  const { recent, lifetime } = windowsOf(state);

  const describe = (axis) => {
    const value = axis.value(recent);
    // 境目のすぐそばにいる間だけ、これまでの自分に倒す（毎日ひっくり返らせない）
    const wobbling = Math.abs(value - axis.threshold) < HYSTERESIS;
    const deciding = wobbling ? axis.value(lifetime) : value;
    const right = deciding >= axis.threshold;
    const side = right ? axis.right : axis.left;
    // 閾値からどれだけ離れているか（0..1）。境目ちょうどなら 0
    const distance = Math.abs(value - axis.threshold) / Math.max(axis.threshold, 1 - axis.threshold);
    // 目盛りの上での位置。**閾値がちょうど真ん中に来るように**引き伸ばす
    // ── 生の比率をそのまま置くと、閾値 0.12 の軸だけ目盛りが左端に固まる。
    const position = right
      ? 0.5 + ((value - axis.threshold) / Math.max(1e-6, 1 - axis.threshold)) * 0.5
      : (value / Math.max(1e-6, axis.threshold)) * 0.5;
    return {
      id: axis.id,
      code: side.code,
      ja: side.ja,
      // 表示は view.js が言語で選ぶ。ここは材料を落とさず全部渡すだけ
      en: side.en,
      blurb: side.blurb,
      blurbEn: side.blurbEn,
      from: axis.from,
      fromEn: axis.fromEn,
      value,
      threshold: axis.threshold,
      position: Math.max(0, Math.min(1, position)),
      lean: Math.min(1, distance),
      known: known(recent, axis),
      // 境目に乗っていて、これまでの自分で決めた（＝もうすぐ変わるかもしれない）
      wobbling,
      suffix: Boolean(axis.suffix),
      // 目盛りの両端。どちら寄りかを画面に出すために両方渡す
      /*
       * **説明（blurb）も一緒に返す。** 落としていたので、画面に「寄っている
       * ほうの意味」を出そうとしても常に空になっていた ── 「籠る ←→ 出て行く」
       * という名前だけが並んで、何のことか分からないままだった。
       */
      left: { code: axis.left.code, ja: axis.left.ja, en: axis.left.en, blurb: axis.left.blurb, blurbEn: axis.left.blurbEn },
      right: { code: axis.right.code, ja: axis.right.ja, en: axis.right.en, blurb: axis.right.blurb, blurbEn: axis.right.blurbEn },
    };
  };

  const axes = AXES.map(describe);
  const rhythm = describe(RHYTHM);

  const key = axes.map((a) => a.code).join('.');
  const type = TYPES[key];
  // 4 文字が決まってから、リズムが後から付く。**同時に揃うのを待たない**
  // ── リズムは 5 日ぶん働かないと言えないので、待つと 1 週間なにも出ない。
  const settled = axes.every((a) => a.known);

  return {
    key,
    ja: type.ja,
    yomi: type.yomi,
    blurb: type.blurb,
    // 表に出す呼び方。リズムが決まっていれば後ろに付く（「炉守（波）」）
    title: rhythm.known ? `${type.ja}（${rhythm.ja}）` : type.ja,
    rhythmJa: rhythm.ja,
    rhythmBlurb: rhythm.blurb,
    axes: [...axes, rhythm],
    rhythm,
    // 見た目に流すぶん。CSS のクラス（p-in / r-wave …）になる
    marks: [...axes.map((a) => a.code), ...(rhythm.known ? [rhythm.code] : [])],
    // 4 軸ぶん。ここが立って初めて名乗る
    settled,
    // 5 つ目（リズム）まで揃ったか
    rhythmSettled: rhythm.known,
  };
}

export const TYPE_KEYS = Object.keys(TYPES);
