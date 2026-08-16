import { CLASS_IDS, classForTool, dominantClass } from './classes.js';
import { stampUnlocked } from './achievements.js';
import { personaFor } from './persona.js';
import { dayKeyFor, partsFor } from './clock.js';

export const STATE_VERSION = 13;

/**
 * レベルの上限。
 *
 * 実際に届く高さではない（下の曲線と日次上限だと Lv100 でも 1 年以上かかる）。
 * 天井の意味は「どこまでなら表示も戦闘も壊れないと保証したか」で、
 * ここまでは数字が溢れないことをテストで縛ってある。
 */
export const MAX_LEVEL = 999;

/**
 * 1 日に入る EXP の上限。ファーミング防止と、成長を数日に伸ばすためのペース調整。
 *
 * **400 から上げた。** 実測すると 400 は「作業を始めて 1.7 時間」で埋まっていて、
 * よく使う日ほど捨てる割合が増えていた（1 日 800 イベントで 74%、1600 で 87%）。
 * つまり **Claude Code を一番使っている人の相棒が、一番早く育つのをやめる**
 * ことになっていて、「戦闘力の出どころは作業ログ」と正面から食い違っていた。
 *
 * **1500 からさらに上げた。** 同じことが 1500 でも起きていた ── 実測した 1 日
 * （12.6 時間・ツール 1,269 回・プロンプト 78 件）で素の EXP が 3,175 あり、
 * **上限に届いたのが 9 時間目**。そこから 5 時間ぶんが丸ごとゼロで、
 * **その日の 53% を捨てていた**。1 日まるごと働いて Lv7 で止まる。
 *
 * 3000 は「その日がほぼ丸ごと入る」高さ（捨てるのは 6%）。
 * ここを超えるのは人が 1 日に叩ける量を明らかに越えている領域なので、
 * DESIGN.md §3 の sanity check の基準線としてはまだ機能する。
 *
 * イベント単価（EXP_TABLE）ではなくここを上げているのは、単価だけ上げても
 * 上限が同じなら「埋まるのが 9 時間から 4 時間に早まる」だけだから。
 *
 * **勘で動かさない。** 動かすときは手元の events.jsonl で
 * 「素の EXP」と「上限に届く時刻」を測ってから。
 */
export const DAILY_EXP_CAP = 3000;

/** セッション ID を覚えておく件数。これを超えた分は古いものから捨てる。 */
const SESSION_MEMORY = 200;

/**
 * 「ひと続きの会話」が切れたとみなす空き時間。
 *
 * **セッション ID だけでは数えられない。** クラウドの Claude Code は
 * コンテナが生きている限り同じ ID を使い続けるので、実測で
 * **12.6 時間・SessionStart 22 回・プロンプト 78 件が、セッション 1 本**に
 * なっていた（手元の events.jsonl で `s` の種類が 1 つだけ）。
 * 逆に IDE 拡張は 0.5 秒で開いて閉じる ID を大量に作る。
 *
 * どちらも「会話が進んだか」とは関係がない。だから数えるのは**席に着いた
 * 回数**にする ── 新しい ID か、同じ ID でも 45 分空いてから再開したら、
 * それは別のひと続き。連続して打っている間は、何度打っても 1 本のまま。
 */
const SESSION_GAP_MS = 45 * 60 * 1000;

/**
 * 日ごとの EXP を何日ぶん持つか。
 *
 * 2 週間。1 週間だと「今週は先週より働いた」が出せず、1 ヶ月だと
 * スマホの画面で 1 本ずつが細くなりすぎる（数字ではなく形で見るためのもの）。
 */
export const TRAIL_DAYS = 14;

/**
 * 日ごとの記録を、どこまで残すか。
 *
 * **窓（TRAIL_DAYS = 14）とは別の数字。** 型（persona.js）が見るのも画面の
 * 「この 2 週間」も 14 日のままで、そこは動かさない ── 累計に戻すと分母が
 * 育って、一度決まった名前が二度と動かなくなる（CLAUDE.md）。
 *
 * ここを 40 日にしたのは**ふりかえり（recap.js）のため**だけ。1 か月ぶんを
 * 出すには 30 日 + 月をまたぐぶんの余りが要る。1 日ぶんは 5 つの数字と
 * 系統の内訳だけなので、40 日でも state はほとんど増えない。
 */
