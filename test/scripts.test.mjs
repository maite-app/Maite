import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { ACCESSORIES } from '../src/core/appearance.js';

/**
 * 素のスクリプト（オーバーレイ・スマホ）が、そもそも読めるかを見る。
 *
 * この 2 つは ES モジュールではないので import できず、テストから外れていた
 * ── 実際に `const LANG` を二重に宣言して、**ページが丸ごと真っ白**になっていた
 * （画面には HTML の初期値だけが残るので、ぱっと見は動いているように見える）。
 * 構文だけでも通しておけば、その事故は起きない。
 */
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const PLAIN_SCRIPTS = [
  'src/renderer/pet.js',
  'src/mobile/mobile.js',
  'src/shared/pet-svg.js',
  'src/shared/gestures.js',
];

/** ページが `<script src>` で読むもの。配る側の一覧から漏れると 404 になる。 */
const SERVED = ['pet.css', 'mobile.css', 'mobile.js', 'pet-svg.js', 'gestures.js'];

test('素のスクリプトが構文として読める', () => {
  for (const rel of PLAIN_SCRIPTS) {
    const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.doesNotThrow(() => new vm.Script(code, { filename: rel }), `${rel} が読めない`);
  }
});

test('絵の中にバッククォートを書かない', () => {
  /*
   * pet-svg.js は丸ごと 1 つのテンプレート文字列。**注記の中にバッククォートを
   * 1 つ置くだけで、そこで文字列が閉じてファイル全体が構文エラーになる**
   * ── 絵の描き直し方をコメントで書いたときに実際にやった。
   */
  const svg = fs.readFileSync(path.join(ROOT, 'src/shared/pet-svg.js'), 'utf8');
  const body = svg.slice(svg.indexOf('`') + 1, svg.lastIndexOf('`'));
  assert.equal(body.includes('`'), false, '絵の中にバッククォートがある');
});

test('素のスクリプトに import / export を書かない', () => {
  // 書いた瞬間、ブラウザ側で読み込めなくなる（<script> は module ではない）
  for (const rel of PLAIN_SCRIPTS) {
    const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.ok(!/^\s*(import|export)\s/m.test(code), `${rel} に import / export がある`);
  }
});

test('スマホのページと Worker の PAGE が同じ形をしている', () => {
  /*
   * HTML だけは自動生成に乗っていない手写し（CLAUDE.md）。
   * **要素を足したら両方に足す。** 片方だけだと、スマホから見たときに
   * その節が丸ごと出ない ── しかも例外は出ないので気づけない。
   */
  const html = fs.readFileSync(path.join(ROOT, 'src/mobile/index.html'), 'utf8');
  const page = fs.readFileSync(path.join(ROOT, 'server/src/worker.js'), 'utf8');

  const ids = [...html.matchAll(/id="([a-z-]+)"/g)].map((m) => m[1]);
  const missingIds = ids.filter((id) => !page.includes(`id="${id}"`));
  assert.deepEqual(missingIds, [], `Worker の PAGE に無い id: ${missingIds.join(', ')}`);

  const keys = [...html.matchAll(/data-t="([a-z.]+)"/g)].map((m) => m[1]);
  const missingKeys = keys.filter((key) => !page.includes(`data-t="${key}"`));
  assert.deepEqual(missingKeys, [], `Worker の PAGE に無い data-t: ${missingKeys.join(', ')}`);

  // 目次（左カラム）が飛ぶ先。片方に無いと、その節だけ目次から消える
  const secs = [...html.matchAll(/data-sec="([a-z]+)"/g)].map((m) => m[1]);
  assert.ok(secs.length >= 10, `目次に載る節が ${secs.length} 個しかない`);
  const missingSecs = secs.filter((key) => !page.includes(`data-sec="${key}"`));
  assert.deepEqual(missingSecs, [], `Worker の PAGE に無い data-sec: ${missingSecs.join(', ')}`);

  // 節をまとめる束。片方だけに入れると、本文と目次で切れ目がずれる
  const groups = [...html.matchAll(/data-group="([a-z]+)"/g)].map((m) => m[1]);
  assert.ok(groups.length >= 10, `束に入っていない節がある（${groups.length} 個しか付いていない）`);
  const missingGroups = groups.filter((key) => !page.includes(`data-group="${key}"`));
  assert.deepEqual(missingGroups, [], `Worker の PAGE に無い data-group: ${missingGroups.join(', ')}`);

  // 見出しの文言は目次にも使う。data-sec に対応する panel.* が無いと、
  // 目次にキーの文字列（"today"）がそのまま出る。束のほうも同じ
  const chrome = fs.readFileSync(path.join(ROOT, 'src/core/i18n.js'), 'utf8');
  for (const key of secs) {
    assert.ok(chrome.includes(`'panel.${key}'`), `panel.${key} の文言が i18n.js に無い`);
  }
  for (const key of new Set(groups)) {
    assert.ok(chrome.includes(`'group.${key}'`), `group.${key} の文言が i18n.js に無い`);
  }
});

