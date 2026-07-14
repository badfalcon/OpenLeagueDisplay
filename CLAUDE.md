# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# OpenLeagueDisplay - Project Context

League Displays が公式から放置されたので、自前で代替を作るプロジェクト。
名前は **OpenLeagueDisplay** (オープンな League Displays 後継、の意)。

## 現状

GitHub Pages にデプロイ可能な **完全静的なWebビューア**。画像はリポジトリに保存せず
Community Dragon CDN を直接参照する。LeagueDisplays の代替を狙い、好きなスキンを
ブラウザ上でまとめて選んで **ZIPでダウンロード** → ローカルで壁紙設定、までを想定。

## ファイル構成

```
.
├── index.html                       # マークアップ本体 (styles.css と js/app.js を読み込む、~7KB)
├── manifest.webmanifest             # PWA マニフェスト (ホーム画面追加 / インストール用)
├── favicon.svg                      # サイトアイコン (manifest の purpose:any アイコンも兼ねる)
├── icon-maskable.svg                # PWA maskable アイコン (L を safe zone に縮めた版)
├── icon.ico                         # Windows アプリアイコン (exe/インストーラ/ショートカット用、コミット)
├── make_icon.py                     # favicon.svg から icon.ico を再生成 (Pillow、ブランド変更時のみ)
├── styles.css                       # 全 CSS (CSS 変数でテーマ管理)
├── js/                              # ES Modules
│   ├── app.js                       #   エントリ: data.json fetch + イベント配線 + hash ルーティング (#/...)
│   ├── state.js                     #   共有 state / DATA / インデックス / 汎用ユーティリティ
│   ├── i18n.js                      #   UI_STRINGS / locale ローダー / 名前マップ
│   ├── i18n-failsafe.js             #   3秒後に html.i18n-loading を外す保険 (classic script、CSP の unsafe-inline 回避のため別ファイル)
│   ├── render.js                    #   view レンダリング (home / champion / lines / line)
│   ├── hero.js                      #   ホームのヒーロー (新着スプラッシュ6件を7秒回転 + Ken Burns)
│   ├── zip.js                       #   ZIP DL (JSZip)
│   ├── lightbox.js                  #   ライトボックス + (全画面) スライドショー
│   ├── tutorial.js                  #   初回訪問チュートリアル (5ステップ。? ボタン / ? キーで再表示)
│   ├── share.js                     #   サイト共有 (Web Share API / クリップボードコピーのフォールバック)
│   ├── local.js                     #   ローカル実行検知 + 壁紙一括設定 API クライアント
│   ├── wallpaper.js                 #   壁紙の確認モーダル (選択→確認→一括設定。ローカルのみ)
│   └── desktop.js                   #   デスクトップ版の訴求 + Web→ネイティブの選択受け渡し (Web のみ)
├── sw.js                            # Service Worker (アプリシェルのキャッシュ)
├── generate_data.py                 # CDragon → data.json 生成スクリプト
├── serve.py                         # ローカル配信ラッパー (http.serverを薄く包む)
├── local_app.py                     # ローカル実行モード: 静的配信 + /api 壁紙設定 (stdlib + 任意 pywebview)
├── local_app.spec                   # デスクトップ版の PyInstaller spec (バイナリは非コミット)
├── build_installer.py               # exe 再ビルド (PyInstaller) → installer/windows.iss (ISCC) の一括ローカルビルド (stdlib)
├── installer/windows.iss            # Windows インストーラの Inno Setup スクリプト (バイナリ/icoは非コミット)
├── data.json                        # チャンピオン/スキンのマニフェスト (~1.7MB、初回 generate_data.py で生成)
├── i18n/<locale>.json               # 言語別の名前辞書 (1ファイル100-200KB、generate_data.py で同時生成)
├── .github/workflows/update.yml     # 週次 (月曜09:00 JST) で data.json 自動更新
├── .github/workflows/release.yml    # タグ push で各 OS のデスクトップバイナリを build & Release
├── .github/release.yml              # 自動生成リリースノート (changelog) の分類設定
├── docs/usability_improvements.md   # ユーザビリティ改善候補の網羅的インベントリ (優先度付き。高優先度 H1〜H7 は実装済み)
├── README.md
└── .gitignore
```

### モジュール分割の指針

- **state.js**: mutable な `state` オブジェクトと、`let DATA` (setData 経由で
  更新)、SKIN_BY_KEY / LINE_INDEX、localStorage I/O、`$` / `esc` の汎用関数。
  他モジュールを import しない (依存される側専用)。`trapFocus` (依存ゼロの DOM
  ユーティリティ。モーダル/ライトボックス表示中に Tab で背景へフォーカスが抜けるのを
  防ぎ、解除関数を返す) もここに置く。`isMobile()` (タッチ主体端末の簡易判定:
  `(pointer: coarse) and (hover: none)`。ビューポート幅ではなく「localhost でデスク
  トップ版を立てられない端末か」のシグナルとして使う。`@media (max-width:600px)` だと
  小窓のノートPCを誤検知するため幅は使わない) もここに置く
- **i18n.js**: UI 文字列テーブル / `t()` / ROLE_LABELS / RARITY_LABELS /
  REGION_LABELS / 言語ピッカー描画と loadLocale。`applyStaticUIStrings`
  だけ render.js の `renderStats` を呼ぶので render.js への循環 import が
  ある (ES Modules の関数宣言は hoist されるので runtime 呼び出しなら OK)
- **render.js**: `render()` と view 別レンダラ、選択トグル、ナビゲーション、
  カウントアップアニメ (`renderStats`)、`imgLoaded` / `imgErr`。
  app.js が `window.imgLoaded = imgLoaded` をして `<img onload="imgLoaded(this)">`
  からも届くようにしている
- **zip.js**: JSZip 連携。`pMap` / `downloadAsZip` は module 内 private、
  公開は `downloadChampion` / `downloadLine` / `downloadSelected` の 3 つ
- **lightbox.js**: 拡大表示とスライドショー。state.lb をすべての関数で共有。
  `shuffle` / `buildSelectedList` も内製 (render.js からは独立)。**上部バー
  (`.lb-toolbar`) はビューア用**: 左に counter、右に 画像フィット (`#lb-fit`、
  contain↔cover) / 壁紙 (`#lb-wallpaper`、ローカルのみ) / 閉じる (`#lb-close`)。
  `.lb-toolbar-spacer` (flex:1) が左右を押し分ける。**スライドショー操作は下部中央の
  ドック `#lb-dock`** (`#dock-prev` ‹ / `#ss-pause` ▶⏸ / `#dock-next` › / `#ss-interval` /
  `#ss-caption`。旧 ⚙ メニューは廃止、display:none 切替で viewer 時は Tab 対象からも
  外れる)。ナビ矢印 (`.lb-nav` ‹ ›) はビューアモード専用でスライドショー中は CSS で
  非表示 (ドックが担う。キーボード ←/→ は両モードで有効)。スキン名の隣に rarity チップ
  (`#lb-rarity`、RARITY_LABELS で翻訳、無ければ hidden)。キャプションは
  `applyCaption()` が lightbox ルートに `caption-name` (説明文だけ畳む) /
  `caption-none` (オーバーレイごと隠す) を付与し、full は class なし。ビューアモード
  では常に full 扱い (⚙ を出さないので none のまま閉じても拡大表示に波及しない)