export const KEEP_DAYS = 40;

/**
 * イベント 1 件あたりの EXP。失敗したツール呼び出しも 0 にはしない（試行は試行）。
 *
 * SessionStart が 0 なのは意図的。実測すると、IDE 拡張などが裏で 0.5 秒で
 * 開いて閉じるセッションを大量に立てていて、15 分で 14 対 1 の比率で
 * 実作業を圧倒していた。起動しただけでは働いたことにならない。
 * セッションの功績は、最初のプロンプトが来た時点で SessionFirstPrompt として入る。
 */
const EXP_TABLE = {
  SessionStart: 0,
  SessionFirstPrompt: 5,
  UserPromptSubmit: 3,
  PostToolUse: 2,
  PostToolUseFailed: 1,
  Stop: 4,
  SubagentStop: 2,
  PreCompact: 6,
  Notification: 0,
  SessionEnd: 0,
  PreToolUse: 0, // PostToolUse で数えるので二重取りしない
};

/**
 * レベル曲線の指数と係数。**累計 EXP = LEVEL_BASE × (L-1)^LEVEL_EXPONENT。**
 *
 * ## なぜ 1.55 なのか（1.75 から下げた）
 *
 * **RPG の曲線をそのまま使えない。** RuneScape は 7 レベルごとに必要 EXP が
 * 倍になる指数曲線だが、あれが成立するのは**稼ぎもレベルで跳ね上がるから**
 * （高レベルの狩り場は 100 倍稼げる）。Maite の稼ぎは「実際に働いた量」に
 * 縛られていて、しかも日次上限で頭を押さえてあるので、**一生増えない**。
 *
 * 稼ぎが増えない側の実例が Habitica（習慣アプリ・1 レベル = 0.25L²+10L+139.75）で、
 * 公式の課題管理に「Lv100 から上は上がらないのに見返りも無い」が立っている。
 * 1.75 のままだと Maite も同じで、**Lv88 で「丸 1 日 上限まで働いても 1 レベルも
 * 上がらない」に当たっていた**（実測）。
 *
 * 取るのは Diablo のパラゴンの原則 ──「ログインしたら何か進んでいてほしい。
 * 新しい剣が出なくても」。**働いた日は必ず 1 つ以上上がる**を、どこまで守れるか：
 *
 *   指数    止まるレベル   Lv999 まで（毎日 上限まで働いて）
 *   1.75      Lv88            9.7 年
 *   1.60      Lv311           3.4 年
 *   1.55      Lv554           2.4 年   ← ここ
 *   1.50      止まらない      1.7 年
 *
 * 1.50 は止まらない代わりに Lv999 が 1.7 年で、上限が「壊れない保証」ではなく
 * 「ゴール」になる。1.55 なら Lv554 まで止まらず ── そこへ行く人はまず居ないので
 * 実質止まらないまま、天井は遠いところに残る。
 *
 * **変えると全員のレベルが動く**（畳み直しで数字が一斉に上がる）。動かすなら
 * `STATE_VERSION` を上げること。
 */
export const LEVEL_BASE = 60;
export const LEVEL_EXPONENT = 1.55;

/**
 * Lv L に到達するのに必要な累計 EXP。
 * 序盤を意図的に速くしている ── 「育ってる感」が最初の数日で来ないと続かない。
 */
export function totalExpForLevel(level) {
  if (level <= 1) return 0;
  return Math.round(LEVEL_BASE * Math.pow(level - 1, LEVEL_EXPONENT));
}

/**
 * 逆関数で当たりを付けてから、丸めのぶんだけ前後に詰める。
 *
 * 1 ずつ数え上げる実装だと、レベルが上がるほど 1 イベントあたりの
 * ループが伸びる（上限まで行くと 1 件畳むのに 1 万回まわる）。
 * applyEvent はイベント 1 件ごとに呼ばれるので、ここは定数時間で終わらせる。
 */
