import { emptyState, applyEvents, STATE_VERSION } from '../../src/core/growth.js';
import { viewModel } from '../../src/core/view.js';
import { sanitizeName } from '../../src/core/naming.js';
import { normalizeLang } from '../../src/core/i18n.js';
import { ASSETS, ASSET_STAMP } from './assets.js';
import { offsetFrom } from '../../src/core/clock.js';

/**
 * aipet の合流点。
 *
 * PC の hook と、クラウドの Claude Code セッションの hook が、どちらもここに
 * 数値を投げる。どこで作業しても 1 匹が育つのはこのためだけの仕組み。
 *
 * 保持するのは 2 つ。
 *   log:<key>:…   受け取った生イベント（JSONL）。何枚かに分かれる
 *   state:<key>   畳んだ後の状態。読むときはこれだけ見る
 *   name:<key>    付け替えた名前。ログから導けないので、畳み直しでも消えないよう別置き
 *   lang:<key>    画面のことば。同じ理由で別置き
 *   skin:<key>    見た目。**数字には一切効かない**（src/core/skins.js）
 *
 * 畳むのは受信時。読み取り時に毎回全部畳むと、イベントが増えたときに
 * Worker の CPU 時間に収まらなくなる。ただし**生ログのほうが真実**で、
 * state はいつでも捨てて作り直せる（版を上げたとき、順番が乱れて届いたとき）。
 */

/**
 * 「その人にとっての 1 日」をどこで切るか（分）。
 *
 * **Worker のローカル時刻は UTC。** 指定しないと、日本時間の 9〜14 時が
 * 0〜5 時と見なされて「夜更かし」に数えられ、日次 EXP 上限の区切りも
 * PC と食い違う。wrangler.toml の [vars] に AIPET_TZ_OFFSET = "540" のように
 * 入れる（日本なら 540）。
 */
function tzOf(env) {
  return offsetFrom(env.AIPET_TZ_OFFSET);
}

/** 二重に届いたイベントを弾くために覚えておく ID の数。 */
const SEEN_LIMIT = 5000;

/** 1 リクエストで受け取るイベントの上限。 */
const MAX_BATCH = 1000;

/**
 * 生ログ 1 枚あたりの上限。
 *
 * **1 枚に全部入れていたのが間違いだった。** KV の値の上限は 25MB で、
 * 1 日 600 イベント（1 件 107 バイト）だと 1 年で 22MB、2 年で溢れる。
 * それ以前に、**受信のたびに全体を読んで足して全体を書いていた** ── 10MB まで
 * 育つと hook が 1 回動くたびに 10MB の読み書きが走る。
 */
const SHARD_MAX = 800 * 1024;

/**
 * 追記は**既にあるキーに触らない**。新しいキーを 1 枚起こして書くだけ。
 *
 * 末尾の 1 枚を読んで足して書き戻していた頃、PC とクラウドから同時に届くと
 * **後から書いたほうが前のぶんを丸ごと消していた**（KV に読んで書くまでの
 * 排他が無い）。生ログは畳み直しの元なので、ここで消えると取り返しがつかない。
 *
 * 代わりに枚数が増えるので、溜まったら 1 枚にまとめる（compactLog）。
 * まとめる処理が同時に走っても、書いてから消す順を守る限り**増えるだけで減らない**
 * ── 重複は畳むときに ID で落ちる。
 */
const COMPACT_AT = 16;

function isLegacyShard(name, key) {
  return name === `log:${key}` || new RegExp(`^log:${key}:\\d+$`).test(name);
}

