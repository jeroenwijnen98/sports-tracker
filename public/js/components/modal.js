const overlay = document.getElementById('modal-overlay');
const modalEl = document.getElementById('modal');

/**
 * Open a modal with given HTML content.
 */
export function openModal(html) {
  modalEl.innerHTML = html;
  overlay.classList.add('active');

  // Close on overlay click
  overlay.onclick = (e) => {
    if (e.target === overlay) closeModal();
  };

  // Close on Escape
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
