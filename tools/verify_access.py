#!/usr/bin/env python3
"""Prove the Anvil lockdown holds. Read-only except for check 2.

    python tools/verify_access.py

The subtle part: PocketBase does NOT return 403 when a list rule is
unsatisfied. It returns 200 with an empty items array. (Verified 2026-07-31
against the already-locked vessel_daily and lumen_messages.) So a script that
only looks for an HTTP error would happily PASS against a wide-open
collection. Check 2 is the one that actually proves anything -- it tries an
anonymous write, which does fail loudly.
"""

import json
import urllib.error
import urllib.parse
import urllib.request

from pb import PB, load_env

COLLECTIONS = [
    "strength_sessions",
    "rower_sessions",
    "kettlebell_sessions",
    "barbell_sessions",
    "dumbbell_sessions",
    "bodyweight",
    "body_measurements",
]

# Live counts recorded 2026-07-31, before the lockdown. Asserted with >= so
# that new training does not fail the test.
MIN_COUNTS = {
    "strength_sessions": 4,
    "rower_sessions": 6,
    "kettlebell_sessions": 14,
    "barbell_sessions": 4,
    "dumbbell_sessions": 3,
    "bodyweight": 0,
    "body_measurements": 0,
}

results = []


def check(label, ok, detail=""):
    results.append(ok)
    print(f"  {'PASS' if ok else 'FAIL'}  {label}{'  -- ' + detail if detail else ''}")


def anon_get(base, coll):
    """Unauthenticated list. Returns (status, totalItems or None)."""
    url = f"{base}/api/collections/{coll}/records?" + urllib.parse.urlencode({"perPage": 1})
    try:
        with urllib.request.urlopen(url) as r:
            return r.status, json.loads(r.read()).get("totalItems")
    except urllib.error.HTTPError as e:
        return e.code, None


def anon_post(base, coll, body):
    """Unauthenticated create. Returns the HTTP status."""
    req = urllib.request.Request(
        f"{base}/api/collections/{coll}/records",
        data=json.dumps(body).encode(), method="POST",
    )
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code


def main():
    env = load_env()
    base = env.get("PB_URL", "https://pb.aetheriumforge.cloud").rstrip("/")

    # --- 1. Anonymous reads return nothing ---------------------------------
    print("\n1. Anonymous read is empty or refused")
    for coll in COLLECTIONS:
        status, total = anon_get(base, coll)
        ok = status >= 400 or total == 0
        check(coll, ok, f"HTTP {status}, totalItems={total}")

    # --- 2. Anonymous write is refused -------------------------------------
    # The check that matters. Check 1 passes trivially on an empty collection.
    print("\n2. Anonymous write is refused (the check that actually proves it)")
    status = anon_post(base, "kettlebell_sessions", {
        "session_date": "1999-01-01",
        "exercise": "__verify_access_probe__",
        "sets": [],
    })
    check("anonymous POST to kettlebell_sessions", status >= 400, f"HTTP {status}")
    if status < 400:
        print("       !! A record was just created. Delete it and re-run set_rules.py.")

    # --- 3. The app's own account can still read ---------------------------
    print("\n3. Authenticated read still works (the app's `users` account)")
    email = env.get("ANVIL_USER_EMAIL")
    pw = env.get("ANVIL_USER_PASSWORD")
    if not email or not pw:
        check("users login", False, "ANVIL_USER_EMAIL / ANVIL_USER_PASSWORD missing in tools/.env")
    else:
        pb = PB(base)
        try:
            out = pb.req("POST", "/api/collections/users/auth-with-password",
                         {"identity": email, "password": pw})
            pb.token = out["token"]
            check("users login", True, email)
        except RuntimeError as e:
            check("users login", False, str(e)[:120])
            pb = None

        if pb and pb.token:
            for coll, minimum in MIN_COUNTS.items():
                try:
                    got = pb.req("GET", f"/api/collections/{coll}/records",
                                 params={"perPage": 1})["totalItems"]
                    check(coll, got >= minimum, f"{got} records (expected >= {minimum})")
                except RuntimeError as e:
                    check(coll, False, str(e)[:120])

            # --- 4. Cross-app isolation --------------------------------
            print("\n4. Cross-app isolation (a users token must not reach Meeple)")
            try:
                got = pb.req("GET", "/api/collections/meeple_games/records",
                             params={"perPage": 1})["totalItems"]
                check("meeple_games invisible to a users token", got == 0, f"totalItems={got}")
            except RuntimeError as e:
                check("meeple_games invisible to a users token", True, "refused")

    failed = results.count(False)
    print(f"\n{'ALL PASS' if not failed else str(failed) + ' FAILED'}  ({len(results)} checks)")
    raise SystemExit(1 if failed else 0)


if __name__ == "__main__":
    main()
