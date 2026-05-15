// UI 文字列 (UI_STRINGS) と locale 解決まわり。
// チャンピオン/スキン名翻訳 (i18n/<locale>.json) とは別に UI chrome は同梱する。

import { state, $, lsGet, LS_LOCALE_KEY, DATA, SELECT_KEY } from "./state.js";
import { renderStats } from "./render.js";

// UI 文字列の i18n テーブル。チャンピオン/スキン名翻訳 (i18n/<locale>.json) とは別に、
// UI chrome (ボタン/プレースホルダ/エラー/進捗) は同梱で済ませる。未掲載 locale は
// default (英語) にフォールバック。プレースホルダは {0}, {1} 形式。
export const UI_STRINGS = {
  default: {
    search_placeholder: "Search champion or skin…",
    lang_aria: "Display language",
    nav_home: "Champions",
    nav_lines: "Skin Lines",
    nav_slideshow: "Slideshow",
    section_skins: "Skins",
    select_mode: "My Gallery",
    select_mode_on: "✓ My Gallery",
    back: "← Back",
    loading_title: "LOADING",
    loading_msg: "Loading manifest…",
    error_title: "ERROR",
    error_load_data: "Failed to load data.json: {0}",
    hint_no_data: 'No <code>data.json</code> yet. In the project root, run:<br><code style="color:var(--gold)">python generate_data.py</code><br>once (fetches from Community Dragon, 1–3 min).',
    stats_format: "{0} CHAMPIONS · {1} SKINS",
    last_updated: "Last updated: {0}",
    no_results_title: "No results",
    no_results_msg: '"{0}" not found',
    no_lines_msg: "No skin lines found",
    skins_count: "{0} skins",
    champs_count: "{0} champions",
    lines_count: "{0} lines",
    skin_lines_header: "SKIN LINES",
    dl_champion: "⬇ All as ZIP",
    dl_line: "⬇ Line as ZIP",
    dl_selected: "⬇ Download Gallery",
    selected_count: "{0} in gallery",
    clear: "Clear",
    zip_creating: "Creating ZIP",
    zip_compressing: "Compressing ZIP",
    zip_bundling: "Bundling files…",
    zip_pack_desc: "Packing {1} skins of {0}",
    zip_pack_desc_selected: "Packing {0} skins from your gallery",
    zip_failed: "Done. {0} files failed (likely 404 on CDragon).",
    zip_bundling_pct: "Bundling {0}%",
    zip_count_failed: "failed {0}",
    progress_cancel: "Cancel",
    lb_close_aria: "Close",
    lb_prev_aria: "Previous",
    lb_next_aria: "Next",
    lb_aria: "Splash zoom view",
    mode_slideshow: "Slideshow",
    mode_viewer: "Viewer",
    ss_interval: "⏱ {0}s",
    ss_pause: "⏸ Pause",
    ss_resume: "▶ Resume",
    jszip_load_failed: "Failed to load JSZip CDN (10s).",
    slideshow_empty: "Add skins to My Gallery first to use the slideshow.",
    sort_aria: "Sort order",
    sort_default: "Default",
    sort_name_asc: "Name A → Z",
    sort_name_desc: "Name Z → A",
    tut_help_aria: "Open guide",
    tut_skip: "Skip",
    tut_back: "Back",
    tut_next: "Next",
    tut_done: "Got it",
    tut_step: "{0} / {1}",
    tut_s1_title: "Welcome",
    tut_s1_body: "Browse the splash art for every League of Legends champion and skin.<br><br>Pick favorites and download them as a ZIP — perfect for desktop wallpapers.",
    tut_s2_title: "Select & Download",
    tut_s2_body: "Tap <strong>Select</strong> in the header to enter selection mode.<br>Click any skin to toggle it. Click a champion card to toggle <em>all</em> of its skins.<br><br>The floating bar at the bottom shows your count and downloads the ZIP. You can also grab a whole champion or skin line from its detail page.",
    tut_s3_title: "More to try",
    tut_s3_body: "Click any splash to open it full-size.<br><strong>Slideshow</strong> plays your selection as a fullscreen show.<br>Use the flag button to switch language.<br><br>Press <code>?</code> anytime to reopen this guide.",
  },
  ja_jp: {
    search_placeholder: "チャンピオン/スキン検索...",
    lang_aria: "表示言語",
    nav_home: "チャンピオン",
    nav_lines: "シリーズ",
    nav_slideshow: "スライドショー",
    section_skins: "スキン",
    select_mode: "マイギャラリー",
    select_mode_on: "✓ マイギャラリー",
    back: "← 戻る",
    loading_title: "LOADING",
    loading_msg: "マニフェストを読み込み中…",
    error_title: "ERROR",
    error_load_data: "data.json を読み込めませんでした: {0}",
    hint_no_data: 'まだ <code>data.json</code> がありません。プロジェクトのルートで:<br><code style="color:var(--gold)">python generate_data.py</code><br>を一度実行してください (Community Dragon から取得、1〜3分)。',
    stats_format: "{0} CHAMPIONS · {1} SKINS",
    last_updated: "最終更新: {0}",
    no_results_title: "該当なし",
    no_results_msg: '"{0}" は見つかりませんでした',
    no_lines_msg: "シリーズが見つかりませんでした",
    skins_count: "{0} スキン",
    champs_count: "{0} チャンピオン",
    lines_count: "{0} シリーズ",
    skin_lines_header: "シリーズ",
    dl_champion: "⬇ 全スキンをZIP",
    dl_line: "⬇ このシリーズをZIP",
    dl_selected: "⬇ ギャラリーをDL",
    selected_count: "ギャラリーに {0} 枚",
    clear: "クリア",
    zip_creating: "ZIPを作成中",
    zip_compressing: "ZIPを圧縮中",
    zip_bundling: "ファイルを束ねています…",
    zip_pack_desc: "{0} の {1} スキンをパック中",
    zip_pack_desc_selected: "ギャラリーの {0} スキンをパック中",
    zip_failed: "完了。{0}件の取得に失敗しました (CDragon 側で 404 など)",
    zip_bundling_pct: "束ね中 {0}%",
    zip_count_failed: "失敗 {0}",
    progress_cancel: "中止",
    lb_close_aria: "閉じる",
    lb_prev_aria: "前へ",
    lb_next_aria: "次へ",
    lb_aria: "スプラッシュ拡大表示",
    mode_slideshow: "スライドショー",
    mode_viewer: "ビューア",
    ss_interval: "⏱ 間隔 {0}秒",
    ss_pause: "⏸ 一時停止",
    ss_resume: "▶ 再開",
    jszip_load_failed: "JSZip CDN の読込に失敗しました (10秒)",
    slideshow_empty: "先にマイギャラリーにスキンを追加してください",
    sort_aria: "並び順",
    sort_default: "デフォルト",
    sort_name_asc: "名前 A → Z",
    sort_name_desc: "名前 Z → A",
    tut_help_aria: "ガイドを開く",
    tut_skip: "スキップ",
    tut_back: "戻る",
    tut_next: "次へ",
    tut_done: "OK",
    tut_step: "{0} / {1}",
    tut_s1_title: "ようこそ",
    tut_s1_body: "LoL の全チャンピオン・全スキンのスプラッシュアートをまとめて閲覧できます。<br><br>気に入ったものを選んで ZIP でまとめてダウンロード。デスクトップの壁紙にどうぞ。",
    tut_s2_title: "選んで ZIP DL",
    tut_s2_body: "ヘッダの <strong>選択モード</strong> をタップで選択モードに入ります。<br>スキンをクリックで追加/解除。チャンピオンカードのクリックで<em>そのチャンピオン全スキン</em>を一括トグル。<br><br>画面下のバーに件数が出るので、そこから ZIP をダウンロード。各チャンピオン/シリーズの詳細ページから一括 DL もできます。",
    tut_s3_title: "他の機能",
    tut_s3_body: "スプラッシュをクリックすると拡大表示。<br><strong>スライドショー</strong> ボタンで全画面再生。<br>国旗ボタンから表示言語を切替できます。<br><br><code>?</code> キーでいつでもこのガイドを再表示。",
  },
  ko_kr: {
    search_placeholder: "챔피언/스킨 검색…",
    lang_aria: "표시 언어",
    nav_home: "챔피언",
    nav_lines: "스킨 라인",
    nav_slideshow: "슬라이드쇼",
    section_skins: "스킨",
    select_mode: "마이 갤러리",
    select_mode_on: "✓ 마이 갤러리",
    back: "← 뒤로",
    loading_title: "LOADING",
    loading_msg: "매니페스트 로딩 중…",
    error_title: "ERROR",
    error_load_data: "data.json 로드 실패: {0}",
    hint_no_data: '아직 <code>data.json</code>이 없습니다. 프로젝트 루트에서:<br><code style="color:var(--gold)">python generate_data.py</code><br>를 한 번 실행하세요 (Community Dragon에서 가져오기, 1~3분).',
    stats_format: "{0} 챔피언 · {1} 스킨",
    last_updated: "최종 업데이트: {0}",
    no_results_title: "결과 없음",
    no_results_msg: '"{0}" 을(를) 찾을 수 없습니다',
    no_lines_msg: "스킨 라인을 찾을 수 없습니다",
    skins_count: "{0} 스킨",
    champs_count: "{0} 챔피언",
    lines_count: "{0} 라인",
    skin_lines_header: "스킨 라인",
    dl_champion: "⬇ 전체를 ZIP으로",
    dl_line: "⬇ 라인을 ZIP으로",
    dl_selected: "⬇ 갤러리 다운로드",
    selected_count: "갤러리에 {0}개",
    clear: "지우기",
    zip_creating: "ZIP 생성 중",
    zip_compressing: "ZIP 압축 중",
    zip_bundling: "파일을 묶는 중…",
    zip_pack_desc: "{0} 의 {1} 스킨 패킹 중",
    zip_pack_desc_selected: "갤러리의 {0} 스킨 패킹 중",
    zip_failed: "완료. {0}건 실패 (CDragon에서 404 등).",
    zip_bundling_pct: "묶는 중 {0}%",
    zip_count_failed: "실패 {0}",
    progress_cancel: "취소",
    lb_close_aria: "닫기",
    lb_prev_aria: "이전",
    lb_next_aria: "다음",
    lb_aria: "스플래시 확대 보기",
    mode_slideshow: "슬라이드쇼",
    mode_viewer: "뷰어",
    ss_interval: "⏱ 간격 {0}초",
    ss_pause: "⏸ 일시정지",
    ss_resume: "▶ 재개",
    jszip_load_failed: "JSZip CDN 로드 실패 (10초).",
    slideshow_empty: "먼저 마이 갤러리에 스킨을 추가해 주세요.",
    sort_aria: "정렬 순서",
    sort_default: "기본",
    sort_name_asc: "이름 ㄱ → ㅎ",
    sort_name_desc: "이름 ㅎ → ㄱ",
    tut_help_aria: "가이드 열기",
    tut_skip: "건너뛰기",
    tut_back: "뒤로",
    tut_next: "다음",
    tut_done: "확인",
    tut_step: "{0} / {1}",
    tut_s1_title: "환영합니다",
    tut_s1_body: "리그 오브 레전드의 모든 챔피언과 스킨의 스플래시 아트를 모아 볼 수 있습니다.<br><br>마음에 드는 항목을 골라 ZIP으로 다운로드하세요. 데스크톱 배경화면으로 좋아요.",
    tut_s2_title: "선택 & 다운로드",
    tut_s2_body: "헤더의 <strong>선택</strong> 을 눌러 선택 모드로 들어갑니다.<br>스킨을 클릭하면 추가/해제, 챔피언 카드를 클릭하면 <em>해당 챔피언의 모든 스킨</em>이 일괄 전환됩니다.<br><br>하단의 플로팅 바에 선택 개수가 표시되고, 거기서 ZIP을 받을 수 있습니다. 각 챔피언/스킨 라인 페이지에서 일괄 다운로드도 가능합니다.",
    tut_s3_title: "더 알아보기",
    tut_s3_body: "스플래시를 클릭하면 확대해서 볼 수 있습니다.<br><strong>슬라이드쇼</strong> 버튼으로 전체화면 슬라이드쇼.<br>국기 버튼으로 표시 언어를 바꿀 수 있습니다.<br><br><code>?</code> 키로 언제든지 이 가이드를 다시 열 수 있습니다.",
  },
  zh_cn: {
    search_placeholder: "搜索英雄/皮肤…",
    lang_aria: "显示语言",
    nav_home: "英雄",
    nav_lines: "皮肤系列",
    nav_slideshow: "幻灯片",
    section_skins: "皮肤",
    select_mode: "我的画廊",
    select_mode_on: "✓ 我的画廊",
    back: "← 返回",
    loading_title: "LOADING",
    loading_msg: "正在加载清单…",
    error_title: "ERROR",
    error_load_data: "无法加载 data.json: {0}",
    hint_no_data: '尚无 <code>data.json</code>。请在项目根目录运行:<br><code style="color:var(--gold)">python generate_data.py</code><br>一次 (从 Community Dragon 获取, 1~3 分钟).',
    stats_format: "{0} 英雄 · {1} 皮肤",
    last_updated: "上次更新: {0}",
    no_results_title: "无结果",
    no_results_msg: '未找到 "{0}"',
    no_lines_msg: "未找到皮肤系列",
    skins_count: "{0} 皮肤",
    champs_count: "{0} 英雄",
    lines_count: "{0} 系列",
    skin_lines_header: "皮肤系列",
    dl_champion: "⬇ 全部打包",
    dl_line: "⬇ 此系列打包",
    dl_selected: "⬇ 下载画廊",
    selected_count: "画廊中 {0} 张",
    clear: "清除",
    zip_creating: "正在创建 ZIP",
    zip_compressing: "正在压缩 ZIP",
    zip_bundling: "正在打包文件…",
    zip_pack_desc: "正在打包 {0} 的 {1} 个皮肤",
    zip_pack_desc_selected: "正在打包画廊中的 {0} 个皮肤",
    zip_failed: "完成。{0} 个失败 (可能是 CDragon 404)。",
    zip_bundling_pct: "打包中 {0}%",
    zip_count_failed: "失败 {0}",
    progress_cancel: "取消",
    lb_close_aria: "关闭",
    lb_prev_aria: "上一张",
    lb_next_aria: "下一张",
    lb_aria: "原画放大查看",
    mode_slideshow: "幻灯片",
    mode_viewer: "查看器",
    ss_interval: "⏱ 间隔 {0} 秒",
    ss_pause: "⏸ 暂停",
    ss_resume: "▶ 继续",
    jszip_load_failed: "JSZip CDN 加载失败 (10秒)。",
    slideshow_empty: "请先将皮肤添加到我的画廊。",
    sort_aria: "排序方式",
    sort_default: "默认",
    sort_name_asc: "名称 A → Z",
    sort_name_desc: "名称 Z → A",
    tut_help_aria: "打开指南",
    tut_skip: "跳过",
    tut_back: "返回",
    tut_next: "下一步",
    tut_done: "知道了",
    tut_step: "{0} / {1}",
    tut_s1_title: "欢迎",
    tut_s1_body: "在这里浏览英雄联盟所有英雄和皮肤的原画。<br><br>选中喜欢的，一次性打包为 ZIP 下载 — 当作桌面壁纸再合适不过。",
    tut_s2_title: "选择 & 下载",
    tut_s2_body: "点击顶部的 <strong>选择</strong> 进入选择模式。<br>点击皮肤切换选中状态。点击英雄卡片可<em>切换该英雄的全部皮肤</em>。<br><br>底部浮动栏会显示已选数量，从那里下载 ZIP。也可以从英雄/系列详情页一键打包整个集合。",
    tut_s3_title: "更多功能",
    tut_s3_body: "点击任意原画即可放大查看。<br><strong>幻灯片</strong> 按钮可全屏播放选中的内容。<br>使用国旗按钮切换显示语言。<br><br>按 <code>?</code> 随时打开此指南。",
  },
  zh_tw: {
    search_placeholder: "搜尋英雄/造型…",
    lang_aria: "顯示語言",
    nav_home: "英雄",
    nav_lines: "造型系列",
    nav_slideshow: "幻燈片",
    section_skins: "造型",
    select_mode: "我的畫廊",
    select_mode_on: "✓ 我的畫廊",
    back: "← 返回",
    loading_title: "LOADING",
    loading_msg: "正在載入清單…",
    error_title: "ERROR",
    error_load_data: "無法載入 data.json: {0}",
    hint_no_data: '尚無 <code>data.json</code>。請在專案根目錄執行:<br><code style="color:var(--gold)">python generate_data.py</code><br>一次 (從 Community Dragon 取得, 1~3 分鐘).',
    stats_format: "{0} 英雄 · {1} 造型",
    last_updated: "上次更新: {0}",
    no_results_title: "無結果",
    no_results_msg: '找不到 "{0}"',
    no_lines_msg: "找不到造型系列",
    skins_count: "{0} 造型",
    champs_count: "{0} 英雄",
    lines_count: "{0} 系列",
    skin_lines_header: "造型系列",
    dl_champion: "⬇ 全部打包",
    dl_line: "⬇ 此系列打包",
    dl_selected: "⬇ 下載畫廊",
    selected_count: "畫廊中 {0} 張",
    clear: "清除",
    zip_creating: "正在建立 ZIP",
    zip_compressing: "正在壓縮 ZIP",
    zip_bundling: "正在打包檔案…",
    zip_pack_desc: "正在打包 {0} 的 {1} 個造型",
    zip_pack_desc_selected: "正在打包畫廊中的 {0} 個造型",
    zip_failed: "完成。{0} 個失敗 (可能是 CDragon 404)。",
    zip_bundling_pct: "打包中 {0}%",
    zip_count_failed: "失敗 {0}",
    progress_cancel: "取消",
    lb_close_aria: "關閉",
    lb_prev_aria: "上一張",
    lb_next_aria: "下一張",
    lb_aria: "原畫放大檢視",
    mode_slideshow: "幻燈片",
    mode_viewer: "檢視器",
    ss_interval: "⏱ 間隔 {0} 秒",
    ss_pause: "⏸ 暫停",
    ss_resume: "▶ 繼續",
    jszip_load_failed: "JSZip CDN 載入失敗 (10秒)。",
    slideshow_empty: "請先將造型加入我的畫廊。",
    sort_aria: "排序方式",
    sort_default: "預設",
    sort_name_asc: "名稱 A → Z",
    sort_name_desc: "名稱 Z → A",
    tut_help_aria: "開啟指南",
    tut_skip: "跳過",
    tut_back: "返回",
    tut_next: "下一步",
    tut_done: "知道了",
    tut_step: "{0} / {1}",
    tut_s1_title: "歡迎",
    tut_s1_body: "在這裡瀏覽英雄聯盟所有英雄與造型的原畫。<br><br>挑選喜歡的造型，一次打包成 ZIP 下載 — 拿來當桌面背景再合適不過。",
    tut_s2_title: "選擇 & 下載",
    tut_s2_body: "點選頂部的 <strong>選擇</strong> 進入選擇模式。<br>點選造型切換選取狀態。點選英雄卡片可<em>切換該英雄的全部造型</em>。<br><br>底部浮動列會顯示已選數量，從那裡下載 ZIP。也可以從英雄/系列詳情頁一鍵打包整組。",
    tut_s3_title: "其他功能",
    tut_s3_body: "點選任一原畫即可放大檢視。<br><strong>幻燈片</strong> 按鈕可全螢幕播放選取的內容。<br>透過國旗按鈕切換顯示語言。<br><br>按 <code>?</code> 隨時開啟此指南。",
  },
  fr_fr: {
    search_placeholder: "Rechercher un champion ou un skin…",
    lang_aria: "Langue d'affichage",
    nav_home: "Champions",
    nav_lines: "Gammes de skins",
    nav_slideshow: "Diaporama",
    section_skins: "Skins",
    select_mode: "Ma Galerie",
    select_mode_on: "✓ Ma Galerie",
    back: "← Retour",
    loading_title: "LOADING",
    loading_msg: "Chargement du manifeste…",
    error_title: "ERROR",
    error_load_data: "Échec du chargement de data.json : {0}",
    hint_no_data: 'Pas encore de <code>data.json</code>. À la racine du projet, exécutez :<br><code style="color:var(--gold)">python generate_data.py</code><br>une fois (récupère depuis Community Dragon, 1–3 min).',
    stats_format: "{0} CHAMPIONS · {1} SKINS",
    last_updated: "Dernière mise à jour : {0}",
    no_results_title: "Aucun résultat",
    no_results_msg: '"{0}" introuvable',
    no_lines_msg: "Aucune gamme de skins trouvée",
    skins_count: "{0} skins",
    champs_count: "{0} champions",
    lines_count: "{0} gammes",
    skin_lines_header: "GAMMES DE SKINS",
    dl_champion: "⬇ Tout en ZIP",
    dl_line: "⬇ Gamme en ZIP",
    dl_selected: "⬇ Télécharger la galerie",
    selected_count: "{0} dans la galerie",
    clear: "Effacer",
    zip_creating: "Création du ZIP",
    zip_compressing: "Compression du ZIP",
    zip_bundling: "Regroupement des fichiers…",
    zip_pack_desc: "Empaquetage de {1} skins de {0}",
    zip_pack_desc_selected: "Empaquetage de {0} skins de la galerie",
    zip_failed: "Terminé. {0} échec(s) (probablement 404 sur CDragon).",
    zip_bundling_pct: "Regroupement {0}%",
    zip_count_failed: "échec {0}",
    progress_cancel: "Annuler",
    lb_close_aria: "Fermer",
    lb_prev_aria: "Précédent",
    lb_next_aria: "Suivant",
    lb_aria: "Vue agrandie du splash",
    mode_slideshow: "Diaporama",
    mode_viewer: "Visionneuse",
    ss_interval: "⏱ Intervalle {0}s",
    ss_pause: "⏸ Pause",
    ss_resume: "▶ Reprendre",
    jszip_load_failed: "Échec du chargement de JSZip CDN (10s).",
    slideshow_empty: "Ajoutez d'abord des skins à Ma Galerie.",
    sort_aria: "Ordre de tri",
    sort_default: "Par défaut",
    sort_name_asc: "Nom A → Z",
    sort_name_desc: "Nom Z → A",
    tut_help_aria: "Ouvrir le guide",
    tut_skip: "Passer",
    tut_back: "Retour",
    tut_next: "Suivant",
    tut_done: "Compris",
    tut_step: "{0} / {1}",
    tut_s1_title: "Bienvenue",
    tut_s1_body: "Parcourez les splash arts de tous les champions et skins de League of Legends.<br><br>Choisissez vos préférés et téléchargez-les en ZIP — parfait pour vos fonds d'écran.",
    tut_s2_title: "Sélection & Téléchargement",
    tut_s2_body: "Appuyez sur <strong>Sélection</strong> dans l'en-tête pour entrer en mode sélection.<br>Cliquez sur un skin pour le basculer. Cliquez sur la carte d'un champion pour basculer <em>tous</em> ses skins.<br><br>La barre flottante en bas affiche le nombre sélectionné et télécharge le ZIP. Vous pouvez aussi récupérer un champion entier ou une gamme depuis sa page détail.",
    tut_s3_title: "À découvrir aussi",
    tut_s3_body: "Cliquez sur n'importe quel splash pour l'ouvrir en grand.<br><strong>Diaporama</strong> joue votre sélection en plein écran.<br>Changez de langue avec le bouton drapeau.<br><br>Appuyez sur <code>?</code> à tout moment pour rouvrir ce guide.",
  },
  de_de: {
    search_placeholder: "Champion oder Skin suchen…",
    lang_aria: "Anzeigesprache",
    nav_home: "Champions",
    nav_lines: "Skin-Reihen",
    nav_slideshow: "Diashow",
    section_skins: "Skins",
    select_mode: "Meine Galerie",
    select_mode_on: "✓ Meine Galerie",
    back: "← Zurück",
    loading_title: "LOADING",
    loading_msg: "Manifest wird geladen…",
    error_title: "ERROR",
    error_load_data: "data.json konnte nicht geladen werden: {0}",
    hint_no_data: 'Noch keine <code>data.json</code>. Führe im Projektstamm aus:<br><code style="color:var(--gold)">python generate_data.py</code><br>einmal (lädt von Community Dragon, 1–3 Min).',
    stats_format: "{0} CHAMPIONS · {1} SKINS",
    last_updated: "Zuletzt aktualisiert: {0}",
    no_results_title: "Keine Treffer",
    no_results_msg: '"{0}" nicht gefunden',
    no_lines_msg: "Keine Skin-Reihen gefunden",
    skins_count: "{0} Skins",
    champs_count: "{0} Champions",
    lines_count: "{0} Reihen",
    skin_lines_header: "SKIN-REIHEN",
    dl_champion: "⬇ Alle als ZIP",
    dl_line: "⬇ Reihe als ZIP",
    dl_selected: "⬇ Galerie herunterladen",
    selected_count: "{0} in der Galerie",
    clear: "Löschen",
    zip_creating: "ZIP wird erstellt",
    zip_compressing: "ZIP wird komprimiert",
    zip_bundling: "Dateien werden gebündelt…",
    zip_pack_desc: "{1} Skins von {0} werden gepackt",
    zip_pack_desc_selected: "{0} Skins der Galerie werden gepackt",
    zip_failed: "Fertig. {0} fehlgeschlagen (vermutlich 404 bei CDragon).",
    zip_bundling_pct: "Bündeln {0}%",
    zip_count_failed: "Fehler {0}",
    progress_cancel: "Abbrechen",
    lb_close_aria: "Schließen",
    lb_prev_aria: "Zurück",
    lb_next_aria: "Weiter",
    lb_aria: "Splash-Großansicht",
    mode_slideshow: "Diashow",
    mode_viewer: "Viewer",
    ss_interval: "⏱ Intervall {0}s",
    ss_pause: "⏸ Pause",
    ss_resume: "▶ Fortsetzen",
    jszip_load_failed: "JSZip CDN konnte nicht geladen werden (10s).",
    slideshow_empty: "Bitte zuerst Skins zu Meine Galerie hinzufügen.",
    sort_aria: "Sortierreihenfolge",
    sort_default: "Standard",
    sort_name_asc: "Name A → Z",
    sort_name_desc: "Name Z → A",
    tut_help_aria: "Anleitung öffnen",
    tut_skip: "Überspringen",
    tut_back: "Zurück",
    tut_next: "Weiter",
    tut_done: "Verstanden",
    tut_step: "{0} / {1}",
    tut_s1_title: "Willkommen",
    tut_s1_body: "Durchstöbere die Splash Arts aller League of Legends Champions und Skins.<br><br>Wähle deine Favoriten und lade sie als ZIP — perfekt für Hintergrundbilder.",
    tut_s2_title: "Auswählen & Herunterladen",
    tut_s2_body: "Tippe oben auf <strong>Auswählen</strong>, um in den Auswahlmodus zu wechseln.<br>Klicke einen Skin an, um ihn umzuschalten. Klick auf eine Champion-Karte schaltet <em>alle</em> seine Skins um.<br><br>Die schwebende Leiste am unteren Rand zeigt die Anzahl und lädt das ZIP. Du kannst auch einen ganzen Champion oder eine Skin-Reihe direkt von seiner Detailseite holen.",
    tut_s3_title: "Weiteres",
    tut_s3_body: "Klicke einen Splash an, um ihn groß zu öffnen.<br><strong>Diashow</strong> spielt deine Auswahl im Vollbild ab.<br>Wechsle die Sprache über die Flaggen-Schaltfläche.<br><br>Drücke <code>?</code> jederzeit, um diese Anleitung erneut zu öffnen.",
  },
  es_es: {
    search_placeholder: "Buscar campeón o aspecto…",
    lang_aria: "Idioma",
    nav_home: "Campeones",
    nav_lines: "Líneas de aspectos",
    nav_slideshow: "Diapositivas",
    section_skins: "Aspectos",
    select_mode: "Mi Galería",
    select_mode_on: "✓ Mi Galería",
    back: "← Volver",
    loading_title: "LOADING",
    loading_msg: "Cargando manifiesto…",
    error_title: "ERROR",
    error_load_data: "No se pudo cargar data.json: {0}",
    hint_no_data: 'Aún no hay <code>data.json</code>. En la raíz del proyecto ejecuta:<br><code style="color:var(--gold)">python generate_data.py</code><br>una vez (obtiene de Community Dragon, 1–3 min).',
    stats_format: "{0} CAMPEONES · {1} ASPECTOS",
    last_updated: "Última actualización: {0}",
    no_results_title: "Sin resultados",
    no_results_msg: '"{0}" no encontrado',
    no_lines_msg: "No se encontraron líneas de aspectos",
    skins_count: "{0} aspectos",
    champs_count: "{0} campeones",
    lines_count: "{0} líneas",
    skin_lines_header: "LÍNEAS DE ASPECTOS",
    dl_champion: "⬇ Todos en ZIP",
    dl_line: "⬇ Línea en ZIP",
    dl_selected: "⬇ Descargar galería",
    selected_count: "{0} en la galería",
    clear: "Limpiar",
    zip_creating: "Creando ZIP",
    zip_compressing: "Comprimiendo ZIP",
    zip_bundling: "Empaquetando archivos…",
    zip_pack_desc: "Empaquetando {1} aspectos de {0}",
    zip_pack_desc_selected: "Empaquetando {0} aspectos de la galería",
    zip_failed: "Listo. {0} fallaron (probablemente 404 en CDragon).",
    zip_bundling_pct: "Empaquetando {0}%",
    zip_count_failed: "fallidos {0}",
    progress_cancel: "Cancelar",
    lb_close_aria: "Cerrar",
    lb_prev_aria: "Anterior",
    lb_next_aria: "Siguiente",
    lb_aria: "Vista ampliada del splash",
    mode_slideshow: "Diapositivas",
    mode_viewer: "Visor",
    ss_interval: "⏱ Intervalo {0}s",
    ss_pause: "⏸ Pausar",
    ss_resume: "▶ Reanudar",
    jszip_load_failed: "No se pudo cargar JSZip CDN (10s).",
    slideshow_empty: "Añade aspectos a Mi Galería primero.",
    sort_aria: "Orden",
    sort_default: "Predeterminado",
    sort_name_asc: "Nombre A → Z",
    sort_name_desc: "Nombre Z → A",
    tut_help_aria: "Abrir guía",
    tut_skip: "Omitir",
    tut_back: "Atrás",
    tut_next: "Siguiente",
    tut_done: "Entendido",
    tut_step: "{0} / {1}",
    tut_s1_title: "Bienvenido",
    tut_s1_body: "Explora las imágenes promocionales de todos los campeones y aspectos de League of Legends.<br><br>Elige tus favoritos y descárgalos en ZIP — ideal para fondos de pantalla.",
    tut_s2_title: "Seleccionar & Descargar",
    tut_s2_body: "Pulsa <strong>Seleccionar</strong> en la cabecera para entrar en modo selección.<br>Haz clic en un aspecto para alternarlo. Haz clic en la tarjeta de un campeón para alternar <em>todos</em> sus aspectos.<br><br>La barra flotante inferior muestra el conteo y descarga el ZIP. También puedes obtener un campeón entero o una línea desde su página de detalle.",
    tut_s3_title: "Más por descubrir",
    tut_s3_body: "Haz clic en cualquier splash para verlo a tamaño completo.<br><strong>Diapositivas</strong> reproduce tu selección a pantalla completa.<br>Cambia el idioma con el botón de bandera.<br><br>Pulsa <code>?</code> en cualquier momento para reabrir esta guía.",
  },
  pt_br: {
    search_placeholder: "Buscar campeão ou skin…",
    lang_aria: "Idioma",
    nav_home: "Campeões",
    nav_lines: "Linhas de skins",
    nav_slideshow: "Slideshow",
    section_skins: "Skins",
    select_mode: "Minha Galeria",
    select_mode_on: "✓ Minha Galeria",
    back: "← Voltar",
    loading_title: "LOADING",
    loading_msg: "Carregando manifesto…",
    error_title: "ERROR",
    error_load_data: "Falha ao carregar data.json: {0}",
    hint_no_data: 'Ainda não há <code>data.json</code>. Na raiz do projeto, execute:<br><code style="color:var(--gold)">python generate_data.py</code><br>uma vez (busca do Community Dragon, 1–3 min).',
    stats_format: "{0} CAMPEÕES · {1} SKINS",
    last_updated: "Última atualização: {0}",
    no_results_title: "Sem resultados",
    no_results_msg: '"{0}" não encontrado',
    no_lines_msg: "Nenhuma linha de skins encontrada",
    skins_count: "{0} skins",
    champs_count: "{0} campeões",
    lines_count: "{0} linhas",
    skin_lines_header: "LINHAS DE SKINS",
    dl_champion: "⬇ Todas em ZIP",
    dl_line: "⬇ Linha em ZIP",
    dl_selected: "⬇ Baixar galeria",
    selected_count: "{0} na galeria",
    clear: "Limpar",
    zip_creating: "Criando ZIP",
    zip_compressing: "Comprimindo ZIP",
    zip_bundling: "Empacotando arquivos…",
    zip_pack_desc: "Empacotando {1} skins de {0}",
    zip_pack_desc_selected: "Empacotando {0} skins da galeria",
    zip_failed: "Concluído. {0} falharam (provavelmente 404 no CDragon).",
    zip_bundling_pct: "Empacotando {0}%",
    zip_count_failed: "falhas {0}",
    progress_cancel: "Cancelar",
    lb_close_aria: "Fechar",
    lb_prev_aria: "Anterior",
    lb_next_aria: "Próxima",
    lb_aria: "Visualização ampliada do splash",
    mode_slideshow: "Slideshow",
    mode_viewer: "Visualizador",
    ss_interval: "⏱ Intervalo {0}s",
    ss_pause: "⏸ Pausar",
    ss_resume: "▶ Retomar",
    jszip_load_failed: "Falha ao carregar JSZip CDN (10s).",
    slideshow_empty: "Adicione skins a Minha Galeria primeiro.",
    sort_aria: "Ordem",
    sort_default: "Padrão",
    sort_name_asc: "Nome A → Z",
    sort_name_desc: "Nome Z → A",
    tut_help_aria: "Abrir guia",
    tut_skip: "Pular",
    tut_back: "Voltar",
    tut_next: "Próximo",
    tut_done: "Entendi",
    tut_step: "{0} / {1}",
    tut_s1_title: "Bem-vindo",
    tut_s1_body: "Navegue pelas splash arts de todos os campeões e skins de League of Legends.<br><br>Escolha seus favoritos e baixe em ZIP — ideal para papéis de parede.",
    tut_s2_title: "Selecionar & Baixar",
    tut_s2_body: "Toque em <strong>Selecionar</strong> no cabeçalho para entrar no modo de seleção.<br>Clique em uma skin para alternar. Clique no card de um campeão para alternar <em>todas</em> as skins dele.<br><br>A barra flutuante inferior mostra a contagem e baixa o ZIP. Você também pode pegar um campeão inteiro ou uma linha pela página de detalhes.",
    tut_s3_title: "Mais para explorar",
    tut_s3_body: "Clique em qualquer splash para abrir em tela cheia.<br><strong>Slideshow</strong> reproduz sua seleção em tela cheia.<br>Mude o idioma com o botão de bandeira.<br><br>Pressione <code>?</code> a qualquer momento para reabrir este guia.",
  },
  ru_ru: {
    search_placeholder: "Поиск чемпиона или образа…",
    lang_aria: "Язык",
    nav_home: "Чемпионы",
    nav_lines: "Серии образов",
    nav_slideshow: "Слайд-шоу",
    section_skins: "Образы",
    select_mode: "Моя галерея",
    select_mode_on: "✓ Моя галерея",
    back: "← Назад",
    loading_title: "LOADING",
    loading_msg: "Загрузка манифеста…",
    error_title: "ERROR",
    error_load_data: "Не удалось загрузить data.json: {0}",
    hint_no_data: 'Файл <code>data.json</code> отсутствует. В корне проекта выполните:<br><code style="color:var(--gold)">python generate_data.py</code><br>один раз (загрузка из Community Dragon, 1–3 мин).',
    stats_format: "{0} ЧЕМПИОНОВ · {1} ОБРАЗОВ",
    last_updated: "Обновлено: {0}",
    no_results_title: "Нет результатов",
    no_results_msg: '"{0}" не найдено',
    no_lines_msg: "Серии образов не найдены",
    skins_count: "{0} образов",
    champs_count: "{0} чемпионов",
    lines_count: "{0} серий",
    skin_lines_header: "СЕРИИ ОБРАЗОВ",
    dl_champion: "⬇ Все в ZIP",
    dl_line: "⬇ Серия в ZIP",
    dl_selected: "⬇ Скачать галерею",
    selected_count: "В галерее: {0}",
    clear: "Очистить",
    zip_creating: "Создание ZIP",
    zip_compressing: "Сжатие ZIP",
    zip_bundling: "Упаковка файлов…",
    zip_pack_desc: "Упаковка {1} образов чемпиона {0}",
    zip_pack_desc_selected: "Упаковка {0} образов из галереи",
    zip_failed: "Готово. Ошибок: {0} (вероятно, 404 на CDragon).",
    zip_bundling_pct: "Упаковка {0}%",
    zip_count_failed: "сбоев {0}",
    progress_cancel: "Отмена",
    lb_close_aria: "Закрыть",
    lb_prev_aria: "Назад",
    lb_next_aria: "Вперёд",
    lb_aria: "Увеличенный просмотр сплэша",
    mode_slideshow: "Слайд-шоу",
    mode_viewer: "Просмотр",
    ss_interval: "⏱ Интервал {0}с",
    ss_pause: "⏸ Пауза",
    ss_resume: "▶ Продолжить",
    jszip_load_failed: "Не удалось загрузить JSZip CDN (10с).",
    slideshow_empty: "Сначала добавьте образы в Мою галерею.",
    sort_aria: "Порядок сортировки",
    sort_default: "По умолчанию",
    sort_name_asc: "Имя А → Я",
    sort_name_desc: "Имя Я → А",
    tut_help_aria: "Открыть руководство",
    tut_skip: "Пропустить",
    tut_back: "Назад",
    tut_next: "Далее",
    tut_done: "Понятно",
    tut_step: "{0} / {1}",
    tut_s1_title: "Добро пожаловать",
    tut_s1_body: "Просматривайте сплэш-арты всех чемпионов и образов League of Legends.<br><br>Выбирайте любимые и скачивайте их одним ZIP — отлично подойдёт для обоев рабочего стола.",
    tut_s2_title: "Выбор & скачивание",
    tut_s2_body: "Нажмите <strong>Выбор</strong> в шапке, чтобы войти в режим выбора.<br>Клик по образу переключает его. Клик по карточке чемпиона переключает <em>все</em> его образы.<br><br>Плавающая панель внизу показывает количество и скачивает ZIP. Также можно взять целого чемпиона или серию со страницы детали.",
    tut_s3_title: "Что ещё попробовать",
    tut_s3_body: "Кликните по сплэшу, чтобы открыть его в полный размер.<br><strong>Слайд-шоу</strong> воспроизводит ваш выбор во весь экран.<br>Меняйте язык кнопкой с флагом.<br><br>Нажмите <code>?</code> в любой момент, чтобы открыть это руководство снова.",
  },
};
// t("key", arg0, arg1, ...) — locale 未掲載なら default に、key 未定義なら key 文字列を返す
export function t(key, ...args) {
  const table = UI_STRINGS[state.locale] || UI_STRINGS.default;
  const tmpl = table[key] || UI_STRINGS.default[key] || key;
  return tmpl.replace(/\{(\d+)\}/g, (_, i) => {
    const v = args[Number(i)];
    return v === undefined ? "" : String(v);
  });
}

