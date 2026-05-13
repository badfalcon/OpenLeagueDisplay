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
├── index.html                       # ビューア本体 (HTML + CSS + JS、~18KB)
├── generate_data.py                 # CDragon → data.json 生成スクリプト
├── serve.py                         # ローカル配信ラッパー (http.serverを薄く包む)
├── data.json                        # チャンピオン/スキンのマニフェスト (~1.1MB、初回 generate_data.py で生成)
├── i18n/<locale>.json               # 言語別の名前辞書 (1ファイル100-200KB、generate_data.py で同時生成)
├── .github/workflows/update.yml     # 週次 (月曜09:00 JST) で data.json 自動更新
├── README.md
└── .gitignore
```

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
  剥がして格納。**地域だけ CDragon に無いので** Riot Universe API
  (`universe-meeps.leagueoflegends.com`) を generate_data.py の
  `fetch_universe_champion_regions()` (default のみ) と `_fetch_universe_factions()`
  (各 locale) で補助的に叩く (build-time のみ; ブラウザは触らない)。universe slug は
  alias.lower() / name.lower() の正規化で CDragon と突き合わせ (Wukong=name vs
  MonkeyKing=alias のケースを両方で当てる)。ロール/rarity の翻訳は有限セット
  (6 + 4 キー) なので index.html 内の `ROLE_LABELS` / `RARITY_LABELS` に
  ハードコード、地域名は i18n/<locale>.json の `regions` フィールド。
- **ZIP化はブラウザ側 (JSZip)**: サーバ無しの方針を維持。JPEGは元々圧縮済みなので
  ZIP内では `STORE` (無圧縮格納) で処理時間を短縮
- **モバイルレスポンシブ**: `@media (max-width: 600px)` で列数とフォントサイズを調整
- **デザイン**: LoLクライアント風ダークブルー (#010a13) × ゴールド (#c89b3c)、
  見出しは Google Fonts の Cinzel
- **多言語表示 (i18n)**: `data.json` 本体は CDragon の `default` ロケール (英語) を
  そのまま持ち、各 LoL クライアント locale (ja_jp, ko_kr, zh_cn, ... の20言語) の
  翻訳名は `i18n/<locale>.json` に分離して持つ。ブラウザは初回 default で起動して
  必要時にだけ locale ファイルを fetch するので、英語利用者は追加帯域ゼロ。
  画像URLは locale 非依存 (CDragon の global asset は1セットのみ) なので i18n
  ファイルは「名前マップだけ」。1 locale 約 130KB。
- **i18n キーは英語の `<alias>//<skin label>`**: SELECT_KEY と同じ命名。ブラウザは
  `state.i18n.skins[key] || s.label` のフォールバックで、翻訳が無いキー (新スキンで
  未訳など) は英語にフォールバックして表示が壊れない。skins[] は locale 間で
  同じ index で並ぶ前提 (CDragon の構造上保証)。`_walk_skins_with_index` が
  default 側で覚えたパス情報を locale ロード時に再使用する。

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

- **Pythonは標準ライブラリのみ** (generate_data.py は GitHub Actions の素のPython3で動く)
- **クライアント側依存は CDN1本まで**: 現状は **JSZip** のみ (`cdn.jsdelivr.net` から
  defer で遅延読込)。リポジトリには何も置かない方針は維持
- **CSS変数で色管理**: ハードコードしない (`--bg`, `--gold` 等)
- **ファイル名はsnake_case**、CSSクラスはケバブケース、JS関数はキャメルケース
- **コメントは「なぜ」を書く**。何をしているかはコードで読める

## やり残し / 次に試したいこと

- [x] ~~コレクション別フィルタ (PROJECT, Star Guardian 等)~~ → スキンラインビューで対応
- [x] ~~お気に入り機能~~ → 選択モード + ZIPまとめDLで実用上カバー
- [ ] OGP/Twitter Card メタタグ追加 (シェア時のサムネ) ※テキストのみ済、画像は未
- [ ] PWAマニフェスト追加してスマホでホーム画面追加可能に
- [ ] アニメーションスプラッシュ (`splashVideoPath`) を持つスキンは動画再生
- [x] ~~選択状態を localStorage に保存して再訪時に復元~~ → `LS_SELECTED_KEY` で実装済み (再訪時に選択モードも自動ON)
- [x] ~~表示言語の永続化~~ → `LS_LOCALE_KEY` で実装済み (初回は `navigator.languages` から推定)
- [ ] キーボードショートカット一覧モーダル (? キーで表示)
- [ ] 「最近追加されたスキン」セクション (data.json 差分から検出)
- [ ] **universe-meeps から地域データが取れていない**: generate_data.py の
  `fetch_universe_champion_regions()` / `_fetch_universe_factions()` が
  常に 0 件を返している (2026-05 時点)。URL/schema の仮定が外れている可能性。
  GitHub Actions の最新 run の log で `[警告] universe-meeps から 0 件`
  を出力した直後の挙動を見て、`champions/index.json` / `factions/index.json`
  への GET が HTTP 200 で返ってるか、レスポンス JSON のトップレベル shape を
  実物で確認する。データが取れるようになると検索の地域軸 (Demacia/Noxus 等) が
  自動で有効化される (data.json/i18n の `regions` フィールドは schema として
  既に存在しているので index.html 側の変更不要)

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
`python -m py_compile generate_data.py` で十分。フロントは vanilla JS なので
ビルドステップも無い (ブラウザで `index.html` を開けば即動く)。

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

## デプロイ

`README.md` の手順参照。GitHub Pages に push するだけ。

## このプロジェクトの背景 (チャット履歴サマリ)

ユーザーは League Displays (Riot の公式スプラッシュ閲覧アプリ、2020年のパッチ10.19
で更新停止) のファン。代替を作る過程で以下を辿った:

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
