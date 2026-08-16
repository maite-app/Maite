#!/usr/bin/env node
/**
 * 引き換え券の道具。**売るのは「遡れる範囲」だけ**（DESIGN.md §6b）。
 *
 *   node scripts/license.mjs status              # いまの状態を見る
 *   node scripts/license.mjs redeem AIPET-xxx.yy # 鍵を入れる
 *   node scripts/license.mjs forget              # 鍵を外す
 *
 * 売る側だけが使うもの：
 *
 *   node scripts/license.mjs init                # 署名の対を作る（最初に 1 回）
 *   node scripts/license.mjs issue <注文番号>     # 鍵を 1 本発行する
 *
 * **秘密鍵はリポジトリに置かない。** `init` は `~/.aipet` の外
 * （既定で `~/.aipet-signing/` ）に書き出し、公開鍵だけを標準出力に出す
 * ── それを `src/core/license.js` の PUBLIC_KEYS に貼る。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { CONFIG_FILE } from '../src/core/paths.js';
import {
  PUBLIC_KEYS,
  FREE_DAYS,
  REACH_DAYS_PER_KEY,
  verifyLicense,
  signLicense,
  parseLicense,
  reachFor,
} from '../src/core/license.js';

const SIGNING_DIR = process.env.AIPET_SIGNING_DIR || path.join(os.homedir(), '.aipet-signing');
const PRIVATE_FILE = path.join(SIGNING_DIR, 'license-private.pem');
const PUBLIC_FILE = path.join(SIGNING_DIR, 'license-public.pem');

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8').replace(/^﻿/, '')) || {};
  } catch {
    return {};
  }
}

function writeConfig(config) {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`);
}

/** 手元にある鍵を全部（古い 1 本だけの形も読む）。 */
function keysOf(config) {
  const out = [
    ...(Array.isArray(config.licenses) ? config.licenses : []),
    ...(config.license ? [config.license] : []),
    ...(process.env.AIPET_LICENSE ? [process.env.AIPET_LICENSE] : []),
  ];
  return [...new Set(out.map((k) => String(k).trim()).filter(Boolean))];
}

function status() {
  const config = readConfig();
  const keys = keysOf(config);

  if (!PUBLIC_KEYS.length) {
    console.log('課金の口はまだ開いていません（src/core/license.js の PUBLIC_KEYS が空）。');
    console.log(`いまは全員 無料の範囲 ── 直近 ${FREE_DAYS} 日ぶんまで遡れます。`);
    return;
  }
  if (!keys.length) {
    console.log(`鍵なし ── 遡れるのは直近 ${FREE_DAYS} 日ぶん。`);
    console.log(`鍵 1 本につき、さらに ${REACH_DAYS_PER_KEY} 日ぶん遡れます。`);
    console.log('鍵を持っているなら: node scripts/license.mjs redeem AIPET-xxxx.yyyy');
    return;
  }

  const reach = reachFor(keys);
  console.log(reach.days === null ? '遡れる範囲 ── 全期間' : `遡れる範囲 ── 直近 ${reach.days} 日ぶん`);
  if (reach.keys) {
    console.log(`  無料の ${FREE_DAYS} 日 ＋ 鍵 ${reach.keys} 本 × ${REACH_DAYS_PER_KEY} 日`);
  }
  for (const key of keys) {
    const parsed = parseLicense(key);
    const ok = verifyLicense(key);
    console.log(`  ${ok ? '○' : '×'} ${parsed ? parsed.id : '（形が違う）'}${ok ? '' : '  ← この版では通りません'}`);
  }
  if (reach.days !== null) {
    console.log(`
もう ${REACH_DAYS_PER_KEY} 日ぶん遡りたくなったら、鍵をもう 1 本足せます。`);
  }
}

function redeem(value) {
  if (!value) {
    console.error('鍵を渡してください: node scripts/license.mjs redeem AIPET-xxxx.yyyy');
    process.exit(1);
  }
  if (!parseLicense(value)) {
    console.error('鍵の形が違います（AIPET-<番号>.<署名>）。');
    process.exit(1);
  }
  // **通らない鍵でも保存はする。** 版が上がって公開鍵が増えたときに、
  // 打ち直させるのは筋が悪い。効くかどうかは status で分かる。
  const config = readConfig();

  /*
   * **上書きせずに足す。** 鍵は 1 本 30 日ぶんで、重ねて買えるようにしてある
   * ── 上書きすると、2 本目を入れた瞬間に 1 本目が消えて日数が戻る。
   */
  const before = keysOf(config);
  const next = [...new Set([...before, value.trim()])];
  delete config.license;
  config.licenses = next;
  writeConfig(config);

  const reach = reachFor(next);
  if (verifyLicense(value)) {
    console.log(
      reach.days === null
        ? '✓ 鍵を入れました。全期間を遡れます。'
        : `✓ 鍵を入れました。遡れるのは直近 ${reach.days} 日ぶん（鍵 ${reach.keys} 本）。`,
    );
  } else {
    console.log('保存しました（ただし、いまの版では通りません）。');
  }
  console.log(`  ${CONFIG_FILE}`);
  console.log('  取り込み直す: node scripts/import.mjs --write');
}

function forget() {
  const config = readConfig();
  delete config.license;
  delete config.licenses;
  writeConfig(config);
  console.log(`鍵を外しました（全部）。遡れるのは直近 ${FREE_DAYS} 日ぶんに戻ります。`);
}

function init() {
  if (fs.existsSync(PRIVATE_FILE)) {
    console.error(`× 既にあります: ${PRIVATE_FILE}`);
    console.error('  作り直すと、発行済みの鍵が全部通らなくなります。消すなら手で消してください。');
    process.exit(1);
  }
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' });

  fs.mkdirSync(SIGNING_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(PRIVATE_FILE, privatePem, { mode: 0o600 });
  fs.writeFileSync(PUBLIC_FILE, publicPem);

  console.log(`✓ 秘密鍵: ${PRIVATE_FILE}（**リポジトリに入れない**）`);
  console.log(`✓ 公開鍵: ${PUBLIC_FILE}`);
  console.log('\nsrc/core/license.js の PUBLIC_KEYS に、これを貼る：\n');
  console.log(`export const PUBLIC_KEYS = [\n\`${publicPem.trim()}\`,\n];`);
}

function issue(id) {
  if (!id) {
    console.error('注文番号などを渡してください: node scripts/license.mjs issue order-1234');
    process.exit(1);
  }
  if (!fs.existsSync(PRIVATE_FILE)) {
    console.error(`× 秘密鍵がありません: ${PRIVATE_FILE}`);
    console.error('  先に: node scripts/license.mjs init');
    process.exit(1);
  }
  console.log(signLicense(id, fs.readFileSync(PRIVATE_FILE, 'utf8')));
}

const [what, arg] = process.argv.slice(2);
if (!what || what === 'status') status();
else if (what === 'redeem') redeem(arg);
else if (what === 'forget') forget();
else if (what === 'init') init();
else if (what === 'issue') issue(arg);
else {
  console.error(`知らない指示です: ${what}`);
  console.error('status / redeem <鍵> / forget / init / issue <番号>');
  process.exit(1);
}
