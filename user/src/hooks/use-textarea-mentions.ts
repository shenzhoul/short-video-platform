'use client';

import { IUser } from '@interfaces/user';
import { useProfile } from '@providers/profile.provider';
import { getCreatorFollowers, getCreatorFollowings } from '@services/user.service';
import {
  type RefObject, useCallback, useEffect, useMemo, useRef, useState
} from 'react';

import { useSearchSuggestions } from './use-search-suggestions';

/**
 * Matches the `#hashtag` / `@mention` token the caret currently sits in.
 *
 * Shared with the contentEditable composer so both surfaces agree on what counts
 * as a mention. Anchored to the end so only the token being typed triggers, and
 * the trigger must start a word so the `@` in an email address is ignored. An
 * empty capture is allowed so a bare `@` opens the picker immediately.
 */
export const MENTION_TRIGGER_PATTERN = /(^|\s)([#@])([\wÀ-ſЀ-ӿ一-鿿]*)$/;

/** How many people to offer before the user types anything. */
const RECOMMENDATION_LIMIT = 20;

export interface MentionOption {
  id: string;
  /** Text inserted into the textarea, including the trigger character. */
  label: string;
  hint: string;
  user: IUser | null;
}

interface ActiveTrigger {
  type: 'tag' | 'user';
  term: string;
  /** Index in the text where the trigger character starts. */
  start: number;
}

interface UseTextareaMentionsOptions {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (value: string) => void;
  /** Set false to disable the picker entirely, e.g. for a signed-out viewer. */
  enabled?: boolean;
  /** Whether a bare `@` offers followers/following before any query is typed. */
  withRecommendations?: boolean;
  /** Formats the hashtag row's secondary text; lets callers keep their own count style. */
  formatTagHint?: (postCount: number) => string;
}

/**
 * `@mention` autocomplete for a plain `<textarea>`.
 *
 * Extracted from the post composer so the comment box can offer the same picker
 * without inheriting the composer's own textarea, styling or form wiring — the
 * comment form keeps its react-hook-form state, emoji insertion, auto-resize and
 * reply banner, and only borrows the mention behaviour.
 *
 * Two entry points share all of this state: typing `@`, and pressing an `@`
 * button that calls {@link openMentionPicker}. There is deliberately one trigger,
 * one candidate list and one insertion path.
 */
export function useTextareaMentions({
  textareaRef,
  value,
  onChange,
  enabled = true,
  withRecommendations = true,
  formatTagHint = (postCount: number) => `${postCount} posts`
}: UseTextareaMentionsOptions) {
  const { current: viewer } = useProfile();
  const [trigger, setTrigger] = useState<ActiveTrigger | null>(null);
  const [highlighted, setHighlighted] = useState(0);
  const [recommendations, setRecommendations] = useState<IUser[]>([]);
  // Users chosen from the picker this session. Only a hint for resolution — the
  // submitted text still decides who is actually mentioned.
  const [pickedUsers, setPickedUsers] = useState<IUser[]>([]);
  const recommendationsLoadedRef = useRef(false);

  const term = trigger?.term || '';
  const isMentionTrigger = trigger?.type === 'user';
  // A bare `@` shows the people you already know; anything typed after it is a
  // search across all users, so someone you do not follow is still reachable.
  const isSearching = isMentionTrigger && term.length > 0;

  const { tags, users, loading: searching } = useSearchSuggestions(
    term,
    trigger?.type || 'tag',
    enabled && Boolean(trigger) && (trigger.type === 'tag' || isSearching)
  );

  /**
   * People the viewer follows or is followed by, offered before they type.
   *
   * Fetched once per mount and kept, because the picker is opened repeatedly
   * while writing one comment and the relationship lists barely change in that
   * window.
   */
  useEffect(() => {
    if (!enabled || !withRecommendations || !viewer?._id) return;
    if (recommendationsLoadedRef.current) return;
    if (!isMentionTrigger || isSearching) return;

    recommendationsLoadedRef.current = true;
    let cancelled = false;

    void (async () => {
      try {
        const query = { limit: RECOMMENDATION_LIMIT, offset: 0 };
        const [following, followers] = await Promise.all([
          getCreatorFollowings(viewer._id, query).catch(() => null),
          getCreatorFollowers(viewer._id, query).catch(() => null)
        ]);
        if (cancelled) return;

        // Someone who follows you and is followed back appears in both lists, so
        // merge on the real user id rather than showing them twice.
        const merged = new Map<string, IUser>();
        [following?.data?.data || [], followers?.data?.data || []].forEach((list: IUser[]) => {
          list.forEach((user) => {
            if (user?._id && user.username && !merged.has(user._id)) merged.set(user._id, user);
          });
        });
        setRecommendations([...merged.values()]);
      } catch {
        // A failed suggestion list is not worth surfacing: typing a query still
        // searches, and the picker simply shows nothing to start from.
        if (!cancelled) setRecommendations([]);
      }
    })();

    return () => {
 cancelled = true;
};
  }, [enabled, isMentionTrigger, isSearching, viewer?._id, withRecommendations]);

  const options = useMemo<MentionOption[]>(() => {
    if (!trigger) return [];

    if (trigger.type === 'tag') {
      return tags.map((tag) => ({
        id: tag.tag, label: `#${tag.tag}`, hint: formatTagHint(tag.postCount), user: null
      }));
    }

    const source = isSearching ? users : recommendations;
    return source
      .filter((user) => user?.username)
      .map((user) => ({
        id: user._id,
        label: `@${user.username}`,
        hint: user.name || '',
        user
      }));
  }, [formatTagHint, isSearching, recommendations, tags, trigger, users]);

  useEffect(() => {
    setHighlighted(0);
  }, [options.length]);

  const detectTrigger = useCallback((text: string, caret: number) => {
    if (!enabled) return;

    const match = MENTION_TRIGGER_PATTERN.exec(text.slice(0, caret));
    if (!match) {
      setTrigger(null);
      return;
    }

    const [full, prefix, symbol, matchedTerm] = match;
    setTrigger({
      type: symbol === '#' ? 'tag' : 'user',
      term: matchedTerm,
      start: caret - (full.length - prefix.length)
    });
  }, [enabled]);

  const closePicker = useCallback(() => setTrigger(null), []);

  /**
   * Insert a bare `@` at the caret and open the picker.
   *
   * Backs the `@` button so it lands in exactly the same state as typing `@`.
   */
  const openMentionPicker = useCallback(() => {
    if (!enabled) return;

    const textarea = textareaRef.current;
    const caret = textarea?.selectionStart ?? value.length;
    const before = value.slice(0, caret);
    const after = value.slice(caret);
    // Trigger detection requires the symbol to start a word.
    const needsSpace = before.length > 0 && !/\s$/.test(before);
    const inserted = `${needsSpace ? ' ' : ''}@`;
    const nextValue = `${before}${inserted}${after}`;
    const caretPosition = before.length + inserted.length;

    onChange(nextValue);
    setTrigger({ type: 'user', term: '', start: caretPosition - 1 });

    // After React has re-rendered with the new value.
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(caretPosition, caretPosition);
    });
  }, [enabled, onChange, textareaRef, value]);

  /**
   * Replace the token being typed with the chosen handle.
   *
   * Rewrites only the span from the trigger to the caret, so text on either side
   * survives and several mentions can coexist in one comment.
   */
  const applyOption = useCallback((option: MentionOption) => {
    if (!trigger) return;

    const textarea = textareaRef.current;
    const caret = textarea?.selectionStart ?? value.length;
    const before = value.slice(0, trigger.start);
    const after = value.slice(caret);
    // Trailing space so the next keystroke starts a fresh word rather than
    // extending the handle.
    const inserted = `${option.label} `;
    const nextValue = `${before}${inserted}${after}`;

    onChange(nextValue);
    setTrigger(null);
    if (option.user) {
      setPickedUsers((current) => (current.some((item) => item._id === option.user!._id)
        ? current
        : [...current, option.user!]));
    }

    requestAnimationFrame(() => {
      const position = before.length + inserted.length;
      textarea?.focus();
      textarea?.setSelectionRange(position, position);
    });
  }, [onChange, textareaRef, trigger, value]);

  /**
   * @returns true when the picker consumed the key, so the caller can skip its
   * own handling — otherwise Enter would submit the comment mid-selection.
   */
  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!trigger) return false;

    if (event.key === 'Escape') {
      event.preventDefault();
      setTrigger(null);
      return true;
    }

    if (!options.length) return false;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlighted((current) => (current + 1) % options.length);
      return true;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlighted((current) => (current - 1 + options.length) % options.length);
      return true;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      applyOption(options[highlighted]);
      return true;
    }
    return false;
  }, [applyOption, highlighted, options, trigger]);

  return {
    options,
    highlighted,
    setHighlighted,
    loading: isSearching ? searching : false,
    isOpen: Boolean(trigger),
    triggerType: trigger?.type ?? null,
    isSearching,
    detectTrigger,
    closePicker,
    openMentionPicker,
    applyOption,
    handleKeyDown,
    pickedUsers
  };
}