test('SVG の中の要素に innerHTML を書かない', () => {
  /*
   * `innerHTML` は仕様上どの Element にもあるが、**WebKit は SVG 要素で
   * 実装していない**。Chrome では消えるのに iPhone では消えない ──
   * 実際に「見出しは出るのに中身が空」になっていた。
   *
   * `<svg>` の中で id が付いている要素を拾って、その id を受けている変数に
   * innerHTML を書いていないかを見る。
   */
  const html = fs.readFileSync(path.join(ROOT, 'src/mobile/index.html'), 'utf8');
  const js = fs.readFileSync(path.join(ROOT, 'src/mobile/mobile.js'), 'utf8');

  const svgIds = [...(html.match(/<svg[\s\S]*?<\/svg>/g) || []).join('\n').matchAll(/id="([a-z-]+)"/g)]
    .map((m) => m[1]);
  assert.ok(svgIds.length >= 3, `<svg> の中に id が ${svgIds.length} 個しか無い`);

  for (const id of svgIds) {
    // `const hexLabels = document.getElementById('hex-labels');` から変数名を取る
    const bind = js.match(new RegExp(`const\\s+(\\w+)\\s*=\\s*document\\.getElementById\\('${id}'\\)`));
    if (!bind) continue;
    assert.ok(
      !new RegExp(`\\b${bind[1]}\\.innerHTML`).test(js),
      `${bind[1]}（#${id}）は SVG の中。innerHTML ではなく clear() で消す`,
    );
  }
});

test('Worker に焼き込んだ資産が、元のファイルと合っている', () => {
  // `npm run build:worker` の掛け忘れ。本番だけ古い CSS / JS で動き続ける
  const assets = fs.readFileSync(path.join(ROOT, 'server/src/assets.js'), 'utf8');
  for (const rel of ['src/mobile/mobile.js', 'src/mobile/mobile.css', 'src/shared/pet-svg.js']) {
    const source = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    // 最後の 1 行だけ見れば足りる（変えたのに焼き直していない、が分かる）
    const tail = source.trimEnd().split('\n').slice(-1)[0].trim();
    if (tail.length < 12) continue;
    const escaped = tail.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
    assert.ok(
      assets.includes(tail) || assets.includes(escaped),
      `${rel} を変えたあと npm run build:worker を掛けていない`,
    );
  }
});

