import { getAll, put, add, del } from '../db.js';
import { createShoeCard } from '../components/shoeCard.js';
import { openModal, closeModal } from '../components/modal.js';
import { showToast } from '../components/toast.js';
import { recalcShoeKm } from '../sync.js';

const panel = document.getElementById('tab-shoes');

export async function renderShoes() {
  const shoes = await getAll('shoes');

  // Sort: default first, then by name
  shoes.sort((a, b) => {
    if (a.isDefault && !b.isDefault) return -1;
    if (!a.isDefault && b.isDefault) return 1;
    return (a.name || '').localeCompare(b.name || '');
  });

  panel.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'section-header';
  header.innerHTML = `
    <h2>Shoes</h2>
    <button class="btn btn-primary btn-sm" id="add-shoe-btn">+ Toevoegen</button>
  `;
  panel.appendChild(header);

  header.querySelector('#add-shoe-btn').addEventListener('click', () => {
    openShoeModal();
  });

  if (shoes.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = `
      <div class="empty-state-icon">👟</div>
      <h3>Geen schoenen</h3>
      <p>Voeg je eerste hardloopschoen toe om kilometers bij te houden.</p>
    `;
    panel.appendChild(empty);
    return;
  }

  const list = document.createElement('div');
  list.className = 'card-list';

  for (const shoe of shoes) {
    list.appendChild(createShoeCard(shoe, {
      onEdit: (s) => openShoeModal(s),
      onDelete: (s) => deleteShoe(s),
      onSetDefault: (s) => setDefaultShoe(s),
    }));
  }

  panel.appendChild(list);
}

function openShoeModal(shoe = null) {
  const isEdit = !!shoe;
  const title = isEdit ? 'Schoen bewerken' : 'Schoen toevoegen';

  openModal(`
    <div class="modal-header">
      <h2>${title}</h2>
      <button class="btn-icon btn-ghost" id="modal-close">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
    <form id="shoe-form" class="modal-body">
      <div class="form-group">
        <label for="shoe-name">Naam</label>
        <input type="text" id="shoe-name" placeholder="bijv. Nike Pegasus 41" value="${escapeAttr(shoe?.name || '')}" required>
      </div>
      <div class="form-group">
        <label for="shoe-brand">Merk</label>
        <input type="text" id="shoe-brand" placeholder="bijv. Nike" value="${escapeAttr(shoe?.brand || '')}">
      </div>
      <div class="form-group">
        <label for="shoe-initial-km">Start km (optioneel)</label>
        <input type="number" id="shoe-initial-km" step="0.1" min="0" placeholder="0" value="${shoe?.initialKm || ''}">
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" id="modal-cancel">Annuleren</button>
        <button type="submit" class="btn btn-primary">${isEdit ? 'Opslaan' : 'Toevoegen'}</button>
      </div>
    </form>
  `);

  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('shoe-name').focus();

  document.getElementById('shoe-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('shoe-name').value.trim();
    const brand = document.getElementById('shoe-brand').value.trim();
    const initialKm = parseFloat(document.getElementById('shoe-initial-km').value) || 0;

    if (!name) return;

    if (isEdit) {
      shoe.name = name;
      shoe.brand = brand;
      shoe.initialKm = initialKm;
      await put('shoes', shoe);
      await recalcShoeKm(shoe.id);
      showToast('Schoen bijgewerkt', 'success');
    } else {
      const newShoe = { name, brand, initialKm, totalKm: initialKm, isDefault: false };
      // If this is the first shoe, make it default
      const existing = await getAll('shoes');
      if (existing.length === 0) {
        newShoe.isDefault = true;
      }
      await add('shoes', newShoe);
      showToast('Schoen toegevoegd', 'success');
    }

    closeModal();
    await renderShoes();
  });
}

async function deleteShoe(shoe) {
  if (!confirm(`"${shoe.name}" verwijderen?`)) return;

  // Unassign exercises from this shoe
  const { getAll: getAllExercises, put: putExercise } = await import('../db.js');
  const exercises = await getAllExercises('exercises');
  for (const ex of exercises) {
    if (ex.shoeId === shoe.id) {
      delete ex.shoeId;
      await putExercise('exercises', ex);
    }
  }

  await del('shoes', shoe.id);
  showToast('Schoen verwijderd', 'success');
  await renderShoes();
}

async function setDefaultShoe(shoe) {
  const shoes = await getAll('shoes');
  for (const s of shoes) {
    s.isDefault = s.id === shoe.id;
    await put('shoes', s);
  }
  showToast(`${shoe.name} is nu de standaard schoen`, 'success');
  await renderShoes();
}

function escapeAttr(str) {
  return str.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
