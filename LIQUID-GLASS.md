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

### Scene loading state と readiness

Scene には明示的な状態があります (`getSceneState()` で取得可能):

```text
none     → setSource 前 (Scene なし)
loading  → source 受理済み・まだGPUに反映されていない
ready    → GPU upload 成功 + 最初の composite 描画が完了
failed   → ロード失敗 / CORS / tainted canvas / invalid source
```

**`.mina-liquid-gl` (GL が要素のピクセルを所有する状態) は `ready` になるまで付与されません。**
それ以前や `failed` の間、要素は CSS Frosted / Static Surface のままで、コンテンツ・背景が透明・黒・不可視になることはありません。

### source failure fallback

次のいずれでもページは壊れません (webgl backend 自体は維持し、要素は CSS 表面に戻します):

- 画像の load error
- CORS / tainted canvas (`texImage2D` が throw)
- invalid canvas (幅・高さ 0)
- texture upload 時の GL error
- 動画の利用不能

失敗後は `setSource()` で再度 source を渡せば再挑戦できます。

### Video lifecycle

- `loadedmetadata` / `loadeddata` / `canplay` / `playing` / `pause` / `seeked` / `ended` の各変化で必要な render が必ず走ります (metadata 遅延にも対応)
- 対応ブラウザでは **`requestVideoFrameCallback()`** を優先し、**新しいフレームが来た時だけ** Scene を更新します
- 未対応環境のみ RAF fallback (再生中のみ)。**常時無条件 RAF は禁止**という設計方針です
- ユーザーが渡した `<video>` 要素は内部生成 video と同一の追跡を受けますが、`destroy()` で pause / src 解放されることは**ありません** (内部生成 video のみ解放します)
- すでに再生中 / ロード済みの `<video>` を `el` で渡した場合も、現在の状態 (playing / readyState) を引き継ぐためイベントを取りこぼしません
- `pause` / `ended` / context lost では保留中の rVFC と RAF を停止し、context restored 時に再生中であれば自動で再開します
- 2048px 超の video source は **reusable staging canvas** に一度だけ確保され、毎フレーム新規 canvas は生成されません

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

ガラス表面は「Rounded Rectangle + 円形キャップ状のベベル + 内部の弱いレンズ場」でモデル化します。

- **SDF**: rounded box の符号付き距離場で要素を特定
- **edge proximity**: `t = 0` (中央) → `t = 1` (縁) の正規化距離
- **Lens field (V3.2)**: 正規化 rounded-rect 座標 `q = p / half` から作られる **magnification / lens bulge**。V2 の `(uv - center) * scale` とは異なり、SDF・要素形状に追従し、ハンドオーバー `t²` でエッジ屈折に自然に主役を譲る
- **normal**: SDF の解析的勾配 × ベベル勾配 `t / sqrt(1 - t²)` (smooth saturation) + 内部レンズ傾き
- **屈折**: `refractedUV = uv + (lensBulgeOffset + edgeRefractionOffset)` — **中央はごく弱い倍率、エッジは強屈折**
- **safety limit**: **合成変位 (lens + edge) 全体** が `maxRefractionPx` (既定 40 design px) で clamp

つまり:

```text
中心   → ごく弱い倍率変化 (背景が僅かに拡大される — これが「レンズがある」感覚)
中間   → lens bulge プラトー (倍率 ~2-4%)
エッジ → 強い屈折 + Fresnel + specular + ぼかし増加 + 色分散
```

### なぜこの見た目が Liquid Glass に見えるのか

人間が「透明な厚みのあるガラス」を認識する手がかりは blur ではなく **背景の歪み** です:

1. **背景が少し拡大される** — 中央倍率 ~2-4% は、線や輪郭がガラス内で僅かに間隔を変えるため「そこにレンズがある」と知覚される (V3.1 は中央完全フラットだったため blur card に見えた)
2. **エッジで背景が曲がる** — エッジ屈折は外側の背景を引き込むため、境界を跨ぐ直線が明確に折れ曲がる
3. **方向性のあるハイライト** — 全周均一の白縁ではなく、左上光源の specular/Fresnel のみ

