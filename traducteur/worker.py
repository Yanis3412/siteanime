"""Traducteur du site Liste.

Tourne sur le PC qui a la carte graphique NVIDIA. Il récupère les demandes faites sur le site
(traduire en français, coloriser, ou les deux), traite les pages avec manga-image-translator,
puis renvoie les pages traitées au site. Laisse la fenêtre ouverte pour qu'il travaille.

    python worker.py           lance le traducteur
    python worker.py --setup   refait la configuration (site, clé DeepL, connexion admin)
"""

import argparse
import copy
import getpass
import json
import os
import platform
import shutil
import subprocess
import sys
import threading
import time
from collections import deque
from datetime import datetime
from pathlib import Path
from urllib.parse import urljoin

try:
    import requests
    from PIL import Image
except ImportError:
    print("Il manque des modules Python. Lance d'abord installer.bat.")
    sys.exit(1)

HERE = Path(__file__).resolve().parent
CONFIG_FILE = HERE / "config.json"
MIT_DIR = HERE / "mit"
WORK_DIR = HERE / "work"
LOG_FILE = HERE / "traducteur.log"
FONT_FILE = HERE / "fonts" / "ComicNeue-Bold.ttf"
DEFAULT_SITE = "https://liste-blue.vercel.app"
IDLE_SECONDS = 20
HEARTBEAT_SECONDS = 20
WORKER_NAME = platform.node() or "PC"

# Réglages prévus pour une carte de 4 Go (RTX 2050) : détection et effacement du texte en taille réduite.
BASE_CONFIG = {
    "detector": {"detector": "default", "detection_size": 1536},
    "ocr": {"ocr": "48px"},
    "inpainter": {"inpainter": "lama_mpe", "inpainting_size": 1024},
    "render": {"renderer": "manga2eng", "alignment": "center", "direction": "horizontal"},
    "translator": {"translator": "deepl", "target_lang": "FRA"},
    "colorizer": {"colorizer": "none"},
}

KIND_LABELS = {"fr": "traduction", "color": "colorisation", "fr-color": "traduction + couleur"}


def log(message):
    line = f"[{datetime.now():%H:%M:%S}] {message}"
    print(line, flush=True)
    with LOG_FILE.open("a", encoding="utf-8") as f:
        f.write(line + "\n")


class AuthError(Exception):
    pass


class Site:
    def __init__(self, url, token=None):
        self.url = url.rstrip("/")
        self.token = token
        self.http = requests.Session()

    def call(self, method, path, body=None, auth=True, timeout=60):
        headers = {"Authorization": f"Bearer {self.token}"} if auth and self.token else {}
        res = self.http.request(method, f"{self.url}/api/{path}", json=body, headers=headers, timeout=timeout)
        if res.status_code in (401, 403):
            raise AuthError(res.json().get("error", "Connexion refusée"))
        if not res.ok:
            try:
                message = res.json().get("error")
            except ValueError:
                message = None
            raise RuntimeError(message or f"Erreur {res.status_code} du site")
        return res.json()

    def jobs(self, action, **payload):
        return self.call("POST", "jobs", {"action": action, "worker": WORKER_NAME, **payload})


# ---------- Configuration ----------

def load_config():
    if CONFIG_FILE.exists():
        return json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
    return {}


def save_config(config):
    CONFIG_FILE.write_text(json.dumps(config, indent=2), encoding="utf-8")


def check_deepl(key):
    host = "api-free.deepl.com" if key.endswith(":fx") else "api.deepl.com"
    res = requests.get(f"https://{host}/v2/usage", headers={"Authorization": f"DeepL-Auth-Key {key}"}, timeout=20)
    if res.status_code == 403:
        raise ValueError("clé refusée par DeepL")
    res.raise_for_status()
    usage = res.json()
    return usage.get("character_count", 0), usage.get("character_limit", 0)


def login(site):
    profiles = site.call("GET", "profiles", auth=False)["profiles"]
    admin = next((p for p in profiles if p.get("isAdmin")), None)
    if not admin:
        raise SystemExit("Aucun profil administrateur trouvé sur le site.")
    for _ in range(5):
        pin = getpass.getpass(f"Code du profil {admin['name']} (il ne s'affiche pas) : ").strip()
        try:
            data = site.call("POST", "session", {"profileId": admin["id"], "pin": pin}, auth=False)
            return data["token"]
        except (AuthError, RuntimeError) as err:
            print(f"  {err}")
    raise SystemExit("Trop d'essais. Relance le traducteur plus tard.")


