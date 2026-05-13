# OpenLeagueDisplay

LeagueDisplays (Riot公式、2020年に更新停止) の代替を目指す閲覧ビューア。
GitHub Pages で公開できる完全静的サイト。
画像は **Community Dragon CDN** を直接参照するので Repo にはコードしか入っていません。
新パッチで新スキンが追加されたら GitHub Actions が週次で `data.json` を自動更新します。

**特徴**:
- 全 191 チャンピオン × 2103 スキンのスプラッシュをブラウザで閲覧
- チャンピオン別 / シリーズ別 (PROJECT, Star Guardian, K/DA など) で一覧
- 選択モードで好きなスキンをまとめてチェック → **ZIPでまとめてDL** (壁紙設定用)
- スライドショー (Ken Burns + クロスフェード)、検索、レスポンシブ対応

## デモ
GitHub Pages に置けば `https://<your-username>.github.io/<repo-name>/` で開きます。

## デプロイ手順 (5分)

1. **新規 Repo を作る** (例: `OpenLeagueDisplay`)
2. このフォルダの中身を全部 push:
   ```bash
   git init
   git add .
   git commit -m "initial commit"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<repo>.git
   git push -u origin main
   ```
3. **初回の data.json を生成**:
   ```bash
   python generate_data.py
   git add data.json && git commit -m "initial data" && git push
   ```
   (もしくは Actions タブから "Update splash data" → "Run workflow" で手動実行)
4. **GitHub Pages 有効化**: Repo の Settings → Pages → Source を "Deploy from a branch"
   にして、Branch を `main` / Folder を `/ (root)` に設定 → Save
5. 1〜2分待つと `https://<your-username>.github.io/<repo>/` で公開される

## ファイル構成

```
.
├── index.html                       # ビューア本体 (HTML + CSS + JS)
├── data.json                        # チャンピオン/スキンのマニフェスト (~1.1MB)
├── generate_data.py                 # data.json 生成スクリプト
├── .github/workflows/update.yml     # 週次自動更新 (毎週月曜 9:00 JST)
└── README.md
```

## 仕組み

- `data.json` は Community Dragon の `champion-summary.json` と各
  `champions/{id}.json` から構築される。サイズは ~1.1MB (gzip後 ~300KB)
- 画像URL(`splash`, `tile`, `loading`) は `https://raw.communitydragon.org/latest/...`
  を直接指している。Repo に画像は保存されない
- ブラウザは初回読み込み時に `data.json` を fetch、サムネは
  `<img loading="lazy">` で必要時にCDNから取得
- スライドショーは Ken Burns 効果 + クロスフェード対応
- モバイル対応 (Media Query でレイアウト切替)

## 操作

| キー / 操作 | 動作 |
|---|---|
| クリック | チャンピオン → スキン → 全画面 |
| `←` / `→` | 前後のスプラッシュ |
| `Esc` | 戻る / 全画面解除 |
| `Space` | スライドショー一時停止 |
| 検索バー | チャンピオン / シリーズでフィルタ |
| シリーズ | ヘッダーのボタンからシリーズ一覧へ |
| 選択モード | チェックボックスでスキン選択 → ヘッダー「⬇ 選択分をZIP」で一括DL |
| チャンピオンページ | 「⬇ 全スキンをZIP」ボタンでそのチャンピオン分まとめてDL |
| シリーズページ | 「⬇ このシリーズをZIP」ボタンでそのシリーズ全部DL |

### ZIP DLについて

- ファイルは `<チャンピオン名>/<スキン名>.jpg` という構造で入る
- JPEG は元々圧縮されているのでZIP内は無圧縮格納 (時間短縮優先)
- 並列度6でCDragonから直接取得。CDragon側で 404 になっているスキンは
  完了時にカウントだけ表示してスキップ
- ローカルで展開 → Windowsなら「個人用設定 → 背景 → スライドショー」で
  当該フォルダを指定すれば LeagueDisplays 相当の壁紙ローテーションになる

## 自動更新を止めたい

`.github/workflows/update.yml` を削除するか、`schedule:` セクションをコメントアウト。
手動で `python generate_data.py` を流して `data.json` を更新するだけでも OK。

## ライセンス

スクリプト本体は MIT License 相当で自由に改変可。
取得する画像/データの著作権は **Riot Games, Inc.** に帰属します。
個人利用の範囲を超える再配布や商用利用は避けてください。

このプロジェクトは Riot Games 公認ではありません。
Riot Games の "Legal Jibber Jabber" ポリシーの下で Community Dragon が公開している
アセットを参照しているだけで、Riot のクライアントや API に直接アクセスはしていません。
