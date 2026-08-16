#!/usr/bin/env node
/**
 * 紹介ページ（site/）に載せる画面写真を撮り直す。
 *
 *   node scripts/shots.mjs
 *
 * **手で撮らない。** 撮ったものを手で貼っていると、画面を直したときに
 * 紹介ページだけ古いままになる ── 実際に「モックがそれっぽいだけで
 * 中身が古い」は、いちばん見抜かれるところ。
 *
 * やっていること：
 *
 *   1. 捏造した作業ログを畳んで、育った個体を 1 匹つくる
 *   2. スマホ用ページの中身を 1 枚の HTML に畳む（読むファイルは全部本物）
 *   3. iPhone と同じ比で、位置をずらして何枚か撮る
 *
 * **本物の画面をそのまま撮る。** 紹介用に作り直した画面は撮らない。
 *
 * 使う Chromium は `AIPET_CHROME` で指す（無ければよくある場所を順に見る）。
 * Playwright も puppeteer も入れない ── この作りの縛りは「依存を増やさない」
 * ほうなので、ここだけのために足さない。
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { emptyState, applyEvents } from '../src/core/growth.js';
import { viewModel } from '../src/core/view.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'site', 'shots');
const DAY = 86400000;

/**
 * 撮る大きさ。**iPhone と同じ比（390:844 ≒ 0.462）**にしてある。
 *
 * 実寸の 390px では撮れない ── headless の `--window-size` は 500px 未満だと
 * そのまま帰ってこない（幅を無視するのではなく、固まる）。同じ比の 500x1080 で
 * 撮って、枠のほうで縮める。スマホ用ページは max-width 520 なので、500 でも
 * 折り返しは実機と同じ。
 */
const WIDTH = 500;
const HEIGHT = 1080;

/**
 * どこを撮るか。**節の名前で指す**（`data-sec`）。
 *
 * 前は px を直打ちしていたが、節が 1 つ増えただけで全部ずれて、写真が
 * 「パネルの途中で切れた画面」になっていた ── 節の頭に揃うようにする。
 */
const SHOTS = [
  { name: 'home', sec: null },
  { name: 'stats', sec: 'hexagon' },
  { name: 'dungeon', sec: 'dungeon' },
  { name: 'away', sec: 'expedition' },
];

function chromePath() {
  if (process.env.AIPET_CHROME) return process.env.AIPET_CHROME;
  const guesses = [
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ];
  for (const guess of guesses) if (fs.existsSync(guess)) return guess;
  console.error('× Chromium が見つかりません。AIPET_CHROME=<実行ファイル> を指定してください。');
  process.exit(1);
}

/**
 * 見せるための個体を 1 匹つくる。
 *
 * **数字は捏造でいい**（紹介ページに他人の作業量を載せる意味は無い）が、
 * **ルールは本物を通す** ── 畳むのは growth.js なので、ここで作った子は
 * 「実際にこう働いたら、こうなる」が成り立っている。
 */
function grown() {
  const now = Date.now();
  const events = [];
  const tools = ['Bash', 'Bash', 'Read', 'Edit', 'Grep', 'WebSearch', 'Task', 'Write', 'Glob'];
  let n = 0;
  for (let d = 34; d >= 0; d -= 1) {
    if (d % 4 === 0) continue; // 休む日。棒が全部同じ高さだと嘘に見える
    const base = now - d * DAY + 9 * 3600000;
    const count = 80 + ((d * 37) % 380);
    for (let i = 0; i < count; i += 1) {
      const t = base + i * 9000;
      if (i % 22 === 0) events.push({ t, e: 'UserPromptSubmit', s: `s${d}-${(i / 70) | 0}` });
      else if (i % 130 === 0) events.push({ t, e: 'PreCompact', s: `s${d}-${(i / 70) | 0}` });
      else {
        const tool = tools[n % tools.length];
        events.push({ t, e: 'PostToolUse', s: `s${d}-${(i / 70) | 0}`, tool, ok: n % 11 !== 0 });
      }
      n += 1;
    }
  }
  events.sort((a, b) => a.t - b.t);
  const state = applyEvents(emptyState(events[0].t), events, { tzOffset: 540 });
  // 6 時間の留守にして、拾い物も出す
  state.lastEventAt = now - 6 * 3600000;
  state.lastEventKind = 'Stop';
  return state;
}

const state = grown();
/*
 * **紹介ページに合わせて英語で撮る。** 日本語で撮って英語のページに貼ると、
 * そこだけ別のアプリに見える（i18n が入っているので、撮り分けは lang 1 つ）。
 */