def setup(config):
    print("\n=== Configuration du traducteur ===\n")
    url = input(f"Adresse du site [{config.get('site', DEFAULT_SITE)}] : ").strip() or config.get("site", DEFAULT_SITE)
    config["site"] = url.rstrip("/")

    while True:
        current = config.get("deepl_key")
        prompt = "Clé DeepL (Entrée pour garder l'actuelle) : " if current else "Clé DeepL (elle ne s'affiche pas) : "
        key = getpass.getpass(prompt).strip() or current
        if not key:
            print("  La clé est obligatoire pour traduire. Crée-la sur https://www.deepl.com/fr/your-account/keys")
            continue
        try:
            used, limit = check_deepl(key)
            print(f"  Clé DeepL valide : {used:,} caractères utilisés sur {limit:,} ce mois-ci.".replace(",", " "))
            config["deepl_key"] = key
            break
        except Exception as err:  # noqa: BLE001
            print(f"  Clé DeepL invalide ({err}). Réessaie.")

    site = Site(config["site"])
    config["token"] = login(site)
    save_config(config)
    print("\nConfiguration enregistrée.\n")
    return config


# ---------- Traitement d'une demande ----------

def mit_config(kind):
    cfg = copy.deepcopy(BASE_CONFIG)
    if kind in ("color", "fr-color"):
        cfg["colorizer"] = {"colorizer": "mc2", "colorization_size": 576, "denoise_sigma": 30}
    if kind == "color":
        # Colorisation seule : aucune détection ni réécriture du texte.
        cfg["detector"] = {"detector": "none"}
        cfg["translator"] = {"translator": "none"}
        cfg["inpainter"] = {"inpainter": "none"}
        cfg["render"] = {"renderer": "none"}
    return cfg


def download(url, dest):
    for attempt in range(3):
        try:
            res = requests.get(url, timeout=120)
            res.raise_for_status()
            dest.write_bytes(res.content)
            return
        except requests.RequestException:
            if attempt == 2:
                raise
            time.sleep(2 * (attempt + 1))


def upload(url, data):
    for attempt in range(3):
        try:
            res = requests.put(url, data=data, headers={"Content-Type": "image/webp"}, timeout=180)
            res.raise_for_status()
            return
        except requests.RequestException:
            if attempt == 2:
                raise
            time.sleep(2 * (attempt + 1))


def to_webp(path):
    from io import BytesIO

    with Image.open(path) as im:
        im = im.convert("RGB")
        buf = BytesIO()
        im.save(buf, "WEBP", quality=85, method=4)
        return buf.getvalue()


def extension_of(url):
    name = url.split("?")[0].rsplit("/", 1)[-1]
    return name.rsplit(".", 1)[-1].lower() if "." in name else "jpg"


def process(site, config, job):
    try:
        _process(site, config, job)
    finally:
        shutil.rmtree(WORK_DIR / job["id"], ignore_errors=True)


