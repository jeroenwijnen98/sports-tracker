import { getAuthStatus, logout, importExerciseTcx, importExerciseJson } from './api.js';
import { syncExercises, recalcAllShoeKm } from './sync.js';
import { backgroundFetchDetails, clearUnavailableDetails } from './services/detailData.js';
import { getAll, putMany, put } from './db.js';
import { renderActivities } from './views/activities.js';
import { renderActivity } from './views/activity.js';
import { renderShoes } from './views/shoes.js';
import { showToast } from './components/toast.js';
import { parseISODuration } from './utils/format.js';

const authScreen = document.getElementById('auth-screen');
const appScreen = document.getElementById('app-screen');
const syncBtn = document.getElementById('sync-btn');
const importBtn = document.getElementById('import-btn');
const importFileInput = document.getElementById('import-file-input');
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
    // Clear stuck unavailable detail data so it retries on next open
    clearUnavailableDetails();
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
      // Fire-and-forget: eagerly cache TCX detail data for new exercises
      if (result.newIds?.length > 0) {
        backgroundFetchDetails(result.newIds);
      }
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

importFileInput.addEventListener('change', async (e) => {
  const files = Array.from(e.target.files);
  if (files.length === 0) return;

  importBtn.classList.add('syncing');
  try {
    const RUNNING_SPORTS = ['RUNNING', 'TRAIL_RUNNING', 'TREADMILL_RUNNING'];
    const imported = [];
    let duplicates = 0;

    // Build device ID → name map from products-devices file if present
    const deviceMap = {};
    for (const file of files) {
      if (file.name.startsWith('products-devices')) {
        try {
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
        } else if (RUNNING_SPORTS.includes(exercise['detailed-sport-info'])) {
          // Resolve device name
          if (exercise.device && deviceMap[exercise.device]) {
            exercise.device = deviceMap[exercise.device];
          }
          imported.push(exercise);
        }
      } catch (err) {
        console.error(`Import failed for ${file.name}:`, err.message, err);
      }
    }

    // Mark overlapping sessions (e.g. Polar Beat + Polar Pacer at the same time)
    // The phone app (Beat) gets overlap=true so it's excluded from totals but still visible
    let overlapsMarked = 0;
    if (imported.length > 0) {
      const OVERLAP_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
      const isPhoneApp = (device) => !device || device === 'Polar Beat';

      // Helper to check if two exercises overlap in time
      const overlaps = (a, b) => {
        const aStart = new Date(a['start-time']).getTime();
        const aEnd = aStart + parseISODuration(a.duration) * 1000;
        const bStart = new Date(b['start-time']).getTime();
        const bEnd = bStart + parseISODuration(b.duration) * 1000;
        return Math.abs(aStart - bStart) < OVERLAP_THRESHOLD_MS && aStart < bEnd && bStart < aEnd;
      };

      // 1. Within the import batch: mark phone sessions that overlap with a watch session
      for (const ex of imported) {
        if (!isPhoneApp(ex.device)) continue;
        const hasWatchOverlap = imported.some((other) =>
          other !== ex && !isPhoneApp(other.device) && overlaps(ex, other)
        );
        if (hasWatchOverlap) {
          ex.overlap = true;
          overlapsMarked++;
        }
      }

      // 2. Cross-check against existing exercises in IndexedDB
      const existing = await getAll('exercises');

      for (const ex of imported) {
        if (ex.overlap) continue; // already marked
        if (isPhoneApp(ex.device)) {
          // Importing phone — mark as overlap if DB has a watch session
          const hasWatchInDb = existing.some((dbEx) =>
            !isPhoneApp(dbEx.device) && overlaps(ex, dbEx)
          );
          if (hasWatchInDb) {
            ex.overlap = true;
            overlapsMarked++;
          }
        } else {
          // Importing watch — mark existing phone sessions as overlap
          for (const dbEx of existing) {
            if (isPhoneApp(dbEx.device) && !dbEx.overlap && overlaps(ex, dbEx)) {
              dbEx.overlap = true;
              await put('exercises', dbEx);
              overlapsMarked++;
            }
          }
        }
      }
    }

    if (imported.length > 0) {
      // Auto-assign default shoe
      const shoes = await getAll('shoes');
      const defaultShoe = shoes.find((s) => s.isDefault);
      if (defaultShoe) {
        for (const ex of imported) {
          if (!ex.shoeId) ex.shoeId = defaultShoe.id;
        }
      }

      await putMany('exercises', imported);
      await recalcAllShoeKm();

      // Cache detail data in background
      backgroundFetchDetails(imported.map((ex) => ex.id));
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

init();
