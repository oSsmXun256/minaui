# MinaLiquid V3 — Liquid Glass ガイド

MinaUI v0.3.0 の Liquid Glass は、旧 MinaGlass (V2) を継ぎ足したものではなく、**描画原理から再設計された専用レンダラ MinaLiquid** です。このドキュメントは設計思想・責務分離・API・移行方法をまとめた一次情報です。

---

## 1. 3つのサーフェスレベル

| レベル | 名称 | 実装 | 用途 | 置いてよい数 |
| :-- | :-- | :-- | :-- | :-- |
| Level 1 | **Surface** | 半透明背景 + ボーダー (`.mina-card` / `.mina-panel`) | 標準のカード・パネル・フォーム | 無制限 |
| Level 2 | **Frosted Glass** | CSS `backdrop-filter` (`.mina-glass`) | ナビ、ヒーローパネル、モーダルなど実DOM背面のブラー | 1画面に数枚 |
| Level 3 | **Liquid Glass** | WebGL2 専用レンダラ (`MinaLiquid`, `.mina-liquid`) | Hero / Showcase / 主役UIの特別表現 | 1〜数枚 (`maxElements` 既定8) |

Liquid Glass は MinaUI の標面ではなく**オプション機能**です。通常のUIには Level 1 / Level 2 を使ってください。

---

## 2. WebGL Liquid Glass の制約 (最重要)

**WebGL は任意の DOM を backdrop-filter の代替にできません。**

WebGL Canvas は、背後にある HTML / Text / CSS 描画結果をテクスチャとして読み取れません。そのため「任意のWebサイトのDOM全体をLiquid Glass化する」ことは不可能であり、MinaLiquid は設計として試みません。

MinaLiquid が参照できるのは、**レンダラ自身が管理する Scene** だけです。

### Liquid Glass が参照できる source

| type | 内容 |
| :-- | :-- |
| `image` | 画像URL (`{ type: "image", src: "/bg.jpg" }`) |
| `video` | 動画 (`{ type: "video", src: "/bg.mp4" }` または `el`) |
| `canvas` | 2D canvas 要素 (`{ type: "canvas", el: canvasEl }`) |
| `gradient` | レンダラ内蔵のグラデーション生成 (`stops`, `angle`) |

DOM を capture しているわけでは**ありません**。Liquid Glass の背後に置くのは、この Scene を描画した WebGL キャンバス(またはCSS側で同じ画像を敷いた背景)である必要があります。

### 推奨用途

- 写真・動画・グラデーション背景の上に浮かぶ **Hero / プロフィール / Showcase カード**
- 背景画像が MinaLiquid の `source` として渡せる構成のページ

### 非推奨用途

- 通常のカード・フォーム・リスト (Level 1 で十分)
- 背景が「実際のDOM」である必要があるUI (Level 2 の `backdrop-filter` を使う)
- 1画面に大量配置する使い方
- テキスト可読性が最優先の面 (屈折はテキスト周辺でも起こるため)

---

## 3. Rendering Pipeline

```text
Scene source (image / video / canvas / gradient)
  ↓
Pass 1: Scene Texture   — viewport に cover-fit した RT (sceneRT)
  ↓
Pass 2: Blur Pyramid    — L0(1/2) L1(1/4) L2(1/8), separable Gaussian
  ↓
Pass 3: Composite       — 各要素の Rounded-rect SDF から
                          distance / curvature / normal / edge proximity を解析計算し
                          屈折 + dispersion + Fresnel + specular + tint で合成
```

- Pass 1〜2 は **Scene が変わった時だけ** 実行 (静的背景なら初回のみ)
- Pass 3 は **要素の位置・サイズが変わった時だけ** 実行
- V2 の「ピクセルごとに無条件25 tap」は廃止。blur はピラミッド LOD から 1〜3 sample で取得

---

## 4. Glass Model (Shader)

ガラス表面は「Rounded Rectangle + 円形キャップ状のベベル」でモデル化します。

- **SDF**: rounded box の符号付き距離場で要素を特定
- **edge proximity**: `t = 0` (中央) → `t = 1` (縁) の正規化距離
- **normal**: SDF の解析的勾配 × ベベル勾配 `t / sqrt(1 - t²)`
- **屈折**: `refractedUV = uv + normal.xy * refraction * edgeWidth` — **中央はほぼゼロ**

つまり:

```text
中心   → 屈折なし・ぼかし最小・背景をほぼそのまま表示
中間   → 弱い屈折
縁     → 強い屈折 + Fresnel + specular + ぼかし増加 + 色分散
```

カード中央を激しく歪ませないのが設計上の最重要ポイントです。人間がガラスと認識するのは縁の曲率と光の反射だからです。

