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
│   ├── render.js                    #   view レンダリング (home / champion / lines / line)
│   ├── zip.js                       #   ZIP DL (JSZip)
│   ├── lightbox.js                  #   ライトボックス + (全画面) スライドショー
│   ├── tutorial.js                  #   初回訪問チュートリアル (4ステップ。? ボタン / ? キーで再表示)
│   ├── share.js                     #   サイト共有 (Web Share API / クリップボードコピーのフォールバック)
│   ├── local.js                     #   ローカル実行検知 + 壁紙一括設定 API クライアント
│   ├── wallpaper.js                 #   壁紙の確認モーダル (選択→確認→一括設定。ローカルのみ)
│   └── desktop.js                   #   デスクトップ版の訴求 + Web→ネイティブの選択受け渡し (Web のみ)
├── sw.js                            # Service Worker (アプリシェルのキャッシュ)
├── generate_data.py                 # CDragon → data.json 生成スクリプト
├── serve.py                         # ローカル配信ラッパー (http.serverを薄く包む)
├── local_app.py                     # ローカル実行モード: 静的配信 + /api 壁紙設定 (stdlib + 任意 pywebview)
├── local_app.spec                   # デスクトップ版の PyInstaller spec (バイナリは非コミット)
├── build_installer.py               # installer/windows.iss を ISCC で叩くローカルビルド用ラッパー (stdlib)
├── installer/windows.iss            # Windows インストーラの Inno Setup スクリプト (バイナリ/icoは非コミット)
├── data.json                        # チャンピオン/スキンのマニフェスト (~1.7MB、初回 generate_data.py で生成)
├── i18n/<locale>.json               # 言語別の名前辞書 (1ファイル100-200KB、generate_data.py で同時生成)
├── .github/workflows/update.yml     # 週次 (月曜09:00 JST) で data.json 自動更新
├── .github/workflows/release.yml    # タグ push で各 OS のデスクトップバイナリを build & Release
├── .github/release.yml              # 自動生成リリースノート (changelog) の分類設定
├── README.md
└── .gitignore
```

### モジュール分割の指針

- **state.js**: mutable な `state` オブジェクトと、`let DATA` (setData 経由で
  更新)、SKIN_BY_KEY / LINE_INDEX、localStorage I/O、`$` / `esc` の汎用関数。
  他モジュールを import しない (依存される側専用)。`trapFocus` (依存ゼロの DOM
  ユーティリティ。モーダル/ライトボックス表示中に Tab で背景へフォーカスが抜けるのを
  防ぎ、解除関数を返す) もここに置く
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
  `shuffle` / `buildSelectedList` も内製 (render.js からは独立)。**操作系は上部の
  1 本のバー (`.lb-toolbar`) に集約**: 左に counter、右に 一時停止 (`#ss-pause`、
  スライドショー時のみ) / 画像フィット (`#lb-fit`、contain↔cover) / ⚙ メニュー
  (`#ss-options`、スライドショー時のみ) / 閉じる (`#lb-close`) を並べ、`#lb-close`
  が右端。`.lb-toolbar-spacer` (flex:1) が左右を押し分ける。ナビ矢印 (`.lb-nav`
  ‹ ›) だけはタップしやすさ優先で左右中央に大きく残す (モバイルは下隅)。間隔と
  キャプションは ⚙ メニュー (`#ss-menu`) にまとめてボタン数を抑える。キャプションは
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
  i18n / local の3つ (**render.js は import しない** = グラフの葉。受け渡し後の画面遷移と
  再描画は呼び出し側 app.js が持つ)。公開は4つ: ①`gateDownload(fn)` = 初回 ZIP DL 時に
  「デスクトップ版を入手 / このまま ZIP」を1回だけ尋ね、選択を `LS_DL_PROMPT_SEEN` に記憶
  (以降は素通し。ローカル実行時も素通し)。render.js の DL 3口を包む ②`openInDesktop()` =
  My Gallery の選択を deep link `http://127.0.0.1:8000/#import=<JSON keys>` にして
  デスクトップ版で開く。**選択は URL のフラグメントに載せる** (ローカルサーバに送られない
  = リクエスト長制限なし)。localStorage はオリジン別 (github.io ≠ 127.0.0.1) で共有
  できないための明示受け渡し ③`applyImportFromHash()` = 受け側。`#import=` を読んで
  SKIN_BY_KEY に在るキーだけ選択へマージし件数を返す (app.js 起動時に buildIndexes 後・
  ルーティング前に1回呼ぶ。終わったら hash を `#/gallery` に書換えて再取り込みを防ぐ)。
  ローカル限定にはしない (手貼りリンクでも動くように) ④`mountFooterCTA()` = フッターに
  デスクトップ版 CTA を1回注入 (ローカル時は no-op)。**別端末 (スマホ→PC) 向けに
  `exportSelection()` / `pickSelectionFile()` = 選択を JSON ファイル (`{v,keys}`) で
  書き出し/読み込み** (deep link が使えないクロスマシン経路。モード非依存で双方向)。
  キーのマージは `mergeKeys()` に共通化し ③ファイル取り込み両方が使う (data に在る・
  未選択のキーだけ採用)。汎用 2択モーダル (`choiceModal`) は
  wp-* の CSS を流用して①②で共用。**フッター CTA だけは英語固定** (フッターの帰属・
  ポリシー表記が意図的に非ローカライズなのに合わせる。①②③のUI文字列は i18n 済み)。
  ライトボックスのワンクリック「壁紙にする」(`#lb-wallpaper`) は別系統で、表示制御は
  lightbox.js (isLocalWallpaper)、クリック処理は app.js (`applyWallpaper([現在のsrc])`)
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
  - **永続キャッシュ必須**: Linux(gsettings)/macOS/Windows いずれも純正スライドショーは
    壁紙を「フォルダ/パス参照」で設定する (コピーしない) ので、`/tmp` だと再起動で
    壁紙が消える。ユーザ専用の永続 dir
    (`%LOCALAPPDATA%` / `~/Library/Application Support` / `~/.local/share`) に保存する
  - **配布**: `local_app.spec` (PyInstaller) を `release.yml` が tag push 時に各 OS で
    ビルドして Release に添付。**バイナリはリポジトリにコミットしない** (no-binaries)
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
  - **アンインストールで壁紙キャッシュは消さない**: 現在設定中の壁紙ファイルを壊さ
    ないため `%LOCALAPPDATA%\OpenLeagueDisplay` は残し、アプリ本体のみ削除する
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
- [ ] 「最近追加されたスキン」セクション (data.json 差分から検出)
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
  先に exe をビルドしておくこと + Inno Setup 6 が必要 (`winget install JRSoftware.InnoSetup`)

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
