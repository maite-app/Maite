/**
 * キャラの絵。オーバーレイとスマホ用ページの両方がここから読む。
 *
 * 絵を 2 箇所に置くと必ずズレるので、markup はこのファイルだけに持つ。
 * ES モジュールにしていないのは、file:// のオーバーレイと http:// のスマホ用
 * ページの両方から同じ書き方（<script src>）で読めるようにするため。
 */
window.AIPET_SVG = `
<svg id="pet" viewBox="0 14 200 200" aria-hidden="true">
  <ellipse id="shadow" cx="100" cy="168" rx="44" ry="7.5" />

  <!-- オーラは体より奥。creature より前に置くと胴体を横切る -->
  <g id="aura">
    <ellipse cx="100" cy="122" rx="66" ry="53" />
  </g>

  <g id="creature">
    <!--
      装備のうち、**手に持つもの・脇に付くもの**は体より奥に置く。
      前に置いていたとき、翼と盾が顔と胴に半透明で重なって、
      **下の体が透けて見えていた**（実機の名刺でそれが一番目立った）。

      奥に回せば、はみ出したぶんだけが見える ── **重ならないのではなく、
      重なったところが隠れる**ので、装備が増えても顔が埋まらない。
      体に「着る」もの（胴当て）だけは、下の #gear に残してある。

      **触角と冠より、さらに奥。** 兜を後ろに置いたとき、兜が冠と触角の玉を
      塗り潰していた ── 冠は Lv10 の節目で、装備より先にこの子のものなので、
      隠されるのは装備のほう。
    -->
    <g id="gear-back">
      <!-- 攻 ── 右手に持つ -->
      <g class="gear-atk" id="gw-blade">
        <path class="grip" d="M162 150 v14" />
        <path class="edge" d="M158 150 l4 -58 l4 58 Z" />
        <path class="guard" d="M152 150 h20" />
      </g>
      <g class="gear-atk" id="gw-axe">
        <path class="grip" d="M164 100 v64" />
        <path class="edge" d="M164 104 q 22 6 20 26 q -12 8 -20 -6 Z" />
      </g>
      <g class="gear-atk" id="gw-hammer">
        <path class="grip" d="M164 104 v60" />
        <path class="edge" d="M150 100 h28 v20 h-28 Z" />
      </g>
      <g class="gear-atk" id="gw-lance">
        <path class="grip" d="M166 168 l-10 -70" />
        <path class="edge" d="M156 98 l-5 -22 l11 18 Z" />
      </g>
      <g class="gear-atk" id="gw-bow">
        <path class="edge" d="M158 96 q 26 34 0 68" />
        <path class="grip" d="M158 96 L158 164" />
      </g>
      <g class="gear-atk" id="gw-whip">
        <path class="grip" d="M162 148 v12" />
        <path class="edge" d="M162 148 q 18 -8 12 -28 q -6 -16 8 -22" />
      </g>
      <!-- 守 ── 左に構える、もしくは体に乗る -->
      <g class="gear-def" id="gw-shield">
        <path class="plate" d="M20 108 h30 v26 q 0 16 -15 22 q -15 -6 -15 -22 Z" />
        <path class="trim" d="M35 112 v40" />
      </g>
      <g class="gear-def" id="gw-cloak">
        <path class="plate" d="M52 96 q -18 40 -6 74 q 20 8 26 -4 q -18 -34 -6 -68 Z" />
      </g>
      <!-- 兜は頭に載る。奥に回すので、**頭より上に出たぶんだけ**が見える -->
      <g class="gear-def" id="gw-helm">
        <path class="plate" d="M66 84 q 34 -26 68 0 q -6 10 -34 10 q -28 0 -34 -10 Z" />
        <path class="trim" d="M100 62 v10" />
      </g>
      <g class="gear-def" id="gw-ward">
        <ellipse class="ring" cx="100" cy="122" rx="63" ry="50" />
        <ellipse class="ring2" cx="100" cy="122" rx="68" ry="54" />
      </g>
      <!--
        速さの 1 つめ。**足は描かない** ── 胴体だけの子に靴を履かせると、
        それだけで別の生き物になる。代わりに、置いていった風の筋で速さを出す。
      -->
      <g class="gear-spd" id="gw-dash">
        <path class="streak" d="M34 138 h22" />
        <path class="streak" d="M26 150 h30" />
        <path class="streak" d="M38 162 h18" />
      </g>
      <g class="gear-spd" id="gw-wing">
        <path class="feather" d="M48 106 q -30 12 -34 40 q 22 4 36 -14 Z" />
        <path class="feather" d="M152 106 q 30 12 34 40 q -22 4 -36 -14 Z" />
      </g>
      <g class="gear-spd" id="gw-orb">
        <circle class="orb" cx="168" cy="88" r="7" />
        <circle class="orb2" cx="180" cy="102" r="4" />
      </g>
      <g class="gear-spd" id="gw-lens">
        <circle class="glass" cx="150" cy="96" r="12" />
        <path class="grip" d="M158 106 l12 14" />
      </g>
    </g>

    <!-- Lv3 で生える触角。系統が確定した合図でもある -->
    <g id="antenna">
      <path d="M100 88 Q 95 62 108 52" />
      <circle cx="110" cy="49" r="6.5" />
    </g>

    <!-- Lv10 で乗る冠 -->
    <g id="crown">
      <path d="M76 78 L83 58 L100 70 L117 58 L124 78 Z" />
    </g>

    <path
      id="body"
      d="M 100 82 C 142 82 156 108 156 134 C 156 156 130 166 100 166 C 70 166 44 156 44 134 C 44 108 58 82 100 82 Z"
    />

    <!--
      スキンの模様（src/core/skins.js）。**既定では全部消えている。**
      体の形に切り抜くので、どの模様を足しても輪郭からはみ出さない。

      顔より奥・体より手前。顔に掛けると、型（persona.js）が決める目つきと
      口元が模様に埋もれる ── **顔つきはスキンで買えない**（§8c）。
    -->
    <!-- 体の上のつや。丸みを 1 枚で出す（クラスで色を付ける ── 直書きしない） -->
    <path id="sheen" d="M 72 92 C 85 87 115 87 128 92 C 115 84 85 84 72 92 Z" />

    <g id="skin-texture" clip-path="url(#body-clip)">
      <clipPath id="body-clip">
        <path d="M 100 82 C 142 82 156 108 156 134 C 156 156 130 166 100 166 C 70 166 44 156 44 134 C 44 108 58 82 100 82 Z" />
      </clipPath>

      <!-- 墨：紙目のような細い縞 -->
      <g class="tex" id="tex-grain">
        <path d="M44 96 H156 M44 112 H156 M44 128 H156 M44 144 H156 M44 160 H156" />
      </g>

      <!-- 熾火：下から上に抜ける熱 -->
      <g class="tex" id="tex-ember">
        <ellipse cx="100" cy="168" rx="52" ry="26" />
        <ellipse cx="100" cy="176" rx="34" ry="20" />
      </g>

      <!-- 霜：角のある結晶 -->
      <g class="tex" id="tex-frost">
        <path d="M62 96 l10 10 l-10 10 M138 140 l-10 10 l10 10 M92 88 l8 8 l-8 8" />
      </g>

      <!-- 宵：夜空の粒 -->
      <g class="tex" id="tex-stars">
        <circle cx="66" cy="104" r="2" />
        <circle cx="132" cy="98" r="1.6" />
        <circle cx="146" cy="132" r="2.2" />
        <circle cx="58" cy="140" r="1.8" />
        <circle cx="104" cy="92" r="1.4" />
        <circle cx="120" cy="158" r="1.6" />
      </g>
    </g>

    <g id="face">
      <g class="eye" transform="translate(78 128)">
        <circle class="eyeball" r="10.5" />
        <circle class="pupil" r="4.5" />
        <!--
          光。**これ 1 個で顔つきが変わる** ── 瞳が真っ黒のままだと、
          どんなに形を丸くしても「点」に見える。左上に寄せるのは、
          そこに光源があると読ませるため（両目とも同じ側に置く）。
        -->
        <circle class="glint" cx="-2.8" cy="-2.8" r="2.1" />
        <path class="lid" d="M-11 0 Q 0 7 11 0" />
      </g>
      <g class="eye" transform="translate(122 128)">
        <circle class="eyeball" r="9" />
        <circle class="pupil" r="4" />
        <circle class="glint" cx="-2.6" cy="-2.6" r="1.9" />
        <path class="lid" d="M-10 0 Q 0 6 10 0" />
      </g>
      <path id="mouth" d="M94 145 Q 100 149 106 145" />

      <!--
        頬の赤み。**顔つきは型が決める**ので、形には触らない ── 色を薄く
        敷くだけ。系統色（--hue）に寄せてあるので、系統が決まるまでは
        ほとんど出ない（無彩色の子に頬紅だけ乗ると浮く）。
      -->
      <g id="blush">
        <ellipse cx="72" cy="138" rx="8" ry="4.5" />
        <ellipse cx="128" cy="138" rx="8" ry="4.5" />
      </g>
    </g>

    <!--
      使い込み ── 一緒にいた長さぶんの傷。**性能には 1 も効かない**（見た目だけ）。
      体の形に切り抜くので、どれだけ増やしても輪郭からはみ出さない。
    -->
    <g id="patina" clip-path="url(#body-clip)">
      <path class="scar" id="scar-1" d="M120 96 l16 12" />
      <path class="scar" id="scar-2" d="M58 132 l14 -9" />
      <path class="scar" id="scar-3" d="M104 158 l20 4" />
      <path class="scar" id="scar-4" d="M66 106 l10 12" />
      <path class="scar" id="scar-5" d="M138 148 l-12 8" />
      <!-- 縁の欠け。1 年もの -->
      <path class="chip" id="chip-1" d="M150 118 l10 -6 l2 12 Z" />
      <path class="chip" id="chip-2" d="M48 142 l-10 4 l1 -12 Z" />
    </g>

    <!--
      顔まわりの小物。**顔より手前**（目と口の上に乗る）。

      **これは買えるスキンとは別物。** どれも作業ログから生えているので、
      目つき・口元と出どころが同じ ── だから顔に掛かってよい（買えるスキンの
      ほうは、いままでどおり顔に一切触らない。DESIGN.md §8c）。

      顔は 目 (82,122) / (118,122)・口 (100,142) の周り。
      **同じ場所のものは同時に出ない**（appearance.js が段の大きいほうだけ返す）。
    -->
    <g id="wear">
      <!-- 口元 ── 一緒に過ごした長さで伸びる -->
      <g class="worn" id="ac-stubble">
        <path class="hair" d="M84 150 q 16 10 32 0 q -4 12 -16 12 q -12 0 -16 -12 Z" />
      </g>
      <g class="worn" id="ac-moustache">
        <path class="hair" d="M78 134 q 20 -8 22 3 q 2 -11 22 -3 q -8 11 -22 8 q -14 3 -22 -8 Z" />
      </g>
      <g class="worn" id="ac-beard">
        <path class="hair" d="M78 134 q 20 -8 22 3 q 2 -11 22 -3 q -8 11 -22 8 q -14 3 -22 -8 Z" />
        <path class="hair" d="M80 150 q 20 13 40 0 q -3 18 -20 18 q -17 0 -20 -18 Z" />
      </g>

      <!-- 目元 ── 眼鏡は学者、サングラスは夜目から -->
      <g class="worn" id="ac-glasses">
        <circle class="rim" cx="78" cy="128" r="14.5" />
        <circle class="rim" cx="122" cy="128" r="14.5" />
        <path class="rim" d="M93 128 h14" />
      </g>
      <!--
        サングラスは**中を透かさない**（style.css）。透かしていたときは、
        レンズの下から白目と瞳がはみ出して「掛けそこねている」ようにしか
        見えなかった ── レンズは角の立った形、目は丸なので、大きさを
        合わせにいっても必ずどこかが出る。掛けている間は目のほうを消す。

        代わりに**斜めの光を 1 本入れる。** 塗り潰しただけだと、顔に黒い穴が
        2 つ空いているように見える（瞳の光と同じ話で、光が 1 個あるかどうかで
        「物」に見えるかが決まる）。
      -->
      <g class="worn" id="ac-shades">
        <path class="lens" d="M65 121 h29 v13 q -15 7 -29 0 Z" />
        <path class="lens" d="M106 121 h29 v13 q -15 7 -29 0 Z" />
        <path class="shine" d="M73 122 h5 l-6 12 h-5 Z" />
        <path class="shine" d="M114 122 h5 l-6 12 h-5 Z" />
        <path class="rim" d="M94 125 h12 M65 121 h70" />
      </g>

      <!-- 頭 ── 長丁場を越えてきた数。冠より下に描くので同時に出てよい -->
      <!--
        つるは**頭の上を通す。** 目の高さに掛けていたので、耳当てが顔の横に
        浮いて見えていた ── この子に耳は無いので、位置で「頭に載っている」を
        出すしかない。
      -->
      <g class="worn" id="ac-headphones">
        <path class="band" d="M56 118 q 44 -52 88 0" />
        <rect class="cup" x="44" y="112" width="15" height="26" rx="7" />
        <rect class="cup" x="141" y="112" width="15" height="26" rx="7" />
      </g>

      <!-- 首 ── 席に着いた回数 -->
      <!-- 口に掛けない。口元は型（persona.js）が決めるものなので、隠すと誰か分からなくなる -->
      <g class="worn" id="ac-scarf">
        <path class="cloth" d="M70 158 q 30 10 60 0 q 1 9 -6 12 q -24 8 -48 0 q -7 -3 -6 -12 Z" />
        <path class="cloth" d="M124 169 q 10 8 7 18 q -9 1 -12 -6 Z" />
      </g>

      <!-- 頬 ── 空振りの数。**責める言葉は使わない**（やってきた証のほう） -->
      <g class="worn" id="ac-bandage">
        <path class="patch" d="M132 138 l14 -8 l6 10 l-14 8 Z" />
      </g>

      <!-- 耳 ── 称号の数 -->
      <g class="worn" id="ac-earring">
        <path class="wire" d="M50 126 v8" />
        <circle class="stud" cx="50" cy="139" r="6" />
      </g>
    </g>

    <!--
      ケガ ── **直前の一戦に負けたときだけ、しばらく。**（appearance.js の hurtFor）

      1 時間で勝手に治る。手当ての操作は無いし、そのあいだ弱ってもいない
      ── 数字には 1 も効かない（DESIGN.md §3「世話される側にしない」）。

      **絆創膏は左の頬**（x=62 あたり）。称号の絆創膏（ac-bandage）は
      右の頬（x=132）なので、両方出ても重ならない。
    -->
    <g id="hurt">
      <!-- 深い（負けた直後） -->
      <g class="wound" id="hurt-deep">
        <path class="plaster" d="M56 148 l16 -9 l6 10 l-16 9 Z" />
        <path class="plaster-cross" d="M62 150 l7 -4" />
        <path class="plaster-cross" d="M64 144 l3 9" />
        <!-- 擦り傷は体の形で切り抜く。輪郭からはみ出すと貼り紙に見える -->
        <g clip-path="url(#body-clip)">
          <path class="graze" d="M106 160 l16 3" />
          <path class="graze" d="M114 152 l13 4" />
        </g>
      </g>
      <!-- 浅い（治りかけ）── 絆創膏だけ残る -->
      <g class="wound" id="hurt-mild">
        <path class="plaster" d="M58 147 l14 -8 l5 9 l-14 8 Z" />
      </g>
    </g>

    <!--
      装備と、育ちの段。**どれも既定では消えている**（CSS の opacity:0）。
      appearance.js が付けるクラスに当たったものだけ出る。

      絵を数百枚描かずに数百通りにするための重ね方（DESIGN.md §9）：
      武器 6 型 × 守り 5 型 × 速さ 4 型 = 120、それぞれ位が 5 段（色）、
      さらに育ちの段が 8 ── 掛け算で桁が上がる。

      **体の輪郭の外に置く**（胴体は x 44〜156、y 78〜166）。重ねると
      顔と模様が潰れる ── 顔つきは型が決めるものなので、装備で隠さない。
    -->
    <g id="gear">
      <!--
        手前に残すのは**体に着るもの**だけ ── 胴当ては腹に貼り付くので、
        奥に回すと丸ごと消える（体の内側にしか無い）。
      -->
      <!-- 胴当ては**腹に置く**。胸まで上げると口と目に掛かる ── 顔つきは
           型が決めるものなので、装備で隠さない（§8c） -->
      <g class="gear-def" id="gw-plate">
        <path class="plate" d="M66 150 h68 q -4 16 -34 16 q -30 0 -34 -16 Z" />
        <path class="trim" d="M100 150 v15" />
      </g>
    </g>

    <!--
      育ちの段。**節目は実績と同じ位置**（Lv30 熟練で角、Lv50 達人で尾…）
      ── 揃っていないと、どちらも薄くなる。
    -->
    <g id="growth">
      <g class="grow" id="lk-horns">
        <path d="M72 88 l-10 -22 l18 12 Z" />
        <path d="M128 88 l10 -22 l-18 12 Z" />
      </g>
      <g class="grow" id="lk-tail">
        <path d="M44 148 q -26 6 -30 -14 q -2 -12 10 -12" />
      </g>
      <g class="grow" id="lk-halo">
        <ellipse cx="100" cy="124" rx="84" ry="66" />
      </g>
      <g class="grow" id="lk-sigil">
        <path d="M100 60 l7 12 l14 2 l-10 10 l3 14 l-14 -7 l-14 7 l3 -14 l-10 -10 l14 -2 Z" />
      </g>
    </g>

    <!--
      スキンの小物。体に付くので creature の中（体と一緒に伸び縮みする）。
      料理や本と違って「持ち替える」ものではないので、props とは別に置く。
    -->
    <g id="skin-trinket">
      <!-- 熾火：肩口の火の粉 -->
      <g class="trinket" id="trinket-spark">
        <circle cx="146" cy="98" r="2.6" />
        <circle cx="153" cy="88" r="1.8" />
        <circle cx="140" cy="86" r="1.4" />
      </g>

      <!-- 霜：白い息 -->
      <g class="trinket" id="trinket-breath">
        <ellipse cx="128" cy="146" rx="7" ry="4.5" />
        <ellipse cx="140" cy="142" rx="4.5" ry="3" />
        <ellipse cx="149" cy="139" rx="2.6" ry="1.8" />
      </g>

      <!-- 宵：ついてくる蛾 -->
      <g class="trinket" id="trinket-moth">
        <path d="M52 92 q -7 -6 -1 -10 q 5 -2 6 5 q 1 -7 6 -5 q 6 4 -1 10 Z" />
        <circle cx="57" cy="93" r="1.6" />
      </g>
    </g>
  </g>

  <!--
    小道具。**既定では全部消えている**（CSS で opacity:0）。
    暮らしのしぐさ（gestures.js の ACTIVITIES）が #stage にクラスを付けたときだけ、
    その回に要るものが出る。

    creature の外に置いてあるのは、体のアニメーション（scale/rotate）を
    小道具まで巻き込まないため ── 巻き込むと、伸びをするたびに丼が伸びる。
  -->
  <g id="props">
    <!-- ハンバーガー。上下のバンズと具 -->
    <g class="prop" id="prop-burger">
      <path class="bun" d="M138 138 Q 152 126 166 138 Z" />
      <rect class="patty" x="137" y="139" width="30" height="5" rx="2" />
      <rect class="leaf" x="136" y="144" width="32" height="4" rx="2" />
      <path class="bun" d="M137 149 h30 a5 5 0 0 1 -5 5 h-20 a5 5 0 0 1 -5 -5 Z" />
    </g>

    <!-- 小籠包。せいろと湯気 -->
    <g class="prop" id="prop-bun">
      <g class="steam">
        <path d="M146 128 q 4 -7 0 -14" />
        <path d="M156 126 q 4 -8 0 -15" />
      </g>
      <circle class="dumpling" cx="147" cy="141" r="6" />
      <circle class="dumpling" cx="159" cy="141" r="6" />
      <rect class="basket" x="136" y="145" width="32" height="9" rx="3" />
    </g>

    <!-- そば。丼と、持ち上げた麺 -->
    <g class="prop" id="prop-soba">
      <path class="noodle" d="M150 128 q 3 8 -1 14" />
      <path class="noodle" d="M156 127 q 2 9 -2 15" />
      <path class="bowl" d="M134 142 h36 a18 18 0 0 1 -36 0 Z" />
      <rect class="chopsticks" x="150" y="112" width="3" height="22" rx="1.5" transform="rotate(12 151 123)" />
      <rect class="chopsticks" x="156" y="112" width="3" height="22" rx="1.5" transform="rotate(20 157 123)" />
    </g>

    <!-- 映画。四角い画面と、ちらつく光 -->
    <g class="prop" id="prop-movie">
      <rect class="screen" x="8" y="96" width="46" height="34" rx="4" />
      <rect class="flicker" x="12" y="100" width="38" height="26" rx="2" />
      <rect class="stand" x="28" y="130" width="6" height="10" rx="2" />
    </g>

    <!-- 本。読んでいるあいだ開いている -->
    <g class="prop" id="prop-book">
      <path class="page" d="M70 150 q 15 -6 28 0 v18 q -14 -6 -28 0 Z" />
      <path class="page" d="M102 150 q 14 -6 28 0 v18 q -13 -6 -28 0 Z" />
      <path class="spine" d="M100 150 v18" />
    </g>

    <!-- 金づち。叩いているあいだだけ -->
    <g class="prop" id="prop-hammer">
      <rect class="handle" x="152" y="118" width="4" height="26" rx="2" />
      <rect class="head" x="142" y="110" width="24" height="10" rx="3" />
    </g>

    <!-- 筆。書いているあいだ -->
    <g class="prop" id="prop-brush">
      <rect class="handle" x="150" y="112" width="4" height="24" rx="2" />
      <path class="tip" d="M150 136 h4 l-2 10 Z" />
    </g>

    <!-- 望遠鏡。外を見に行くとき -->
    <g class="prop" id="prop-scope">
      <rect class="tube" x="120" y="96" width="34" height="10" rx="5" transform="rotate(-24 137 101)" />
      <circle class="lens" cx="152" cy="90" r="6" />
    </g>

    <!-- 手紙。任せたとき、飛んでいく -->
    <g class="prop" id="prop-letter">
      <rect class="paper" x="140" y="96" width="26" height="18" rx="2" />
      <path class="fold" d="M140 96 l13 10 l13 -10" />
    </g>

    <!-- 布団。寝ているあいだ -->
    <g class="prop" id="prop-blanket">
      <path class="cloth" d="M46 148 q 54 -14 108 0 v10 q -54 12 -108 0 Z" />
    </g>

    <!--
      じゃれてくる相手。**世話をするものではない。**

      餌をやったり撫でたりはさせない（DESIGN.md §3 ── 育成のための操作を
      足さない）。向こうから来て、しばらく遊んで、勝手に帰る。こちらが
      できるのは眺めることだけで、それは相棒に対してと同じ扱い。
    -->
    <!--
      ここから 3 匹は**差し替える前提**で置いてある。
      ─────────────────────────────────────────────
      絵を描き直すときの決まりは 4 つだけ：

      1. 外側の <g class="prop" id="prop-xxx"> は残す。
         id が動きの引き金（style.css の #stage.g-cat #prop-cat）。
      2. 座標はこの 200x200 の中で、**下に書いた枠に収める**。
         枠を外れると、相棒の体（胴体は x 44〜156）に重なって
         「頭だけ出たよく分からない生き物」になる ── 実際そうなっていた。
      3. 色はクラスで付ける。fill/stroke を直に書かない
         ── 書くとスキンや系統色が効かなくなる。
         使えるクラス … fur（体）beady（目）whisker（ひげ・脚）
         tail（しっぽ・振る）wing（翼・羽ばたく）beak（くちばし）
         shellline（甲羅の筋）foot（足）
      4. 動く部品には元と同じクラスを付ける。tail と wing と
         （亀の）fur には CSS 側で動きが付いていて、
         クラスが無いと**その部品だけ止まる**。

      枠 … 猫 x 140〜200 / y 112〜170   小鳥 x 100〜136 / y 50〜82
           亀 x 142〜196 / y 148〜170

      SVG 以外（PNG）は貼らないこと。拡大で潰れるうえ、色が変えられない。
    -->
    <!--
      猫。しっぽを振って、じゃれつく。
    -->
    <g class="prop" id="prop-cat">
      <path class="tail" d="M182 152 q 15 -2 11 -19" />
      <path class="fur" d="M158 148 h24 a7 7 0 0 1 7 7 v11 h-38 v-11 a7 7 0 0 1 7 -7 Z" />
      <circle class="fur" cx="165" cy="136" r="13" />
      <path class="fur" d="M155 127 l-3 -12 l11 6 Z" />
      <path class="fur" d="M175 127 l3 -12 l-11 6 Z" />
      <circle class="beady" cx="160" cy="135" r="2" />
      <circle class="beady" cx="171" cy="135" r="2" />
      <path class="whisker" d="M152 140 h-9 M178 140 h9" />
    </g>

    <!-- 小鳥。頭にとまる -->
    <g class="prop" id="prop-bird">
      <ellipse class="fur" cx="112" cy="66" rx="10" ry="8" />
      <circle class="fur" cx="121" cy="60" r="6" />
      <path class="beak" d="M126 59 l7 2 l-7 3 Z" />
      <circle class="beady" cx="122" cy="59" r="1.6" />
      <path class="wing" d="M108 62 q 8 4 2 9" />
      <path class="whisker" d="M110 74 v6 M116 74 v6" />
    </g>

    <!-- 亀。急がない相手。こちらも輪郭の外（右下）から来る -->
    <g class="prop" id="prop-turtle">
      <path class="fur" d="M156 160 q 18 -22 36 0 Z" />
      <path class="shellline" d="M165 156 v-8 M174 152 v-9 M183 156 v-8" />
      <circle class="fur" cx="152" cy="158" r="7" />
      <circle class="beady" cx="149" cy="157" r="1.7" />
      <path class="foot" d="M162 160 v7 M186 160 v7" />
    </g>

    <!-- 湯のみ。ひと息ついているとき -->
    <g class="prop" id="prop-tea">
      <g class="steam">
        <path d="M150 132 q 4 -7 0 -13" />
      </g>
      <path class="cup" d="M140 138 h20 v8 a10 10 0 0 1 -20 0 Z" />
    </g>
  </g>
</svg>
`;