- **local.js**: ローカル実行 (local_app.py) の検知と壁紙一括設定 API クライアント
  (`applyWallpaper`)、簡易 `toast`。**import は state.js のみ** (i18n.js を import しない
  ことで `render→local→i18n→render` の循環を作らない。`toast` は呼び出し側で翻訳済み
  文字列を受け取る)。Pages では `probeLocal()` が false に倒れ、この module を使う UI が
  一切出ない (= 静的サイトとして従来通り)
- **wallpaper.js**: 壁紙の確認モーダル (My Gallery で複数選択 → 「壁紙にする」→ 確認 →
  `applyWallpaper` で一括設定)。モーダル DOM は初回に遅延生成 (index.html を汚さない、
  toast と同手法)。import は state / i18n / local。1枚=静止、2枚以上=OS純正スライド
  ショー (サーバが枚数で振り分け)。ローカル実行時のみ render.js が起動ボタンを出す
- **desktop.js**: **Web (Pages) 側でデスクトップ版を推す導線**専用。import は state /
  i18n / local と zip (`saveBlob` のみ再利用) (**render.js は import しない** = グラフの葉。
  zip.js も state/i18n しか import しないので循環しない。受け渡し後の画面遷移と
  再描画は呼び出し側 app.js が持つ)。公開は4つ: ①`gateDownload(fn)` = 初回 ZIP DL 時に
  「デスクトップ版を入手 / このまま ZIP」を1回だけ尋ね、選択を `LS_DL_PROMPT_SEEN` に記憶
  (以降は素通し。ローカル実行時も素通し)。render.js の DL 3口を包む ②`openInDesktop()` =
  My Gallery の選択を**カスタム URL スキーム** `openleaguedisplay://import?keys=<base64url の
  JSON keys>` にしてデスクトップ版に渡す (`desktopLink()`)。旧 deep link
  `http://127.0.0.1:8000/#import=` は「既に起動中のインスタンス」にしか届かず、未起動だと
  接続エラーのタブが開くだけだった。スキームなら OS がアプリを**起動**するので起動中かどうかを
  問わない (インストール済みであればよい)。**ただしスキームを名乗れるのは Windows だけ**
  (mac は .app バンドルの Info.plist、Linux は .desktop エントリが要り、単一バイナリ配布には
  無い) なので、`isWindows()` で分岐し **非 Windows では旧 deep link のまま**にする
  (従来挙動を維持)。localStorage はオリジン別
  (github.io ≠ 127.0.0.1) で共有できないための明示受け渡し、という位置づけは同じ。
  ペイロードは **base64url** (キーは `/` と空白だらけで、percent-encode すると約3倍になる。
  リンクは OS のコマンドライン長 32767 に載る必要がある)。`MAX_LINK_LEN` (16000) を超える
  巨大ギャラリーは**リンクを諦めてファイル書き出しにフォールバック**する (押しても何も
  起きないボタンを出さない)。**発火は使い捨てタブから** (`fireSchemeLink`): 現在のドキュメントを
  `location.href` で飛ばすと、ハンドラ未登録のブラウザが**本文をエラーページに差し替える**こと
  がある (Chrome は黙殺するが Firefox は unknown-protocol ページを出しうる)。使い捨てタブなら
  それを吸収でき、後で閉じれば空タブも残らない。**閉じるのを急がないこと**: ブラウザの
  「OpenLeagueDisplay を開きますか？」プロンプトは**発火したタブが所有**しているので、短い
  タイマーでタブを閉じるとプロンプトごと消えて cancel 扱いになる (= 初回ユーザーは必ず起動に
  失敗する。実際 2秒で閉じる実装をしてこれを踏んだ)。60秒のバックストップで、かつ **まだ
  about:blank のまま = 誰も触っていないタブのときだけ**閉じる (ポップアップがブロックされた
  時だけ `location.href` にフォールバック) ③`applyImportFromHash()` = 受け側。`#import=` を読んで
  SKIN_BY_KEY に在るキーだけ選択へマージし、**追加件数 / 0 (全部既に在った) / -1 (payload が
  読めない)** を返す (`pickSelectionFile` と同じ契約。0 と -1 を分けないと、壊れたリンクに
  「最新です ✓」と嘘をつく)。呼ぶのは app.js の2箇所: 起動時 (buildIndexes 後・ルーティング前) と
  `maybeHandleImportHash()` (起動後に飛んできたフラグメントを popstate/hashchange で拾う。
  デスクトップ版の `/api/handoff` がこの経路)。どちらも終わったら hash を `#/gallery` に
  書換えて再取り込みを防ぐ。ローカル限定にはしない (手貼りリンクでも動くように)
  ④`mountFooterCTA()` = フッターに
  デスクトップ版 CTA を1回注入 (ローカル時は no-op)。**別端末 (スマホ→PC) 向けに
  `exportSelection()` / `pickSelectionFile()` = 選択を JSON ファイル (`{v,keys}`) で
  書き出し/読み込み** (deep link が使えないクロスマシン経路。モード非依存で双方向)。
  キーのマージは `mergeKeys()` に共通化し ③ファイル取り込み両方が使う (data に在る・
  未選択のキーだけ採用)。汎用 2択モーダル (`choiceModal`) は
  wp-* の CSS を流用して①②で共用。**フッター CTA だけは英語固定** (フッターの帰属・
  ポリシー表記が意図的に非ローカライズなのに合わせる。①②③のUI文字列は i18n 済み)。
  ライトボックスのワンクリック「壁紙にする」(`#lb-wallpaper`) は別系統で、表示制御は
  lightbox.js (isLocalWallpaper)、クリック処理は app.js (`applyWallpaper([現在のsrc])`)。
  **モバイル (`isMobile()`) では「その端末で今すぐデスクトップ版を使え」と促す割り込み導線を
  抑制する**: ①`gateDownload` はモーダルを挟まず素通し (スマホにデスクトップ版は入れられない /
  `LS_DL_PROMPT_SEEN` も汚さない) ②`openInDesktop` のリンクはデスクトップ版を入れられないスマホでは
  必ず失敗するので、render.js が「Open in desktop app」メニュー項目自体を mobile で隠す (すぐ下の
  Export 項目がスマホ→PC 経路を担う。`openInDesktop` 内にも mobile→Export フォールバックの保険
  あり)。**受動的な ④`mountFooterCTA` と Export はモバイルでも残す** (スマホで見て後で PC で使う
  動機になる / 割り込まない)。**デスクトップ版の本物の起動検知もここ** (`probeDesktop` /
  `desktopStatus` / `startDesktopWatch` / `wireDesktopChip`): Pages から
  `http://127.0.0.1:8000/api/ping` を `mode:"cors"` で直接 fetch する (loopback は https ページ
  からでも mixed content にならない。Safari だけはブロック → 従来動作に劣化。CSP connect-src と
  local_app.py の CORS allowlist が対応済み)。My Gallery ツールバーの状態チップ (`#desktop-chip`、
  接続中/未検出/確認中) は **markup を render.js が出し、状態・文言・click は desktop.js が持つ**
  (state が module 内にあるため)。**自動 probe は `LS_DESKTOP_SEEN` (一度でも検知成功) がある
  ときだけ** (Chrome 138+ は 127.0.0.1 fetch に Local Network Access 許可プロンプトを出すので、
  アプリ未所持ユーザーに無断で出さない。初検知はチップ click か送信操作の明示ジェスチャ起点。
  検知成功時は watch を遅延起動する — render 時はフラグ無しで watch が始まっていないため、
  これが無いとチップが「接続中」のまま固まる)。ポーリングはギャラリー表示中のみ 10 秒間隔、
  `document.hidden` 中は tick スキップ (interval は張ったまま = listener leak なし)。
  ②`openInDesktop` は **検知済みなら choiceModal を出さず `POST /api/handoff` で直接送信**し、
  サーバ応答の count で本物の成功トースト。409 (窓なし=ブラウザモード) は deep link タブへ、
  接続失敗は probe (明示操作なので 20 秒 timeout = LNA プロンプト応答待ちを生存) → だめなら
  従来のスキーム起動モーダル。スキーム発火後は `watchLaunch` が ping を 2 秒×45 秒ポーリングし、
  起動確認で成功トースト + スクラッチタブを成功文言に書き換えて掃除、タイムアウトで
  setup.exe 誘導 (keys はスキームリンクが運搬済みなので**再送しない**)
