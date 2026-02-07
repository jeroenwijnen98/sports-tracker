import { getAuthStatus, logout } from './api.js';
import { syncExercises, recalcAllShoeKm } from './sync.js';
import { renderActivities } from './views/activities.js';
import { renderShoes } from './views/shoes.js';
import { showToast } from './components/toast.js';

const authScreen = document.getElementById('auth-screen');
const appScreen = document.getElementById('app-screen');
const syncBtn = document.getElementById('sync-btn');
const logoutBtn = document.getElementById('logout-btn');
const tabBtns = document.querySelectorAll('.tab-btn');

// Check for auth redirect
const params = new URLSearchParams(window.location.search);
if (params.get('auth') === 'success') {
  history.replaceState(null, '', '/');
  // Will be handled after auth check
}
if (params.get('auth') === 'error') {
  history.replaceState(null, '', '/');
  showToast('Authenticatie mislukt. Probeer opnieuw.', 'error');
}

// Init
async function init() {
  const { authenticated } = await getAuthStatus();

  if (authenticated) {
    authScreen.style.display = 'none';
    appScreen.classList.add('active');
    await renderActivities();

    // Auto-sync if just authenticated
    if (params.get('auth') === 'success') {
      await doSync();
    }
  } else {
    authScreen.style.display = '';
    appScreen.classList.remove('active');
  }
}

// Sync
async function doSync() {
  if (syncBtn.classList.contains('syncing')) return;

  syncBtn.classList.add('syncing');
  try {
    const result = await syncExercises();
    await recalcAllShoeKm();

    if (result.newExercises > 0) {
      showToast(`${result.newExercises} nieuwe activiteit(en) gesynchroniseerd`, 'success');
    } else {
      showToast('Alles is up-to-date', 'info');
    }

    // Re-render active tab
    await renderActiveTab();
  } catch (err) {
    console.error('Sync error:', err);
    showToast('Synchronisatie mislukt', 'error');
  } finally {
    syncBtn.classList.remove('syncing');
  }
}

syncBtn.addEventListener('click', doSync);

// Logout
logoutBtn.addEventListener('click', async () => {
  await logout();
  window.location.reload();
});

// Tabs
let activeTab = 'activities';

tabBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    if (tab === activeTab) return;

    activeTab = tab;

    tabBtns.forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.tab-panel').forEach((p) => {
      p.classList.toggle('active', p.id === `tab-${tab}`);
    });

    renderActiveTab();
  });
});

async function renderActiveTab() {
  if (activeTab === 'activities') {
    await renderActivities();
  } else if (activeTab === 'shoes') {
    await renderShoes();
  }
}

init();
