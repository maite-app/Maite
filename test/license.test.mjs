import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  grantOf,
  grantsFrom,
  hasGrant,
  FREE_DAYS,
  PUBLIC_KEYS,
  parseLicense,
  verifyLicense,
  signLicense,
  reachFor,
  REACH_DAYS_PER_KEY,
} from '../src/core/license.js';

/** その場で対を作る。テストのために秘密鍵をリポジトリに置かない。 */
function pair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }),
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
}

test('本物の鍵は通り、他人の鍵は通らない', () => {
  const mine = pair();
  const theirs = pair();
  const key = signLicense('reach-1234', mine.privatePem);

  assert.ok(verifyLicense(key, [mine.publicPem]));
  assert.equal(verifyLicense(key, [theirs.publicPem]), false, '別の秘密鍵で作った鍵が通っている');
  // 公開鍵が複数あってもよい（版を上げて増やしたとき）
  assert.ok(verifyLicense(key, [theirs.publicPem, mine.publicPem]));
});

test('それらしい文字列では通らない', () => {
  const { publicPem, privatePem } = pair();
  const key = signLicense('reach-1234', privatePem);

  const forged = [
    'AIPET-order-1234.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    // 署名はそのままで、番号だけ書き換える
    key.replace('reach-1234', 'reach-9999'),
    // 署名の 1 文字を変える
    `${key.slice(0, -2)}${key.slice(-2) === 'AA' ? 'BB' : 'AA'}`,
  ];
  for (const bad of forged) assert.equal(verifyLicense(bad, [publicPem]), false, `${bad} が通っている`);
});

test('壊れたものを渡しても落ちない（打ち間違いでアプリが起動しなくなる）', () => {
  const { publicPem } = pair();
  for (const bad of [null, undefined, '', '   ', 42, {}, 'AIPET-', 'ふつうの文字列', 'AIPET-a.b']) {
    assert.equal(verifyLicense(bad, [publicPem]), false);
    assert.equal(parseLicense(bad), null);
  }
  // 公開鍵のほうが壊れていても落ちない
  assert.equal(verifyLicense('AIPET-order-1234.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', ['not a pem']), false);
});

test('公開鍵が 1 つも無ければ、誰も課金者にならない', () => {
  // **配ってよい既定。** 「課金の口がまだ開いていない」という意味になる
  const { privatePem } = pair();
  const key = signLicense('reach-1234', privatePem);
  assert.equal(verifyLicense(key, []), false);
  assert.equal(verifyLicense(key, null), false);
  assert.deepEqual(reachFor(key, []), { days: FREE_DAYS, unlocked: false, keys: 0 });
});

test('鍵で変わるのは「遡れる範囲」だけ', () => {
  /*
   * DESIGN.md §6b の芯。**同じログを入れたら同じレベルが出る。**
   * ここが返す値以外に課金で変わるものがあってはいけない ── 係数も倍率も
   * 上限も全員同じで、公開して困るところが 1 つも無いのが条件。
   */
  const { publicPem, privatePem } = pair();
  const key = signLicense('reach-1234', privatePem);

  const free = reachFor(null, [publicPem]);
  const paid = reachFor(key, [publicPem]);

  // 返すのは日数と、その内訳だけ。倍率や係数がここに増えたら線を越えている
  assert.deepEqual(Object.keys(free).sort(), ['days', 'keys', 'unlocked']);
  assert.deepEqual(Object.keys(paid).sort(), ['days', 'keys', 'unlocked']);
  assert.equal(free.days, FREE_DAYS);
  assert.equal(paid.unlocked, true);
});