// 検索キーワード用の翻訳マップ。表示には現状使わず、フィルタ判定でのみ使う。
// data.json は英語キーをそのまま持つ ("mage" / "Legendary") ので、ユーザが
// 翻訳済みワード ("メイジ" / "レジェンダリー") を打っても拾えるようにする。
// 値が無い locale は default にフォールバック (英語表記でだけマッチ)。
export const ROLE_LABELS = {
  default: { assassin: "Assassin", fighter: "Fighter", mage: "Mage", marksman: "Marksman", support: "Support", tank: "Tank" },
  ja_jp:   { assassin: "アサシン", fighter: "ファイター", mage: "メイジ", marksman: "マークスマン", support: "サポート", tank: "タンク" },
  ko_kr:   { assassin: "암살자", fighter: "전사", mage: "마법사", marksman: "원거리 딜러", support: "서포터", tank: "탱커" },
  zh_cn:   { assassin: "刺客", fighter: "战士", mage: "法师", marksman: "射手", support: "辅助", tank: "坦克" },
  zh_tw:   { assassin: "刺客", fighter: "戰士", mage: "法師", marksman: "射手", support: "輔助", tank: "坦克" },
  fr_fr:   { assassin: "Assassin", fighter: "Combattant", mage: "Mage", marksman: "Tireur", support: "Support", tank: "Tank" },
  de_de:   { assassin: "Assassine", fighter: "Kämpfer", mage: "Magier", marksman: "Schütze", support: "Unterstützer", tank: "Tank" },
  es_es:   { assassin: "Asesino", fighter: "Luchador", mage: "Mago", marksman: "Tirador", support: "Soporte", tank: "Tanque" },
  pt_br:   { assassin: "Assassino", fighter: "Lutador", mage: "Mago", marksman: "Atirador", support: "Suporte", tank: "Tanque" },
  ru_ru:   { assassin: "Убийца", fighter: "Боец", mage: "Маг", marksman: "Стрелок", support: "Поддержка", tank: "Танк" },
};
export const RARITY_LABELS = {
  default: { Epic: "Epic", Legendary: "Legendary", Mythic: "Mythic", Ultimate: "Ultimate" },
  ja_jp:   { Epic: "エピック", Legendary: "レジェンダリー", Mythic: "ミシック", Ultimate: "アルティメット" },
  ko_kr:   { Epic: "에픽", Legendary: "전설", Mythic: "신화", Ultimate: "궁극" },
  zh_cn:   { Epic: "史诗", Legendary: "传说", Mythic: "神话", Ultimate: "终极" },
  zh_tw:   { Epic: "史詩", Legendary: "傳說", Mythic: "神話", Ultimate: "終極" },
  fr_fr:   { Epic: "Épique", Legendary: "Légendaire", Mythic: "Mythique", Ultimate: "Ultime" },
  de_de:   { Epic: "Episch", Legendary: "Legendär", Mythic: "Mythisch", Ultimate: "Ultimativ" },
  es_es:   { Epic: "Épico", Legendary: "Legendario", Mythic: "Mítico", Ultimate: "Definitivo" },
  pt_br:   { Epic: "Épico", Legendary: "Lendário", Mythic: "Mítico", Ultimate: "Definitivo" },
  ru_ru:   { Epic: "Эпический", Legendary: "Легендарный", Mythic: "Мифический", Ultimate: "Великий" },
};
// 地域名は本来 universe-meeps API から取る予定だったが、Riot 側の S3 IAM 設定が
// 壊れていて永続的に 403 を返す (2026-05 確認)。代わりに ROLE/RARITY 同様に
// ハードコード。slug は generate_data.py の REGION_NAMES と必ず一致させること。
export const REGION_LABELS = {
  default: {
    "demacia": "Demacia", "noxus": "Noxus", "ionia": "Ionia", "piltover": "Piltover",
    "zaun": "Zaun", "bilgewater": "Bilgewater", "bandle-city": "Bandle City",
    "freljord": "Freljord", "shadow-isles": "Shadow Isles", "shurima": "Shurima",
    "targon": "Mount Targon", "ixtal": "Ixtal", "void": "Void", "runeterra": "Runeterra",
    "camavor": "Camavor", "icathia": "Icathia",
  },
  ja_jp: {
    "demacia": "デマーシア", "noxus": "ノクサス", "ionia": "アイオニア", "piltover": "ピルトーヴァー",
    "zaun": "ゾウン", "bilgewater": "ビルジウォーター", "bandle-city": "バンドルシティ",
    "freljord": "フレヨルド", "shadow-isles": "シャドウアイル", "shurima": "シュリーマ",
    "targon": "ターゴン", "ixtal": "イシュタル", "void": "ヴォイド", "runeterra": "ルーンテラ",
    "camavor": "カマヴォール", "icathia": "イカシア",
  },
  ko_kr: {
    "demacia": "데마시아", "noxus": "녹서스", "ionia": "아이오니아", "piltover": "필트오버",
    "zaun": "자운", "bilgewater": "빌지워터", "bandle-city": "밴들 시티",
    "freljord": "프렐요드", "shadow-isles": "그림자 군도", "shurima": "슈리마",
    "targon": "타곤", "ixtal": "익스탈", "void": "공허", "runeterra": "룬테라",
    "camavor": "카마보르", "icathia": "이카시아",
  },
  zh_cn: {
    "demacia": "德玛西亚", "noxus": "诺克萨斯", "ionia": "艾欧尼亚", "piltover": "皮尔特沃夫",
    "zaun": "祖安", "bilgewater": "比尔吉沃特", "bandle-city": "班德尔城",
    "freljord": "弗雷尔卓德", "shadow-isles": "暗影岛", "shurima": "恕瑞玛",
    "targon": "塔贡", "ixtal": "伊克斯塔尔", "void": "虚空", "runeterra": "符文之地",
    "camavor": "卡玛弗", "icathia": "伊卡西亚",
  },
};

