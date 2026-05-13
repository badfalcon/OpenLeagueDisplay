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
# 地域(出身)データは CDragon の lol-game-data には無いので Riot の Universe API を
# 補助的に叩く。CDragon の方針からは少しズレるが、これだけ別ソースで取らないと
# Demacia/Noxus/Ionia 等での横断検索が組めない。
UNIVERSE = "https://universe-meeps.leagueoflegends.com/v1"
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


def _norm_slug(s: str) -> str:
    """champion slug 比較用に lowercase + 英数だけに正規化。

    CDragon の alias は "MonkeyKing" / "AurelionSol" / "KSante" など PascalCase。
    universe-meeps の slug は "wukong" / "aurelionsol" / "ksante" などで、
    片方を正規化 (lowercase + alphanumeric のみ) すれば突き合わせやすい。
    ただし Wukong のように alias と universe slug が別単語のケースがあるので、
    呼び出し側で「alias 正規化」と「name 正規化」両方で当てる。
    """
    return "".join(ch for ch in s.lower() if ch.isalnum())


def _cdragon_to_universe_locale(code: str) -> str:
    """CDragon locale コード → universe-meeps の locale コード。

    CDragon は `default` を英語に使うが universe は `en_us`。他は基本一致。
    universe 側に未対応の locale もある (該当 fetch が 404 になるだけなので
    呼び出し側は失敗時に空辞書扱いにする)。
    """
    return "en_us" if code == "default" else code


def _fetch_universe_factions(locale_universe: str) -> dict[str, str]:
    """{region_slug: localized_name} を universe-meeps から取得。失敗時は空辞書。"""
    region_names: dict[str, str] = {}
    try:
        facs_doc = fetch_json(f"{UNIVERSE}/{locale_universe}/factions/index.json")
    except Exception as e:
        print(f"   [警告] universe factions ({locale_universe}): {e}", flush=True)
        return region_names
    if not isinstance(facs_doc, dict):
        return region_names
    for f in facs_doc.get("factions") or []:
        if not isinstance(f, dict):
            continue
        slug = (f.get("slug") or "").strip().lower()
        name = f.get("name")
        if slug and isinstance(name, str) and name:
            region_names[slug] = name
    return region_names


def fetch_universe_champion_regions(locale_universe: str) -> dict[str, list[str]]:
    """{champ_slug: [region_slug, ...]} を universe-meeps から取得。失敗時は空辞書。

    universe 側の schema にバリアントが観測される (associated-faction-slug 単数 と
    associated-faction-slugs 複数 / factions が dict 配列など) ため複数の
    フィールド名を試す。default (build_manifest) からのみ呼び出す想定で、
    locale 切替時 (build_locale_index) は地域名の翻訳だけ要るので
    _fetch_universe_factions() を直接使う。
    """
    champ_to_regions: dict[str, list[str]] = {}
    try:
        champs_doc = fetch_json(f"{UNIVERSE}/{locale_universe}/champions/index.json")
    except Exception as e:
        print(f"   [警告] universe champions ({locale_universe}): {e}", flush=True)
        return champ_to_regions
    if not isinstance(champs_doc, dict):
        return champ_to_regions
    for c in champs_doc.get("champions") or []:
        if not isinstance(c, dict):
            continue
        slug = (c.get("slug") or "").strip().lower()
        if not slug:
            continue
        regs: list[str] = []
        # 複数地域フィールドの可能性。universe は slug 文字列の配列、
        # または {slug, name} dict の配列、どちらの場合も観測例がある。
        multi = c.get("associated-faction-slugs") or c.get("factions")
        if isinstance(multi, list):
            for x in multi:
                if isinstance(x, str):
                    regs.append(x)
                elif isinstance(x, dict) and x.get("slug"):
                    regs.append(x["slug"])
        if not regs:
            single = c.get("associated-faction-slug")
            if isinstance(single, str) and single:
                regs = [single]
        if regs:
            # dict.fromkeys で挿入順を保ったまま重複を落とす
            champ_to_regions[slug] = list(dict.fromkeys(regs))
    return champ_to_regions


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

    # 地域 (Demacia, Noxus, ...) は CDragon の lol-game-data に無いので universe
    # から取る。失敗してもここでは止めず、地域情報なしで続行する
    print("==> universe-meeps から地域 (faction) 情報を取得...", flush=True)
    universe_default = _cdragon_to_universe_locale("default")
    champ_regions_map = fetch_universe_champion_regions(universe_default)
    region_names = _fetch_universe_factions(universe_default)
    if region_names or champ_regions_map:
        print(f"    {len(region_names)} factions / {len(champ_regions_map)} 体マッピング", flush=True)
    else:
        print("    地域データなし (universe-meeps 取得失敗 or スキーマ不一致)", flush=True)

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
        paths_for_locale: list[tuple[tuple[int, int | None], str]] = []
        for path, skin_obj in _walk_skins_with_index(detail):
            made = collect_skins_from_skin_obj(alias, skin_obj)
            if made:
                skin_entries.extend(made)
                paths_for_locale.append((path, made[0]["label"]))

        if not skin_entries:
            continue

        # 代表画像 (tile -> Classic skin の splash の順で fallback)
        classic = next((s for s in skin_entries if s["label"].endswith("_Classic")), skin_entries[0])
        portrait = classic.get("tile") or classic.get("splash")

        # ロール (Mage/Tank/Support/...) は champion-summary 由来。検索に使う
        roles = [r for r in (ch.get("roles") or []) if isinstance(r, str)]

        # universe-meeps の slug は概ね alias.lower() に一致するが、Wukong/MonkeyKing
        # のように別語のケースがあるので alias と name 両方の正規化で当てに行く
        regions: list[str] = []
        for key in (_norm_slug(alias), _norm_slug(name)):
            if key in champ_regions_map:
                regions = champ_regions_map[key]
                break

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

    # 同様に、実際にチャンピオンに使われた地域だけを top-level に残す
    used_region_slugs: set[str] = set()
    for ch in out_champs:
        for slug in ch.get("regions") or []:
            used_region_slugs.add(slug)
    filtered_regions = {s: region_names[s] for s in used_region_slugs if s in region_names}

    print(
        f"==> 完了: {len(out_champs)} チャンピオン, {total} スキン, "
        f"{len(filtered_lines)} スキンライン, {len(filtered_regions)} 地域",
        flush=True,
    )

    manifest = {
        "generated_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "champion_count": len(out_champs),
        "skin_count": total,
        "skin_lines": filtered_lines,  # {"100": "PROJECT", ...}
        "regions": filtered_regions,   # {"demacia": "Demacia", ...}
        "champions": out_champs,
        # locale 一覧と表示ラベルは data.json に同梱しておく。i18n/<locale>.json は
        # ここに載っている locale だけが切替候補。ブラウザ側はファイルの存在を
        # 仮定して fetch する (404 は静かにフォールバック)。
        "locales": [{"code": "default", "label": LOCALE_LABELS["default"]}] + [
            {"code": code, "label": LOCALE_LABELS.get(code, code)} for code in LOCALES
        ],
    }
    return manifest, align_meta


