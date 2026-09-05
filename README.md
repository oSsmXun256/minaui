# MinaUI

MinaUI は、Web サイト・ダッシュボード・ポートフォリオ・ランディングページまで同じ API で組み立てられる、依存関係のない汎用 CSS / JS UI フレームワークです。

**Design Philosophy**: 「暗い背景に浮かぶ、質感のある面」を軸に、Pink / Violet / Glass のビジュアルアイデンティティを維持しつつ、面の階層(Surface → Frosted Glass → Liquid Glass)を明確に分離します。Glass / Glow は乱用せず、必要な面にだけ掛けることで、高級感・未来感と性能・可読性を両立させます。

デフォルトは、`vrc.ossmxun.net` のような暗い背景、ピンク〜紫のグラデーション、半透明の面を持つビジュアルです。`data-theme="light"`、`data-style="flat"`、`data-accent="cyan"` などを切り替えるだけで、同じコンポーネントを別のプロダクトにも使えます。

## クイックスタート

基本配布は `minaui.css` と `minaui.js` の 2 つです。JS は任意で、CSS コンポーネントは JS なしでも表示できます。WebGL Liquid Glass が必要なページだけ `minaui.glass.js` (MinaLiquid V3) を追加し、AquaCSS 2.0から段階移行する間だけ `minaui-aqua-compat.css` を追加します。

```html
<link rel="stylesheet" href="./minaui.css">
<script src="./minaui.js" defer></script>

<main class="mina-shell">
  <div class="mina-backdrop" aria-hidden="true"></div>
  <section class="mina-page">
    <div class="mina-card mina-card--interactive mina-card--glow">
      <div class="mina-card__body mina-stack">
        <span class="mina-badge mina-badge--primary mina-badge--dot">MinaUI</span>
        <h1 class="mina-h1">Build your own surface.</h1>
        <p class="mina-lead">背景、カード、入力、ナビゲーションを同じトークンで統一できます。</p>
        <div class="mina-cluster">
          <a class="mina-btn mina-btn--primary" href="#docs">はじめる</a>
          <button class="mina-btn mina-btn--glass" data-mina-toggle="#about">詳細</button>
        </div>
      </div>
    </div>
  </section>
</main>
```

## デモ

`demo/index.html` は **Liquid Glass Lab** — Surface / Frosted Glass / Liquid Glass を同一画面で比較し、Scene ソース (photo / pattern / gradient)、品質 (high / balanced / performance)、backend (Liquid / Frosted / Static)、そして refraction・blur・dispersion・fresnel をスライダーでその場で調整できます。細かい模様や明暗差のあるソースに切り替えて、エッジの屈折が自然かを確認できます。

リポジトリ直下で静的サーバーを起動し、`http://localhost:4173/demo/` を開いて確認できます。

```bash
python -m http.server 4173
```

URL パラメータでの直接遷移も可能です: `demo/?source=pattern&quality=high&backend=liquid`

## 公開 API

### CSS

全ての公開クラスは `.mina-` 名前空間です。レイアウトは `mina-container`、`mina-grid--auto`、`mina-stack`、`mina-cluster`、表面は `mina-card`、`mina-panel`、`mina-glass`、操作部品は `mina-btn`、`mina-input`、`mina-select`、`mina-switch`、`mina-tabs`、`mina-modal`、`mina-toast` を中心に構成されています。

カバレッジは、layout / grid / flex / typography / card・glass / button・badge / form / navigation・tabs・dropdown / table・list・stat / feedback（alert・toast・progress・skeleton） / modal・drawer・tooltip / media・avatar / utilities です。

ユーティリティには `mina-w-full`、`mina-min-h-screen`、`mina-hidden`、`mina-mx-auto`、`mina-gap-*`、`mina-p-*` などを含みます。`mina-min-h-screen` はモバイルの表示領域にも配慮して `100svh` を併記します。

ルート要素または任意のラッパーに属性を付けて見た目を切り替えます。

```html
<html data-theme="dark" data-style="glass" data-accent="pink">
```