### Chromatic Aberration

RGB dispersion は**エッジ近傍のみ**、屈折オフセットの数 % だけ R/B を逆方向にずらします。既定値 `dispersion: 0.045` はゲーミングエフェクトにならないよう意図的に極小です。`performance` 品質では無効、`balanced` では 60% 減衰します。

---

## 5. Quality tiers

| tier | blur pyramid | dispersion | render scale上限 | pixel budget | 用途 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| `high` | 3 levels (L0/L1/L2) | 100% | 3.0 | 約311万px | 高性能GPU |
| `balanced` (既定) | 2 levels (L0/L1) | 60% | 1.5 | 約207万px | 通常環境 |
| `performance` | なし (mip直接) | 無効 | 1.0 | 約92万px | 低性能・モバイル |

品質は sampling 数だけでなく、**pyramid 構成・renderScale・dispersion・pixel budget の pipeline 全体**で調整されます。

---

## 6. Fallback chain

```text
WebGL2 (MinaLiquid)
  ↓ WebGL2なし / Safari・iOS / タッチデバイス / context lost / shader失敗
CSS Frosted Glass (.mina-liquid-native, backdrop-filter)
  ↓ backdrop-filter 未対応
Static Surface (.mina-liquid-static, 半透明のみ)
```

- `.mina-liquid` 要素は **JSなしでも可読な半透明面** として CSS で描画される
- どの段階でもコンテンツは消えず、背景は黒にならず、レイアウトは壊れない
- 要素には現在の backend を示す state class (`mina-liquid-gl` / `-native` / `-static`) が自動付与される

---

## 7. API

### MinaLiquid

```js
const liquid = new MinaLiquid({
  source: {
    type: "image",
    src: "/background.jpg"
  },
  quality: "balanced",          // high | balanced | performance
  backend: "auto",              // auto | webgl | native | static
  renderScale: 1,               // devicePixelRatio への係数
  maxPixelCount: 1920 * 1080,   // バックバッファ上限
  maxElements: 8,               // 同時追跡する liquid 要素数 (最大16)
  glass: {
    refraction: 0.22,           // 縁の屈折量 (edgeWidth の割合)
    blur: 12,                   // 透過blur (design px → LOD)
    fresnel: 0.22,              // 縁の Fresnel リムライト
    specular: 0.22,             // 縁の指向性ハイライト
    dispersion: 0.045,          // RGB分散 (ごく僅かに)
    edgeBlur: 0.45,             // 縁に向かう blur 増加
    edgeShadow: 0.24,           // 縁のコンタクトシャドウ
    edgeWidth: 0.2,             // ベベル幅 (短辺比)
    tint: 0.05,
    tintColor: [1, 1, 1],
    saturation: 1.08,
    brightness: 1.0
  }
});
```

### メソッド

| API | 説明 |
| :-- | :-- |
| `setSource(spec)` | Scene を差し替え (image / video / canvas / gradient) |
| `setGlass(partial)` | glass パラメータを部分更新 |
| `setQuality(q)` | quality を切替 (pipeline 再構築) |
| `refresh()` | Scene と geometry を強制再描画 |
| `requestRender()` | dirty rendering を1フレームにまとめて要求 |
| `getStats()` | draws / lastDrawMs / elements / scale / state |
| `getElements()` | 現在追跡中の (可視) 要素 |
| `getCanvas() / getContext()` | 生の canvas / GL コンテキスト |
| `destroy()` | 全リソース解放 (listener / RAF / GL / canvas) |

静的ヘルパー: `MinaLiquid.isSupported()`, `MinaLiquid.detectBackend()`, `MinaLiquid.normalizeQuality()`, `MinaLiquid.describeElement(el)`

### DOM 側

```html
<div class="mina-liquid" data-mina-liquid>
  コンテンツ
</div>
```

`data-mina-liquid` または `.mina-liquid` が追跡対象です。DOM は Renderer に**位置・サイズ・radius・任意パラメータ**を渡すだけです。

個別上書き:

```html
<div class="mina-liquid"
     data-mina-refraction="1.4"
     data-mina-blur="16"
     data-mina-radius="48"
     data-mina-tint="0.2">
```

- `data-mina-refraction` — 要素の屈折スケール (1.0 = global 値)
- `data-mina-blur` — 要素の blur (design px)
- `data-mina-radius` — 角丸 (computed style より優先)
- `data-mina-tint` — tint 強度

CSS カスタムプロパティとの連携: 角丸は通常 `border-radius` の computed style から自動取得するため、`--mina-radius-xl` を変えれば Liquid Glass も追従します。

---

## 8. Performance 設計

