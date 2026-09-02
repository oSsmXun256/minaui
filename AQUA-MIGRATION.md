# AquaCSS 2.0 → MinaUI 移行対応表

この文書は、2026-08-18 時点で vrc.ossmxun.net と ossmxun.net に残っている AquaCSS 2.0 の実ファイルを読み取り、MinaUI の公開 API と対応づけた監査記録です。旧ファイルを名前だけ置換するのではなく、見た目・ユーティリティ・アニメーション・WebGL の挙動を分類し、移行後の実装と退避方法を明記しています。

## 調査対象

| レイヤー | 実ファイル | 内容 | VRC/OSS差分 |
| :--- | :--- | :--- | :--- |
| Design | vrc.ossmxun.net/aqua.design.css、ossmxun.net/aqua.design.css | 変数、glass、button、input、card、panel、slider、badge、text、avatar、grid、contribution、scrollbar | OSS側は .aqua-glass のpaint containment、.aqua-glass-liquid の透明化を追加 |
| Style | 両repoの aqua.style.css | container、display/flex、spacing、size、border、text、shadow、position、overflow、cursor、transition、transform、background、color、responsive | 同一 |
| Effect | vrc.ossmxun.net/aqua.effect.css、ossmxun.net/aqua.effect.css | 51公開クラス、27 keyframes、reduced-motion | OSS側はglass hoverのFirefox向け再ラスタライズ対策を追加 |
| WebGL | 両repoの aqua.glass.js | AquaGlass、WebGL2、液体レンズ、texture、saturate/whiteness、resize、render | OSS側は4カード/高品質サンプリング/常時loop、VRC側は2カード/on-demand |
| 利用例 | 両repoのHTML、README | 旧リンク、クラスの実使用、ページ固有の背景・写真・Lightbox | VRCはMinaUI移行済みでAquaはアーカイブ参照、OSSはMinaUIサイト側で使用 |

ソースの公開セレクタ数は Design 51、Style 202、Effect 51（重複を含む）です。互換レイヤーはこれらのソースをオプトインで保持し、通常の MinaUI バンドルには旧名前空間を含めません。

## 変数対応

| AquaCSS 2.0 | MinaUI | 移行上の注意 |
| :--- | :--- | :--- |
| --aqua-primary、--aqua-primary-light、--aqua-primary-dark | --mina-primary、--mina-primary-hover、--mina-primary-active | 色の役割を明示化。--mina-gradient-primary も利用可 |
| --aqua-grad-1..3 | --mina-primary、--mina-secondary、--mina-accent | グラデーションの中間色 |
| --aqua-text-primary/secondary/muted/inverse | --mina-fg、--mina-primary-contrast、--mina-fg-muted、--mina-fg | MinaUI は背景に依存しない foreground token |
| --aqua-glass-bg/light/dark | --mina-glass-bg、--mina-glass-bg-light、--mina-surface-muted | data-style で glass/solid/flatを切替 |
| --aqua-glass-border/light/dark | --mina-glass-border、--mina-border-strong、--mina-border-subtle | light/darkの明度をテーマに追従 |
| --aqua-glass-shadow、--aqua-glass-inner-shadow | --mina-shadow-md、--mina-glass-border | inner shadowはMinaUI surfaceへ統合 |
| --aqua-glass-blur | --mina-glass-blur、--mina-glass-saturate | data-style="flat" はblur/saturateも0/100% |
| --aqua-gradient-primary/secondary | --mina-gradient-primary、--mina-gradient-surface | data-accentでprimaryを変更可能 |
| --aqua-font-family、--aqua-font-mono | --mina-font-sans、--mina-font-mono | 日本語フォールバックを含む |
| --aqua-shadow-sm/md/lg/xl | --mina-shadow-sm/md/lg | MinaUIのdark/light tokenへ変換 |
| --aqua-radius-sm/md/lg/xl/pill | --mina-radius-sm/md/lg/xl/pill | 同名スケール。utilityのroundedはMina tokenを利用 |