export function levelForExp(exp) {
  if (exp <= 0) return 1;
  let level = Math.min(MAX_LEVEL, Math.floor(Math.pow(exp / LEVEL_BASE, 1 / LEVEL_EXPONENT)) + 1);
  while (level > 1 && totalExpForLevel(level) > exp) level -= 1;
  while (level < MAX_LEVEL && totalExpForLevel(level + 1) <= exp) level += 1;
  return level;
}

/** 現在レベル内での進捗 0..1 と、次のレベルまでの残り EXP。 */
export function levelProgress(exp) {
  const level = levelForExp(exp);
  const floor = totalExpForLevel(level);

  // 上限に達したら「次」が無い。0 除算を避けつつ、バーは満タンで止める。
  if (level >= MAX_LEVEL) {
    const into = exp - floor;
    return { level, into, span: into, ratio: 1, toNext: 0 };
  }

  const ceil = totalExpForLevel(level + 1);
  const span = ceil - floor;
  return {
    level,
    into: exp - floor,
    span,
    ratio: span > 0 ? (exp - floor) / span : 0,
    toNext: ceil - exp,
  };
}

/**
 * 「その人にとっての今日」。既定は機械のローカル時刻で、tzOffset を渡すと
 * その土地の壁時計で切る（clock.js に理由を書いた）。
 */
function dayKey(ts, tzOffset = null) {
  return dayKeyFor(ts, tzOffset);
}

/**
 * 立て直し（不屈のもと）と認める幅。同じセッションで、10 分以内に成功し直したときだけ。
 *
 * 旧い state（真偽値で持っていた頃）が畳み直し前に混ざったときは、時刻が
 * 分からないので数えない ── 版を上げれば全部畳み直されるので、これは保険。
 */
const COMEBACK_WINDOW = 10 * 60 * 1000;

function isComeback(failed, now, session) {
  if (!failed || typeof failed !== 'object') return false;
  if (!(now - failed.t >= 0) || now - failed.t > COMEBACK_WINDOW) return false;
  if (failed.s && session && failed.s !== session) return false;
  return true;
}

