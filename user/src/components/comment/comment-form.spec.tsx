import {
  act, render, screen, waitFor
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { IUser } from 'src/interfaces';

import CommentForm from './comment-form';

/**
 * The mention picker end to end over the real comment form.
 *
 * `useTextareaMentions`, `useSearchSuggestions`, `resolveMentionedUserIds` and
 * react-hook-form all run for real; only the four network boundaries and the
 * viewer identity are stood in for.
 */

const mockSuggestions = jest.fn();
jest.mock('@services/search.service', () => ({
  getSearchSuggestions: (...args: any[]) => mockSuggestions(...args)
}));

const mockFollowings = jest.fn();
const mockFollowers = jest.fn();
jest.mock('@services/user.service', () => ({
  getCreatorFollowings: (...args: any[]) => mockFollowings(...args),
  getCreatorFollowers: (...args: any[]) => mockFollowers(...args)
}));

const mockFindCreator = jest.fn();
jest.mock('@services/creator.service', () => ({
  findCreatorByUsername: (...args: any[]) => mockFindCreator(...args)
}));

const viewer = { _id: 'viewer-1', username: 'me', name: 'Me' };
jest.mock('@providers/profile.provider', () => ({
  useProfile: () => ({ current: viewer })
}));

function user(id: string, username: string, name: string): IUser {
  return { _id: id, username, name } as IUser;
}

const ALICE = user('u-alice', 'alice', 'Alice A');
const BOB = user('u-bob', 'bob', 'Bob B');
const CARA = user('u-cara', 'cara', 'Cara C');

const onSubmit = jest.fn();

function renderForm(props: Record<string, any> = {}) {
  return render(
    <CommentForm
      objectId="post-1"
      creator={viewer as any}
      onSubmit={onSubmit}
      {...props}
    />
  );
}

function textarea() {
  return screen.getByPlaceholderText('Add comment...') as HTMLTextAreaElement;
}

/** The picker is the only listbox in the form. */
function picker() {
  return screen.queryByRole('listbox', { name: 'Mention a user' });
}

beforeEach(() => {
  mockFollowings.mockResolvedValue({ data: { data: [ALICE, BOB] } });
  mockFollowers.mockResolvedValue({ data: { data: [BOB, CARA] } });
  // Stands in for the search endpoint by prefix-matching, so a typed query
  // returns what the server would. Recommendations and search are genuinely
  // different sources — a bare `@` never reaches this.
  mockSuggestions.mockImplementation((term: string) => Promise.resolve({
    data: [ALICE, BOB, CARA].filter((candidate) => (
      candidate.username.startsWith((term || '').toLowerCase())
    ))
  }));
  mockFindCreator.mockResolvedValue({ data: null });
});

describe('mention picker entry points', () => {
  it('opens when the @ button is pressed and writes the trigger into the text', async () => {
    renderForm();
    await userEvent.click(screen.getByRole('button', { name: 'Mention someone' }));

    expect(await screen.findByRole('listbox', { name: 'Mention a user' })).toBeInTheDocument();
    // The button lands in the same state as typing, so the trigger is real text.
    expect(textarea()).toHaveValue('@');
  });

  it('stays open after the @ button is clicked', async () => {
    renderForm();
    const field = textarea();
    field.focus();

    // Real pointer sequence: mousedown — which used to blur the textarea and
    // schedule the close — then click.
    await userEvent.click(screen.getByRole('button', { name: 'Mention someone' }));
    expect(picker()).toBeInTheDocument();

    // Well past the 150ms blur-close delay that used to shut it again.
    await new Promise((resolve) => { setTimeout(resolve, 400); });

    expect(picker()).toBeInTheDocument();
  });

  it('keeps focus in the textarea when the button is pressed', async () => {
    renderForm();
    const field = textarea();
    field.focus();

    await userEvent.click(screen.getByRole('button', { name: 'Mention someone' }));

    // Focus never leaving is what preserves the caret for a mid-text mention.
    expect(document.activeElement).toBe(field);
  });

  it('remains reachable by keyboard', async () => {
    renderForm();
    const button = screen.getByRole('button', { name: 'Mention someone' });

    button.focus();
    await userEvent.keyboard('{Enter}');

    // The mousedown guard must not make the control keyboard-inaccessible.
    expect(await screen.findByRole('listbox', { name: 'Mention a user' })).toBeInTheDocument();
  });

  it('opens when @ is typed', async () => {
    renderForm();
    await userEvent.type(textarea(), '@');

    expect(await screen.findByRole('listbox', { name: 'Mention a user' })).toBeInTheDocument();
  });

  it('offers the same candidates from either entry point', async () => {
    const { unmount } = renderForm();
    await userEvent.type(textarea(), '@');
    const typed = (await screen.findAllByRole('option')).map((o) => o.textContent);
    unmount();

    renderForm();
    await userEvent.click(screen.getByRole('button', { name: 'Mention someone' }));
    const clicked = (await screen.findAllByRole('option')).map((o) => o.textContent);

    expect(clicked).toEqual(typed);
  });

  it('separates the trigger from a preceding word so it starts a token', async () => {
    renderForm();
    await userEvent.type(textarea(), 'hello');
    await userEvent.click(screen.getByRole('button', { name: 'Mention someone' }));

    expect(textarea()).toHaveValue('hello @');
    expect(await screen.findByRole('listbox', { name: 'Mention a user' })).toBeInTheDocument();
  });

  it('does not treat an address inside a word as a mention', async () => {
    renderForm();
    await userEvent.type(textarea(), 'mail me at me@example');

    expect(picker()).not.toBeInTheDocument();
  });
});

describe('mention picker recommendations', () => {
  it('offers followers and following before anything is typed', async () => {
    renderForm();
    await userEvent.type(textarea(), '@');

    expect(await screen.findByText('@alice')).toBeInTheDocument();
    expect(screen.getByText('@bob')).toBeInTheDocument();
    expect(screen.getByText('@cara')).toBeInTheDocument();
    expect(screen.getByText('Suggested')).toBeInTheDocument();
  });

  it('shows someone in both relationships only once', async () => {
    renderForm();
    await userEvent.type(textarea(), '@');
    await screen.findByText('@bob');

    // Bob follows the viewer and is followed back; merging is by real id.
    expect(screen.getAllByText('@bob')).toHaveLength(1);
    expect(await screen.findAllByRole('option')).toHaveLength(3);
  });

  it('does not search while the query is empty', async () => {
    renderForm();
    await userEvent.type(textarea(), '@');
    await screen.findByText('@alice');

    expect(mockSuggestions).not.toHaveBeenCalled();
  });

  it('still opens with an explanation when there are no relationships', async () => {
    mockFollowings.mockResolvedValue({ data: { data: [] } });
    mockFollowers.mockResolvedValue({ data: { data: [] } });
    renderForm();
    await userEvent.type(textarea(), '@');

    expect(await screen.findByText('No suggestions yet')).toBeInTheDocument();
  });

  it('survives a failed relationship lookup', async () => {
    mockFollowings.mockRejectedValue(new Error('down'));
    mockFollowers.mockRejectedValue(new Error('down'));
    renderForm();
    await userEvent.type(textarea(), '@');

    // Typing must still search even when the starting list could not be built.
    expect(await screen.findByText('No suggestions yet')).toBeInTheDocument();
  });
});

describe('mention picker search', () => {
  it('switches to server search once a query is typed', async () => {
    mockSuggestions.mockResolvedValue({ data: [user('u-zed', 'zed', 'Zed Z')] });
    renderForm();
    await userEvent.type(textarea(), '@ze');

    expect(await screen.findByText('@zed')).toBeInTheDocument();
    await waitFor(() => expect(mockSuggestions).toHaveBeenCalledWith('ze', 'user'));
    // Search is global, so it is not limited to the recommendation list.
    expect(screen.queryByText('@alice')).not.toBeInTheDocument();
    expect(screen.queryByText('Suggested')).not.toBeInTheDocument();
  });

  it('debounces so one word is not one request per keystroke', async () => {
    renderForm();
    await userEvent.type(textarea(), '@alexand');
    await waitFor(() => expect(mockSuggestions).toHaveBeenCalled());

    expect(mockSuggestions.mock.calls.length).toBeLessThan(7);
  });

  it('returns to recommendations when the query is deleted', async () => {
    mockSuggestions.mockResolvedValue({ data: [user('u-zed', 'zed', 'Zed Z')] });
    renderForm();
    await userEvent.type(textarea(), '@ze');
    await screen.findByText('@zed');

    await userEvent.type(textarea(), '{Backspace}{Backspace}');

    expect(await screen.findByText('@alice')).toBeInTheDocument();
  });

  it('says so when a query matches nobody', async () => {
    mockSuggestions.mockResolvedValue({ data: [] });
    renderForm();
    await userEvent.type(textarea(), '@zzzz');

    expect(await screen.findByText('No matching users')).toBeInTheDocument();
  });
});

describe('mention insertion', () => {
  it('inserts the handle at the caret and keeps the surrounding text', async () => {
    renderForm();
    await userEvent.type(textarea(), 'hey @al');
    await screen.findByText('@alice');

    await userEvent.click(screen.getByText('@alice'));

    await waitFor(() => expect(textarea()).toHaveValue('hey @alice '));
    expect(picker()).not.toBeInTheDocument();
  });

  it('preserves text written after the mention', async () => {
    const field = () => textarea();
    renderForm();
    await userEvent.type(field(), 'hello how are you');
    // Put the caret between "hello " and "how".
    field().setSelectionRange(6, 6);
    await userEvent.click(screen.getByRole('button', { name: 'Mention someone' }));
    await screen.findByText('@alice');

    await userEvent.click(screen.getByText('@alice'));

    await waitFor(() => expect(field()).toHaveValue('hello @alice how are you'));
  });

  it('supports several mentions in one comment', async () => {
    renderForm();
    await userEvent.type(textarea(), '@a');
    await screen.findByText('@alice');
    await userEvent.click(screen.getByText('@alice'));
    await waitFor(() => expect(textarea()).toHaveValue('@alice '));

    await userEvent.type(textarea(), 'and @b');
    await screen.findByText('@bob');
    await userEvent.click(screen.getByText('@bob'));

    await waitFor(() => expect(textarea()).toHaveValue('@alice and @bob '));
  });

  it('closes on Escape without inserting anything', async () => {
    renderForm();
    await userEvent.type(textarea(), 'hi @al');
    await screen.findByText('@alice');

    await userEvent.keyboard('{Escape}');

    await waitFor(() => expect(picker()).not.toBeInTheDocument());
    expect(textarea()).toHaveValue('hi @al');
  });

  it('selects with the arrow keys and commits with Enter', async () => {
    renderForm();
    await userEvent.type(textarea(), '@');
    await screen.findByText('@alice');

    await userEvent.keyboard('{ArrowDown}{Enter}');

    // Second candidate, because ArrowDown moved off the default highlight.
    await waitFor(() => expect(textarea()).toHaveValue('@bob '));
  });

  it('does not submit the comment when Enter commits a candidate', async () => {
    renderForm();
    await userEvent.type(textarea(), '@al');
    await screen.findByText('@alice');

    await userEvent.keyboard('{Enter}');

    await waitFor(() => expect(textarea()).toHaveValue('@alice '));
    // Enter belonged to the picker; the comment is still being written.
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('mentioned ids submitted with the comment', () => {
  it('sends the id of a mention that is still in the text', async () => {
    renderForm();
    await userEvent.type(textarea(), '@al');
    await screen.findByText('@alice');
    await userEvent.click(screen.getByText('@alice'));
    await waitFor(() => expect(textarea()).toHaveValue('@alice '));

    await userEvent.type(textarea(), 'hello');
    await userEvent.click(document.querySelector('button[type="submit"]')!);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      content: '@alice hello',
      mentionedUserIds: ['u-alice']
    })));
    // The picked user short-circuits resolution, so no extra lookup is needed.
    expect(mockFindCreator).not.toHaveBeenCalled();
  });

  it('drops a mention the writer deleted before submitting', async () => {
    renderForm();
    await userEvent.type(textarea(), '@al');
    await screen.findByText('@alice');
    await userEvent.click(screen.getByText('@alice'));
    await waitFor(() => expect(textarea()).toHaveValue('@alice '));

    // Remove "@alice " again, then write something else.
    await userEvent.clear(textarea());
    await userEvent.type(textarea(), 'never mind');
    await userEvent.click(document.querySelector('button[type="submit"]')!);

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.content).toBe('never mind');
    // Picked users are a resolution hint, never a way to re-add a deleted name.
    expect(payload.mentionedUserIds).toBeUndefined();
  });

  it('resolves the same person named twice to one id', async () => {
    renderForm();
    await userEvent.type(textarea(), '@al');
    await screen.findByText('@alice');
    await userEvent.click(screen.getByText('@alice'));
    await waitFor(() => expect(textarea()).toHaveValue('@alice '));
    await userEvent.type(textarea(), 'and @alice again');

    await userEvent.click(document.querySelector('button[type="submit"]')!);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      mentionedUserIds: ['u-alice']
    })));
  });

  it('resolves several different mentions', async () => {
    renderForm();
    await userEvent.type(textarea(), '@a');
    await screen.findByText('@alice');
    await userEvent.click(screen.getByText('@alice'));
    await waitFor(() => expect(textarea()).toHaveValue('@alice '));
    await userEvent.type(textarea(), '@b');
    await screen.findByText('@bob');
    await userEvent.click(screen.getByText('@bob'));
    await waitFor(() => expect(textarea()).toHaveValue('@alice @bob '));

    await userEvent.click(document.querySelector('button[type="submit"]')!);

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].mentionedUserIds).toEqual(['u-alice', 'u-bob']);
  });

  it('resolves a handle typed by hand through the server', async () => {
    mockFindCreator.mockResolvedValue({ data: { _id: 'u-typed', username: 'typed' } });
    renderForm();
    await userEvent.type(textarea(), 'hi @typed');
    await userEvent.keyboard('{Escape}');

    await userEvent.click(document.querySelector('button[type="submit"]')!);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      mentionedUserIds: ['u-typed']
    })));
  });

  it('drops a handle nobody owns rather than sending a guess', async () => {
    mockFindCreator.mockRejectedValue(new Error('not found'));
    renderForm();
    await userEvent.type(textarea(), 'hi @ghost');
    await userEvent.keyboard('{Escape}');

    await userEvent.click(document.querySelector('button[type="submit"]')!);

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].mentionedUserIds).toBeUndefined();
  });

  it('omits the field entirely when nobody is named', async () => {
    renderForm();
    await userEvent.type(textarea(), 'just a comment');
    await userEvent.click(document.querySelector('button[type="submit"]')!);

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty('mentionedUserIds');
  });
});