const view = viewModel(state, Date.now(), { tzOffset: 540, lang: 'en' });
console.log(`  ${view.name} Lv${view.level} · 地下 ${view.dungeon.floor} 階 · 技 ${view.skills.length}`);

fs.mkdirSync(OUT, { recursive: true });
const chrome = chromePath();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aipet-shots-'));

/*
 * **サーバーは立てない。** 一度は手元に立てて撮ったが、ページが一定間隔で
 * `/api/state` を叩き続けるので、headless が「もう描くものは無い」と判断できず
 * 帰ってこない ── かといって時間で切ると、iframe が届く前の真っ黒が撮れる。
 *
 * 代わりに、スマホ用ページの中身をそのまま 1 枚の HTML に畳んで file:// で開く。
 * **読むファイルは全部本物**（src/mobile/*・src/renderer/style.css・src/shared/*）
 * なので、画面を直せばここも直る。
 */
const read = (...parts) => fs.readFileSync(path.join(HERE, '..', ...parts), 'utf8');
const page = read('src', 'mobile', 'index.html')
  .replace('<link rel="stylesheet" href="/pet.css" />', `<style>${read('src', 'renderer', 'style.css')}</style>`)
  .replace('<link rel="stylesheet" href="/mobile.css" />', `<style>${read('src', 'mobile', 'mobile.css')}</style>`)
  .replace('<script src="/pet-svg.js"></script>', `<script>${read('src', 'shared', 'pet-svg.js')}</script>`)
  .replace('<script src="/gestures.js"></script>', `<script>${read('src', 'shared', 'gestures.js')}</script>`)
  .replace(
    '<script src="/mobile.js"></script>',
    /*
     * 差し替えるのは 2 つだけ。**描く中身には触らない。**
     *   fetch     … 手元で畳んだ view をそのまま返す
     *   setTimeout… 1 枚 撮るだけなので、後の周回は止める（止めないと、
     *               しぐさと聞き直しが延々と続いて撮り終わらない）
     */
    `<script>
       window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(${JSON.stringify(view)}) });
       const realTimeout = window.setTimeout;
       window.setInterval = () => 0;
       realTimeout(() => {
         window.setTimeout = () => 0;
         const out = {};
         for (const el of document.querySelectorAll('[data-sec]')) {
           if (el.hidden || !el.offsetHeight) continue;
           /*
            * **上の余白の真ん中で切る。** 節の頭ちょうどで切ると、1 つ上の
            * パネルの最後の 1 行が半分だけ写る（実際に「文章が途中で切れた
            * 写真」になっていた）。上に何か置いてあるなら、その下端と
            * 節の頭の中間に置く ── 隙間の中で切れるので、どちらも欠けない。
            */
           // その節がまとまりの先頭なら、**見出しごと**入れる（見出しを半分に
           // 切った写真になっていた）
           let head = el;
           while (head.previousElementSibling && head.previousElementSibling.classList.contains('group-head')) {
             head = head.previousElementSibling;
           }
           const prev = head.previousElementSibling;
           const above = prev && prev.offsetHeight ? prev.offsetTop + prev.offsetHeight : head.offsetTop;
           out[el.dataset.sec] = { top: el.offsetTop, gap: Math.round((head.offsetTop + above) / 2) };
         }
         // 撮れる高さは --window-size そのままではない（下記）
         out['#vh'] = window.innerHeight;
         document.title = JSON.stringify(out);
       }, 900);
     </script>
     <script>${read('src', 'mobile', 'mobile.js')}</script>`,
  );

const inner = path.join(tmp, 'page.html');
fs.writeFileSync(inner, page);

const shoot = (args) =>
  execFileSync(chrome, ['--headless', '--disable-gpu', '--no-sandbox', ...args], {
    timeout: 90000,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    // 出力は捨てる。Chromium は headless でも警告を延々と吐く
    stdio: ['ignore', 'pipe', 'ignore'],
  });

/*
 * PNG の下を落とす。
 *
 * `--screenshot` が書き出す高さは **窓の高さ**で、中身が描かれるのは
 * **窓から飾りを引いた高さ**まで ── 差のぶんが、下端に背景色の帯として
 * 必ず残る。飾りぶんを足して撮って、ここで落とす。
 *
 * zlib だけで書いてある（この作りの縛りは「依存を増やさない」ほう）。
 */
const CRC = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return (buf) => {
    let c = -1;
    for (let i = 0; i < buf.length; i += 1) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
})();

function chunk(type, body) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'ascii');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(CRC(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, tail]);
}

