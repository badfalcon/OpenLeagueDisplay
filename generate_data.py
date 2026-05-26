#!/usr/bin/env python3
"""
data.json generator
===================
Community Dragon から最新パッチのチャンピオン/スキン情報を取得して
data.json を生成。GitHub Pages から fetch されるマニフェストです。

実行方法:
    python generate_data.py

GitHub Actions から自動実行されますが、ローカルでも手動で実行可能。
"""

from __future__ import annotations

import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

CDRAGON = "https://raw.communitydragon.org"
UA = {"User-Agent": "Mozilla/5.0 (OpenLeagueDisplay-Generator)"}
TIMEOUT = 30
RETRY = 3

# CDragon のスキン rarity 値。kNoRarity は大多数 (= 1350 等) でノイズなので落とす。
# 既知の rarity だけを data.json に書き出し、index.html 側の RARITY_LABELS と
# 1:1 で対応させる (UI 翻訳の無い未知 rarity が混ざらないように)
KNOWN_RARITIES = {"kEpic", "kLegendary", "kMythic", "kUltimate"}

# クライアントが公式に提供している (= CDragon でも参照可能な) LoL ロケール。
# `default` は en_US 相当なので別途出さない (data.json 側がそのまま英語名)。
# 並びはクライアントの言語ピッカーに近い順序で並べてあるが、UI 側は alpha 順で
# 並べ替えるので順序自体に依存はない。
#
# 注: vn_vn (Garena ベトナム) は CDragon に mirror が存在せず
# `/plugins/rcp-be-lol-game-data/global/vn_vn/` 自体が 404 のため除外。
# 含めると 1 locale あたり 172 チャンピオン × retry ぶんの 404 待ちで生成が
# 10 分以上余分にかかる。th_th / id_id は CDragon にちゃんと存在するので含める。
LOCALES = [
    "ja_jp", "ko_kr", "zh_cn", "zh_tw",
    "fr_fr", "de_de", "it_it",
    "es_es", "es_mx", "pt_br",
    "ru_ru", "pl_pl", "tr_tr",
    "cs_cz", "el_gr", "hu_hu", "ro_ro",
    "th_th", "id_id",
]
# 各 locale の表示用ラベル (UI のセレクトで使用)。CDragon キー → "ネイティブ表記"
LOCALE_LABELS = {
    "default": "English",
    "ja_jp": "日本語",
    "ko_kr": "한국어",
    "zh_cn": "简体中文",
    "zh_tw": "繁體中文",
    "fr_fr": "Français",
    "de_de": "Deutsch",
    "it_it": "Italiano",
    "es_es": "Español (EU)",
    "es_mx": "Español (LatAm)",
    "pt_br": "Português",
    "ru_ru": "Русский",
    "pl_pl": "Polski",
    "tr_tr": "Türkçe",
    "cs_cz": "Čeština",
    "el_gr": "Ελληνικά",
    "hu_hu": "Magyar",
    "ro_ro": "Română",
    "th_th": "ภาษาไทย",
    "id_id": "Bahasa Indonesia",
}


def _build_ssl_context() -> ssl.SSLContext:
    """OSのシステム証明書ストアを取り込んだ SSLContext を返す。

    Windows + Python 同梱の CA だけでは MITM プロキシや古い中間CAが絡む
    環境で `CERTIFICATE_VERIFY_FAILED` になることが多いので、Windows では
    `ssl.enum_certificates` でシステムストア (ROOT/CA) を取り込む。
    """
    ctx = ssl.create_default_context()
    if sys.platform == "win32":
        try:
            for store in ("CA", "ROOT"):
                for cert, encoding, _trust in ssl.enum_certificates(store):
                    if encoding == "x509_asn":
                        try:
                            ctx.load_verify_locations(
                                cadata=ssl.DER_cert_to_PEM_cert(cert)
                            )
                        except ssl.SSLError:
                            pass
        except Exception:
            pass
    return ctx


SSL_CTX = _build_ssl_context()
# 最終手段: 環境変数 LOL_INSECURE=1 で SSL 検証を完全無効化
# CDragon は公開データなのでローカル開発では妥協できるが、本番(Actions)では使わない
SSL_INSECURE = os.environ.get("LOL_INSECURE") == "1"

