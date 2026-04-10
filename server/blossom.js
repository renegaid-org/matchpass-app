// PRIVACY NOTE: photo_hash (SHA-256 of Blossom blob) is a stable identifier.
// If two clubs both gate-lock the same fan, the identical photo_hash correlates
// identity across clubs. This is a known design limitation. Full mitigation
// requires per-club salting of the hash, which is a Phase 2 consideration.

/**
 * Fetch a photo from Blossom by SHA-256 hash.
 * Returns the image as a Buffer, or null if not found.
 */
export async function fetchPhoto(photoHash) {
  // Validate hash format to prevent SSRF
  if (!photoHash || typeof photoHash !== 'string' || !/^[0-9a-f]+$/.test(photoHash) || photoHash.length > 128) {
    return null;
  }

  const baseUrl = process.env.BLOSSOM_BASE_URL || 'https://blossom.example.com';
  try {
    const response = await fetch(`${baseUrl}/${photoHash}`);
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();
    return Buffer.from(buffer);
  } catch {
    return null;
  }
}
