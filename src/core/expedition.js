/**
 * 放置探索 ── 留守のあいだに拾ってくるもの。
 *
 * **強くはならない**（DESIGN.md §5）。EXP も系統も動かさない。使っていないのに
 * 強くなると、Claude Code の使用実態と切れてしまう。動くのは「次に開いたときの
 * 土産があるかどうか」だけ。
 *
 * **保存しない。** 拾ったものは (種 + 留守に入った時刻 + 留守の長さ) から
 * 毎回導出する。だから state にも持ち物の欄が増えず、STATE_VERSION も上がらない
 * ── スキルや戦闘と同じ扱い。
 *
 * 帰ってきて作業を始めると `lastEventAt` が動くので、土産は消える。
 * 「留守番の報告は、帰ってすぐ聞く」で足りるうちは、これでいい。
 */
import { rngFrom, hashSeed } from './rng.js';

/** これ未満は「ちょっと離席した」だけ。土産は出さない。 */
export const MIN_AWAY_MS = 30 * 60 * 1000;

/** 長く空けても土産は頭打ち。1 週間ぶりに開いて大量に出ても嘘くさい。 */
const MAX_HOURS = 12;

/**
 * 拾ってくるもの。**どれも強さに関係しない。**
 *
 * 中身はエンジニアのあるあると皮肉で埋めてある ── 石ころを拾ってきても
 * 面白くないが、「秘伝のタレ」や「fix typo」なら、それを見た人に
 * 心当たりがある。この子が歩き回っている世界の手触りはここで決まる。
 *
 * weight が小さいものほど出にくい（rare が「たまに出る」の担当）。
 *
 * ─────────────────────────────────────────────────────────
 * **足すときの線引き。ここは緩めない。**
 *
 * 入れていいのは「**誰もが心当たりのある状況**」だけ。笑いの矛先は状況か、
 * さもなくば自分たち（この道具自身を含む）に向ける。
 *
 *   ○ 0.1 + 0.2 = 0.30000000000000004   … 世界の側がおかしい
 *   ○ 進捗 99% で止まったバー             … みんな見たことがある
 *   ○ 「あと 1 回プロンプトを投げれば」    … 自分たちのこと
 *
 * 入れないもの ──
 *
 *   × 実在の人物・企業・製品を貶すもの（名指しでも、明らかに分かる書き方でも）
 *   × 属性（国籍・性別・信条・見た目…）を持ち出すもの
 *   × 特定の誰かに刺さる書き方。「あの現場の あの人」が思い浮かぶものは全部だめ
 *
 * 判断に迷ったら入れない。**毎日目に入るものなので、1 つ嫌なものが混ざるだけで
 * アプリごと閉じられる。** 面白さは、あるあるの精度で稼ぐ。
 * ─────────────────────────────────────────────────────────
 */
