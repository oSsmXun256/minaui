# MinaUI ガイド

## 設計方針（Design Philosophy）

MinaUIは「暗い背景に浮かぶ、質感のある面」を言語の核にします。派手さは面そのものと一次色(Pink / Violet)から生まれ、Glass・Glowは**効果のある場所にだけ**掛けます。実装上の判断は常に次の優先順位で行ってください。

1. **面の階層を明確に** — 透過面 → すりガラス → 液体ガラスの3層を混ぜない。どの面も同じblurを掛けるのは階層の消失(とGPUの浪費)。
2. **動きは意味を持つ** — hover・focus・開閉・状態遷移にだけmotionを使う。無限ループする装飾アニメはperformance modeで停止する。
3. **操作対象は動作で示す** — `mina-card--interactive` は浮き上がり + 矢印 + focusリングで操作を伝える。見た目だけ変えて挙動を変えない。
4. **キーボードと支援技術を第一級で** — タブ・ドロップダウン・モーダルの矢印 / Home / End / Escape / Tabトラップはライブラリが担当する。
5. **性能は段階的に落とす** — `quality → balanced → performance` の3段階と、WebGLの `webgl → native → static` backendフォールバックで、見た目を壊さずに負荷を下げる。

MinaUI のコンポーネントは、次の 3 層に分かれています。

1. **トークン** — `--mina-*` 変数。色、余白、角丸、影、ブレークポイントに相当する値を管理します。
2. **プリミティブ** — `mina-container`、`mina-grid`、`mina-flex`、`mina-stack`、`mina-cluster`、`mina-glass`。
3. **コンポーネント** — typography、`mina-card`、`mina-btn`、badge、form、navigation / tabs / dropdown、table / list / stat、feedback（`mina-alert` / `mina-toast` / progress / skeleton）、media / avatar、modal / drawer / tooltip、utilities。

固有のサイト表現は、まずトークンとプリミティブで組み立て、専用セレクタはサイト側に残してください。これにより同じ HTML をテーマ変更や別サイトに再利用できます。

## レイアウト

```html
<div class="mina-container mina-container--wide">
  <div class="mina-grid mina-grid--wide">
    <article class="mina-card">
      <div class="mina-card__body">メインコンテンツ</div>
    </article>
    <aside class="mina-panel">サイドバー</aside>
  </div>
</div>
```

`mina-grid--auto` はカードの最小幅を保ちながら自動で列数を変えます。`mina-grid--2`〜`--4` は明示列、`mina-grid--sidebar` は本文とサイドバー用です。`mina-stack--1`〜`--8` と `mina-gap-*` で余白を調整できます。

### responsive

グリッドは `≤64rem` で2列、`≤48rem` で1列へ落ちます。`mina-grid--auto` を使えばブレークポイントを意識せずに済みます。コンテナは `≤48rem` でフル幅 + 1rem余白になります。ナビゲーションは `≤48rem` でリンク列が折り返し + 横スクロールに変わります。カードやモーダルの余白も同ブレークポイントで `--mina-space-6` → `--mina-space-4` に縮むため、サイト側で個別に上書きする必要はありません。モバイルで高さいっぱいのセクションを作るときは `mina-min-h-screen`(100svh併記) を使います。

## サーフェス

### どの面をどこで使うか

| 目的 | 使うクラス | 例 |
| :-- | :-- | :-- |
| 一覧・本文・情報表示の標準面 | `mina-card` / `mina-panel` | 記事カード、ダッシュボードのウィジェット |
| 背景に写真やグラデーションが透けて見えるべき面 | `mina-card mina-glass` | ヒーローの帯、フローティングナビ、プレビューカード |
| 主役の面に屈折エフェクトを与える(1ページに数枚まで) | `mina-card mina-glass mina-glass--liquid` | プロフィール面、注目コンテンツ |

```html
<section class="mina-glass mina-glass--light mina-p-6">すりガラスの面(透過面より目立たせたい帯など)</section>
<article class="mina-card mina-card--static">
  <div class="mina-card__body">読み取り専用の透過面。blurは掛からない</div>
</article>
<article class="mina-card mina-card--interactive mina-card--glow">
  <header class="mina-card__header">
    <h2 class="mina-card__title">プロフィール</h2>
    <p class="mina-card__subtitle">更新日時を表示</p>
  </header>
  <div class="mina-card__body">本文</div>
  <footer class="mina-card__footer mina-cluster mina-cluster--between">操作</footer>
</article>
```

情報表示だけのカードには `mina-card--static` を付け、リンクやクリック対象には `mina-card--interactive` を付けます。後者だけがhover / focusで浮き上がり、右上の矢印で操作対象だと伝わります。`mina-card--glow` は操作対象の中でも強調したいものに限定してください。

`mina-card--interactive` はホバー時にわずかに浮き、`mina-card--glow` はブランド色の光を追加します。背景写真や WebGL を使う場合は、背景レイヤーを `mina-backdrop`、前景を `mina-shell` の子要素にしてください。