# 同時 HTTP 取得数。CDragon は静的 CDN なので並列に強いが、礼儀として控えめに。
# 過大にすると上流のレートリミットや一時的 5xx を誘発しやすい
FETCH_CONCURRENCY = int(os.environ.get("LOL_CONCURRENCY", "8"))


def fetch_json(url: str) -> dict | list:
    """Retry付きでJSONを取得"""
    global SSL_INSECURE
    last_err = None
    for attempt in range(RETRY):
        try:
            req = urllib.request.Request(url, headers=UA)
            ctx = ssl._create_unverified_context() if SSL_INSECURE else SSL_CTX
            with urllib.request.urlopen(req, timeout=TIMEOUT, context=ctx) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.URLError as e:
            # SSL検証エラーは1度だけ自動でSSL_INSECUREに切り替えて再試行する
            if (
                not SSL_INSECURE
                and "CERTIFICATE_VERIFY_FAILED" in str(e)
            ):
                print(
                    "[警告] SSL 証明書検証に失敗。検証を無効化して続行します"
                    " (LOL_INSECURE=1 と同等)",
                    flush=True,
                )
                SSL_INSECURE = True
                continue  # attemptを消費せず即リトライ
            last_err = e
            if attempt < RETRY - 1:
                time.sleep(1 + attempt)
        except json.JSONDecodeError as e:
            last_err = e
            if attempt < RETRY - 1:
                time.sleep(1 + attempt)
    raise RuntimeError(f"Failed after {RETRY} retries: {url} :: {last_err}")


# 地域 (Demacia / Noxus 等) は本来 Riot の universe-meeps API から取る予定だった
# が、サーバ側の S3 IAM 設定が壊れていて永続的に 403 を返すことが probe で確定
# (probe ログに `arn:aws:iam::185905861734:user/meeps-cdn-akamai-access-user is
# not authori...` の AccessDenied)。CDragon にも champion→region のマッピングは
# 無いため、やむを得ずハードコードで持つ。新チャンピオンが追加された時はここに
# 1 行足す。新地域なら REGION_NAMES と index.html の REGION_LABELS にも追加する。
REGION_NAMES: dict[str, str] = {
    "demacia": "Demacia",
    "noxus": "Noxus",
    "ionia": "Ionia",
    "piltover": "Piltover",
    "zaun": "Zaun",
    "bilgewater": "Bilgewater",
    "bandle-city": "Bandle City",
    "freljord": "Freljord",
    "shadow-isles": "Shadow Isles",
    "shurima": "Shurima",
    "targon": "Mount Targon",
    "ixtal": "Ixtal",
    "void": "Void",
    "runeterra": "Runeterra",  # 無所属/汎用 (Bard, Ryze, Kindred 等)
    "camavor": "Camavor",
    "icathia": "Icathia",
}