export function emptyState(now = Date.now()) {
  const classVector = {};
  for (const id of CLASS_IDS) classVector[id] = 0;
  return {
    version: STATE_VERSION,
    name: null,
    bornAt: now,
    seed: now % 100000,
    exp: 0,
    level: 1,
    classId: null,
    classVector,
    traits: {
      toolCalls: 0,
      prompts: 0,
      sessions: 0,
      failures: 0,
      comebacks: 0, // 失敗したツールを直後に成功させた回数 = 不屈
      nightOwl: 0,
      compacts: 0,
    },
    /*
     * **その日の枠は、まだ決めない。**
     *
     * 前はここで `dayKey(now)`（＝**機械のローカル時刻**）を刻んでいたが、
     * 畳むときの区切りは `applyEvent` に渡す `tzOffset` で決まるので、
     * **作った機械と畳む土地がずれていると、初日だけ別の枠に入る**
     * ── 機械のほうが日付が先に進んでいると、`today > state.daily.day` が
     * 成り立たず、初日ぶんが翌日の枠から引かれる。
     *
     * null にしておけば、最初のイベントが**畳むときと同じ区切りで**決める。
     * （CLAUDE.md「機械のローカル時刻を直接見ない」の見落としが 1 つ残っていた）
     */
    daily: { day: null, exp: 0 },
    /*
     * 日ごとの記録。「ここ 2 週間どうだったか」と、**型（persona.js）の窓**に使う。
     *
     * **導出でいけないか考えた上で、保存にした。** 出すには events.jsonl 全体が要るが、
     * オーバーレイは cursor から先だけを畳んでいる（毎回全部読み直すと、
     * 10 万件を超えたあたりで起動が目に見えて遅くなる）。畳んでいる途中でしか
     * 分からない値なので、実績と同じ扱いにする ── 畳み直せば同じ数字が出る。
     *
     * 日付キー → { exp, tools, prompts, sessions, cls }。持つのは直近 TRAIL_DAYS
     * 日ぶんだけなので、1 年使っても大きさは頭打ち。
     * **その日のぶんは、そのイベントの日に付ける**（日次上限は今日の枠から引くが、
     * こちらは「いつ・どう働いたか」を出すためのものなので、働いた日に置く）。
     */
    days: {},
    /*
     * 型が変わった記録。**いつ変わったか**は、いまの state からは復元できない
     * （実績と同じ理由）ので、畳んでいる途中で刻む。畳み直せば同じ時刻が出る。
     */
    jobs: [],
    /*
     * 職ごとに貯まった経験値。**全体のレベルとは別に、その職としての位が出る**
     * ── 錬金術師 Lv3 のまま罠師 Lv5 になっていることがあり、そこに
     * 「どの道をどれだけ歩いたか」が出る。
     *
     * ここだけは導出できない。いまの traits からは「どの職でいたときに稼いだか」を
     * 復元できないので（型は直近 2 週間の窓から出る導出値）、畳む途中で分ける
     * しかない ── 実績を保存しているのと同じ理由。
     */
    jobExp: {},
    lastEventAt: 0,
    lastEventKind: null,
    // 最後に動いた道具。**見た目のためだけ**に持つ（gestures.js が
    // 「いま何をしている場面か」を出すのに使う）。成長のルールには効かない。
    lastTool: null,
    // 実績 ID → 獲得した時刻。畳み直せば同じ時刻が再現される。
    achievements: {},
    pendingFail: {},
    // 「実際に使われた」と認定済みのセッション。空セッションを弾くために持つ。
    countedSessions: [],
  };
}

/**
 * その日の入れ物を出す（無ければ作る）。**持つのは直近 TRAIL_DAYS 日ぶんだけ。**
 *
 * 全部の日を持つと、1 年使った state に 365 個ぶん付いて回る（スマホへ毎回
 * 送るものでもある）。古い日から捨てるので、state の大きさは頭打ちになる。
 */
function dayBucket(state, day) {
  if (!state.days) state.days = {};
  if (!state.days[day]) {
    state.days[day] = { exp: 0, tools: 0, prompts: 0, sessions: 0, cls: {} };

    const keys = Object.keys(state.days);
    if (keys.length > KEEP_DAYS) {
      keys.sort();
      for (const old of keys.slice(0, keys.length - KEEP_DAYS)) delete state.days[old];
    }
  }
  return state.days[day];
}

/** 覚えておくジョブチェンジの数。古いものから捨てる。 */
const JOB_MEMORY = 12;

/**
 * 型が変わったら刻む。**「いつ変わったか」は、いまの state からは出せない。**
 *
 * 型そのものは導出（persona.js）なので保存しないが、変わった瞬間だけは実績と
 * 同じ理由で残す ── 畳んでいる途中でしか分からないので。畳み直せば同じ時刻が出る。
 *
 * まだ名乗れないうち（母数が足りない）は刻まない。見極め中のブレを履歴にすると、
 * 初日に 5 回ジョブチェンジしたことになる。
 */
function stampJob(state, now, persona) {
  if (!persona.settled) return;
  if (!Array.isArray(state.jobs)) state.jobs = [];

  const last = state.jobs[state.jobs.length - 1];
  if (last && last.key === persona.key) return;

  state.jobs.push({ key: persona.key, at: now });
  if (state.jobs.length > JOB_MEMORY) state.jobs = state.jobs.slice(-JOB_MEMORY);
}

