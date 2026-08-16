/* スマホ用の読み取り専用ダッシュボード。/api/state を叩いて描くだけ。 */

document.getElementById('pet-mount').innerHTML = window.AIPET_SVG;

const stage = document.getElementById('stage');
const title = document.getElementById('title');
const subtitle = document.getElementById('subtitle');
const meterFill = document.getElementById('meter-fill');
const meterInto = document.getElementById('meter-into');
const meterNext = document.getElementById('meter-next');
const dailyExp = document.getElementById('daily-exp');
const moodEl = document.getElementById('mood');
const traitsEl = document.getElementById('traits');
const skillsEl = document.getElementById('skills');
const achievementsEl = document.getElementById('achievements');
const achievementCount = document.getElementById('achievement-count');
const jobsEl = document.getElementById('jobs');
const jobsNote = document.getElementById('jobs-note');
const battlePanel = document.getElementById('battle-panel');
const battleHead = document.getElementById('battle-head');
const battleResult = document.getElementById('battle-result');
const battleLog = document.getElementById('battle-log');
const battleNote = document.getElementById('battle-note');
const battleImpression = document.getElementById('battle-impression');
const expeditionPanel = document.getElementById('expedition-panel');
const expeditionHead = document.getElementById('expedition-head');
const findsEl = document.getElementById('finds');
const barsEl = document.getElementById('bars');
const trailEl = document.getElementById('trail');
const trailTotal = document.getElementById('trail-total');
const trailNote = document.getElementById('trail-note');
const personaCode = document.getElementById('persona-code');
const personaName = document.getElementById('persona-name');
const personaBlurb = document.getElementById('persona-blurb');
const personaAxes = document.getElementById('persona-axes');
const personaNote = document.getElementById('persona-note');
const chasingEl = document.getElementById('chasing');
const ratesEl = document.getElementById('rates');
const hexGrid = document.getElementById('hex-grid');
const hexShape = document.getElementById('hex-shape');
const hexLabels = document.getElementById('hex-labels');
const hexRows = document.getElementById('hex-rows');
const dungeonPanel = document.getElementById('dungeon-panel');
const dungeonFloor = document.getElementById('dungeon-floor');
const gearEl = document.getElementById('dungeon-gear');
const dungeonFinds = document.getElementById('dungeon-finds');
const bossesEl = document.getElementById('bosses');
const bossesNote = document.getElementById('bosses-note');
const menuButton = document.getElementById('menu-open');
const drawer = document.getElementById('drawer');
const scrim = document.getElementById('scrim');
const drawerList = document.getElementById('drawer-list');
const recapPanel = document.getElementById('recap-panel');
const recapSpan = document.getElementById('recap-span');
const recapRows = document.getElementById('recap-rows');
const recapNote = document.getElementById('recap-note');
const drawerName = document.getElementById('drawer-name');
const drawerLevel = document.getElementById('drawer-level');

const MOODS = ['idle', 'working', 'thinking', 'calling', 'sleeping'];

/** スキンの id。付け替えのときに前のクラスを外すためだけに持つ。 */
const SKIN_IDS = ['plain', 'mono', 'ember', 'frost', 'dusk'];

/** 表示する traits と、その並び順。0 のものは出さない（育つほど行が増える）。 */
const TRAIT_KEYS = ['toolCalls', 'prompts', 'sessions', 'comebacks', 'failures', 'compacts', 'nightOwl'];

/*
 * **この画面に日本語（や英語）を書かない。** 文言はすべて view.text から引く
 * ── ここで文を組むと、同じ文がオーバーレイと 2 通りに育つ（src/core/i18n.js）。
 */
let TEXT = {};
let LANG = 'ja';

const say = (id) => TEXT[id] || '';

/** 動かない文字（見出し・ラベル）を、view が解いてきた言語に差し替える。 */
function applyText(view) {
  TEXT = view.text || {};
  LANG = view.lang || 'ja';
  for (const el of document.querySelectorAll('[data-t]')) {
    const value = TEXT[el.dataset.t];
    if (value) el.textContent = value;
  }
  document.documentElement.lang = LANG;
}

/**
 * 名前・値・注記の 1 行。
 *
 * **注記を必ず置けるようにする。** 「つまずいた割合 0%」「受けた指示 95」は、
 * 数字だけ出しても何を数えたのか読めない ── 根拠を出すのがこのアプリの芯
 * （DESIGN.md §8c）なので、行のほうに注記の場所を作っておく。
 */