function cropBottom(file, keep) {
  const png = fs.readFileSync(file);
  let at = 8;
  let head = null;
  const parts = [];
  while (at < png.length) {
    const len = png.readUInt32BE(at);
    const type = png.toString('ascii', at + 4, at + 8);
    const body = png.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') head = Buffer.from(body);
    if (type === 'IDAT') parts.push(body);
    at += 12 + len;
  }
  if (!head) return;
  const width = head.readUInt32BE(0);
  const height = head.readUInt32BE(4);
  const color = head[9];
  if (head[8] !== 8 || head[12] !== 0) return; // 8bit・非インタレースだけ
  if (keep >= height) return;

  const bpp = color === 6 ? 4 : color === 2 ? 3 : 0;
  if (!bpp) return;
  const raw = zlib.inflateSync(Buffer.concat(parts));
  const stride = width * bpp + 1;
  const out = Buffer.alloc(keep * stride);
  let prev = Buffer.alloc(width * bpp);
  for (let y = 0; y < keep; y += 1) {
    const filter = raw[y * stride];
    const line = Buffer.from(raw.subarray(y * stride + 1, (y + 1) * stride));
    for (let i = 0; i < line.length; i += 1) {
      const a = i >= bpp ? line[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      if (filter === 1) line[i] = (line[i] + a) & 0xff;
      else if (filter === 2) line[i] = (line[i] + b) & 0xff;
      else if (filter === 3) line[i] = (line[i] + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        line[i] = (line[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      }
    }
    prev = line;
    out[y * stride] = 0; // 落としたぶんは畳み直すので、素のまま書く
    line.copy(out, y * stride + 1);
  }
  head.writeUInt32BE(keep, 4);
  fs.writeFileSync(
    file,
    Buffer.concat([
      png.subarray(0, 8),
      chunk('IHDR', head),
      chunk('IDAT', zlib.deflateSync(out, { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

/*
 * **節の位置を 1 回だけ測る。** px を直打ちしていた頃は、節が 1 つ増えるたびに
 * 写真が「パネルの途中で切れた画面」になっていた ── 測れば勝手に追いつく。
 *
 * **測るときも `--window-size` を渡す。** 渡さないと既定の 800px 幅で測ることに
 * なり、折り返しが実際の 500px と変わって、位置が全部ずれる。
 */
const dumped = shoot([
  `--window-size=${WIDTH},${HEIGHT}`,
  '--virtual-time-budget=6000',
  '--dump-dom',
  `file://${inner}`,
]);
const found = dumped.match(/<title>([^<]*)<\/title>/);
let offsets = {};
try {
  offsets = JSON.parse(found ? found[1].replace(/&quot;/g, '"') : '{}');
} catch {
  console.error('  （節の位置が読めませんでした。先頭から撮ります）');
}

/**
 * **`--window-size` の高さは、そのまま写る高さにならない。**
 *
 * headless でも窓の飾りぶんが引かれるので、500x1080 を頼むと画は 1080 で出るのに
 * 中身は上から 993px しか描かれず、**下の 87px が背景のまま**になっていた
 * （紹介ページに「下が切れた画面」が 3 枚並んでいた）。引かれる量は Chromium の
 * 版で変わるので、決め打ちにせず **測って足す**。
 */
const inner_h = offsets['#vh'] || HEIGHT;
const CHROME_H = Math.max(0, HEIGHT - inner_h);
if (CHROME_H) console.log(`  （窓の飾り ${CHROME_H}px ぶん、頼む高さを足します）`);

for (const shot of SHOTS) {
  // --screenshot はページの先頭しか撮らないので、「ずらしてから撮る」ではなく
  // 「ずらした状態を作って撮る」しかない（包みのページ越しに撮る）
  const y = shot.sec ? Math.max(0, (offsets[shot.sec] || {}).gap || 0) : 0;
  const wrap = path.join(tmp, `${shot.name}.html`);
  fs.writeFileSync(
    wrap,
    `<!doctype html><meta charset="utf-8">
     <style>html,body{margin:0;overflow:hidden;background:#12141a;width:${WIDTH}px;height:${HEIGHT}px}
     iframe{width:${WIDTH}px;height:7200px;border:0;display:block;margin-top:-${y}px}</style>
     <iframe src="file://${inner}"></iframe>`,
  );

  const file = path.join(OUT, `${shot.name}.png`);
  shoot([
    '--force-device-scale-factor=2',
    `--window-size=${WIDTH},${HEIGHT + CHROME_H}`,
    '--virtual-time-budget=6000',
    `--screenshot=${file}`,
    `file://${wrap}`,
  ]);
  cropBottom(file, HEIGHT * 2); // --force-device-scale-factor=2
  console.log(`  ✓ site/shots/${shot.name}.png`);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log('\n  紹介ページ（site/index.html）はこれを読みます。画面を直したら撮り直すこと。\n');
process.exit(0);
