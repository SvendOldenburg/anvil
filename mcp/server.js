#!/usr/bin/env node
// Anvil MCP server -- read-only access to Svo's training history so Claude can
// answer "how has my squat been going" without leaving the conversation.
//
// Local stdio server. Adds no VPS service, so it respects the Frankfurt
// migration freeze. Registered with:
//   claude mcp add anvil --scope user -- node "<repo>/mcp/server.js"

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { allRecords, daysAgo, today } from './pb.js';
import {
  LIFT_COLLECTIONS,
  MODALITIES,
  estimate1RM,
  fmtTime,
  fromRower,
  isoWeek,
  matchesExercise,
  normalize,
} from './shape.js';

// --- helpers ---------------------------------------------------------------

const json = (data) => ({
  content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
});

/** Wrap a handler so a PocketBase failure reads as a message, not a stack. */
function safe(fn) {
  return async (args) => {
    try {
      return await fn(args ?? {});
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Anvil: ${err.message}` }],
        isError: true,
      };
    }
  };
}

function windowFrom({ days, since, until }) {
  return {
    since: since ?? daysAgo(days ?? null),
    until: until ?? undefined,
  };
}

/** Every lift entry in the window, newest first. */
async function liftEntries(window) {
  const perCollection = await Promise.all(
    LIFT_COLLECTIONS.map(async (c) => {
      const records = await allRecords(c, window);
      return records.flatMap((r) => normalize(c, r));
    })
  );
  return perCollection.flat().sort((a, b) => b.date.localeCompare(a.date));
}

async function rowerEntries(window) {
  const records = await allRecords('rower_sessions', window);
  return records.map(fromRower);
}

const emptyNote = (what) =>
  `No ${what} logged${''}. Nothing has been recorded in this collection yet.`;

// --- window args, shared by most tools -------------------------------------

const windowArgs = {
  days: z.number().int().positive().optional()
    .describe('Only look back this many days. Omit for all time.'),
  since: z.string().optional().describe('Start date, YYYY-MM-DD. Overrides days.'),
  until: z.string().optional().describe('End date, YYYY-MM-DD.'),
};

const server = new McpServer(
  { name: 'anvil', version: '1.0.0' },
  {
    instructions:
      'Svo\'s training log (the Anvil app). Read-only. Covers StrongLifts 5x5, '
      + 'rowing, kettlebell, barbell, dumbbell and body measurements. '
      + 'For a general "how is my training going" question, call progress_summary.',
  }
);

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };

// --- list_sessions ---------------------------------------------------------

server.registerTool(
  'list_sessions',
  {
    title: 'List training sessions',
    description:
      'Merged, newest-first timeline of every logged session across all modalities '
      + '(strength, kettlebell, barbell, dumbbell, rowing). The general "what have I '
      + 'been doing" tool.',
    inputSchema: {
      ...windowArgs,
      modalities: z.array(z.enum(MODALITIES)).optional()
        .describe('Restrict to these modalities. Omit for all.'),
    },
    annotations: READ_ONLY,
  },
  safe(async (args) => {
    const window = windowFrom(args);
    const want = args.modalities;
    const include = (m) => !want || want.includes(m);

    const lifts = include('strength') || include('kettlebell')
      || include('barbell') || include('dumbbell')
      ? (await liftEntries(window)).filter((e) => include(e.modality))
      : [];
    const rows = include('rowing') ? await rowerEntries(window) : [];

    const timeline = [...lifts, ...rows].sort((a, b) => b.date.localeCompare(a.date));

    return json({
      window: { since: window.since ?? 'all time', until: window.until ?? today() },
      total: timeline.length,
      sessions: timeline,
    });
  })
);

// --- lift_history ----------------------------------------------------------

server.registerTool(
  'lift_history',
  {
    title: 'History for one movement',
    description:
      'Every logged set of one movement over time, newest first, resolved across '
      + 'the strength, barbell, dumbbell and kettlebell collections. Matching is a '
      + 'case-insensitive substring, so "press" finds Bench Press and Overhead Press.',
    inputSchema: {
      exercise: z.string().describe('Movement name or fragment, e.g. "squat".'),
      ...windowArgs,
    },
    annotations: READ_ONLY,
  },
  safe(async ({ exercise, ...rest }) => {
    const window = windowFrom(rest);
    const all = await liftEntries(window);
    const hits = all.filter((e) => matchesExercise(e.exercise, exercise));

    if (hits.length === 0) {
      const names = [...new Set(all.map((e) => e.exercise))].sort();
      return json({
        exercise,
        matches: 0,
        note: `Nothing logged matching "${exercise}".`,
        movements_on_record: names,
      });
    }

    const heaviest = hits.reduce(
      (b, e) => (b && b.top_weight_kg >= e.top_weight_kg ? b : e), null);

    return json({
      exercise,
      matches: hits.length,
      first_logged: hits[hits.length - 1].date,
      last_logged: hits[0].date,
      heaviest: { date: heaviest.date, top_set: heaviest.top_set },
      history: hits,
    });
  })
);

// --- personal_records ------------------------------------------------------

server.registerTool(
  'personal_records',
  {
    title: 'Personal records',
    description:
      'Per movement: heaviest single set, best estimated 1RM (Epley), and best '
      + 'single-session volume, each with the date it happened.',
    inputSchema: {
      exercise: z.string().optional()
        .describe('Restrict to movements matching this fragment. Omit for all.'),
      ...windowArgs,
    },
    annotations: READ_ONLY,
  },
  safe(async ({ exercise, ...rest }) => {
    const entries = (await liftEntries(windowFrom(rest)))
      .filter((e) => matchesExercise(e.exercise, exercise));

    if (entries.length === 0) {
      return json({ records: [], note: emptyNote('lifting') });
    }

    const byExercise = new Map();
    for (const e of entries) {
      if (!byExercise.has(e.exercise)) byExercise.set(e.exercise, []);
      byExercise.get(e.exercise).push(e);
    }

    const records = [...byExercise.entries()].map(([name, list]) => {
      const heaviest = list.reduce((b, e) => (b.top_weight_kg >= e.top_weight_kg ? b : e));
      // Epley takes reps in the TOP SET, not the session total.
      const withRM = list.map((e) => ({
        e,
        rm: estimate1RM(e.top_weight_kg, e.top_reps),
      }));
      const bestRM = withRM.reduce((b, x) => ((b.rm ?? 0) >= (x.rm ?? 0) ? b : x));
      const bestVolume = list.reduce((b, e) => (b.volume_kg >= e.volume_kg ? b : e));
      return {
        exercise: name,
        sessions: list.length,
        heaviest_set: { weight_kg: heaviest.top_weight_kg, set: heaviest.top_set, date: heaviest.date },
        best_estimated_1rm_kg: bestRM.rm,
        best_estimated_1rm_date: bestRM.rm ? bestRM.e.date : null,
        best_session_volume_kg: bestVolume.volume_kg,
        best_session_volume_date: bestVolume.date,
      };
    }).sort((a, b) => b.sessions - a.sessions);

    return json({ records });
  })
);

// --- volume ----------------------------------------------------------------

server.registerTool(
  'volume',
  {
    title: 'Training volume',
    description:
      'Tonnage (sum of reps x kg), set count and rep count, grouped by week, '
      + 'exercise or modality.',
    inputSchema: {
      group_by: z.enum(['week', 'exercise', 'modality']).default('week')
        .describe('How to bucket the totals.'),
      ...windowArgs,
    },
    annotations: READ_ONLY,
  },
  safe(async ({ group_by = 'week', ...rest }) => {
    const entries = await liftEntries(windowFrom(rest));
    if (entries.length === 0) {
      return json({ group_by, groups: [], note: emptyNote('lifting') });
    }

    const key = (e) =>
      group_by === 'week' ? isoWeek(e.date)
        : group_by === 'exercise' ? e.exercise
          : e.modality;

    const buckets = new Map();
    for (const e of entries) {
      const k = key(e);
      const b = buckets.get(k) || { group: k, sessions: 0, sets: 0, reps: 0, volume_kg: 0 };
      b.sessions += 1;
      b.sets += e.sets;
      b.reps += e.reps;
      b.volume_kg += e.volume_kg;
      buckets.set(k, b);
    }

    const groups = [...buckets.values()]
      .map((b) => ({ ...b, volume_kg: Math.round(b.volume_kg * 10) / 10 }))
      .sort((a, b) => (group_by === 'week'
        ? b.group.localeCompare(a.group)
        : b.volume_kg - a.volume_kg));

    return json({
      group_by,
      total_volume_kg: Math.round(groups.reduce((n, g) => n + g.volume_kg, 0) * 10) / 10,
      groups,
    });
  })
);

// --- rowing ----------------------------------------------------------------

server.registerTool(
  'rowing',
  {
    title: 'Rowing sessions',
    description:
      'Per-session distance, duration, split per 500m and stroke rate, plus '
      + 'totals and the best split on record.',
    inputSchema: windowArgs,
    annotations: READ_ONLY,
  },
  safe(async (args) => {
    const rows = await rowerEntries(windowFrom(args));
    if (rows.length === 0) {
      return json({ sessions: [], note: emptyNote('rowing') });
    }

    const withSplit = rows.filter((r) => r.split_s);
    const best = withSplit.length
      ? withSplit.reduce((b, r) => (b.split_s <= r.split_s ? b : r))
      : null;
    const totalM = rows.reduce((n, r) => n + (r.distance_m || 0), 0);
    const totalS = rows.reduce((n, r) => n + (r.duration_s || 0), 0);

    return json({
      total_sessions: rows.length,
      total_distance_m: totalM,
      total_time: fmtTime(totalS),
      best_split_per_500: best ? { split: best.split_per_500, date: best.date } : null,
      sessions: rows,
    });
  })
);

// --- body_trend ------------------------------------------------------------

server.registerTool(
  'body_trend',
  {
    title: 'Bodyweight and measurements',
    description:
      'Bodyweight and tape-measure series (waist, hips, thighs, upper arms) over time.',
    inputSchema: {
      metric: z.enum(['weight', 'measurements', 'all']).default('all'),
      ...windowArgs,
    },
    annotations: READ_ONLY,
  },
  safe(async ({ metric = 'all', ...rest }) => {
    const window = windowFrom(rest);
    const out = {};

    if (metric === 'weight' || metric === 'all') {
      const rows = await allRecords('bodyweight', window);
      out.bodyweight = rows.length === 0
        ? { entries: [], note: emptyNote('bodyweight') }
        : {
          entries: rows.map((r) => ({ date: r.session_date, weight_kg: r.weight_kg })),
          latest: rows[0].weight_kg,
          change_kg: rows.length > 1
            ? Math.round((rows[0].weight_kg - rows[rows.length - 1].weight_kg) * 10) / 10
            : null,
        };
    }

    if (metric === 'measurements' || metric === 'all') {
      const rows = await allRecords('body_measurements', window);
      out.measurements = rows.length === 0
        ? { entries: [], note: emptyNote('body measurements') }
        : {
          entries: rows.map((r) => ({
            date: r.session_date,
            waist_cm: r.waist_cm || null,
            hips_cm: r.hips_cm || null,
            thighs_cm: r.thighs_cm || null,
            upper_arms_cm: r.upper_arms_cm || null,
          })),
        };
    }

    return json(out);
  })
);

// --- consistency -----------------------------------------------------------

server.registerTool(
  'consistency',
  {
    title: 'Training consistency',
    description:
      'Sessions per week by modality, the current streak of consecutive active '
      + 'weeks, the longest gap between sessions, and when each modality was last '
      + 'trained. The "am I actually showing up" tool.',
    inputSchema: windowArgs,
    annotations: READ_ONLY,
  },
  safe(async (args) => {
    const window = windowFrom(args);
    const [lifts, rows] = await Promise.all([
      liftEntries(window),
      rowerEntries(window),
    ]);
    const all = [...lifts, ...rows].sort((a, b) => b.date.localeCompare(a.date));
    if (all.length === 0) {
      return json({ note: emptyNote('training'), window });
    }

    // Distinct training days, newest first.
    const days = [...new Set(all.map((e) => e.date))].sort().reverse();

    let longestGapDays = 0;
    let longestGapBetween = null;
    for (let i = 0; i < days.length - 1; i++) {
      const gap = Math.round(
        (Date.parse(days[i]) - Date.parse(days[i + 1])) / 86400000
      );
      if (gap > longestGapDays) {
        longestGapDays = gap;
        longestGapBetween = [days[i + 1], days[i]];
      }
    }

    const weeks = new Map();
    for (const e of all) {
      const w = isoWeek(e.date);
      weeks.set(w, (weeks.get(w) || 0) + 1);
    }

    const lastByModality = {};
    for (const e of all) {
      if (!lastByModality[e.modality]) lastByModality[e.modality] = e.date;
    }

    const daysSinceLast = Math.round(
      (Date.parse(today()) - Date.parse(days[0])) / 86400000
    );

    return json({
      window: { since: window.since ?? 'all time', until: window.until ?? today() },
      training_days: days.length,
      first_session: days[days.length - 1],
      last_session: days[0],
      days_since_last_session: daysSinceLast,
      active_weeks: weeks.size,
      sessions_per_week: [...weeks.entries()]
        .map(([week, sessions]) => ({ week, sessions }))
        .sort((a, b) => b.week.localeCompare(a.week)),
      longest_gap_days: longestGapDays,
      longest_gap_between: longestGapBetween,
      last_trained: lastByModality,
    });
  })
);

// --- progress_summary ------------------------------------------------------

server.registerTool(
  'progress_summary',
  {
    title: 'Overall progress summary',
    description:
      'One call that bundles consistency, personal records, volume by week, '
      + 'rowing and body trend. Use this for open-ended questions like "how has '
      + 'my training been going" instead of chaining the individual tools.',
    inputSchema: {
      focus: z.enum(['lifting', 'rowing', 'kettlebell', 'body', 'all']).default('all'),
      ...windowArgs,
    },
    annotations: READ_ONLY,
  },
  safe(async ({ focus = 'all', ...rest }) => {
    const window = windowFrom(rest);
    const [lifts, rows, bw, meas] = await Promise.all([
      liftEntries(window),
      rowerEntries(window),
      allRecords('bodyweight', window),
      allRecords('body_measurements', window),
    ]);

    const scoped = focus === 'kettlebell'
      ? lifts.filter((e) => e.modality === 'kettlebell')
      : focus === 'lifting'
        ? lifts.filter((e) => e.modality !== 'kettlebell')
        : lifts;

    const summary = {
      window: { since: window.since ?? 'all time', until: window.until ?? today() },
      focus,
    };

    if (focus !== 'rowing' && focus !== 'body') {
      const days = [...new Set(scoped.map((e) => e.date))];
      const byMovement = new Map();
      for (const e of scoped) {
        const cur = byMovement.get(e.exercise);
        if (!cur || e.top_weight_kg > cur.top_weight_kg) byMovement.set(e.exercise, e);
      }
      summary.lifting = scoped.length === 0
        ? { note: emptyNote('lifting') }
        : {
          entries: scoped.length,
          training_days: days.length,
          total_volume_kg: Math.round(
            scoped.reduce((n, e) => n + e.volume_kg, 0) * 10) / 10,
          last_session: scoped[0].date,
          bests: [...byMovement.values()]
            .map((e) => ({ exercise: e.exercise, top_set: e.top_set, date: e.date }))
            .sort((a, b) => a.exercise.localeCompare(b.exercise)),
        };
    }

    if (focus === 'all' || focus === 'rowing') {
      summary.rowing = rows.length === 0
        ? { note: emptyNote('rowing') }
        : {
          sessions: rows.length,
          total_distance_m: rows.reduce((n, r) => n + (r.distance_m || 0), 0),
          last_session: rows[0].date,
          latest: rows[0],
        };
    }

    if (focus === 'all' || focus === 'body') {
      summary.body = (bw.length === 0 && meas.length === 0)
        ? {
          note: 'No bodyweight or measurement data has ever been logged. '
            + 'The Body view exists in the app but these two collections are empty '
            + '-- do not infer a trend.',
        }
        : {
          bodyweight_entries: bw.length,
          latest_weight_kg: bw.length ? bw[0].weight_kg : null,
          measurement_entries: meas.length,
          latest_measurements: meas.length ? meas[0] : null,
        };
    }

    return json(summary);
  })
);

// --- go --------------------------------------------------------------------

await server.connect(new StdioServerTransport());