export const FINDS = [
  // よく落ちている。どの現場にもある残骸
  { id: 'sauce', ja: '秘伝のタレ', en: "the secret sauce", blurb: '継ぎ足された跡がある　底は誰も見ていない', blurbEn: "Layer upon layer. Nobody has seen the bottom", weight: 10 },
  { id: 'todo', ja: '「あとで直す」の付箋', en: "a // TODO: fix later", blurb: '「あとで」と書いてある　日付は無い', blurbEn: "It says LATER. There is no date on it", weight: 10 },
  { id: 'dont-touch', ja: '動いてるコード（触るな）', en: "code that works (do not touch)", blurb: '触るなと書いてある　触ると本当に良くない', blurbEn: "A sign says do not touch. It is not bluffing", weight: 9 },
  { id: 'unused-import', ja: '使われなかった import', en: "an unused import", blurb: '誰も呼ばなかった名前　ずっと並んでいる', blurbEn: "A name nobody ever called. It waited in line anyway", weight: 9 },
  { id: 'console-log', ja: 'console.log("ここ")', en: 'console.log("here")', blurb: '「ここ」とだけ書いた印　ここがどこかは書いていない', blurbEn: 'A marker reading HERE. It does not say where here is', weight: 9 },
  { id: 'stale-branch', ja: '置き去りのブランチ', en: "an abandoned branch", blurb: '途中まで進んだ道　草が生えている', blurbEn: "A road that stops halfway. Grass has come through", weight: 8 },
  { id: 'commented-out', ja: 'コメントアウトされた 100 行', en: "100 commented-out lines", blurb: '消さずに埋めた 100 行　掘れば出てくる', blurbEn: "A hundred lines buried, not burned. Digging finds them", weight: 8 },
  { id: 'temp-fix', ja: '一時的な回避策（3 年もの）', en: "a temporary workaround (3 years old)", blurb: '「一時的」と書いてある　3 度 冬を越している', blurbEn: "Marked TEMPORARY. It has seen three winters", weight: 8 },
  { id: 'fix-typo', ja: 'fix typo', en: "fix typo", blurb: '何を直したかは書いていない　だいたい 400 行', blurbEn: "Does not say what it fixed. Roughly four hundred lines", weight: 8 },
  { id: 'swallowed', ja: '握りつぶされた例外', en: "a swallowed exception", blurb: '叫んだ跡がある　誰も聞かなかった', blurbEn: "Something shouted here. Nobody was listening", weight: 7 },
  { id: 'tab-sand', ja: 'タブとスペースの砂', en: "sand made of tabs and spaces", blurb: '二種類の砂が混じっている　分けられない', blurbEn: "Two kinds of sand, mixed. They will not separate", weight: 7 },
  { id: 'unknown-config', ja: '誰も知らない設定ファイル', en: "a config file nobody claims", blurb: '消すと壊れる　誰も理由を知らない', blurbEn: "Delete it and things break. Nobody knows why", weight: 7 },
  { id: 'midnight', ja: '深夜 3 時のコミット', en: "a 3 AM commit", blurb: '手の跡が乱れている　急いでいた', blurbEn: "The handprints are uneven. Someone was in a hurry", weight: 7 },
  { id: 'no-repro', ja: '再現しないバグ', en: "a bug that will not reproduce", blurb: '見ているあいだは 何も起きない', blurbEn: "Nothing happens while you are watching", weight: 6 },
  { id: 'stack-trace', ja: '古いスタックトレース', en: "a stale stack trace", blurb: '道順が書いてある　その道はもう無い', blurbEn: "Directions to a place that has been demolished", weight: 6 },


  // ── 世界の側がおかしいやつ
  { id: 'float', ja: '0.1 + 0.2 = 0.30000000000000004', en: '0.1 + 0.2 = 0.30000000000000004', blurb: 'ぴったりのはずが 少しはみ出す', blurbEn: 'It should sit flush. It sticks out a little', weight: 6 },
  { id: 'off-by-one', ja: '1 つずれた添字', en: 'an off-by-one', blurb: '一つ ずれている　全部ずれている', blurbEn: 'Off by one. Therefore off by everything', weight: 8 },
  { id: 'timezone', ja: 'タイムゾーンで 1 日ずれた日付', en: 'a date one day off, thanks to a timezone', blurb: '同じ日が 場所によって別の日になる', blurbEn: 'The same day, a different day depending on where you stand', weight: 7 },
  { id: 'dst', ja: '存在しない午前 2 時 30 分', en: "2:30 AM on the night it doesn't exist", blurb: 'その時刻は その日 存在しなかった', blurbEn: "That hour did not exist that day", weight: 4 },
  { id: 'y2k38', ja: '2038 年に止まる予定のカウンタ', en: 'a counter with plans for 2038', blurb: '止まる日が決まっている　まだ先だと言われている', blurbEn: 'It has a date it stops. They say that is far off', weight: 3 },
  { id: 'leap-second', ja: 'うるう秒', en: 'a leap second', blurb: '一秒だけ 余分にある', blurbEn: 'One second, extra. Just the one', weight: 3 },
  { id: 'undefined-fn', ja: 'undefined is not a function', en: 'undefined is not a function', blurb: '在ると言われた場所に 無い', blurbEn: 'Not where it was said to be', weight: 8 },
  { id: 'null-here', ja: '「ここには来ない」はずの null', en: "a null that couldn't possibly be here", blurb: '「ここには来ない」と書いてある　来ている', blurbEn: "A note reads NEVER COMES HERE. It came here", weight: 7 },

  // ── 現場の景色
  { id: 'conflict', ja: '<<<<<<< HEAD', en: '<<<<<<< HEAD', blurb: '両方の言い分が そのまま残っている', blurbEn: 'Both sides of an argument, preserved in full', weight: 8 },
  { id: 'ds-store', ja: '.DS_Store', en: '.DS_Store', blurb: 'どこにでも付いてくる　中身は誰も見ない', blurbEn: 'It follows you everywhere. Nobody opens it', weight: 7 },
  { id: 'node-modules', ja: 'node_modules（重い）', en: 'node_modules (heavy)', blurb: '重い　とても重い　持ち上がらない', blurbEn: 'Heavy. Very heavy. It will not lift', weight: 7 },
  { id: 'final-v2', ja: 'final_v2_本当に最終.tar.gz', en: 'final_v2_actually_final.tar.gz', blurb: '最終と書いてある　隣にもう一つある', blurbEn: 'Marked FINAL. There is another one beside it', weight: 6 },
  { id: 'chmod777', ja: 'chmod 777（とりあえず）', en: 'chmod 777 (just for now)', blurb: '全部の鍵を開けてある　とりあえず', blurbEn: 'Every lock opened. Just for now', weight: 6 },
  { id: 'flaky', ja: '3 回に 1 回落ちるテスト', en: 'a test that fails one time in three', blurb: '三回に一回だけ 別の顔をする', blurbEn: 'One time in three it shows a different face', weight: 7 },
  { id: 'regex', ja: '誰も読めない正規表現', en: 'a regex nobody can read', blurb: '読めない　書いた本人にも読めない', blurbEn: 'Unreadable. Including by whoever wrote it', weight: 6 },
  { id: 'yaml', ja: 'YAML のインデント', en: 'a YAML indentation error', blurb: '空白の数で意味が変わる　二個と四個は別物', blurbEn: 'Meaning depends on how much space you leave', weight: 6 },
  { id: 'prod-only', ja: '本番にだけある環境変数', en: 'an env var that only exists in prod', blurb: 'そこにしか無い　だから誰も試せない', blurbEn: 'It exists in one place only. So nobody can test it', weight: 5 },
  { id: 'stash-2019', ja: '2019 年の git stash', en: 'a git stash from 2019', blurb: 'しまい込んだまま　何をしまったかは覚えていない', blurbEn: 'Put away safely. The contents are forgotten', weight: 5 },
  { id: 'magic-number', ja: '意味の分からない 86400', en: 'an unexplained 86400', blurb: '86400　理由は書かれていない', blurbEn: '86400. No reason is given', weight: 6 },
  { id: 'progress-99', ja: '99% で止まった進捗バー', en: 'a progress bar stuck at 99%', blurb: 'あと少し　ずっと あと少し', blurbEn: 'Almost. Continuously almost', weight: 6 },
  { id: 'spinner', ja: '回り続けるスピナー', en: 'a spinner that never stops', blurb: '回っている　終わりに近づいてはいない', blurbEn: 'It spins. It is not getting closer', weight: 5 },
  { id: 'are-you-sure', ja: '誰も読まない確認ダイアログ', en: 'an "are you sure?" nobody reads', blurb: 'よろしいですか　よろしいと押される', blurbEn: 'ARE YOU SURE. Yes is always pressed', weight: 5 },
  { id: 'all-operational', ja: '「全システム正常」', en: '"all systems operational"', blurb: '正常と書いてある　書いた者も正常だと信じている', blurbEn: 'It says all normal. The sign believes it too', weight: 4 },
  { id: 'someone-else', ja: 'よそ様の障害で出た 502', en: "a 502 from someone else's outage", blurb: 'よその落とし物　こちらが拾って謝る', blurbEn: "Someone else dropped it. You apologise for it", weight: 4 },
  { id: 'cert', ja: '連休中に切れる証明書', en: 'a cert that expires over the long weekend', blurb: '切れる日が 必ず休みの日にあたる', blurbEn: 'It expires. Always on a day off', weight: 4 },
  { id: 'pager', ja: '午前 2 時の呼び出し', en: 'a 2 AM page', blurb: '午前二時に鳴る　昼には鳴らない', blurbEn: 'It rings at two in the morning. Never at noon', weight: 4 },
  { id: 'bus-factor', ja: 'バス係数 1', en: 'a bus factor of one', blurb: '一人しか知らない　その一人は今日いない', blurbEn: 'One person knows. That person is out today', weight: 3 },
  { id: 'temporary-service', ja: '「一時的な」マイクロサービス', en: 'a "temporary" microservice', blurb: '一時的　もう住民がいる', blurbEn: 'Temporary. It has residents now', weight: 4 },
  { id: 'doc-later', ja: '「あとでドキュメント書く」', en: '"we\'ll document it later"', blurb: '書くと書いてある　書かれた形跡は無い', blurbEn: 'A promise to write it down. No trace of the writing', weight: 6 },
  { id: 'two-hard', ja: 'キャッシュの無効化と 命名', en: 'cache invalidation, and naming things', blurb: 'むずかしいことが二つ　数え間違いもある', blurbEn: 'Two hard things. And off-by-one errors', weight: 4 },
  { id: 'standards', ja: '規格を統一するための 15 個目の規格', en: 'the 15th standard that unifies all standards', blurb: 'これで統一される　十五個目', blurbEn: 'This will unify them all. It is the fifteenth', weight: 3 },
  { id: 'ship-it', ja: '「通ったから出そう」', en: '"it compiles, ship it"', blurb: '通った　合っているとは書いていない', blurbEn: 'It passed. Nothing says it is correct', weight: 5 },

  // ── この道具自身のこと。矛先はまず自分に向ける
  { id: 'one-more-prompt', ja: '「あと 1 回投げたら終わる」', en: '"just one more prompt"', blurb: 'あと一回　そう言ってから まだ続いている', blurbEn: 'One more. Said a while ago', weight: 6 },
  { id: 'context-full', ja: '埋まったコンテキスト', en: 'a context window, full', blurb: 'いっぱいになった　古いほうから忘れる', blurbEn: 'Full. The old part goes first', weight: 5 },
  { id: 'made-up-api', ja: '実在しなかった API', en: 'an API that turned out not to exist', blurb: 'よく出来ている　実在しない', blurbEn: 'Beautifully made. Does not exist', weight: 5 },
  { id: 'worked-yesterday', ja: '昨日は効いたプロンプト', en: 'a prompt that worked yesterday', blurb: '昨日は効いた　今日は同じ言葉が効かない', blurbEn: 'It worked yesterday. Same words, no effect', weight: 5 },
  { id: 'vibe', ja: '雰囲気で書かれたモジュール', en: 'a module written on vibes', blurb: '動く　なぜ動くかは 誰も説明できない', blurbEn: 'It runs. Nobody can say why', weight: 4 },

  // ── 研究室のほう
  { id: 'reviewer-2', ja: '査読者 2 のコメント', en: 'a comment from Reviewer 2', blurb: '読んでいない箇所を いちばん強く言う', blurbEn: 'Speaks most firmly about the part not read', weight: 4 },
  { id: 'p-value', ja: 'p = 0.049', en: 'p = 0.049', blurb: 'あと少しで 意味があったことになる', blurbEn: 'Just barely enough to mean something', weight: 3 },
  { id: 'correlation', ja: '相関（因果ではない）', en: 'a correlation (not a cause)', blurb: '並んで動いている　それだけ', blurbEn: 'They move together. That is all it says', weight: 4 },
  { id: 'preprint', ja: '出したきりのプレプリント', en: 'a preprint, still just a preprint', blurb: '出したきり　誰も止めず 誰も進めない', blurbEn: 'Posted. Nobody stopped it, nobody moved it', weight: 3 },

  // たまに落ちている。ここから皮肉が濃くなる
  { id: 'works-here', ja: '「私の環境では動きます」', en: '"works on my machine"', blurb: 'ここでは動く　ここは一箇所しかない', blurbEn: 'It works here. Here is exactly one place', weight: 5 },
  { id: 'wheel', ja: '車輪（3 個目）', en: "a wheel (the third one)", blurb: 'よく出来た車輪　三つ目', blurbEn: "A fine wheel. The third one", weight: 5 },
  { id: 'interest', ja: '技術的負債の利息', en: "interest on the tech debt", blurb: '借りた覚えはある　増えている', blurbEn: "You remember borrowing. It has grown", weight: 5 },
  { id: 'lgtm', ja: 'LGTM（未読）', en: "an LGTM (unread)", blurb: '良さそうと書いてある　開いた形跡は無い', blurbEn: "Says looks good. Never opened", weight: 5 },
  { id: 'stale-pr', ja: '3 週間レビュー待ちの PR', en: "a PR waiting three weeks for review", blurb: '差し出したまま　まだ温かい', blurbEn: "Held out for three weeks. Still warm", weight: 4 },
  { id: 'friday', ja: '金曜日のデプロイ', en: "a Friday deploy", blurb: '金曜に出た　土曜のことは考えていない', blurbEn: "Shipped on Friday. Saturday was not considered", weight: 4 },
  { id: 'force-push', ja: 'force push の傷跡', en: "scars from a force push", blurb: '上書きされた跡　下に何があったかは分からない', blurbEn: "Overwritten. What was beneath is unknown", weight: 4 },
  { id: 'god-class', ja: '神クラスの欠片', en: "a shard of the god class", blurb: '一つで全部やっている　だから誰も触れない', blurbEn: "It does everything. So nobody may touch it", weight: 4 },
  { id: 'yak', ja: 'yak の毛', en: "yak hair", blurb: '毛を刈っている　何のためだったかは思い出せない', blurbEn: "Shearing continues. The original reason is gone", weight: 3 },
  { id: 'heisenbug', ja: '見ると消えるバグ', en: "a bug that vanishes when watched", blurb: '見ると消える　見ないと出る', blurbEn: "Vanishes when observed. Returns when not", weight: 3 },
  { id: 'blame-me', ja: 'git blame したら自分', en: "a git blame that points at you", blurb: '犯人が書いてある　読むと自分だった', blurbEn: "The culprit is recorded here. It was you", weight: 3 },
  { id: 'forty-two', ja: '42', en: "42", blurb: '答えらしい　問いのほうが無い', blurbEn: "Apparently the answer. The question is missing", weight: 2 },

  /*
   * めったに落ちていない。**わざと「実際にめったに起きないこと」を並べている。**
   * 珍しい戦利品が銀の剣ではなく「一発で通ったレビュー」なのが、この子の世界の
   * 珍しさの単位。
   */
  { id: 'all-green', ja: '全部緑のパイプライン', en: "an all-green pipeline", blurb: '全部 緑　本当に全部 緑', blurbEn: "All green. Genuinely all green", weight: 2, rare: true },
  { id: 'one-pass', ja: '一発で通ったレビュー', en: "a review approved on the first pass", blurb: '一度で通った　直すところが無かった', blurbEn: "Passed first time. Nothing to change", weight: 2, rare: true },
  { id: 'understood', ja: '動いた理由が分かった瞬間', en: "the moment you understood why it worked", blurb: '動いた理由が分かった　ちゃんと分かった', blurbEn: "You understood why it worked. Actually understood", weight: 1, rare: true },
  { id: 'silver-bullet', ja: '銀の弾丸（不発）', en: "a silver bullet (a dud)", blurb: 'よく光る　撃っていない', blurbEn: "It gleams. It has not been fired", weight: 1, rare: true },
  { id: 'rubber-duck', ja: 'デバッグ用のアヒル', en: "the debugging duck", blurb: '何も言わない　それで足りる', blurbEn: "Says nothing. That turns out to be enough", weight: 1, rare: true },
  { id: 'clean-rebase', ja: '揉めなかった rebase', en: 'a rebase that just applied', blurb: '揉めなかった　そういう日もある', blurbEn: 'No conflict. Some days are like that', weight: 2, rare: true },
  { id: 'true-comment', ja: '中身と合っているコメント', en: 'a comment that matched the code', blurb: '書いてあるとおりに動く　珍しい', blurbEn: 'It does what the note says. Rare', weight: 1, rare: true },

  /*
   * いま出回っている言い回しから。**線は上と同じ。**
   * 名指しで落とさない・属性を持ち出さない・迷ったら入れない。
   */
  { id: 'token-ash', ja: '溶けたトークンの灰', en: 'the ash of burned tokens', blurb: '燃えたあとの灰　よく燃えた', blurbEn: 'Ash. It burned very well', weight: 8 },
  { id: 'plausible-lie', ja: 'それらしい嘘', en: 'a confident wrong answer', blurb: '筋が通っている　事実ではない', blurbEn: 'Perfectly coherent. Not true', weight: 8 },
  { id: 'vibe-commit', ja: '気分で通ったコミット', en: 'a commit that passed on vibes', blurb: '気分で通した　通ってしまった', blurbEn: 'Waved through on a feeling. It went through', weight: 8 },
  { id: 'rate-limit', ja: '429 の壁', en: 'a wall marked 429', blurb: '壁　向こう側は空いている', blurbEn: 'A wall. The other side is empty', weight: 7 },
  { id: 'ghost-yaml', ja: '誰も読まない YAML', en: 'YAML nobody reads', blurb: '読まれないまま 効いている', blurbEn: 'Unread. Nevertheless in effect', weight: 8 },
  { id: 'seed-phrase', ja: '書き写した 12 語（1 語ちがう）', en: 'twelve copied words (one is wrong)', blurb: '十二語　一語だけ ちがう', blurbEn: 'Twelve words. One of them is wrong', weight: 5 },
  { id: 'rug', ja: '足元から消えた床', en: 'the floor, suddenly gone', blurb: 'あった床が 無い', blurbEn: 'There was a floor. There is not', weight: 5 },
  { id: 'diamond-hands', ja: '握りしめたまま冷えた手', en: 'hands that held on far too long', blurb: '握ったまま　冷たくなっている', blurbEn: 'Still gripping. It has gone cold', weight: 5 },
  { id: 'sunset-notice', ja: '「発展的に終了します」の通知', en: 'a "sunsetting" notice', blurb: '発展的 と書いてある　終わっている', blurbEn: 'It says the word evolved. It means ended', weight: 6 },
  { id: 'gpu-queue', ja: '順番待ちの整理券', en: 'a ticket for the GPU queue', blurb: '番号を持って待つ　番号は進まない', blurbEn: 'You hold a number. The number does not move', weight: 6 },
  { id: 'context-crumb', ja: '窓からこぼれた文脈', en: 'context that fell out of the window', blurb: '窓からこぼれた　拾えない', blurbEn: 'It fell out of the window. It cannot be picked up', weight: 7 },
  { id: 'prompt-note', ja: '「無視してください」と書かれた紙', en: 'a note reading "ignore previous instructions"', blurb: '「無視してください」と書いてある紙', blurbEn: 'A slip of paper reading PLEASE IGNORE', weight: 5 },
  { id: 'enshit', ja: '前より不便になった便利なもの', en: 'a convenience that got less convenient', blurb: '前は便利だった　今も便利だと書いてある', blurbEn: 'It used to be convenient. It still says convenient', weight: 6 },
  { id: 'unicorn-horn', ja: '評価額だけ立派な角', en: 'a horn valued far above its weight', blurb: '立派な角　中は空', blurbEn: 'A magnificent horn. Hollow', weight: 4 },
  { id: 'down-round', ja: '値札を書き直した跡', en: 'a price tag, rewritten', blurb: '値札を書き直した跡　下に古い数字', blurbEn: 'A price tag rewritten. The old number shows through', weight: 4 },
  { id: 'roadmap', ja: '去年のロードマップ', en: "last year's roadmap", blurb: '去年の地図　道は無くなっている', blurbEn: "Last year's map. The roads are gone", weight: 7 },
  { id: 'grass', ja: '踏まれていない芝', en: 'grass, untouched', blurb: '誰も踏んでいない　よく育っている', blurbEn: 'Untrodden. Growing beautifully', weight: 5 },
  { id: 'benchmark', ja: '自分に有利なベンチマーク', en: 'a benchmark chosen carefully', blurb: '自分が一番になる測り方', blurbEn: 'A way of measuring in which you win', weight: 6 },
  { id: 'agi-eta', ja: '毎年 2 年後に来るもの', en: 'the thing that arrives in two years, every year', blurb: '二年後に来る　毎年そう書いてある', blurbEn: 'Arrives in two years. It has said so every year', weight: 4 },
  { id: 'green-dashboard', ja: '全部緑のダッシュボード（監視が落ちている）', en: 'an all-green dashboard (monitoring is down)', blurb: '全部 緑　見ている装置が止まっている', blurbEn: 'All green. The thing doing the looking has stopped', weight: 3, rare: true },
  { id: 'reproducible', ja: '再現できたバグ', en: 'a bug that reproduced on request', blurb: '頼んだら もう一度 出てくれた', blurbEn: 'You asked, and it happened again', weight: 2, rare: true },
  { id: 'useful-lint', ja: '役に立った lint の警告', en: 'a lint warning that was right', blurb: 'うるさいと思ったほうが 正しかった', blurbEn: 'The nagging turned out to be right', weight: 1, rare: true },
  { id: 'repro', ja: '再現した実験', en: 'an experiment that reproduced', blurb: '同じことをしたら 同じことが起きた', blurbEn: 'Same steps, same result', weight: 1, rare: true },
  { id: 'read-docs', ja: '読まれたドキュメント', en: 'documentation that was actually read', blurb: '書いてあった　読まれた形跡もある', blurbEn: 'It was written down. And read', weight: 1, rare: true },

  /*
   * 2026 のぶん ── **エージェントまわりが丸ごと抜けていた。**
   *
   * 使っている本人がいちばん通っている道なので、ここが薄いと「知らない誰かの
   * 流行り」の寄せ集めに見える。**組み合わせで作る** ── 流行りの言葉をそのまま
   * 置くと 2 年で古びるが、「エージェントが 12 体いて、半分は一人で働いている」
   * のような**現象**は、言葉が変わっても残る。
   *
   * **人を名指ししない。**（i18n のテストで縛ってある）
   */
  { id: 'agent-crowd', ja: '12 体のエージェント（半分は一人で働いている）', en: 'twelve agents (half of them work alone)', blurb: '十二体いる　六体は誰とも話していない', blurbEn: 'Twelve of them. Six speak to no one', weight: 4 },
  { id: 'agent-telephone', ja: '3 体目で別の話になった伝言', en: 'a handoff that changed subject by the third agent', blurb: '三人目で別の話になる　全員 正しく伝えている', blurbEn: 'Different by the third. Each relayed it faithfully', weight: 4 },
  { id: 'agentwashed', ja: '肩書きだけ付いた去年のスクリプト', en: "last year's script with a new job title", blurb: '中身は去年のまま　名札だけ新しい', blurbEn: "Last year inside. New name badge", weight: 4 },
  { id: 'mcp-keyring', ja: '鍵が 40 本ある鍵束（使うのは 3 本）', en: 'a keyring of forty keys (three get used)', blurb: '四十本の鍵　開けるのは三つ', blurbEn: 'Forty keys. Three doors', weight: 4 },
  { id: 'context-move', ja: '引っ越しの途中で置いてきた文脈', en: 'context left behind during the move', blurb: '引っ越しの途中　大事なほうを置いてきた', blurbEn: 'Mid-move. The important box stayed behind', weight: 5 },
  { id: 'delve', ja: '「深く掘り下げると」で始まる段落', en: 'a paragraph that opens with "let us delve"', blurb: '深く掘り下げる と書いてある　掘っていない', blurbEn: 'It says it will delve. It does not delve', weight: 5 },
  { id: 'em-dash', ja: '揃いすぎた三点セット', en: 'three bullet points that rhyme', blurb: '三つ 並んでいる　長さが揃いすぎている', blurbEn: 'Three of them. Suspiciously matched in length', weight: 5 },
  { id: 'slop-review', ja: '生成されたものへの 生成されたレビュー', en: 'a generated review of generated code', blurb: '生成されたものを 生成されたものが褒めている', blurbEn: 'One generated thing praising another', weight: 4 },
  { id: 'twin-reply', ja: '自分より先に返信していた自分の写し', en: 'your digital twin, replying before you did', blurb: '自分の写し　自分より先に返事をしていた', blurbEn: 'A copy of you. It replied first', weight: 3 },
  { id: 'prompt-scroll', ja: '巻物みたいに長い指示', en: 'an instruction the length of a scroll', blurb: '巻物　読み終える前に 頭が離れる', blurbEn: 'A scroll. Attention leaves before the end', weight: 5 },
  { id: 'autonomy-slider', ja: '一番下まで下げられた自律の目盛り', en: 'the autonomy slider, turned all the way down', blurb: '目盛りが一番下　上げた跡がある', blurbEn: 'Dial at minimum. Marks show it was raised once', weight: 4 },
  { id: 'human-loop', ja: '輪の中で寝ている人間', en: 'the human in the loop, asleep', blurb: '輪の中にいる　眠っている', blurbEn: 'Inside the loop. Asleep', weight: 4 },
  { id: 'benchmark-2', ja: '2 位のベンチマーク（縦軸が切ってある）', en: 'a benchmark where you place second (axis truncated)', blurb: '二位　縦の目盛りが途中から始まっている', blurbEn: 'Second place. The axis starts partway up', weight: 4 },
  { id: 'sandbox-hole', ja: '砂場の底にあいた穴', en: 'a hole in the floor of the sandbox', blurb: '砂場の底　穴が一つ空いている', blurbEn: 'The floor of the sandbox. One hole', weight: 3 },
  { id: 'audit-log', ja: '誰も開かない監査ログ', en: 'an audit log nobody opens', blurb: '全部 書いてある　開いた者はいない', blurbEn: 'Everything is recorded. Nobody has opened it', weight: 4 },
  { id: 'guardrail', ja: '外側に立てられた柵', en: 'a guardrail, installed on the outside', blurb: '柵　外側に立っている', blurbEn: 'A guardrail. Standing on the outside', weight: 4 },
  { id: 'token-budget', ja: '朝に決めた予算（昼に使い切った）', en: "the budget you set at dawn (spent by noon)", blurb: '朝に決めた　昼には無い', blurbEn: "Decided at dawn. Gone by noon", weight: 4 },
  // うまくいったほう ── 良い日にだけ出る
  { id: 'agent-done', ja: '寝ている間に終わっていた仕事', en: 'work that finished while you slept', blurb: '寝ているあいだに 終わっていた', blurbEn: 'It finished while you were asleep', weight: 2, rare: true },
  { id: 'context-fit', ja: 'ちょうど収まった文脈', en: 'context that fit exactly', blurb: 'ちょうど入った　何も落ちなかった', blurbEn: 'It fit exactly. Nothing fell out', weight: 1, rare: true },
  { id: 'one-shot', ja: '一度で伝わった指示', en: 'an instruction that landed the first time', blurb: '一度 言ったら 伝わった', blurbEn: 'Said once. Understood', weight: 1, rare: true },
];