利用できる値は次のとおりです。

- `data-theme`: `dark`（既定） / `light`
- `data-style`: `glass`（既定） / `solid` / `flat`
- `data-accent`: `pink`（既定） / `violet` / `cyan` / `green` / `orange`

カラー・余白・角丸・フォントなどは `--mina-*` CSS カスタムプロパティで上書きできます。たとえばサイト単位のブランドカラーは次のように設定します。

```css
:root {
  --mina-primary: #ec4899;
  --mina-secondary: #8b5cf6;
  --mina-radius-xl: 1.25rem;
}
```

#### Surface と elevation の基準

MinaUI は面を3つのレベルに明確に分けています。GPUレイヤー(`backdrop-filter` は要素ごとにコンポジットレイヤーを生む)を必要な面にだけ限定するためです。

| レベル | クラス | 見た目 | 使う場所 |
| :-- | :-- | :-- | :-- |
| 1. Surface | `mina-card` / `mina-panel` | 半透明の背景 + ボーダー + `--mina-shadow-md`。blurなし | 標準のカード・パネル。数を並べてOK |
| 2. Frosted Glass | `mina-card mina-glass` のように併記 | 1 + `backdrop-filter` によるフロスト。実DOM背面をブラウザが処理 | 背景写真やグラデーションの上に浮くヒーロー面、ナビ、ドロワー |
| 3. Liquid Glass | `mina-liquid` / `data-mina-liquid` + `minaui.glass.js` | MinaLiquid (WebGL2) による屈折レンズ。Hero / Showcase 専用 | 1ページに数枚の主役面のみ |

- `mina-shadow-sm` は補助面、`mina-shadow-md` は標準面、`mina-shadow-lg` はモーダルや一時的な前景レイヤー向けです。
- `mina-card--interactive` は操作対象のカードだけに付け、ホバー時の浮き上がりを明示します。装飾目的で全カードに付けないでください。
- `mina-card--static` は情報表示用であることを明示します。リンクやボタンには `mina-card--interactive` を付け、矢印・hover・focusで操作対象だと伝えます。
- フォーム入力(`mina-input` など)はblurを持ちません。 写真上に直接浮かせる特殊なケースだけ `mina-glass` を併記してください。

この基準は、見た目を保ちながら blur と大きな影の数を必要最小限にするためのものです。旧バージョンのように全カードをフロストさせたい場合は、該当要素に `mina-glass` を足すだけで同じ見た目に戻せます。

### JavaScript

`minaui.js` は依存関係のない小さな挙動レイヤーです。`defer` で読み込むと自動初期化されます。手動初期化や API 呼び出しもできます。

```js
MinaUI.init();
MinaUI.openModal("#settings");
MinaUI.closeModal("#settings");
MinaUI.setTheme("light");
MinaUI.toast("保存しました", { title: "完了", tone: "success" });
```

モーダルとドロワーは開いたときに最初の操作可能要素へフォーカスし、`Tab` / `Shift+Tab` をレイヤー内に閉じ込め、閉じたときに起点へフォーカスを戻します。`Escape` でも閉じられます。モーダルが開いている間は `html[data-mina-modal-open]` により背面スクロールも固定されます。無効化する必要がある特殊なケースだけ `data-mina-focus-trap="false"` を指定してください。タブは左右（縦配置では上下）の矢印キーと `Home` / `End`、ドロップダウンは矢印キー・`Home` / `End`・`Escape` に対応します。トーストは閉じる際にフェードアウトしてからDOMから取り除かれます。

宣言的な属性も利用できます。

```html
<button class="mina-btn" data-mina-toggle="#settings">設定</button>

<section id="settings" class="mina-modal" aria-hidden="true">
  <div class="mina-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
    <header class="mina-modal__header">
      <h2 id="settings-title" class="mina-modal__title">設定</h2>
      <button class="mina-btn mina-btn--ghost mina-btn--icon" data-mina-close aria-label="閉じる">×</button>
    </header>
    <div class="mina-modal__body">ここに内容を置きます。</div>
  </div>
</section>
```