def build_locale_index(locale: str, align_meta: list[tuple[int, str, list]]) -> dict:
    """1 locale ぶんの { champions, skins, lines } 辞書を作る。

    各 champion JSON を取得して、default パス情報 (align_meta) と同じ index で
    skins[] / questSkinInfo.tiers[] を辿り、locale の name だけ拾う。失敗は静かに
    スキップして可能な範囲で辞書を返す (ブラウザ側は欠損キーを default 名で表示)。
    """
    base = f"{CDRAGON}/latest/plugins/rcp-be-lol-game-data/global/{locale}/v1"
    champs_map: dict[str, str] = {}
    skins_map: dict[str, str] = {}
    lines_map: dict[str, str] = {}
    # 地域名は universe-meeps の locale ファイル経由 (CDragon には無いため)。
    # champion→region のマッピングは default の build_manifest 側で済ませているので
    # locale 側は factions/index.json (= slug→翻訳名) だけ取れば十分。
    regions_map = _fetch_universe_factions(_cdragon_to_universe_locale(locale))

    try:
        lines_map = parse_skinlines(fetch_json(f"{base}/skinlines.json"), string_keys=True)
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
            for (top_idx, q_idx), english_label in paths:
                try:
                    obj = skins_arr[top_idx]
                    if q_idx is not None:
                        obj = (obj.get("questSkinInfo") or {}).get("tiers", [])[q_idx]
                    local_name = obj.get("name") if isinstance(obj, dict) else None
                except (IndexError, AttributeError, TypeError, KeyError):
                    continue
                if local_name and local_name != english_label:
                    # english_label と一致するなら locale でも英語のまま (= 未訳)。
                    # この場合エントリを省略すれば i18n ファイルが小さくなる
                    skins_map[f"{alias}//{english_label}"] = local_name

    if fail:
        print(f"   [警告] {locale}: {fail} 体の champion JSON 取得に失敗", flush=True)
    return {
        "locale": locale,
        "champions": champs_map,
        "skins": skins_map,
        "lines": lines_map,
        "regions": regions_map,
    }


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
        for li, locale in enumerate(target_locales, 1):
            print(f"==> [{li}/{len(target_locales)}] {locale} を生成中...", flush=True)
            try:
                idx = build_locale_index(locale, align_meta)
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
                f"champ {len(idx['champions'])} / skin {len(idx['skins'])} / line {len(idx['lines'])}",
                flush=True,
            )
    return 0


if __name__ == "__main__":
    sys.exit(main())