minaui-aqua-compat.css の末尾にこの変数ブリッジを定義しています。旧クラスを残したままサイト側で --mina-* を変更しても、旧見た目を段階的にテーマ移行できます。

## Designレイヤー対応

| Aqua selector | MinaUI selector / 実装 | 対応 |
| :--- | :--- | :--- |
| .aqua-glass | .mina-glass | 直接対応。Mina token、テーマ、focus境界を追加 |
| .aqua-glass-light / .aqua-glass-dark | .mina-glass--light / .mina-glass--dark | 直接対応 |
| .aqua-glass-sm / .aqua-glass-lg | .mina-glass--sm / .mina-glass--lg | 直接対応 |
| .aqua-glass-liquid | .mina-glass--liquid または .mina-glass-liquid | WebGL canvasを背面に置く透明surface。minaui.glass.js が両名を検出 |
| #aqua-glcanvas | #mina-glcanvas | MinaGlassはMina IDを優先し、旧IDもfallbackとして受理 |
| .aqua-btn | .mina-btn | 直接対応。disabled、focus、hoverを強化 |
| .aqua-btn-primary / .aqua-btn-glass | .mina-btn--primary / .mina-btn--glass | 直接対応 |
| .aqua-btn-pill / .aqua-btn-white | .mina-btn--pill / .mina-btn--white | 直接対応 |
| .aqua-btn-sm/md/lg | .mina-btn--sm/md/lg | --mdを新設してサイズ指定を完全対応 |
| .aqua-input + child input | .mina-input-shell + child input | 旧wrapper構造を維持する名前付きMina primitive。通常フォームは .mina-input を推奨 |
| .aqua-input-icon / .aqua-input-group | .mina-input-shell__icon / .mina-input-group | wrapperの意味をBEM化 |
| .aqua-card | .mina-card | header/body/footerへ分解可能。interactive/glow variantを追加 |
| .aqua-card-header/title/subtitle/body | .mina-card__header/title/subtitle/body | 直接対応 |
| .aqua-panel | .mina-panel、浮遊位置が必要なら .mina-panel--floating | Aquaのabsolute挙動は汎用surfaceと分離 |
| .aqua-slider-container/header/label/value | .mina-slider-container/header/label/value | 直接対応 |
| input[type=range] | .mina-range または .mina-slider | native全体汚染をやめ、class scopeへ |
| .aqua-badge | .mina-badge | 直接対応 |
| .aqua-badge-outline/glass | .mina-badge--outline/glass | 直接対応 |
| .aqua-text-primary/secondary/muted/inverse | .mina-text-primary/secondary/muted/subtle | inverseはforegroundへ統合。mina-text-subtleを追加 |
| .aqua-heading-1/2/3 | .mina-heading-1/2/3、または .mina-h1/h2/h3 | 直接対応 |
| .aqua-divider / .aqua-divider-light | .mina-divider / .mina-divider--light | vertical variantも追加 |
| .aqua-avatar/sm/lg | .mina-avatar / .mina-avatar--sm/lg | MinaUIにはxlも追加 |
| .aqua-grid / .aqua-grid-2/3 | .mina-grid / .mina-grid-2/3、新規推奨は .mina-grid--2/3/auto | Aquaのauto-fit挙動はmina-grid-2/3で保持 |
| .aqua-flex-center/between | .mina-flex-center/between または .mina-flex--center/between | 両方を公開 |
| .aqua-contrib-grid/cell | .mina-contrib-grid/cell + .is-active / --active | GitHub風 contribution表示を追加 |
| .aqua-scrollbar-styled/hidden | .mina-scrollbar-styled/hidden | Firefox scrollbarも対応 |

### Design挙動の差分

