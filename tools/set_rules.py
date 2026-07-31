#!/usr/bin/env python3
"""Tighten the Anvil collections to logged-in `users` accounts. Idempotent.

Before this, all seven collections had every rule set to "" -- anyone on the
internet could read AND write Svo's training history. Verified open 2026-07-31:
an unauthenticated GET on strength_sessions returned real records.

The rule mirrors what lumen_* was tightened to on 2026-07-19: match on
collectionName, not `@request.auth.id != ""`. The looser form would let a
meeple_users gift token straight in.

The collections are deliberately NOT prefixed anvil_* -- renaming a PocketBase
collection changes its API path, so it would have to be atomic with a frontend
push. See the README. That is also why COLLECTIONS is an explicit list and not
a prefix glob: a glob over these names would be dangerous.

    python tools/set_rules.py

Run AFTER the phone is on the authenticated build, not before.
"""

from pb import connect

RULE = '@request.auth.collectionName = "users"'
RULE_FIELDS = ("listRule", "viewRule", "createRule", "updateRule", "deleteRule")

COLLECTIONS = [
    "strength_sessions",
    "rower_sessions",
    "kettlebell_sessions",
    "barbell_sessions",
    "dumbbell_sessions",
    "bodyweight",
    "body_measurements",
]


def main():
    pb, _ = connect()
    changed = missing = unchanged = 0

    for name in COLLECTIONS:
        coll = pb.collection(name)
        if coll is None:
            # Never create one. The data is live; a missing name means a typo
            # here or a rename elsewhere, and either way guessing is wrong.
            print(f"  MISSING  {name} -- skipped, not created")
            missing += 1
            continue

        current = {f: coll.get(f) for f in RULE_FIELDS}
        if all(v == RULE for v in current.values()):
            print(f"  ok       {name}")
            unchanged += 1
            continue

        was = ", ".join(
            f"{f[:-4]}={'open' if v == '' else 'superuser-only' if v is None else v}"
            for f, v in current.items() if v != RULE
        )
        pb.req("PATCH", f"/api/collections/{coll['id']}", {f: RULE for f in RULE_FIELDS})
        print(f"  PATCHED  {name}  (was: {was})")
        changed += 1

    print(f"\n{changed} patched, {unchanged} already correct, {missing} missing")
    if missing:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
