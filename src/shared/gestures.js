/**
 * しぐさ ── 画面に出ている間、ときどき勝手に動く。
 *
 * このアプリで一番長く見ている画面は「何も起きていないオーバーレイ」なので、
 * そこが退屈だと成長を眺める気にならない。逆にここが賑やかなら、戦闘ログを
 * 読み込まなくても「生きている」が伝わる。
 *
 * **選ぶところだけを切り出してある。** 実際の動きは CSS のキーフレームで、
 * 描画は pet.js。ここは「いまの気分でどのしぐさが許されるか」だけを決める
 * 純粋な関数なので、ブラウザ無しでテストできる。
 *
 * ES モジュールにしていないのは pet-svg.js と同じ理由（<script src> で読む）。
 */
(function (global) {
  /**
   * moods … その気分のときだけ出る。weight … 出やすさ。ms … CSS 側の長さと合わせる。
   *
   * calling（許可待ち）はどこにも入れていない。返事を待っている子が
   * のんきに伸びをしたら、見ている側は気づけない。
   */
  const GESTURES = [
    { id: 'look', ms: 1700, weight: 4, moods: ['idle', 'thinking', 'working'] },
    { id: 'bounce', ms: 1000, weight: 3, moods: ['idle', 'working'] },
    { id: 'tilt', ms: 1200, weight: 3, moods: ['idle', 'thinking'] },
    { id: 'stretch', ms: 1300, weight: 3, moods: ['idle'] },
    { id: 'yawn', ms: 1500, weight: 2, moods: ['idle'] },
    { id: 'spin', ms: 900, weight: 2, moods: ['idle'] },
    { id: 'shiver', ms: 700, weight: 1, moods: ['idle', 'sleeping'] },
    { id: 'roll', ms: 2000, weight: 2, moods: ['sleeping'] },

    // 気分ごとの「らしさ」。同じしぐさが全部の気分に出ると、気分が意味を失う。
    { id: 'peek', ms: 1600, weight: 3, moods: ['idle', 'thinking'] }, // 画面をのぞきこむ（打っている手元を見にくる）
    { id: 'ponder', ms: 2200, weight: 4, moods: ['thinking'] }, // 首をひねって考えこむ
    { id: 'typing', ms: 1400, weight: 4, moods: ['working'] }, // 手が動いている
    { id: 'dream', ms: 2600, weight: 3, moods: ['sleeping'] }, // 寝ながら浮かぶ
    { id: 'sneeze', ms: 900, weight: 1, moods: ['idle'] }, // たまに、くしゃみ

    /*
     * **手が空いているあいだの細かい身振り。**
     *
     * 何も起きていない時間がいちばん長いので、ここが薄いと数日で置物に見える。
     * 小道具を持たないぶん絵を足さずに増やせる ── ただし**全部を大きく動かさない**。
     * 大きい身振り（跳ねる・つまずく）と、ほとんど動かないもの（集中・ため息）を
     * 混ぜておかないと、うるさいだけで生き物には見えない。
     */
    { id: 'nod', ms: 1300, weight: 3, moods: ['idle', 'thinking'] }, // うなずく
    { id: 'shake', ms: 1200, weight: 2, moods: ['thinking'] }, // 首を振る（ちがう）
    { id: 'sway', ms: 2400, weight: 3, moods: ['idle'] }, // 鼻歌まじりに揺れる
    { id: 'perk', ms: 1800, weight: 3, moods: ['idle', 'thinking'] }, // 何かに気づく
    { id: 'sigh', ms: 1900, weight: 2, moods: ['idle', 'thinking'] }, // ため息
    { id: 'wobble', ms: 1400, weight: 2, moods: ['idle'] }, // ぐらついて持ち直す
    { id: 'stumble', ms: 1500, weight: 1, moods: ['idle'] }, // つまずく
    { id: 'hop', ms: 1200, weight: 3, moods: ['idle', 'working'] }, // 上機嫌に 2 回跳ねる
    { id: 'lookback', ms: 1600, weight: 2, moods: ['idle'] }, // 後ろを振り返る
    { id: 'scratch', ms: 1500, weight: 2, moods: ['idle', 'thinking'] }, // 頭をかく
    { id: 'focus', ms: 2000, weight: 3, moods: ['working'] }, // 前に出て、止まる
    { id: 'snore', ms: 2800, weight: 4, moods: ['sleeping'] }, // 寝息
    { id: 'turnover', ms: 2400, weight: 2, moods: ['sleeping'] }, // 寝返り

    // 戦闘は「たまに思い出したように」。今日の一戦がある日だけ混ざる。
    { id: 'battle', ms: 3400, weight: 2, moods: ['idle', 'thinking'], needsBattle: true },
  ];

  /**
   * 暮らし ── **画面の前にいる間、ずっと何かしている**ためのもの。
   *
   * しぐさ（上）が 1〜2 秒の身振りなのに対して、こちらは 4〜7 秒の場面で、
   * たいてい小道具を持つ（pet-svg.js の #props）。何も起きていない時間が
   * いちばん長い画面なので、そこが「ただ浮いているだけ」だと数日で飽きる。
   *
   * **何をしているかは、その時こちらが何をしているかで変わる。**
   * キーボードもマウスも覗いていない（覗いた時点でこのアプリの前提が壊れる）。
   * 見ているのは hook が既に送っている「いまどの道具が動いたか」だけ ──
   *
   *   Read / Grep が続く   … あなたは出てきたものを追っている  → 相棒も本を読む
   *   Bash が動いている     … 走らせて待っている               → 金づちを叩く
   *   Edit / Write          … 書いている                        → 筆を持つ
   *   WebSearch / MCP       … 外を見に行っている                → 望遠鏡をのぞく
   *   Task                  … 任せた                            → 手紙を出す
   *   指示を打った直後       … **あなたが打っている**            → 何も持たずに待つ
   *   しばらく動きがない     … 離席・考え中                      → 飯を食う・映画を観る
   */
  const ACTIVITIES = [
    // 手が空いているとき。**ここがいちばん長いので、いちばん賑やか。**
    { id: 'burger', ms: 5200, weight: 3, moods: ['idle'], prop: 'burger' },
    { id: 'bun', ms: 5400, weight: 3, moods: ['idle'], prop: 'bun' },
    { id: 'soba', ms: 5600, weight: 3, moods: ['idle'], prop: 'soba' },
    { id: 'tea', ms: 4400, weight: 3, moods: ['idle'], prop: 'tea' },
    { id: 'movie', ms: 7000, weight: 3, moods: ['idle'], prop: 'movie' },
    { id: 'nap', ms: 6000, weight: 2, moods: ['idle', 'sleeping'], prop: 'blanket' },
    { id: 'doze', ms: 6600, weight: 3, moods: ['sleeping'], prop: 'blanket' },

    /*
     * じゃれてくる相手。**世話をするものではない。**
     *
     * 餌やりも撫でるボタンも付けない（DESIGN.md §3 ── 育成のための操作を
     * 足さない）。向こうから来て、しばらく遊んで、勝手に帰る ── こちらが
     * できるのは眺めることだけで、そこは相棒に対してと同じ扱いにしてある。
     *
     * 作業中には出さない。手が止まっているときに来るから「遊んでいる」に
     * 見えるのであって、打っている最中に猫が来たら、それはただの邪魔になる。
     */
    { id: 'cat', ms: 6400, weight: 3, moods: ['idle'], prop: 'cat' },
    { id: 'bird', ms: 5600, weight: 2, moods: ['idle'], prop: 'bird' },
    { id: 'turtle', ms: 6800, weight: 2, moods: ['idle'], prop: 'turtle' },
    // 寝ているところに猫が来て、丸まって一緒に寝る
    { id: 'catnap', ms: 7000, weight: 3, moods: ['sleeping'], prop: 'cat' },

    // 作業中。**道具ごとに別のことをする**
    { id: 'reading', ms: 5000, weight: 6, moods: ['working'], tools: ['read'], prop: 'book' },
    { id: 'hammering', ms: 4200, weight: 6, moods: ['working'], tools: ['run'], prop: 'hammer' },
    { id: 'carving', ms: 4600, weight: 6, moods: ['working'], tools: ['write'], prop: 'brush' },
    { id: 'scouting', ms: 4800, weight: 6, moods: ['working'], tools: ['out'], prop: 'scope' },
    { id: 'sending', ms: 4400, weight: 6, moods: ['working'], tools: ['hand'], prop: 'letter' },
  ];

  /**
   * ツール名 → 何をしている場面か。
   * classes.js の系統と似ているが、こちらは**見た目の担当**なので別に持つ
   * （系統は 5 つに固定だが、こちらは絵が増えれば増える）。
   */
  function sceneForTool(tool) {
    if (!tool) return null;
    if (tool.startsWith('mcp__')) return 'out';
    if (['Read', 'Grep', 'Glob', 'NotebookRead'].includes(tool)) return 'read';
    if (['Bash', 'BashOutput', 'KillShell'].includes(tool)) return 'run';
    if (['Write', 'Edit', 'NotebookEdit'].includes(tool)) return 'write';
    if (['WebSearch', 'WebFetch'].includes(tool)) return 'out';
    if (['Task', 'Agent', 'Workflow'].includes(tool)) return 'hand';
    return null;
  }

  const ALL = () => GESTURES.concat(ACTIVITIES);
  const BY_ID = new Map();

  /**
   * 型（persona.js）ごとの、しぐさの出やすさの足し引き。
   *
   * **型で出るしぐさを変える。** 同じ動きしかしないなら、型は文字が変わるだけの
   * 飾りになる ── 「うちの子はよく画面をのぞきこむ」が、そのまま
   * 「外に出て行くほうの人だから」になっているのが、この機能の値打ち。
   *
   * 足すのは重みだけで、**どの気分で何が許されるかは変えない**（寝ている子は
   * 型が何であれ跳ねない）。
   */
  const PERSONA_WEIGHTS = {
    out: { peek: 3, bounce: 2, spin: 1, bird: 2, perk: 3, lookback: 2 }, // 出て行く ── 外から来たものによく気づく
    in: { look: 2, ponder: 2, tilt: 1, cat: 1, focus: 2, scratch: 1 }, // 籠る
    move: { typing: 2, stretch: 2, bounce: 1, hop: 2, stumble: 1 }, // 動かす
    build: { ponder: 3, tilt: 2, look: 1, nod: 2, focus: 2 }, // 組み立てる
    cut: { typing: 2, look: 2, nod: 2, shake: 1 }, // 刻む
    trust: { yawn: 2, spin: 2, sneeze: 1, sway: 2, sigh: 1 }, // 委ねる
    through: { typing: 1, stretch: 2, look: 1, focus: 2, snore: 1 }, // 走り切る
    spread: { spin: 2, sneeze: 2, roll: 1, wobble: 2, lookback: 1 }, // 散らす
    calm: { stretch: 1, dream: 1, turtle: 2, sway: 2, snore: 2 }, // 凪 ── 急がない相手と気が合う
    wave: { bounce: 1, sneeze: 1, cat: 2, hop: 2, wobble: 1 }, // 波 ── じゃれるほうが合う
  };

  /**
   * その型で、そのしぐさがどれだけ出やすいか。
   * marks は persona.js が返す印の配列（['in','build','cut','through','calm']）。
   */
  function weightFor(gesture, marks) {
    let weight = gesture.weight;
    if (!Array.isArray(marks)) return weight;
    for (const mark of marks) {
      const table = PERSONA_WEIGHTS[mark];
      if (table && table[gesture.id]) weight += table[gesture.id];
    }
    return weight;
  }

  /**
   * 次までの間。**空ける時間を短くした** ── 5〜15 秒あけていた頃は、
   * 眺めていると「止まっている置物」の時間のほうが長かった。
   * 等間隔にはしない（途端に機械に見える）。
   */
  function nextDelay(rng) {
    return 700 + rng() * 2600;
  }

  /**
   * いまの気分で出せるしぐさを 1 つ選ぶ。出せるものが無ければ null。
   *
   * rng を引数で受けるのは、テストで固定するため。
   */
  function pick(mood, options, rng) {
    const hasBattle = Boolean(options && options.hasBattle);
    const persona = options && options.persona;
    const scene = sceneForTool(options && options.tool);

    const pool = ALL().filter((g) => {
      if (!g.moods.includes(mood)) return false;
      if (g.needsBattle && !hasBattle) return false;
      // 道具が決まっている場面は、いまその道具が動いているときだけ
      if (g.tools && !g.tools.includes(scene)) return false;
      return true;
    });
    if (!pool.length) return null;

    const weights = pool.map((g) => weightFor(g, persona));
    let total = 0;
    for (const w of weights) total += w;

    let roll = rng() * total;
    for (let i = 0; i < pool.length; i += 1) {
      roll -= weights[i];
      if (roll < 0) return pool[i];
    }
    return pool[pool.length - 1];
  }

  function byId(id) {
    if (!BY_ID.size) for (const g of ALL()) BY_ID.set(g.id, g);
    return BY_ID.get(id) || null;
  }

  global.AIPET_GESTURES = { GESTURES, ACTIVITIES, PERSONA_WEIGHTS, sceneForTool, pick, nextDelay, byId, weightFor };
})(typeof window !== 'undefined' ? window : globalThis);