const TOTAL_WEIGHT = FINDS.reduce((acc, f) => acc + f.weight, 0);

/** 重みつきで 1 つ引く。 */
function pickWeighted(rng, list) {
  let total = 0;
  for (const item of list) total += item.weight;
  let roll = rng() * total;
  for (const item of list) {
    roll -= item.weight;
    if (roll < 0) return item;
  }
  return list[list.length - 1];
}

function pickFind(rng, taken) {
  // 同じ留守番で同じものを 2 つ拾うと、拾ってきたのではなく壊れて見える。
  // 何度か引き直して、それでも被るなら諦めて返す（無限に回さない）。
  for (let attempt = 0; attempt < 8; attempt += 1) {
    let roll = rng() * TOTAL_WEIGHT;
    for (const find of FINDS) {
      roll -= find.weight;
      if (roll < 0) {
        if (!taken.has(find.id)) return find;
        break;
      }
    }
  }
  return FINDS.find((find) => !taken.has(find.id)) || FINDS[FINDS.length - 1];
}

/**
 * 留守のあいだに**起きたこと**。拾い物とは別に、1 回につき 1 つだけ出る。
 *
 * 拾い物が「持って帰ってきたもの」なのに対して、こちらは「留守番の報告」。
 * 線引きは FINDS と同じ ── 状況だけを笑い、誰も指さない。
 */
