# MinaUI

MinaUI は、Web サイト・ダッシュボード・ポートフォリオ・ランディングページまで同じ API で組み立てられる、依存関係のない汎用 CSS / JS UI フレームワークです。

デフォルトは、`vrc.ossmxun.net` のような暗い背景、ピンク〜紫のグラデーション、半透明のガラス面を持つビジュアルです。`data-theme="light"`、`data-style="flat"`、`data-accent="cyan"` などを切り替えるだけで、同じコンポーネントを別のプロダクトにも使えます。

## クイックスタート

基本配布は `minaui.css` と `minaui.js` の 2 つです。JS は任意で、CSS コンポーネントは JS なしでも表示できます。WebGL液体ガラスが必要なページだけ `minaui.glass.js` を追加し、AquaCSS 2.0から段階移行する間だけ `minaui-aqua-compat.css` を追加します。

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

`demo/index.html` に、`vrc.ossmxun.net` の構成を参考にした写真背景、WebGL liquid glass のプロフィール面、メモリー写真、静的カードと操作カード、タブ、モーダル、toastをまとめています。デモ自身のレイアウトCSSは持たず、MinaUI の共通クラス/APIだけで組み立てています。

リポジトリ直下で静的サーバーを起動し、`http://localhost:4173/demo/` を開いて確認できます。

```bash
python -m http.server 4173
```

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

- 通常のカードやパネルは `mina-card` / `mina-panel`。半透明面と `--mina-shadow-md` を使いますが、`backdrop-filter` は要求しません。
- 背景の屈折・ぼかしが必要な面だけ `mina-glass` を追加します（例: `mina-card mina-glass`）。
- `mina-shadow-sm` は補助面、`mina-shadow-md` は標準面、`mina-shadow-lg` はモーダルや一時的な前景レイヤー向けです。
- `mina-card--interactive` は操作対象のカードだけに付け、ホバー時の浮き上がりを明示します。装飾目的で全カードに付けないでください。
- `mina-card--static` は情報表示用であることを明示します。リンクやボタンには `mina-card--interactive` を付け、矢印・hover・focusで操作対象だと伝えます。

この基準は、見た目を保ちながら blur と大きな影の数を必要最小限にするためのものです。

### JavaScript

`minaui.js` は依存関係のない小さな挙動レイヤーです。`defer` で読み込むと自動初期化されます。手動初期化や API 呼び出しもできます。

```js
MinaUI.init();
MinaUI.openModal("#settings");
MinaUI.closeModal("#settings");
MinaUI.setTheme("light");
MinaUI.toast("保存しました", { title: "完了", tone: "success" });
```

モーダルとドロワーは開いたときに最初の操作可能要素へフォーカスし、`Tab` / `Shift+Tab` をレイヤー内に閉じ込め、閉じたときに起点へフォーカスを戻します。`Escape` でも閉じられます。無効化する必要がある特殊なケースだけ `data-mina-focus-trap="false"` を指定してください。タブは左右（縦配置では上下）の矢印キーと `Home` / `End`、ドロップダウンは矢印キー・`Home` / `End`・`Escape` に対応します。

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

### Default glassと軽量モード

`.mina-card` / `.mina-panel` はMinaUIの元の半透明glass面・ボーダー・影・backdrop-filterをデフォルトで維持します。OpenGL系の液体ガラスが必要な面には、さらに `.mina-glass--liquid` を付けて `minaui.glass.js` を読み込みます。

```html
<!-- MinaUI標準のfrosted glass -->
<div class="mina-card">…</div>

<!-- WebGL2の液体ガラス -->
<div class="mina-card mina-glass mina-glass--liquid">…</div>
```

カードを多数並べる場合や低性能端末では `data-style="flat"` / `data-style="solid"`、または `data-mina-performance="performance"` を明示的に選んでください。レイヤー昇格が必要な特殊ケースのみ `.mina-gpu` を使います。

### Performance Mode

ルート要素でパフォーマンス層を指定できます。

```html
<html data-mina-performance="balanced">
```

| 値 | 挙動 |
| :-- | :-- |
| `quality` | 全エフェクト。animated backdrop-filterも有効 |
| `balanced` | 見た目はqualityと同じ。ただしblurアニメーションはopacityフェードへフォールバック |
| `performance` | blur縮小/無効化、glow・巨大影の削減、無限装飾アニメ停止、不透明度の高い面で可読性を維持 |

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

## MinaGlass WebGL（minaui.glass.js）

```js
const glass = MinaGlass.autoInit({
  background: "/images/bg.jpg", // レンズ源
  quality: "high",              // high | balanced | performance（既定）
  backend: "auto",              // auto | webgl | native | static
  renderScale: 1,               // devicePixelRatio への係数
  maxPixelCount: 1920 * 1080    // バックバッファのピクセル数上限
});
```

既存API（`uploadTexture()`、`setSaturate()`、`setWhiteness()`、`maxCards`、`render({ cards })`、`startRender(fn)`、`destroy()`）とAquaGlass互換エイリアスは維持されています。

### Backend

| backend | 方式 | 選ばれる環境 |
| :-- | :-- | :-- |
| `webgl` | 全画面WebGL2キャンバスで屈折+blur | デスクトップChromium/Firefoxなど |
| `native` | 要素ごとのCSS backdrop-filter（`mina-liquid-native`） | Safari / iOS / WebGL2未対応 |
| `static` | blurなしの半透明面（`mina-liquid-static`） | native blur非対応の最終フォールバック |

`auto` では機能検出＋限定されたEngine判定（WebKitの非同期スクロール問題のみ）で選択します。WebGL Context Lost時は自動でnativeへ切り替え、復元時に再構築します。

### Quality

| quality | blurタップ数 | 彩度処理 | 用途 |
| :-- | :-- | :-- | :-- |
| `high` | 25 tap（5×5） | RGB↔HSL 往復（元の見た目） | 高性能GPU |
| `balanced` | 9 tap（3×3）+ mipmap LOD | luma近似 | 負荷と品質のバランス |
| `performance` | 1 tap（mipのみ） | luma近似 | 低性能端末 |

### renderScale / maxPixelCount

CSS上のキャンバスサイズは常にビューポートと同じで、内部バックバッファだけを縮小します。Retina/iPhoneでも描画ピクセル数が `maxPixelCount`（既定 約207万 = 1920×1080）を超えないよう自動でスケールされます。

```js
MinaGlass.autoInit({ renderScale: 0.75, maxPixelCount: 1280 * 720 });
```

### スクロールとリサイズの負荷

scrollイベントはdirtyフラグだけを立て、1つの `requestAnimationFrame` 内で1回の `getBoundingClientRect()` → uniform更新 → 描画にまとめられます。リサイズはResizeObserverで監視され、リスナーの二重登録はありません。`destroy()` でscroll/resizeリスナー、ResizeObserver、RAF、WebGLリソースをすべて解放します。

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

`npm run build` は `dist/minaui.css`、`dist/minaui.js`、`dist/minaui.glass.js`、`dist/minaui-aqua-compat.css` の4成果物を生成します。リポジトリ内の直接参照にはルートのファイル、配布には `dist/` を使えます。

WebGLと旧Aqua互換を含むビルドでは `dist/minaui.glass.js` と `dist/minaui-aqua-compat.css` も生成されます。全セレクタ・変数・挙動の対応は `AQUA-MIGRATION.md` にまとめています。

`guide.md` にコンポーネント別の記述例、テーマ設計、アクセシビリティの注意点をまとめています。

## ライセンス

MIT License. 詳細は [LICENSE](LICENSE) を参照してください。
