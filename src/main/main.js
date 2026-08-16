import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { app, BrowserWindow, globalShortcut, screen, ipcMain } from 'electron';
import { ROOT } from '../core/paths.js';
import { ensureRoot, loadState, tick } from '../core/state.js';
import { viewModel } from '../core/view.js';
import { startServer } from './server.js';
import { loadConfig } from '../core/config.js';
import { DEFAULT_SKIN } from '../core/skins.js';
import { skinFor } from '../core/wardrobe.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const SIZE = { width: 200, height: 200 };
/** 名刺の大きさ。SNS のカードがこの比で切られる。 */
const CARD = { width: 1200, height: 630 };
const MARGIN = 24;
/** events.jsonl のポーリング間隔。stat 1 回なので実質ゼロコスト。 */
const TICK_MS = 500;
/** サーバーから合流済みの状態を取りに行く間隔。 */
/*
 * サーバーから合流ぶんを取りに行く間隔。
 *
 * **15 秒にしていて、それで本番を落とした。** 1 回の読みで KV の `list` が
 * 3 回走っていたので、オーバーレイを立ち上げているだけで **1 分あたり 12 回**
 * ── KV の 1 日ぶんの `list` は 1,000 なので、**起動して数分でその日ぶんを
 * 使い切る。** 使い切ると `list` が投げて `/api/state` も `/ingest` も 500 に
 * 落ち、スマホから何も見えなくなる。毎日リセットされても即また死んでいた。
 *
 * ここが見ているのは「別のマシンやクラウドで働いたぶん」で、**分単位でしか
 * 動かない**（自分の手元ぶんは hook から直接入る）。
 *
 * **15 分。** 実測でいちばん働いた日（イベント 5,868 件）を数えると、受信だけで
 * 188 回。5 分だと 288 回で、スマホと足して 956 回 ── 上限 1,000 に対して
 * 余裕が 4% しかない。**他の人の箱でも同じ数字が出る**（枠はアカウントごと）
 * ので、ここは余らせておく側に倒す。
 */
const PULL_MS = 15 * 60 * 1000;

let win = null;
let state = null;
/** 名刺を撮っている最中か。連打で窓が積み上がるのを止める。 */
let cardBusy = false;
let timer = null;
let pullTimer = null;
let server = null;

// Linux の一部環境では透過ウィンドウにこれが要る
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-transparent-visuals');
}

/*
 * 同じペットを見るインスタンスは 1 つだけにする。
 *
 * 起動し直したつもりで前のプロセスが生き残っていると、キャラが 2 匹重なって
 * 出てくる。ロックの範囲は userData のパスで決まるので、AIPET_HOME ごとに
 * 別のパスにしておく ── テスト用と本番を同時に出す使い方は残したい。
 */
const lockScope = crypto.createHash('sha1').update(ROOT).digest('hex').slice(0, 8);
app.setPath('userData', path.join(app.getPath('appData'), `aipet-${lockScope}`));
/*
 * 1 匹しか立てない。**2 つ動くと state.json を取り合う** ── Windows では
 * それだけで rename が EPERM で弾かれる（state.js の注記）。
 *
 * **黙って終わらない。** 前は `app.quit()` するだけで、ターミナルから
 * `npm start` を叩くと**何も出ずにプロンプトが戻ってきた** ── 起動に失敗した
 * のか、既に動いているのかが区別できない。実際それで「起動しない」と読んだ。
 */
const isPrimary = app.requestSingleInstanceLock();
if (!isPrimary) {
  console.error('[aipet] もう 1 匹が動いているので こちらは終わります（画面のほうを出しました）');
  console.error('        入れ替えるなら 先に動いているほうを終わらせてから起動してください');
  app.quit();
}

// 2 つ目を起動しようとしたときは、既にいる子を出してやる
app.on('second-instance', () => {
  if (win && !win.isDestroyed()) win.showInactive();
});

