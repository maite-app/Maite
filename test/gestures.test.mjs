import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * shared/gestures.js は <script src> で読む前提の 1 枚もの（ES モジュールにすると
 * オーバーレイとスマホの両方から同じ書き方で読めなくなる）。
 * テストからは擬似的な window に載せて呼ぶ。
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, '..', 'src', 'shared', 'gestures.js'), 'utf8');

function load() {
  const window = {};
  new Function('window', SRC)(window);
  return window.AIPET_GESTURES;
}

const G = load();
import {
  scaleFor,
  tierFor,
  LOOK_TIERS,
  accessoriesFor,
  ACCESSORIES,
  appearanceFor,
  appearanceClasses,
  patinaFor,
  PATINA_DAYS,
  hurtFor,
  HURT_HOURS,
} from '../src/core/appearance.js';

/** rng の差し替え。0..1 の決め打ちを順に返す。 */
function fixedRng(...values) {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

test('許可待ちのときは何もしない', () => {
  // 返事を待っている子がのんきに伸びをしたら、見ている側が気づけない
  for (let i = 0; i < 20; i += 1) {
    assert.equal(G.pick('calling', { hasBattle: true }, fixedRng(i / 20)), null);
  }
});

test('選ばれるのは、その気分で許されたしぐさだけ', () => {
  for (const mood of ['idle', 'thinking', 'working', 'sleeping']) {
    for (let i = 0; i < 50; i += 1) {
      const picked = G.pick(mood, { hasBattle: true }, fixedRng(i / 50));
      assert.ok(picked, `${mood} で何も選ばれない`);
      assert.ok(picked.moods.includes(mood), `${mood} に ${picked.id} が出た`);
    }
  }
});

test('寝ているあいだは跳ねない', () => {
  const seen = new Set();
  for (let i = 0; i < 50; i += 1) {
    seen.add(G.pick('sleeping', { hasBattle: true }, fixedRng(i / 50)).id);
  }
  // 猫は寝ているところにも来るが、丸まって一緒に寝るだけ（catnap）
  assert.deepEqual([...seen].sort(), ['catnap', 'doze', 'dream', 'nap', 'roll', 'shiver', 'snore', 'turnover']);

  /*
   * **意図のほうも縛る。** 上の一覧は増えるたびに書き換わるので、それだけだと
   * 「跳ねるものが混ざった」のか「静かなものが増えた」のかを取り違える
   * ── 起きている子の動きが寝ている子に入り込んでいないかを、名指しで見る。
   */
  const AWAKE_ONLY = ['bounce', 'hop', 'spin', 'stumble', 'wobble', 'typing', 'peek', 'sneeze', 'sway'];
  for (const id of AWAKE_ONLY) {
    assert.ok(!seen.has(id), `寝ているのに ${id} が出た`);
  }
});

test('じゃれてくる相手は、手が止まっているときにだけ来る', () => {
  /*
   * **世話をするものではない**（DESIGN.md §3）。餌やりも撫でるボタンも無く、
   * 向こうから来て勝手に帰る ── できるのは眺めることだけ。
   *
   * 打っている最中や作業中には出さない。手が止まっているときに来るから
   * 「遊んでいる」に見えるのであって、打っている最中に猫が来たら邪魔になる。
   */
  const ANIMALS = ['cat', 'bird', 'turtle', 'catnap'];
  const seenIn = (mood, options = {}) => {
    const seen = new Set();
    for (let i = 0; i < 120; i += 1) seen.add(G.pick(mood, { hasBattle: false, ...options }, fixedRng(i / 120)).id);
    return seen;
  };

  const idle = seenIn('idle');
  assert.ok(ANIMALS.some((id) => idle.has(id)), '手が空いているのに誰も来ない');

  for (const mood of ['working', 'thinking']) {
    const seen = seenIn(mood, { tool: 'Read' });
    for (const id of ANIMALS) assert.ok(!seen.has(id), `${mood} のときに ${id} が来た`);
  }

  // 寝ているところに来るのは猫だけ（起こしに来ない）
  const asleep = seenIn('sleeping');
  assert.ok(asleep.has('catnap'));
  for (const id of ['cat', 'bird', 'turtle']) assert.ok(!asleep.has(id), `寝ているのに ${id} が来た`);
});

test('作業中は、動いている道具に合わせた場面になる', () => {
  // キーボードもマウスも覗いていない。見ているのは「いまどの道具が動いたか」だけ。
  const seenFor = (tool) => {
    const seen = new Set();
    for (let i = 0; i < 80; i += 1) {
      seen.add(G.pick('working', { hasBattle: true, tool }, fixedRng(i / 80)).id);
    }
    return seen;
  };

  assert.ok(seenFor('Read').has('reading'), 'Read が続いているのに本を読まない');
  assert.ok(seenFor('Grep').has('reading'));
  assert.ok(seenFor('Bash').has('hammering'), 'Bash が走っているのに叩かない');
  assert.ok(seenFor('Edit').has('carving'));
  assert.ok(seenFor('WebSearch').has('scouting'));
  assert.ok(seenFor('mcp__github__get_me').has('scouting'), 'MCP が外扱いになっていない');
  assert.ok(seenFor('Task').has('sending'));

  // 別の道具の場面は混ざらない
  assert.ok(!seenFor('Read').has('hammering'), 'Read 中に金づちが出た');
  assert.ok(!seenFor('Bash').has('reading'), 'Bash 中に本が出た');

  // 道具が分からないときは、道具の要る場面は出さない（身振りだけ）
  const plain = seenFor(null);
  for (const id of ['reading', 'hammering', 'carving', 'scouting', 'sending']) {
    assert.ok(!plain.has(id), `道具が分からないのに ${id} が出た`);
  }
});

test('あなたが打っているあいだは、静かなものだけ', () => {
  // 指示を打った直後（thinking）は「固定のやつ」。飯を食い出したら気が散る。
  const seen = new Set();
  for (let i = 0; i < 100; i += 1) {
    seen.add(G.pick('thinking', { hasBattle: false, tool: 'Read' }, fixedRng(i / 100)).id);
  }
  for (const id of seen) {
    assert.ok(!G.byId(id).prop, `打っている最中に ${id}（小道具つき）が出た`);
  }
});

test('小道具の要る場面には、必ず小道具がある', () => {
  // 一覧に足しただけで SVG と CSS を書き忘れると、何も持たずに食べる仕草になる
  const svg = fs.readFileSync(path.join(HERE, '..', 'src', 'shared', 'pet-svg.js'), 'utf8');
  const css = fs.readFileSync(path.join(HERE, '..', 'src', 'renderer', 'style.css'), 'utf8');
  for (const activity of G.ACTIVITIES) {
    if (!activity.prop) continue;
    assert.ok(svg.includes(`id="prop-${activity.prop}"`), `prop-${activity.prop} が SVG に無い`);
    assert.ok(css.includes(`#stage.g-${activity.id} #prop-${activity.prop}`), `g-${activity.id} で小道具が出ない`);
  }
});

test('今日の一戦が無い日は戦闘のしぐさが出ない', () => {
  for (let i = 0; i < 100; i += 1) {
    const picked = G.pick('idle', { hasBattle: false }, fixedRng(i / 100));
    assert.notEqual(picked.id, 'battle');
  }
  // ある日は混ざる
  const withBattle = new Set();
  for (let i = 0; i < 100; i += 1) {
    withBattle.add(G.pick('idle', { hasBattle: true }, fixedRng(i / 100)).id);
  }
  assert.ok(withBattle.has('battle'));
});

test('戦闘ばかりにはならない', () => {
  // 「たまに見かける」ぐらいの頻度に留める（出ずっぱりだと眺める邪魔になる）
  let battles = 0;
  for (let i = 0; i < 1000; i += 1) {
    if (G.pick('idle', { hasBattle: true }, fixedRng(i / 1000)).id === 'battle') battles += 1;
  }
  assert.ok(battles > 0, '一度も出ない');
  assert.ok(battles < 200, `1000 回中 ${battles} 回は多すぎる`);
});

test('待ち時間は等間隔にならない', () => {
  const delays = new Set();
  for (let i = 0; i < 20; i += 1) delays.add(G.nextDelay(fixedRng(i / 20)));
  assert.ok(delays.size > 15, '同じ間隔ばかり返ってくる');
  for (const d of delays) {
    // 5〜15 秒あけていた頃は、眺めていると止まっている時間のほうが長かった
    assert.ok(d >= 500 && d <= 3500, `${d}ms は範囲外`);
  }
});

test('しぐさの長さは CSS 側と突き合わせられる形で持っている', () => {
  for (const g of G.GESTURES) {
    assert.equal(typeof g.ms, 'number');
    assert.ok(g.ms > 0 && g.ms <= 5000, `${g.id} の長さが ${g.ms}ms`);
    assert.equal(G.byId(g.id), g);
  }
  assert.equal(G.byId('存在しない'), null);
});

test('しぐさには必ず CSS の受け皿がある', () => {
  // 一覧に足しただけで CSS を書き忘れると、そのしぐさの番だけ**何も起きない**
  // （クラスは付くが対応するアニメーションが無い）。見た目には「たまに固まる子」になる。
  const css = fs.readFileSync(path.join(HERE, '..', 'src', 'renderer', 'style.css'), 'utf8');
  for (const g of G.GESTURES) {
    if (g.id === 'battle') {
      // 戦闘だけは勝ち負けで別のキーフレームに分かれる
      assert.ok(css.includes('#stage.g-battle-win'), '勝ちの戦闘しぐさが CSS に無い');
      assert.ok(css.includes('#stage.g-battle-lose'), '負けの戦闘しぐさが CSS に無い');
      continue;
    }
    assert.ok(css.includes(`#stage.g-${g.id} `), `g-${g.id} の CSS が無い`);
  }
});

test('しぐさのキーフレームは必ず scale(var(--scale)) から書かれている', () => {
  // 抜くと、しぐさに入った瞬間にレベルぶんの大きさが飛ぶ（CLAUDE.md）。
  const css = fs.readFileSync(path.join(HERE, '..', 'src', 'renderer', 'style.css'), 'utf8');
  // 見るのは #creature に当たっているものだけ。瞳や口のキーフレームは
  // 大きさを持たないので、scale を書くほうが間違い。
  const onCreature = new Set(
    [...css.matchAll(/#stage\.g-[\w-]+ #creature \{\s*animation:\s*([\w-]+)/g)].map((m) => m[1]),
  );
  assert.ok(onCreature.size >= 10, `#creature に当たるしぐさが ${onCreature.size} 個しか見つからない`);

  const blocks = css.matchAll(/@keyframes\s+([\w-]+)\s*\{([\s\S]*?)\n\}/g);
  let checked = 0;
  for (const [, name, body] of blocks) {
    if (!onCreature.has(name)) continue;
    for (const line of body.split('\n')) {
      const transform = line.match(/transform:\s*(.+);/);
      if (!transform) continue;
      checked += 1;
      assert.ok(
        transform[1].includes('var(--scale)'),
        `${name} の「${transform[1]}」に scale(var(--scale)) が無い`,
      );
    }
  }
  assert.ok(checked > 20, `見に行けたのが ${checked} 行しかない`);
});

test('型でしぐさの出方が変わる', () => {
  // 型が字面だけで、動きが同じなら、それはただの飾り
  const count = (persona) => {
    const seen = {};
    for (let i = 0; i < 400; i += 1) {
      const picked = G.pick('idle', { hasBattle: false, persona }, fixedRng(i / 400));
      seen[picked.id] = (seen[picked.id] || 0) + 1;
    }
    return seen;
  };

  const outgoing = count(['out', 'move', 'trust', 'spread', 'wave']);
  const homebody = count(['in', 'build', 'cut', 'through', 'calm']);

  assert.ok((outgoing.peek || 0) > (homebody.peek || 0), '出て行く子のほうがのぞきこまない');
  assert.ok((outgoing.spin || 0) > (homebody.spin || 0), '散らす子のほうが回らない');
  assert.ok((homebody.look || 0) > (outgoing.look || 0), '籠る子のほうがきょろきょろしない');
});

test('型が変わっても、気分の縛りは変わらない', () => {
  // 寝ている子は、型が何であれ跳ねない
  for (const persona of [
    ['out', 'move', 'trust', 'spread', 'wave'],
    ['in', 'build', 'cut', 'through', 'calm'],
    ['out', 'move', 'cut', 'through'],
    ['in', 'build', 'trust', 'spread'],
  ]) {
    for (let i = 0; i < 100; i += 1) {
      const picked = G.pick('sleeping', { hasBattle: true, persona }, fixedRng(i / 100));
      assert.ok(picked.moods.includes('sleeping'), `${persona.join('/')} の寝ている子が ${picked.id} をした`);
    }
    // 許可待ちは型に関係なく何もしない
    assert.equal(G.pick('calling', { hasBattle: true, persona }, fixedRng(0.5)), null);
  }
});

test('型を渡さなくても、これまでどおり選べる', () => {
  for (const mood of ['idle', 'thinking', 'working', 'sleeping']) {
    const picked = G.pick(mood, { hasBattle: true }, fixedRng(0.42));
    assert.ok(picked && picked.moods.includes(mood));
  }
});

test('育っても、窓からはみ出さない', () => {
  /*
   * オーバーレイの窓は 200x200 ちょうど（main.js の SIZE）。拡大の基点は
   * 足元 (100, 166) で、装備はいちばん外で x=186 まで出る（翼）── 大きさの
   * 上限を上げすぎると、**そこが窓の外に出て切れる**。
   *
   * 「大きくして育ちを見せる」には窓が小さすぎるので、上限はここで止めて、
   * 角・尾・輪・紋と装備のほうで見せる。
   */
  const OUTERMOST_X = 186;
  const ORIGIN_X = 100;
  const WINDOW = 200;
  for (const level of [1, 13, 50, 100, 500, 999]) {
    const scale = scaleFor(level);
    const edge = ORIGIN_X + (OUTERMOST_X - ORIGIN_X) * scale;
    assert.ok(edge <= WINDOW - 2, `Lv${level}（×${scale}）で右端が ${edge.toFixed(0)} に出る`);
  }

  // 育ちが止まらない ── どのレベルでも、上のレベルのほうが大きいか同じ
  let prev = 0;
  for (let lv = 1; lv <= 999; lv += 1) {
    const s = scaleFor(lv);
    assert.ok(s >= prev, `Lv${lv} で小さくなった`);
    prev = s;
  }
  assert.ok(scaleFor(999) > scaleFor(13), 'Lv13 から先で大きさが動いていない');
});

test('見た目の節目は、レベルの実績と同じ位置にある', () => {
  /*
   * 「熟練（Lv30）を獲った日に角が生えた」が揃っていないと、どちらも薄くなる。
   * 実績側（achievements.js）を動かしたら、こちらも動かす。
   */
  const levels = LOOK_TIERS.map((t) => t.level);
  for (const at of [30, 50, 100, 200, 500]) {
    assert.ok(levels.includes(at), `Lv${at} に見た目の節目が無い（実績はある）`);
  }
  // Lv15 で打ち止めだったのを直したぶん
  assert.ok(tierFor(500) > tierFor(15), 'Lv15 から先で見た目が変わらない');
});

test('顔まわりの小物は、同じ場所で重ならない', () => {
  /*
   * 無精ひげと顎ひげが同時に生えたら、ただの絵の事故になる。
   * 場所（spot）ごとに、段（step）がいちばん大きいものだけが出る。
   */
  const all = {
    ageDays: 9999,
    classId: 'scholar',
    nightTier: 3,
    badges: 99,
    traits: { compacts: 999, sessions: 999, failures: 9999 },
  };
  const worn = accessoriesFor(all);
  const spots = worn.map((id) => ACCESSORIES.find((a) => a.id === id).spot);
  assert.deepEqual([...new Set(spots)], spots, `同じ場所に 2 つ出た: ${worn.join(' ')}`);

  // いちばん育った状態では、段のいちばん上が出る
  assert.ok(worn.includes('shades'), '夜目持ちにサングラスが出ない');
  assert.ok(!worn.includes('glasses'), 'サングラスと眼鏡が同時に出ている');

  // 🔴 小物は目元だけ。増やすなら、まず顔より目立たないか見る（2026-08-16 の判断）
  assert.deepEqual([...new Set(spots)], ['eyes'], `目元以外の小物が出た: ${worn.join(' ')}`);
});

test('小物はどれも作業ログから出る（買えるものではない）', () => {
  /*
   * DESIGN.md §8c の線は「**お金で**顔つきを上書きさせない」であって、
   * 顔に何も足すなという話ではない ── ここに出るものは全部 traits や
   * 経過日数から生えているので、目つき・口元と出どころが同じ。
   *
   * 新品の個体には 1 つも出ない、が守れていれば「買って付けた」形にはならない。
   */
  const fresh = {
    ageDays: 0,
    classId: null,
    nightTier: 0,
    badges: 0,
    traits: { compacts: 0, sessions: 0, failures: 0 },
  };
  assert.deepEqual(accessoriesFor(fresh), [], '働く前から小物が付いている');

  // 条件は「普段どおり働いていれば、いつの間にか満たしている量」
  for (const item of ACCESSORIES) {
    assert.equal(typeof item.from, 'function', `${item.id} に出どころが無い`);
    assert.ok(item.spot && item.step >= 1, `${item.id} の場所か段が無い`);
  }
});

test('使い込みは見た目だけ ── 数字には 1 も効かない', () => {
  /*
   * **「劣化」と「衰え」を混ぜない。** 長く使った道具に傷が入るのは歴戦の証だが、
   * 休んだら体力が落ちる・レベルの上がりが鈍る、はやらないと決めている
   * （DESIGN.md §3）── やった瞬間、これは「世話をしないといけないもの」になり、
   * 見守ってくれる側から世話される側に移る。
   *
   * ここでは「同じ state なら、経過日数が違っても強さが同じ」を縛る。
   */
  const gear = [{ slot: 'atk', look: 'blade', rarity: 'rare' }];
  const facts = (ageDays) => ({
    ageDays,
    classId: null,
    nightTier: 0,
    badges: 0,
    traits: { compacts: 0, sessions: 0, failures: 0 },
  });

  const fresh = appearanceFor(40, gear, facts(1));
  const aged = appearanceFor(40, gear, facts(900));

  // 見た目は変わる
  assert.notEqual(fresh.patina, aged.patina, '1 年経っても使い込みが出ていない');
  assert.equal(aged.patina, PATINA_DAYS.length, '最年長でも最終段になっていない');

  // **強さに関わるものは 1 つも変わらない**
  assert.equal(fresh.scale, aged.scale, '経過日数で大きさが変わっている');
  assert.equal(fresh.tier, aged.tier, '経過日数で育ちの段が変わっている');
  const gearOf = (a) => a.marks.filter((m) => m.startsWith('gw-') || m.startsWith('gr-'));
  assert.deepEqual(gearOf(fresh), gearOf(aged), '経過日数で装備が変わっている');

  // 休んでいた日も同じように数える ── 離れていた時間も、一緒にいた時間のうち
  assert.equal(patinaFor(0), 0);
  assert.ok(patinaFor(400) > patinaFor(100), '日が経っても傷が増えない');
});

test('ケガは負けたときだけ。何もしなくても勝手に治る', () => {
  /*
   * 「久しぶりに見たら怪我して帰ってきていた」を作るためのもの。
   * **罰にしない**（DESIGN.md §3）── 手当ての操作が要る／その間 弱っている、の
   * どちらかが入った瞬間、これは「世話をしないといけないもの」になる。
   */
  const H = 3600000;
  const start = new Date('2026-08-15T10:00:00').getTime();

  // 勝ちにも引き分けにも付かない
  assert.equal(hurtFor({ winner: 'you', startedAt: start }, start + 0.1 * H), 0, '勝ってケガをしている');
  assert.equal(hurtFor({ winner: 'draw', startedAt: start }, start + 0.1 * H), 0, '引き分けでケガをしている');
  assert.equal(hurtFor(null, start), 0, '一戦が無いのにケガをしている');

  // 負けた直後は深く、半分を過ぎたら浅くなり、時間で消える
  const lost = { winner: 'foe', startedAt: start };
  assert.equal(hurtFor(lost, start + 0.1 * H), 2, '負けた直後に傷が出ていない');
  assert.equal(hurtFor(lost, start + (HURT_HOURS * 0.75) * H), 1, '治りかけに浅くなっていない');
  assert.equal(hurtFor(lost, start + HURT_HOURS * H), 0, '時間が経っても治らない');
  assert.equal(hurtFor(lost, start + 99 * H), 0, '何日経っても治らない');

  // 時刻が戻っても壊れない（イベントは順番どおりに来ない。CLAUDE.md）
  assert.equal(hurtFor(lost, start - H), 0, '始まる前からケガをしている');
});

test('ケガは見た目だけ ── 強さにも大きさにも効かない', () => {
  const gear = [{ slot: 'atk', look: 'blade', rarity: 'rare' }];
  const start = new Date('2026-08-15T10:00:00').getTime();
  const facts = (battle, now) => ({
    ageDays: 10,
    classId: null,
    nightTier: 0,
    badges: 0,
    traits: { compacts: 0, sessions: 0, failures: 0 },
    battle,
    now,
  });

  const hurt = appearanceFor(40, gear, facts({ winner: 'foe', startedAt: start }, start + 60000));
  const fine = appearanceFor(40, gear, facts({ winner: 'you', startedAt: start }, start + 60000));

  assert.equal(hurt.hurt, 2, '負けたのに傷が出ていない');
  assert.equal(fine.hurt, 0, '勝ったのに傷が出ている');
  assert.ok(hurt.marks.includes('hurt-2'), 'ケガの印が付いていない');

  // **弱っていない。** 大きさも段も装備も、1 つも変わらない
  assert.equal(hurt.scale, fine.scale, 'ケガで小さくなっている');
  assert.equal(hurt.tier, fine.tier, 'ケガで育ちの段が下がっている');
  const gearOf = (a) => a.marks.filter((m) => m.startsWith('gw-') || m.startsWith('gr-'));
  assert.deepEqual(gearOf(hurt), gearOf(fine), 'ケガで装備が変わっている');

  // 治ったあとは、負けなかった子と見た目まで一致する
  const healed = appearanceFor(40, gear, facts({ winner: 'foe', startedAt: start }, start + 9 * 3600000));
  assert.deepEqual(healed.marks, fine.marks, '治ったあとに傷が残っている');
});

test('消える印（ケガ・使い込み・小物）は、付け替えの一覧に必ず載っている', () => {
  /*
   * 描画側はこの一覧を使って前のぶんを外す。**外し忘れると永久に消えない**
   * ── ケガは 1 時間で治る前提なので、ここに載っていないと治らなくなる。
   */
  const classes = appearanceClasses([{ slot: 'atk', look: 'blade' }]);
  for (const cls of ['hurt-1', 'hurt-2', 'pt-0', 'pt-3', 'ac-glasses', 'ac-shades']) {
    assert.ok(classes.includes(cls), `${cls} が外す一覧に無い`);
  }

  // 描画側の正規表現が、その一覧を全部拾えること（片方だけ直すとズレる）
  const drop = /^(lk-|gw-|gr-|ac-|pt-|hurt-)/;
  for (const cls of classes) {
    assert.ok(drop.test(cls), `${cls} を外せる書き方になっていない`);
  }
  for (const file of ['src/renderer/pet.js', 'src/mobile/mobile.js']) {
    const src = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.ok(src.includes(drop.source), `${file} の外し方が一覧とズレている`);
  }

  // 絵と出し分けの両方がある（片方だけだと、クラスは付くのに何も出ない）
  const svg = fs.readFileSync(path.join(HERE, '..', 'src', 'shared', 'pet-svg.js'), 'utf8');
  const css = fs.readFileSync(path.join(HERE, '..', 'src', 'renderer', 'style.css'), 'utf8');
  for (const id of ['hurt-deep', 'hurt-mild']) {
    assert.ok(svg.includes(`id="${id}"`), `${id} の絵が SVG に無い`);
  }
  assert.ok(css.includes('#stage.hurt-2 #hurt-deep'), '深い傷が CSS で出ない');
  assert.ok(css.includes('#stage.hurt-1 #hurt-mild'), '治りかけが CSS で出ない');
});