describe('existing comment behaviour is unchanged', () => {
  it('submits a plain comment with the object it belongs to', async () => {
    renderForm();
    await userEvent.type(textarea(), '  hello world  ');
    await userEvent.click(document.querySelector('button[type="submit"]')!);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      content: 'hello world',
      objectId: 'post-1',
      objectType: 'post'
    })));
  });

  it('refuses to submit an empty or whitespace-only comment', async () => {
    renderForm();
    await userEvent.type(textarea(), '   ');
    await userEvent.click(document.querySelector('button[type="submit"]')!);

    await waitFor(() => expect(textarea()).toHaveValue('   '));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('clears the field after a successful submit', async () => {
    renderForm();
    await userEvent.type(textarea(), 'done');
    await userEvent.click(document.querySelector('button[type="submit"]')!);

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    await waitFor(() => expect(textarea()).toHaveValue(''));
  });

  it('carries the reply target and object type through', async () => {
    renderForm({
      objectType: 'comment',
      objectId: 'comment-9',
      isReply: true,
      replyTarget: { _id: 'comment-9', content: 'parent', user: { name: 'Bob' } }
    });

    expect(screen.getByText(/Reply to @Bob/)).toBeInTheDocument();

    await userEvent.type(textarea(), 'answering');
    await userEvent.click(document.querySelector('button[type="submit"]')!);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      objectId: 'comment-9',
      objectType: 'comment',
      content: 'answering'
    })));
  });

  it('appends an emoji to what is already written', async () => {
    renderForm();
    await userEvent.type(textarea(), 'nice');
    await userEvent.click(screen.getAllByRole('button')[1]);

    const emoji = await screen.findByText('😀');
    await userEvent.click(emoji);

    await waitFor(() => expect(textarea().value).toContain('😀'));
    expect(textarea().value).toContain('nice');
  });

  it('disables every control for a signed-out viewer', () => {
    render(<CommentForm objectId="post-1" creator={{} as any} onSubmit={onSubmit} />);

    expect(textarea()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Mention someone' })).toBeDisabled();
  });

  it('does not open the picker for a signed-out viewer', async () => {
    render(<CommentForm objectId="post-1" creator={{} as any} onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole('button', { name: 'Mention someone' }));

    expect(picker()).not.toBeInTheDocument();
    expect(mockFollowings).not.toHaveBeenCalled();
  });
});
