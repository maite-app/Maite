/* 描画だけ。成長のルールは一切ここに書かない（core/growth.js が唯一の真実）。 */

document.getElementById('pet-mount').innerHTML = window.AIPET_SVG;

const stage = document.getElementById('stage');
const bubble = document.getElementById('bubble-text');
const badgeLevel = document.getElementById('badge-level');
const badgeClass = document.getElementById('badge-class');
const barFill = document.getElementById('bar-fill');
const pupils = Array.from(document.querySelectorAll('.pupil'));

const MOODS = ['idle', 'working', 'thinking', 'calling', 'sleeping'];

/** スキンの id。付け替えのときに前のクラスを外すためだけに持つ。 */
const SKIN_IDS = ['plain', 'mono', 'ember', 'frost', 'dusk'];

/** 吹き出しを出す気分と、その中身。idle は無言 ── 黙っていられることが常駐アプリの品格。 */
const BUBBLE = {
  thinking: '...',
  calling: '!',
  idle: null,
  working: null,
  sleeping: null,
};

/** 気分ごとの目線。呼んでいるときだけ「見上げる」。 */
const GAZE = {
  calling: { x: 0, y: -3.5 },
  thinking: { x: 2.5, y: -1.5 },
  working: { x: 0, y: 1.5 },
  idle: { x: 0, y: 0 },
  sleeping: { x: 0, y: 0 },
};

let current = null;

/* ------------------------------------------------------------------ *
 * 吹き出しの割り込み
 *
 * 実績とレベルアップだけは、気分の吹き出しより優先して数秒出す。
 * OS の通知は出さない（DESIGN.md §5）── 出るのは画面の中だけで、
 * 消えるのを待つ以外の操作は要らない。
 * ------------------------------------------------------------------ */
const ANNOUNCE_MS = 6000;
let announce = null;
let announceUntil = 0;
let announceKind = null;

function say(text, kind, ms = ANNOUNCE_MS) {
  announce = text;
  announceKind = kind;
  announceUntil = Date.now() + ms;
}

/** 起動直後の 1 回目は黙る ── 毎回全部を報告されたら騒がしい。 */
let knownAchievements = null;
let knownLevel = null;
let knownName = null;
let knownGear = null;
let knownBosses = null;

/** いま着けているものを「枠:id」の集合にする。入れ替わったかを見るため。 */
function gearKeys(view) {
  const items = (view.dungeon && view.dungeon.equipped) || [];
  return new Set(items.map((item) => `${item.slot}:${item.id}`));
}

/** 抜けてきた主の数。増えたときだけ言う。 */
function bossCount(view) {
  return ((view.dungeon && view.dungeon.bosses) || []).length;
}

function noteProgress(view) {
  const list = view.achievements || [];

  if (knownAchievements === null) {
    knownAchievements = new Set(list.map((a) => a.id));
    knownLevel = view.level;
    knownName = view.name;
    knownGear = gearKeys(view);
    knownBosses = bossCount(view);
    return;
  }

  // **名前が変わった。** 働き方が変わったから、型のほうが付いてきた
  // （persona.js）。放っておくと知らない間に変わるので、変わった時だけは言う。
  if (view.name && view.name !== knownName) {
    const before = knownName;
    knownName = view.name;
    say(`${before} → ${view.name}`, 'job', 9000);
    play('levelup');
  }

  if (view.level > knownLevel) {
    knownLevel = view.level;
    say(`Lv${view.level}!`, 'levelup');
    play('levelup');
  }

  /*
   * **主を抜けた瞬間だけ言う。** 25 階ごとの通過点で、狙って行けるものではない
   * （潜る深さは作業量で決まる）── 気づかないうちに通り過ぎているのを、
   * ここで一度だけ拾う。装備より先に出すのは、こちらのほうが珍しいから。
   */
  const bossesNow = bossCount(view);
  if (bossesNow > knownBosses) {
    const latest = view.dungeon.bosses[0];
    knownBosses = bossesNow;
    // 文は view.js が言語ごとに作って渡してくる（ここでは組み立てない）
    if (latest) say(latest.text, 'levelup', 7000);
    play('levelup');
  }

  /*
   * **装備が良くなった瞬間だけ言う。**
   *
   * 潜るのも拾うのも勝手に進むので（dungeon.js）、黙っていると「いつの間にか
   * 強くなっていた」だけになって、強くなった実感が画面に出ない。かといって
   * 拾うたびに言うと騒がしい ── 実際に着け替わったときだけにしてある。
   */
  const gearNow = gearKeys(view);
  const newGear = [...gearNow].filter((key) => !knownGear.has(key));
  knownGear = gearNow;
  if (newGear.length) {
    const slot = newGear[0].split(':')[0];
    const item = (view.dungeon.equipped || []).find((e) => e.slot === slot);
    // 文は view.js が言語ごとに作って渡してくる（ここでは組み立てない）
    if (item) say(item.say, 'levelup', 5000);
    play('bounce');
  }

  // なった職の実績だけは黙る ── 同じ瞬間に「◯◯ → ◯◯」を出しているので、
  // 二重に言うと吹き出しが取り合いになる。バッジはスマホ側に残る。
  const fresh = list.filter((a) => !knownAchievements.has(a.id) && !a.id.startsWith('job:'));
  for (const a of list) knownAchievements.add(a.id);
  if (fresh.length) {
    // **言語に依らない書き方にする。** pet.js は素のスクリプト（ES モジュールを
    // 読めない）ので、ここで文を組み立てると日本語が焼き付く。
    say(fresh.length === 1 ? fresh[0].label : `${fresh[0].label} +${fresh.length - 1}`, 'achievement');
    play('levelup');
  }
}