test('鍵 1 本で 30 日ずつ伸びる（重ねて買える）', () => {
  /*
   * **一度払えば全部、にしない。** 買う理由が一生に一度しか来なくなる。
   * 30 日ずつなら「もっと前まで遡りたい」が起きるたびに理由ができる。
   *
   * 増えるのは**見える範囲**だけで、そこから出る EXP は本当に働いたぶん
   * そのまま ── 何本重ねても「同じログなら同じレベル」は崩れない。
   */
  const { publicPem, privatePem } = pair();
  const one = signLicense('reach-0001', privatePem);
  const two = signLicense('reach-0002', privatePem);
  const three = signLicense('reach-0003', privatePem);

  assert.equal(reachFor(null, [publicPem]).days, FREE_DAYS);
  assert.equal(reachFor([one], [publicPem]).days, FREE_DAYS + REACH_DAYS_PER_KEY);
  assert.equal(reachFor([one, two], [publicPem]).days, FREE_DAYS + REACH_DAYS_PER_KEY * 2);
  assert.equal(reachFor([one, two, three], [publicPem]).days, FREE_DAYS + REACH_DAYS_PER_KEY * 3);

  // **同じ鍵を 2 回貼っても増えない。** 貼り付けの重複で日数が伸びたら、鍵の意味が消える
  assert.equal(reachFor([one, one, one], [publicPem]).days, FREE_DAYS + REACH_DAYS_PER_KEY);

  // 偽物は 1 日も伸ばさない
  const { privatePem: otherPem } = pair();
  const forged = signLicense('reach-9999', otherPem);
  assert.equal(reachFor([one, forged], [publicPem]).days, FREE_DAYS + REACH_DAYS_PER_KEY);

  // `all` の券だけは全期間（自分用・引き換え用）
  const all = signLicense('all-0001', privatePem);
  assert.equal(reachFor([all], [publicPem]).days, null, '引き換え券が全期間になっていない');
});

test('リポジトリに秘密鍵を置いていない', () => {
  // 公開鍵しか持たない ── ここに秘密鍵が混ざったら、鍵を誰でも作れる
  for (const pem of PUBLIC_KEYS) {
    assert.ok(!/PRIVATE KEY/.test(pem), 'PUBLIC_KEYS に秘密鍵が入っている');
  }
});

test('発行できる id を絞ってある', () => {
  const { privatePem } = pair();
  assert.ok(signLicense('reach-1234', privatePem).startsWith('AIPET-reach-1234.'));
  for (const bad of ['短い', 'a'.repeat(65), 'has space', 'dots.are.out', '']) {
    assert.throws(() => signLicense(bad, privatePem), /id は/, `${bad} が通っている`);
  }
});

test('鍵の頭が「何を開けるか」になっている', () => {
  /*
   * ここを分けておかないと、鍵が「全部入り」の 1 種類にしかならない
   * ── スキンを 2 本目として売るときに（§6c）、遡れる範囲の鍵で全部開いてしまう。
   */
  const { publicPem, privatePem } = pair();
  const reachKey = signLicense('reach-1234', privatePem);
  const skinKey = signLicense('skin_ember-1234', privatePem);

  assert.equal(grantOf('reach-1234'), 'reach');
  assert.equal(grantOf('skin_ember-1234'), 'skin_ember');

  const both = grantsFrom([reachKey, skinKey], [publicPem]);
  assert.ok(hasGrant(both, 'reach'));
  assert.ok(hasGrant(both, 'skin_ember'));
  assert.equal(hasGrant(both, 'skin_frost'), false, '買っていないスキンが開いている');

  // スキンの鍵だけでは、遡れる範囲は開かない
  const skinOnly = grantsFrom([skinKey], [publicPem]);
  assert.equal(hasGrant(skinOnly, 'reach'), false, 'スキンの鍵で全期間が開いている');
  assert.deepEqual(reachFor([skinKey], [publicPem]), { days: FREE_DAYS, unlocked: false, keys: 0 });

  // all の鍵は何にでも効く（自分用と、引き換え対応用）
  const master = grantsFrom([signLicense('all-1234', privatePem)], [publicPem]);
  assert.ok(hasGrant(master, 'reach') && hasGrant(master, 'skin_frost'));
});

test('鍵は何本でも持てる', () => {
  // 2 本目以降がスキンになる想定なので、1 本しか持てない形にしない
  const { publicPem, privatePem } = pair();
  const keys = ['reach-1', 'skin_ember-2', 'skin_dusk-3'].map((id) => signLicense(id, privatePem));
  const grants = grantsFrom(keys, [publicPem]);
  assert.equal(grants.size, 3);
  // 壊れた鍵が 1 本混ざっても、他は生きる
  assert.equal(grantsFrom([...keys, 'AIPET-bad-1.zzzz'], [publicPem]).size, 3);
});
