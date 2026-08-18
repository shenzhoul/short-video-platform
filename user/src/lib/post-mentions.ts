import type { IUser } from '@interfaces/user';
import { findCreatorByUsername } from '@services/creator.service';

/**
 * An `@handle` token in post text.
 *
 * Character class matches the composer's trigger pattern, and the token must start a word so an
 * address inside an email is not read as a mention.
 */
const MENTION_PATTERN = /(?:^|\s)@([\wÀ-ſЀ-ӿ一-鿿]+)/g;

/** Every distinct handle written in the text, in order of appearance. */
export function extractMentionHandles(text: string): string[] {
  const handles = new Set<string>();
  for (const match of (text || '').matchAll(MENTION_PATTERN)) {
    if (match[1]) handles.add(match[1]);
  }
  return [...handles];
}

/**
 * The user ids a post's text currently mentions.
 *
 * The **text is the source of truth**, not the list of people picked from the dropdown. An editor
 * that only reported its own session's picks could add a mention but never remove one: reopening a
 * post, deleting `@john` and saving would leave John's id attached to a post that no longer names
 * him. Deriving from the final text instead makes all four cases fall out of one rule — unchanged,
 * added, one removed, all removed.
 *
 * `knownUsers` short-circuits the lookup for anyone chosen from the `@` dropdown in this session,
 * so the common path costs no extra requests.
 *
 * A handle that cannot be resolved is dropped, which matches what the server does with ids it
 * cannot find. That also means a failed request loses the mention rather than guessing at it — the
 * `@handle` itself stays in the text either way, so what is lost is the link, not the content.
 */
export async function resolveMentionedUserIds(
  text: string,
  knownUsers: IUser[] = []
): Promise<string[]> {
  const handles = extractMentionHandles(text);
  if (!handles.length) return [];

  const knownByHandle = new Map(
    knownUsers
      .filter(user => user.username)
      .map(user => [user.username.toLowerCase(), user._id])
  );

  const resolved = await Promise.all(handles.map(async (handle) => {
    const known = knownByHandle.get(handle.toLowerCase());
    if (known) return known;

    try {
      const { data } = await findCreatorByUsername(handle);
      return (data?._id as string) || null;
    } catch {
      // Unknown handle, deleted account, or a failed request — none of them belong in the payload.
      return null;
    }
  }));

  return [...new Set(resolved.filter((id): id is string => Boolean(id)))];
}