/* ------------------------------------------------------------------ *
 * しぐさ
 *
 * 眺めている時間がいちばん長い画面なので、ここが静かすぎると
 * 「育っているか見に行く」気にならない。どれを出すかは shared/gestures.js。
 * ------------------------------------------------------------------ */
let gesture = null;
let gestureUntil = 0;
let gestureTimer = null;

/** しぐさ中は気分のアニメーションを一時的に上書きする。終わったら戻す。 */
function play(id, ms) {
  const def = window.AIPET_GESTURES.byId(id);
  const duration = ms || (def ? def.ms : 1000);
  if (gesture) stage.classList.remove(`g-${gesture}`);
  gesture = id;
  gestureUntil = Date.now() + duration;
  stage.classList.add(`g-${id}`);
  setTimeout(() => {
    if (gesture !== id) return;
    stage.classList.remove(`g-${id}`);
    gesture = null;
  }, duration);
}

/**
 * 戦闘のしぐさだけは中身に合わせて 2 通り。勝った日は最後に跳ね、
 * 負けた日はよろける ── 数字を読まなくても today の結果が分かる。
 */
function playBattle(view) {
  const battle = view.battle;
  if (!battle) return;
  play(battle.winner === 'foe' ? 'battle-lose' : 'battle-win', 3400);
  say(`vs ${battle.opponent.name}`, 'battle', 2600);
  setTimeout(() => {
    if (!current || !current.battle) return;
    const result = current.battle.result;
    say(result, current.battle.winner === 'you' ? 'levelup' : 'battle', 1800);
  }, 2600);
}

/**
 * 留守番の報告。**帰ってきて最初に見たときだけ**、一度出す。
 *
 * 拾ってきたものはスマホ側にも出ているが、オーバーレイしか開かない日のほうが
 * 多い。ここで言わないと、放置探索は実質「無かったこと」になる。
 *
 * 留守に入った時刻で覚えるので、同じ留守番を二度報告しない。
 */
let reportedAwayAt = null;

function maybeReportTrip() {
  if (!visible() || !current) return;
  // 留守のまとめが流れている最中は割り込まない（吹き出しの取り合いになる）
  if (Date.now() < announceUntil) return;
  const trip = current.expedition;
  if (!trip) return;
  if (reportedAwayAt === current.lastEventAt) return;
  reportedAwayAt = current.lastEventAt;

  const finds = trip.finds || [];
  if (!finds.length) return;
  // 文は view.js が言語ごとに作って渡してくる（ここでは組み立てない）
  const text = trip.headline;
  say(text, finds.some((f) => f.rare) ? 'levelup' : 'battle', 5000);
  play('bounce');
}

/** 隠れている間は動かない。見ていない相手に手を振っても仕方がない。 */
function visible() {
  return !document.hidden;
}

/* ------------------------------------------------------------------ *
 * 留守のあいだのまとめ
 *
 * **いちばん大きな穴がここだった。** noteProgress は「前に見たときからの差」で
 * 言うか黙るかを決めているが、**最初の 1 回は必ず黙って種を置くだけ**で返る
 * ── つまり画面を閉じているあいだに Lv7 → Lv13 になって、装備が 2 つ替わって、
 * 称号が 3 つ増えていても、次に開いた時点では**何も言わない**。
 * 放置で育つのが芯なのに、育った証がいちばん出ない瞬間が「久しぶりに見たとき」
 * だった。
 *
 * ## 覚えるのは「最後に見えていた時刻」だけ
 *
 * state.json には何も足さない（成長の記録ではないので、events.jsonl から
 * 畳み直せる必要も無い）。**画面が出ているあいだだけ**控えを上書きするので、
 * 隠していた時間・落としていた時間がそのまま「留守」になる。
 *
 * 常駐アプリなので「起動してから」では測れない ── ずっと動いている前提だから、
 * 見ていたかどうかで測る。
 *
 * ## 言葉は i18n から出す
 *
 * pet.js は素のスクリプト（ES モジュールを読めない）ので、ここで文を組み立てると
 * 日本語が焼き付く。足すのは数字と記号だけ（`Lv7 → Lv13`, `+2`）にして、
 * 言葉は view.text から引く。
 * ------------------------------------------------------------------ */