- MinaUIの .mina-card は flex column で、Aquaの固定24px paddingを __body へ移しました。旧HTMLを保つ場合はcompatを使用してください。
- Aquaの .aqua-panel はabsolute、MinaUIの .mina-panel は通常flowです。absoluteが仕様の場合だけ .mina-panel--floating を付けます。
- Aquaのrangeは全inputへ適用されます。MinaUIは .mina-range / .mina-slider だけに適用し、他のフォームを壊しません。
- Aquaのliquid surfaceはWebGLレンダリング用に背景/blur/box-shadowを除去します。MinaUIも同じ挙動を .mina-glass--liquid で提供します。旧OSSの .aqua-glass にあった無条件の contain: layout paint / translateZ(0)（強制レイヤー化）は廃止し、contain: layout のみに縮小しました。レイヤー昇格が必要な場合は .mina-gpu を明示的に付けてください。canvasのpointer-events無効化とz-index契約（--mina-z-glass-canvas）は MinaUI の #mina-glcanvas が引き継いでいます。

## Style utility対応

以下は全て MinaUI に移行済みです。値の並びは AquaCSS 2.0 と同じで、Mina tokenへ接続しています。

| Aqua selectors | MinaUI selectors |
| :--- | :--- |
| .aqua-container、-xs/-sm/-md/-lg/-xl/-2xl、-fluid | .mina-container、--xs/--sm/--md/--lg/--xl/--2xl、--fluid |
| .aqua-block/inline-block/inline/inline-flex/inline-grid/flex/grid/hidden | .mina-block/inline-block/inline/inline-flex/inline-grid/flex/grid/hidden |
| .aqua-flex-row/row-reverse/col/col-reverse | .mina-flex-row/row-reverse/col/col-reverse |
| .aqua-flex-wrap/wrap-reverse/nowrap | .mina-flex-wrap/wrap-reverse/nowrap |
| .aqua-flex-1/auto/initial/none | .mina-flex-1/auto/initial/none |
| .aqua-items-start/end/center/baseline/stretch | .mina-items-start/end/center/baseline/stretch |
| .aqua-justify-start/end/center/between/around/evenly | .mina-justify-start/end/center/between/around/evenly |
| .aqua-gap-0/2/4/6/8 | .mina-gap-0/2/4/6/8 |
| .aqua-p-0/2/4/6/8、.aqua-px-0/2/4/6/8、.aqua-py-0/2/4/6/8 | .mina-p-*、.mina-px-*、.mina-py-*（同値） |
| .aqua-m-0/2/4/6/8、.aqua-mx-0/2/4、.aqua-mx-auto、.aqua-my-0/2/4 | .mina-m-*、.mina-mx-*、.mina-mx-auto、.mina-my-* |
| .aqua-w-full/screen/auto、.aqua-h-full/screen/auto、.aqua-min-h-screen | .mina-w-full/screen/auto、.mina-h-full/screen/auto、.mina-min-h-screen |
| .aqua-max-w-full、.aqua-max-h-full | .mina-max-w-full、.mina-max-h-full |
| .aqua-rounded-none/sm/(default)/md/lg/xl/2xl/full、rounded-t/b-lg | .mina-rounded-none/sm/(default)/md/lg/xl/2xl/full、rounded-t/b-lg |
| .aqua-border/0/2、border-t/b/l/r、border-color/light/dark | .mina-border/0/2、border-t/b/l/r、border-color/light/dark |
| .aqua-text-xs/sm/base/lg/xl/2xl、font-thin..extrabold | .mina-text-*、.mina-font-* |
| .aqua-text-left/center/right/justify、italic/no-italic、uppercase/lowercase/capitalize | 同名 .mina-* |
| .aqua-tracking-tight/normal/wide、.aqua-leading-tight/normal/relaxed/loose | 同名 .mina-* |
| .aqua-shadow-none/sm/(default)/md/lg/xl | .mina-shadow-none/sm/(default)/md/lg/xl |
| .aqua-opacity-0/25/50/75/100 | .mina-opacity-0/25/50/75/100 |
| .aqua-static/fixed/absolute/relative/sticky、inset/top/right/bottom/left-0、z-0/10/20/30/40/50 | 同名 .mina-* |
| .aqua-overflow-auto/hidden/visible/scroll、overflow-x/y-* | 同名 .mina-* |
| .aqua-cursor-pointer/default/text/move/not-allowed | 同名 .mina-* |
| .aqua-transition、transition-colors/opacity/transform/shadow | 同名 .mina-* |
| .aqua-scale-95/100/105、translate-y-1/2、-translate-y-1/2、rotate-45/90/180 | 同名 .mina-* |
| .aqua-bg-transparent/white/black/primary/gradient/glass/glass-light/glass-dark | 同名 .mina-* |
| .aqua-text-white/black | .mina-text-white/black |
| .aqua-hover-opacity-80/scale-105/shadow | 同名 .mina-* |
| .aqua-focus-outline/ring | 同名 .mina-*（focus-visibleも利用可） |
| .aqua-md:hidden/flex/flex-col/p-4/text-sm | .mina-md:hidden/flex/flex-col/p-4/text-sm |
| .aqua-sm:hidden/flex/flex-col/p-2/text-xs/w-full | .mina-sm:hidden/flex/flex-col/p-2/text-xs/w-full |