/** 生ログのキーを全部集める。旧形式の 0..n 枚目 → まとめ済み → 追記ぶんの順。 */
async function logKeys(env, key) {
  const legacy = [];
  const sealed = [];
  const chunks = [];
  let cursor;
  do {
    const page = await env.AIPET.list({ prefix: `log:${key}`, cursor });
    for (const entry of page.keys) {
      const name = entry.name;
      if (isLegacyShard(name, key)) legacy.push(name);
      else if (name.startsWith(`log:${key}:s:`)) sealed.push(name);
      else if (name.startsWith(`log:${key}:c:`)) chunks.push(name);
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);

  const index = (name) => {
    const tail = name.slice(`log:${key}`.length);
    return tail === '' ? 0 : Number(tail.slice(1));
  };
  legacy.sort((a, b) => index(a) - index(b));
  sealed.sort();
  chunks.sort();
  return { legacy, sealed, chunks };
}

/**
 * いまの生ログが「どういう構成か」を安く表す印。
 *
 * **畳んだ結果は、それを作った元のログとセットでしか正しくない。**
 * KV は書いた直後に読める保証が無い（結果整合）ので、追記した直後の
 * 畳み直しは**まだ届いていない枚を見落とす**ことがある ── 実際、2,996 件を
 * 6 回に分けて送ったら、途中の畳み直しが 1 バッチぶんしか見ておらず、
 * その state がそのまま居座って **ツール 1,400 回が 323 回**になっていた。
 *
 * 枚の名前は追記のたびに増える（`c:<uuid>`）ので、**名前の一覧が変われば
 * ログも変わった**と分かる。値は読まないので `list` だけで済む。
 */
function signatureOf({ legacy, sealed, chunks }) {
  const names = [...legacy, ...sealed, ...chunks].sort().join('|');
  // FNV-1a。ぶつかっても「余分に畳み直す」だけなので、暗号強度は要らない
  let h = 0x811c9dc5;
  for (let i = 0; i < names.length; i += 1) {
    h ^= names.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${legacy.length + sealed.length + chunks.length}:${h.toString(16)}`;
}

async function logSignature(env, key) {
  return signatureOf(await logKeys(env, key));
}

async function readLog(env, key, shape) {
  const { legacy, sealed, chunks } = shape || (await logKeys(env, key));
  let text = '';
  for (const name of [...legacy, ...sealed, ...chunks]) text += (await env.AIPET.get(name)) || '';
  return text;
}

/** 書いた枚の名前を返す。**次の list を省くため**（下の signatureWith）。 */
async function appendLog(env, key, chunk) {
  const name = `log:${key}:c:${crypto.randomUUID()}`;
  await env.AIPET.put(name, chunk);
  return name;
}

/**
 * 「いま書いた枚も入れた構成」の印。**もう一度 list を引かない。**
 *
 * 前は append した直後に list し直して印を作っていたが、KV は書いた直後に
 * 読める保証が無いので**自分が書いた枚を見落とすことがある** ── その印を
 * 刻むと、読み手が list したときに合わなくなって毎回畳み直しになる。
 * 書いた名前は手元にあるので、足すほうが正確で、しかも list を 1 回減らせる。
 */
function signatureWith(shape, name) {
  return signatureOf({ ...shape, chunks: [...shape.chunks, name] });
}

/**
 * 追記ぶんが増えてきたら 1 枚にまとめる。**書いてから消す。**
 *
 * まとめ先が SHARD_MAX を超えたら `s:`（もう混ぜない枚）にして置いておく。
 * 旧形式の枚には触らない ── 触ると上書きの取り合いが復活する。
 */
async function compactLog(env, key, shape) {
  const { chunks } = shape || (await logKeys(env, key));
  if (chunks.length < COMPACT_AT) return false;

  let merged = '';
  const taken = [];
  for (const name of chunks) {
    const part = await env.AIPET.get(name);
    if (part === null) continue;
    merged += part;
    taken.push(name);
  }
  if (!taken.length) return false;

  const target = merged.length >= SHARD_MAX ? `log:${key}:s:${crypto.randomUUID()}` : `log:${key}:c:${crypto.randomUUID()}`;
  await env.AIPET.put(target, merged);
  for (const name of taken) await env.AIPET.delete(name);
  // 走ったことを返す。**走った後は構成が変わっている**ので、印は引き直す
  return true;
}

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });
}

/**
 * トークンは URL にもヘッダにも出るので、そのまま KV のキーにはしない。
 * 万一 KV の中身が見えても、トークン自体は復元できないようにする。
 */
async function keyFor(token) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

function bearer(request) {
  const header = request.headers.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

/**
 * 中身から ID を作る。hook が付けた i が無いイベント（過去ログの取り込みぶん）に
 * 与える。**同じイベントなら必ず同じ ID** になるので、同じものが二度届いても
 * 畳むときに落ちる ── 取り込みのあと全部送り直しても二重に数えない。
 */
function derivedId(event) {
  const canonical = `${event.t}|${event.e}|${event.s || ''}|${event.p || ''}|${event.tool || ''}|${event.ok ?? ''}`;
  // FNV-1a。衝突しても「同じ 1 件を落とす」だけなので、暗号強度は要らない。
  let h = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i += 1) {
    h ^= canonical.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `d${h.toString(16).padStart(8, '0')}${canonical.length.toString(36)}`;
}

/** 受け取ってよい形だけに削ぎ落とす。知らないキーは持ち込ませない。 */
function sanitize(event) {
  if (!event || typeof event !== 'object') return null;
  if (typeof event.e !== 'string' || event.e.length > 40) return null;
  const t = Number(event.t);
  if (!Number.isFinite(t) || t <= 0) return null;

  const out = { t, e: event.e };
  if (typeof event.i === 'string' && event.i.length <= 32) out.i = event.i;
  if (typeof event.s === 'string' && event.s.length <= 32) out.s = event.s;
  if (typeof event.p === 'string' && event.p.length <= 32) out.p = event.p;
  if (typeof event.tool === 'string' && event.tool.length <= 80) out.tool = event.tool;
  if (typeof event.ok === 'boolean') out.ok = event.ok;
  if (typeof event.size === 'string' && event.size.length <= 2) out.size = event.size;
  if (!out.i) out.i = derivedId(out);
  return out;
}

/**
 * 畳んだ結果を読む。**版と、元にしたログの構成の両方が合っていなければ捨てる。**
 *
 * 版だけを見ていた頃、結果整合で取りこぼした state がそのまま居座り続けた
 * （上の signatureOf の注記）。構成が変わっていれば畳み直すほうへ倒す
 * ── 余分に畳み直すのは遅いだけだが、足りない state を出すのは嘘になる。
 */
async function readStored(env, key, shape) {
  const raw = await env.AIPET.get(`state:${key}`, 'json');
  if (!raw || raw.stateVersion !== STATE_VERSION) return null;
  /*
   * 印が無いものも捨てる。**印が無いのは、この直しより前に焼かれたもの
   * ＝まさに壊れている可能性があるほう。** 最初「無ければ通す」にしていて、
   * 直しをデプロイしても数字が 323 のまま動かなかった ── 直したい相手を、
   * 後方互換のつもりで素通りさせていた。
   *
   * 版を上げた直後と同じで、通るのは 1 回だけ（次からは印が付いている）。
   */
  if (raw.logSig !== (shape ? signatureOf(shape) : await logSignature(env, key))) return null;
  return raw;
}

/**
 * 生ログから畳み直す。初回と、STATE_VERSION を上げた後に通る道。
 *
 * **読むときにも通す。** 受信時にしか畳み直していなかったせいで、版を上げた
 * 直後にページを開くと Lv1 が出ていた ── 生ログは無事なのに、次に hook が
 * 何か送ってくるまで「消えた」ように見える。いちばんやってはいけない見え方。
 */
async function foldFromLog(env, key, listed) {
  const tzOffset = tzOf(env);
  const shape = listed || (await logKeys(env, key));
  const log = await readLog(env, key, shape);
  const seenIds = new Set();
  const past = log
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    // 同じ ID は 1 件だけ。まとめ直しが二重に走ったときと、取り込みのあとの
    // 送り直しで同じものが混ざる ── どちらもここで落とす。
    .filter((e) => {
      const id = e.i || derivedId(e);
      if (seenIds.has(id)) return false;
      seenIds.add(id);
      return true;
    })
    // 枚の並びは書いた順とは限らないので、畳む前に時刻で並べ直す。
    // 日次 EXP 上限が日付をまたいで効くために必要（同時刻は ID で決める）。
    .sort((a, b) => a.t - b.t || String(a.i || '').localeCompare(String(b.i || '')));

  return {
    stateVersion: STATE_VERSION,
    // **どの構成のログから作ったか**を一緒に持つ。合わなくなったら作り直す
    logSig: signatureOf(shape),
    state: applyEvents(emptyState(past[0]?.t || Date.now()), past, { tzOffset }),
    seen: past.map((e) => e.i).filter(Boolean).slice(-SEEN_LIMIT),
  };
}

async function ingest(request, env) {
  const token = bearer(request);
  if (!token || token.length < 16) return json({ error: 'unauthorized' }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad json' }, 400);
  }
  if (!Array.isArray(body?.events)) return json({ error: 'events required' }, 400);
  if (body.events.length > MAX_BATCH) return json({ error: 'batch too large' }, 413);

  const key = await keyFor(token);

  // 付け替えた名前。**state とは別に置く。**
  // state は生ログから畳み直せるものなので、ログに無い値を混ぜると
  // 版を上げて畳み直すたびに消える（名前は本人が決めたもので、ログには無い）。
  const name = sanitizeName(body.name);
  if (name && name !== (await env.AIPET.get(`name:${key}`))) {
    await env.AIPET.put(`name:${key}`, name);
  }

  // 画面のことば。名前と同じ理由で state ではなく別キーに置く
  /*
   * 見た目。**数字には一切効かない**ので、生ログとは別扱いで上書きしていい
   * （名前や言語と同じ）。
   *
   * **鍵はここに置かない。** 着られるかどうかを決めるのは PC（wardrobe.js）で、
   * ここに届くのは決まった id だけ ── サーバーで確かめようとすると Worker に
   * `node:crypto` が要り、そこで本番が落ちる。書けるのはトークンを持っている
   * 本人だけなので、境界はそちら側にある。
   */
  if (typeof body.skin === 'string') {
    await env.AIPET.put(`skin:${key}`, body.skin.slice(0, 32));
  }

  if (typeof body.lang === 'string') {
    const lang = normalizeLang(body.lang);
    if (lang !== (await env.AIPET.get(`lang:${key}`))) await env.AIPET.put(`lang:${key}`, lang);
  }

  // **一覧は 1 回だけ引く。** list は 1 日ぶんの数がいちばん少ない操作なので、
  // 同じ request の中で 3 回引いていたのを 1 回にまとめる（下の注記）。
  const shape = await logKeys(env, key);
  let stored = await readStored(env, key, shape);

  // 初回、またはルールが変わった後。生ログが残っていれば畳み直す。
  if (!stored) stored = await foldFromLog(env, key, shape);

  const seen = new Set(stored.seen || []);
  const fresh = [];
  for (const raw of body.events) {
    const event = sanitize(raw);
    if (!event) continue;
    if (event.i && seen.has(event.i)) continue; // 再送。二重に数えない
    if (event.i) seen.add(event.i);
    fresh.push(event);
  }

  let refolded = false;
  if (fresh.length) {
    // 別の場所から遅れて届いたぶんが混ざるので、時刻順に畳む。
    // 日次 EXP 上限が日付をまたいで正しく効くために必要。
    fresh.sort((a, b) => a.t - b.t);

    // **生ログが先。** 畳んだ結果は生ログからいつでも作り直せるが、逆はできない。
    const written = await appendLog(env, key, fresh.map((e) => JSON.stringify(e)).join('\n') + '\n');
    const compacted = await compactLog(env, key, shape);

    // 既に畳んだところより古いものが届いた（過去ログの取り込み、別マシンの遅れ）。
    // 足し算では正しくならないので、畳んだ結果を捨てて次の読み取りで作り直す。
    if (fresh[0].t < (stored.state.lastEventAt || 0)) {
      await env.AIPET.delete(`state:${key}`);
      refolded = true;
    } else {
      const nextState = applyEvents(stored.state, fresh, { tzOffset: tzOf(env) });
      const nextSeen = [...seen].slice(-SEEN_LIMIT);
      await env.AIPET.put(
        `state:${key}`,
        JSON.stringify({
          stateVersion: STATE_VERSION,
          /*
           * **いま見えている構成 + いま書いた枚**を刻む。次に読むとき合わなければ畳み直す。
           *
           * ただし**まとめ（compactLog）が走ったときだけは引き直す** ── まとめると
           * 枚が消えて 1 枚に置き換わるので、手元の形はもう現物と違う。走るのは
           * 16 枚に 1 回だけなので、list は増えない。
           */
          logSig: compacted ? await logSignature(env, key) : signatureWith(shape, written),
          state: nextState,
          seen: nextSeen,
        }),
      );
    }
  }

  return json({
    ok: true,
    accepted: fresh.length,
    skipped: body.events.length - fresh.length,
    refold: refolded,
  });
}

/*
 * **控えを isolate に持たせるのはやめた。**
 *
 * 「同じ個体への読みが立て続けに来たら 10 秒だけ使い回す」を一度書いたが、
 * それは**生ログが増えても、しばらく古い数字を出す**ということ ── 前に
 * 「畳んだ結果が居座って、ツール 1,400 回が 323 回のまま動かない」を
 * やっているので（signatureOf の注記）、その性質をわざわざ作り直さない。
 * テストもそこを縛っている。
 *
 * 減らすほうは、**1 request で `list` を 1 回に減らす**（前は 3 回）のと、
 * **ページが叩く回数そのものを減らす**（mobile.js）でやる。
 */
async function readState(env, token) {
  if (!token || token.length < 16) return null;
  const key = await keyFor(token);

  /*
   * **一覧は 1 回だけ。** 引いた結果を下まで持ち回す（前は 3 回引いていた）。
   *
   * ここが投げたら**畳んだ結果をそのまま出す。** KV の 1 日ぶんの `list` を
   * 使い切ると `list()` は例外を投げる ── そのまま外に出していたので、
   * **スマホもオーバーレイも「何も見えない」に落ちていた。** 少し古い数字が
   * 出るのと、何も出ないのとでは、悪さの桁が違う（畳んだ結果は KV に残って
   * いるので、出すものはある）。
   */
  let shape;
  try {
    shape = await logKeys(env, key);
  } catch (error) {
    const last = await env.AIPET.get(`state:${key}`, 'json');
    if (last && last.stateVersion === STATE_VERSION) return last.state;
    throw error;
  }

  const stored = await readStored(env, key, shape);
  if (stored) return stored.state;

  // 版が古い（or まだ畳んでいない）。ここで畳み直して、次からは読むだけで済むよう
  // 書き戻す。畳み直しは版を上げた直後の 1 回だけなので、書き込みは増えない。
  const folded = await foldFromLog(env, key, shape);

  // **生ログが 1 行も無いなら、そんな個体はいない。** 当てずっぽうのトークンにも
  // Lv1 の個体を作って書き戻していたので、URL を叩くだけで KV が増やせた。
  if (!folded.state.lastEventAt) return null;

  await env.AIPET.put(`state:${key}`, JSON.stringify(folded));
  return folded.state;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/ingest') {
      if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
      return ingest(request, env);
    }

    if (url.pathname === '/api/state') {
      // ページからは URL の token、PC からは Authorization ヘッダで来る
      const token = url.searchParams.get('token') || bearer(request);
      const state = await readState(env, token);
      if (!state) return json({ error: 'unauthorized' }, 401);
      const key = await keyFor(token);
      const name = await env.AIPET.get(`name:${key}`);
      // ことばの決め方は「URL の ?lang= → 送られてきた設定 → ブラウザ → 日本語」
      const lang = normalizeLang(
        url.searchParams.get('lang') ||
          (await env.AIPET.get(`lang:${key}`)) ||
          (request.headers.get('accept-language') || '').split(',')[0],
      );
      // 見た目は PC が決めた id をそのまま絵に落とすだけ（鍵は見ない）
      const skin = await env.AIPET.get(`skin:${key}`);
      return json(viewModel(state, Date.now(), { tzOffset: tzOf(env), name, lang, skin }));
    }

    if (url.pathname.startsWith('/assets/')) {
      const asset = ASSETS[url.pathname.slice('/assets/'.length)];
      if (!asset) return new Response('not found', { status: 404 });
      /*
       * **印つきの URL は、いくら抱えていてもいい。** 中身が変われば URL も
       * 変わるので、古いものに当たりようがない。印の無い URL（昔のページを
       * 開いたまま）は毎回聞き直させる ── 抱え込まれると直しが届かない。
       */
      const stamped = url.searchParams.get('v') === ASSET_STAMP;
      return new Response(asset.body, {
        headers: {
          'content-type': asset.type,
          'cache-control': stamped ? 'public, max-age=31536000, immutable' : 'no-cache',
        },
      });
    }

    // 推測不能な URL がそのまま鍵。ログインもアカウントも作らない。
    if (url.pathname.startsWith('/p/')) {
      const token = url.pathname.slice(3);
      if (token.length < 16) return new Response('not found', { status: 404 });
      return new Response(PAGE.replace('__TOKEN__', JSON.stringify(token)), {
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
      });
    }

    return new Response('not found', { status: 404 });
  },
};

/**
 * スマホ用ページ。src/mobile/ と同じ見た目のものを 1 ファイルに畳んである。
 * ここだけ HTML を持たせているのは、Worker に静的配信を足さずに済ませるため。
 */
const PAGE = `<!doctype html>
<html lang="ja"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#12141a">
<title>見習い</title>
<script>window.AIPET_TOKEN = __TOKEN__;</script>
<link rel="stylesheet" href="/assets/pet.css?v=${ASSET_STAMP}">
<link rel="stylesheet" href="/assets/mobile.css?v=${ASSET_STAMP}">
</head><body>
<button id="menu-open" class="menu-button" aria-label="目次" aria-expanded="false"><span></span><span></span><span></span></button>
<div id="scrim" class="scrim" hidden></div>
<nav id="drawer" class="drawer" aria-hidden="true"><p class="drawer-head"><b id="drawer-name">Maite</b><em id="drawer-level"></em></p><ul id="drawer-list"></ul></nav>
<main>
  <div id="stage" class="mood-idle"><div id="pet-mount"></div></div>
  <h1 id="title">Lv1</h1>
  <p id="subtitle">見習い</p>
  <div class="meter">
    <div class="meter-bar"><i id="meter-fill"></i></div>
    <div class="meter-labels"><span id="meter-into">0</span><span id="meter-next"></span></div>
  </div>
  <p class="group-head" data-t="group.now">いま</p>
  <section class="panel" data-sec="today" data-group="now"><h2><span data-t="panel.today">今日</span></h2><div class="rows">
    <div class="row"><span data-t="row.dailyExp">今日の経験値</span><b id="daily-exp">0</b></div>
    <div class="row"><span data-t="row.mood">ようす</span><b id="mood">─</b></div>
  </div></section>
  <section class="panel" data-sec="trail" data-group="now"><h2><span data-t="panel.trail">この 2 週間</span> <span id="trail-total"></span></h2>
    <div class="trail" id="trail"></div>
    <p class="trail-note" id="trail-note"></p>
  </section>
  <p class="group-head" data-t="group.self">この子のこと</p>
  <section class="panel" data-sec="name" data-group="self"><h2><span data-t="panel.name">この名の由来</span> <span id="persona-code"></span></h2>
    <p id="persona-name" class="persona-name">見極め中</p>
    <p id="persona-blurb" class="trail-note"></p>
    <div class="axes" id="persona-axes"></div>
    <p id="persona-note" class="battle-note"></p>
  </section>
  <section class="panel" data-sec="style" data-group="self"><h2><span data-t="panel.style">流儀</span></h2>
    <div class="bars" id="bars"></div>
    <p class="battle-impression" id="chasing"></p>
    <div class="rows" id="rates"></div>
  </section>
  <p class="group-head" data-t="group.power">できること</p>
  <section class="panel" data-sec="hexagon" data-group="power"><h2><span data-t="panel.hexagon">能力値</span></h2><svg class="hex" id="hex" viewBox="0 0 200 190" aria-hidden="true"><g id="hex-grid"></g><polygon class="hex-shape" id="hex-shape" points="" /><g id="hex-labels"></g></svg><div class="rows" id="hex-rows"></div><p class="battle-note" data-t="hex.note"></p></section>
  <section class="panel" data-sec="skills" data-group="power"><h2><span data-t="panel.skills">覚えた技</span></h2><div class="skills" id="skills"></div></section>
  <p class="group-head" data-t="group.events">できごと</p>
  <section class="panel" id="dungeon-panel" data-sec="dungeon" data-group="events"><h2><span data-t="panel.dungeon">迷宮</span> <span id="dungeon-floor"></span></h2><p class="jobs-note" data-t="dungeon.equipped">身に着けているもの</p><div class="gear" id="dungeon-gear"></div><p class="jobs-note" data-t="dungeon.recent">近ごろの拾い物</p><div class="finds" id="dungeon-finds"></div><p class="jobs-note" id="bosses-note" data-t="dungeon.bosses">討ち果たした主</p><div class="bosses" id="bosses"></div><p class="battle-note" data-t="dungeon.note"></p></section>
  <section class="panel" id="battle-panel" data-sec="battle" data-group="events">
    <h2><span data-t="panel.battle">直近の一戦</span></h2>
    <div class="battle-top"><span id="battle-head">─</span><b class="battle-result" id="battle-result"></b></div>
    <p class="battle-impression" id="battle-impression"></p>
    <ol class="battle-log" id="battle-log"></ol>
    <p class="battle-note" id="battle-note"></p>
  </section>
  <section class="panel" id="expedition-panel" hidden data-sec="expedition" data-group="events">
    <h2><span data-t="panel.expedition">留守のあいだ</span></h2>
    <p class="battle-impression" id="expedition-head"></p>
    <div class="finds" id="finds"></div>
  </section>
  <p class="group-head" data-t="group.record">記録</p>
  <section class="panel" data-sec="achievements" data-group="record"><h2><span data-t="panel.achievements">称号</span> <span id="achievement-count"></span></h2>
    <p class="jobs-note" id="jobs-note"></p>
    <div class="jobs" id="jobs"></div>
    <div class="achievements" id="achievements"></div>
  </section>
  <section class="panel" data-sec="recap" data-group="record" id="recap-panel" hidden><h2><span data-t="panel.recap">ひと月のふりかえり</span> <span id="recap-span"></span></h2><div class="rows" id="recap-rows"></div><p class="dungeon-note" id="recap-note"></p></section>
  <section class="panel" data-sec="history" data-group="record"><h2><span data-t="panel.history">歩み</span></h2><div class="rows" id="traits"></div></section>
  <p id="foot" data-t="foot">読み取り専用</p>
</main>
<script src="/assets/pet-svg.js?v=${ASSET_STAMP}"></script>
<script src="/assets/gestures.js?v=${ASSET_STAMP}"></script>
<script src="/assets/mobile.js?v=${ASSET_STAMP}"></script>
</body></html>`;