/** 直近イベントから見た目の状態を出す。描画側はこれだけ見ればいい。 */
export function moodFor(state, now = Date.now()) {
  const since = now - (state.lastEventAt || 0);
  // 許可待ちは**返事が来るまでの間だけ**。Notification で終わったまま席を立つと
  // （実際いちばん多い終わり方）、翌朝も一晩中こちらを呼び続けることになっていた。
  // しぐさを止める状態でもあるので、放っておくと何もしない置物になる。
  if (state.lastEventKind === 'Notification') return since > 5 * 60 * 1000 ? 'sleeping' : 'calling';
  if (state.lastEventKind === 'SessionEnd') return 'sleeping';
  if (since > 5 * 60 * 1000) return 'sleeping';
  if (since > 20 * 1000) return 'idle';
  if (state.lastEventKind === 'UserPromptSubmit') return 'thinking';
  if (state.lastEventKind === 'PreToolUse' || state.lastEventKind === 'PostToolUse') return 'working';
  return 'idle';
}

/**
 * イベント 1 件を状態に畳み込む。純関数（引数の state は書き換えない）。
 * events.jsonl 全体をこれで畳み込めば、いつでも state を再構築できる。
 */
export function applyEvent(prev, event, { tzOffset = null } = {}) {
  const state = structuredClone(prev);
  const now = event.t || Date.now();
  const kind = event.e;

  /*
   * 日付が変わったら日次 EXP をリセット ── ただし**進んだときだけ**。
   *
   * 「違う日なら 0 に戻す」にしていたら、遅れて届いた昨日のイベント 1 件で
   * 今日の上限が空になっていた。別の PC やクラウドから届くぶんは順番が前後するし、
   * 過去ログの取り込みでも起きる。実際に 1 日で 3,004 EXP（上限 1,500）入った。
   * 日付は文字列で並べれば時系列に並ぶので、進んだかどうかはそのまま比べられる。
   */
  const today = dayKey(now, tzOffset);
  // 戻ったぶん（遅れて届いた昨日のイベント）は、今日の枠から引く。
  // 別の枠を作ると「昨日の枠が空いているから」で上限を回避できてしまう。
  // まだ決まっていない（作ったばかりの state）なら、ここで決める
  if (state.daily.day === null || today > state.daily.day) state.daily = { day: today, exp: 0 };

  // 見た目（気分・しぐさ）は「最後に何をしたか」で決まる。遅れて届いた古い
  // イベントで時計を巻き戻すと、働いた直後に「5 時間ぶりに帰ってきた」になる。
  if (now >= state.lastEventAt) {
    state.lastEventAt = now;
    state.lastEventKind = kind;
    if (kind === 'PreToolUse' || kind === 'PostToolUse') state.lastTool = event.tool || null;
    else if (kind === 'UserPromptSubmit') state.lastTool = null;
  }

  const traits = state.traits;
  const bucket = dayBucket(state, today);
  let bonus = 0;
  let expKey = kind;

  // 夜更かし判定も実作業だけで数える。裏で立つ空セッションを混ぜない。
  const isWork = kind === 'UserPromptSubmit' || kind === 'PostToolUse';
  const hour = partsFor(now, tzOffset).hour;
  if (isWork && hour >= 0 && hour < 5) traits.nightOwl += 1;

  switch (kind) {
    case 'SessionStart': {
      /*
       * ここでは数えない。**印を付けるだけ。** 最初のプロンプトが来て初めて
       * セッションとみなす ── IDE 拡張などが裏で 0.5 秒で開いて閉じる
       * セッションを大量に立てるので、開いただけでは働いたことにならない
       * （実測で 15 分に 14 対 1 の比率で実作業を圧倒していた）。
       *
       * 印を付けるのは、**同じ ID で開き直された**ときに次の 1 本と数えるため。
       * クラウドの Claude Code は ID を使い回すので、これが無いと 12 時間ぶんが
       * まるごと 1 本になる（実測で SessionStart 22 回がセッション 1 本だった）。
       */
      const started = event.s ? state.countedSessions.find((entry) => entry.i === event.s) : null;
      if (started) started.r = true;
      break;
    }

    case 'UserPromptSubmit': {
      traits.prompts += 1;
      bucket.prompts += 1;
      /*
       * ひと続きの会話を 1 本と数える。**ID が同じでも、45 分空いて戻って
       * きたら別の 1 本**（上の SESSION_GAP_MS）。
       *
       * 時刻が戻っているときは数えない ── 順番どおりに届かないので
       * （別のマシン・クラウド・過去ログの取り込み）、`now - seen` が負に
       * なることがある。ここで数えると、畳み直すたびに本数が増える。
       */
      const id = event.s;
      if (id) {
        const seen = state.countedSessions.find((entry) => entry.i === id);
        if (!seen) {
          state.countedSessions.push({ i: id, t: now });
          if (state.countedSessions.length > SESSION_MEMORY) {
            state.countedSessions = state.countedSessions.slice(-SESSION_MEMORY);
          }
          traits.sessions += 1;
          bucket.sessions += 1;
          bonus += EXP_TABLE.SessionFirstPrompt;
        } else {
          // 開き直された（r）か、しばらく空いてから戻ってきたか
          if (seen.r || now - seen.t >= SESSION_GAP_MS) {
            traits.sessions += 1;
            bucket.sessions += 1;
            bonus += EXP_TABLE.SessionFirstPrompt;
          }
          seen.r = false;
          // 最後に見た時刻は進めるだけ（戻さない）
          if (now > seen.t) seen.t = now;
        }
      }
      break;
    }

    case 'PostToolUse': {
      traits.toolCalls += 1;
      bucket.tools += 1;
      const tool = event.tool;
      if (event.ok === false) {
        traits.failures += 1;
        if (tool) state.pendingFail[tool] = { t: now, s: event.s || null };
        expKey = 'PostToolUseFailed';
      } else {
        // 「その場で立て直した」だけを数える。失敗を覚えっぱなしにしていた頃、
        // 3 日前に転けた Bash が今日たまたま通っただけで不屈が 1 つ増えていた
        // ── それは立て直しではなく、ただ同じ道具をまた使っただけ。
        const failed = tool ? state.pendingFail[tool] : null;
        if (failed && isComeback(failed, now, event.s)) {
          traits.comebacks += 1;
          delete state.pendingFail[tool];
        } else if (failed) {
          delete state.pendingFail[tool];
        }
        const classId = classForTool(tool);
        if (classId) {
          state.classVector[classId] += 1;
          bucket.cls[classId] = (bucket.cls[classId] || 0) + 1;
        }
      }
      break;
    }

    case 'PreCompact':
      traits.compacts += 1;
      break;

    default:
      break;
  }

  const gain = (EXP_TABLE[expKey] ?? 0) + bonus;
  let earned = 0;
  if (gain > 0) {
    const room = Math.max(0, DAILY_EXP_CAP - state.daily.exp);
    earned = Math.min(gain, room);
    state.exp += earned;
    state.daily.exp += earned;
    bucket.exp += earned;
  }

  state.level = levelForExp(state.exp);
  state.classId = dominantClass(state.classVector, state.level) ?? state.classId;

  // 実績はイベントを畳んだ直後に判定する。「いつ超えたか」はここでしか分からない。
  // 上限は引数で渡す ── achievements 側から import すると循環参照になる。
  // 型は 1 回だけ出して、実績（なった職）と履歴の両方に渡す
  const persona = personaFor(state);
  stampUnlocked(state, now, { maxLevel: MAX_LEVEL, persona, dailyCap: DAILY_EXP_CAP });
  stampJob(state, now, persona);

  /*
   * **稼いだぶんを、そのときの職にも貯める。**
   *
   * 名乗れていないうち（母数が足りない）は誰のものでもないので捨てる ── 初日の
   * ブレを職の経験値にすると、3 回叩いただけの職が Lv2 で並ぶ。
   */
  if (earned > 0 && persona.settled) {
    if (!state.jobExp || typeof state.jobExp !== 'object') state.jobExp = {};
    state.jobExp[persona.key] = (state.jobExp[persona.key] || 0) + earned;
  }

  return state;
}

export function applyEvents(prev, events, options = {}) {
  return events.reduce((acc, ev) => applyEvent(acc, ev, options), prev);
}
