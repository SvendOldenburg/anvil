"""Minimal PocketBase v0.37 REST client (stdlib only).

Reads config from tools/.env (KEY=VALUE lines). Auths as superuser via the
v0.23+ endpoint (/api/collections/_superusers/auth-with-password) and sends
`Authorization: Bearer <token>` -- see the vps-deploy notes for the 0.37 quirks.
"""

import json
import urllib.parse
import urllib.request
from pathlib import Path

ENV_PATH = Path(__file__).resolve().parent / ".env"


def load_env():
    env = {}
    if not ENV_PATH.exists():
        raise SystemExit(f"Missing {ENV_PATH} -- copy .env.example and fill it in.")
    # utf-8-sig: tolerate the BOM that PowerShell's Out-File/Add-Content write
    for line in ENV_PATH.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        env[k.strip()] = v.strip()
    return env


class PB:
    def __init__(self, base_url):
        self.base = base_url.rstrip("/")
        self.token = None

    def req(self, method, path, body=None, params=None):
        url = self.base + path
        if params:
            url += "?" + urllib.parse.urlencode(params)
        data = json.dumps(body).encode("utf-8") if body is not None else None
        r = urllib.request.Request(url, data=data, method=method)
        r.add_header("Content-Type", "application/json")
        if self.token:
            r.add_header("Authorization", f"Bearer {self.token}")
        try:
            with urllib.request.urlopen(r) as resp:
                raw = resp.read()
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")
            raise RuntimeError(f"{method} {path} -> HTTP {e.code}: {detail}") from None
        if not raw:  # DELETE returns empty body
            return None
        return json.loads(raw)

    def auth_superuser(self, identity, password):
        out = self.req("POST", "/api/collections/_superusers/auth-with-password",
                       {"identity": identity, "password": password})
        self.token = out["token"]
        return out

    # -------- convenience
    def collection(self, name):
        try:
            return self.req("GET", f"/api/collections/{name}")
        except RuntimeError as e:
            if "HTTP 404" in str(e):
                return None
            raise

    def all_records(self, coll, filter_=None):
        items, page = [], 1
        while True:
            params = {"page": page, "perPage": 500}
            if filter_:
                params["filter"] = filter_
            out = self.req("GET", f"/api/collections/{coll}/records", params=params)
            items += out["items"]
            if page >= out["totalPages"]:
                return items
            page += 1

    def first(self, coll, filter_):
        out = self.req("GET", f"/api/collections/{coll}/records",
                       params={"perPage": 1, "filter": filter_})
        return out["items"][0] if out["items"] else None

    def create(self, coll, body):
        return self.req("POST", f"/api/collections/{coll}/records", body)

    def update(self, coll, rec_id, body):
        return self.req("PATCH", f"/api/collections/{coll}/records/{rec_id}", body)


def connect():
    env = load_env()
    pb = PB(env.get("PB_URL", "https://pb.aetheriumforge.cloud"))
    email = env.get("PB_SUPERUSER_EMAIL")
    pw = env.get("PB_SUPERUSER_PASSWORD")
    if not email or not pw:
        raise SystemExit("PB_SUPERUSER_EMAIL / PB_SUPERUSER_PASSWORD missing in tools/.env")
    pb.auth_superuser(email, pw)
    return pb, env


def pb_filter(template, *values):
    """Build a PB filter with double-quoted, escaped values."""
    esc = [v.replace("\\", "\\\\").replace('"', '\\"') for v in values]
    return template.format(*[f'"{v}"' for v in esc])
