import { WORKOUTS } from '../exercises.js';
import { api, getSetting } from '../api.js';
import { show as showTimer } from '../timer.js';

let session = null;

function today() {
  return new Date().toISOString().slice(0, 10);
}

function saveDraft(s) {
  localStorage.setItem('workout_draft', JSON.stringify(s));
}

function loadDraft() {
  try {
    const raw = localStorage.getItem('workout_draft');
    if (!raw) return null;
    const d = JSON.parse(raw);
    return d.saved ? null : d;
  } catch { return null; }
}

function clearDraft() {
  localStorage.removeItem('workout_draft');
}

function buildSession(type, lastA, lastB) {
  const lastOfType = type === 'A' ? lastA : lastB;

  const exercises = WORKOUTS[type].map(cfg => {
    let weight_kg = cfg.name === 'Deadlift' ? 40 : 20;
    let suggestion = null;

    if (lastOfType) {
      const prev = lastOfType.exercises.find(e => e.name === cfg.name);
      if (prev) {
        const allDone = prev.sets.every(s => s.completed);
        weight_kg  = allDone ? prev.weight_kg + cfg.increment_kg : prev.weight_kg;
        suggestion = allDone ? `+${cfg.increment_kg}kg from last session` : null;
      }
    }

    return {
      name:        cfg.name,
      sets_count:  cfg.sets,
      reps:        cfg.reps,
      increment_kg: cfg.increment_kg,
      weight_kg,
      suggestion,
      sets: Array.from({ length: cfg.sets }, () => ({ completed: false })),
    };
  });

  return { type, date: today(), exercises, saved: false };
}

function render(container, lastA, lastB) {
  const s       = session;
  const allDone = s.exercises.every(ex => ex.sets.every(st => st.completed));

  container.innerHTML = `
    <div class="view">
      <div class="view-title">Workout ${s.type}</div>

      <div class="workout-type-picker">
        <button class="type-btn ${s.type === 'A' ? 'active' : ''}" data-type="A">Workout A</button>
        <button class="type-btn ${s.type === 'B' ? 'active' : ''}" data-type="B">Workout B</button>
      </div>

      ${s.exercises.map((ex, ei) => {
        const exDone = ex.sets.every(st => st.completed);
        return `
          <div class="exercise-card ${exDone ? 'done' : ''}">
            <div class="exercise-header">
              <div class="exercise-name">${ex.name}</div>
              <div class="exercise-weight-wrap">
                <input class="weight-input" type="number" step="0.5" min="0"
                  value="${ex.weight_kg}" data-ei="${ei}">
                <span class="weight-unit">kg</span>
              </div>
            </div>
            ${ex.suggestion
              ? `<div class="progression-hint">↑ ${ex.suggestion}</div>`
              : ''}
            <div class="sets-row">
              ${ex.sets.map((st, si) => `
                <button class="set-btn ${st.completed ? 'completed' : ''}"
                  data-ei="${ei}" data-si="${si}">
                  ${st.completed ? '✓' : si + 1}
                </button>
              `).join('')}
            </div>
            <div class="form-hint" style="margin-top:8px">
              ${ex.sets_count}×${ex.reps} reps
            </div>
          </div>
        `;
      }).join('')}

      ${allDone && !s.saved ? `
        <div class="complete-banner">
          <div class="complete-banner-title">Workout complete</div>
          <div class="complete-banner-sub">Save to lock in your progress</div>
        </div>
      ` : ''}

      ${s.saved
        ? `<button class="btn btn-outline" disabled>Saved</button>`
        : `<button class="btn btn-primary mt-3" id="saveBtn">Save Workout</button>
           <button class="btn btn-outline mt-2" id="resetBtn">Reset</button>`
      }
    </div>
  `;

  container.querySelectorAll('.type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.type === session.type) return;
      if (!confirm('Switch workout type? Current progress will be lost.')) return;
      session = buildSession(btn.dataset.type, lastA, lastB);
      saveDraft(session);
      render(container, lastA, lastB);
    });
  });

  container.querySelectorAll('.weight-input').forEach(input => {
    input.addEventListener('change', () => {
      const ei = Number(input.dataset.ei);
      session.exercises[ei].weight_kg = parseFloat(input.value) || 0;
      session.exercises[ei].suggestion = null;
      saveDraft(session);
    });
  });

  container.querySelectorAll('.set-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ei  = Number(btn.dataset.ei);
      const si  = Number(btn.dataset.si);
      const set = session.exercises[ei].sets[si];

      set.completed = !set.completed;
      saveDraft(session);

      if (set.completed) {
        const duration = await getSetting('rest_duration', 180);
        const ex       = session.exercises[ei];
        const label    = `${ex.name} set ${si + 1} done`;
        showTimer(duration, label);
      }

      render(container, lastA, lastB);
    });
  });

  document.getElementById('saveBtn')?.addEventListener('click', async () => {
    await api.strength_sessions.add({
      date: session.date,
      type: session.type,
      notes: '',
      exercises: session.exercises.map(ex => ({
        name:      ex.name,
        weight_kg: ex.weight_kg,
        sets:      ex.sets,
      })),
    });
    session.saved = true;
    clearDraft();
    render(container, lastA, lastB);
  });

  document.getElementById('resetBtn')?.addEventListener('click', () => {
    if (!confirm('Reset this workout?')) return;
    session = buildSession(session.type, lastA, lastB);
    clearDraft();
    render(container, lastA, lastB);
  });
}

export async function renderWorkout(container) {
  const [lastSession, lastA, lastB] = await Promise.all([
    api.strength_sessions.last(),
    api.strength_sessions.lastOfType('A'),
    api.strength_sessions.lastOfType('B'),
  ]);

  const draft = loadDraft();
  if (draft) {
    session = draft;
  } else {
    const defaultType = lastSession ? (lastSession.type === 'A' ? 'B' : 'A') : 'A';
    session = buildSession(defaultType, lastA, lastB);
  }

  render(container, lastA, lastB);
}