V2 の「ぐにゃん」は UV を中心基準で拡大するだけの粗い表現でしたが、その知覚的な強み (倍率差で存在を主張する) は V3.2 では SDF・ハンドオーバー・安全上限の上に再構築されています。

### Lens field と Edge refraction の違い

| | Lens field (内部) | Edge refraction (エッジ) |
| :-- | :-- | :-- |
| 領域 | 中央〜中間 (ベベル外側) | ベベル内 (edgeWidth) |
| 方向 | 内向き (中心へ) — **拡大** | 外向き — **引き込み/圧縮** |
| 強さ | `magnification` + `lensBulge` (線形に成長) | `refraction` × ベベル勾配 (エッジで急増) |
| 役割 | 「レンズがそこにある」倍率差 | 境界の視覚的切断・湾曲 |

ハンドオーバー `t²` により、両者はベベル内で交差しながら滑らかに繋がります (内→外の変位が一度ゼロを跨ぐ S 字カーブ。物理的に正しい)。

### Refraction safety (合成変位の上限)

circular-cap bevel の傾き `t/sqrt(1-t²)` は `t → 1` で発散するため、そのまま使うとカードサイズ次第で背景が極端に伸びます。V3.2 は次の安全策を持ちます:

1. **smooth saturation**: 傾きを soft-knee で滑らかに飽和
2. **joint px cap**: **`length(lensBulgeOffset + edgeRefractionOffset) <= maxRefractionPx`** — lens と edge の合計が上限を超えることはパラメータ如何を問わず起きない

```js
new MinaLiquid({ ..., maxRefractionPx: 40 });   // 既定 40 (4..512 に clamp)
liquid.setMaxRefractionPx(24);                 // 実行時変更も可能
```

**どんなカードサイズ・パラメータでも極端な UV ジャンプは起きません** (visual validation で実測検証)。

### Chromatic Aberration

RGB dispersion は**エッジ近傍のみ**、屈折オフセットの数 % だけ R/B を逆方向にずらします。既定値 `dispersion: 0.02` はゲーミングエフェクトにならないよう意図的に極小です。`performance` 品質では無効、`balanced` では 60% 減衰します。

### Blur profile (V3.2: center-sharp)

blur は一様ではなく、中央ほど弱くエッジほどやや強いプロファイルを持ちます:

```text
lod = blurLod * (1 - centerBlur * inset) + edgeBlur * t²
```

- 中央 (`inset ≈ 1`): LOD は `blur * (1 - centerBlur)` まで下がる — **背景の情報量を残す** (すりガラスにしない)
- エッジ (`t → 1`): `edgeBlur` 分が追加され、わずかに強い

これにより Liquid Glass は「レンズ」、CSS Frosted は「すりガラス」という**役割分担**が明確になります:

| | CSS Frosted (`mina-liquid-native`) | WebGL Liquid (`mina-liquid-gl`) |
| :-- | :-- | :-- |
| 背景 | blur のみ (geometry 変化なし) | **曲がる・僅かに拡大される** |
| エッジ | なし | 強屈折 + Fresnel |
| 中央 | 均一 blur | 近似シャープ + 弱倍率 |
| 役割 | 読みやすさ優先の下地 | 主役面の展示 |

### 推奨既定値 (V3.2)

| parameter | 既定 | 意図 |
| :-- | :-- | :-- |
| `refraction` | `0.32` | エッジ屈折。一目でガラスと分かる強さ |
| `magnification` | `0.025` | 中央の等倍率成分 (~2.5%) |
| `lensBulge` | `0.017` | rim 方向へ成長するレンズ成分 (合成 ~2-4%) |
| `blur` | `5` | 背景情報を残す弱めの透過 blur |
| `centerBlur` | `0.45` | 中央の LOD 減衰率 (すりガラス化防止) |
| `fresnel` | `0.16` | リムライトが白飛びしない強度 |
| `specular` | `0.14` | ハイライトが白い玉にならない強度 |
| `dispersion` | `0.02` | ほぼ知覚不可の色縁 |
| `edgeWidth` | `0.21` | ベベル幅 (短辺比) |
| `edgeBlur` | `0.55` | エッジへの blur 増加 |
| `maxRefractionPx` | `40` | 合成変位の安全上限 (design px) |

