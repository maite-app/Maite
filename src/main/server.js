import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ROOT, SERVE_FILE } from '../core/paths.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '..');

/**
 * スマホから見るためのローカル HTTP サーバー。
 *
 * 既定では起動しない。LAN に口を開けるのは「機械の外に出る」ことなので、
 * AIPET_SERVE を明示的に指定したときだけ立てる。
 *
 * 出すのは読み取り専用のダッシュボードだけで、書き込む口は持たない。
 * 中身はレベル・系統・カウンタの数値のみ（プロンプトもパスも元から保存していない）。
 * 同じ Wi-Fi にいる人には見えるので、公共の回線では立てないこと。
 */

/** 配信してよいファイルの許可リスト。これ以外は 404（パス組み立てを一切しない）。 */
const ROUTES = {
  '/': ['mobile/index.html', 'text/html; charset=utf-8'],
  '/mobile.css': ['mobile/mobile.css', 'text/css; charset=utf-8'],
  '/mobile.js': ['mobile/mobile.js', 'text/javascript; charset=utf-8'],
  '/pet.css': ['renderer/style.css', 'text/css; charset=utf-8'],
  '/pet-svg.js': ['shared/pet-svg.js', 'text/javascript; charset=utf-8'],
  // しぐさはオーバーレイとスマホで同じものを使う（二重定義にしない）
  '/gestures.js': ['shared/gestures.js', 'text/javascript; charset=utf-8'],
};

/** LAN 内から届く自分のアドレス。スマホで打つ URL を案内するために使う。 */
export function lanAddresses() {
  const out = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal) out.push(entry.address);
    }
  }
  return out;
}

export function startServer({ port, getView }) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');

    if (url.pathname === '/api/state') {
      const body = JSON.stringify(getView());
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end(body);
      return;
    }

    const route = ROUTES[url.pathname];
    if (!route) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }

    const [file, type] = route;
    fs.readFile(path.join(SRC, file), (err, data) => {
      if (err) {
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('read error');
        return;
      }
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(data);
    });
  });

  server.on('error', (err) => {
    // ポートが埋まっていてもオーバーレイ本体は動かす。おまけで本体を止めない。
    console.error(`× スマホ用サーバーを開けませんでした (port ${port}): ${err.message}`);
  });

  server.listen(port, '0.0.0.0', () => {
    /*
     * **この PC で見る口を必ず出す。** LAN のアドレスしか案内していなかったので、
     * 「パソコンで見る方法はないのか」で詰まった ── オーバーレイは 200x200 の
     * 小窓で、節が並ぶ画面（スマホ用）はブラウザでしか出ない。
     *
     * localhost はファイアウォールにも Wi-Fi にも左右されないので、
     * **いちばん確実に開く口**でもある。
     */
    const local = `http://localhost:${port}`;
    const urls = lanAddresses().map((ip) => `http://${ip}:${port}`);

    /*
     * **アドレスをファイルにも置く。** Windows の Electron はコンソールに
     * UTF-8 のまま吐くので、日本語環境（CP932）だと案内ごと化けて URL が
     * 読めない ── `node scripts/status.mjs` は化けないので、そちらから出せる
     * ようにしておく（書けなくても配信は配信。ここで止めない）。
     */
    try {
      fs.mkdirSync(ROOT, { recursive: true });
      fs.writeFileSync(SERVE_FILE, JSON.stringify({ at: Date.now(), port, local, urls }));
    } catch {
      // 控えが置けなくても、下の行には出ている
    }

    // **案内の行と URL の行を分ける。** 化けても URL の行だけは ASCII で残る
    console.log('[aipet] open on this PC:');
    console.log(`    ${local}`);
    if (urls.length) {
      console.log('[aipet] or from your phone (same Wi-Fi):');
      for (const u of urls) console.log(`    ${u}`);
    }
  });

  return server;
}
