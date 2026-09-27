const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/**
 * Escape a string for markup, in element text or a quoted attribute. Use it on
 * everything the user or an imported file controls: shoe name and brand, device.
 */
export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ENTITIES[c]);
}
