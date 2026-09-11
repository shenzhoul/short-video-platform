/**
 * The account menu's post previews under "I like it" and "My work".
 *
 * The menu owns no data of its own: it calls the profile's `useLikedPosts` and
 * `useCreatorPostSearch` with menu-sized options. Those hooks are wrapped (not
 * replaced) below so the tests can prove that, while every request still goes
 * through the real hook logic to the mocked service.
 *
 * What is pinned is behaviour a person sees: which section is open, which way it
 * enters, that only one is ever on screen, that moving between them never costs
 * a request, that reopening re-reads both lists, that one account's posts never
 * show for another, and that a tile opens the real post detail.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import type { IPost } from '@interfaces/post';

const push = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push })
}));

jest.mock('@providers/auth-modal.provider', () => ({
  useAuthModal: () => ({ openAuthModal: jest.fn() })
}));
jest.mock('@providers/follow-list.provider', () => ({
  useFollowListModal: () => ({ openFollowList: jest.fn() })
}));
jest.mock('@hooks/use-follow-stats', () => ({
  useFollowStats: () => ({ followersCount: 2, followingCount: 5 })
}));
jest.mock('@hooks/use-logout', () => ({
  useLogout: () => ({ logout: jest.fn(), loggingOut: false })
}));
const toastError = jest.fn();
jest.mock('@douyin-clone/shared-toast', () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args), success: jest.fn(), info: jest.fn(), warning: jest.fn()
  }
}));

const likedPosts = jest.fn();
const getCreatorPosts = jest.fn();
jest.mock('@services/post.service', () => ({
  likedPosts: (...args: unknown[]) => likedPosts(...args),
  unlikePosts: jest.fn(),
  getCreatorPosts: (...args: unknown[]) => getCreatorPosts(...args),
  myPosts: jest.fn(),
  deletePost: jest.fn(),
  pinPost: jest.fn(),
  unpinPost: jest.fn()
}));

/* The profile hooks themselves, observed rather than replaced. */
const likedHookCalls: unknown[] = [];
jest.mock('@hooks/use-liked-posts', () => {
  const actual = jest.requireActual('@hooks/use-liked-posts');
  return {
    ...actual,
    useLikedPosts: (options: unknown) => {
      likedHookCalls.push(options);
      return actual.useLikedPosts(options);
    }
  };
});
const creatorHookCalls: unknown[] = [];
jest.mock('@hooks/use-creator-post-search', () => {
  const actual = jest.requireActual('@hooks/use-creator-post-search');
  return {
    ...actual,
    useCreatorPostSearch: (options: unknown) => {
      creatorHookCalls.push(options);
      return actual.useCreatorPostSearch(options);
    }
  };
});

/* eslint-disable import/first */
import { __clearPostInteractionListenersForTest, publishPostInteraction } from '@lib/post-interaction-bus';

import UserAccountDropdown from './user-account-dropdown';
/* eslint-enable import/first */

const post = (id: string, title: string): IPost => ({
  _id: id,
  title,
  text: title,
  type: 'photo',
  cover3x4Url: `https://cdn.example/${id}.jpg`,
  files: [],
  user: { _id: 'creator-x', username: 'creator-x' }
} as unknown as IPost);

const page = (posts: IPost[], total: number) => ({
  data: {
    data: posts, total, hasMore: total > posts.length, nextCursor: null
  }
});

const ada = { _id: 'user-ada', username: 'ada', name: 'Ada', stats: { totalPosts: 9 } } as any;
const bo = { _id: 'user-bo', username: 'bo', name: 'Bo', stats: { totalPosts: 1 } } as any;

const LIKED = [post('liked-1', 'Liked yesterday'), post('liked-2', 'Liked last week'), post('liked-3', 'Liked last month')];
const WORKS = [post('work-1', 'Newest work'), post('work-2', 'Older work'), post('work-3', 'Oldest work')];

function renderMenu(user: any = ada) {
  const utils = render(<UserAccountDropdown loggedIn={Boolean(user)} user={user} />);
  const rerenderWith = (nextUser: any) => utils.rerender(
    <UserAccountDropdown loggedIn={Boolean(nextUser)} user={nextUser} />
  );
  return { ...utils, rerenderWith };
}