aqua.style.cssにしか存在しない aqua-md / aqua-sm の媒体条件も、MinaUIでは48rem/40remで同じモバイル段階を提供しています。

## Effect対応

| Aqua selector | MinaUI selector | 挙動 |
| :--- | :--- | :--- |
| .aqua-fade-in/out | .mina-fade-in/out | opacity 0↔1 |
| .aqua-slide-in-up/down/left/right | .mina-slide-in-up/down/left/right | 20px相当の移動＋fade |
| .aqua-slide-out-up/down/left/right | .mina-slide-out-up/down/left/right | 逆方向の移動＋fade |
| .aqua-scale-in/out/up/down | .mina-scale-in/out/up/down | 0.95/0.9 scale |
| .aqua-pulse | .mina-pulse | opacity pulse |
| .aqua-glow/glow-glass | .mina-glow/glow-glass | primary/glass shadow pulse |
| .aqua-bounce/bounce-in | .mina-bounce/bounce-in | translate/overshoot |
| .aqua-glass-blur-in | .mina-glass-blur-in | background/blur/borderを導入 |
| .aqua-glass-shimmer | .mina-glass-shimmer | glass gradient shimmer |
| .aqua-shimmer | .mina-shimmer | loading shimmer |
| .aqua-hover-lift/grow/dim/bright | .mina-hover-lift/grow/dim/bright | hover transform/opacity/shadow |
| .aqua-spin/spin-slow | .mina-spin/spin-slow | 1s/2s rotation |
| .aqua-backdrop-blur(-md/-lg) | .mina-backdrop-blur(-md/-lg) | 10/16/token blur |
| .aqua-transition-fast/base/slow/slower | 同名 .mina-* | duration 150/300/500/700ms |
| .aqua-ease-linear/in/out/in-out/bounce | 同名 .mina-* | timing function |
| .aqua-gradient-animated | .mina-gradient-animated | background-position shift |
| .aqua-text-shimmer | .mina-text-shimmer | currentColor text gradient |
| .aqua-active | .mina-active | scale(.98) |
| .aqua-focus-visible | .mina-focus-visible | visible outline |
| .aqua-disabled | .mina-disabled | opacity/cursor/pointer-events |
| .aqua-duration-100/200/300/500/700/1000 | 同名 .mina-* | animation-duration |
| @keyframes aqua-*（27種） | @keyframes mina-*（27種） | MinaUI内部keyframeとして再実装。MinaUI固有の mina-slide-up も併設 |

MinaUIの全体 prefers-reduced-motion: reduce は旧Effectと同じくanimation iterationを止め、transitionを短縮します。

## AquaGlass WebGL対応