const AWAY_MS = 3 * 60 * 60 * 1000;
const SEEN_KEY = 'aipet:seen';
const AWAY_STEP_MS = 2600;

function snapshotOf(view) {
  return {
    at: Date.now(),
    level: view.level,
    badges: (view.achievements || []).length,
    gear: [...gearKeys(view)],
    bosses: bossCount(view),
  };
}

function readSeen() {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

/** 控えが書けなくても本体は止めない（hook の掟と同じ。CLAUDE.md）。 */
function writeSeen(view) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(snapshotOf(view)));
  } catch (err) {
    /* 書けないなら、次に開いたときに黙るだけ */
  }
}

let awayShownFor = null;

/* ------------------------------------------------------------------ *
 * 記念日
 *
 * 一緒にいた日数だけで決まる、年に数回の一言（core/anniversary.js）。
 * **その日に一度だけ。** 逃しても何も減らないし、次がいつかも出さない
 * ── 出した瞬間「あと何日」が見えて、目標になる（DESIGN.md §5b）。
 *
 * 出したかどうかは「日付」で覚える。起動しなおすたびに言う子だと、
 * 記念日そのものが安くなる。
 * ------------------------------------------------------------------ */
const ANNIV_KEY = 'aipet:anniv';

function maybeGreet() {
  if (!visible() || !current) return;
  const day = current.anniversary;
  if (!day) return;
  // 留守のまとめが流れている最中は割り込まない
  if (Date.now() < announceUntil) return;
  try {
    if (localStorage.getItem(ANNIV_KEY) === String(day.days)) return;
    localStorage.setItem(ANNIV_KEY, String(day.days));
  } catch (err) {
    /* 控えが取れないなら、開くたびに言うことになるだけ */
  }
  // 文は view.js が言語ごとに作って渡してくる（ここでは組み立てない）
  say(day.text, 'levelup', 7000);
  play('bounce');
}

function maybeReportAway() {
  if (!visible() || !current) return;
  const seen = readSeen();
  if (!seen || !seen.at) return;
  if (Date.now() - seen.at < AWAY_MS) return;
  // 同じ留守を二度報告しない
  if (awayShownFor === seen.at) return;
  awayShownFor = seen.at;

  const text = current.text || {};
  const parts = [];
  if (current.level > seen.level) parts.push(`Lv${seen.level} → Lv${current.level}`);

  const held = new Set(seen.gear || []);
  const freshGear = [...gearKeys(current)].filter((key) => !held.has(key)).length;
  if (freshGear) parts.push(`${text['away.gear']} +${freshGear}`);

  const freshBadges = (current.achievements || []).length - (seen.badges || 0);
  if (freshBadges > 0) parts.push(`${text['panel.achievements']} +${freshBadges}`);

  const freshBosses = bossCount(current) - (seen.bosses || 0);
  if (freshBosses > 0) parts.push(`${text['dungeon.bosses']} +${freshBosses}`);

  // 何も増えていない留守は黙る ── 「変わっていません」を報告しない
  if (!parts.length) return;

  const lines = [text['panel.expedition'], ...parts].filter(Boolean);
  let i = 0;
  const step = () => {
    if (!visible() || !current || i >= lines.length) return;
    say(lines[i], 'levelup', AWAY_STEP_MS);
    i += 1;
    if (i < lines.length) setTimeout(step, AWAY_STEP_MS);
  };
  step();
  play('bounce');
}

/**
 * 寝言。**夢を見ているしぐさに入ったときだけ**、たまに一言（core/sleeptalk.js）。
 *
 * 眠っている絵は静かでいいのだが、眠りに入ったあとは何時間見ても同じで、
 * そこだけ完全に止まっていた ── しぐさは「動き」であって「その子らしさ」では
 * ないので、直前に何をしていたかが寝顔に残るようにした。
 *
 * **中身は読まない。** 出どころは「最後に動いた道具」だけで、文は view.js が
 * 言語ごとに解いて渡してくる（ここでは組み立てない）。
 */