- **hero.js**: ホームの「新着スプラッシュ」ヒーローバンド。import は state / i18n のみで、
  ナビ (`openChampion`) と壁紙アクションは render.js がコールバック注入する (hero→render の
  直接辺を作らない。hero→i18n→render の循環は render↔i18n と同じ hoist 前提で安全)。
  `render()` が冒頭で必ず `destroyHero()` を呼び、renderHome (検索なし時のみ) が
  `mountHero()` で再生成する — #view-content は毎 render で innerHTML ごと作り直される
  ため DOM は残せず、featured プールと現在位置だけ module 変数で永続。プール = 各スキンの
  `release` 降順6件 (無い/少ない時は Ultimate/Mythic ランダムにフォールバック)。7秒
  setInterval は document.hidden・**ホバー中**・ライトボックス表示中はスキップ、
  reduced-motion では張らない (Ken Burns も CSS 側で停止)。次スライドは事前 preload、
  ステージ全面クリック = View Splash (ボタンが accessible path、全面は利便)、
  タッチスワイプで前後送り (ライトボックスと同じ閾値 + click 漏れ吸収)。home と
  Skin Lines の素のリスト両方に出る (`mountFeaturedHero`、検索中は非表示)
- **app.js**: 唯一の `<script type="module">` 読み込み対象。init + イベント配線 +
  `window.imgLoaded` / `window.imgErr` の露出だけを担当する。**hash ルーティング
  (`#/...`) の責務も app.js 持ち**: `routeFromState`/`setStateFromRoute`/`applyRoute`/
  popstate ハンドラはここに置く。render.js は `setRouteListener` フックを公開する
  だけで history API は触らない (render() 末尾で「現在 state に対応する hash へ
  pushState する」コールバックを app.js が登録 = 既存ナビ関数を書き換えずに URL 追従)。
  ライトボックスの戻る対応 (open 時 pushState / 閉じ時 history.back) は lightbox.js

## 設計の意思決定 (なぜそうしたか)

- **画像をRepoに置かない**: 全スプラッシュ集めると ~600MB になり GitHub の現実的な
  上限を超える。Community Dragon が公式ミラーとして使えるので、URLだけ持つ
- **マニフェスト方式 (data.json) を採用**: ブラウザから直接 CDragon の JSON を fetch
  すると CORS リスクがあるため、Python (GitHub Actions上) で事前ビルド。data.json は
  同一オリジン (Pages) から fetch するので CORS 関係なし
- **画像取得はブラウザから直接 CDragon**: CDragon は画像レスポンスに
  `Access-Control-Allow-Origin: *` を返すため、`fetch` で blob 取得→ZIP化が可能
  (=Pages から CDN への帯域は経由しない / 大量DLでも GitHub の帯域を消費しない)
- **CDragon の per-champion JSON を使う**: Riot の Data Dragon は Wild Rift / TFT 等
  の幽霊スキンエントリも返してくる (実在4400件のうち約半数が 404)。CDragon は
  クライアント実データのミラーなので「実在するLoLスキンだけ」が取れる
- **NPCチャンピオンの除外**: CDragon の `champion-summary.json` には Doom Bots 等
  の PvE NPC (id ≥ 1000、alias `Ruby_*`) が混じる。`generate_data.py` の
  `build_manifest()` で両条件を AND で弾いている。将来別系統のNPCが増えた時は
  このフィルタ条件 (id 上限 / alias プレフィックス) の見直しが必要
- **questSkinInfo 対応済み**: K/DA ALL OUT Akali 等のティア違いスプラッシュも展開する
- **スキンライン情報も保持**: `skinlines.json` (CDragon) から id→name を取り込み、
  各スキンには所属する skin line ID を `lines` フィールドで持たせる
- **検索キーワード軸を複数持つ**: チャンピオン名 / スキン名に加えて、ロール
  (`roles`: Mage/Tank/...)、地域 (`regions`: Demacia/Noxus/...)、スキン rarity
  (Epic/Legendary/Mythic/Ultimate) も検索ヒット対象。ロールは CDragon の
  `champion-summary.json` の `roles` 配列、rarity は per-champion JSON の
  `skins[].rarity` で、UI の翻訳マップとズレないよう `KNOWN_RARITIES`
  (`kEpic/kLegendary/kMythic/kUltimate`) ホワイトリストで絞り、`k` 接頭辞を
  剥がして格納。**フィルタチップ (`filterChipsHTML`) は軸の性質で view を分ける**:
  home (チャンピオン一覧) は role/region (= チャンピオンの属性)、Lines (スキンライン
  一覧) は rarity (= スキンの属性)。rarity は per-skin なので「チャンピオンの絞り込み」
  には置かず Lines 側へ。Lines で rarity チップを押す (or rarity 名を完全一致タイプ) と、
  ライン一覧ではなく該当レア度の全スキンをフラット表示する (`renderRaritySkins` が home
  の検索結果 Skins セクション描画 `renderSkinCards`/`wireSearchSkinCards` を再利用)。
  rarity 判定は `rarityKeyFromQuery` が完全一致のみで行う (部分一致だとライン名検索と
  衝突するため)。home の検索軸 (`renderHome`) からは rarity を外し、スキン側ヒットは
  スキン名のみにした。
- **地域 (Demacia/Noxus/Ionia 等) は generate_data.py に hardcode**: 当初は Riot の
  Universe API (`universe-meeps.leagueoflegends.com`) を補助的に叩く設計だったが、
  probe で「サーバ側の S3 IAM が壊れていて永続的に 403 (`AccessDenied: User
  arn:aws:iam::185905861734:user/meeps-cdn-akamai-access-user is not authori...`)」
  と確定。CDragon にも champion→region のマッピングが無いため、Riot 側が直すのを
  待たず `generate_data.py` の `CHAMPION_REGIONS` (alias.lower()→[slug,...]) と
  `REGION_NAMES` (slug→英名) で持つ。新チャンピオンが追加された時はここに 1 行
  追記する。漏れは `build_manifest()` の警告 (`[警告] CHAMPION_REGIONS 未登録: <alias>`)
  で次回 regenerate 時に気付ける。地域名は検索キーワード専用 (表示には使わない)
  で、`js/i18n.js` の `REGION_LABELS` に「地域名を実際に翻訳していると確認できた
  locale」だけハードコード (現状 17 locale)。検索フィルタは
  `REGION_LABELS[state.locale]` を見て、未登録 locale なら `REGION_LABELS.default`
  (ラテン/英語) にフォールバック (ROLE_LABELS / RARITY_LABELS と同じ二段当たり)。
  el_gr/th_th/id_id 等は実クライアントが地域名をラテン文字のまま表示するため
  あえて未登録 (default フォールバックが実クライアント表記と一致する)。新しく
  locale を足す時は公式クライアント表記を確認してから (推測の音訳は入れない)。
  i18n/<locale>.json には regions フィールド自体を出さない。
