#!/usr/bin/env python3
"""
data.json generator
===================
Fetches the latest-patch champion/skin info from Community Dragon and
generates data.json, the manifest fetched by GitHub Pages.

Usage:
    python generate_data.py

Runs automatically from GitHub Actions, but can also be run manually locally.
"""

from __future__ import annotations

import html
import json
import os
import re
import ssl
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

# On Windows's default console encoding (cp932 / cp1252), printing non-ASCII log
# text raises UnicodeEncodeError (surfaces on the CI Windows runner). Pin
# stdout/stderr to UTF-8. Generated files use write_text(encoding="utf-8"), so
# they were never affected.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass

CDRAGON = "https://raw.communitydragon.org"
UA = {"User-Agent": "Mozilla/5.0 (OpenLeagueDisplay-Generator)"}
TIMEOUT = 30
RETRY = 3

# CDragon skin rarity values. kNoRarity is the majority (e.g. 1350) and is noise,
# so drop it. Only write known rarities to data.json, kept 1:1 with RARITY_LABELS
# in js/i18n.js (so no unknown rarity without a UI translation slips in).
KNOWN_RARITIES = {"kEpic", "kLegendary", "kMythic", "kUltimate"}

# LoL locales the client officially provides (= also referenceable on CDragon).
# `default` equals en_US, so it isn't emitted separately (data.json already holds
# the English names). The order roughly follows the client's language picker, but
# the UI re-sorts alphabetically so the order itself doesn't matter.
#
# Note: vn_vn (Garena Vietnam) is excluded because CDragon has no mirror —
# `/plugins/rcp-be-lol-game-data/global/vn_vn/` itself 404s. Including it would
# add 10+ minutes per run waiting on 172 champions x retries of 404s. th_th /
# id_id do exist on CDragon, so they are included.
LOCALES = [
    "ja_jp", "ko_kr", "zh_cn", "zh_tw",
    "fr_fr", "de_de", "it_it",
    "es_es", "es_mx", "pt_br",
    "ru_ru", "pl_pl", "tr_tr",
    "cs_cz", "el_gr", "hu_hu", "ro_ro",
    "th_th", "id_id",
]
# Display label per locale (used in the UI select). CDragon key -> "native name"
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
    """Return an SSLContext that includes the OS system certificate store.

    On Windows, Python's bundled CAs alone often cause
    `CERTIFICATE_VERIFY_FAILED` in environments with a MITM proxy or old
    intermediate CAs, so on Windows we pull in the system store (ROOT/CA) via
    `ssl.enum_certificates`.
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
# Last resort: env var LOL_INSECURE=1 fully disables SSL verification.
# CDragon is public data, so this is an acceptable compromise for local dev,
# but never use it in production (Actions).
SSL_INSECURE = os.environ.get("LOL_INSECURE") == "1"

# Concurrent HTTP fetches. CDragon is a static CDN and handles parallelism well,
# but stay modest out of courtesy. Going too high tends to trigger upstream rate
# limits or transient 5xx.
FETCH_CONCURRENCY = int(os.environ.get("LOL_CONCURRENCY", "8"))


def fetch_json(url: str) -> dict | list:
    """Fetch JSON with retries"""
    global SSL_INSECURE
    last_err = None
    for attempt in range(RETRY):
        try:
            req = urllib.request.Request(url, headers=UA)
            ctx = ssl._create_unverified_context() if SSL_INSECURE else SSL_CTX
            with urllib.request.urlopen(req, timeout=TIMEOUT, context=ctx) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.URLError as e:
            # On an SSL verification error, flip to SSL_INSECURE once and retry
            if (
                not SSL_INSECURE
                and "CERTIFICATE_VERIFY_FAILED" in str(e)
            ):
                print(
                    "[WARN] SSL certificate verification failed. Disabling"
                    " verification and continuing (equivalent to LOL_INSECURE=1)",
                    flush=True,
                )
                SSL_INSECURE = True
                continue  # retry with no wait (this failure still spends one attempt)
            last_err = e
            if attempt < RETRY - 1:
                time.sleep(1 + attempt)
        except json.JSONDecodeError as e:
            last_err = e
            if attempt < RETRY - 1:
                time.sleep(1 + attempt)
    raise RuntimeError(f"Failed after {RETRY} retries: {url} :: {last_err}")


# Regions (Demacia / Noxus, etc.) were originally meant to come from Riot's
# universe-meeps API, but a probe confirmed the server-side S3 IAM config is
# broken and permanently returns 403 (probe log: AccessDenied,
# `arn:aws:iam::185905861734:user/meeps-cdn-akamai-access-user is not authori...`).
# CDragon also has no champion->region mapping, so we hardcode it. When a new
# champion is added, add one line here. For a new region, also add it to
# REGION_NAMES (below) and REGION_LABELS in js/i18n.js.
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
    "runeterra": "Runeterra",  # unaffiliated/generic (Bard, Ryze, Kindred, etc.)
    "camavor": "Camavor",
    "icathia": "Icathia",
}

# Keyed by the CDragon alias lowercased (e.g. MonkeyKing -> monkeyking).
# Based on the "primary region" from the Riot/Fandom Wiki; champions deeply tied
# to multiple regions (Lucian/Senna/Viego, etc.) get both. An empty list is fine
# to leave as "not yet researched" (only the regions search axis misses it,
# nothing else is affected).
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
    "monkeyking": ["ionia"],  # CDragon alias is MonkeyKing (Wukong)
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
    """Normalize the raw `skinlines.json` JSON into an id -> name map.

    With string_keys=True, ids are returned as str (i18n JSON keys are all
    strings). Known special value: id=0 means "uncategorized" on CDragon, so
    it is excluded.
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
    """Convert `/lol-game-data/assets/...` to the real CDragon URL"""
    p = asset_path.lstrip("/")
    prefix = "lol-game-data/assets/"
    if p.startswith(prefix):
        rest = p[len(prefix):].lower()
        p = f"plugins/rcp-be-lol-game-data/global/default/{rest}"
    elif p.startswith("lol-game-data/"):
        # Not observed in practice, but kept defensively so we can still build a
        # URL if CDragon ever returns a path without the assets/ segment
        rest = p[len("lol-game-data/"):].lower()
        p = f"plugins/rcp-be-lol-game-data/global/default/{rest}"
    return f"{CDRAGON}/latest/{p}"


