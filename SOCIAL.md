# OpenLeagueDisplay — SNS 投稿下書き

公開URL: https://badfalcon.github.io/OpenLeagueDisplay/
リポジトリ: https://github.com/badfalcon/OpenLeagueDisplay

---

## X / Twitter

無料ユーザーは装飾不可・280字制限。すべてプレーンテキスト、URLは一律23字で計算。

### A. 日本語 / 短め (本文 約150字 + URL23 + タグ約25 = 約198字)

```
Riot公式の League Displays が2021年から放置されてるので、後継の静的Webサイトを作りました。

OpenLeagueDisplay
全チャンピオン×全スキンを眺めて、好きなのだけZIPで一括DL。20言語対応・PWA・週次自動更新。

https://badfalcon.github.io/OpenLeagueDisplay/

#LeagueOfLegends #LoL
```

### B. 日本語 / 機能列挙 (本文 約210字 + URL23 = 約233字)

```
League Displays の代わりに作った静的サイト OpenLeagueDisplay を公開しました。

・全チャンピオン×全スキンを閲覧
・選択したスキンをZIPで一括DL → Windowsの壁紙スライドショーに直挿し
・スキンライン (PROJECT, K/DA…) で横断
・20言語/モバイル/PWA
・GitHub Actionsで週次自動更新

https://badfalcon.github.io/OpenLeagueDisplay/
```

### C. 英語 / 海外向け (本文 約215字 + URL23 + タグ約25 = 約263字)

```
Riot's League Displays has been abandoned since 2021, so I built a community stand-in.

OpenLeagueDisplay - browse every champion x every skin in the browser, tick the ones you like, bulk-download as a ZIP. Static site, 20 locales, PWA.

https://badfalcon.github.io/OpenLeagueDisplay/

#LeagueOfLegends #LoL
```

### D. スレッド分割版 (詳しく書きたい場合)

1ツイート目:
```
League Displays が2021年から放置されてるので、ブラウザだけで動く後継を作りました。

OpenLeagueDisplay
https://badfalcon.github.io/OpenLeagueDisplay/

何ができるかは下のスレッドで↓
```

2ツイート目:
```
できること

・全チャンピオン×全スキンのスプラッシュを閲覧
・スキンライン (PROJECT, Star Guardian, K/DA…) で横断
・気に入ったスキンをチェック → ZIPで一括ダウンロード
・落としたフォルダをWindowsの壁紙スライドショーに指定すれば完成
```

3ツイート目:
```
技術メモ

・GitHub Pages にデプロイの完全静的サイト
・画像はリポジトリに置かず Community Dragon CDN を直接参照
・20言語対応 (英語以外は遅延ロードで帯域ゼロ)
・週1で GitHub Actions が data.json を自動更新

ソース (MIT): https://github.com/badfalcon/OpenLeagueDisplay
```

---

## Reddit

宛先候補: r/leagueoflegends, r/summonerschool (community tools), r/loldrops,
r/wallpapers。r/leagueoflegends は self-promotion ルールが厳しめなので、
事前にサブのルール確認を推奨。

### タイトル案

- *I rebuilt the abandoned League Displays as a static site — browse every skin and bulk-download the ones you like as a ZIP*
- *OpenLeagueDisplay: a browser-based replacement for League Displays, with bulk ZIP download for a local wallpaper slideshow*

### 本文

