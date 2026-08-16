import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { SKINS, SKIN_IDS, DEFAULT_SKIN, skinById, skinView } from '../src/core/skins.js';
import { canWear, skinFor, skinList, grantForSkin } from '../src/core/wardrobe.js';
import { grantsFrom, signLicense } from '../src/core/license.js';
import { emptyState } from '../src/core/growth.js';
import { viewModel } from '../src/core/view.js';

const T0 = new Date('2026-08-13T09:00:00').getTime();

function pair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }),
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
}

test('スキンは見た目だけ。数字に一切効かない', () => {
  /*
   * DESIGN.md §6c の芯。ここが緩んだ瞬間「課金で強くなる」になり、
   * §1（戦闘力の出どころは作業ログ）が崩れる。
   */
  const state = emptyState(T0);
  state.exp = 5000;
  state.classId = 'scholar';
  state.classVector.scholar = 300;

  const plain = viewModel(state, T0, { skin: 'plain' });
  const dusk = viewModel(state, T0, { skin: 'dusk' });

  // 見た目以外は 1 バイトも変わらない
  assert.deepEqual({ ...plain, skin: null, hue: null }, { ...dusk, skin: null, hue: null });
  assert.equal(plain.level, dusk.level);
  assert.deepEqual(plain.hexagon, dusk.hexagon);
  assert.deepEqual(plain.dungeon, dusk.dungeon);
  assert.deepEqual(plain.battle, dusk.battle);
});

test('鍵の無いスキンは着られない（設定に書いても既定に戻る）', () => {
  // 残すと、鍵の意味が「一度買えば設定ファイルを配れる」に変わる
  assert.equal(skinFor({ skin: 'ember' }).id, DEFAULT_SKIN);
  assert.equal(skinFor({ skin: 'mono' }).id, 'mono', '無料のスキンが着られない');
  // 壊れた指定でも落とさない（設定を手で書いて起動しなくなるほうが困る）
  for (const bad of [null, undefined, 42, {}, 'そんなスキンはない']) {
    assert.equal(skinFor({ skin: bad }).id, DEFAULT_SKIN);
  }
});

test('鍵があれば、そのスキンだけが着られる', () => {
  const { publicPem, privatePem } = pair();
  const key = signLicense(`${grantForSkin('ember')}-1234`, privatePem);
  const grants = grantsFrom([key], [publicPem]);

  assert.ok(canWear('ember', grants));
  assert.equal(canWear('frost', grants), false, '買っていないスキンが着られる');
  assert.ok(canWear('plain', grants) && canWear('mono', grants), '無料のスキンが閉じている');

  assert.equal(skinFor({ skin: 'ember', licenses: [key] }, [publicPem]).id, 'ember');
  assert.equal(skinFor({ skin: 'frost', licenses: [key] }, [publicPem]).id, DEFAULT_SKIN);
});

test('着られないものも、名前だけは一覧に出す', () => {
  // 何が売っているのか分からないと選べない。**ただし「集める」対象にはしない**
  // （枚数の分母も、達成率も出さない）
  const list = skinList({});
  assert.equal(list.length, SKINS.length);
  for (const skin of list) {
    assert.ok(skin.label && skin.blurb);
    assert.equal(typeof skin.owned, 'boolean');
  }
  assert.ok(list.find((s) => s.id === DEFAULT_SKIN).current);
});

test('顔つきはスキンで買えない', () => {
  /*
   * 目つきと口元は型（persona.js）が決めるもの（§8c）。そこを買えるようにすると、
   * 「働き方が顔に出る」がお金で上書きできてしまう。
   */
  const css = fs.readFileSync(new URL('../src/renderer/style.css', import.meta.url), 'utf8');
  const faceParts = ['.pupil', '.eyeball', '.lid', '#mouth'];
  for (const line of css.split('\n')) {
    if (!line.includes('.skin-')) continue;
    for (const part of faceParts) {
      assert.ok(!line.includes(part), `スキンが顔に触っている: ${line.trim()}`);
    }
  }
  // データ側にも顔をいじる欄が無い
  for (const skin of SKINS) {
    assert.deepEqual(Object.keys(skin).filter((k) => /face|eye|mouth|pupil/i.test(k)), []);
  }
});

