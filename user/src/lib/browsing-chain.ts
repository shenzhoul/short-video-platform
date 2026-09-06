/**
 * Browsing chain ids — one per page load, per surface.
 *
 * ## The three identities
 *
 * | Concept | Lives for | Where it comes from |
 * |---|---|---|
 * | **subject** (account id / guest `anonymousId`) | the account, or the guest cookie | `recommendation-anonymous-id.ts` |
 * | **browsing chain** (`chainId`) | one page load of one surface | here |
 * | **feed session** (`sessionId`) | one ranked batch | the server, per request |
 *
 * A chain strings several ranked sessions together so a continuous scroll keeps
 * finding posts it has not shown yet. It is deliberately none of the other two:
 *
 * - **Not the subject.** One person browses many times; each browse must be
 *   free to see the catalogue from the start.
 * - **Not the first session id.** That is what shipped in `deploy-2026-09-06g`:
 *   an implicit identity the client could not name, reset or reason about.
 *
 * ## Why a module variable, and not storage
 *
 * The id lives in this module's scope and nowhere else. That gives exactly the
 * lifetime we want, without any explicit cleanup:
 *
 * - a **full page reload** re-evaluates the module, so it mints a new chain —
 *   a reload is a fresh browse, and can never inherit a nearly spent one;
 * - **client-side navigation** within the same page keeps it, so paging and
 *   rollover stay in one chain;
 * - **a second tab** is a second document with its own module instance, so two
 *   tabs never consume each other's catalogue.
 *
 * `sessionStorage` would break the first of those (it survives a reload) and
 * `localStorage` would break the first and the third.
 *
 * ## Server-rendered first pages
 *
 * The first Home/For You page is fetched during SSR, before this module has
 * run in the browser. That render mints its own id and returns it in the
 * payload; the hook adopts it with `adoptBrowsingChainId` so the client
 * continues the chain the server started instead of orphaning its first
 * session's posts outside the chain's seen-set.
 */

/** Surfaces that keep their own chain. Home and For You rank differently and must not share one. */
export type BrowsingSurface = 'home' | 'for-you';

const chainIds = new Map<string, string>();

/**
 * A URL-safe opaque id, inside the length/charset the API validates.
 *
 * `crypto.randomUUID` needs a secure context; the fallback is only reached in
 * one that is not (plain-HTTP local access), where a slightly weaker id costs
 * nothing — a chain id is a browse label bound server-side to the subject, not
 * a credential.
 */
function mintChainId(): string {
  const uuid = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
  // Hyphens are inside the API's allowed charset; a UUID is 36 characters, well
  // within its 8..64 bound.
  return uuid;
}

/**
 * The chain id for this surface in this page load, minting one on first use.
 *
 * `scope` separates chains that must not share a seen-set even on the same
 * surface — Home's category tabs, where switching category is a new browsing
 * context and should not be starved by what "All" already showed.
 */
export function getBrowsingChainId(surface: BrowsingSurface, scope = ''): string {
  const key = scope ? `${surface}:${scope}` : surface;
  const existing = chainIds.get(key);
  if (existing) return existing;

  const minted = mintChainId();
  chainIds.set(key, minted);
  return minted;
}

/**
 * Adopt the id a server render already used, so its session's posts are inside
 * the chain rather than outside it. Ignored once this surface has a chain — a
 * later SSR payload must never re-point a browse already in progress.
 */
export function adoptBrowsingChainId(surface: BrowsingSurface, chainId?: string | null, scope = ''): string {
  const key = scope ? `${surface}:${scope}` : surface;
  const existing = chainIds.get(key);
  if (existing) return existing;
  if (!chainId) return getBrowsingChainId(surface, scope);

  chainIds.set(key, chainId);
  return chainId;
}

/**
 * Abandon this surface's chain and start a new one.
 *
 * "Refresh recommendations" is the caller: it asks for a new mix of the whole
 * catalogue, not for the remainder of the browse being abandoned.
 */
export function resetBrowsingChain(surface: BrowsingSurface, scope = ''): string {
  const key = scope ? `${surface}:${scope}` : surface;
  const minted = mintChainId();
  chainIds.set(key, minted);
  return minted;
}

/** Test seam. Never call this from application code — a page load is the reset. */
export function __clearBrowsingChainsForTest() {
  chainIds.clear();
}
