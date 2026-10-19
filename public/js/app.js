// @ts-check

import { getAuthStatus, logout, importExerciseTcx, importExerciseJson } from './api.js';
import { syncExercises } from './sync.js';
import { ingestAndSave } from './intake.js';
import { importFiles, importToast } from './import.js';
import { load as loadDetail } from './services/detailData.js';
import { renderActivities } from './views/activities.js';
import { renderActivity } from './views/activity.js';
import { renderShoes } from './views/shoes.js';
import { onExerciseDeleted } from './views/runDetail.js';
import { showToast } from './components/toast.js';
import { keepSessionAlive } from './session.js';
import { createBusyGuard } from './utils/busyGuard.js';

const authScreen = /** @type {HTMLElement} */ (document.getElementById('auth-screen'));
const appScreen = /** @type {HTMLElement} */ (document.getElementById('app-screen'));
const syncBtn = /** @type {HTMLElement} */ (document.getElementById('sync-btn'));
const importBtn = /** @type {HTMLElement} */ (document.getElementById('import-btn'));
const importFileInput = /** @type {HTMLInputElement} */ (document.getElementById('import-file-input'));
const logoutBtn = /** @type {HTMLElement} */ (document.getElementById('logout-btn'));
/** @type {NodeListOf<HTMLElement>} */
const tabBtns = document.querySelectorAll('.tab-btn');

// Check for auth redirect
const params = new URLSearchParams(window.location.search);
if (params.has('auth')) {
  history.replaceState(null, '', '/');
  if (params.get('auth') === 'error') {
    showToast('Authenticatie mislukt. Probeer opnieuw.', 'error');
  }
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

/**
 * Load the detail data of each exercise one after another, so opening one
 * later needs no fetch. Errors are ignored; the detail view loads it again.
 *
 * @param {string[]} ids
 */
async function prefetchDetails(ids) {
  for (const id of ids) {
    try {
      await loadDetail(id);
    } catch {
      // ignore
    }
  }
}

// Sync and file import share one busy state, so their intakes never overlap:
// while either runs, both buttons are disabled and the other is refused. The
// `syncing` class only draws the spinner.
const busy = createBusyGuard((isBusy) => {
  for (const btn of [syncBtn, importBtn]) btn.toggleAttribute('disabled', isBusy);
});

// Sync
function doSync() {
  return busy.run(sync);
}

async function sync() {
  syncBtn.classList.add('syncing');
  try {
    const { counts, newIds } = await syncExercises();

    if (counts.newExercises > 0) {
      const parts = [`${counts.newExercises} nieuwe activiteit(en) gesynchroniseerd`];
      if (counts.overlaps > 0) parts.push(`${counts.overlaps} overlap gemarkeerd`);
      showToast(parts.join(', '), 'success');
      // Fire-and-forget: eagerly cache detail data for new exercises
      prefetchDetails(newIds);
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

// Import
importBtn.addEventListener('click', () => {
  if (!busy.busy) importFileInput.click();
});

importFileInput.addEventListener('change', () => {
  const files = Array.from(importFileInput.files || []);
  importFileInput.value = '';
  if (files.length === 0) return;
  busy.run(() => importAll(files)).then(({ ran }) => {
    if (!ran) showToast('Wacht tot de synchronisatie of import klaar is', 'info');
  });
});

/** @param {File[]} files */
async function importAll(files) {
  importBtn.classList.add('syncing');
  try {
    const { counts, duplicates, newIds } = await importFiles(files, {
      importTcx: importExerciseTcx,
      importJson: importExerciseJson,
      ingestAndSave,
    });
    // Fire-and-forget: eagerly cache detail data for new exercises
    prefetchDetails(newIds);

    const { message, type } = importToast(counts, duplicates);
    showToast(message, type);

    await renderActiveTab();
  } catch (err) {
    console.error('Import error:', err);
    showToast('Import mislukt', 'error');
  } finally {
    importBtn.classList.remove('syncing');
  }
}

// Logout
logoutBtn.addEventListener('click', async () => {
  await logout();
  window.location.reload();
});

// Tabs
/** @type {string | undefined} */
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
  } else if (activeTab === 'activity') {
    await renderActivity();
  } else if (activeTab === 'shoes') {
    await renderShoes();
  }
}

onExerciseDeleted(renderActiveTab);

keepSessionAlive();
init();