const SLEEP_TALK_ODDS = 0.5;

function maybeSleepTalk(gestureId) {
  if (gestureId !== 'dream' && gestureId !== 'snore') return;
  if (!current || current.mood !== 'sleeping') return;

  /*
   * **`dream` のときは、本当にあったことを見る**（core/dreams.js）。
   *
   * 寝言は「最後に動いた道具」から出るので、その日のことしか言えない ──
   * 毎晩おなじ 3 通りだと、結局そこも止まって見えていた。夢は過去のほうを
   * 向く（通ってきた職・越えてきた主・いま持っている道具・潜った階）ので、
   * **長く一緒にいるほど種類が増える。**
   */
  const dreams = (gestureId === 'dream' && current.dreams) || [];
  const lines = dreams.length ? dreams : current.sleepTalk || [];
  if (!lines.length || Math.random() > SLEEP_TALK_ODDS) return;
  // 静かなほうの吹き出しで出す（寝言が声を張ったら、それは寝言ではない）
  say(lines[Math.floor(Math.random() * lines.length)], 'battle', 2600);
}

function scheduleGesture() {
  clearTimeout(gestureTimer);
  const delay = window.AIPET_GESTURES.nextDelay(Math.random);
  gestureTimer = setTimeout(() => {
    if (visible() && current && Date.now() >= gestureUntil && Date.now() >= announceUntil) {
      const def = window.AIPET_GESTURES.pick(
        current.mood,
        {
          hasBattle: Boolean(current.battle),
          persona: current.persona && current.persona.marks,
          tool: current.lastTool,
        },
        Math.random,
      );
      if (def && def.id === 'battle') playBattle(current);
      else if (def) {
        play(def.id);
        maybeSleepTalk(def.id);
      }
    }
    scheduleGesture();
  }, delay);
}

/**
 * 開いたときに、その日の一戦を 1 回だけ見せる。
 *
 * 戦闘はログを読み込むものではなく「たまたま見かけるもの」に寄せてある。
 * 同じ日に何度も隠して出してを繰り返しても、繰り返し再生はしない。
 */
let battleShownFor = null;

function maybeShowBattle() {
  if (!visible() || !current || !current.battle) return;
  if (battleShownFor === current.battle.stamp) return;
  battleShownFor = current.battle.stamp;
  setTimeout(() => {
    if (visible() && current && current.mood !== 'calling') playBattle(current);
  }, 1200);
}