サポートされる属性は `data-mina-toggle` / `data-mina-target`、`data-mina-close`、`data-mina-tab`、`data-mina-dropdown-item`、`data-mina-copy`、`data-mina-theme` です。

## ガラスとパフォーマンス

### 3種類のサーフェスと軽量モード

標準の `mina-card` / `mina-panel` は **blurなしの透過面 (Surface)** です。フロスト(すりガラス)が本当に必要な面だけ `mina-glass` を追加し、主役の面にはWebGL液体ガラス `mina-liquid` を使います。

```html
<!-- 標準: Surface (blurなし)。カードを多数並べてもGPUレイヤーは増えない -->
<div class="mina-card">…</div>

<!-- Frosted Glass: 背景写真の上に浮く面など、blurが見せる効果を持つ場所だけ -->
<div class="mina-card mina-glass">…</div>

<!-- Liquid Glass (MinaLiquid / WebGL2): Hero・Showcase向け -->
<div class="mina-liquid" data-mina-liquid>…</div>
```

カードを多数並べる場合や低性能端末では `data-style="flat"` / `data-style="solid"`、または `data-mina-performance="performance"` を明示的に選んでください。レイヤー昇格が必要な特殊ケースのみ `.mina-gpu` を使います。

### Performance Mode

ルート要素でパフォーマンス層を指定できます。

```html
<html data-mina-performance="balanced">
```

| 値 | 挙動 |
| :-- | :-- |
| `quality` | 全エフェクト。animated backdrop-filterも有効。MinaLiquidは高画質pipeline |
| `balanced` | 静止見た目はqualityと同じ。blurアニメーション（`mina-glass-blur-in` 等）はopacityフェードへ置き換わり、MinaLiquidは2-level pyramid + dispersion減衰 |
| `performance` | blur縮小/無効化、glow・巨大影の削減、無限装飾アニメ（skeletonのshimmer含む）停止、不透明度の高い面で可読性を維持。MinaLiquidはmip直接 + dispersion無効 |

`prefers-reduced-motion` の対応は従来どおり全モードで優先されます。

### Layer契約（z-index）

サイト側でz-indexを場当たり的に調整しなくても済むよう、変数で契約を定義しています。

```css
--mina-z-backdrop-deep: -2;  /* .mina-shell::before のオーラ */
--mina-z-backdrop: -1;       /* .mina-backdrop の背景写真 */
--mina-z-glass-canvas: 0;    /* #mina-glcanvas（WebGL） */
--mina-z-scrim: 2;            /* .mina-scrim（可読性マスク） */
--mina-z-content: 5;          /* .mina-content（前景コンテンツ） */
/* 0 以降は通常コンテンツ → --mina-z-sticky → dropdown → drawer → overlay → modal → toast → tooltip */
```

WebGLキャンバスは `position: fixed` + `pointer-events: none` + コンテンツより下のz-indexで、DOMの描画や入力を妨害しません。

## MinaLiquid — WebGL Liquid Glass（minaui.glass.js）

v0.3.0 から Liquid Glass は **MinaLiquid V3** — 描画原理から再設計された専用レンダラです。背景を変形しているだけだった旧 MinaGlass (V2) を置き換えます。詳細な設計と移行は [LIQUID-GLASS.md](LIQUID-GLASS.md) を参照してください。

> **重要**: WebGL は任意の DOM を透視できません。MinaLiquid は **レンダラ自身が管理する Scene** (image / video / canvas / gradient) を屈折させます。DOM を capture しているわけではありません。

### Frosted と Liquid の違い

| | CSS Frosted (`mina-glass` / `mina-liquid-native`) | WebGL Liquid (`mina-liquid` + MinaLiquid) |
| :-- | :-- | :-- |
| 背景 | **blur のみ** (geometry は変化しない) | **曲がる・明確に拡大される** (lensWarp ~6.7%) |
| 中央 | 均一 blur | 近似シャープ + lensWarp |
| エッジ | なし | 強屈折 + Fresnel + specular |
| 見え方 | すりガラス | 透明な厚みのあるレンズ |
| 向き | 読みやすさ優先の下地 | 主役面の展示 |