# CDragon の alias を lowercase したものをキーにする (例: MonkeyKing → monkeyking)。
# Riot/Fandom Wiki の "primary region" を基準に、複数地域に深く関わるキャラ
# (Lucian/Senna/Viego 等) は両方持たせる。空配列は「未調査」として残してOK
# (regions 軸で検索ヒットしないだけで他は影響なし)。
CHAMPION_REGIONS: dict[str, list[str]] = {
    "aatrox": ["runeterra"],
    "ahri": ["ionia"],
    "akali": ["ionia"],
    "akshan": ["shurima"],
    "alistar": ["runeterra"],
    "ambessa": ["noxus"],
    "amumu": ["shurima"],
    "anivia": ["freljord"],
    "annie": ["noxus"],
    "aphelios": ["targon"],
    "ashe": ["freljord"],
    "aurelionsol": ["targon"],
    "aurora": ["freljord"],
    "azir": ["shurima"],
    "bard": ["runeterra"],
    "belveth": ["void"],
    "blitzcrank": ["zaun"],
    "brand": ["runeterra"],
    "braum": ["freljord"],
    "briar": ["noxus"],
    "caitlyn": ["piltover"],
    "camille": ["piltover"],
    "cassiopeia": ["noxus"],
    "chogath": ["void"],
    "corki": ["bandle-city"],
    "darius": ["noxus"],
    "diana": ["targon"],
    "draven": ["noxus"],
    "drmundo": ["zaun"],
    "ekko": ["zaun"],
    "elise": ["shadow-isles"],
    "evelynn": ["runeterra"],
    "ezreal": ["piltover"],
    "fiddlesticks": ["runeterra"],
    "fiora": ["demacia"],
    "fizz": ["bilgewater"],
    "galio": ["demacia"],
    "gangplank": ["bilgewater"],
    "garen": ["demacia"],
    "gnar": ["freljord"],
    "gragas": ["freljord"],
    "graves": ["bilgewater"],
    "gwen": ["shadow-isles"],
    "hecarim": ["shadow-isles"],
    "heimerdinger": ["piltover", "bandle-city"],
    "hwei": ["ionia"],
    "illaoi": ["bilgewater"],
    "irelia": ["ionia"],
    "ivern": ["ionia"],
    "janna": ["zaun"],
    "jarvaniv": ["demacia"],
    "jax": ["icathia"],
    "jayce": ["piltover"],
    "jhin": ["ionia"],
    "jinx": ["zaun"],
    "kaisa": ["void"],
    "kalista": ["shadow-isles"],
    "karma": ["ionia"],
    "karthus": ["shadow-isles"],
    "kassadin": ["shurima", "void"],
    "katarina": ["noxus"],
    "kayle": ["demacia"],
    "kayn": ["ionia"],
    "kennen": ["ionia"],
    "khazix": ["void"],
    "kindred": ["runeterra"],
    "kled": ["noxus"],
    "kogmaw": ["void"],
    "ksante": ["shurima"],
    "leblanc": ["noxus"],
    "leesin": ["ionia"],
    "leona": ["targon"],
    "lillia": ["ionia"],
    "lissandra": ["freljord"],
    "lucian": ["demacia", "shadow-isles"],
    "lulu": ["bandle-city"],
    "lux": ["demacia"],
    "malphite": ["ixtal"],
    "malzahar": ["shurima", "void"],
    "maokai": ["shadow-isles"],
    "masteryi": ["ionia"],
    "mel": ["noxus", "piltover"],
    "milio": ["ixtal"],
    "missfortune": ["bilgewater"],
    "mordekaiser": ["noxus"],
    "morgana": ["demacia"],
    "naafiri": ["shurima"],
    "nami": ["runeterra"],
    "nasus": ["shurima"],
    "nautilus": ["bilgewater"],
    "neeko": ["ixtal"],
    "nidalee": ["ixtal"],
    "nilah": ["bilgewater"],
    "nocturne": ["runeterra"],
    "nunu": ["freljord"],
    "olaf": ["freljord"],
    "orianna": ["piltover"],
    "ornn": ["freljord"],
    "pantheon": ["targon"],
    "poppy": ["demacia", "bandle-city"],
    "pyke": ["bilgewater"],
    "qiyana": ["ixtal"],
    "quinn": ["demacia"],
    "rakan": ["ionia"],
    "rammus": ["shurima"],
    "reksai": ["void"],
    "rell": ["noxus"],
    "renata": ["zaun"],
    "renekton": ["shurima"],
    "rengar": ["ixtal"],
    "riven": ["noxus"],
    "rumble": ["bandle-city"],
    "ryze": ["runeterra"],
    "samira": ["noxus", "shurima"],
    "sejuani": ["freljord"],
    "senna": ["demacia", "shadow-isles"],
    "seraphine": ["piltover", "zaun"],
    "sett": ["ionia"],
    "shaco": ["runeterra"],
    "shen": ["ionia"],
    "shyvana": ["demacia"],
    "singed": ["zaun"],
    "sion": ["noxus"],
    "sivir": ["shurima"],
    "skarner": ["shurima"],
    "smolder": ["camavor"],
    "sona": ["demacia"],
    "soraka": ["targon"],
    "swain": ["noxus"],
    "sylas": ["demacia"],
    "syndra": ["ionia"],
    "tahmkench": ["runeterra"],
    "taliyah": ["shurima"],
    "talon": ["noxus"],
    "taric": ["targon"],
    "teemo": ["bandle-city"],
    "thresh": ["shadow-isles"],
    "tristana": ["bandle-city"],
    "trundle": ["freljord"],
    "tryndamere": ["freljord"],
    "twistedfate": ["bilgewater"],
    "twitch": ["zaun"],
    "udyr": ["freljord"],
    "urgot": ["zaun", "noxus"],
    "varus": ["ionia"],
    "vayne": ["demacia"],
    "veigar": ["bandle-city"],
    "velkoz": ["void"],
    "vex": ["shadow-isles", "bandle-city"],
    "vi": ["piltover"],
    "viego": ["camavor", "shadow-isles"],
    "viktor": ["zaun"],
    "vladimir": ["noxus", "camavor"],
    "volibear": ["freljord"],
    "warwick": ["zaun"],
    "monkeyking": ["ionia"],  # CDragon alias は MonkeyKing (Wukong)
    "xayah": ["ionia"],
    "xerath": ["shurima"],
    "xinzhao": ["demacia"],
    "yasuo": ["ionia"],
    "yone": ["ionia"],
    "yorick": ["shadow-isles"],
    "yuumi": ["bandle-city"],
    "yunara": ["ionia"],
    "zaahen": ["shurima", "runeterra"],
    "zac": ["zaun"],
    "zed": ["ionia"],
    "zeri": ["zaun"],
    "ziggs": ["bandle-city"],
    "zilean": ["runeterra"],
    "zoe": ["targon"],
    "zyra": ["ixtal"],
}


