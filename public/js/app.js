// @ts-check

import { getAuthStatus, logout, importExerciseTcx, importExerciseJson } from './api.js';
import { syncExercises, assignDefaultShoe } from './sync.js';
import { load as loadDetail } from './services/detailData.js';
import { getAll, putMany, put } from './db.js';
import { renderActivities } from './views/activities.js';
import { renderActivity } from './views/activity.js';
import { renderShoes } from './views/shoes.js';
import { showToast } from './components/toast.js';
import { markOverlaps } from './utils/overlap.js';
import { isRunningSport } from './utils/sports.js';
import { keepSessionAlive } from './session.js';

/** @typedef {import('../../types/domain.ts').Exercise} Exercise */

/**
 * The parts of a Polar data export's `products-devices` file used to name devices.
 * @typedef {object} ProductsDevices
 * @property {{ deviceId?: string, name?: string }[]} [devices]
 * @property {{ deviceId: string, archived?: string }[]} [archivedDevices]
 * @property {{ eventType?: string, modelName?: string, archived?: string }[]} [productRegistrationEvents]
 */

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

// Sync
async function doSync() {
  if (syncBtn.classList.contains('syncing')) return;

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

// Import TCX
importBtn.addEventListener('click', () => importFileInput.click());

importFileInput.addEventListener('change', async () => {
  const files = Array.from(importFileInput.files || []);
  if (files.length === 0) return;

  importBtn.classList.add('syncing');
  try {
    /** @type {Exercise[]} */
    let imported = [];
    let duplicates = 0;

    // Build device ID → name map from products-devices file if present
    /** @type {Record<string, string>} */
    const deviceMap = {};
    for (const file of files) {
      if (file.name.startsWith('products-devices')) {
        try {
          /** @type {ProductsDevices} */
          const pd = JSON.parse(await file.text());
          for (const d of pd.devices || []) {
            if (d.deviceId && d.name) deviceMap[d.deviceId] = d.name;
          }
          // Map archived devices via registration events
          const archived = new Set((pd.archivedDevices || []).map((d) => d.deviceId));
          for (const evt of pd.productRegistrationEvents || []) {
            if (evt.eventType === 'DELETE' && evt.modelName) {
              // Match by timestamp to find deviceId
              const dev = (pd.archivedDevices || []).find((d) => d.archived === evt.archived);
              if (dev) deviceMap[dev.deviceId] = evt.modelName;
            }
          }
        } catch { /* skip */ }
      }
    }

    for (const file of files) {
      let exercise;
      try {
        if (file.name.endsWith('.json')) {
          const json = JSON.parse(await file.text());
          // Skip non-training-session JSON files (activity summaries, HR data, etc.)
          if (!json.exercises?.length) continue;
          exercise = await importExerciseJson(json);
        } else {
          exercise = await importExerciseTcx(await file.text());
        }
        if (exercise._duplicate) {
          duplicates++;
        } else if (isRunningSport(exercise)) {
          // Resolve device name
          if (exercise.device && deviceMap[exercise.device]) {
            exercise.device = deviceMap[exercise.device];
          }
          imported.push(exercise);
        }
      } catch (err) {
        console.error(`Import failed for ${file.name}:`, /** @type {Error} */ (err).message, err);
      }
    }

    // Mark overlap (e.g. Polar Beat + Polar Pacer recording the same run)
    let overlapsMarked = 0;
    if (imported.length > 0) {
      const marked = markOverlaps(imported, await getAll('exercises'));
      imported = marked.imported;
      overlapsMarked = marked.count;
      for (const ex of marked.updatedExisting) {
        await put('exercises', ex);
      }
    }

    if (imported.length > 0) {
      await assignDefaultShoe(imported);

      await putMany('exercises', imported);

      // Cache detail data in background
      prefetchDetails(imported.map((ex) => ex.id));
    }

    // Show result toast
    const parts = [];
    if (imported.length > 0) parts.push(`${imported.length} geïmporteerd`);
    if (duplicates > 0) parts.push(`${duplicates} duplicaat`);
    if (overlapsMarked > 0) parts.push(`${overlapsMarked} overlap gemarkeerd`);

    if (imported.length > 0) {
      showToast(parts.join(', '), 'success');
    } else if (parts.length > 0) {
      showToast(parts.join(', '), 'info');
    } else {
      showToast('Geen hardloopactiviteiten gevonden in de bestanden', 'info');
    }

    await renderActiveTab();
  } catch (err) {
    console.error('Import error:', err);
    showToast('Import mislukt', 'error');
  } finally {
    importBtn.classList.remove('syncing');
    importFileInput.value = '';
  }
});

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

keepSessionAlive();
init();