- **ZIP化はブラウザ側 (JSZip)**: サーバ無しの方針を維持。JPEGは元々圧縮済みなので
  ZIP内では `STORE` (無圧縮格納) で処理時間を短縮
- **ローカル実行モード (壁紙を直接設定)**: ブラウザはサンドボックスで壁紙を触れないので、
  本家 LeagueDisplays 風に「選ぶ → そのまま壁紙」を実現する `local_app.py` を用意した。
  UX は **複数選択 → 確認モーダル → 一括設定** (`js/wallpaper.js`)。設計上の要点:
  - **serve.py は触らず別ファイル**: serve.py は「ただの静的サーバ」の役割
    (CLAUDE.md / PyCharm run config が前提) を壊さない。壁紙設定はダウンロード・OS
    呼び出し・SSRF/CSRF 面など別の関心事なので `local_app.py` に分離 (起動を切替える
    だけ)。`SimpleHTTPRequestHandler` を継承して静的配信はそのまま + `/api/*` を足す
  - **同一コードベースで Pages と両立**: フロントは `/api/ping` を叩いて「ローカル
    モード」を feature-detect (`js/local.js` の `probeLocal`)。Pages では 404 になり
    壁紙 UI を一切出さない (段階的デグレード)。CSP は `connect-src 'self'` で `/api` を
    既に許可済み、画像はサーバ側取得なので変更不要
  - **エンドポイントは `/api/wallpaper` 1本** (`{urls, interval}`)。サーバが選択画像を
    専用フォルダ (`%LOCALAPPDATA%/.../current`) に一括 DL し、**枚数で振り分け**: 1枚=静止
    壁紙、2枚以上=OS 純正スライドショー (フォルダを参照させる)。1枚パスは「スライドショー
    解除」も兼ねる
  - **壁紙設定は stdlib のみ / OS 純正機構を使う**: Windows=`IDesktopWallpaper` COM を
    ctypes で直叩き (vtable: `SetWallpaper`=3 / `SetPosition`=10 / `SetSlideshow`=12 /
    `SetSlideshowOptions`=14。設定アプリ自身が使う API なので背景種類・最近使った画像と
    整合し、スライドショーは OS 管理 = アプリ終了後も継続。失敗時はレガシー
    `SystemParametersInfoW`+`winreg` にフォールバック)、macOS=`osascript` (静止は picture、
    スライドショーは System Events の pictures folder + picture rotation)、
    Linux=GNOME `gsettings` (静止は picture-uri、スライドショーは生成した
    slideshow XML を指す。非 GNOME は `feh` で先頭1枚静止)。COM 関連 (WINFUNCTYPE /
    windll / HRESULT) は Windows 専用なので参照は必ず関数本体内に置く (mac/Linux で
    import しても壊れない)。pywebview だけが任意の追加依存
  - **セキュリティ** (多層防御): ①`127.0.0.1` bind + 取得元を
    `raw.communitydragon.org` https に固定 (SSRF)、リダイレクト先も
    `_SafeRedirectHandler` で毎回再検証 ②`/api` はカスタムヘッダ `X-OLD-Local` 必須
    (CSRF: クロスサイトからは付けられない) ③**Host ヘッダをループバックリテラルに
    限定** (DNS リバインディングで same-origin 化されカスタムヘッダ防御を抜けてくる
    攻撃を `_host_ok()` で遮断) ④保存名は URL の sha1 (path traversal 回避)、壁紙設定は
    subprocess を argv list で呼ぶ (shell 不使用 → コマンドインジェクション無し)
  - **CORS は Pages オリジン限定の2口だけ** (`CORS_ALLOWED_ORIGINS` = badfalcon.github.io /
    `CORS_API_PATHS` = /api/ping + /api/handoff): Web 版からの**本物の起動検知と直接送信**用
    (js/desktop.js の項参照)。`_json()` が ACAO を注入するので **409/403 のエラーにも付く**
    (ACAO の無いエラーは fetch が status を見せずに reject し、フロントが「409=窓なし→deep link
    タブ」と「接続失敗=未起動」を区別できない)。preflight は `do_OPTIONS` が受け、
    `Access-Control-Request-Private-Network` には `Allow-Private-Network: true` を返す
    (Chrome の PNA は public→local だと GET でも preflight する)。Allow-Headers に X-OLD-Local
    を載せるのが「この1オリジンへの明示的な信頼」で、CSRF ヘッダ必須と `_host_ok()` は全経路で
    従来どおり。**/api/wallpaper と /api/quit には付けない** (壁紙・終了は same-origin 限定の
    まま)。実行時フラグにはしない (ローカルプロセスにインストール済みコピーの信頼境界を広げ
    させないため定数)。**フォークは定数を自オリジンに書き換えて再ビルドが必要** (README に記載。
    放置しても旧来の fire-and-forget に劣化するだけで壊れない)
  - **永続キャッシュ必須**: Linux(gsettings)/macOS/Windows いずれも純正スライドショーは
    壁紙を「フォルダ/パス参照」で設定する (コピーしない) ので、`/tmp` だと再起動で
    壁紙が消える。ユーザ専用の永続 dir
    (`%LOCALAPPDATA%` / `~/Library/Application Support` / `~/.local/share`) に保存する
  - **配布**: `local_app.spec` (PyInstaller) を `release.yml` が tag push 時に各 OS で
    ビルドして Release に添付。**バイナリはリポジトリにコミットしない** (no-binaries)
  - **カスタム URL スキーム `openleaguedisplay://`** (Web → デスクトップ版の受け渡し口):
    Web 版の「デスクトップ版に送る」が投げる `openleaguedisplay://import?keys=<base64url JSON>`
    を受ける。`keys_from_link()` が argv 中のスキーム URL から keys を取り出し、
    `import_fragment()` が `#import=<percent-encoded JSON>` に変換して**起動する窓/ブラウザの
    URL のフラグメントに載せる**だけ (フロントの `applyImportFromHash` が既に取り込み口)。
    Windows 限定 (mac/Linux は Info.plist / .desktop が要るので未対応。フロント側も
    `isWindows()` でしか投げない)
  - **多重起動の判定は bind そのもの** (`_Server.allow_reuse_address = os.name != "nt"`):
    http.server は既定で `SO_REUSEADDR` を立てるが、**Windows のそれは奪取セマンティクス**で
    **listen 中のポートに2つ目が bind できてしまう** (実測済み) → :8000 に2プロセスが並び、共有の
    壁紙フォルダ (`current`) を互いに prune し合う。そこで **Windows だけ OFF** にして bind を
    権威にする (POSIX の `SO_REUSEADDR` は listen 中のソケットを奪えず、切ると Ctrl+C 直後の
    再起動が TIME_WAIT で失敗するので ON のまま)。bind は原子的なので、起動のたびに ping する案
    (= 通常起動に毎回レイテンシ + 同時起動で両方が「空いている」と判断する TOCTOU) より良い。
    bind が失敗したときだけ `is_our_server()` (= `/api/ping`) で相手が自分かを確かめる
  - **受け渡し先の落とし穴 (`POST /api/handoff`)**: 既存インスタンスは通常 **pywebview のネイティブ窓**
    で、システムブラウザとは**同一オリジンでも localStorage のパーティションが別**。だから
    「ブラウザで `#import=` を開く」だけではユーザーが見ている窓のギャラリーに入らない。
    `hand_off_to_running()` が keys を POST し、**受け側が自分の窓を `load_url` で `#import=` に
    飛ばす** (ナビゲート先 URL は受け側が keys から組み立てる = 呼び出し側に URL を指定させない)。
    窓が無い (ブラウザモード / `--no-window`) 時は 409 を返し、呼び出し側がブラウザタブで開く
    (その場合は同一プロファイル・同一オリジンなので正しく届く)。**フロント側にも受け口が要る**:
    `load_url` は**同一ドキュメント内のフラグメント遷移**になるので init は再実行されない →
    `js/app.js` の `maybeHandleImportHash()` を popstate / hashchange に張って、起動後に飛んで
    きた `#import=` も取り込む (取り込んだら `#/gallery` に書き換え + 先頭へスクロール)
  - **`POST /api/quit` = 自主終了の口** (ゲートは他の POST と同じ CSRF ヘッダ + Host 制限)。
    応答を返してから 0.3 秒後に、窓があれば `window.destroy()` (→ `webview.start()` が戻り
    main() の finally が後始末 = 通常の終了経路)、窓が無ければ `server.shutdown()`。存在理由は
    インストーラ (下記): onefile PyInstaller はブートローダ+子の2プロセスで、Inno の
    Restart Manager による丁寧なクローズが**いつまでも終わらない**ことがある (実際に踏んだ)。
    「アプリに終了を頼む」のが exe のロック解放の確実な方法
  - **スキームの登録はインストーラだけが行う** (`windows.iss` の `[Registry]`)。**アプリ自身は
    `Software\Classes` を一切書かない** (壁紙のレガシー fallback が `Control Panel\Desktop` を
    書くのは別件): 起動のたびに書き直す自己修復案も検討したが、インストーラ版を
    入れている人が一度でも `python local_app.py` / ポータブル exe を起動すると、その時点で
    ハンドラの宛先がそっちに差し替わる (= 意図しない乗っ取り) ため採らなかった。副作用として
    ポータブル exe と直起動ではリンクが効かない (= 「インストーラ版の機能」と割り切る。README /
    ハンドオフのモーダル文言も「インストーラ版 (setup.exe) なら」と明記している)
  - **スキームの脅威モデル** (登録した以上、**任意の Web ページがこのアプリを起動できる**。
    ブラウザは確認ダイアログを出すが、押し通されると仮定して設計する): ①リンク全体を
    `IMPORT_LINK_RE` の**厳格一致**でしか受けない (action は `import` 1つ、payload は base64url
    charset のみ、長さ上限 `MAX_LINK_CHARS`。素の JSON payload・追加クエリ・他 action は全部
    拒否) ②レジストリのコマンドは `"exe" "%1"` なので、リンクにダブルクォートを混ぜて
    argv を注入する古典手が効かないよう、**charset にクォートを含めない** (`re.ASCII` も付ける。
    無いと IGNORECASE の unicode 畳み込みで `İ`/`ı`/`ſ`/`K` まで通る) + スキーム起動時は
    **argv の残りを丸ごと捨てる** (`--no-window` や port を後付けさせない) ③リンクにできるのは
    「ギャラリーにスキンを選択済みにする」ことだけ (data.json に無いキーはフロントで落ちる)。
    画像の取得も壁紙の適用もユーザーのクリックが要る (`/api/wallpaper` の CSRF ヘッダ +
    Host 制限は従来どおり)
