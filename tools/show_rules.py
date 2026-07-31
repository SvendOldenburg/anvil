#!/usr/bin/env python3
"""Print the current rules on the Anvil collections. Read-only.

    python tools/show_rules.py

Useful before and after set_rules.py. An empty string "" means wide open to
the internet; None means superuser-only.
"""

from pb import connect
from set_rules import COLLECTIONS, RULE_FIELDS


def show(v):
    if v is None:
        return "<superuser-only>"
    if v == "":
        return "<OPEN TO EVERYONE>"
    return v


def main():
    pb, _ = connect()
    for name in COLLECTIONS:
        coll = pb.collection(name)
        if coll is None:
            print(f"{name}: MISSING")
            continue
        rules = {f: coll.get(f) for f in RULE_FIELDS}
        if len(set(map(str, rules.values()))) == 1:
            print(f"{name:22} all five: {show(next(iter(rules.values())))}")
        else:
            print(f"{name}:")
            for f, v in rules.items():
                print(f"  {f:12} {show(v)}")


if __name__ == "__main__":
    main()