**強すぎる distortion を避ける理由**: `refraction` やレンズ値を上げすぎると、ガラスではなく「水滴 / 魚眼レンズ / ワープエフェクト」に見えます。MinaUI は UI ライブラリであり、訴求点は「透明な厚みのある上質なガラス」です。Strong preset (refraction 0.42) が実用上限と考えてください。

### Recommended presets (Demo の Natural / Soft / Strong / Performance)

Demo (`demo/index.html`) の preset ボタンは上記思想をそのまま反映しています:

- **Natural** (推奨既定値と同一) — 「開いた瞬間にこれが MinaLiquid と分かる」展示状態
- **Soft** — 控えめ。テキスト多い面向け
- **Strong** — 実用上限。それでも極端な warp はしない
- **Performance** — 低負荷向け (mip-only + dispersion 0)

調整はスライダーで行い、気に入った値を `glass` オプションとして渡してください。

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
  ↓ WebGL2なし / Safari・iOS / タッチデバイス
  ↓ Scene / Blur / Composite program のいずれかの失敗
  ↓ framebuffer / texture 割り当て失敗
  ↓ context lost
CSS Frosted Glass (.mina-liquid-native, backdrop-filter)
  ↓ backdrop-filter 未対応
Static Surface (.mina-liquid-static, 半透明のみ)
```

- `.mina-liquid` 要素は **JSなしでも可読な半透明面** として CSS で描画される
- どの段階でもコンテンツは消えず、背景は黒にならず、レイアウトは壊れない
- 要素には現在の backend を示す state class (`mina-liquid-gl` / `-native` / `-static`) が自動付与される

### WebGL program / FBO failure handling

初期化は all-or-nothing です。Scene program・Blur program・Composite program・framebuffer completeness・texture 割り当ての**すべて**を検証し、1 つでも失敗した場合:

1. 中途半端に初期化された GL resource (program / texture / FBO / VAO / VBO) を即座に解放
2. `WebGL → CSS Frosted → Static` へ安全に fallback
3. 壊れた WebGL 状態で描画を継続しません

### 状態遷移 (context lost / restored)

```text
loading   → ready             (GPU upload + 最初の composite 完了)
loading   → failed → frosted  (source failure。要素は CSS 表面のまま)
ready     → context-lost → frosted
frosted   → context-restored → (scene 未準備のまま .mina-liquid-gl にはならない)
          → 再 upload + 1 frame 描画後 → ready / GL class