- **Windows は正規インストーラも配る (Inno Setup)**: bare exe だけだとスタート
  メニューにも「アプリと機能」にも載らず "ちゃんとしたソフトウェア感" が無い。
  `installer/windows.iss` (Inno Setup 6) で setup.exe を作り、`release.yml` の
  Windows ジョブが tag push 時にビルドして Release に添付する。設計の要点:
  - **per-user インストール** (`PrivilegesRequired=lowest`、
    `{localappdata}\Programs\OpenLeagueDisplay`): UAC 昇格不要。アプリのデータ
    (壁紙キャッシュ `%LOCALAPPDATA%` / HKCU の壁紙設定) が元々 per-user なので
    権限モデルと一致する
  - **PyInstaller は onefile のまま**: インストーラは既存の単一 exe を同梱して
    ショートカットを張るだけ。spec 構成を変えず mac/linux ジョブにも無影響
  - **アイコン (`icon.ico`) は小さなブランド資産としてコミット**: `ogp.png` /
    `screenshot.png` と同類 (~10KB) なのでリポジトリに置く。no-binaries ポリシーが
    避けたいのはスプラッシュ画像 (~600MB) とリリース実行ファイルであって、これは
    対象外。当初 CI で ImageMagick によりビルド時生成を試みたが、Windows ランナーの
    RSVG デリゲートが SVG を読めず (`RenderRSVGImage` 失敗) 不安定だったため、
    `make_icon.py` (Pillow で `favicon.svg` と同じ図形を直接描画) で生成して
    コミットする方式にした。ブランド変更時だけ `make_icon.py` を再実行する。
    `local_app.spec` が Windows (`sys.platform=="win32"`) でだけ `icon=` に渡して
    exe に埋め込み (mac は .icns 形式が別なので None)、`installer/windows.iss` が
    `SetupIconFile` とショートカット `IconFilename` に使う
  - **bare exe (ポータブル) も残す**: setup.exe を推奨導線にしつつ、インストールを
    好まない人向けに従来の単一 exe も Release に併置 (生成コストはほぼゼロ)
  - **`[Registry]` で `openleaguedisplay://` を登録** (Web からの受け渡し口。上の local_app.py の
    項参照)。`Root: HKA` = 通常の per-user インストールでは HKCU、`PrivilegesRequiredOverridesAllowed`
    で per-machine に昇格した場合は HKLM に書かれる。ルートキーに `uninsdeletekey` を付けて
    あるのでアンインストールで丸ごと消える。**スキームを登録する唯一の場所がここ** (アプリ側は
    レジストリを書かない = 理由は local_app.py の項)。ポータブル exe にリンク起動が要る、と
    なったら「登録するかを尋ねるインストーラ的な導線」を別途足すこと (黙って書かない)
  - **アンインストールで壁紙キャッシュは消さない**: 現在設定中の壁紙ファイルを壊さ
    ないため `%LOCALAPPDATA%\OpenLeagueDisplay` は残し、アプリ本体のみ削除する
  - **起動中インスタンスは自分で退かせる** (`[Code] QuitRunningApp`): ファイルコピー直前
    (`PrepareToInstall`) とアンインストール開始時に、`/api/ping` で相手が本当にこのアプリだと
    確認してから `POST /api/quit` (WinHttp COM で X-OLD-Local ヘッダ付き) → ping が消えるまで
    ~5秒ポーリング。**Restart Manager 任せにしない理由**: onefile PyInstaller の
    ブートローダ+子ペアは RM の丁寧なクローズが終わらないことがある (「強制終了が終わらない」
    として実際に踏んだ)。届かなかった場合 (別ポート / /api/quit の無い旧ビルド) の
    バックストップが `[Setup] CloseApplications=force` (待ち続けずに強制終了。未保存データは
    無いので安全)。Pascal の `{ }` コメント内にリテラル波括弧を書かないこと (`{app}` と書くと
    コメントがそこで閉じる)
  - **既インストール検知 (`[Code] InitializeSetup`)**: setup 再実行時に挙動を分ける。
    **同一バージョンが既に入っている** → 「修復(再インストール)/アンインストール/
    キャンセル」の 3択 MsgBox。**別バージョン** (上げ/下げ) → 何も出さず黙って上書き
    更新 (Inno の既定 = AppId 固定なので in-place アップグレード)。**未インストール** →
    通常インストール。Inno には MSI 的な Modify/Repair/Remove ページが無いので
    `InitializeSetup` で HKCU(無ければ HKLM) の `…\Uninstall\{AppId}_is1` の
    `DisplayVersion`/`UninstallString` を読んで判定する。GUID は `#define MyGuid` に
    切り出して `[Setup] AppId` と `[Code]` で共用 (アンインストールキーは波括弧付き
    `{GUID}_is1` なのでコード側はリテラルの波括弧を連結する)。版判定は文字列一致のみ
    (セマンティックな大小比較はしない)
  - **無署名**: コード署名証明書を持たないので setup.exe / exe とも無署名。Windows は
    SmartScreen で「詳細情報 → 実行」が要る (README に明記)。証明書を入手したら
    `[Setup] SignTool` と署名ステップを足す