def clean_bio(raw) -> str:
    """Normalize a champion's shortBio for lightbox display.

    shortBio mixes in HTML tags like `<br><br>` or `<i>` and entities like
    `&quot;`. The lightbox renders via textContent, so tags would show up as
    literal text; strip tags, unescape entities, and collapse runs of
    whitespace. Returns "" when empty (absent originally / empty after stripping).
    """
    if not isinstance(raw, str):
        return ""
    # Turn <br> etc. into surrounding whitespace; strip remaining tags outright
    text = re.sub(r"<[^>]+>", " ", raw)
    text = html.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def collect_skins_from_skin_obj(alias: str, skin_obj: dict) -> list[dict]:
    """Build an entry from one skin or one tier"""
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

    # Animated splash video (.webm). A field only some skins carry; undefined for
    # most skins/tiers. The browser plays the video instead of the splash in the
    # lightbox (skins without it keep the static splash). Same URL conversion as images.
    video = skin_obj.get("splashVideoPath")
    if video:
        entry["video"] = cdragon_url(video)

    # Owning skin lines (PROJECT, Star Guardian, etc.) — the key for bulk download
    lines = skin_obj.get("skinLines") or []
    line_ids = [ln.get("id") for ln in lines if isinstance(ln, dict) and ln.get("id")]
    if line_ids:
        entry["lines"] = line_ids

    # Skin rarity (Legendary, Ultimate, Mythic, ...) — used as a search keyword.
    # CDragon returns "kEpic" / "kLegendary" / "kUltimate" / "kMythic" /
    # "kNoRarity". Since the UI carries a translation map (RARITY_LABELS in
    # js/i18n.js), restrict to the known set KNOWN_RARITIES. If a new rarity
    # appears, update both sides.
    rarity = skin_obj.get("rarity")
    if isinstance(rarity, str) and rarity in KNOWN_RARITIES:
        entry["rarity"] = rarity[1:]

    # Skin description (lore/flavor text, used only in the lightbox).
    # null for most skins/quest tiers, but Legendary/Ultimate and each
    # questSkinInfo tier sometimes carry a short description. Drop empty strings.
    desc = skin_obj.get("description")
    if isinstance(desc, str) and desc.strip():
        entry["desc"] = desc.strip()

    # Skip if there is no image URL at all
    if "splash" not in entry:
        return []
    return [entry]