def parse_skinlines(raw, *, string_keys: bool = False) -> dict:
    """`skinlines.json` の生 JSON を id → name のマップに正規化。

    string_keys=True なら id を str で返す (i18n 用 JSON のキーは文字列で揃える)。
    既知の特殊値: id=0 は CDragon 上で "未分類" を示すので除外する。
    """
    out: dict = {}
    for s in raw or []:
        if not isinstance(s, dict):
            continue
        sid = s.get("id")
        if not sid:
            continue
        sid_int = int(sid)
        if sid_int <= 0:
            continue
        name = s.get("name") or f"Line {sid_int}"
        out[str(sid_int) if string_keys else sid_int] = name
    return out


def cdragon_url(asset_path: str) -> str:
    """`/lol-game-data/assets/...` → CDragon の実URLに変換"""
    p = asset_path.lstrip("/")
    prefix = "lol-game-data/assets/"
    if p.startswith(prefix):
        rest = p[len(prefix):].lower()
        p = f"plugins/rcp-be-lol-game-data/global/default/{rest}"
    elif p.startswith("lol-game-data/"):
        # 観測上ここに来るケースは無いが、CDragon が将来 assets/ 抜きのパスを
        # 返してきても URL を組み立てられるよう防御的に残してある
        rest = p[len("lol-game-data/"):].lower()
        p = f"plugins/rcp-be-lol-game-data/global/default/{rest}"
    return f"{CDRAGON}/latest/{p}"


def collect_skins_from_skin_obj(alias: str, skin_obj: dict) -> list[dict]:
    """1スキン or 1ティアからエントリを作成"""
    skin_name = skin_obj.get("name", "Unknown")
    label = f"{alias}_Classic" if skin_obj.get("isBase") else skin_name

    entry = {"label": label}

    splash = skin_obj.get("uncenteredSplashPath")
    if splash:
        entry["splash"] = cdragon_url(splash)
    loading = skin_obj.get("loadScreenPath")
    if loading:
        entry["loading"] = cdragon_url(loading)
    tile = skin_obj.get("tilePath")
    if tile:
        entry["tile"] = cdragon_url(tile)

    # アニメーションスプラッシュ動画 (.webm)。一部のスキンだけが持つフィールドで、
    # 大半の skin/tier では未定義。ブラウザ側はライトボックスで splash の代わりに
    # 動画を再生する (無いスキンは従来通り静止 splash)。URL 変換規則は画像と同じ。
    video = skin_obj.get("splashVideoPath")
    if video:
        entry["video"] = cdragon_url(video)

    # 所属スキンライン (PROJECT, Star Guardian 等) — まとめDLのキーになる
    lines = skin_obj.get("skinLines") or []
    line_ids = [ln.get("id") for ln in lines if isinstance(ln, dict) and ln.get("id")]
    if line_ids:
        entry["lines"] = line_ids

    # スキン rarity (Legendary, Ultimate, Mythic, ...) — 検索キーワードに使う。
    # CDragon は "kEpic" / "kLegendary" / "kUltimate" / "kMythic" / "kNoRarity" を
    # 返す。UI 側 (index.html の RARITY_LABELS) に翻訳マップを持たせる都合で、
    # 既知集合 KNOWN_RARITIES に絞る。新しい rarity が出たら両側を更新する想定。
    rarity = skin_obj.get("rarity")
    if isinstance(rarity, str) and rarity in KNOWN_RARITIES:
        entry["rarity"] = rarity[1:]

    # スキンの説明文 (ライトボックスでだけ使う lore/flavor text)。
    # 大半の skin/quest tier には null だが、Legendary/Ultimate や questSkinInfo
    # の各ティアには短い説明が入っていることがある。空文字は落とす。
    desc = skin_obj.get("description")
    if isinstance(desc, str) and desc.strip():
        entry["desc"] = desc.strip()

    # 画像URLが1つも無い場合はスキップ
    if "splash" not in entry:
        return []
    return [entry]