高さの基準は `--mina-shadow-md`(標準面) → `--mina-shadow-lg`(モーダルなど一時的な前景) → `--mina-shadow-sm`(補助面) の3段階です。それ以上大きな影を作らないでください。

### すりガラスと液体ガラス

v0.2.0 から `mina-card` / `mina-panel` はblurを持ちません(透過面)。blurが必要な面だけ `mina-glass` を追加します。WebGL2の屈折表現が要る要素には `mina-glass--liquid` を追加し、`minaui.glass.js` の `MinaGlass.autoInit()` を呼びます。

```html
<article class="mina-card mina-glass mina-glass--liquid">WebGL2で液体ガラスになる</article>
```

低性能端末では `data-style="flat"` / `data-style="solid"` またはPerformance Modeを明示的に使えます。コンポジットレイヤーの明示的な昇格が必要な特殊ケースは `.mina-gpu` を使ってください。

**Composition例 — プロフィールページ**: 背景に `mina-backdrop`(写真) + `mina-scrim`(可読性マスク)。主役のプロフィール面は `mina-glass--liquid`。その下の写真サムネイルは `mina-media-tile`(透過面+角丸)。ボタン群は `mina-btn--glass`。この構成ならGPUレイヤーは液体ガラス1枚とボタン数個だけです。

**悪い使用例**:

- ページ内の全カードに `mina-glass` を付ける → 階層が消え、ブラーは「ないもの」として知覚され、GPUレイヤーだけが増える。標準は `mina-card`。
- 見た目の演出だけ `mina-glass--liquid` を全面に敷く → WebGLはページ全面の背景を描画する仕組みのため、背景写真を渡さないとプレースホルダーが全面を覆う。
- `mina-card--interactive` を全カードに付ける → 何がクリックできるのか分からなくなる。
- `mina-gpu` や `translateZ(0)` を広範囲に使う → レイヤー昇格はメモリを直接消費する。ドロワー移動など一時的な用途に限る。

## パフォーマンス設計

### Performance Mode

`<html data-mina-performance="...">` で3段階を指定できます。省略時は、従来どおり完全なglass表現を維持します。

```html
<html data-mina-performance="performance">
```

- `quality` — 全エフェクト。animated backdrop-filter（`mina-glass-blur-in` 等）も有効。MinaGlassは25-tapシェーダー。
- `balanced` — 静止見た目はqualityのまま、blurアニメーションをopacityフェードに置き換え、MinaGlassは9-tapシェーダーに切り替わります。
- `performance` — blurの縮小・無効化、glow/巨大影の削減、無限系の装飾アニメ停止（skeletonのshimmerを含む）。面の不透明度を上げて可読性を維持します。

`prefers-reduced-motion` が指定された環境では、Performance Modeより先にモーション全体が抑制されます。

### MinaGlassとWebGL液体ガラス

WebGLを使う液体ガラスは `.mina-glass--liquid` / `.mina-glass-liquid` を要素に付け、`minaui.glass.js` を読み込んで `MinaGlass.autoInit()` を呼びます。詳細なオプション（`quality` / `backend` / `renderScale` / `maxPixelCount`）とBackend選択（`webgl` / `native` / `static`）は README の「MinaGlass WebGL」を参照してください。

- WebGL backendは液体ガラス面の外側も含め、**ページ全面を背景テクスチャで描画します**。必ず `background` を渡すか `uploadTexture()` を呼んでください。全面描画が不要なページでは `backend: "native"` を選ぶか、液体ガラス自体を使いません。
- Safari / iOS では `auto` がCSS backdrop-filterの `native` backendを選び、固定キャンバスの座標追跡が非同期スクロールでずれる問題を回避します。
- Firefox や WebGL2が使えない環境でも native/static へ自動フォールバックし、Context Lostでもページが壊れません。復元時は自動でWebGLへ再構築します。
- scrollはdirtyフラグ経由で1つのRAFにまとめられ、liquid要素自体のリサイズもResizeObserverで追跡されます。`destroy()` でリスナー・RAF・WebGLリソースがすべて解放されます。
- Liquid Glass以外の `.mina-glass` 全般も Performance Mode の対象です（blur削減、影削減など）。

### Layer契約

Liquid Glass用キャンバスを含む重ね順は変数で定義されています。サイト固有のz-indexハックの代わりにこれらを使ってください。

```css
--mina-z-backdrop-deep /* 背景オーラ */ < --mina-z-backdrop /* 背景写真 */
< --mina-z-glass-canvas /* WebGLキャンバス */ < 通常コンテンツ < --mina-z-sticky
< dropdown < drawer < overlay < modal < toast < tooltip
```

## テーマとブランド

属性は `<html>`、`<body>`、ページ単位のラッパーのいずれに置いても構いません。

```html
<div data-theme="light" data-style="flat" data-accent="cyan">
  <div class="mina-card">同じクラスでライト・フラット表示</div>
</div>
```