```

復帰時も Scene が再び GPU に upload されて最初の frame が成功するまで、要素は CSS 表面のままです。

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
  maxRefractionPx: 40,          // 屈折変位 (lens + edge 合成) の安全上限
  glass: {
    refraction: 0.32,           // エッジの屈折量
    magnification: 0.025,       // 中央の等倍率レンズ成分
    lensBulge: 0.017,           // rim 方向へ成長するレンズ成分
    blur: 5,                    // 透過blur (design px → LOD)
    centerBlur: 0.45,           // 中央の blur 減衰 (背景情報を残す)
    fresnel: 0.16,              // 縁の Fresnel リムライト
    specular: 0.14,             // 縁の指向性ハイライト
    dispersion: 0.02,           // RGB分散 (ごく僅かに)
    edgeBlur: 0.55,             // 縁に向かう blur 増加
    edgeShadow: 0.22,           // 縁のコンタクトシャドウ
    edgeWidth: 0.21,            // ベベル幅 (短辺比)
    tint: 0.05,
    tintColor: [1, 1, 1],
    saturation: 1.06,
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
| `setMaxRefractionPx(v)` | 屈折変位の安全上限を実行時変更 (design px) |
| `refresh()` | Scene と geometry を強制再描画 |
| `requestRender()` | dirty rendering を1フレームにまとめて要求 |
| `getStats()` | draws / lastDrawMs / elements / scale / state / scene / maxDispPx |
| `getSceneState()` | Scene 状態 (`none` / `loading` / `ready` / `failed`) |
| `getElements()` | 現在追跡中の (可視) 要素 |
| `getCanvas() / getContext()` | 生の canvas / GL コンテキスト |
| `destroy()` | 全リソース解放 (listener / RAF / rVFC / video / GL / canvas) |

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
- **Video は rVFC 駆動**: `requestVideoFrameCallback` 対応環境では動画の新しいフレームが来た時だけ Scene 更新。RAF fallback は未対応環境・再生中のみ
- **scroll coalescing**: capture フェーズの scroll listener は dirty を立てるだけ。1フレームに1回の rect 読み取り
- **resize coalescing**: `ResizeObserver` (document + 各 liquid 要素)。canvas サイズ変更時のみ FBO 再生成
- **要素カリング**: `display:none` (`offsetParent`), `visibility:hidden`, 0サイズ, viewport 外 (+120px マージン) を毎フレーム除外。**表示されている要素だけ** uniform に渡す (「常に8個分処理」はしない)
- **pixel budget**: `maxPixelCount` を超えると内部バッファを自動縮小 (DPR 3 上限)
- **texture 上限**: source は 2048px に一度だけダウンスケール (**reusable staging canvas**、毎フレーム割り当てなし)
- **visibility**: `document.hidden` で RAF を即キャンセル
- **GPU cleanup**: `destroy()` / context lost で program / texture / FBO / VAO / VBO を全解放。rVFC / video listener / 内部生成 `<video>` も停止・解放
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

## 11. Visual Validation

`scripts/visual-validate.mjs` は Chrome headless で `scripts/visual-probe.html` を実行し、**色差ではなく実際の sampling displacement** を測定して数値検証します。

### 方式 (A/B 比較)

同じ Scene (coordinate-coded: 64px 周期の triangle wave + per-column noise) ・同じ glass geometry で:

```text
Baseline: refraction = lensBulge = magnification = 0
Test:     通常の glass 設定
```

をそれぞれ描画し、readPixels + 正規化相互相関で **各行のサンプリング変位** を直接測定します。blur/tint/specular が混ざっても誤検証できません (Baseline と Test で同一だから)。

### 検証項目

- **center displacement > 0** (lens magnification が存在すること — 中央が完全フラットなら失格)
- **mid (lens bulge) > center** / **edge (edge refraction) が最大** (帯順序)
- **lens direction**: 対称点の変位が両側とも内向き (= 拡大レンズ) であること
- maximum displacement ≤ safe limit (`maxRefractionPx` × renderScale)
- white clipping (中央・エッジの白飛び率)
- RGB dispersion 強度 (R と B の sampling shift 差)
- background restoration after DOM move (移動後の旧領域が元の Scene に戻る)
- multiple glass overlap (大・小・極小カードが同時に屈折)
- source failure fallback (404 画像 → CSS 表面)
- context lost → frosted → restored (再 earn まで GL class なし)
- destroy (GL class 除去)

### Magnification の実測 (V3.2)

Grid scene (35px 間隔の縦線) に対する実測では、glass 内部の線間隔が **+3.4%** 広がることが確認されています:

```text
outside: 73.5px spacing / inside: 76px spacing / ratio = 1.034
```

これは「単なる色差」ではなく **feature spacing から検出したレンズ倍率** であり、Human eye が「レンズがある」と知覚する根拠と同じものです。

実行には `python -m http.server 4173` 相当のローカルサーバーと Chrome が必要です。

### Troubleshooting

| 症状 | 原因と対処 |
| :-- | :-- |
| 背景が真っ黒 | Scene が未指定です。`source` を渡してください (WebGL は DOM を capture しません) |
| ガラス面が半透明のまま | Scene がまだ `ready` になっていません (loading / failed)。`getSceneState()` で確認してください |
| ガラスに何も見えない | liquid 要素が viewport 外 / display:none / 0サイズの可能性。`getStats().elements` で確認 |
| 画像が出ない | CORS (`crossOrigin="anonymous"` 対応サーバー) を確認。 tainted canvas は upload に失敗し CSS 表面に fallback します |
| 歪みが強すぎる | `glass.refraction` を下げる、`maxRefractionPx` を絞る、または要素に `data-mina-refraction="0.6"` |
| 色ズレが気になる | `glass.dispersion: 0` |
| performance モードでぼやけすぎ | mip-only の仕様です。`balanced` 以上で pyramid blur になります |
| 動画が最初のフレームから動かない | autoplay が block されている可能性。ユーザー操作後に `video.play()` してください。metadata 遅延には対応済みです |

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
