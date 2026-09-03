import { RECOMMENDATION_ANONYMOUS_ID_KEY } from '@constants/recommendation-anonymous-id';
import { cookies } from 'next/headers';

/**
 * The guest's recommendation subject id, for a server render.
 *
 * The client keeps this in `localStorage` and mirrors it into a cookie
 * (`recommendation-anonymous-id.ts`) precisely so this function can exist. A
 * feed session is owned by the subject that created it, so a server-rendered
 * first page built under a throwaway subject is a session the client can never
 * continue — it asks for page two, the server does not recognise the owner, and
 * silently starts a *new* session instead. That is not a theoretical concern:
 * it is what made a guest's Home feed impossible to exhaust.
 *
 * Returns `undefined` on a first-ever visit, before the client has created the
 * id. That render gets a one-off session and the client's own first request
 * takes over from there; every later visit shares one subject end to end.
 */
export async function getRecommendationAnonymousIdFromCookies(): Promise<string | undefined> {
  const store = await cookies();
  const value = store.get(RECOMMENDATION_ANONYMOUS_ID_KEY)?.value;
  return value ? decodeURIComponent(value) : undefined;
}