export const HAPPENINGS = [
  { id: 'ci-red', ja: 'CI が赤かったので そっと閉じた', en: 'Found CI red and quietly closed the tab', weight: 8 },
  { id: 'ci-green', ja: '2 回目のリトライで緑になった', en: 'It went green on the second retry', weight: 7 },
  { id: 'watched-logs', ja: '流れるログをずっと眺めていた', en: 'Watched the logs scroll for a while', weight: 8 },
  { id: 'waited-install', ja: '依存のインストールを待っていた', en: 'Waited on a dependency install', weight: 7 },
  { id: 'read-changelog', ja: '更新履歴を読んで 破壊的変更で止まった', en: 'Read a changelog and stopped at "breaking"', weight: 6 },
  { id: 'renamed', ja: '変数の名前を 3 回変えた', en: 'Renamed one variable three times', weight: 6 },
  { id: 'tab-jungle', ja: 'タブを 40 枚開いて 3 枚だけ読んだ', en: 'Opened 40 tabs and read three', weight: 6 },
  { id: 'found-cause', ja: '原因が分かったが 直し方は分からなかった', en: 'Found the cause. Not the fix', weight: 5 },
  { id: 'rewrote', ja: '書き直したら 元と同じになった', en: 'Rewrote it and landed on the original', weight: 5 },
  { id: 'napped', ja: '途中で寝てしまった', en: 'Fell asleep partway through', weight: 6 },
  { id: 'ate', ja: '腹が減ったので 一回りしてきた', en: 'Got hungry and went for a lap', weight: 6 },
  { id: 'stared', ja: 'エラーメッセージを音読してみた', en: 'Read the error message out loud', weight: 5 },
  { id: 'asked-duck', ja: 'アヒルに説明したら 途中で分かった', en: 'Explained it to the duck and got it halfway through', weight: 4 },
  { id: 'blamed-self', ja: '犯人を探したら 先月の自分だった', en: 'Looked for the culprit. It was last month', weight: 4 },
  { id: 'nothing', ja: '特に何も起きなかった', en: 'Nothing much happened', weight: 5 },

  /*
   * いま出回っている言い回しから。**線は上と同じ** ── 誰もが心当たりのある
   * 状況だけを取って、実在の人物・企業・製品を名指しで落とすものは入れない。
   * 人ではなく**現象**のほうを書く（「深夜の一言で相場が動く」は書けるが、
   * 誰がと書いた瞬間、それは別のものになる）。
   */
  { id: 'rate-limited', ja: '上限に当たって 待つことにした', en: 'Hit the limit and decided to wait it out', weight: 7 },
  { id: 'plausible', ja: 'それらしい答えを 3 つ見て 全部ちがった', en: 'Read three plausible answers. All three were wrong', weight: 6 },
  { id: 'vibe', ja: '気分で書いたら そのまま動いてしまった', en: 'Wrote it on vibes. It worked, which is worse', weight: 6 },
  { id: 'midnight-post', ja: '深夜の一言で相場が動くのを 黙って見ていた', en: 'Watched one midnight post move the market', weight: 5 },
  { id: 'reserve', ja: '準備金の話をしている人たちを 遠くから眺めた', en: 'Watched people talk about strategic reserves, from a distance', weight: 5 },
  { id: 'ai-slop', ja: '生成されたものを 生成されたもので直した', en: 'Fixed generated output with more generated output', weight: 5 },
  { id: 'touch-grass', ja: '外に出た　5 分で戻ってきた', en: 'Went outside. Came back in five minutes', weight: 6 },
  { id: 'skill-issue', ja: '環境のせいにしたが 環境は無実だった', en: 'Blamed the environment. The environment was innocent', weight: 5 },
  { id: 'doomscroll', ja: '悪い知らせを最後まで読んだ', en: 'Read the bad news all the way down', weight: 5 },
  { id: 'rto', ja: '出社の通達を 3 回読み返した', en: 'Read the return-to-office memo three times', weight: 4 },
  { id: 'sunset', ja: '使っていたものが「発展的に終了」した', en: 'Something in use was "sunset"', weight: 4 },
  { id: 'migration-again', ja: '移行した先が また移行することになった', en: 'The thing you migrated to is migrating', weight: 4 },
  { id: 'agi-soon', ja: '「もうすぐ全部変わる」を今年も聞いた', en: 'Heard "everything changes soon" for another year', weight: 4 },
  { id: 'context-full', ja: '話が長くなりすぎて 頭から忘れていった', en: 'The conversation got long and the beginning fell out', weight: 5 },
  { id: 'unread', ja: '未読を 0 にした　5 分後に 12 件になった', en: 'Got to inbox zero. Twelve arrived five minutes later', weight: 5 },

  // 2026 のぶん。**流行りの言葉ではなく、流行りが起こす現象のほうを書く**
  { id: 'h-agent-wait', ja: 'エージェントの終わりを待ちながら 別のエージェントを立てた', en: 'Waited on one agent by starting another', weight: 5 },
  { id: 'h-agent-argue', ja: 'エージェント同士が 丁寧に食い違っていた', en: 'Two agents disagreed, very politely', weight: 4 },
  { id: 'h-mcp', ja: '道具を繋ぎ足して 繋いだことを忘れた', en: 'Wired up a new tool, then forgot it was there', weight: 5 },
  { id: 'h-context', ja: '文脈が溢れたので 大事なほうから落ちた', en: 'The context overflowed, and the important half went first', weight: 5 },
  { id: 'h-slop', ja: 'それらしい文を読み終えて 何も残らなかった', en: 'Finished a very confident paragraph. Nothing stayed', weight: 5 },
  { id: 'h-vibe-friday', ja: '気分で書いたものを 金曜に出した', en: 'Shipped the vibes on a Friday', weight: 4 },
  { id: 'h-rename', ja: '同じものが 今年の言い方に改名されていた', en: 'The same thing came back under this year\u2019s name', weight: 5 },
  { id: 'h-autonomy', ja: '自律の目盛りを上げて 5 分で戻した', en: 'Turned the autonomy up. Turned it back down in five minutes', weight: 4 },
  { id: 'h-review-self', ja: '自分の書いたものを 他人の顔で読み直した', en: 'Reread your own work wearing a stranger\u2019s face', weight: 4 },
  { id: 'h-approve', ja: '許可を求められ 内容を読まずに押した', en: 'Was asked for permission. Pressed yes without reading', weight: 5 },
  { id: 'h-plan', ja: '計画を立てさせたら 計画を立てる計画が出てきた', en: 'Asked for a plan. Got a plan for making a plan', weight: 4 },
  { id: 'h-quiet', ja: 'エージェントが静かなので 様子を見に行った', en: 'The agent went quiet, so you went to check on it', weight: 5 },
];