| AquaGlass 2.0 API/挙動 | MinaGlass API/挙動 |
| :--- | :--- |
| new AquaGlass(options) | new MinaGlass(options) |
| options.canvas / #aqua-glcanvas | options.canvas / #mina-glcanvas（旧IDfallback） |
| WebGL2 context、antialias、premultipliedAlpha、preserveDrawingBuffer、alpha | 同じ |
| saturate（既定1.2） | 同じ。setSaturate(0..2) |
| whiteLevel / setWhiteness(0..1) | 同じ |
| uploadTexture(image) | 同じ。cover UV、flip Y、linear/clamp |
| render({cards}) | 同じ。CSS pxのcenter/halfをDPR変換 |
| cardPos/cardHalf legacy single card | 同じ |
| cards.slice(0, 2)（Aqua標準） | maxCards（既定4、最大8）。maxCards: 2で標準再現 |
| startRender(renderFn) | 同じ。常時loopが必要な場合に明示利用 |
| AquaGlass.autoInit({background}) | MinaGlass.autoInit({background, maxCards}) |
| .aqua-glass-liquidを最大2要素収集 | .mina-glass-liquid / .mina-glass--liquid / .aqua-glass-liquidを収集 |
| scroll/resize/texture更新 | 同じ。Mina版はrequestRenderでon-demand、resize時に再収集 |
| destroy/getCanvas/getContext | 同じ |
| CommonJS module.exports = AquaGlass | CommonJS module.exports = MinaGlass。browserではwindow.MinaGlassと旧window.AquaGlass alias |

WebGL2がない環境ではインスタンスを作成して警告を出すだけで、ページのCSS glass表示を壊しません。WebGL moduleは通常の minaui.js に混ぜず、必要なページだけ minaui.glass.js を読み込みます。

## 互換レイヤー

minaui-aqua-compat.css は、旧セレクタと27 keyframesを保った退避用ファイルです。MinaUI本体の後に読み込みます。

    <link rel="stylesheet" href="./minaui.css">
    <link rel="stylesheet" href="./minaui-aqua-compat.css">

互換レイヤーにはAquaの実ソースを隔離して収録し、末尾のtoken bridgeで --mina-* へ接続しています。新規ページでは使用せず、既存HTMLを段階的に次の順で移行します。

1. minaui.cssを追加する。
2. 影響範囲の旧Aquaクラスを対応表の .mina-* へ変更する。
3. JSの AquaGlass を MinaGlass、canvas IDを mina-glcanvas へ変更する。
4. minaui-aqua-compat.cssを外し、Aquaファイル（aqua.design.css、aqua.style.css、aqua.effect.css、aqua.glass.js）をactive HTMLから削除する。
5. npm test && npm run build でcompatとdistの検証を行う。

## VRC/OSS更新手順

### vrc.ossmxun.net

- 既存のprofile/photo/diamond/filter/lightbox/WebGL構造はサイト固有として保持する。
- minaui.css、minaui.js、必要時のみ minaui.glass.js をリンクする。
- mina-glass-liquidとMinaGlass.autoInitを使う。Aquaをrollback参照する場合だけcompatを追加する。
- MIGRATION.mdのAcceptance checks（Aqua active refなし、assets、filter、lightbox、resize）を再実行する。

### ossmxun.net

- index.html / contact.htmlの共通UIはminaui.cssのmina-*で構築する。
- mina-site.cssはサイト固有の背景・カード位置だけを上書きし、Mina tokenを優先する。
- Aquaファイルをactive link/scriptへ戻さない。rollbackが必要な短期間だけcompatを読み込む。

### 破壊的変更

- minaui.css単体には .aqua-* を含めない。旧クラスのまま動かすには明示的にcompatを追加する。
- .mina-panelは通常flow、旧Aquaのabsolute panelが必要なら .mina-panel--floating を付ける。
- rangeはnative input全体ではなく .mina-range / .mina-slider に限定した。
- .mina-glassのデフォルトはdark glassで、Aquaの青いprimaryはdata-accentまたはtoken overrideで再現する。
- MinaGlassの自動収集上限は既定4。Aqua標準の2枚と厳密に揃える場合は maxCards: 2 を渡す。

## 検証

npm test はMina coreの必須API、compatの必須旧セレクタ、全Aqua keyframeのMina対応、CSS/JS/compatの括弧、JS構文を確認します。npm run build は次の4成果物をdist/へコピーします。

- dist/minaui.css
- dist/minaui.js
- dist/minaui-aqua-compat.css

この対応表とcompatは、旧Aquaソースを削除する前にレビューできる移行契約です。新規開発ではMinaUIのsemanticsを利用し、compatは削除できる一時的な境界として扱います。