test('ページが読むものは、どちらのサーバーも配っている', () => {
  /*
   * スマホのページは `<script src>` で素のスクリプトを読む。**配る側の一覧に
   * 足し忘れると 404 になり、しぐさだけ静かに死ぬ**（画面は出るので気づけない）。
   * LAN サーバー（src/main/server.js）と Worker（assets.js）の両方を見る。
   */
  const lan = fs.readFileSync(path.join(ROOT, 'src/main/server.js'), 'utf8');
  const assets = fs.readFileSync(path.join(ROOT, 'scripts/build-worker-assets.mjs'), 'utf8');
  const built = fs.readFileSync(path.join(ROOT, 'server/src/assets.js'), 'utf8');

  for (const name of SERVED) {
    assert.ok(lan.includes(`'/${name}'`), `LAN サーバーが ${name} を配っていない`);
    assert.ok(assets.includes(`'${name}'`), `assets の生成元に ${name} が無い`);
    assert.ok(built.includes(`"${name}"`), `assets.js に ${name} が焼き込まれていない`);
  }

  // ページ側が実際に読んでいるものが、その一覧に入っているか
  const html = fs.readFileSync(path.join(ROOT, 'src/mobile/index.html'), 'utf8');
  for (const m of html.matchAll(/(?:src|href)="\/([\w.-]+)"/g)) {
    assert.ok(SERVED.includes(m[1]), `${m[1]} が配る一覧に無い`);
  }
});

