import { api } from '../api.js';

let ChartJS = null;

async function getChart() {
  if (!ChartJS) {
    const { Chart, registerables } = await import('https://cdn.jsdelivr.net/npm/chart.js@4/+esm');
    Chart.register(...registerables);
    ChartJS = Chart;
  }
  return ChartJS;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

const MEASURES = [
  { key: 'waist_cm',      label: 'Waist',      unit: 'cm' },
  { key: 'hips_cm',       label: 'Hips',       unit: 'cm' },
  { key: 'thighs_cm',     label: 'Thighs',     unit: 'cm' },
  { key: 'upper_arms_cm', label: 'Upper Arms',  unit: 'cm' },
];

export async function renderBody(container) {
  const [allWeight, allMeasure] = await Promise.all([
    api.bodyweight.listAsc(),
    api.body_measurements.listAsc(),
  ]);

  const recentWeight  = [...allWeight].reverse().slice(0, 30);
  const recentMeasure = [...allMeasure].reverse().slice(0, 30);
  const chartWeight   = allWeight.slice(-30);
  const chartMeasure  = allMeasure.slice(-30);

  const lastM = recentMeasure[0];

  container.innerHTML = `
    <div class="view">
      <div class="view-title">Body</div>

      <div class="section-label">Body Weight</div>
      <div class="card">
        <form id="bwForm" autocomplete="off">
          <div class="form-row">
            <div class="form-group mb-0">
              <label class="form-label">Date</label>
              <input class="form-input" type="date" name="date" value="${today()}">
            </div>
            <div class="form-group mb-0">
              <label class="form-label">Weight (kg)</label>
              <input class="form-input" type="number" step="0.1" min="20" max="300"
                name="weight" placeholder="80.0">
            </div>
          </div>
          <button class="btn btn-primary mt-4" type="submit">Log Weight</button>
        </form>
      </div>

      ${chartWeight.length > 1 ? `
        <div class="section-label">Weight trend</div>
        <div class="card">
          <div class="chart-wrap"><canvas id="bwChart"></canvas></div>
        </div>
      ` : ''}

      <div class="section-label">Weight history</div>
      ${recentWeight.length === 0
        ? `<div class="empty-state">No weight logged yet.</div>`
        : `<div class="card mb-0">
            ${recentWeight.map(e => `
              <div class="history-item">
                <div class="history-main mono bold">${e.weight_kg} kg</div>
                <div class="history-date">${e.date}</div>
              </div>
            `).join('')}
          </div>`
      }

      <div class="section-label" style="margin-top:24px">Measurements</div>
      <div class="card">
        <form id="measureForm" autocomplete="off">
          <div class="form-group">
            <label class="form-label">Date</label>
            <input class="form-input" type="date" name="date" value="${today()}">
          </div>
          <div class="form-row">
            ${MEASURES.map(m => `
              <div class="form-group mb-0">
                <label class="form-label">${m.label} (cm)</label>
                <input class="form-input" type="number" step="0.1" min="10" max="200"
                  name="${m.key}" placeholder="--"
                  value="${lastM && lastM[m.key] ? lastM[m.key] : ''}">
              </div>
            `).join('')}
          </div>
          <button class="btn btn-primary mt-4" type="submit">Log Measurements</button>
        </form>
      </div>

      ${chartMeasure.length > 1 ? `
        <div class="section-label">Measurements trend</div>
        <div class="card">
          <div class="chart-tabs" id="measureTabs">
            ${MEASURES.map((m, i) => `
              <button class="chart-tab ${i === 0 ? 'active' : ''}" data-key="${m.key}">${m.label}</button>
            `).join('')}
          </div>
          <div class="chart-wrap"><canvas id="measureChart"></canvas></div>
        </div>
      ` : ''}

      <div class="section-label">Measurement history</div>
      ${recentMeasure.length === 0
        ? `<div class="empty-state">No measurements logged yet.</div>`
        : `<div class="card mb-0">
            ${recentMeasure.map(e => `
              <div class="history-item" style="flex-wrap:wrap;gap:4px">
                <div style="flex:1">
                  ${MEASURES.filter(m => e[m.key]).map(m =>
                    `<span class="measure-chip">${m.label}: <strong>${e[m.key]}</strong> cm</span>`
                  ).join(' ')}
                </div>
                <div class="history-date">${e.date}</div>
              </div>
            `).join('')}
          </div>`
      }
    </div>
  `;

  // Guarded: renderBody awaits its data, so a fast navigate-away can replace
  // the container before we get here. Without ?. that throws on null.
  document.getElementById('bwForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const form   = e.target;
    const date   = form.querySelector('[name="date"]').value;
    const weight = parseFloat(form.querySelector('[name="weight"]').value);
    if (!weight) return;
    const existing = await api.bodyweight.byDate(date);
    if (existing) {
      await api.bodyweight.update(existing.id, { weight_kg: weight });
    } else {
      await api.bodyweight.add({ date, weight_kg: weight });
    }
    renderBody(container);
  });

  document.getElementById('measureForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.target;
    const date = form.querySelector('[name="date"]').value;
    const record = { date };
    MEASURES.forEach(m => {
      const v = parseFloat(form.querySelector(`[name="${m.key}"]`).value);
      if (!isNaN(v) && v > 0) record[m.key] = v;
    });
    if (Object.keys(record).length <= 1) return;
    const existing = await api.body_measurements.byDate(date);
    if (existing) {
      await api.body_measurements.update(existing.id, record);
    } else {
      await api.body_measurements.add(record);
    }
    renderBody(container);
  });

  if (chartWeight.length > 1 || chartMeasure.length > 1) {
    const Chart = await getChart();
    const opts  = chartOptions();

    if (chartWeight.length > 1) {
      const ctx = document.getElementById('bwChart')?.getContext('2d');
      if (ctx) {
        new Chart(ctx, {
          type: 'line',
          data: {
            labels:   chartWeight.map(e => e.date.slice(5)),
            datasets: [{
              data:            chartWeight.map(e => e.weight_kg),
              borderColor:     '#22c55e',
              backgroundColor: 'rgba(34,197,94,0.08)',
              tension:         0.35,
              pointRadius:     3,
              pointBackgroundColor: '#22c55e',
            }],
          },
          options: opts,
        });
      }
    }

    if (chartMeasure.length > 1) {
      let activeKey = MEASURES[0].key;
      let measureChartInst = null;

      function drawMeasureChart(key) {
        const ctx = document.getElementById('measureChart')?.getContext('2d');
        if (!ctx) return;
        if (measureChartInst) measureChartInst.destroy();
        const pts = chartMeasure.filter(e => e[key] != null);
        measureChartInst = new Chart(ctx, {
          type: 'line',
          data: {
            labels:   pts.map(e => e.date.slice(5)),
            datasets: [{
              data:            pts.map(e => e[key]),
              borderColor:     '#f59e0b',
              backgroundColor: 'rgba(245,158,11,0.08)',
              tension:         0.35,
              pointRadius:     3,
              pointBackgroundColor: '#f59e0b',
            }],
          },
          options: opts,
        });
      }

      drawMeasureChart(activeKey);

      document.getElementById('measureTabs')?.addEventListener('click', e => {
        const btn = e.target.closest('.chart-tab');
        if (!btn) return;
        document.querySelectorAll('#measureTabs .chart-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeKey = btn.dataset.key;
        drawMeasureChart(activeKey);
      });
    }
  }
}

function chartOptions() {
  const gridColor = '#272727';
  const tickColor = '#888';
  return {
    responsive:          true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { grid: { color: gridColor }, ticks: { color: tickColor, font: { size: 11 } } },
      y: { grid: { color: gridColor }, ticks: { color: tickColor } },
    },
  };
}
