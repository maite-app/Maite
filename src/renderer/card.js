/*
 * 名刺の中身を書き込むだけ。**成長のルールも文言も、ここには一切書かない。**
 *
 * このページは見えない窓で開かれて、main が撮って PNG にする（main.js の
 * saveCard）。撮る側が「描き終わった」を知る必要があるので、最後に
 * `aipet:card-ready` を投げる。
 */

document.getElementById('pet-mount').innerHTML = window.AIPET_SVG;

const stage = document.getElementById('stage');
const card = document.getElementById('card');

/** オーバーレイと同じ付け方。**ここで条件を書かない**（appearance.js が決める）。 */
function paint(view) {
  const hue = view.hue === null || view.hue === undefined ? 220 : view.hue;
  const sat = view.hue === null || view.hue === undefined ? '12%' : '58%';
  stage.style.setProperty('--hue', String(hue));
  stage.style.setProperty('--sat', sat);
  card.style.setProperty('--card-hue', String(hue));

  const look = view.look || { marks: [], scale: null };
  for (const mark of look.marks) stage.classList.add(mark);
  stage.style.setProperty('--scale', String(look.scale || 1));

  // 昔の名前も（気分・しぐさ側の指定がこれを見ている）
  stage.classList.toggle('has-antenna', view.level >= 3);
  stage.classList.toggle('has-crown', view.level >= 10);
  stage.classList.toggle('has-aura', view.level >= 15);

  // 型の顔つき。**名刺でいちばん「その人の子」らしいのはここ**
  if (view.persona && view.persona.settled) {
    for (const mark of view.persona.marks) {
      stage.classList.add(mark === 'calm' || mark === 'wave' ? `r-${mark}` : `p-${mark}`);
    }
  }

  if (view.skin) stage.classList.add(`skin-${view.skin.id}`);

  document.getElementById('level').textContent = `Lv${view.level}`;
  document.getElementById('name').textContent = view.name || '';
  /*
   * 肩書きは**二つ名のほう**（persona.blurb）。`title` は職の名前そのものなので、
   * すぐ上の名前と同じ文字が 2 行 並ぶ（「錬金術師 / 錬金術師」になっていた）。
   */
  document.getElementById('title').textContent =
    (view.persona && view.persona.settled && view.persona.blurb) || view.className || '';

  /*
   * 数字は 4 つだけ。**貼ったときに読めるのは名前と位まで**なので、
   * ここは「よく見ると書いてある」の位置に置く ── 増やすと全部読めなくなる。
   *
   * 文言は view.text から引く（このページも素のスクリプト）。
   */
  const text = view.text || {};
  const rows = [
    [text['panel.dungeon'], view.dungeon && view.dungeon.floorText],
    [text['panel.skills'], String((view.skills || []).length)],
    [text['panel.achievements'], text['achievement.count']],
    [text['style.age'], view.profile && view.profile.rows.find((r) => r.id === 'age')?.value],
  ];
  const box = document.getElementById('rows');
  for (const [key, value] of rows) {
    if (!key || !value) continue;
    const k = document.createElement('span');
    k.textContent = key;
    const v = document.createElement('b');
    v.textContent = value;
    box.appendChild(k);
    box.appendChild(v);
  }
}

window.aipet.onCard((view) => {
  paint(view);
  /*
   * **1 枚ぶん待ってから合図する。** すぐ撮ると、フォントの差し替えと
   * クラスの反映が間に合わずに素の姿が写る（実際に一度 そうなった）。
   */
  requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => window.aipet.cardReady(), 120)));
});