def _walk_skins_with_index(detail: dict):
    """Iterate champion JSON skins[] in the same order as the default side.

    Assumes skins[] and questSkinInfo.tiers[] ordering matches across locales
    (CDragon mirrors client data with identical structure). The yielded `path`
    is a `(top_index, quest_tier_index_or_None)` tuple, so the same path reaches
    the same logical skin in the locale JSON too.
    """
    for ti, skin in enumerate(detail.get("skins", [])):
        yield (ti, None), skin
        quest = skin.get("questSkinInfo")
        if quest:
            for qi, tier in enumerate(quest.get("tiers", [])):
                yield (ti, qi), tier


def build_manifest() -> tuple[dict, list[tuple[int, str, list, str]]]:
    """Return the data.json manifest plus locale-align metadata used for i18n paths.

    Each element of the 2nd return value is
    `(cid, alias, [(path, english_label, english_desc), ...], english_bio)`.
    `path` is the same `(top_index, quest_index_or_None)` `_walk_skins_with_index`
    yields. Since the same path reaches the same logical skin in the locale side,
    we can build a dict keyed by English label to look up the locale name. The
    trailing `english_bio` is carried to detect "untranslated = same as English"
    when fetching the champion bio per locale.
    """
    print("==> Fetching champion list from CDragon...", flush=True)
    base = f"{CDRAGON}/latest/plugins/rcp-be-lol-game-data/global/default/v1"
    summary = fetch_json(f"{base}/champion-summary.json")
    # CDragon's champion-summary mixes in PvE NPCs like Doom Bots. In practice
    # the special entries are identifiable as id >= 1000 (currently the 66600s)
    # AND alias starting with "Ruby_", so reject on both conditions (the id cap
    # still catches future NPC families).
    champions = [
        c for c in summary
        if 0 < c.get("id", 0) < 1000
        and not c.get("alias", "").startswith("Ruby_")
    ]
    print(f"    {len(champions)} champions detected", flush=True)

    # id->name mapping for skin lines (PROJECT, K/DA, Star Guardian, etc.)
    print("==> Fetching skin line list...", flush=True)
    try:
        skin_lines = parse_skinlines(fetch_json(f"{base}/skinlines.json"))
        print(f"    {len(skin_lines)} skin lines", flush=True)
    except Exception as e:
        print(f"   [WARN] failed to fetch skinlines.json: {e}", flush=True)
        skin_lines = {}

    # Fetch all champion JSON in parallel. We want to preserve the original
    # champions order, so collect into an id->detail dict and reassemble in order
    print(f"==> Fetching {len(champions)} champion JSON in parallel (concurrency={FETCH_CONCURRENCY})...", flush=True)
    details: dict[int, dict] = {}
    done_counter = [0]
    def _fetch_one(ch: dict):
        cid = ch["id"]
        try:
            return cid, fetch_json(f"{base}/champions/{cid}.json")
        except Exception as e:
            alias = ch.get("alias") or str(cid)
            print(f"   {alias}: skipped ({type(e).__name__})", flush=True)
            return cid, None
        finally:
            done_counter[0] += 1
            if done_counter[0] % 25 == 0 or done_counter[0] == len(champions):
                print(f"   [{done_counter[0]}/{len(champions)}] scan progress", flush=True)

    with ThreadPoolExecutor(max_workers=FETCH_CONCURRENCY) as ex:
        for cid, detail in ex.map(_fetch_one, champions):
            if detail is not None:
                details[cid] = detail

    # Regions are hardcoded in CHAMPION_REGIONS / REGION_NAMES (no external fetch,
    # since universe-meeps permanently returns 403)
    print(f"==> Region mapping (hardcoded): {len(CHAMPION_REGIONS)} champions / {len(REGION_NAMES)} regions", flush=True)
    # Detect omissions when a new champion is added. Warn only when a CDragon alias
    # is missing from CHAMPION_REGIONS (treated as an empty list and we continue =
    # it just won't show up on the regions search axis). Writes
    # `unmapped_regions.json` so update.yml can read it and auto-open an issue to
    # @claude (nothing written = no-op for the later hashFiles step).
    unmapped = sorted(
        ch.get("alias", "").lower()
        for ch in champions
        if ch.get("alias") and ch["alias"].lower() not in CHAMPION_REGIONS
    )
    if unmapped:
        print(f"   [WARN] not registered in CHAMPION_REGIONS: {unmapped}", flush=True)
        (Path(__file__).parent / "unmapped_regions.json").write_text(
            json.dumps(unmapped), encoding="utf-8"
        )

    out_champs = []
    align_meta: list[tuple[int, str, list, str]] = []
    for ch in champions:
        cid = ch["id"]
        detail = details.get(cid)
        if detail is None:
            continue
        alias = ch.get("alias") or ch.get("name") or str(cid)
        name = ch.get("name") or alias

        skin_entries: list[dict] = []
        # Build skin entries while recording the same path info for i18n. If
        # collect_skins_from_skin_obj returns an empty list (no image URL), it
        # ends up neither in entries nor paths (the browser never references it).
        # The 3rd element carries the English description, used to detect
        # "untranslated = same as English" per locale (so we don't duplicate the
        # English text into locale files).
        paths_for_locale: list[tuple[tuple[int, int | None], str, str | None]] = []
        for path, skin_obj in _walk_skins_with_index(detail):
            made = collect_skins_from_skin_obj(alias, skin_obj)
            if made:
                skin_entries.extend(made)
                paths_for_locale.append((path, made[0]["label"], made[0].get("desc")))

        if not skin_entries:
            continue

        # Representative image (fall back tile -> Classic skin splash)
        classic = next((s for s in skin_entries if s["label"].endswith("_Classic")), skin_entries[0])
        portrait = classic.get("tile") or classic.get("splash")

        # Roles (Mage/Tank/Support/...) come from champion-summary. Used for search
        roles = [r for r in (ch.get("roles") or []) if isinstance(r, str)]

        regions: list[str] = list(CHAMPION_REGIONS.get(alias.lower(), []))

        # Champion bio. Classic/base skins have no skin-specific description, so
        # this serves as the lightbox fallback (omitted if empty).
        bio = clean_bio(detail.get("shortBio"))

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
        if bio:
            entry["bio"] = bio
        out_champs.append(entry)
        # The 4th element carries the English bio, used to detect "untranslated =
        # same as English" when fetching per locale
        align_meta.append((cid, alias, paths_for_locale, bio))

    total = sum(len(c["skins"]) for c in out_champs)

    # Keep only skin lines actually used (to shrink data.json)
    used_line_ids: set[int] = set()
    for ch in out_champs:
        for sk in ch["skins"]:
            for lid in sk.get("lines", []):
                used_line_ids.add(int(lid))
    filtered_lines = {str(lid): skin_lines[lid] for lid in used_line_ids if lid in skin_lines}

    print(
        f"==> Done: {len(out_champs)} champions, {total} skins, "
        f"{len(filtered_lines)} skin lines",
        flush=True,
    )

    manifest = {
        "generated_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "champion_count": len(out_champs),
        "skin_count": total,
        "skin_lines": filtered_lines,  # {"100": "PROJECT", ...}
        "champions": out_champs,
        # Bundle the locale list and display labels into data.json. Only locales
        # listed here are switchable; the browser fetches i18n/<locale>.json
        # assuming the file exists (404s fall back silently).
        "locales": [{"code": "default", "label": LOCALE_LABELS["default"]}] + [
            {"code": code, "label": LOCALE_LABELS.get(code, code)} for code in LOCALES
        ],
    }
    return manifest, align_meta