### Scene modes (owned / overlay)

| | `owned` (既定) | `overlay` |
| :-- | :-- | :-- |
| 背景 | WebGL が Scene を全面描画 | **DOM/CSS 背景がそのまま**。canvas はガラス領域のみ |
| 用途 | Hero / 動画背景 / グラデーション全面 | **実DOMコンテンツ (画像群など) の上のガラス** (vrc の Diamond gallery 上の sticky フィルター等) |

どちらのモードでも屈折できるのは レンダラ管理の Scene (image / video / canvas / gradient / **css-background** / **sceneProvider**) のみです。**WebGL は任意の DOM を capture できません** (backdrop-filter と同じ、ではない)。

`css-background` の対応範囲は厳密に **単一 url() + cover + center + no-repeat** のみです (それ以外の multi-layer / gradient / repeat / contain / 任意 size / 任意 position は scene failed として明示的に拒否)。overlay モードではガラス境界 +1px 以外は alpha = 0 が保証されます (外側の影は CSS 側 box-shadow で)。

```js
const liquid = new MinaLiquid({
  source: { type: "image", src: "/background.jpg" },
  sceneMode: "owned",   // 'owned' = WebGL が背景全体を描画 | 'overlay' = DOM 背景の上にガラスだけ
  quality: "balanced",   // high | balanced | performance
  maxRefractionPx: 40,   // 屈折変位 (lensWarp + edge 合成) の安全上限
  glass: {
    lensWarp: 0.10,    // 主役: 内部レンズ倍率 (中間帯 ~6.7%, V2級の「ぐにゃん」)
    refraction: 0.34,  // エッジの屈折
    blur: 2,           // 軽い透過blur (背景情報を残す)
    dispersion: 0.02,   // 極小のRGB分散
    fresnel: 0.16        // 縁のリムライト
  }
});
// 動的背景 (vrc の Diamond gallery など):
// new MinaLiquid({ sceneMode: 'overlay', sceneProvider: { render(ctx, state) {...} } })
// 変更時: liquid.invalidateScene()
```

DOM 側は geometry を渡すだけです:

```html
<div class="mina-liquid" data-mina-liquid>主役コンテンツ</div>

<!-- 個別上書き -->
<div class="mina-liquid" data-mina-refraction="1.4" data-mina-blur="16">…</div>
```

### 動作の要点

- **2つのシーンモード**: `owned` は WebGL が背景全体を描画。`overlay` は canvas がガラス領域だけを描き、外側は完全透明 — **普通の Web サイトの DOM/CSS 背景を勝手に置き換えない**
- **lensWarp が主役**: ガラス内部で背景が ~6.7% (Strong ~14%) 拡大され、境界を跨ぐ直線が明確にズレる。Grid シーンで一目で分かる (旧 V2 の「ぐにゃん」を SDF・安全上限の上に再構築)
- **屈折の安全上限**: lensWarp + edge の合成変位は `maxRefractionPx` (既定40px) で制限。どのカードサイズでも極端な伸びは起きない
- **中央は近似シャープ**: `centerBlur` + `blur: 2` によりガラス中央の背景情報量を残す (すりガラス = CSS Frosted の役割)
- **動的 Scene**: `sceneProvider.render(ctx, state)` + `invalidateScene()` で dirty-driven に背景を再描画 (vrc の Diamond gallery で実証)
- **scene readiness**: Scene が GPU に upload され最初の1フレームが描けるまで `.mina-liquid-gl` は付与されない。それまでは CSS 表面で表示。source 切替時も即座に CSS 表面へ戻る
- **source failure**: 画像ロード失敗 / CORS / tainted canvas / invalid canvas / 動画未準備 / provider の throw でも透明・黒にならず CSS 表面へ fallback (DOM 背景は無傷)
- **video lifecycle**: `requestVideoFrameCallback` 優先 (未対応環境のみRAF fallback・再生中のみ)。全 handler が generation token で stale 保護。`destroy()` は内部生成 `<video>` だけ解放
- **blur pyramid**: Scene から 1/2, 1/4, 1/8 のぼかしレベルを事前生成。ピクセルごとの多段 tap はしない
- **dirty rendering**: 常時RAFなし。scroll / resize / 要素変化時のみ1フレームにまとめて描画
- **要素カリング**: viewport 外・`display:none`・0サイズの要素は処理しない。表示中の要素だけを uniform に渡す
- **fallback**: WebGL2なし / Safari・iOS / context lost / shader・FBO失敗のすべてで `CSS Frosted → Static` へ自動退化。コンテンツは消えない

