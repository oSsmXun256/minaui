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

```js
const liquid = new MinaLiquid({
  source: { type: "image", src: "/background.jpg" },
  quality: "balanced",   // high | balanced | performance
  glass: {
    refraction: 0.22,    // 縁の屈折
    blur: 12,            // 透過blur
    dispersion: 0.045,   // 極小のRGB分散
    fresnel: 0.22        // 縁のリムライト
  }
});
```

DOM 側は geometry を渡すだけです:

```html
<div class="mina-liquid" data-mina-liquid>主役コンテンツ</div>

<!-- 個別上書き -->
<div class="mina-liquid" data-mina-refraction="1.4" data-mina-blur="16">…</div>
```

### 動作の要点

- **中央はフラット**: 屈折・Fresnel・blur増加はエッジ近傍だけ。中央は背景をほぼそのまま透す
- **blur pyramid**: Scene から 1/2, 1/4, 1/8 のぼかしレベルを事前生成。ピクセルごとの多段 tap はしない
- **dirty rendering**: 常時RAFなし。scroll / resize / 要素変化時のみ1フレームにまとめて描画
- **要素カリング**: viewport 外・`display:none`・0サイズの要素は処理しない。表示中の要素だけを uniform に渡す
- **fallback**: WebGL2なし / Safari・iOS / context lost / shader失敗のすべてで `CSS Frosted → Static` へ自動退化。コンテンツは消えない

### Fallback / Backend

| backend | 方式 | 選ばれる環境 |
| :-- | :-- | :-- |
| `webgl` | MinaLiquid が Scene を屈折描画 | デスクトップChromium/Firefoxなど |
| `native` | 要素ごとのCSS backdrop-filter（`mina-liquid-native`） | Safari / iOS / WebGL2未対応 |
| `static` | blurなしの半透明面（`mina-liquid-static`） | native blur非対応の最終フォールバック |

WebGL Context Lost時は自動でnativeへ切り替え、復元時に再構築します。

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

`guide.md` にコンポーネント別の記述例、テーマ設計、アクセシビリティの注意点をまとめています。

## ライセンス

MIT License. 詳細は [LICENSE](LICENSE) を参照してください。