def build_locale_index(
    locale: str,
    align_meta: list[tuple[int, str, list, str]],
    keep_line_ids: set[str] | None = None,
) -> dict:
    """Build the { champions, skins, lines } dict for one locale.

    Fetch each champion JSON and walk skins[] / questSkinInfo.tiers[] at the same
    index as the default path info (align_meta), picking up only the locale name.
    Failures are skipped silently and a best-effort dict is returned (the browser
    shows missing keys with the default name).

    When `keep_line_ids` is passed, keep only the `skinlines.json` entries in that
    ID set. CDragon's per-locale `skinlines.json` can return more lines than
    default (orphans referenced by no real skin), which causes a count mismatch
    against data.json's `skin_lines`.
    """
    base = f"{CDRAGON}/latest/plugins/rcp-be-lol-game-data/global/{locale}/v1"
    champs_map: dict[str, str] = {}
    skins_map: dict[str, str] = {}
    # Translated skin descriptions (lore/flavor). If a string matches the
    # description in the default file, treat it as "untranslated" and omit it —
    # the browser auto-falls back to the English in data.json, keeping the i18n
    # file smaller
    skin_descs_map: dict[str, str] = {}
    # Translated champion bio (shortBio). Like skin_descs_map, omitted when it
    # matches English. Used as the Classic-skin lightbox fallback when desc is absent
    champion_descs_map: dict[str, str] = {}
    lines_map: dict[str, str] = {}
    # Locale translations of region names are hardcoded in REGION_LABELS in
    # js/i18n.js, so they aren't included in the i18n file (the browser never
    # references state.i18n.regions either).

    try:
        lines_map = parse_skinlines(fetch_json(f"{base}/skinlines.json"), string_keys=True)
        if keep_line_ids is not None:
            lines_map = {k: v for k, v in lines_map.items() if k in keep_line_ids}
    except Exception as e:
        print(f"   [WARN] {locale} skinlines.json failed: {e}", flush=True)

    def _fetch_champ(meta):
        cid, alias, paths, english_bio = meta
        try:
            return cid, alias, paths, english_bio, fetch_json(f"{base}/champions/{cid}.json")
        except Exception:
            return cid, alias, paths, english_bio, None

    fail = 0
    with ThreadPoolExecutor(max_workers=FETCH_CONCURRENCY) as ex:
        for cid, alias, paths, english_bio, d in ex.map(_fetch_champ, align_meta):
            if d is None:
                fail += 1
                continue
            cname = d.get("name")
            if cname:
                champs_map[alias] = cname
            # Translated bio. Include only when it differs from the English bio
            # (untranslated auto-falls back to English)
            local_bio = clean_bio(d.get("shortBio"))
            if local_bio and local_bio != english_bio:
                champion_descs_map[alias] = local_bio
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
                    # Matching english_label means the locale is still English
                    # (= untranslated); omitting the entry shrinks the i18n file
                    skins_map[f"{alias}//{english_label}"] = local_name
                local_desc = obj.get("description")
                if (
                    isinstance(local_desc, str)
                    and local_desc.strip()
                    and local_desc.strip() != (english_desc or "")
                ):
                    skin_descs_map[f"{alias}//{english_label}"] = local_desc.strip()

    if fail:
        print(f"   [WARN] {locale}: failed to fetch {fail} champion JSON", flush=True)
    return {
        "locale": locale,
        "champions": champs_map,
        "skins": skins_map,
        "skin_descriptions": skin_descs_map,
        "champion_descriptions": champion_descs_map,
        "lines": lines_map,
    }