function noteRow(label, value, note, sub) {
  const row = document.createElement('div');
  row.className = note || sub ? 'row has-note' : 'row';
  row.innerHTML = '<span></span><b></b>';
  row.firstChild.textContent = label;
  row.lastChild.textContent = value;
  if (sub) {
    const em = document.createElement('em');
    em.className = 'row-sub';
    em.textContent = sub;
    row.appendChild(em);
  }
  if (note) {
    const small = document.createElement('small');
    small.className = 'row-note';
    small.textContent = note;
    row.appendChild(small);
  }
  return row;
}

/** 桁区切り。見ている言語に合わせる。 */
function num(value) {
  return Number(value || 0).toLocaleString(LANG === 'ja' ? 'ja-JP' : 'en-US');
}

/**
 * 「8月10日」/「Aug 10」。年は出さない（この画面に出るのは直近だけ）。
 *
 * **日付だけは端末側で作る。** サーバー（Worker）のローカルは UTC なので、
 * 向こうで文字にすると日付の変わり目に 1 日ずれる（src/core/clock.js と同じ話）。
 */
function fmtDay(at) {
  const d = new Date(at);
  return LANG === 'ja'
    ? `${d.getMonth() + 1}月${d.getDate()}日`
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** view が `{day}` を空けて渡してきた文に、端末の暦で日付を入れる。 */
function withDay(line, at) {
  return line && at ? line.replace('{day}', fmtDay(at)) : line;
}

/* ------------------------------------------------------------------ *
 * 目次（左カラム）
 *
 * 節が 11 個まで増えて、縦スクロールだけでは端から端まで遠くなった。
 * **中身は隠さない** ── ここは飛ぶための目次で、節を畳んだり切り替えたり
 * はしない（隠すと「そこに何があるか」が消える）。
 * ------------------------------------------------------------------ */
function buildDrawer() {
  if (drawerList.children.length) return;
  let group = null;
  for (const section of document.querySelectorAll('[data-sec]')) {
    /*
     * **本文と同じ切れ目を目次にも入れる。** 11 行が同じ見た目で並んでいると、
     * 目次のほうが本文より読みにくくなる ── ページの束（data-group）を
     * そのまま持ち込めば、探す前に「どのあたりか」で当たりが付く。
     */
    if (section.dataset.group && section.dataset.group !== group) {
      group = section.dataset.group;
      const head = document.createElement('li');
      head.className = 'drawer-group';
      head.dataset.group = group;
      drawerList.appendChild(head);
    }
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = `#${section.dataset.sec}`;
    link.dataset.sec = section.dataset.sec;
    section.id = section.id || section.dataset.sec;
    link.addEventListener('click', (event) => {
      event.preventDefault();
      closeDrawer();
      section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    item.appendChild(link);
    drawerList.appendChild(item);
  }
}

function openDrawer() {
  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
  menuButton.setAttribute('aria-expanded', 'true');
  scrim.hidden = false;
}

function closeDrawer() {
  drawer.classList.remove('open');
  drawer.setAttribute('aria-hidden', 'true');
  menuButton.setAttribute('aria-expanded', 'false');
  scrim.hidden = true;
}

menuButton.addEventListener('click', () => {
  if (drawer.classList.contains('open')) closeDrawer();
  else openDrawer();
});
scrim.addEventListener('click', closeDrawer);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeDrawer();
});

/** 見出しの文字は view.text から。目次にも同じものを出す。 */
function labelDrawer(view) {
  buildDrawer();
  drawerName.textContent = view.name;
  drawerLevel.textContent = `Lv${view.level}`;
  for (const link of drawerList.querySelectorAll('a')) {
    link.textContent = say(`panel.${link.dataset.sec}`) || link.dataset.sec;
  }
  for (const head of drawerList.querySelectorAll('.drawer-group')) {
    head.textContent = say(`group.${head.dataset.group}`) || head.dataset.group;
  }
}

/* ------------------------------------------------------------------ *
 * しぐさ
 *
 * **オーバーレイと同じものを使う**（shared/gestures.js）。スマホ用に別の
 * 動きを書くと、同じ子が 2 通りの動き方をすることになる。
 *
 * 見ていない間は動かさない ── 電池を使うだけで、誰も見ていない。
 * ------------------------------------------------------------------ */
let gesture = null;
let gestureTimer = null;

function playGesture(id, ms) {
  const def = window.AIPET_GESTURES.byId(id);
  const duration = ms || (def ? def.ms : 1000);
  if (gesture) stage.classList.remove(`g-${gesture}`);
  gesture = id;
  stage.classList.add(`g-${id}`);
  setTimeout(() => {
    if (gesture !== id) return;
    stage.classList.remove(`g-${id}`);
    gesture = null;
  }, duration);
}

function scheduleGesture() {
  clearTimeout(gestureTimer);
  const delay = window.AIPET_GESTURES.nextDelay(Math.random);
  gestureTimer = setTimeout(() => {
    if (!document.hidden && current && !gesture) {
      const def = window.AIPET_GESTURES.pick(
        current.mood,
        {
          hasBattle: Boolean(current.battle),
          persona: current.persona && current.persona.marks,
          tool: current.lastTool,
        },
        Math.random,
      );
      // 戦闘のしぐさは、勝った日と負けた日で別のものにする
      if (def && def.id === 'battle') {
        playGesture(current.battle.winner === 'foe' ? 'battle-lose' : 'battle-win', 3400);
      } else if (def) {
        playGesture(def.id);
      }
    }
    scheduleGesture();
  }, delay);
}

/** いま出ている view。しぐさの選び方がこれを見る。 */
let current = null;

/*
 * **1 つの節が転けても、後ろを道連れにしない。**
 *
 * 前は 9 つの描画をそのまま順に呼んでいたので、`renderHexagon` の中で
 * 例外が出ると、そこから後ろ（迷宮・技・一戦・称号…）が丸ごと描かれずに
 * 終わっていた ── しかも**画面には見出しだけが残る**ので、壊れているのか
 * 中身が無いのかが見分けられない。実際 iPhone でそうなっていた。
 *
 * 節ごとに囲って、転けた節にはその場で理由を出す。**黙って消えるのがいちばん困る。**
 */
function section(key, fn, view) {
  try {
    fn(view);
  } catch (error) {
    const panel = document.querySelector(`[data-sec="${key}"]`);
    if (!panel) return;
    let note = panel.querySelector('.panel-error');
    if (!note) {
      note = document.createElement('p');
      note.className = 'panel-error';
      panel.appendChild(note);
    }
    note.textContent = `${error && error.message ? error.message : error}`;
  }
}

function render(view) {
  current = view;
  applyText(view);
  labelDrawer(view);
  for (const mood of MOODS) stage.classList.toggle(`mood-${mood}`, view.mood === mood);

  // キャラ（#stage）とページ全体（:root）の両方に系統色を流す
  const hue = view.hue ?? 220;
  const sat = view.hue === null || view.hue === undefined ? '12%' : '58%';
  for (const el of [stage, document.documentElement]) {
    el.style.setProperty('--hue', String(hue));
    el.style.setProperty('--sat', sat);
  }

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

  // 全角の空きは日本語のときだけ。英語に混ぜると、そこだけ間が抜けて見える
  const gap = LANG === 'ja' ? '　' : ' ';
  title.textContent = view.name ? `${view.name}${gap}Lv${view.level}` : `Lv${view.level}`;
  // 名前の下は**その名前の中身**。系統（学者・職人…）は色と相性に効くので
  // 「働き方」の節に置いてあり、ここでは肩書きを 2 つ並べない。
  const persona = view.persona;
  subtitle.textContent = persona && persona.settled
    ? persona.rhythmSettled
      ? `${persona.blurb} ── ${persona.rhythmBlurb}`
      : persona.blurb
    : say('persona.hint');

  meterFill.style.width = `${Math.round(view.ratio * 100)}%`;
  meterInto.textContent = say('level.into');
  meterNext.textContent = say('level.next');

  dailyExp.textContent = say('exp.today');
  moodEl.textContent = say('mood.now');

  traitsEl.innerHTML = '';
  for (const key of TRAIT_KEYS) {
    const value = view.traits?.[key] || 0;
    if (!value) continue;
    // 数え方を隣に書く。**「受けた指示 95」だけでは何を数えたのか読めない**
    traitsEl.appendChild(noteRow(say(`trait.${key}`), num(value), say(`note.${key}`)));
  }
  if (!traitsEl.children.length) {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = '<span></span><b>─</b>';
    row.firstChild.textContent = say('trait.none');
    traitsEl.appendChild(row);
  }

  section('trail', renderTrail, view);
  section('name', renderPersona, view);
  section('hexagon', renderHexagon, view);
  section('dungeon', renderDungeon, view);
  section('skills', renderSkills, view);
  section('battle', renderBattle, view);
  section('achievements', renderAchievements, view);
  section('expedition', renderExpedition, view);
  section('style', renderProfile, view);
  section('recap', renderRecap, view);

  // タブに出るのは**この子の名前**（＝いまの職）。Maite はプロダクトの名前なので出さない
  document.title = `${view.name} Lv${view.level}`;
}

/**
 * 型 ── 「どう使っているか」から出た性格。
 *
 * **根拠を必ず一緒に出す。** 「あなたは○○型です」だけだと占いになる。
 * 何を見てそう言っているか（調べものの割合、1 指示で動く回数）が横にあると、
 * 外れていても「そら そう見えるわな」で終われるし、当たっていれば効く。
 *
 * 一番下の但し書きも消さないこと ── 中身を読んでいないから面白いのであって、
 * 読んで当てているなら、それはただの盗み見になる。
 */
function renderPersona(view) {
  const persona = view.persona;
  personaAxes.innerHTML = '';
  if (!persona) return;

  const settled = persona.settled;
  // 読みだけ小さく添える。名前は読めないと呼べない（英語では読みが要らない）
  personaCode.textContent = settled && LANG === 'ja' ? persona.yomi : '';
  personaName.textContent = settled ? persona.title : say('persona.unsettled');

  // 「いつから今の名前か」「前は何だったか」。**知らない間に変わっていたことに、
  // 後から気づけるように。** 変わったのは働き方が変わったからで、それが下の軸に出ている。
  personaBlurb.textContent = withDay(persona.line, persona.since);

  for (const axis of persona.axes) {
    const row = document.createElement('div');
    row.className = 'axis';
    if (!axis.known) row.classList.add('unknown');
    // 5 軸目（リズム）は 4 文字の後ろに付くぶん。区切りを入れて別物に見せる
    if (axis.suffix) row.classList.add('suffix');

    const left = document.createElement('b');
    left.textContent = axis.left.label;
    left.className = axis.code === axis.left.code ? 'on' : '';

    const meter = document.createElement('i');
    const dot = document.createElement('span');
    // 目盛りの上の位置。真ん中が境目で、端に寄るほどその傾向が強い
    dot.style.left = `${Math.round(axis.position * 100)}%`;
    meter.appendChild(dot);

    const right = document.createElement('b');
    right.textContent = axis.right.label;
    right.className = axis.code === axis.right.code ? 'on' : '';

    /*
     * **寄っているほうの意味を先に、根拠を後に。**「籠る」だけでは何のことか
     * 分からないが、「手元を読んで、自分で叩く」が並べば読める。根拠（何を見て
     * そう言っているか）は消さない ── 無いと占いになる（DESIGN.md §8c）。
     */
    const meaning = document.createElement('u');
    meaning.className = 'axis-meaning';
    meaning.textContent = axis.meaning || '';

    const from = document.createElement('em');
    from.textContent = axis.from;

    row.append(left, meter, right, meaning, from);
    personaAxes.appendChild(row);
  }

  // この但し書きは消さない ── 中身を読んでいないから面白いのであって、
  // 読んで当てているなら、それはただの盗み見になる
  personaNote.textContent = say('persona.note');
}

/**
 * ここ 2 週間の働き方を、1 日 1 本の柱で出す。
 *
 * **数字ではなく形で見るためのもの。** 「今日 240 EXP」だけだと、それが多いのか
 * 少ないのか分からない ── 隣に先週が並んで初めて「今週は失速した」が読める。
 * 働かなかった日は空のまま置く（詰めると休んだ日が無かったことになる）。
 */
function renderTrail(view) {
  const trail = view.trail || [];
  trailEl.innerHTML = '';
  // 合計と一言（乗ってきた / 失速した）は view.js が組んである
  trailTotal.textContent = say('exp.trail');
  trailNote.textContent = say('trail.note');
  if (!trail.length) return;

  const today = trail[trail.length - 1].day;
  for (const entry of trail) {
    const cell = document.createElement('div');
    cell.className = 'trail-day';
    if (entry.day === today) cell.classList.add('is-today');
    if (!entry.exp) cell.classList.add('is-empty');
    cell.title = `${entry.day} · ${num(entry.exp)} EXP`;

    const bar = document.createElement('i');
    // 0 の日も 2px だけ残す ── 完全に消すと、休んだ日が列から抜けて見える
    bar.style.height = `${Math.round(6 + entry.ratio * 54)}px`;
    const label = document.createElement('em');
    label.textContent = entry.day.slice(-2).replace(/^0/, '');

    cell.append(bar, label);
    trailEl.appendChild(cell);
  }
}

/**
 * 渡り歩いた職。**なった順（古い順）に並べる ── 道として読む。**
 *
 * **まだなっていない職は出さない。** 出した瞬間に「16 個集める」チェックリストに
 * なり、集めるために働き方を変える話になる（DESIGN.md §5b）。
 * ここにあるのは「そういえば あの頃は罠師だった」だけ。
 */
function renderJobs(view) {
  const jobs = view.jobs || [];
  jobsEl.innerHTML = '';
  if (!jobs.length) {
    jobsNote.textContent = '';
    return;
  }

  jobsNote.textContent = `${say('jobs.count')} · ${say('jobs.note')}`;
  for (const job of jobs) {
    const chip = document.createElement('span');
    chip.className = 'job';
    // 「鍛冶師になった」から「になった」を落として、職の名前だけ並べる
    chip.textContent = job.label.replace(/になった$/, '').replace(/^Became an? /, '');
    chip.title = `${fmtDay(job.at)} · ${job.blurb}`;
    /*
     * **その職としての位。** 全体が Lv10 でも、錬金術師としては Lv3 のことがある
     * ── どの道をどれだけ歩いたかが、ここに出る。
     */
    const lv = document.createElement('u');
    lv.className = 'job-level';
    lv.textContent = job.levelText || '';
    const when = document.createElement('em');
    when.textContent = fmtDay(job.at);
    chip.append(lv, when);
    jobsEl.appendChild(chip);
  }
}

/** 獲った日付が入るので、獲得済みは新しい順。まだのものは薄く下に並べる。 */
function renderAchievements(view) {
  renderJobs(view);
  const got = view.achievements || [];
  const left = view.achievementsLocked || [];
  achievementCount.textContent = say('achievement.count');

  /*
   * **獲ったものは畳んでおく。** 26 個ぜんぶを説明つきで縦に並べると、それだけで
   * 画面の半分が称号になる（「実績も長すぎる」）。名前と日付だけを 2 列で敷いて、
   * **読みたいものだけ開く**（<details> なので、指 1 本で開いて勝手に閉じない）。
   *
   * まだのものは名前だけ、薄く、まとめて 1 か所に。説明も進捗も付けない
   * ── 付けた瞬間に集めに行くチェックリストになる（DESIGN.md §5b）。
   */
  achievementsEl.innerHTML = '';
  for (const item of got) {
    const row = document.createElement('details');
    row.className = item.rough ? 'achievement rough' : 'achievement';
    const head = document.createElement('summary');
    head.innerHTML = '<b></b><time></time>';
    head.children[0].textContent = item.label;
    head.children[1].textContent = fmtDay(item.at);
    const why = document.createElement('span');
    why.textContent = item.blurb;
    row.append(head, why);
    achievementsEl.appendChild(row);
  }

  if (left.length) {
    const rest = document.createElement('p');
    rest.className = 'achievement-rest';
    rest.textContent = `${say('badge.locked')} ── ${left.map((item) => item.label).join('・')}`;
    achievementsEl.appendChild(rest);
  }
}

/* ------------------------------------------------------------------ *
 * 六角形の能力値
 *
 * **上がったところは緑、下がったところは赤**を数秒だけ出す。
 * 数字が並んでいるだけだと、どこが動いたのか眺めていても分からない
 * ── 動いた頂点だけ光れば、見た瞬間に「速さが伸びた」が読める。
 *
 * 前回の値は画面の中だけで覚える（保存しない）。開き直せば消えるが、
 * ここで見たいのは「見ている間に何が動いたか」なので、それでいい。
 * ------------------------------------------------------------------ */
const HEX_R = 62;
const HEX_CX = 100;
const HEX_CY = 88;
/** 光らせておく時間。長いと、ずっと光っている画面になる。 */
const HEX_FLASH_MS = 6000;

const hexSeen = new Map();
const hexFlash = new Map();

function hexPoint(index, radius) {
  const angle = ((-90 + index * 60) * Math.PI) / 180;
  return [HEX_CX + Math.cos(angle) * radius, HEX_CY + Math.sin(angle) * radius];
}

function hexPolygon(scale) {
  const points = [];
  for (let i = 0; i < 6; i += 1) {
    const [x, y] = hexPoint(i, HEX_R * scale);
    points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return points.join(' ');
}

/** 子を全部外す。HTML でも SVG でも同じに効く（innerHTML は SVG で効かない）。 */
function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

function svg(tag, attrs) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  return el;
}

/** 目盛りの輪。真ん中の輪（0.56）が「同じレベルの平均」。 */
function drawHexGrid() {
  if (hexGrid.childNodes.length) return;
  for (const scale of [1, 0.78, 0.56, 0.32]) {
    hexGrid.appendChild(
      svg('polygon', { class: scale === 0.56 ? 'hex-ring is-average' : 'hex-ring', points: hexPolygon(scale) }),
    );
  }
  for (let i = 0; i < 6; i += 1) {
    const [x, y] = hexPoint(i, HEX_R);
    hexGrid.appendChild(
      svg('line', { class: 'hex-spoke', x1: HEX_CX, y1: HEX_CY, x2: x.toFixed(1), y2: y.toFixed(1) }),
    );
  }
}

function renderHexagon(view) {
  const axes = view.hexagon || [];
  if (!axes.length) return;
  drawHexGrid();

  const now = Date.now();
  const points = [];
  /*
   * **SVG の中身は innerHTML で消さない。**
   *
   * `innerHTML` は仕様上 Element に生えているが、WebKit は SVG 要素で
   * 実装していない ── iPhone だけ「見出しは出るのに中身が空」になっていた原因。
   * DOM で外せばどのブラウザでも同じに動く。
   */
  clear(hexLabels);
  hexRows.innerHTML = '';

  axes.forEach((axis, i) => {
    const [x, y] = hexPoint(i, HEX_R * axis.ratio);
    points.push(`${x.toFixed(1)},${y.toFixed(1)}`);

    // 前に見たときから動いたか。初回は覚えるだけで光らせない
    const before = hexSeen.get(axis.id);
    if (before !== undefined && before !== axis.value) {
      hexFlash.set(axis.id, { dir: axis.value > before ? 'up' : 'down', until: now + HEX_FLASH_MS });
    }
    hexSeen.set(axis.id, axis.value);
    const flash = hexFlash.get(axis.id);
    const moved = flash && flash.until > now ? flash.dir : '';

    // 頂点の外に 1 文字。長い名前を置くと図が潰れる
    const [lx, ly] = hexPoint(i, HEX_R + 17);
    const text = svg('text', {
      class: `hex-label ${moved}`.trim(),
      x: lx.toFixed(1),
      y: (ly + 4).toFixed(1),
      'text-anchor': 'middle',
    });
    text.textContent = axis.label;
    hexLabels.appendChild(text);

    /*
     * 図の頂点は 1 文字でないと潰れるが、**行のほうは読んで分かる名前**にする。
     * 値の下に「平均の 1.3 倍」を添える ── 「攻撃 45」だけでは、強いのか
     * 弱いのかが読めない。
     */
    const row = noteRow(axis.fullLabel || axis.label, num(axis.value), axis.note, axis.multText);
    if (moved) row.classList.add(moved);
    hexRows.appendChild(row);
  });

  hexShape.setAttribute('points', points.join(' '));
}

/**
 * ダンジョン ── 潜った深さと、勝手に着いた装備。
 *
 * **選ばせない。** 拾ったものを並べて選ばせると「良いものを狙って潜る」が
 * 生まれて、普段どおり仕事をするだけでよくなくなる（DESIGN.md §3）。
 */
function renderDungeon(view) {
  const dungeon = view.dungeon;
  if (!dungeon) return;

  dungeonFloor.textContent = dungeon.floorText;

  gearEl.innerHTML = '';
  for (const item of dungeon.equipped) {
    const row = document.createElement('div');
    row.className = `gear-item r-${item.rarity}`;
    row.innerHTML = '<i></i><b></b><em></em><span></span>';
    row.children[0].textContent = say(`hex.${item.slot}`);
    row.children[1].textContent = item.label;
    row.children[2].textContent = item.rarityLabel;
    // 枠をまたいで乗るぶんまで出す（「攻 +14% 速 +4%」）── 宿りで形が変わるのが
    // ここに見えないと、宿りは名前だけの飾りになる
    row.children[3].textContent = item.weight.map((w) => `${say(`hex.${w.slot}`)}+${w.percent}%`).join(' ');
    gearEl.appendChild(row);

    // 宿り。**効果まで必ず出す** ── 隠すと、外の攻略サイトで調べる遊びになる
    for (const imbue of item.imbues) {
      const line = document.createElement('div');
      line.className = 'imbue';
      line.innerHTML = '<b></b><span></span>';
      line.children[0].textContent = imbue.label;
      line.children[1].textContent = imbue.blurb;
      gearEl.appendChild(line);
    }
  }

  /*
   * 抜けてきた主。**新しい順**（いま どこにいるかから読む）。
   * まだ会っていない主は出さない ── 出した瞬間に「12 体そろえる」の話になる。
   */
  const bosses = dungeon.bosses || [];
  bossesNote.hidden = !bosses.length;
  bossesEl.innerHTML = '';
  for (const boss of bosses) {
    const row = document.createElement('div');
    row.className = 'boss';
    row.innerHTML = '<i></i><b></b><span></span>';
    row.children[0].textContent = String(boss.floor);
    row.children[1].textContent = boss.label;
    row.children[2].textContent = boss.blurb;
    bossesEl.appendChild(row);
  }

  dungeonFinds.innerHTML = '';
  for (const item of dungeon.recent) {
    // 位はクラスで渡すだけ。色は CSS 側（灰→緑→青→紫→金）
    const chip = document.createElement('span');
    chip.className = `find r-${item.rarity}`;
    chip.textContent = item.label;
    chip.title = `${item.rarityLabel} · ${item.percent}%`;
    const at = document.createElement('em');
    at.textContent = String(item.floor);
    chip.appendChild(at);
    dungeonFinds.appendChild(chip);
  }
}

/** 生えたスキルと、まだ生えていないものの「何をすれば生えるか」。 */
function renderSkills(view) {
  skillsEl.innerHTML = '';

  for (const skill of view.skills || []) {
    skillsEl.appendChild(skillRow(skill, false));
  }
  for (const hint of view.skillHints || []) {
    skillsEl.appendChild(skillRow(hint, true));
  }
}

/**
 * 「あと N 回」は技にだけ出す。何をすればこの子の形が変わるかは見えていい。
 * 実績には出さない（出した瞬間、振り返るものから狙うものになる）。
 */
function skillRow(skill, locked) {
  const row = document.createElement('div');
  row.className = locked ? 'skill locked' : 'skill';
  row.innerHTML = '<b></b><i></i><em></em><span></span>';
  row.children[0].textContent = skill.label;
  row.children[1].textContent = skill.tier ? '★'.repeat(skill.tier) : '─';
  row.children[2].textContent = skill.remainingText || '';
  /*
   * **生えた技には、効き目を数字で出す。**「素早さが上がる」だけでは本当に
   * 効いているのか確かめようがない ── この数字は battle.js が実際に使うものと
   * 同じ出どころ（skills.js の SKILL_POWER）。
   *
   * 説明文（blurb）は出さない。「夜の戦いで攻撃と素早さが上がる」と
   * 「未明の一戦だけ、攻撃と素早さ +6%」が並ぶと、同じことを 2 度読まされる。
   * まだ生えていない技は、効き目より**何をすれば生えるか**のほうが要る。
   */
  const effect = !locked && skill.effectText;
  row.children[3].textContent = locked ? skill.from : skill.effectText || skill.blurb;
  if (effect) row.children[3].className = 'is-effect';
  return row;
}

/** 合計値だけでは「何をしていたか」が読めないので、内訳と比率を出す。 */
function renderProfile(view) {
  const profile = view.profile;
  if (!profile) return;

  barsEl.innerHTML = '';
  for (const entry of profile.breakdown) {
    const row = document.createElement('div');
    row.className = 'bar';
    row.innerHTML = '<b></b><i><span></span></i><em></em>';
    row.children[0].textContent = entry.label;
    row.children[1].firstChild.style.width = `${Math.round(entry.share * 100)}%`;
    row.children[1].firstChild.style.background = `hsl(${entry.hue} 58% 58%)`;
    row.children[2].textContent = `${Math.round(entry.share * 100)}%`;
    barsEl.appendChild(row);
  }
  if (!profile.breakdown.length) {
    barsEl.textContent = say('style.none');
  }

  // 「開発スタイルが変われば見た目も変わる」の目安
  chasingEl.textContent = profile.chasing ? profile.chasing.text : '';

  ratesEl.innerHTML = '';
  for (const entry of profile.rows || []) {
    ratesEl.appendChild(noteRow(entry.label, entry.value, entry.note));
  }
}

/** 留守中の土産。強さには一切関係しない（DESIGN.md §5）。 */
function renderExpedition(view) {
  const trip = view.expedition;
  expeditionPanel.hidden = !trip;
  if (!trip) return;

  expeditionHead.textContent = trip.head;

  clear(findsEl);
  for (const find of trip.finds) {
    // 名前と、相棒の観察記録。**一言のほうが本体**（view.js の注記）
    const row = document.createElement('div');
    row.className = find.rare ? 'find rare' : 'find';
    const name = document.createElement('b');
    name.textContent = find.label;
    row.appendChild(name);
    if (find.note) {
      const note = document.createElement('small');
      note.textContent = find.note;
      row.appendChild(note);
    }
    findsEl.appendChild(row);
  }
}

/**
 * ひと月のふりかえり。**後ろ向きにしか出さない**（core/recap.js）── 目安も
 * 次の目標も前月との勝ち負けも無い。手を動かした日が 5 日に満たないうちは
 * view が null を返すので、節ごと出ない。
 */
function renderRecap(view) {
  const recap = view.recap;
  recapPanel.hidden = !recap;
  if (!recap) return;
  recapSpan.textContent = recap.span;
  recapNote.textContent = recap.note;
  clear(recapRows);
  for (const row of recap.rows) recapRows.appendChild(noteRow(row.label, row.value));
}

function renderBattle(view) {
  const battle = view.battle;

  if (!battle) {
    battleHead.textContent = say('battle.locked');
    battleResult.textContent = '';
    battleResult.className = 'battle-result';
    battleImpression.textContent = '';
    battleLog.innerHTML = '';
    battleNote.textContent = '';
    battlePanel.classList.add('empty');
    return;
  }

  battlePanel.classList.remove('empty');
  // 相手のレベルは出さない。「あと何レベルで勝てる」が分かると、その日が終わる
  battleHead.textContent = battle.head;
  battleResult.textContent = battle.result;
  battleResult.className = `battle-result ${battle.winner}`;
  battleImpression.textContent = battle.impression || '';

  battleLog.innerHTML = '';
  for (const line of battle.lines) {
    const li = document.createElement('li');
    li.textContent = line;
    battleLog.appendChild(li);
  }

  // 練習相手であることは必ず出す。黙ると信用が飛ぶ。
  // 「2 時間ごとに一戦」も添える ── 次を待てばいいと分かると、負けた回で終わらない
  battleNote.textContent = [battle.note, say('battle.every')].filter(Boolean).join(' · ');
}

/**
 * 同じ Wi-Fi の PC が配信している場合はトークン無し。
 * サーバー版は推測不能 URL がそのまま鍵なので、それを問い合わせに乗せる。
 */
// 問い合わせるときのことば。**返ってきた view.lang（LANG）とは別物**
// ── こちらは希望で、実際に何語で返ってきたかはサーバーが決める
const ASK_LANG = new URLSearchParams(location.search).get('lang') || navigator.language || 'ja';
// ことばは「URL の ?lang= → ブラウザ」。サーバー側は、送られてきた設定も見る
const API = window.AIPET_TOKEN
  ? `/api/state?token=${encodeURIComponent(window.AIPET_TOKEN)}&lang=${encodeURIComponent(ASK_LANG)}`
  : `/api/state?lang=${encodeURIComponent(ASK_LANG)}`;

/*
 * 聞きに行く間隔。**3 秒ごとに叩いていて、それでサーバーを落とした。**
 *
 * 1 回の読みで KV の `list` が 3 回走っていたので、**1 分あたり 60 回**。
 * KV の 1 日ぶんの `list` と `write` はどちらも 1,000 なので、
 * **画面を 20 分開いていればその日ぶんを使い切る** ── 使い切ると
 * `list` が投げて `/api/state` も `/ingest` も 500 に落ち、
 * **スマホから何も見えなくなる。** 実際にそうなった。
 *
 * ここで守るのは 3 つ：
 *
 * 1. **隠れている間は聞きに行かない。** 見ていない画面のために叩かない
 * 2. **変わらなければ間隔を空ける**（15 秒 → 最大 10 分）。開きっぱなしで
 *    忘れられたページが、1 日ぶんを使い切らない量に収まる ── **変わったら
 *    15 秒に戻る**ので、見ている最中に鈍くなることはない
 * 3. **変わったら、また詰める。** 見ている最中の反応は鈍らせない
 *
 * 育つのは分単位の話なので、15 秒でも十分すぎる（3 秒は、ただの無駄だった）。
 */
const POLL_MIN_MS = 15000;
const POLL_MAX_MS = 600000;
const POLL_BACKOFF = 1.5;

let pollWait = POLL_MIN_MS;
let pollTimer = null;
let lastSeenStamp = null;

/** 中身が変わったか。**畳んだ結果の要点だけ**を見る（全体を比べると重い）。 */
function stampOf(view) {
  return [view.exp, view.level, view.mood, view.lastTool, view.dungeon && view.dungeon.floor].join('|');
}

async function poll() {
  try {
    const res = await fetch(API, { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    const view = await res.json();
    const stamp = stampOf(view);
    // 変わっていなければ少しずつ間隔を空ける。変わったら詰め直す
    pollWait = stamp === lastSeenStamp ? Math.min(POLL_MAX_MS, pollWait * POLL_BACKOFF) : POLL_MIN_MS;
    lastSeenStamp = stamp;
    render(view);
    document.body.classList.remove('stale');
  } catch {
    // PC が寝た / Wi-Fi が切れた。古い数字を黙って出し続けない。
    // **叩き続けない** ── 落ちている相手を 3 秒ごとに突くのがいちばん良くない
    pollWait = Math.min(POLL_MAX_MS, pollWait * POLL_BACKOFF);
    document.body.classList.add('stale');
  }
  schedulePoll();
}

function schedulePoll() {
  clearTimeout(pollTimer);
  // 隠れている間は止める。戻ってきたときに聞き直す
  if (document.hidden) return;
  pollTimer = setTimeout(poll, pollWait);
}

poll();
scheduleGesture();
// 画面を戻したときは待たずに取り直す（間隔も詰め直す）
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clearTimeout(pollTimer);
    return;
  }
  pollWait = POLL_MIN_MS;
  poll();
});