サイト独自のトークンは `.mina-theme-custom` のようなラッパーで上書きすると、他のページへの影響を避けられます。

```css
.mina-theme-custom {
  --mina-bg: #07111f;
  --mina-primary: #38bdf8;
  --mina-primary-soft: rgba(56, 189, 248, .18);
}
```

## フォーム

```html
<div class="mina-field">
  <label class="mina-field__label" for="name">表示名</label>
  <input id="name" class="mina-input" placeholder="お刺身くん">
  <span class="mina-field__hint">プロフィールに表示されます。</span>
</div>

<label class="mina-check">
  <input type="checkbox" checked>
  <span>公開プロフィールに表示</span>
</label>

<label class="mina-switch">
  <input type="checkbox" checked>
  <span class="mina-switch__track"><span class="mina-switch__thumb"></span></span>
</label>
```

エラー時は `aria-invalid="true"` と `.mina-field__error` を併用します。ラベルを省略せず、アイコンだけのボタンには `aria-label` を付けてください。

## フィードバック

インラインの状態説明には `mina-alert`、一時的な通知には `mina-toast`、処理量には `mina-progress`、読み込み中のプレースホルダーには `mina-skeleton` を使います。

```html
<div class="mina-alert mina-alert--success" role="status">
  <span class="mina-alert__icon" aria-hidden="true">✓</span>
  <div class="mina-alert__content">
    <p class="mina-alert__title">保存しました</p>
    <p class="mina-alert__message">プロフィールの変更が反映されています。</p>
  </div>
</div>
<div class="mina-progress" role="progressbar" aria-valuenow="70" aria-valuemin="0" aria-valuemax="100">
  <span class="mina-progress__value" style="--mina-progress: 70%"></span>
</div>
```

## タブ、ドロップダウン、モーダル

タブは `data-mina-tabs` を親に置き、タブの `data-mina-tab` とパネルの `id` を一致させます。

```html
<div data-mina-tabs>
  <div class="mina-tabs">
    <button class="mina-tabs__tab" data-mina-tab="overview" aria-selected="true">概要</button>
    <button class="mina-tabs__tab" data-mina-tab="activity" aria-selected="false">活動</button>
  </div>
  <section id="overview" class="mina-tabs__panel">概要の内容</section>
  <section id="activity" class="mina-tabs__panel" hidden>活動の内容</section>
</div>
```

モーダルとドロワーは、MinaUI の JS が Escape、フォーカストラップ、起点へのフォーカス復帰、背面スクロールの固定、バックドロップ、`aria-expanded` / `aria-hidden` の切り替えを提供します。モーダルは `role="dialog"`、`aria-modal="true"`、`aria-labelledby` を付け、特殊な例外だけ `data-mina-focus-trap="false"` を指定してください。タブは左右（縦配置では上下）の矢印キーと `Home` / `End`、ドロップダウンは矢印キー・`Home` / `End`・`Escape` で操作できます。

```html
<button class="mina-btn mina-btn--primary" data-mina-toggle="#contact">連絡する</button>
<section id="contact" class="mina-modal" aria-hidden="true">
  <div class="mina-modal__dialog" role="dialog" aria-modal="true">
    <div class="mina-modal__body">フォーム</div>
    <footer class="mina-modal__footer">
      <button class="mina-btn" data-mina-close>閉じる</button>
    </footer>
  </div>
</section>
```

## VRC 移行時の境界

`vrc.ossmxun.net` の現在のデザインは、固定 WebGL キャンバス、写真スライドショー、写真フィルター、Lightbox、リサイズ処理を持つため、それらを MinaUI のコンポーネントに置き換える必要はありません。

- ページ全体に `.mina-shell` を追加し、背景は `.mina-backdrop` として保持する。
- 既存 `.profile-card`、`.photo-card` のレイアウトはサイト CSS に残し、表面・ボタン・タグだけ MinaUI のクラスへ寄せる。
- `data-style="flat"` を指定すれば、MinaUI の影とブラーを無効にして写真の視認性を優先できる。
- `prefers-reduced-motion` は MinaUI と既存エフェクトの両方で尊重する。

旧AquaCSS 2.0のセレクタ、変数、エフェクト、AquaGlass APIの全対応表は `AQUA-MIGRATION.md` を参照してください。互換レイヤーが必要な段階移行では `minaui-aqua-compat.css` を `minaui.css` の後に読み込み、移行完了後に外します。WebGLを使う場合は `minaui.glass.js` をページ単位で追加します。

## アクセシビリティ

フォーカスリングは `:focus-visible` で常に表示されます。コントラストを保つため、透明度の高いテキストには `mina-text-muted` / `mina-text-subtle` を用途に応じて選びます。装飾的な背景は `aria-hidden="true"` とし、モーダルは `role="dialog"`、`aria-modal="true"`、`aria-labelledby` を設定してください。