def main() -> int:
    out_path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent / "data.json"
    # i18n output is fixed to an `i18n/` dir alongside data.json. It follows a
    # custom data.json path given via CLI arg, so i18n/ lands in the same dir
    i18n_dir = out_path.parent / "i18n"
    # Support regenerating only the locales (--only-i18n). Being able to refresh
    # translations without touching the default data.json makes CI jobs easy to split
    only_i18n = "--only-i18n" in sys.argv[1:]
    # For narrowing locales (e.g. `--locales ja_jp,ko_kr`). For debugging / local trials
    locales_filter: list[str] | None = None
    for arg in sys.argv[1:]:
        if arg.startswith("--locales="):
            locales_filter = [x.strip() for x in arg.split("=", 1)[1].split(",") if x.strip()]

    try:
        manifest, align_meta = build_manifest()
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1

    if not only_i18n:
        # Write compactly
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(
            json.dumps(manifest, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        size_kb = out_path.stat().st_size / 1024
        print(f"==> {out_path} ({size_kb:.1f} KB)")

    # i18n: generate a name dict per locale. Continue even if one locale fails
    target_locales = LOCALES if locales_filter is None else [l for l in LOCALES if l in locales_filter]
    if target_locales:
        i18n_dir.mkdir(parents=True, exist_ok=True)
        # The set of line IDs actually used in data.json. Per-locale skinlines.json
        # also mixes in orphan entries beyond these, so drop any ID not present here
        keep_line_ids = set(manifest.get("skin_lines", {}).keys())
        for li, locale in enumerate(target_locales, 1):
            print(f"==> [{li}/{len(target_locales)}] generating {locale}...", flush=True)
            try:
                idx = build_locale_index(locale, align_meta, keep_line_ids=keep_line_ids)
            except Exception as e:
                print(f"   [WARN] {locale} failed entirely: {e}", flush=True)
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
