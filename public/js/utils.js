/**
 * Escape HTML special characters to prevent XSS.
 */
export function escapeHtml(str) {
  if (str == null) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

/**
 * Validate photo hash is hex-only (matches server-side isValidPhotoHash).
 */
export function isValidPhotoHash(hash) {
  if (!hash || typeof hash !== 'string') return false;
  if (hash.length > 128) return false;
  return /^[0-9a-f]+$/.test(hash);
}
