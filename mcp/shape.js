// Normalizers for the Anvil collections.
//
// The collections do NOT share a record shape, and getting volume maths right
// depends entirely on the difference:
//
//   strength_sessions   exercises: [{name, weight_kg, sets: [{completed}]}]
//                       -- sets carry a COMPLETION FLAG, not reps. The rep
//                          count comes from the StrongLifts program, not the
//                          record.
//   kettlebell/barbell/
//   dumbbell_sessions   exercise: "<name>", sets: [{reps, weight_kg}]
//                       -- flat, one movement per record, reps stored per set.
//
// Everything here flattens both into the same entry shape.

// Every StrongLifts 5x5 movement is 5 reps per set, including the 1x5
// deadlift (one set, still five reps). Mirrors js/exercises.js.
const STRENGTH_REPS_PER_SET = 5;

const FLAT_COLLECTIONS = {
  kettlebell_sessions: 'kettlebell',
  barbell_sessions: 'barbell',
  dumbbell_sessions: 'dumbbell',
};

/** One normalized movement: what was lifted, how much, how many. */
function entry({ date, modality, exercise, sets, workoutType, id }) {
  const done = sets.filter(s => s.completed !== false);
  const volume = done.reduce((n, s) => n + s.reps * s.weight_kg, 0);
  const heaviest = done.reduce(
    (best, s) => (best && best.weight_kg >= s.weight_kg ? best : s),
    null
  );
  return {
    id,
    date,
    modality,
    exercise,
    workout_type: workoutType,
    sets: done.length,
    reps: done.reduce((n, s) => n + s.reps, 0),
    top_weight_kg: heaviest ? heaviest.weight_kg : null,
    // Reps in the heaviest set specifically. `reps` above is the total across
    // all sets (25 for a 5x5) -- feeding that to Epley gives nonsense.
    top_reps: heaviest ? heaviest.reps : null,
    top_set: heaviest ? `${heaviest.reps} x ${heaviest.weight_kg}kg` : null,
    volume_kg: Math.round(volume * 10) / 10,
  };
}

/** strength_sessions -> one entry per exercise inside the session. */
export function fromStrength(record) {
  const exercises = Array.isArray(record.exercises) ? record.exercises : [];
  return exercises.map(ex =>
    entry({
      id: record.id,
      date: record.session_date,
      modality: 'strength',
      exercise: ex.name,
      workoutType: record.type,
      sets: (ex.sets || []).map(s => ({
        reps: STRENGTH_REPS_PER_SET,
        weight_kg: ex.weight_kg ?? 0,
        completed: s.completed === true,
      })),
    })
  );
}

/** kettlebell / barbell / dumbbell -> one entry per record. */
export function fromFlat(record, modality) {
  return [
    entry({
      id: record.id,
      date: record.session_date,
      modality,
      exercise: record.exercise,
      sets: (record.sets || []).map(s => ({
        reps: s.reps ?? 0,
        weight_kg: s.weight_kg ?? 0,
      })),
    }),
  ];
}

export function normalize(collection, record) {
  if (collection === 'strength_sessions') return fromStrength(record);
  const modality = FLAT_COLLECTIONS[collection];
  if (modality) return fromFlat(record, modality);
  return [];
}

export const LIFT_COLLECTIONS = [
  'strength_sessions',
  ...Object.keys(FLAT_COLLECTIONS),
];

export const MODALITIES = ['strength', 'kettlebell', 'barbell', 'dumbbell', 'rowing'];

/** rower_sessions stay in their own shape -- distance, not load. */
export function fromRower(record) {
  const split = record.split_s || null;
  return {
    id: record.id,
    date: record.session_date,
    modality: 'rowing',
    distance_m: record.distance_m || null,
    duration_s: record.duration_s || null,
    duration: record.duration_s ? fmtTime(record.duration_s) : null,
    split_per_500: split ? fmtTime(split) : null,
    split_s: split,
    stroke_rate: record.stroke_rate || null,
  };
}

export function fmtTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Epley: 1RM = w * (1 + reps/30). Meaningless for a single rep, so pass it through. */
export function estimate1RM(weightKg, reps) {
  if (!weightKg || !reps) return null;
  if (reps === 1) return weightKg;
  return Math.round(weightKg * (1 + reps / 30) * 10) / 10;
}

/** ISO week key (YYYY-Www) for grouping. */
export function isoWeek(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - day + 3); // nearest Thursday
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week =
    1 + Math.round(((d - firstThursday) / 86400000 - 3) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Case-insensitive substring match, so "squat" finds "Goblet Squat". */
export function matchesExercise(name, query) {
  if (!query) return true;
  return String(name || '').toLowerCase().includes(query.toLowerCase());
}
