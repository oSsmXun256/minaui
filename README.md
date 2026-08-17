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

### JavaScript

`minaui.js` は依存関係のない小さな挙動レイヤーです。`defer` で読み込むと自動初期化されます。手動初期化や API 呼び出しもできます。

```js
MinaUI.init();
MinaUI.openModal("#settings");
MinaUI.closeModal("#settings");
MinaUI.setTheme("light");
MinaUI.toast("保存しました", { title: "完了", tone: "success" });
```

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
