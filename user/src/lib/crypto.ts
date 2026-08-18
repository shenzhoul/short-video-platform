/**
 * Client-side cryptographic utilities
 *
 * Provides secure password hashing using SHA256 to prevent plain text
 * passwords from being transmitted over the network or stored in logs.
 *
 * Security Benefits:
 * - No plain text passwords in network traffic
 * - No plain text passwords in server logs
 * - No plain text passwords in server memory
 * - Protection against password exposure in debugging
 */

/**
 * Hash password using SHA256
 *
 * This function hashes passwords on the client-side before transmission
 * to the server. This prevents plain text passwords from appearing in
 * network logs, server logs, or server memory.
 *
 * @param password - Plain text password to hash
 * @returns Promise<string> - SHA256 hash of the password in hex format
 *
 * @example
 * ```typescript
 * const hashedPassword = await hashPassword('mySecurePassword123');
 * // Returns: "a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3"
 * ```
 */
export async function hashPassword(password: string): Promise<string> {
  // Use Web Crypto API for secure hashing (available in all modern browsers)
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);

  // Convert buffer to hex string
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  return hashHex;
}