def _walk_skins_with_index(detail: dict):
    """champion JSON の skins[] を default 側と同じ順序で巡回するイテレータ。

    locale 間で skins[] と questSkinInfo.tiers[] の並びは一致する (CDragon は
    クライアントデータの同一構造ミラー) 前提。yield する `path` は
    `(top_index, quest_tier_index_or_None)` のタプルで、locale 側 JSON でも
    同じ path で同じ論理スキンに到達できる。
    """
    for ti, skin in enumerate(detail.get("skins", [])):
        yield (ti, None), skin
        quest = skin.get("questSkinInfo")
        if quest:
            for qi, tier in enumerate(quest.get("tiers", [])):
                yield (ti, qi), tier


def build_manifest() -> tuple[dict, list[tuple[int, str, list]]]:
    """data.json 用の manifest と、i18n パスで使う locale-align 用メタ情報を返す。

    第2返り値の各要素は `(cid, alias, [(path, english_label), ...])`。
    `path` は `_walk_skins_with_index` が返すのと同じ `(top_index, quest_index_or_None)`。
    locale 側でも同じ path で同じ論理スキンに到達できるので、英語 label をキーに
    locale 名を引ける辞書を生成できる。
    """
    print("==> CDragon からチャンピオン一覧を取得...", flush=True)
    base = f"{CDRAGON}/latest/plugins/rcp-be-lol-game-data/global/default/v1"
    summary = fetch_json(f"{base}/champion-summary.json")
    # CDragon の champion-summary には Doom Bots 等の PvE NPC が混入している。
    # 観測上、特殊エントリは id >= 1000 (現状 66600 番台) かつ alias が "Ruby_*"
    # で識別できるので両条件で弾く (将来別系統のNPCが増えた時も id 上限で拾う)
    champions = [
        c for c in summary
        if 0 < c.get("id", 0) < 1000
        and not c.get("alias", "").startswith("Ruby_")
    ]
    print(f"    {len(champions)} 体検出", flush=True)

    # スキンライン (PROJECT, K/DA, Star Guardian など) の id→name マッピング
    print("==> スキンライン一覧を取得...", flush=True)
    try:
        skin_lines = parse_skinlines(fetch_json(f"{base}/skinlines.json"))
        print(f"    {len(skin_lines)} 件のスキンライン", flush=True)
    except Exception as e:
        print(f"   [警告] skinlines.json の取得に失敗: {e}", flush=True)
        skin_lines = {}

    # 並列に全 champion JSON を取得。返却順序は champions の元順を保ちたいので
    # 結果を id→detail の dict に入れてから再度元順で組み上げる
    print(f"==> {len(champions)} champion JSON を並列取得 (concurrency={FETCH_CONCURRENCY})...", flush=True)
    details: dict[int, dict] = {}
    done_counter = [0]
    def _fetch_one(ch: dict):
        cid = ch["id"]
        try:
            return cid, fetch_json(f"{base}/champions/{cid}.json")
        except Exception as e:
            alias = ch.get("alias") or str(cid)
            print(f"   {alias}: スキップ ({type(e).__name__})", flush=True)
            return cid, None
        finally:
            done_counter[0] += 1
            if done_counter[0] % 25 == 0 or done_counter[0] == len(champions):
                print(f"   [{done_counter[0]}/{len(champions)}] スキャン進捗", flush=True)

    with ThreadPoolExecutor(max_workers=FETCH_CONCURRENCY) as ex:
        for cid, detail in ex.map(_fetch_one, champions):
            if detail is not None:
                details[cid] = detail

    # 地域は CHAMPION_REGIONS / REGION_NAMES に hardcode (universe-meeps が
    # 永続的に 403 を返すため、外部 fetch なし)
    print(f"==> 地域マッピング (hardcoded): {len(CHAMPION_REGIONS)} 体 / {len(REGION_NAMES)} 地域", flush=True)
    # 新チャンピオン追加時の漏れ検知。CDragon 側の alias が CHAMPION_REGIONS に
    # 無い場合だけ警告 (空リスト扱いで先に進む = regions 軸の検索に出ないだけ)。
    # `unmapped_regions.json` を書き出すので update.yml がそれを読んで @claude
    # 宛て issue を自動起票する (なければ書かない = 後段の hashFiles で no-op)
    unmapped = sorted(
        ch.get("alias", "").lower()
        for ch in champions
        if ch.get("alias") and ch["alias"].lower() not in CHAMPION_REGIONS
    )
    if unmapped:
        print(f"   [警告] CHAMPION_REGIONS 未登録: {unmapped}", flush=True)
        (Path(__file__).parent / "unmapped_regions.json").write_text(
            json.dumps(unmapped), encoding="utf-8"
        )

    out_champs = []
    align_meta: list[tuple[int, str, list]] = []
    for ch in champions:
        cid = ch["id"]
        detail = details.get(cid)
        if detail is None:
            continue
        alias = ch.get("alias") or ch.get("name") or str(cid)
        name = ch.get("name") or alias

        skin_entries: list[dict] = []
        # スキン entry を作りつつ、同じ path 情報を i18n 用に控える。
        # collect_skins_from_skin_obj が画像URL不在で空リストを返した場合は
        # entry にも入らないし path にも残さない (browser 側で参照されない)。
        # 3要素目に英語版 description を持たせて locale 取得時の「未訳=英語と同じ」
        # 判定に使う (英語と同じ説明文を locale ファイルに重複して書かないため)。
        paths_for_locale: list[tuple[tuple[int, int | None], str, str | None]] = []
        for path, skin_obj in _walk_skins_with_index(detail):
            made = collect_skins_from_skin_obj(alias, skin_obj)
            if made:
                skin_entries.extend(made)
                paths_for_locale.append((path, made[0]["label"], made[0].get("desc")))

        if not skin_entries:
            continue

        # 代表画像 (tile -> Classic skin の splash の順で fallback)
        classic = next((s for s in skin_entries if s["label"].endswith("_Classic")), skin_entries[0])
        portrait = classic.get("tile") or classic.get("splash")

        # ロール (Mage/Tank/Support/...) は champion-summary 由来。検索に使う
        roles = [r for r in (ch.get("roles") or []) if isinstance(r, str)]

        regions: list[str] = list(CHAMPION_REGIONS.get(alias.lower(), []))

        entry = {
            "name": name,
            "alias": alias,
            "portrait": portrait,
            "skins": skin_entries,
        }
        if roles:
            entry["roles"] = roles
        if regions:
            entry["regions"] = regions
        out_champs.append(entry)
        align_meta.append((cid, alias, paths_for_locale))

    total = sum(len(c["skins"]) for c in out_champs)

    # 実際に使われた skin line のみを残す (data.json を小さく)
    used_line_ids: set[int] = set()
    for ch in out_champs:
        for sk in ch["skins"]:
            for lid in sk.get("lines", []):
                used_line_ids.add(int(lid))
    filtered_lines = {str(lid): skin_lines[lid] for lid in used_line_ids if lid in skin_lines}

    print(
        f"==> 完了: {len(out_champs)} チャンピオン, {total} スキン, "
        f"{len(filtered_lines)} スキンライン",
        flush=True,
    )

    manifest = {
        "generated_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "champion_count": len(out_champs),
        "skin_count": total,
        "skin_lines": filtered_lines,  # {"100": "PROJECT", ...}
        "champions": out_champs,
        # locale 一覧と表示ラベルは data.json に同梱しておく。i18n/<locale>.json は
        # ここに載っている locale だけが切替候補。ブラウザ側はファイルの存在を
        # 仮定して fetch する (404 は静かにフォールバック)。
        "locales": [{"code": "default", "label": LOCALE_LABELS["default"]}] + [
            {"code": code, "label": LOCALE_LABELS.get(code, code)} for code in LOCALES
        ],
    }
    return manifest, align_meta


