// @ts-check

const overlay = /** @type {HTMLElement} */ (document.getElementById('modal-overlay'));
const modalEl = /** @type {HTMLElement} */ (document.getElementById('modal'));

/**
 * Open a modal with given HTML content.
 * @param {string} html
 */
export function openModal(html) {
  modalEl.innerHTML = html;
  overlay.classList.add('active');

  // Close on overlay click
  overlay.onclick = (e) => {
    if (e.target === overlay) closeModal();
  };

  // Close on Escape
  /** @param {KeyboardEvent} e */
  const onKey = (e) => {
    if (e.key === 'Escape') {
      closeModal();
      document.removeEventListener('keydown', onKey);
    }
  };
  document.addEventListener('keydown', onKey);
}

/**
 * Close the active modal.
 */
export function closeModal() {
  overlay.classList.remove('active');
  modalEl.innerHTML = '';
}