// locale コード ("ja_jp", "default" 等) から国旗 SVG の URL を返す。
// Unicode の国旗絵文字は Windows (Segoe UI Emoji) では 2文字の地域識別子に
// 化けて幅が揃わないので、flagcdn.com の SVG を固定サイズで使う。
// "default" は LoL クライアントの英語=en_US 相当なので us を返す。
export const LOCALE_CC_OVERRIDES = { default: "us" };
export function localeToCC(code) {
  if (LOCALE_CC_OVERRIDES[code]) return LOCALE_CC_OVERRIDES[code];
  const parts = String(code).split("_");
  const cc = (parts[1] || parts[0] || "").toLowerCase();
  return /^[a-z]{2}$/.test(cc) ? cc : null;
}
export function localeFlagURL(code) {
  const cc = localeToCC(code);
  // 22x16 で表示するので w40 (40px幅 PNG) より SVG のほうが軽くて綺麗
  return cc ? `https://flagcdn.com/${cc}.svg` : "";
}

// 言語ボタンの表示 (国旗) と aria-selected を現在の locale に合わせる
export function setLangButton(code) {
  const img = $("lang-flag");
  const url = localeFlagURL(code);
  if (url) {
    img.src = url;
    img.style.visibility = "";
  } else {
    img.removeAttribute("src");
    img.style.visibility = "hidden";
  }
  const menu = $("lang-menu");
  if (!menu) return;
  menu.querySelectorAll("button[data-code]").forEach(b => {
    b.setAttribute("aria-selected", b.dataset.code === code ? "true" : "false");
  });
}