def build_locale_index(
    locale: str,
    align_meta: list[tuple[int, str, list]],
    keep_line_ids: set[str] | None = None,
) -> dict:
    """1 locale ぶんの { champions, skins, lines } 辞書を作る。

    各 champion JSON を取得して、default パス情報 (align_meta) と同じ index で
    skins[] / questSkinInfo.tiers[] を辿り、locale の name だけ拾う。失敗は静かに
    スキップして可能な範囲で辞書を返す (ブラウザ側は欠損キーを default 名で表示)。

    `keep_line_ids` が渡された場合、`skinlines.json` のうちその ID 集合に含まれる
    エントリだけを残す。CDragon の locale 別 `skinlines.json` は default より
    多くのライン (どの実在スキンからも参照されていない孤児) を返すことがあり、
    data.json 側の `skin_lines` と件数が食い違う原因になる。
    """
    base = f"{CDRAGON}/latest/plugins/rcp-be-lol-game-data/global/{locale}/v1"
    champs_map: dict[str, str] = {}
    skins_map: dict[str, str] = {}
    # スキンの説明文 (lore/flavor) の翻訳。default ファイル側に存在する説明文と
    # 文字列一致した場合は「未訳」扱いで省略 — ブラウザは data.json 側の英語に
    # 自動フォールバックするので i18n ファイルが小さくなる
    skin_descs_map: dict[str, str] = {}
    lines_map: dict[str, str] = {}
    # 地域名の locale 翻訳は index.html の REGION_LABELS に hardcode してるので
    # i18n ファイルには含めない。index.html 側も state.i18n.regions は参照しない。

    try:
        lines_map = parse_skinlines(fetch_json(f"{base}/skinlines.json"), string_keys=True)
        if keep_line_ids is not None:
            lines_map = {k: v for k, v in lines_map.items() if k in keep_line_ids}
    except Exception as e:
        print(f"   [警告] {locale} skinlines.json 失敗: {e}", flush=True)

    def _fetch_champ(meta):
        cid, alias, paths = meta
        try:
            return cid, alias, paths, fetch_json(f"{base}/champions/{cid}.json")
        except Exception:
            return cid, alias, paths, None

    fail = 0
    with ThreadPoolExecutor(max_workers=FETCH_CONCURRENCY) as ex:
        for cid, alias, paths, d in ex.map(_fetch_champ, align_meta):
            if d is None:
                fail += 1
                continue
            cname = d.get("name")
            if cname:
                champs_map[alias] = cname
            skins_arr = d.get("skins", []) or []
            for (top_idx, q_idx), english_label, english_desc in paths:
                try:
                    obj = skins_arr[top_idx]
                    if q_idx is not None:
                        obj = (obj.get("questSkinInfo") or {}).get("tiers", [])[q_idx]
                except (IndexError, AttributeError, TypeError, KeyError):
                    continue
                if not isinstance(obj, dict):
                    continue
                local_name = obj.get("name")
                if local_name and local_name != english_label:
                    # english_label と一致するなら locale でも英語のまま (= 未訳)。
                    # この場合エントリを省略すれば i18n ファイルが小さくなる
                    skins_map[f"{alias}//{english_label}"] = local_name
                local_desc = obj.get("description")
                if (
                    isinstance(local_desc, str)
                    and local_desc.strip()
                    and local_desc.strip() != (english_desc or "")
                ):
                    skin_descs_map[f"{alias}//{english_label}"] = local_desc.strip()

    if fail:
        print(f"   [警告] {locale}: {fail} 体の champion JSON 取得に失敗", flush=True)
    return {
        "locale": locale,
        "champions": champs_map,
        "skins": skins_map,
        "skin_descriptions": skin_descs_map,
        "lines": lines_map,
    }