test('じゃれてくる相手の絵は、差し替えても動きが外れない', () => {
  /*
   * 猫・小鳥・亀は**描き直す前提**で置いてある（pet-svg.js の見出し）。
   * 動きは id とクラスに紐づいているので、絵を貼り替えたときにそこが落ちると
   * **その部品だけ静止する** ── 絵は新しいのに猫のしっぽが止まっている、
   * という気づきにくい壊れ方をする。
   */
  const svg = fs.readFileSync(path.join(ROOT, 'src/shared/pet-svg.js'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'src/renderer/style.css'), 'utf8');

  // 動きの引き金になっている id
  for (const id of ['prop-cat', 'prop-bird', 'prop-turtle']) {
    assert.ok(svg.includes(`id="${id}"`), `${id} が絵から消えている`);
    assert.ok(css.includes(`#${id}`), `${id} に動きが付いていない`);
  }

  // 部品ごとに動く（止まると気づきにくい）
  const moving = [
    ['prop-cat', 'tail'],
    ['prop-bird', 'wing'],
    ['prop-turtle', 'fur'],
  ];
  for (const [id, cls] of moving) {
    const block = svg.slice(svg.indexOf(`id="${id}"`), svg.indexOf('</g>', svg.indexOf(`id="${id}"`)));
    assert.ok(block.includes(`class="${cls}"`), `${id} に動く部品（.${cls}）が無い`);
    assert.ok(
      new RegExp(`#${id} \\.${cls}[\\s\\S]{0,200}animation:`).test(css),
      `#${id} .${cls} に動きが付いていない`,
    );
  }

  // 色はクラスで付ける。直に書くとスキンと系統色が効かなくなる
  for (const id of ['prop-cat', 'prop-bird', 'prop-turtle']) {
    const block = svg.slice(svg.indexOf(`id="${id}"`), svg.indexOf('</g>', svg.indexOf(`id="${id}"`)));
    assert.ok(!/\s(fill|stroke)="/.test(block), `${id} に色を直に書いている`);
  }
});

test('しぐさは、一覧に載っているものが必ず動く', () => {
  /*
   * `gestures.js` に足しただけで CSS を書き忘れると、**そのしぐさが選ばれた
   * 数秒間、まったく動かない**。例外も出ないので、眺めていても「たまたま
   * 動かない時間」にしか見えない ── いちばん気づけない壊れ方。
   *
   * 逆に CSS だけ残って一覧から消えたものも拾う（死んだ指定が溜まる）。
   */
  const js = fs.readFileSync(path.join(ROOT, 'src/shared/gestures.js'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'src/renderer/style.css'), 'utf8');

  const ids = [...js.matchAll(/\{ id: '([\w-]+)', ms: (\d+)/g)].map((m) => ({ id: m[1], ms: Number(m[2]) }));
  assert.ok(ids.length >= 30, `しぐさが ${ids.length} 個しか読めていない`);

  /*
   * `battle` だけは id と CSS の名前が一致しない ── 勝ち負けで
   * `g-battle-win` / `g-battle-lose` に分かれる（pet.js の playBattle）。
   */
  const ALIASES = { battle: ['battle-win', 'battle-lose'] };

  for (const { id, ms } of ids) {
    const names = ALIASES[id] || [id];
    for (const name of names) {
      assert.ok(
        new RegExp(`#stage\\.g-${name}[\\s,]`).test(css),
        `${name} に CSS が無い（選ばれても何も起きない）`,
      );
    }
    if (ALIASES[id]) continue;

    /*
     * **動き終わる前に切らない。** gestures.js の ms は「いつクラスを外すか」で、
     * CSS の秒数は「どれだけ動くか」── CSS のほうが長いと、途中で切られて
     * 元の姿にワープする。
     *
     * 短いぶんは正しいことがある（`infinite` で回すもの、体は一度動くだけで
     * あとは小道具のほうが動くもの）ので、そこは咎めない。
     */
    const wired = css.match(
      new RegExp(`#stage\\.g-${id} #creature \\{\\s*animation: [\\w-]+ ([\\d.]+)s([^;]*);`),
    );
    if (!wired) continue;
    if (wired[2].includes('infinite')) continue;
    const seconds = Number(wired[1]);
    assert.ok(
      seconds * 1000 <= ms + 100,
      `${id} は動き終わる前に切られる（gestures.js ${ms}ms / CSS ${seconds}s）`,
    );
  }

  // CSS 側にあって一覧に無いもの。演出用（レベルアップ）と別名は除く
  const NOT_GESTURES = ['levelup', 'battle-win', 'battle-lose'];
  const styled = new Set([...css.matchAll(/#stage\.g-([\w-]+) #creature/g)].map((m) => m[1]));
  const known = new Set(ids.map((g) => g.id));
  for (const id of styled) {
    if (NOT_GESTURES.includes(id)) continue;
    assert.ok(known.has(id), `#stage.g-${id} の指定が残っているが、一覧に ${id} が無い`);
  }
});

test('LAN のアドレスは、化けない側からも読める', () => {
  /*
   * **Windows の Electron はコンソールに UTF-8 のまま吐く。** 日本語環境
   * （CP932）だと案内ごと化けて、**肝心の URL が読めない** ── 実際に
   * 「アドレス文字化けしてた」で詰まった。node で走る scripts/ は化けないので、
   * オーバーレイが控えを置いて、そちらから出す。
   */
  const server = fs.readFileSync(new URL('../src/main/server.js', import.meta.url), 'utf8');
  const status = fs.readFileSync(new URL('../scripts/status.mjs', import.meta.url), 'utf8');

  assert.ok(server.includes('SERVE_FILE'), 'オーバーレイがアドレスの控えを置いていない');
  assert.ok(status.includes('SERVE_FILE'), 'status.mjs が控えを読んでいない');

  // 案内の行と URL の行を分ける ── 化けても URL の行だけは ASCII で残る
  const printed = server.match(/console\.log\('(\[aipet\][^']*)'\)/);
  assert.ok(printed, 'アドレスの案内が出ていない');
  // eslint-disable-next-line no-control-regex
  assert.ok(!/[^\x00-\x7F]/.test(printed[1]), `URL の直前の行に非 ASCII がある: ${printed[1]}`);
});

test('名刺は、相棒の絵を 2 通り持たない', () => {
  /*
   * **カード用に絵を描き直さない。** 装備・小物・使い込み・型の顔つきの
   * 出し分けは style.css にしかないので、同じ CSS を読ませて撮るほうが
   * 本人とズレようがない ── 描き直した瞬間、名刺は「本人と少し違う絵」になる。
   */
  const html = fs.readFileSync(new URL('../src/renderer/card.html', import.meta.url), 'utf8');
  const js = fs.readFileSync(new URL('../src/renderer/card.js', import.meta.url), 'utf8');

  assert.ok(html.includes('href="style.css"'), 'オーバーレイと同じ CSS を読んでいない');
  assert.ok(html.includes('pet-svg.js'), '絵を共通のところから読んでいない');
  assert.ok(js.includes('window.AIPET_SVG'), '絵を書き直している');

  // **見た目の条件を書かない**（appearance.js が決めたクラスを付けるだけ）
  assert.ok(js.includes('look.marks'), 'view の印を使っていない');
  assert.ok(!/lk-|gw-|gr-|ac-/.test(js.replace(/`\$\{[^`]*`/g, '')), 'カード側で見た目の条件を書いている');

  // 文言も view から引く（このページも素のスクリプト）
  assert.ok(js.includes("view.text"), '文言を焼き付けている');
  const CJK = /[぀-ヿ一-鿿]/;
  const strings = [...js.matchAll(/'([^']*)'|"([^"]*)"/g)].map((m) => m[1] || m[2] || '');
  for (const s of strings) {
    assert.ok(!CJK.test(s), `card.js に日本語が焼き付いている: ${s}`);
  }
});

test('相棒の絵の id と、ページの id がぶつからない', () => {
  /*
   * スマホ用ページは**絵を自分の中に差し込む**（`pet-mount`.innerHTML）ので、
   * 絵の中の id とページの id は同じ入れ物に並ぶ。**先に置かれたほうが勝つ。**
   *
   * 実際に `gear` がぶつかっていた ── 絵の `<g id="gear">` はページの頭のほうに
   * 差し込まれるので、`getElementById('gear')` が拾うのは常にそちら。装備の行は
   * SVG の中に足され、**中身はあるのに高さ 0** で、「身に着けているもの」の下が
   * ずっと空だった。例外も出ないし DOM には確かに入っているので、いちばん
   * 見つけにくい壊れ方をする。
   *
   * 絵にもページにも id を足すのは普通のことなので、**ぶつかっていないことを
   * ここで縛る**（片方を直したときに、もう片方が黙って壊れないように）。
   */
  const idsOf = (text) => [...text.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
  const svg = new Set(idsOf(fs.readFileSync(path.join(ROOT, 'src/shared/pet-svg.js'), 'utf8')));

  for (const page of ['src/mobile/index.html', 'src/renderer/index.html', 'src/renderer/card.html']) {
    const clash = idsOf(fs.readFileSync(path.join(ROOT, page), 'utf8')).filter((id) => svg.has(id));
    assert.deepStrictEqual(clash, [], `${page} と絵とで id がぶつかっている: ${clash.join(', ')}`);
  }

  // スマホのページは手写しがもう 1 枚ある（CLAUDE.md「同じ中身を持つファイル」）
  const worker = fs.readFileSync(path.join(ROOT, 'server/src/worker.js'), 'utf8');
  assert.ok(worker.includes('id="dungeon-gear"'), 'Worker 側のページだけ id が古い');
  assert.ok(!/id="gear"/.test(worker), 'Worker 側のページに、絵とぶつかる id が残っている');
});

test('絵は 1 枚の文字列として最後まで閉じている', () => {
  /*
   * `pet-svg.js` は ES モジュールではなく、**1 本のテンプレート文字列**を
   * `window.AIPET_SVG` に入れるだけの素のスクリプト（file:// と http:// の
   * 両方から同じ `<script src>` で読めるようにするため）。
   *
   * つまり **中にバッククォートを 1 つ書いた瞬間に文字列が切れる。** 実際に
   * SVG のコメントへ `.glint` と書いて切った ── 例外はコンソールにしか出ず、
   * 画面には `undefined` の 9 文字が出るだけなので、絵が丸ごと消えていても
   * 「読み込みが遅いのかな」で通り過ぎてしまう。
   */
  const source = fs.readFileSync(path.join(ROOT, 'src/shared/pet-svg.js'), 'utf8');
  assert.strictEqual(
    (source.match(/`/g) || []).length,
    2,
    'pet-svg.js のバッククォートが 2 つではない（絵の途中で文字列が切れている）',
  );

  const window = {};
  new Function('window', source)(window);
  const svg = window.AIPET_SVG;
  assert.ok(typeof svg === 'string' && svg.includes('</svg>'), '絵が最後まで入っていない');

  // 小物は appearance.js が付けるクラスで出し分けるので、受け皿が要る
  for (const item of ACCESSORIES) {
    assert.ok(svg.includes(`id="ac-${item.id}"`), `絵に ac-${item.id} が無い`);
  }
});

test('サングラスを掛けている間は、目を出さない', () => {
  /*
   * レンズは角の立った形、目は半径 9 の丸。**透かすと必ずどこかがはみ出す**
   * ── 下と横から白目と瞳が出て、掛けそこねているようにしか見えなかった。
   *
   * 消すのは `.eye` の**まとまりごと**。中の `.eyeball` / `.pupil` を個別に
   * 消す書き方（まばたき・寝るときと同じ形）にすると、しぐさのアニメーションが
   * 後から opacity を戻してきて、サングラスの下で目が動く。
   */
  const css = fs.readFileSync(path.join(ROOT, 'src/renderer/style.css'), 'utf8');

  assert.match(css, /#stage\.ac-shades #face \.eye\s*\{\s*opacity:\s*0/, 'サングラスの下で目が消えていない');
  assert.doesNotMatch(
    css,
    /#wear #ac-shades \.lens\s*\{[^}]*\/\s*0?\.\d+\s*\)/,
    'レンズが透けている（目がはみ出す）',
  );
});

test('点線の輪を、2 つ同時に回さない', () => {
  /*
   * 素のオーラ（Lv15 から）と、守りの装備（ward）の輪は**どちらも点線の
   * 楕円**。重なると輪が 3 本になって、200px の枠が丸ごと輪で埋まり、
   * 相棒より輪のほうが大きく見えていた（スマホで実際にそうなっていた）。
   *
   * 装備のほうは「なぜ出ているか」を説明できるので、素のオーラを引っ込める。
   */
  const css = fs.readFileSync(path.join(ROOT, 'src/renderer/style.css'), 'utf8');
  assert.match(css, /#stage\.gw-def-ward #aura\s*\{\s*opacity:\s*0/, '輪が重なったままになる');

  // 引っ込めるほうが後ろに無いと、has-aura に負ける（特異度が同じなので後勝ち）
  assert.ok(
    css.indexOf('#stage.gw-def-ward #aura') > css.indexOf('#stage.has-aura #aura'),
    '打ち消しの指定が has-aura より前にある',
  );
});

test('オーラは、胴体と一緒に大きくなる', () => {
  /*
   * `#aura` は `#creature` の外にあるので、放っておくと拡大に付いてこない。
   * 前はそのぶん「どの大きさでも body の外に出る」半径で描いてあり、Lv が
   * 上がるほど**上は body に食い込み、横と下だけ大きく空いていた**。
   *
   * 拡大は「まとまり」、回転は「楕円」。transform は 1 要素に 1 つしか
   * 持てないので、同じところに両方書くと後から当たったほうだけが残る。
   */
  const css = fs.readFileSync(path.join(ROOT, 'src/renderer/style.css'), 'utf8');
  const group = css.match(/#aura\s*\{[^}]*transform:\s*scale\(var\(--scale\)\)[^}]*\}/);
  assert.ok(group, 'オーラが胴体の拡大に付いていっていない');
  assert.ok(/transform-origin:\s*100px 166px/.test(group[0]), '拡大の基点が足元になっていない');

  const ellipse = css.match(/#aura ellipse\s*\{[^}]*\}/);
  assert.ok(ellipse && !/transform:/.test(ellipse[0]), '楕円側に transform を書くと回転が消える');
  assert.ok(/animation:\s*spin/.test(ellipse[0]), '楕円が回っていない');
});
