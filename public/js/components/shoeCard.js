/**
 * Create a shoe card element.
 */
export function createShoeCard(shoe, { onEdit, onDelete, onSetDefault }) {
  const el = document.createElement('div');
  el.className = 'shoe-card';

  const km = (shoe.totalKm || 0).toFixed(1);

  el.innerHTML = `
    <div class="shoe-card-icon">👟</div>
    <div class="shoe-card-info">
      <div class="shoe-card-name">
        ${escapeHtml(shoe.name)}
        ${shoe.isDefault ? '<span class="shoe-card-default-badge">Standaard</span>' : ''}
      </div>
      <div class="shoe-card-km">${km} km</div>
      ${shoe.brand ? `<div class="shoe-card-brand">${escapeHtml(shoe.brand)}</div>` : ''}
    </div>
    <div class="shoe-card-actions">
      ${!shoe.isDefault ? `<button class="btn-icon btn-ghost" data-action="default" title="Stel in als standaard">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
        </svg>
      </button>` : ''}
      <button class="btn-icon btn-ghost" data-action="edit" title="Bewerken">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
      </button>
      <button class="btn-icon btn-ghost" data-action="delete" title="Verwijderen">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        </svg>
      </button>
    </div>
  `;

  el.querySelector('[data-action="edit"]')?.addEventListener('click', () => onEdit(shoe));
  el.querySelector('[data-action="delete"]')?.addEventListener('click', () => onDelete(shoe));
  el.querySelector('[data-action="default"]')?.addEventListener('click', () => onSetDefault(shoe));

  return el;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