def _process(site, config, job):
    # Les liens sont absolus en production (stockage R2), relatifs en développement local.
    pages = [urljoin(site.url + "/", u) for u in job["pages"]]
    uploads = [urljoin(site.url + "/", u) for u in job["uploads"]]
    total = len(pages)
    label = KIND_LABELS.get(job["kind"], job["kind"])
    log(f"{job['itemTitle']}, chapitre {job['num']} : {label} de {total} pages")

    folder = WORK_DIR / job["id"]
    in_dir, out_dir = folder / "in", folder / "out"
    shutil.rmtree(folder, ignore_errors=True)
    in_dir.mkdir(parents=True)
    out_dir.mkdir(parents=True)

    stems = []
    for i, url in enumerate(pages):
        stem = f"{i + 1:03d}"
        download(url, in_dir / f"{stem}.{extension_of(url)}")
        stems.append(stem)

    cfg_path = folder / "config.json"
    cfg_path.write_text(json.dumps(mit_config(job["kind"])), encoding="utf-8")

    cmd = [sys.executable, "-m", "manga_translator", "-v", "--use-gpu", "--ignore-errors"]
    if FONT_FILE.exists():
        cmd += ["--font-path", str(FONT_FILE)]
    cmd += ["local", "-i", str(in_dir), "-o", str(out_dir), "-f", "png", "--overwrite", "--config-file", str(cfg_path)]

    env = {**os.environ, "DEEPL_AUTH_KEY": config["deepl_key"], "PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1"}
    tail = deque(maxlen=60)
    stop = threading.Event()

    # Pendant le traitement, le site reçoit l'avancement (et sait que le traducteur est toujours là).
    def report():
        while not stop.wait(HEARTBEAT_SECONDS):
            done = len(list(out_dir.glob("*.png")))
            try:
                site.jobs("progress", jobId=job["id"], done=done)
            except Exception:  # noqa: BLE001
                pass

    reporter = threading.Thread(target=report, daemon=True)
    reporter.start()
    try:
        with subprocess.Popen(
            cmd, cwd=MIT_DIR, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace"
        ) as proc:
            with LOG_FILE.open("a", encoding="utf-8") as logf:
                for line in proc.stdout:
                    logf.write(line)
                    tail.append(line.rstrip())
                    if any(word in line for word in ("Error", "error", "Downloading", "Translating", "Saved")):
                        print("   " + line.rstrip()[:160], flush=True)
            code = proc.wait()
    finally:
        stop.set()

    produced = {p.stem: p for p in out_dir.glob("*.png")}
    missing = [s for s in stems if s not in produced]
    if len(missing) == total:
        errors = [l for l in tail if "rror" in l or "xception" in l or "Quota" in l]
        detail = (errors[-1] if errors else (tail[-1] if tail else f"code {code}"))[:250]
        raise RuntimeError(f"Aucune page traitée : {detail}")
    if missing:
        log(f"  {len(missing)} page(s) n'ont pas pu être traitées : elles restent en version originale.")

    site.jobs("progress", jobId=job["id"], done=total)
    originals = {p.stem: p for p in in_dir.iterdir()}
    for stem, url in zip(stems, uploads):
        upload(url, to_webp(produced.get(stem) or originals[stem]))
    site.jobs("complete", jobId=job["id"])
    log(f"  Terminé : {total - len(missing)}/{total} pages.")


# ---------- Boucle principale ----------

def main():
    parser = argparse.ArgumentParser(description="Traducteur du site Liste")
    parser.add_argument("--setup", action="store_true", help="refaire la configuration")
    args = parser.parse_args()

    if not (MIT_DIR / "manga_translator").exists():
        print("manga-image-translator n'est pas installé. Lance d'abord installer.bat.")
        return 1

    config = load_config()
    if args.setup or not config.get("token") or not config.get("deepl_key"):
        config = setup(config)
        if args.setup:
            return 0

    site = Site(config["site"], config["token"])
    print("\n  Traducteur lancé. Laisse cette fenêtre ouverte ; Ctrl+C pour l'arrêter.")
    print("  Le premier chapitre est plus long : les modèles (quelques Go) se téléchargent une seule fois.\n")
    log(f"En attente de demandes sur {config['site']}")

    current = None
    offline_since = None
    while True:
        try:
            job = site.jobs("claim")["job"]
            offline_since = None
            if not job:
                time.sleep(IDLE_SECONDS)
                continue
            current = job
            try:
                process(site, config, job)
            except AuthError:
                raise
            except Exception as err:  # noqa: BLE001
                log(f"  Échec : {err}")
                try:
                    site.jobs("fail", jobId=job["id"], error=str(err)[:300])
                except Exception:  # noqa: BLE001
                    pass
            current = None
        except KeyboardInterrupt:
            if current:
                log("Arrêt demandé : le chapitre en cours est remis en attente.")
                try:
                    site.jobs("release", jobId=current["id"])
                except Exception:  # noqa: BLE001
                    pass
            log("Traducteur arrêté.")
            return 0
        except AuthError:
            log("La session a expiré (code changé ?). Reconnexion nécessaire.")
            config["token"] = login(site)
            site.token = config["token"]
            save_config(config)
            if current:
                try:
                    site.jobs("release", jobId=current["id"])
                except Exception:  # noqa: BLE001
                    pass
                current = None
        except requests.RequestException:
            if not offline_since:
                offline_since = time.time()
                log("Site injoignable (connexion internet ?). Nouvel essai toutes les 30 s.")
            time.sleep(30)


if __name__ == "__main__":
    sys.exit(main())