export function closeLangMenu() {
  const menu = $("lang-menu");
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  $("lang-btn").setAttribute("aria-expanded", "false");
}

// タブの幅をラベルが最も長いものに揃える。locale で「シリーズ」と「Líneas de aspectos」
// くらい差が出るので CSS だけでは等幅にできず、ここで実測 → min-width で同期する。
export function equalizeTabs() {
  const tabs = document.querySelectorAll(".view-tabs .tab");
  if (!tabs.length) return;
  tabs.forEach(el => { el.style.minWidth = "0"; });
  let max = 0;
  tabs.forEach(el => { max = Math.max(max, el.getBoundingClientRect().width); });
  tabs.forEach(el => { el.style.minWidth = max + "px"; });
}

// 静的 DOM 要素 (ボタン/プレースホルダ/aria) を現在の locale に合わせて再適用する。
// 動的レンダリングされる文字列は render() 経由で都度 t() を通すので、ここでは
// init で焼き付いた static element だけを再描画すれば十分。
export function applyStaticUIStrings() {
  document.documentElement.lang = state.locale === "default" ? "en" : state.locale.split("_")[0];
  $("search").placeholder = t("search_placeholder");
  $("lang-btn").setAttribute("aria-label", t("lang_aria"));
  $("tab-home").textContent = t("nav_home");
  $("nav-lines").textContent = t("nav_lines");
  equalizeTabs();
  $("slideshow-btn").textContent = t("nav_slideshow");
  $("select-toggle").textContent = state.selectMode ? t("select_mode_on") : t("select_mode");
  const helpBtn = $("help-btn");
  if (helpBtn) helpBtn.setAttribute("aria-label", t("tut_help_aria"));
  $("back-btn").textContent = t("back");
  const sortSel = $("sort-select");
  if (sortSel) {
    sortSel.setAttribute("aria-label", t("sort_aria"));
    // <option> はラベルだけ差し替え (value は固定キーのまま)。
    // 並び順は data.json の順 → "Default"、A→Z / Z→A は localized name 比較
    const opts = { default: "sort_default", name_asc: "sort_name_asc", name_desc: "sort_name_desc" };
    for (const o of sortSel.options) {
      const k = opts[o.value];
      if (k) o.textContent = t(k);
    }
    sortSel.value = state.sortOrder;
  }
  const lt = $("loading-title");
  const lm = $("loading-msg");
  if (lt) lt.textContent = t("loading_title");
  if (lm) lm.textContent = t("loading_msg");
  $("prog-cancel").textContent = t("progress_cancel");
  $("lightbox").setAttribute("aria-label", t("lb_aria"));
  $("lb-close").setAttribute("aria-label", t("lb_close_aria"));
  $("lb-prev").setAttribute("aria-label", t("lb_prev_aria"));
  $("lb-next").setAttribute("aria-label", t("lb_next_aria"));
  $("ss-pause").textContent = state.lb.paused ? t("ss_resume") : t("ss_pause");
  $("ss-interval").textContent = t("ss_interval", state.lb.interval / 1000);
  if ($("lightbox").classList.contains("open")) {
    $("lb-mode").textContent = state.lb.mode === "slideshow" ? t("mode_slideshow") : t("mode_viewer");
  }
  if (DATA) {
    renderStats(DATA.champion_count, DATA.skin_count);
    const date = new Date(DATA.generated_at_utc);
    $("patch-info").textContent = t("last_updated", date.toISOString().slice(0, 10));
  }
}