def apply_added_dates(manifest: dict, prev_path: Path) -> None:
    """前回の data.json と差分を取り、新規スキンに `added` (初観測日) を付与する。

    「最近追加されたスキン」セクション (ブラウザ側) のためのメタ情報。週次ビルドで
    呼ばれ、前回ファイルに居なかった (alias//label) を「新規」とみなす。

    重要な不変条件:
    - 既に `added` を持つスキンは初観測日をそのまま引き継ぐ (毎週リセットしない)。
    - 前回ファイルが無い / 読めない / 空の時は何も打たない。差分の基準が無い状態で
      全件に日付を打つと、初回ビルド時に全スキンが「新着」扱いになって誤爆するため。
      この設計により、この機能を入れた直後の初回ビルドでは (前回データに `added` が
      無くても) 既存スキンは基準点として無印のまま、以降のビルドで本当に増えた分だけ
      日付が付く。
    日付は manifest の generated_at_utc の日付部分 (UTC, YYYY-MM-DD) を使う。
    """
    today = (manifest.get("generated_at_utc") or "")[:10] or time.strftime(
        "%Y-%m-%d", time.gmtime()
    )
    prev_added: dict[str, str] = {}
    prev_keys: set[str] = set()
    try:
        prev = json.loads(prev_path.read_text(encoding="utf-8"))
        for c in prev.get("champions", []):
            alias = c.get("alias", "")
            for s in c.get("skins", []):
                key = f"{alias}//{s.get('label', '')}"
                prev_keys.add(key)
                if s.get("added"):
                    prev_added[key] = s["added"]
    except (OSError, ValueError):
        pass
    have_baseline = bool(prev_keys)

    new_count = 0
    for c in manifest.get("champions", []):
        alias = c.get("alias", "")
        for s in c.get("skins", []):
            key = f"{alias}//{s.get('label', '')}"
            if key in prev_added:
                s["added"] = prev_added[key]  # 初観測日を維持
            elif have_baseline and key not in prev_keys:
                s["added"] = today  # 前回に居なかった = 新規
                new_count += 1
    if not have_baseline:
        print("==> 前回 data.json が無いため added 付与をスキップ (初回扱い)", flush=True)
    elif new_count:
        print(f"==> 新規スキン {new_count} 件に added={today} を付与", flush=True)
    else:
        print("==> 新規スキンなし (added は据え置き)", flush=True)


