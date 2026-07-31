import { login, logout, restoreSession } from './api.js';
import { renderHome }       from './views/home.js';
import { renderWorkout }    from './views/workout.js';
import { renderRower }      from './views/rower.js';
import { renderKettlebell } from './views/kettlebell.js';
import { renderBody }       from './views/body.js';
import { renderBarbell }    from './views/barbell.js';
import { renderDumbbell }   from './views/dumbbell.js';
import { renderHistory }    from './views/history.js';

// --- One-time cleanup of the pre-rename install at /training-tracker/ -------
// Cache Storage is per-ORIGIN, so this reaches the old scope's caches too.
// Scoped narrowly on purpose: Meeple Menagerie lives on this same origin at
// /meeple-menagerie/ and must not be touched.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(regs => {
    regs.forEach(r => { if (r.scope.includes('/training-tracker/')) r.unregister(); });
  }).catch(() => {});
}
if ('caches' in self) {
  caches.keys().then(keys => {
    keys.forEach(k => { if (k.startsWith('train-')) caches.delete(k); });
  }).catch(() => {});
}

// --- Router ----------------------------------------------------------------

const container = document.getElementById('view');

const routes = {
  '#home':        renderHome,
  '#workout':     renderWorkout,
  '#rower':       renderRower,
  '#kettlebell':  renderKettlebell,
  '#body':        renderBody,
  '#barbell':     renderBarbell,
  '#dumbbell':    renderDumbbell,
  '#history':     renderHistory,
};

function navigate() {
  const hash   = location.hash || '#home';
  const render = routes[hash] || renderHome;

  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.hash === hash);
  });

  render(container);
}

// --- Auth gate -------------------------------------------------------------

const authScreen = document.getElementById('auth-screen');
const appEl      = document.getElementById('app');
const loginForm  = document.getElementById('login-form');
const loginBtn   = document.getElementById('login-btn');
const loginError = document.getElementById('login-error');

function showApp() {
  authScreen.classList.add('hidden');
  appEl.classList.remove('hidden');
  window.addEventListener('hashchange', navigate);
  navigate();
}

function showAuth() {
  appEl.classList.add('hidden');
  authScreen.classList.remove('hidden');
  document.getElementById('login-email').focus();
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.classList.add('hidden');
  loginBtn.disabled = true;
  loginBtn.textContent = 'Checking...';
  try {
    await login(
      document.getElementById('login-email').value.trim(),
      document.getElementById('login-password').value
    );
    showApp();
  } catch {
    loginError.textContent = 'Wrong email or password.';
    loginError.classList.remove('hidden');
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = 'Enter';
  }
});

// Sign-out lives on the Home view (there is no topbar to hang it off).
document.addEventListener('click', (e) => {
  if (e.target.closest('#signOut')) {
    logout();
    location.hash = '#home';
    showAuth();
  }
});

// `?preview` bypasses auth for local dev and Playwright, same as Vessel.
const PREVIEW = new URLSearchParams(location.search).has('preview');

(async () => {
  if (PREVIEW || await restoreSession()) showApp();
  else showAuth();
})();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