function createWindow() {
  const area = screen.getPrimaryDisplay().workArea;

  win = new BrowserWindow({
    ...SIZE,
    x: area.x + area.width - SIZE.width - MARGIN,
    y: area.y + area.height - SIZE.height - MARGIN,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    hasShadow: false,
    skipTaskbar: true,
    // フォーカスを絶対に奪わない。奪った瞬間に「邪魔なアプリ」になる。
    focusable: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(HERE, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 'screen-saver' レベルにするとフルスクリーンのアプリの上にも出る
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // クリックは全部下のウィンドウに素通しする（forward: true で hover だけ受け取る）
  win.setIgnoreMouseEvents(true, { forward: true });

  win.loadFile(path.join(HERE, '..', 'renderer', 'index.html'));
}

/** サーバー側の合流済みの表示データ。同期が有効なときだけ入る。 */
let remote = null;

/**
 * 付け替えた名前は手元の設定にある。毎周期ファイルを読みに行くのは無駄なので
 * 30 秒だけ覚える ── 名前を変えたら次の 30 秒以内に画面へ出る。
 */
let namedAt = 0;
let named = null;
let speaks = 'ja';
// 着ているスキンも、名前と同じ間隔で読み直す。**ここで鍵を確かめて、
// 決まった id だけを view に渡す**（Worker に crypto を持ち込まないため）
let wearing = DEFAULT_SKIN;
function currentName() {
  const now = Date.now();
  if (now - namedAt > 30_000) {
    const config = loadConfig();
    named = config.name;
    speaks = config.lang;
    wearing = skinFor(config).id;
    namedAt = now;
  }
  return named;
}

/**
 * 画面に出すものを決める。
 *
 * 数字はサーバー優先 ── クラウドのセッションぶんが入っているので向こうが正しい。
 * ただしまだ送れていないローカルのぶんは向こうに無いので、EXP が多いほうを採る
 * （送信待ちのあいだにペットが逆戻りして見えるのを防ぐ）。
 *
 * 気分だけは常にローカル。サーバー越しだと最大で同期の間隔ぶん遅れるので、
 * 手元で動いているのに寝たままになってしまう。
 */
function currentView() {
  // サーバー側の表示に差し替わるときも、名前だけは手元のものを被せる。
  const name = currentName();
  const local = viewModel(state, Date.now(), { name, lang: speaks, skin: wearing });
  if (remote && remote.exp > local.exp) {
    // 見た目は手元のもの。**スキンは設定なので、サーバーは知らない**
    return { ...remote, mood: local.mood, name: name || remote.name, skin: local.skin };
  }
  return local;
}

/**
 * 1 周ぶん。**ここで投げない。**
 *
 * これは 500ms ごとに回り続けるタイマーなので、例外がそのまま出ると
 * Electron の main プロセスが落ちて、画面いっぱいのエラーダイアログになる
 * ── 実際、Windows で `state.json` の rename が EPERM で弾かれただけで
 * アプリが死んだ。**相棒のために本体を止めない**（hook の掟と同じ話）。
 *
 * 黙って捨てはしない。同じ理由で毎周回吐き続けても読めないので、
 * 種類が変わったときだけ 1 行出す。
 */
let lastTrouble = null;

function pump() {
  try {
    const result = tick(state);
    state = result.state;
    if (win && !win.isDestroyed()) {
      win.webContents.send('aipet:state', currentView());
    }
    lastTrouble = null;
  } catch (error) {
    const kind = error && (error.code || error.message);
    if (kind !== lastTrouble) {
      lastTrouble = kind;
      console.error(`[aipet] 1 周ぶんを飛ばしました（次の周回で掛け直します）: ${kind}`);
    }
  }
}

/** サーバーから合流済みの状態を取りに行く。落ちていてもローカルで動き続ける。 */
async function pullRemote(config) {
  try {
    const res = await fetch(`${config.endpoint}/api/state`, {
      headers: { authorization: `Bearer ${config.token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return;
    // /api/state は表示用に落とした形で返ってくるので、そのまま使える
    remote = await res.json();
  } catch {
    // 圏外・サーバー停止。次の周期で取り直す。
  }
}

/** AIPET_SERVE=1 なら既定ポート、数字ならそのポート。未指定なら立てない。 */
function servePort() {
  const raw = process.env.AIPET_SERVE;
  if (!raw) return null;
  if (raw === '1' || raw === 'true') return 7777;
  const port = Number(raw);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
}

/*
 * **落ちない。** 常駐のおまけが、本体（＝ユーザーの作業）を止めてはいけない
 * ── Electron は main プロセスの例外を拾わないと、画面いっぱいのダイアログを
 * 出してアプリごと終わる。ここまで来た例外は既にどこかの try を抜けてきたもの
 * なので、記録だけして生き続ける。
 */
process.on('uncaughtException', (error) => {
  console.error('[aipet] 例外を拾いました（そのまま動き続けます）:', error);
});
process.on('unhandledRejection', (error) => {
  console.error('[aipet] 拾われなかった約束（そのまま動き続けます）:', error);
});

app.whenReady().then(() => {
  if (!isPrimary) return;
  ensureRoot();
  state = loadState();
  createWindow();

  // 起動直後は溜まっている分を一気に取り込む
  pump();
  timer = setInterval(pump, TICK_MS);

  const port = servePort();
  // LAN 配信もサーバーと同じものを見せる（同期していればクラウドぶんも入る）
  if (port) server = startServer({ port, getView: currentView });

  const config = loadConfig();
  if (config.enabled) {
    console.log(`▶ ${config.endpoint} と同期します（クラウドのセッションぶんも合流）`);
    pullRemote(config);
    pullTimer = setInterval(() => pullRemote(config), PULL_MS);
  }

  /*
   * 名刺を 1 枚書き出す。**宣伝したいのに、見せる手段がスクショしか無かった。**
   *
   * 順位表にはならない ── 他人と比べる軸が 1 つも無い自画像で、出るのは
   * その子の名前・位・肩書きと、いま持っているものだけ（DESIGN.md §5b）。
   */
  globalShortcut.register('CommandOrControl+Shift+S', () => {
    saveCard();
  });

  globalShortcut.register('CommandOrControl+Shift+P', () => {
    if (!win || win.isDestroyed()) return;
    if (win.isVisible()) win.hide();
    else win.showInactive();
  });
});

/**
 * 名刺を PNG で書き出す。
 *
 * **見えない窓に card.html を開いて、そのまま撮る。** canvas に描き直す道も
 * あったが、それだと相棒の絵を 2 通り持つことになる ── 装備・小物・使い込み・
 * 型の顔つきの出し分けは style.css にしかないので、同じ CSS を読ませて
 * 撮るほうが、本人とズレようがない。
 *
 * **失敗しても本体は止めない**（常駐のおまけが作業を止めない。CLAUDE.md）。
 */
async function saveCard() {
  if (cardBusy) return;
  cardBusy = true;
  let shot = null;
  try {
    shot = new BrowserWindow({
      width: CARD.width,
      height: CARD.height,
      show: false,
      webPreferences: {
        preload: path.join(HERE, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    await shot.loadFile(path.join(HERE, '..', 'renderer', 'card.html'));

    const ready = new Promise((resolve) => {
      ipcMain.once('aipet:card-ready', resolve);
      // 返事が来なくても、いつかは撮る（描けていない絵を出すより、待って諦める）
      setTimeout(resolve, 4000);
    });
    shot.webContents.send('aipet:card', currentView());
    await ready;

    const image = await shot.webContents.capturePage();
    const file = path.join(cardDir(), `maite-${stampFor(Date.now())}.png`);
    fs.writeFileSync(file, image.toPNG());
    if (win && !win.isDestroyed()) win.webContents.send('aipet:saved', file);
    console.log(`[aipet] card saved: ${file}`);
  } catch (error) {
    console.error(`[aipet] card failed: ${error.message}`);
  } finally {
    if (shot && !shot.isDestroyed()) shot.destroy();
    cardBusy = false;
  }
}

/** 置き場はデスクトップ。無ければホーム ── 探させない。 */
function cardDir() {
  try {
    const desktop = app.getPath('desktop');
    if (fs.existsSync(desktop)) return desktop;
  } catch {
    // desktop が無い環境（サーバー等）ではホームに落とす
  }
  return app.getPath('home');
}

/** 20260815-1432。同じ日に何枚撮っても上書きしない。 */
function stampFor(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

app.on('will-quit', () => {
  if (timer) clearInterval(timer);
  if (pullTimer) clearInterval(pullTimer);
  if (server) server.close();
  globalShortcut.unregisterAll();
});

// オーバーレイなので、ウィンドウが閉じたらアプリごと終わる（macOS も含む）
app.on('window-all-closed', () => app.quit());

// Dock に出さない（macOS）
app.dock?.hide();