def main() -> int:
    out_path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent / "data.json"
    # i18n の出力先は data.json と同じディレクトリの `i18n/` 配下に固定。
    # CLI 引数で data.json のパスを変えた場合も追従するので、custom path 指定時も
    # 同階層に i18n/ ができる
    i18n_dir = out_path.parent / "i18n"
    # locale だけを再生成したいケース (--only-i18n) も用意。default の
    # data.json を変えずに翻訳だけ更新できると CI ジョブ分割しやすい
    only_i18n = "--only-i18n" in sys.argv[1:]
    # locale を絞りたい時用 (例: `--locales ja_jp,ko_kr`)。デバッグ/ローカル試行用
    locales_filter: list[str] | None = None
    for arg in sys.argv[1:]:
        if arg.startswith("--locales="):
            locales_filter = [x.strip() for x in arg.split("=", 1)[1].split(",") if x.strip()]

    try:
        manifest, align_meta = build_manifest()
    except Exception as e:
        print(f"エラー: {e}", file=sys.stderr)
        return 1

    if not only_i18n:
        # 前回ファイルとの差分で「最近追加されたスキン」用の added 日付を付与
        # (書き出し前に prev を読むので、必ず write_text より先に呼ぶ)
        apply_added_dates(manifest, out_path)
        # コンパクトに書き出し (改行はスキン単位)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(
            json.dumps(manifest, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        size_kb = out_path.stat().st_size / 1024
        print(f"==> {out_path} ({size_kb:.1f} KB)")

    # i18n: locale ごとに名前辞書を生成。1 locale が失敗しても他は続行する
    target_locales = LOCALES if locales_filter is None else [l for l in LOCALES if l in locales_filter]
    if target_locales:
        i18n_dir.mkdir(parents=True, exist_ok=True)
        # data.json 側で実際に使われているライン ID 集合。locale 別 skinlines.json
        # にはこれ以外の孤児エントリも混ざるので、ここに無い ID は捨てる
        keep_line_ids = set(manifest.get("skin_lines", {}).keys())
        for li, locale in enumerate(target_locales, 1):
            print(f"==> [{li}/{len(target_locales)}] {locale} を生成中...", flush=True)
            try:
                idx = build_locale_index(locale, align_meta, keep_line_ids=keep_line_ids)
            except Exception as e:
                print(f"   [警告] {locale} 全体失敗: {e}", flush=True)
                continue
            fp = i18n_dir / f"{locale}.json"
            fp.write_text(
                json.dumps(idx, ensure_ascii=False, separators=(",", ":")),
                encoding="utf-8",
            )
            kb = fp.stat().st_size / 1024
            print(
                f"   {fp.name} ({kb:.1f} KB): "
                f"champ {len(idx['champions'])} / skin {len(idx['skins'])} / "
                f"desc {len(idx['skin_descriptions'])} / line {len(idx['lines'])}",
                flush=True,
            )
    return 0


if __name__ == "__main__":
    sys.exit(main())