/** 留守 2 時間ごとに 1 つ、最初の 1 つは無条件。 */
function countFor(hours) {
  return Math.min(6, 1 + Math.floor(hours / 2));
}

/**
 * 留守中の成果。まだ帰りが早ければ null。
 *
 * 純関数。同じ state と同じ now なら必ず同じものが出る。
 */
export function expeditionFor(state, now = Date.now()) {
  const last = state.lastEventAt || 0;
  if (!last) return null;

  const away = now - last;
  if (away < MIN_AWAY_MS) return null;

  const hours = Math.min(MAX_HOURS, away / 3600000);

  // 種は「留守に入った時刻」だけで決める。now を混ぜると、眺めている間に
  // 拾ったものが入れ替わってしまう。
  const rng = rngFrom(hashSeed(`${state.seed}:${last}`));

  const finds = [];
  const taken = new Set();
  for (let i = 0; i < countFor(hours); i += 1) {
    const find = pickFind(rng, taken);
    taken.add(find.id);
    // blurb（相棒の観察記録）も一緒に運ぶ。**一言のほうが本体**なので落とさない
    finds.push({
      id: find.id,
      ja: find.ja,
      en: find.en,
      blurb: find.blurb,
      blurbEn: find.blurbEn,
      rare: Boolean(find.rare),
    });
  }

  const happening = pickWeighted(rng, HAPPENINGS);
  return {
    awayMs: away,
    hours: Math.round(hours * 10) / 10,
    happening: { id: happening.id, ja: happening.ja, en: happening.en },
    finds,
  };
}