- **changelog は GitHub 自動生成ノートで持つ**: `release.yml` の
  `generate_release_notes: true` で、`v*` タグ時に前回タグからマージされた PR を
  `.github/release.yml` の分類 (新機能/修正/ドキュメント/セキュリティ/その他) で集約
  して Release ノートにする。**手書き `CHANGELOG.md` は持たない** (同期ズレを避ける /
  「changelog が無いから作る」と誤って手書きファイルを足さないこと)。カテゴリ分けは
  PR ラベル依存なので、ラベルはリリース時に手で貼るか、必要になったら PR タイトルの
  prefix (`feat:`/`fix:`/...) からラベルを自動付与する workflow を足す (現状は未導入)。
  週次の data.json 自動更新は PR ではなく main への直 push なのでノートには出ない
- **モバイルレスポンシブ**: `@media (max-width: 600px)` で列数とフォントサイズを調整
- **デザイン**: 深い黒紫 (`--bg: #07060b` / `--bg-1: #0c0b14`) × 落ち着いた
  ゴールド (`--gold: #d4a857`)。Google Fonts は Cinzel (eyebrow / 見出し) +
  Fraunces (本文) + JetBrains Mono (等幅) の 3 系統。色は CSS 変数 (`--bg`,
  `--gold`, `--gold-hi`, `--gold-deep`, ...) で集約しているので、テーマ
  変更は :root の宣言を触るだけで済む
- **多言語表示 (i18n)**: `data.json` 本体は CDragon の `default` ロケール (英語) を
  そのまま持ち、各 LoL クライアント locale (ja_jp, ko_kr, zh_cn, ... の20言語) の
  翻訳名は `i18n/<locale>.json` に分離して持つ。ブラウザは初回 default で起動して
  必要時にだけ locale ファイルを fetch するので、英語利用者は追加帯域ゼロ。
  画像URLは locale 非依存 (CDragon の global asset は1セットのみ) なので i18n
  ファイルは「名前マップ + 説明文」だけ (`champions` / `skins` /
  `skin_descriptions` / `champion_descriptions` / `lines`)。スキン説明文と
  全チャンピオン紹介文を含むため 1 locale あたり ~650KB-1.5MB
  (id_id ~650KB / ja_jp ~930KB / th_th・el_gr は CJK・ギリシャ文字で 1.4-1.6MB)。
  `champion_descriptions` 追加分は +100-220KB/locale 程度で、大半は既存の
  `skin_descriptions` 由来。各 locale は必要時のみ fetch、英語利用者は追加帯域ゼロ。
- **i18n キーは英語の `<alias>//<skin label>`**: SELECT_KEY と同じ命名。ブラウザは
  `state.i18n.skins[key] || s.label` のフォールバックで、翻訳が無いキー (新スキンで
  未訳など) は英語にフォールバックして表示が壊れない。skins[] は locale 間で
  同じ index で並ぶ前提 (CDragon の構造上保証)。`_walk_skins_with_index` が
  default 側で覚えたパス情報を locale ロード時に再使用する。
- **Classic スキンの説明文は champion 紹介文で補完**: CDragon は Classic/base
  スキンに skin 単位の `description` を持たないため、ライトボックス/スライドショーで
  デフォルトスキンの説明欄が常に空になる。対策として generate_data.py が
  per-champion JSON の `shortBio` を `clean_bio` (HTML タグ除去 + 実体参照復元)
  して各チャンピオンの `bio` フィールド (data.json) と locale 別
  `champion_descriptions` (i18n) に格納し、`skinDescription()` が **Classic
  スキンのときだけ** `championBio()` でフォールバック表示する。非 base で desc
  欠落のスキンは従来どおり空 (畳まれる)。フォールバック順は skin 翻訳 → skin 英語
  desc → champion 翻訳 bio → champion 英語 bio。
- **リリース日順は LoL Wiki から取る (CDragon に無いため)**: UI の「リリース日順」
  ソートは当初 CDragon の `champion-summary.json` の並び (= 内部 champion id 昇順) を
  そのまま流用していたが、id は開発初期に予約されるため**実リリース日とズレる**
  (例: Naafiri は id=950 で 2023-07 実装なのに後発の Hwei(910)/Smolder(901) より後ろ /
  Aurora は id=893 で 2024-07 実装なのに前方)。CDragon/DDragon の静的データには
  リリース日フィールド自体が無いので、`generate_data.py` の `fetch_release_dates()` が
  LoL Wiki の `Module:ChampionData/data` から `{id: "YYYY-MM-DD"}` を取り、各
  チャンピオンに `release` として埋める。取得は MediaWiki API
  (`api.php?action=query&prop=revisions&rvprop=content`) 経由で Lua 本文を JSON で
  受け取り、正規表現で `["apiname"]`↔`["date"]` をペア抽出する (wiki の `?action=raw`
  は両 wiki とも 403、公式 wiki は API も 403 で bot を弾くため、唯一 API が通る Fandom
  ミラー `leagueoflegends.fandom.com` を使う)。**突合は apiname (= Riot 内部名 =
  CDragon alias) で行う**ので表示名ゆれ (Renata Glasc/Renata, K'Sante/KSante,
  Wukong/MonkeyKing) を吸収できる。当初は `["id"]` で突合していたが、wiki の id は
  Ahri のブロックをテンプレ流用したコピペミスで誤りがある (Ambessa/Mel が Ahri と同じ
  id=103 を持ち、id 突合だと Mel の date "2025-01-23" が Ahri を上書きしていた) ため
  apiname に切替えた。週次
  `update.yml` が毎回叩くので**手動メンテ不要** (CHAMPION_REGIONS と違い新キャラ追加時の
  追記も要らない)。多層フォールバック: ①取得/パース失敗時は `{}` を返し全員 `release`
  無し → フロント (`relKey`/`cmpRelease` in render.js) が "9999-99-99" 扱いで従来の
  id 順に倒れる (後方互換) ②個別の日付欠落 (Fandom が未掲載の最新キャラ等) は末尾=
  最新側に置き、`[警告] リリース日 未取得` を出す (次回更新で Wiki が追記されれば自動で
  埋まる。最新キャラが末尾に来るのは時系列的に正しいので順序は破綻しない)。`Array#sort`
  は安定なので同日付・欠落どうしは id 順を保つ
