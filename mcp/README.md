# Anvil MCP server

A local MCP server that gives Claude read-only access to the Anvil training
history, so you can ask "how has my squat been going" without leaving the
conversation.

Stdio server, runs on the laptop. It adds no VPS service, so it does not touch
the Frankfurt migration freeze.

## Setup

**1. Install** (once):

```
cd mcp && npm install
```

**2. Credentials.** Create `C:\Users\svend\.claude\anvil-mcp.env`, deliberately
outside every git working tree:

```
PB_URL=https://pb.aetheriumforge.cloud
PB_IDENTITY=svendoldenburg@gmail.com
PB_PASSWORD=<the users-collection password, the one the app logs in with>
```

Use the **`users` account, not the superuser**. Least privilege: it cannot alter
schemas or read `_superusers`, and it is the same credential the app itself
uses, so there is nothing extra to keep in sync.

`ANVIL_MCP_ENV` overrides the path if you need it elsewhere.

**3. Register with Claude Code:**

```
claude mcp add anvil --scope user -- node "C:\Users\svend\Documents\anvil\mcp\server.js"
```

User scope, not project, because you will ask from any directory rather than
only from Kairu. Restart Claude Code, then `/mcp` should list `anvil`.

## Tools

All read-only. There is no write tool.

| Tool | Answers |
|---|---|
| `progress_summary` | "How has my training been going?" One call, bundles the rest. Start here. |
| `list_sessions` | "What have I done lately?" Merged timeline across all modalities. |
| `lift_history` | "How has my squat been going?" One movement over time. |
| `personal_records` | Heaviest set, best estimated 1RM (Epley), best session volume. |
| `volume` | Tonnage, sets and reps by week / exercise / modality. |
| `rowing` | Distance, split per 500m, stroke rate, best split. |
| `body_trend` | Bodyweight and tape measurements. |
| `consistency` | Sessions per week, streaks, longest gap, last trained per modality. |

Every tool takes `days`, `since` and `until` to scope the window.

## Notes for future edits

**Sort by `session_date`, never `created`.** A `created` sort returns 400 on
this PocketBase version. It is hard-coded in `pb.js` so no tool can get it
wrong.

**The collections do not share a record shape**, and volume maths depends on the
difference. `shape.js` exists for exactly this:

- `strength_sessions` stores `exercises: [{name, weight_kg, sets: [{completed}]}]`.
  The sets carry a **completion flag, not reps** — the rep count comes from the
  StrongLifts program (5 per set, including the 1x5 deadlift), not the record.
- `kettlebell_sessions`, `barbell_sessions` and `dumbbell_sessions` store a flat
  `exercise` string plus `sets: [{reps, weight_kg}]`.

**Epley takes reps in the top set**, not the session total. `entry()` exposes
`top_reps` for this; `reps` is the across-all-sets total and would give nonsense.

**Credentials load lazily.** Reading the env file at import time would kill the
process before the MCP handshake, so a missing file would show up in Claude Code
as a bare "failed to connect" rather than a message naming the file.

## If it stops working

- **"Missing anvil-mcp.env"** — the file is gone or moved.
- **"PocketBase auth failed"** — the `users` password changed. Note that
  changing it also logs you out of Vessel and Lumen on every device, since
  PocketBase regenerates the account's `tokenKey`.
- **"PocketBase unreachable ... the VPS may be mid-migration"** — the box is
  down or being rebuilt. The server targets the hostname, so the Frankfurt IP
  change is transparent once DNS cuts over, but during the rebuild window every
  tool errors.

After the Frankfurt move, confirm this file still matches the restored `users`
account. That is the same silent-failure mode that took Lumen's scheduler down
for 11 days.