test('スキンは view にも乗る（言語で中身は変わらない）', () => {
  const state = emptyState(T0);
  const ja = viewModel(state, T0, { lang: 'ja', skin: 'mono' });
  const en = viewModel(state, T0, { lang: 'en', skin: 'mono' });
  assert.equal(ja.skin.id, 'mono');
  assert.equal(en.skin.id, 'mono');
  assert.notEqual(ja.skin.label, en.skin.label, '英語でも日本語の名前が出ている');
  assert.equal(skinView('plain').keepsClassHue, true, '既定が系統色を潰している');
  assert.equal(skinView('mono').keepsClassHue, true, '墨が系統色を潰している');
  assert.equal(skinView('ember').keepsClassHue, false, '熾火が系統色を通している');
});

test('スキンには絵と英語が揃っている', () => {
  const CJK = /[ぁ-ヿ一-鿿]/;
  const css = fs.readFileSync(new URL('../src/renderer/style.css', import.meta.url), 'utf8');
  const svg = fs.readFileSync(new URL('../src/shared/pet-svg.js', import.meta.url), 'utf8');

  assert.equal(new Set(SKIN_IDS).size, SKIN_IDS.length, 'id が重複している');
  for (const skin of SKINS) {
    assert.ok(skin.ja && skin.en, `${skin.id} に名前が無い`);
    assert.ok(skin.blurb && skin.blurbEn, `${skin.id} に説明が無い`);
    assert.ok(!CJK.test(`${skin.en}${skin.blurbEn}`), `${skin.id} の英語に日本語が混ざっている`);
    if (skin.id === DEFAULT_SKIN) continue;
    // 一覧に足しただけで CSS を書き忘れると、選んでも何も変わらない
    assert.ok(css.includes(`#stage.skin-${skin.id}`), `${skin.id} の CSS が無い`);
    if (skin.texture) assert.ok(svg.includes(`id="tex-${skin.texture}"`), `${skin.id} の模様が SVG に無い`);
    if (skin.trinket) assert.ok(svg.includes(`id="trinket-${skin.trinket}"`), `${skin.id} の小物が SVG に無い`);
  }
});

test('view と Worker の線に crypto を持ち込まない', async () => {
  /*
   * 鍵の検証は Ed25519 で `node:crypto` が要る。Worker は標準では持っていないので、
   * `view.js` から辿れる場所に置くと**本番が起動時に落ちる**
   * （`wrangler deploy --dry-run` が nodejs_compat を要求して発覚した）。
   *
   * 確かめる場所は PC の 1 箇所（wardrobe.js）に寄せてある。
   */
  const fs = await import('node:fs');
  const seen = new Set();
  const walk = (rel) => {
    if (seen.has(rel)) return;
    seen.add(rel);
    const src = fs.readFileSync(new URL(`../src/core/${rel}`, import.meta.url), 'utf8');
    assert.ok(!/from '(node:)?crypto'/.test(src), `${rel} が node:crypto を読んでいる`);
    for (const m of src.matchAll(/from '\.\/([\w.-]+\.js)'/g)) walk(m[1]);
  };
  walk('view.js');
  assert.ok(seen.has('skins.js'), 'skins.js まで辿れていない');
  assert.ok(!seen.has('license.js'), 'view から license.js に辿り着く');
  assert.ok(!seen.has('wardrobe.js'), 'view から wardrobe.js に辿り着く');

  // id を引くだけの道は残っている（Worker が使う）
  assert.equal(skinById('dusk').id, 'dusk');
  assert.equal(skinById('そんなものはない').id, DEFAULT_SKIN);
});