> Riot's official **League Displays** app has been frozen since 2021 — no new
> skins have been added in years and it's clearly not coming back. I wanted
> the old "wallpaper slideshow of every skin I like" workflow back, so I built
> a community replacement.
>
> **OpenLeagueDisplay** → https://badfalcon.github.io/OpenLeagueDisplay/
> (just open it, nothing to install)
>
> **What it does**
>
> - Browse every champion × every skin, or browse by skin line (PROJECT, Star
>   Guardian, K/DA, etc.)
> - Tick the skins you want and hit "ZIP selected" — you get a flat folder of
>   JPEGs that drops straight into Windows' "Background → Slideshow"
> - Full-screen slideshow with Ken Burns + crossfade if you just want to look
>   at pretty splash art in the browser
> - Cross-keyword search: champion name, skin name, role (Mage/Tank/…),
>   region (Demacia/Noxus/…), rarity (Legendary/Ultimate/…)
> - 20 client locales (English, 日本語, 한국어, 简体中文, Français, Deutsch, …)
> - Installable as a PWA on phones
>
> **How it works (for the curious)**
>
> - Fully static. Hosted on GitHub Pages. No backend.
> - Images are pulled directly from Community Dragon's CDN — none stored in the
>   repo. GitHub Actions regenerates the manifest weekly so the catalog stays
>   current automatically.
> - Source: https://github.com/badfalcon/OpenLeagueDisplay (MIT — fork it,
>   self-host your own, etc.)
>
> **Not affiliated with Riot Games.** Images are © Riot Games, Inc. and only
> referenced via Community Dragon under Riot's "Legal Jibber Jabber" policy.
> Don't use it for redistribution / commercial purposes — personal wallpaper
> use is the intent.
>
> Happy to take feedback / feature requests in this thread or on GitHub.

---

## LinkedIn

エンジニア向けの色を強めに。Riot 関連の固有名詞は前提として通る想定だが、
最初の1行で背景を説明しておく。

### 投稿本文

> **Side project: OpenLeagueDisplay**
>
> Riot Games shipped "League Displays" — a desktop splash-art viewer for League
> of Legends — back in 2019 and effectively abandoned it in 2021. I rebuilt it
> as a fully static, browser-based replacement.
>
> 🔗 Live: https://badfalcon.github.io/OpenLeagueDisplay/
> 🛠 Source: https://github.com/badfalcon/OpenLeagueDisplay (MIT)
>
> **What I'm happy with, technically:**
>
> • **Zero infrastructure.** Hosted on GitHub Pages. No server, no DB, no
>   container. A weekly GitHub Actions job regenerates a ~1 MB JSON manifest
>   from Community Dragon and commits it back — that's the entire backend.
>
> • **No image hosting.** Storing ~600 MB of splash art in the repo was a
>   non-starter. The browser fetches images directly from Community Dragon's
>   CDN (which sets `Access-Control-Allow-Origin: *`), so bulk ZIP downloads
>   are assembled client-side via JSZip and never touch GitHub's bandwidth.
>
> • **i18n that scales to zero cost.** The manifest only carries English
>   names; the other 19 locales (ja_jp, ko_kr, zh_cn, …) live in separate
>   ~15–160 KB JSON files that are fetched only if the user picks that
>   language. English users pay zero extra bandwidth.
>
> • **PWA + offline app shell.** Service worker caches HTML/CSS/JS
>   stale-while-revalidate; data files are network-first. Installable on
>   mobile.
>
> • **Vanilla JS, ES modules, no build step.** One CDN dependency (JSZip).
>   The whole front-end is ~7 KB of HTML plus a handful of ~small modules.
>
> Sometimes the most satisfying problems are the ones where the answer is
> "you don't need a backend at all."
>
> Not affiliated with Riot Games. Built on assets exposed via Community
> Dragon's "Legal Jibber Jabber"-compliant mirror.
>
> #WebDevelopment #JavaScript #GitHubPages #StaticSites #PWA #SideProject
> #LeagueOfLegends

---

## 投稿時の注意

- **X (無料ユーザー)**: 280字制限、太字/見出し/箇条書き記号などの書式不可
  (Premium に課金している場合のみ長文+書式可)。URLは実際の長さに関わらず
  一律23字でカウントされる。og:image (ogp.png) が summary_large_image で
  展開されるので、本文は URL 1本でカードが出る。複数枚画像を貼るなら
  screenshot.png も併用可。
- **Reddit**: r/leagueoflegends は self-promotion 10:1 ルールあり。Link post
  でなく self post 推奨、コメント欄での質問返しを丁寧に。
- **LinkedIn**: ハッシュタグは3–5個推奨 (上記は8個)。絞るなら
  `#WebDevelopment #PWA #SideProject` 程度に。