- **Continuous RAF 禁止**: 描画は dirty flag + 単一 RAF に coalesce。静止ページでは描画ゼロ
- **scroll coalescing**: capture フェーズの scroll listener は dirty を立てるだけ。1フレームに1回の rect 読み取り
- **resize coalescing**: `ResizeObserver` (document + 各 liquid 要素)。canvas サイズ変更時のみ FBO 再生成
- **要素カリング**: `display:none` (`offsetParent`), `visibility:hidden`, 0サイズ, viewport 外 (+120px マージン) を毎フレーム除外。**表示されている要素だけ** uniform に渡す (「常に8個分処理」はしない)
- **pixel budget**: `maxPixelCount` を超えると内部バッファを自動縮小 (DPR 3 上限)
- **texture 上限**: source は 2048px に一度だけダウンスケール
- **visibility**: `document.hidden` で RAF を即キャンセル
- **GPU cleanup**: `destroy()` / context lost で program / texture / FBO / VAO / VBO を全解放
- `will-change` / `translateZ(0)` の乱用はしません (昇格は `.mina-gpu` で明示的に)

---

## 9. Accessibility

- Liquid 要素は**装飾を持つ通常のコンテナ**です。`role` や `aria` はコンテンツに応じて通常どおり設定してください
- WebGL キャンバスは `aria-hidden="true"` + `pointer-events: none`
- `prefers-reduced-motion` 環境でも Liquid Glass は自動アニメーションしません (動画 source を使わない限り静的)
- fallback 時も同じ DOM・同じコンテンツが表示されます

---

## 10. Browser support

| 環境 | 動作 |
| :-- | :-- |
| Chrome / Edge / Firefox (desktop, WebGL2) | Liquid Glass (webgl backend) |
| Safari macOS / iOS | CSS Frosted fallback (WebKit の非同期スクロールで座標ずれが起きるため auto は native を選択) |
| WebGL2なし / context lost | CSS Frosted → Static |
| `backdrop-filter` なし | Static Surface |

---

## 11. Troubleshooting

| 症状 | 原因と対処 |
| :-- | :-- |
| 背景が真っ黒 | Scene が未指定です。`source` を渡してください (WebGL は DOM を capture しません) |
| ガラスに何も見えない | liquid 要素が viewport 外 / display:none / 0サイズの可能性。`getStats().elements` で確認 |
| 画像が出ない | CORS (`crossOrigin="anonymous"` 対応サーバー) を確認。 tainted canvas は upload に失敗し fallback します |
| 歪みが強すぎる | `glass.refraction` を下げる、または要素に `data-mina-refraction="0.6"` |
| 色ズレが気になる | `glass.dispersion: 0` |
| performance モードでぼやけすぎ | mip-only の仕様です。`balanced` 以上で pyramid blur になります |

---

## 12. Migration (V2 MinaGlass → V3 MinaLiquid)

### 破壊的変更の概要

V2 は「ページ全面に背景テクスチャを描画し、カード領域の UV を中心基準で変形する」方式でした。V3 は pipeline 自体が別物です。旧実装は `legacy/minaui.glass.v2.js` に凍結保存されています (メンテ対象外)。

| V2 | V3 |
| :-- | :-- |
| `MinaGlass.autoInit({ background })` | `new MinaLiquid({ source: { type: "image", src } })` |
| `.mina-glass--liquid` | `.mina-liquid` または `data-mina-liquid` (旧クラスも互換追跡あり) |
| `uploadTexture(img)` | `setSource({ type: "image", el: img })` |
| `setSaturate(v)` | `setGlass({ saturation: v })` |
| `setWhiteness(v)` | `setGlass({ brightness, tint })` |
| `render({ cards }) / startRender(fn)` | 不要 (自動 dirty rendering) |
| `maxCards` | `maxElements` |
| 25/9/1-tap per-pixel blur | blur pyramid LOD |
| 中心基準 UV 変形 | SDF + normal ベースの縁屈折 |

### 互換レイヤー

`minaui.glass.js` を読み込むと `window.MinaGlass` は **MinaLiquid へのアダプタ** になります:

```js
// V2スタイルの呼び出しは警告付きで動作し続けます
const glass = MinaGlass.autoInit({ background: "/bg.jpg", maxCards: 2 });
glass.setSaturate(1.3);
glass.setWhiteness(0.2);
glass.destroy();
```

`uploadTexture` / `setSaturate` / `setWhiteness` / `render` / `startRender` / `destroy` / `backend` / `quality` は最低限マッピング済みです。**新規コードでは必ず MinaLiquid を直接使ってください。** 旧クラスのみの完全再現が必要な特別なケースだけ `legacy/minaui.glass.v2.js` を単独で読み込みます。