### Fallback / Backend

| backend | 方式 | 選ばれる環境 |
| :-- | :-- | :-- |
| `webgl` | MinaLiquid が Scene を屈折描画 | デスクトップChromium/Firefoxなど |
| `native` | 要素ごとのCSS backdrop-filter（`mina-liquid-native`） | Safari / iOS / WebGL2未対応 |
| `static` | blurなしの半透明面（`mina-liquid-static`） | native blur非対応の最終フォールバック |

WebGL Context Lost時は自動でnativeへ切り替え、復元時は Scene が再 upload されて最初のフレームが成功するまで GL に戻りません。

### Quality

| quality | blur pyramid | dispersion | pixel budget | 用途 |
| :-- | :-- | :-- | :-- | :-- |
| `high` | 3 levels | 100% | 約311万px | 高性能GPU |
| `balanced` (既定) | 2 levels | 60% | 約207万px | 通常環境 |
| `performance` | なし (mip直接) | 無効 | 約92万px | 低性能端末 |

### V2 からの移行

旧 `MinaGlass` API (`autoInit` / `uploadTexture` / `setSaturate` / `setWhiteness` / `destroy` 等) は **非推奨の互換アダプタ** 経由で MinaLiquid にマッピングされ、警告付きで動作し続けます。旧実装そのものは `legacy/minaui.glass.v2.js` に凍結保存されています。新規コードでは `MinaLiquid` を使用してください。対応表は [LIQUID-GLASS.md](LIQUID-GLASS.md) の「Migration」を参照してください。

## VRC サイトでの使い方

現行ページの WebGL 背景、写真スライドショー、フィルター、Lightbox など既存の固有機能はそのまま残し、MinaUI はリンク層として導入できます。

```html
<link rel="stylesheet" href="../design/minaui/minaui.css">
<script src="../design/minaui/minaui.js" defer></script>
```

既存の `.profile-card` や `.photos-area` を大きく変更せず、親に `.mina-shell`、共通カードに `.mina-card`、ボタンに `.mina-btn` を追加してください。MinaUI は `aqua.*` のクラスを定義しないので、アーカイブ済み AquaCSS2.0 と名前が衝突しません。

## 開発と検証

依存パッケージはありません。Node.js がある環境では次のコマンドで必須トークン、主要セレクタ、括弧の対応、JS の構文を確認できます。

```bash
npm test
npm run build
```

`npm run build` は `dist/minaui.css`、`dist/minaui.js`、`dist/minaui.glass.js`、`dist/minaui-aqua-compat.css`、`dist/legacy/minaui.glass.v2.js` を生成します。リポジトリ内の直接参照にはルートのファイル、配布には `dist/` を使えます。

WebGL Liquid Glass の設計詳細・制約・移行対応表は `LIQUID-GLASS.md`、旧Aqua互換の全対応は `AQUA-MIGRATION.md` にまとめています。

視覚回帰検証 (Chromium headless + readPixels による実変位測定) はローカルサーバー (`python -m http.server 4173`) を起動した上で:

```bash
node scripts/visual-validate.mjs
```

`guide.md` にコンポーネント別の記述例、テーマ設計、アクセシビリティの注意点をまとめています。

## ライセンス

MIT License. 詳細は [LICENSE](LICENSE) を参照してください。
