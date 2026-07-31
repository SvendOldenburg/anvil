import { api } from '../api.js';
import { KB_EXERCISES } from '../exercises.js';

function today() {
  return new Date().toISOString().slice(0, 10);
}

let setIdx = 1;

export async function renderKettlebell(container) {
  const sessions = await api.kettlebell_sessions.list(15);
  setIdx = 1;

  container.innerHTML = `
    <div class="view">
      <div class="view-title">Kettlebell</div>

      <div class="card">
        <form id="kbForm" autocomplete="off">
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Date</label>
              <input class="form-input" type="date" name="date" value="${today()}">
            </div>
            <div class="form-group">
              <label class="form-label">Exercise</label>
              <select class="form-select form-select-sm" name="exercise">
                ${KB_EXERCISES.map(e => `<option value="${e}">${e}</option>`).join('')}
              </select>
            </div>
          </div>

          <div class="form-label">Sets</div>
          <div id="kbSets" class="set-builder">
            ${makeSetRow(0)}
          </div>
          <button type="button" class="add-set-btn" id="addSetBtn">+ Add set</button>

          <button class="btn btn-primary mt-4" type="submit">Save Session</button>
        </form>
      </div>

      <div class="section-label">Recent sessions</div>
      ${sessions.length === 0
        ? `<div class="empty-state">No kettlebell sessions yet.</div>`
        : `<div class="card mb-0" id="kbHistory">
            ${sessions.map(s => renderSessionRow(s)).join('')}
          </div>`
      }
    </div>
  `;

  wireForm(container);
  wireHistory(container, sessions);
}

function renderSessionRow(s) {
  const setsStr = s.sets.map(st => `${st.weight_kg}kg×${st.reps}`).join(', ');
  return `
    <div class="history-item" data-id="${s.id}">
      <div style="flex:1">
        <div class="history-main">${s.exercise}</div>
        <div class="history-sub">${setsStr}</div>
      </div>
      <div style="display:flex;align-items:center;gap:6px">
        <span class="history-date">${s.date}</span>
        <button class="icon-btn edit-btn" data-id="${s.id}" title="Edit">✏️</button>
        <button class="icon-btn delete-btn" data-id="${s.id}" title="Delete">🗑️</button>
      </div>
    </div>
  `;
}

function renderEditRow(s) {
  const setsHtml = s.sets.map((st, i) => `
    <div class="set-row">
      <span class="set-row-num">Set ${i + 1}</span>
      <input class="form-input" type="number" step="0.5" min="0" placeholder="kg" data-field="weight" value="${st.weight_kg}">
      <input class="form-input" type="number" min="1" placeholder="reps" data-field="reps" value="${st.reps}">
      <button type="button" class="remove-set-btn" title="Remove">&times;</button>
    </div>
  `).join('');

  return `
    <div class="history-item edit-row" data-id="${s.id}" style="flex-direction:column;align-items:stretch">
      <div class="form-group">
        <label class="form-label">Exercise</label>
        <select class="form-select form-select-sm edit-exercise">
          ${KB_EXERCISES.map(e => `<option value="${e}" ${e === s.exercise ? 'selected' : ''}>${e}</option>`).join('')}
        </select>
      </div>
      <div class="form-label">Sets</div>
      <div class="set-builder edit-sets">${setsHtml}</div>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn btn-primary btn-sm save-edit-btn" data-id="${s.id}" style="width:auto;flex:1">Save</button>
        <button class="btn btn-outline btn-sm cancel-edit-btn" style="width:auto;flex:1">Cancel</button>
      </div>
    </div>
  `;
}

function wireHistory(container, sessions) {
  const hist = container.querySelector('#kbHistory');
  if (!hist) return;

  hist.addEventListener('click', async e => {
    const id = e.target.dataset.id;

    if (e.target.classList.contains('delete-btn')) {
      if (!confirm('Delete this session?')) return;
      await api.kettlebell_sessions.delete(id);
      renderKettlebell(container);
      return;
    }

    if (e.target.classList.contains('edit-btn')) {
      const s = sessions.find(x => x.id === id);
      if (!s) return;
      const row = hist.querySelector(`.history-item[data-id="${id}"]`);
      if (row) row.outerHTML = renderEditRow(s);
      return;
    }

    if (e.target.classList.contains('cancel-edit-btn')) {
      const row = e.target.closest('.edit-row');
      const s = sessions.find(x => x.id === row.dataset.id);
      if (s) row.outerHTML = renderSessionRow(s);
      return;
    }

    if (e.target.classList.contains('save-edit-btn')) {
      const row = e.target.closest('.edit-row');
      const rid = e.target.dataset.id;
      const exercise = row.querySelector('.edit-exercise').value;
      const sets = [];
      row.querySelectorAll('.set-row').forEach(r => {
        const w = parseFloat(r.querySelector('[data-field="weight"]')?.value);
        const reps = parseInt(r.querySelector('[data-field="reps"]')?.value, 10);
        if (w > 0 && reps > 0) sets.push({ weight_kg: w, reps });
      });
      if (sets.length === 0) return;
      await api.kettlebell_sessions.update(rid, { exercise, sets });
      renderKettlebell(container);
      return;
    }

    if (e.target.classList.contains('remove-set-btn')) {
      const setRow = e.target.closest('.set-row');
      const builder = setRow?.closest('.edit-sets');
      if (builder && builder.querySelectorAll('.set-row').length > 1) setRow.remove();
    }
  });
}

function wireForm(container) {
  const setsEl = document.getElementById('kbSets');

  setsEl.querySelector('.remove-set-btn').addEventListener('click', e => {
    if (setsEl.querySelectorAll('.set-row').length > 1) e.target.closest('.set-row').remove();
  });

  document.getElementById('addSetBtn').addEventListener('click', () => {
    const div = document.createElement('div');
    div.innerHTML = makeSetRow(setIdx++);
    const el = div.firstElementChild;
    setsEl.appendChild(el);
    el.querySelector('.remove-set-btn').addEventListener('click', ev => {
      if (setsEl.querySelectorAll('.set-row').length > 1) ev.target.closest('.set-row').remove();
    });
  });

  document.getElementById('kbForm').addEventListener('submit', async e => {
    e.preventDefault();
    const form     = e.target;
    const exercise = form.querySelector('[name="exercise"]').value;
    const date     = form.querySelector('[name="date"]').value;
    const sets = [];
    setsEl.querySelectorAll('.set-row').forEach(row => {
      const w = parseFloat(row.querySelector('[data-field="weight"]')?.value);
      const r = parseInt(row.querySelector('[data-field="reps"]')?.value, 10);
      if (w > 0 && r > 0) sets.push({ weight_kg: w, reps: r });
    });
    if (sets.length === 0) return;
    await api.kettlebell_sessions.add({ date, exercise, sets });
    renderKettlebell(container);
  });
}

function makeSetRow(idx) {
  return `
    <div class="set-row">
      <span class="set-row-num">Set ${idx + 1}</span>
      <input class="form-input" type="number" step="0.5" min="0" placeholder="kg" data-field="weight">
      <input class="form-input" type="number" min="1" placeholder="reps" data-field="reps">
      <button type="button" class="remove-set-btn" title="Remove">&times;</button>
    </div>
  `;
}