// 表示用ヘルパ: 翻訳マップが空 (default) なら data.json の英語名にフォールバック。
// 翻訳が無いキーも英語名で出るので、locale が一部欠損していても UI は壊れない。
export function champName(c) {
  return state.i18n.champions[c.alias] || c.name;
}
export function skinLabel(c, s) {
  // Classic は英語側で `<alias>_Classic` という機械的な label。表示はチャンピオン名で代用する
  if (s.label.endsWith("_Classic")) return champName(c);
  return state.i18n.skins[SELECT_KEY(c.alias, s.label)] || s.label;
}
export function lineName(lid) {
  return state.i18n.lines[String(lid)] || (DATA && DATA.skin_lines || {})[String(lid)] || `Line ${lid}`;
}

// navigator.languages から、CDragon の locale コード (xx_xx) に最も近いものを 1 つ拾う。
// 一致が無ければ "default" (= 英語) を返す
export function pickInitialLocale(available) {
  const saved = lsGet(LS_LOCALE_KEY);
  if (saved && (saved === "default" || available.has(saved))) return saved;
  const langs = navigator.languages || [navigator.language || ""];
  for (const raw of langs) {
    if (!raw) continue;
    const norm = raw.toLowerCase().replace("-", "_");
    if (norm.startsWith("en")) return "default";
    if (available.has(norm)) return norm;
    // ブラウザは "ja" や "zh-Hant-TW" のような形で来ることもあるので、
    // 先頭の言語コード部分だけ取って prefix マッチを試す (zh → zh_cn/zh_tw のどれか)
    const short = norm.split("_")[0];
    for (const av of available) {
      if (av.startsWith(short + "_")) return av;
    }
  }
  return "default";
}

export async function loadLocale(code) {
  if (code === "default") {
    state.locale = "default";
    state.i18n = { champions: {}, skins: {}, lines: {} };
    return;
  }
  try {
    const res = await fetch(`./i18n/${code}.json`, { cache: "force-cache" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const json = await res.json();
    state.locale = code;
    state.i18n = {
      champions: json.champions || {},
      skins: json.skins || {},
      lines: json.lines || {},
    };
  } catch (e) {
    // i18n ファイルが無い/壊れている時は静かに英語にフォールバック。UI は動く
    console.warn(`i18n: ${code} の読み込み失敗、英語にフォールバック`, e);
    state.locale = "default";
    state.i18n = { champions: {}, skins: {}, lines: {} };
  }
}