const likedRow = () => screen.getByRole('button', { name: /I like it/ });
const worksRow = () => screen.getByRole('button', { name: /My work/ });
const regions = () => screen.queryAllByRole('region');
const tiles = (region: HTMLElement) => within(region).queryAllByRole('button', { name: /^Open post/ });
const strip = (region: HTMLElement) => region.querySelector('[data-account-menu-strip]') as HTMLElement;

async function openMenu(user = userEvent.setup(), name = 'Ada') {
  await user.hover(screen.getByRole('button', { name }));
  await screen.findByRole('region', { name: 'I like it' });
  return user;
}

async function closeMenu(user: ReturnType<typeof userEvent.setup>, name = 'Ada') {
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(regions()).toHaveLength(0));
  await user.unhover(screen.getByRole('button', { name }));
}

beforeEach(() => {
  push.mockReset();
  likedPosts.mockReset();
  getCreatorPosts.mockReset();
  toastError.mockReset();
  likedHookCalls.length = 0;
  creatorHookCalls.length = 0;
  __clearPostInteractionListenersForTest();
  likedPosts.mockResolvedValue(page(LIKED, 67));
  getCreatorPosts.mockResolvedValue(page(WORKS, 12));
});

describe('account menu previews', () => {
  it('reads both previews through the profile hooks, with menu-sized options', async () => {
    renderMenu();
    await openMenu();

    expect(likedHookCalls).toContainEqual({ enabled: true, limit: 3, notifyOnError: false });
    expect(creatorHookCalls).toContainEqual({
      creatorId: 'user-ada', limit: 3, creatorOrder: 'latest', notifyOnError: false
    });
    await waitFor(() => expect(getCreatorPosts).toHaveBeenCalledTimes(1));
    expect(likedPosts).toHaveBeenCalledTimes(1);
    expect(likedPosts).toHaveBeenCalledWith({ limit: 3 });
    expect(getCreatorPosts).toHaveBeenCalledWith('user-ada', { limit: 3, creatorOrder: 'latest' });
  });

  it('opens on "I like it" with only the liked preview, entering from above', async () => {
    renderMenu();
    await openMenu();

    const liked = await screen.findByRole('region', { name: 'I like it' });
    await waitFor(() => expect(tiles(liked)).toHaveLength(3));
    expect(regions()).toHaveLength(1);
    expect(likedRow()).toHaveAttribute('aria-expanded', 'true');
    expect(likedRow()).toHaveAttribute('aria-controls', liked.id);
    expect(worksRow()).toHaveAttribute('aria-expanded', 'false');
    expect(strip(liked)).toHaveClass('account-menu-strip', 'account-menu-strip--from-above');
    expect(liked).toHaveClass('account-menu-reveal');
    expect(tiles(liked).map((tile) => tile.getAttribute('aria-label'))).toEqual([
      'Open post: Liked yesterday',
      'Open post: Liked last week',
      'Open post: Liked last month'
    ]);
  });

  it('shows the real collection sizes, not the number of posts previewed', async () => {
    renderMenu();
    await openMenu();

    await waitFor(() => expect(likedRow()).toHaveTextContent('67'));
    await waitFor(() => expect(worksRow()).toHaveTextContent('12'));
  });

  it('hovering "My work" closes the liked preview and brings works up from below', async () => {
    renderMenu();
    const user = await openMenu();

    await user.hover(worksRow());

    const works = screen.getByRole('region', { name: 'My work' });
    expect(screen.queryByRole('region', { name: 'I like it' })).not.toBeInTheDocument();
    expect(regions()).toHaveLength(1);
    expect(strip(works)).toHaveClass('account-menu-strip--from-below');
    expect(works).not.toHaveClass('account-menu-reveal');
    expect(worksRow()).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => expect(tiles(works)).toHaveLength(3));
  });

  it('every switch mounts a new strip element, so the entrance restarts each time', async () => {
    renderMenu();
    const user = await openMenu(userEvent.setup({ delay: null }));
    const seen = new Set<HTMLElement>([strip(screen.getByRole('region', { name: 'I like it' }))]);

    for (let round = 0; round < 10; round += 1) {
      // eslint-disable-next-line no-await-in-loop
      await user.hover(worksRow());
      seen.add(strip(screen.getByRole('region', { name: 'My work' })));
      // eslint-disable-next-line no-await-in-loop
      await user.hover(likedRow());
      seen.add(strip(screen.getByRole('region', { name: 'I like it' })));
      expect(regions()).toHaveLength(1);
    }

    // 1 initial + 20 switches, each a distinct element.
    expect(seen.size).toBe(21);
  }, 30000);

  it('never has two previews open and never requests again while switching back and forth', async () => {
    renderMenu();
    const user = await openMenu(userEvent.setup({ delay: null }));
    await waitFor(() => expect(getCreatorPosts).toHaveBeenCalledTimes(1));

    for (let round = 0; round < 10; round += 1) {
      // eslint-disable-next-line no-await-in-loop
      await user.hover(worksRow());
      expect(regions()).toHaveLength(1);
      // eslint-disable-next-line no-await-in-loop
      await user.hover(likedRow());
      expect(regions()).toHaveLength(1);
    }

    expect(likedPosts).toHaveBeenCalledTimes(1);
    expect(getCreatorPosts).toHaveBeenCalledTimes(1);
  }, 30000);

  it('keeps a section open while the pointer moves onto its posts, and passes the rows in between without switching', async () => {
    renderMenu();
    const user = await openMenu();
    await user.hover(worksRow());
    const works = screen.getByRole('region', { name: 'My work' });
    await waitFor(() => expect(tiles(works)).toHaveLength(3));

    await user.hover(tiles(works)[1]);
    await user.hover(screen.getByRole('button', { name: /Watch history/ }));

    expect(screen.getByRole('region', { name: 'My work' })).toBeInTheDocument();
    expect(regions()).toHaveLength(1);
  });

  it('switches with keyboard focus as well as the pointer', async () => {
    renderMenu();
    await openMenu();

    act(() => { worksRow().focus(); });
    expect(screen.getByRole('region', { name: 'My work' })).toBeInTheDocument();
    act(() => { likedRow().focus(); });
    expect(screen.getByRole('region', { name: 'I like it' })).toBeInTheDocument();
    expect(regions()).toHaveLength(1);
  });

  it('reopening starts on "I like it" and re-reads both lists, so changes made elsewhere show', async () => {
    renderMenu();
    const user = await openMenu();
    await user.hover(worksRow());
    await waitFor(() => expect(getCreatorPosts).toHaveBeenCalledTimes(1));
    await closeMenu(user);

    // A like and a new post happened somewhere else while the menu was closed.
    likedPosts.mockResolvedValue(page([post('liked-new', 'Just liked'), ...LIKED.slice(0, 2)], 68));
    getCreatorPosts.mockResolvedValue(page([post('work-new', 'Just published'), ...WORKS.slice(0, 2)], 13));
    await user.hover(screen.getByRole('button', { name: 'Ada' }));

    const liked = await screen.findByRole('region', { name: 'I like it' });
    expect(screen.queryByRole('region', { name: 'My work' })).not.toBeInTheDocument();
    expect(likedPosts).toHaveBeenCalledTimes(2);
    expect(getCreatorPosts).toHaveBeenCalledTimes(2);
    await within(liked).findByRole('button', { name: 'Open post: Just liked' });
    await waitFor(() => expect(likedRow()).toHaveTextContent('68'));
    await waitFor(() => expect(worksRow()).toHaveTextContent('13'));
    expect(tiles(liked)).toHaveLength(3);
  });

  it('scales the image inside a clipped, fixed-shape frame, so a hovered tile cannot push its neighbours', async () => {
    renderMenu();
    await openMenu();
    const liked = screen.getByRole('region', { name: 'I like it' });
    await waitFor(() => expect(tiles(liked)).toHaveLength(3));

    const image = tiles(liked)[0].querySelector('img') as HTMLImageElement;
    expect(image).toHaveClass('group-hover/tile:scale-[1.04]', 'duration-[160ms]');
    expect(image.parentElement).toHaveClass('overflow-hidden', 'aspect-[3/4]');
    expect(liked.querySelector('video')).toBeNull();
  });

  it('opens the post through the shared modal_id address and closes the menu', async () => {
    renderMenu();
    const user = await openMenu();
    await user.hover(worksRow());
    const works = screen.getByRole('region', { name: 'My work' });
    await waitFor(() => expect(tiles(works)).toHaveLength(3));

    await user.click(tiles(works)[0]);

    expect(push).toHaveBeenCalledWith('/?modal_id=work-1');
    await waitFor(() => expect(regions()).toHaveLength(0));
  });

  it('a touch tap on "My work" navigates instead of switching the preview under the finger', async () => {
    renderMenu();
    const user = await openMenu();

    await user.pointer({ keys: '[TouchA]', target: worksRow() });

    expect(push).toHaveBeenCalledWith('/ada?tab=works');
    expect(screen.queryByRole('region', { name: 'My work' })).not.toBeInTheDocument();
  });

  it('keeps the row click going to the profile tab', async () => {
    renderMenu();
    const user = await openMenu();

    await user.click(worksRow());

    expect(push).toHaveBeenCalledWith('/ada?tab=works');
  });

  it('never shows the previous account’s previews after switching accounts', async () => {
    const { rerenderWith } = renderMenu();
    const user = await openMenu();
    await waitFor(() => expect(tiles(screen.getByRole('region', { name: 'I like it' }))).toHaveLength(3));
    await closeMenu(user);

    let resolveBo: (value: unknown) => void = () => undefined;
    likedPosts.mockImplementation(() => new Promise((resolve) => { resolveBo = resolve; }));
    rerenderWith(bo);
    await user.hover(screen.getByRole('button', { name: 'Bo' }));

    const pending = await screen.findByRole('region', { name: 'I like it' });
    expect(screen.queryByRole('button', { name: /Liked yesterday/ })).not.toBeInTheDocument();
    expect(within(pending).getByRole('list')).toHaveAttribute('aria-busy', 'true');
    await waitFor(() => expect(getCreatorPosts).toHaveBeenLastCalledWith('user-bo', { limit: 3, creatorOrder: 'latest' }));

    await act(async () => { resolveBo(page([post('bo-like', 'Bo liked this')], 1)); });
    expect(await screen.findByRole('button', { name: 'Open post: Bo liked this' })).toBeInTheDocument();
  });

  it('draws skeletons while loading, a message when empty, and an inline retry after an error without a toast', async () => {
    let resolveLiked: (value: unknown) => void = () => undefined;
    likedPosts.mockImplementationOnce(() => new Promise((resolve) => { resolveLiked = resolve; }));
    getCreatorPosts.mockRejectedValueOnce(new Error('offline'));
    const user = userEvent.setup();
    renderMenu();
    await user.hover(screen.getByRole('button', { name: 'Ada' }));

    const liked = await screen.findByRole('region', { name: 'I like it' });
    expect(within(liked).getByRole('list')).toHaveAttribute('aria-busy', 'true');
    await act(async () => { resolveLiked(page([], 0)); });
    expect(await within(liked).findByText('No liked posts yet')).toBeInTheDocument();

    await user.hover(worksRow());
    const works = screen.getByRole('region', { name: 'My work' });
    const retry = await within(works).findByRole('button', { name: 'Try again' });
    expect(toastError).not.toHaveBeenCalled();
    await user.click(retry);
    await waitFor(() => expect(tiles(screen.getByRole('region', { name: 'My work' }))).toHaveLength(3));
    expect(getCreatorPosts).toHaveBeenCalledTimes(2);
  });

  it('removes a post unliked anywhere in the app from the open preview, and ignores posts it does not hold', async () => {
    renderMenu();
    await openMenu();
    const liked = screen.getByRole('region', { name: 'I like it' });
    await waitFor(() => expect(tiles(liked)).toHaveLength(3));
    await waitFor(() => expect(likedRow()).toHaveTextContent('67'));

    act(() => { publishPostInteraction('some-other-post', { isLiked: false, totalLike: 9 }); });
    expect(likedRow()).toHaveTextContent('67');

    act(() => { publishPostInteraction('liked-1', { isLiked: false, totalLike: 3 }); });

    await waitFor(() => expect(screen.queryByRole('button', { name: /Liked yesterday/ })).not.toBeInTheDocument());
    expect(likedRow()).toHaveTextContent('66');
  });

  it('requests nothing and shows no preview for a signed-out visitor', async () => {
    const user = userEvent.setup();
    renderMenu(null);

    await user.hover(screen.getByRole('button', { name: /Login/ }));

    expect(await screen.findByRole('button', { name: /My liking/ })).toBeInTheDocument();
    expect(regions()).toHaveLength(0);
    expect(likedPosts).not.toHaveBeenCalled();
    expect(getCreatorPosts).not.toHaveBeenCalled();
  });
});