function render(view) {
  const first = current === null;
  current = view;
  noteProgress(view);

  // 吹き出しを組む前に済ませる。後ろに置くと、この描画では反映されず
  // 次の周回（500ms 後）まで文字が出なかった。
  // **留守のまとめが先。** 拾いものの報告より、こちらのほうが珍しい
  if (first) maybeReportAway();
  if (first) maybeGreet();
  if (first) maybeReportTrip();

  for (const mood of MOODS) stage.classList.toggle(`mood-${mood}`, view.mood === mood);

  // 系統が決まるまでは無彩色。決まった瞬間に色がつくのが「進化」の合図になる。
  if (view.hue !== null && view.hue !== undefined) {
    stage.style.setProperty('--hue', String(view.hue));
    stage.style.setProperty('--sat', '58%');
  } else {
    stage.style.setProperty('--hue', '220');
    stage.style.setProperty('--sat', '12%');
  }

  // レベルで少しずつ大きくなる。青天井にすると 200px の枠をはみ出すので頭打ちにする。
  // 大きさも appearance.js が出す ── **Lv13 で頭打ちだったのを Lv500 まで伸ばした**
  const scale = (view.look && view.look.scale) || Math.min(1.12, 0.82 + view.level * 0.024);
  stage.style.setProperty('--scale', scale.toFixed(3));

  // 型（persona.js）を顔つきに落とす。4 文字ぶんのクラスを付けるだけで、
  // 実際の差は style.css 側にある ── **型が字面だけにならないように**、
  // 目つきと口元がその人の使い方で変わる。
  for (const mark of ['in', 'out', 'move', 'build', 'cut', 'trust', 'through', 'spread']) {
    stage.classList.remove(`p-${mark}`);
  }
  for (const mark of ['calm', 'wave']) stage.classList.remove(`r-${mark}`);
  if (view.persona && view.persona.settled) {
    for (const mark of view.persona.marks) {
      // リズムだけは息づかいの速さ（r-）。ほかは顔つき（p-）
      stage.classList.add(mark === 'calm' || mark === 'wave' ? `r-${mark}` : `p-${mark}`);
    }
  }

  /*
   * 見た目の重ね着。**ここで条件を書かない** ── どの層を出すかは
   * appearance.js が決めて、クラス名だけ渡ってくる（view.look.marks）。
   * 書くと、オーバーレイとスマホで別々の見た目に育つ。
   *
   * 前に付いていたぶんを全部外してから付け直す ── 装備は潜るたびに変わるので、
   * 外し忘れると剣と斧を同時に持つ。
   *
   * **ac-（小物）・pt-（使い込み）・hurt-（ケガ）も必ず外す。** 前は lk-/gw-/gr-
   * だけを外していて、ケガが 1 時間で治らずに付きっぱなしになっていた
   * ── 消える側の印は、外し忘れると永久に消えない。
   */
  const look = view.look || { marks: [], scale: null };
  for (const cls of [...stage.classList]) {
    if (/^(lk-|gw-|gr-|ac-|pt-|hurt-)/.test(cls)) stage.classList.remove(cls);
  }
  for (const mark of look.marks) stage.classList.add(mark);

  /*
   * 空の色。**時刻はここで読まない** ── view.js が tzOffset ごと解いて渡す
   * （機械のローカルを見ると、PC とスマホで別の空になる）。
   */
  for (const sky of ['dawn', 'day', 'dusk', 'night']) stage.classList.remove(`sky-${sky}`);
  if (view.sky) stage.classList.add(`sky-${view.sky}`);
  // 昔の名前も残しておく（気分・しぐさ側の指定がこれを見ている）
  stage.classList.toggle('has-antenna', view.level >= 3);
  stage.classList.toggle('has-crown', view.level >= 10);
  stage.classList.toggle('has-aura', view.level >= 15);

  /*
   * スキン（skins.js）。**クラスを 1 つ付け替えるだけ。**
   * 色も模様も小物も CSS 側にあるので、ここで見た目の中身は決めない
   * ── 決めると、オーバーレイとスマホで別々の見た目に育つ。
   */
  for (const id of SKIN_IDS) stage.classList.remove(`skin-${id}`);
  if (view.skin) stage.classList.add(`skin-${view.skin.id}`);

  const announcing = Date.now() < announceUntil;
  const text = announcing ? announce : BUBBLE[view.mood];
  stage.classList.toggle('show-bubble', Boolean(text));
  stage.classList.toggle('bubble-loud', announcing && announceKind !== 'battle');
  if (text) bubble.textContent = text;

  // しぐさの最中は目線を触らない（CSS のアニメーションと引っぱり合いになる）
  if (!gesture) {
    const gaze = GAZE[view.mood] || GAZE.idle;
    for (const pupil of pupils) pupil.setAttribute('transform', `translate(${gaze.x} ${gaze.y})`);
  }

  badgeLevel.textContent = `Lv${view.level}`;
  // 名前を出す（系統ではなく）。名前がそのまま「どう働いているか」なので、
  // 変わったことに気づけるのはここ。
  badgeClass.textContent = view.name || '';
  barFill.style.width = `${Math.round(view.ratio * 100)}%`;

  // タブに出るのは**この子の名前**（＝いまの職）。Maite はプロダクトの名前なので出さない
  document.title = `${view.name} Lv${view.level}`;

  if (first) maybeShowBattle();

  /*
   * **見えているあいだだけ控えを取る。** これで「隠していた時間・落としていた
   * 時間」がそのまま留守になる ── 常駐アプリなので、起動してからでは測れない。
   */
  if (visible()) writeSeen(view);
}

/** ランダムなまばたき。等間隔にすると途端に機械に見える。 */
function scheduleBlink() {
  const delay = 2200 + Math.random() * 4200;
  setTimeout(() => {
    if (current && current.mood !== 'sleeping' && !gesture) {
      stage.classList.add('blink');
      setTimeout(() => stage.classList.remove('blink'), 130);
    }
    scheduleBlink();
  }, delay);
}

// 隠して出し直したときも「開いた」とみなす（Ctrl/Cmd+Shift+P で隠せる）
document.addEventListener('visibilitychange', () => {
  if (!visible()) return;
  maybeReportAway();
  maybeGreet();
  maybeReportTrip();
  maybeShowBattle();
});

window.aipet.onState(render);

/*
 * 名刺が書けたら、吹き出しで 1 回だけ言う。**どこに置いたか分からないのが
 * いちばん困る** ── ファイル名だけ出す（パスは長すぎて 200px に入らない）。
 */
window.aipet.onSaved((file) => {
  say(String(file).split(/[\\/]/).pop(), 'levelup', 5000);
  play('bounce');
});
scheduleBlink();
scheduleGesture();