- **スキン単位のリリース日も Wiki + 初見スタンプのハイブリッドで持つ**: ホームのヒーロー
  「新着スプラッシュ」用に各スキンへ `release` ("YYYY-MM-DD") を埋める。ソースは wiki の
  `Module:SkinData/data` (`fetch_skin_release_dates()`。probe 2026-07 で 1901/1901 スキンが
  `["release"]` を保有と確認)。**突合は数値ペア (チャンピオン id, スキン番号 = CDragon skin
  id % 1000)** で名前ゆれ無し。wiki の champ id にはコピペミス前歴があるため、id が重複した
  ブロックだけ表示名で解決する二段構え。**ただし Fandom ミラーは ~2024-09 で凍結**
  (本家 wiki.leagueoflegends.com は API/raw とも 403 で bot を弾く — 再 probe 済み) ので、
  凍結後のスキンは①前回 data.json の値を引き継ぎ (`load_prev_skin_releases`)、②wiki にも
  前回にも無い**トップレベル**スキンへ実行日をスタンプ (初見 ≒ リリース。週次 update.yml の
  粒度で正確化していく。questSkinInfo のティアはスタンプ対象外 = 「新着」を汚さない)。
  スタンプは wiki 取得が生きている時のみ (全滅時に全スキンが「今日」になる汚染を防ぐ)。
  初回スタンプで凍結期間のコホート (~211件) が同日になるのは既知の近似で、以後のパッチで
  自然に解消する。パーサはインデント桁で階層判定 (lore 文字列に波括弧が入るため brace
  カウントは不可。champion=2桁 / skins=6桁 / フィールド=8桁、chromas は 10桁以深で除外)

## CDragon のパスマッピング (重要)

CDragon の skin JSON で返るパス `/lol-game-data/assets/ASSETS/Characters/...` は、
公式ドキュメント通り以下の規則で実URLに変換する:

```
/lol-game-data/assets/<path>
  → https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/<path-lowercased>
```

例:
- 入力: `/lol-game-data/assets/ASSETS/Characters/Aatrox/Skins/Base/AatroxLoadScreen.jpg`
- 出力: `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/assets/characters/aatrox/skins/base/aatroxloadscreen.jpg`

`generate_data.py` の `cdragon_url()` がこれを実装。変更時はこの規則を壊さないこと。

## コンベンション

- **Pythonは標準ライブラリのみ** (generate_data.py は GitHub Actions の素のPython3で動く)。
  `serve.py` と `local_app.py` の**コアも stdlib のみ** (壁紙設定は ctypes/winreg/
  subprocess、配信は http.server)。**例外は pywebview 1つだけ** — `local_app.py` の
  ネイティブ窓表示にだけ使う任意依存で、未インストールならブラウザ起動にフォール
  バックする (= 必須ではない)。data 生成系 (generate_data.py / update.yml) では一切使わない
- **クライアント側の機能ライブラリ依存は CDN1本まで**: 現状は **JSZip** のみ
  (`cdn.jsdelivr.net` から defer で遅延読込)。リポジトリには何も置かない方針は維持。
  これとは別にアクセス解析として **Cloudflare Web Analytics** の beacon
  (`static.cloudflareinsights.com/beacon.min.js`) を index.html 末尾で defer 読込
  している。Cookie レスでビューアの機能には関与しないので「機能ライブラリ」とは
  別枠。CDN 障害時もビューアは動く。beacon の token は index.html の
  `data-cf-beacon` に直書き、計測先 `cloudflareinsights.com` は CSP の
  `connect-src` で許可済み
- **CSS変数で色管理**: ハードコードしない (`--bg`, `--gold` 等)
- **ファイル名はsnake_case**、CSSクラスはケバブケース、JS関数はキャメルケース
- **コメントは「なぜ」を書く**。何をしているかはコードで読める

## やり残し / 次に試したいこと

- [x] ~~コレクション別フィルタ (PROJECT, Star Guardian 等)~~ → スキンラインビューで対応
- [x] ~~お気に入り機能~~ → 選択モード + ZIPまとめDLで実用上カバー
- [x] ~~ローカルの実行ファイル化 + そのまま壁紙設定 (本家 LeagueDisplays 風)~~ →
  `local_app.py` (stdlib + 任意 pywebview) で実装。My Gallery で複数選択 → 確認モーダル
  (`js/wallpaper.js`) → 「壁紙にする」で一括設定 (`POST /api/wallpaper`)。各 OS バイナリは
  `release.yml` が tag push 時に build & Release。Web (Pages) 版は feature-detect で
  従来通り
- [x] ~~壁紙スライドショー回転~~ → **OS 純正スライドショー**に作り直した。当初は Python の
  タイマースレッドで静止画を設定し直す自前方式だったが、設定アプリの背景種類が
  「スライドショー」にならず・アプリを閉じると止まる問題があったため、各 OS の純正機構に
  寄せた: 2枚以上選択時は Windows=`IDesktopWallpaper` COM (ctypes 直叩き) /
  macOS=System Events のフォルダローテーション / Linux(GNOME)=slideshow XML を構成する。
  これで OS が回し続け (アプリ終了後も継続)、設定アプリにも「スライドショー」と出る。
  間隔は確認モーダルの 1/5/15/30/60 分ピッカー (localStorage 永続化) を OS に渡す。
  1枚だけなら静止壁紙にする (=スライドショー解除も兼ねる)
- [x] ~~OGP/Twitter Card メタタグ追加 (シェア時のサムネ)~~ → `ogp.png`
  (1200x630 ブランドカード) を追加、`twitter:card` を `summary_large_image`
  に。og:image は絶対URL指定 (クローラは相対URLを解決しない)
- [x] ~~PWAマニフェスト追加してスマホでホーム画面追加可能に~~ → `manifest.webmanifest` +
  `icon-maskable.svg` で実装済み。アイコンは SVG (リポジトリにバイナリを置かない方針)。
  `sw.js` で同一オリジンの GET (アプリシェル + `data.json` / `i18n/*.json`) を一律
  network-first で扱い、キャッシュはオフライン時のフォールバックに徹する。当初シェルは
  stale-while-revalidate だったが、ソース編集や言語切替が「リロードするまで反映されない」
  (旧 JS が配られ続ける) 開発時の罠を避けるため network-first に統一した (静的ファイルは
  ETag で実体ほぼ 304 なので毎ロードの再取得は安い)。スプラッシュ画像 (CDragon) は
  キャッシュ対象外。完全なオフライン動作 (画像込み) は未対応
