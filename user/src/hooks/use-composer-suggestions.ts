'use client';

import { useSearchSuggestions } from '@hooks/use-search-suggestions';
import { IUser } from '@interfaces/user';
import { type RefObject, useCallback, useEffect, useMemo, useState } from 'react';

/**
 * Matches the `#hashtag` / `@mention` token the caret currently sits in.
 *
 * Anchored to the end so only the token being typed triggers, and the trigger must start a word so
 * a `#` or `@` inside an email or colour code is ignored. An empty capture is allowed so a bare
 * `#`/`@` opens the dropdown immediately.
 */
const TRIGGER_PATTERN = /(^|\s)([#@])([\wÀ-ſЀ-ӿ一-鿿]*)$/;

export interface ComposerSuggestionOption {
  id: string;
  /** Text inserted into the editor, including the trigger character. */
  label: string;
  hint: string;
  user: IUser | null;
}

interface ActiveTrigger {
  type: 'tag' | 'user';
  term: string;
  /** Offset in the full text where the trigger character starts. */
  start: number;
}

/** Text on either side of the caret, derived from one Range so the two always agree. */
function readCaretContext(editor: HTMLElement) {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return null;

  const range = selection.getRangeAt(0);
  if (!editor.contains(range.endContainer)) return null;

  const beforeRange = range.cloneRange();
  beforeRange.selectNodeContents(editor);
  beforeRange.setEnd(range.endContainer, range.endOffset);

  const afterRange = range.cloneRange();
  afterRange.selectNodeContents(editor);
  afterRange.setStart(range.endContainer, range.endOffset);

  return { before: beforeRange.toString(), after: afterRange.toString() };
}

/** Places the caret at a character offset, walking text nodes since offsets are not node-relative. */
function setCaretOffset(editor: HTMLElement, offset: number) {
  const selection = window.getSelection();
  if (!selection) return;

  const range = document.createRange();
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  let remaining = offset;
  let node = walker.nextNode();

  while (node) {
    const length = node.textContent?.length || 0;
    if (remaining <= length) {
      range.setStart(node, remaining);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    remaining -= length;
    node = walker.nextNode();
  }

  range.selectNodeContents(editor);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

interface UseComposerSuggestionsOptions {
  editorRef: RefObject<HTMLDivElement | null>;
  onChange: (value: string) => void;
  onMentionsChange?: (users: IUser[]) => void;
  enabled?: boolean;
}

/**
 * Hashtag and mention autocomplete for a `contentEditable` composer.
 *
 * Written against Range/Selection rather than `selectionStart`, which only exists on form controls —
 * the live composer's description is a contentEditable div.
 */
export function useComposerSuggestions({
  editorRef,
  onChange,
  onMentionsChange,
  enabled = true
}: UseComposerSuggestionsOptions) {
  const [trigger, setTrigger] = useState<ActiveTrigger | null>(null);
  const [highlighted, setHighlighted] = useState(0);
  // Users chosen from the dropdown, so their ids can be submitted alongside the text.
  const [mentionedUsers, setMentionedUsers] = useState<IUser[]>([]);

  const { tags, users, loading } = useSearchSuggestions(
    trigger?.term || '',
    trigger?.type || 'tag',
    enabled && Boolean(trigger)
  );

  const options = useMemo<ComposerSuggestionOption[]>(() => {
    if (!trigger) return [];
    return trigger.type === 'tag'
      ? tags.map(tag => ({
        id: tag.tag,
        label: `#${tag.tag}`,
        hint: `${tag.postCount} posts`,
        user: null
      }))
      : users.map(user => ({
        id: user._id,
        label: `@${user.username}`,
        hint: user.name || '',
        user
      }));
  }, [tags, trigger, users]);

  useEffect(() => {
    setHighlighted(0);
  }, [options.length]);

  useEffect(() => {
    onMentionsChange?.(mentionedUsers);
  }, [mentionedUsers, onMentionsChange]);

  /** Drops mentions whose @username no longer appears in the text. */
  const syncMentions = useCallback((text: string) => {
    setMentionedUsers(current => {
      const next = current.filter(user => text.includes(`@${user.username}`));
      return next.length === current.length ? current : next;
    });
  }, []);

  const detectTrigger = useCallback(() => {
    const editor = editorRef.current;
    if (!editor || !enabled) return;

    const context = readCaretContext(editor);
    if (!context) {
      setTrigger(null);
      return;
    }

    const match = TRIGGER_PATTERN.exec(context.before);
    if (!match) {
      setTrigger(null);
      return;
    }

    const [full, prefix, symbol, term] = match;
    setTrigger({
      type: symbol === '#' ? 'tag' : 'user',
      term,
      start: context.before.length - (full.length - prefix.length)
    });
  }, [editorRef, enabled]);

  // `selectionchange` is the only event that reliably reflects caret movement in a contentEditable —
  // keyup/click miss IME input, autocorrect, and programmatic selection changes.
  useEffect(() => {
    if (!enabled) return;

    const handleSelectionChange = () => {
      const editor = editorRef.current;
      if (!editor) return;
      if (!editor.contains(document.activeElement) && document.activeElement !== editor) return;
      detectTrigger();
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, [detectTrigger, editorRef, enabled]);

  const closeSuggestions = useCallback(() => setTrigger(null), []);

  /**
   * Inserts a bare `#` or `@` at the caret and opens the dropdown.
   *
   * Backs the "# Hashtags" / "@ Mention" buttons, which were previously inert.
   */
  const insertTrigger = useCallback((symbol: '#' | '@') => {
    const editor = editorRef.current;
    if (!editor) return;

    editor.focus();
    const context = readCaretContext(editor) || { before: editor.textContent || '', after: '' };
    // Trigger detection requires the symbol to start a word.
    const needsSpace = context.before.length > 0 && !/\s$/.test(context.before);
    const inserted = `${needsSpace ? ' ' : ''}${symbol}`;
    const nextText = `${context.before}${inserted}${context.after}`;

    editor.textContent = nextText;
    setCaretOffset(editor, context.before.length + inserted.length);
    onChange(nextText);
    detectTrigger();
  }, [detectTrigger, editorRef, onChange]);

  const applyOption = useCallback((option: ComposerSuggestionOption) => {
    const editor = editorRef.current;
    if (!editor || !trigger) return;

    const context = readCaretContext(editor);
    if (!context) return;

    // Trailing space so the next keystroke starts a new word instead of extending the token.
    const inserted = `${option.label} `;
    const nextText = `${context.before.slice(0, trigger.start)}${inserted}${context.after}`;
    const caretOffset = trigger.start + inserted.length;

    editor.textContent = nextText;
    setCaretOffset(editor, caretOffset);
    editor.focus();

    onChange(nextText);
    if (option.user) {
      setMentionedUsers(current => (current.some(item => item._id === option.user!._id)
        ? current
        : [...current, option.user!]));
    }
    setTrigger(null);
  }, [editorRef, onChange, trigger]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!trigger || !options.length) return false;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlighted(current => (current + 1) % options.length);
      return true;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlighted(current => (current - 1 + options.length) % options.length);
      return true;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      applyOption(options[highlighted]);
      return true;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setTrigger(null);
      return true;
    }
    return false;
  }, [applyOption, highlighted, options, trigger]);

  return {
    options,
    loading,
    highlighted,
    setHighlighted,
    // Open whenever a trigger is active, including when there is nothing to show. An empty result is
    // real feedback ("no matches") — silently hiding makes a working trigger look broken.
    isOpen: Boolean(trigger),
    triggerType: trigger?.type ?? null,
    detectTrigger,
    closeSuggestions,
    insertTrigger,
    applyOption,
    handleKeyDown,
    syncMentions,
    mentionedUsers
  };
}