- [x] ~~アニメーションスプラッシュ (`splashVideoPath`) を持つスキンは動画再生~~ →
  `generate_data.py` が `splashVideoPath` を `video` フィールドに取り込み、
  ライトボックスが `video` を持つスキンで `<img>` の代わりに `<video>` を再生
  (poster に静止 splash、muted+loop+playsinline で autoplay)。一覧カードには
  ▶ バッジを出して開く前に動くと分かるようにした。`video` の無いスキンや
  旧 data.json では従来通り静止 splash 表示 (完全に後方互換)
- [x] ~~選択状態を localStorage に保存して再訪時に復元~~ → `LS_SELECTED_KEY` で実装済み (再訪時に選択モードも自動ON)
- [x] ~~表示言語の永続化~~ → `LS_LOCALE_KEY` で実装済み (初回は `navigator.languages` から推定)
- [x] ~~キーボードショートカット一覧モーダル (? キーで表示)~~ → 専用モーダルは作らず
  チュートリアル第4ステップとして実装 (? キーで開く既存動線をそのまま流用)
- [x] ~~「最近追加されたスキン」セクション (data.json 差分から検出)~~ → ホームの
  ヒーロー「新着スプラッシュ」(js/hero.js) として実装。データはスキン単位 `release`
  (wiki SkinData + 初見スタンプ、上の設計判断参照) で、差分検出より正確な全履歴を持つ。
  専用の一覧セクションを足したくなったら同じ `release` 降順で並べるだけ
- [x] ~~universe-meeps から地域データが取れていない~~ → サーバ側 S3 IAM 不全と判明
  (probe で `AccessDenied` 確定)、CHAMPION_REGIONS 直書きに切り替え済み
- [x] ~~REGION_LABELS の locale を増やす~~ → 地域名を実際に翻訳していると Web で
  裏どりできた 17 locale を登録 (it_it/es_mx/pl_pl/tr_tr/cs_cz/hu_hu/ro_ro を追加)。
  el_gr/th_th/id_id 等は実クライアントが地域名をラテン文字表記なのであえて未登録
  (default フォールバックで実表記と一致する)

## ローカル開発

```bash
# 初回 or マニフェスト更新時のみ
python generate_data.py

# 配信テスト
python serve.py
# → http://127.0.0.1:8000
```

**テスト/lintは無い**。単体テストフレームワーク・lint・フォーマッタの設定は
このリポジトリには存在しない。`generate_data.py` の構文確認は
`python -m py_compile generate_data.py` で十分。フロントは vanilla JS (ES
Modules) なのでビルドステップも無いが、`file://` 直開きでは ES Modules が
CORS で読めないので必ず `python serve.py` 経由でアクセスすること。
JS の構文確認は `node --check js/*.js` で軽く拾える。

**CDragon 接続が SSL エラーで落ちる場合**: 社内プロキシや古い中間CAが原因で
`CERTIFICATE_VERIFY_FAILED` が出ることがある。`generate_data.py` は1回目の
失敗で自動的に検証を無効化して再試行する仕組みになっているが、明示的に回避
したい時は `LOL_INSECURE=1 python generate_data.py` (PowerShell なら
`$env:LOL_INSECURE=1; python generate_data.py`)。**GitHub Actions では使わない**。

`serve.py` は `python -m http.server` 相当の薄いラッパー。PyCharm の Module モード
Run Configuration が SDK 紐付け時にモジュール名を取りこぼす挙動を踏むため、
スクリプトモードで安定して起動できるよう用意した。

PyCharm では `.idea/runConfigurations/` に以下の Run Configuration を共有設定として
チェックイン済み (Run ▸ で選べる):

- **Generate data.json** — `generate_data.py` を実行
- **Serve (http.server :8000)** — `serve.py` を実行
- **Run desktop app (local_app.py)** — ローカル実行モード (壁紙設定) をネイティブ窓/ブラウザで起動
- **Build desktop exe (PyInstaller)** — `python -m PyInstaller --noconfirm local_app.spec`。
  `dist/OpenLeagueDisplay.exe` を生成 (要 `pip install pyinstaller pywebview`)
- **Build installer (Inno Setup)** — `build_installer.py` を実行し `installer/out/...setup.exe` を生成。
  **exe も毎回作り直してから包む** (インストーラは dist の exe を同梱するだけ + exe はフロント一式を
  内蔵しているので、exe が古いままだと「ビルド成功したのに中身が古い setup.exe」が黙って出来上がる
  — 実際に踏んだ罠)。既存 exe をそのまま包みたい時だけ `--skip-exe` (exe のビルド日時を表示する)。
  要 `pip install pyinstaller pywebview` + Inno Setup 6 (`winget install JRSoftware.InnoSetup`)

exe / installer ビルドはあくまで**手元確認用**。配布は従来どおり `release.yml` が tag push 時に
CI で行う (バイナリは非コミット。`dist/` `build/` `installer/out/` は .gitignore 済み)。

## デプロイ

`README.md` の手順参照。GitHub Pages に push するだけ。

## このプロジェクトの背景 (チャット履歴サマリ)

ユーザーは League Displays (Riot の公式スプラッシュ閲覧アプリ、2020年の Spirit
Blossom 以降ほぼ放置 → 2021年5月に一度だけキャッチアップ更新が入ったあと、
2021年7月以降に追加されたスキンが一切入らないまま実質凍結) のファン。代替を作る
過程で以下を辿った:

1. **CLI ダウンローダー** (`lol_splash_downloader.py`): 当初は Riot の Data Dragon
   を使ったが Wild Rift 等の幽霊エントリで失敗率76%。CDragon に切り替えて失敗率0%へ。
   ローカルに 2000 枚超 (約600MB) をダウンロード
2. **ローカルWebサーバビューア**: HTTPサーバ + HTML → 「サーバ立てる意味あるか？」
   と指摘され、サーバ廃止して静的HTML生成版に変更
3. **Tkinter ネイティブGUI**: 「HTMLじゃなくてローカルの実行ファイルにしたい」
   との要望で Tkinter + Pillow で書き直し。Xvfb 上で動作確認済み
4. **Web版 (現在のこのプロジェクト)**: 「Web完結のほうが良いかも、GitHub Pagesで
   公開できる？」となり、最終的にこの形に至った

過去のCLI/ネイティブ版は別途ローカルに残しているはず。このプロジェクトはWeb版に集中。

## ライセンス・法的注意

- スクリプト本体は MIT 相当で改変可
- 画像/データの著作権は Riot Games, Inc. に帰属
- Riot Games 公認ではない。CDragon の "Legal Jibber Jabber" ポリシー下のアセット
  参照のみ。Riot のクライアントやAPIに直接アクセスはしていない
- 個人利用の範囲を超えて商用化・大規模再配布はしないこと
- **デスクトップ版バイナリ (release.yml 配布)**: MIT のアプリ本体 + `data.json`
  メタデータ (Pages で既に公開しているのと同じ、名前 + CDragon URL) を同梱するだけ。
  **画像は同梱せず**、実行時に CDragon からユーザー自身のマシンへ取得して壁紙にする
  (個人利用)。免責文はネイティブ窓でも同じ `index.html` フッターに出る (別途同意画面は不要)
