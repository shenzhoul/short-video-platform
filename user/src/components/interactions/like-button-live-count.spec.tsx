import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import LikeButton from './like-button';

jest.mock('@services/reaction.service', () => ({
  toggleReaction: jest.fn()
}));

jest.mock('src/providers/profile.provider', () => ({
  useProfile: () => ({ loggedIn: true })
}));

jest.mock('@lib/utils', () => ({
  showErrorMessage: jest.fn()
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { toggleReaction } = require('@services/reaction.service');

/**
 * A live count belongs to everybody; the filled heart belongs to one viewer.
 *
 * The two were reset together, so a stranger liking the same comment pushed a
 * new total in, the shared effect re-ran, and it also reset `isLiked` back to
 * whatever the row was fetched with — silently un-filling the heart of somebody
 * who had just liked it themselves.
 */
function renderButton(props: Record<string, any> = {}) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <LikeButton
        contentType="comment"
        contentId="c1"
        showCount
        renderIcon={({ isLiked }: any) => <span data-testid="heart">{isLiked ? 'filled' : 'empty'}</span>}
        renderCount={(total: number) => <span data-testid="count">{total}</span>}
        {...props}
      />
    </QueryClientProvider>
  );
  return { ...view, client };
}

describe('LikeButton with a live total', () => {
  beforeEach(() => {
    (toggleReaction as jest.Mock).mockReset();
  });

  it('keeps this viewer\'s like when somebody else\'s like changes the total', async () => {
    (toggleReaction as jest.Mock).mockResolvedValue({ data: { action: 'added' } });

    const { rerender, client } = renderButton({ initialIsLiked: false, initialTotalLikes: 5 });

    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(screen.getByTestId('heart').textContent).toBe('filled'));

    // A snapshot arrives because a stranger also liked it: the total moves, and
    // `initialIsLiked` — this viewer's own state — does not.
    rerender(
      <QueryClientProvider client={client}>
        <LikeButton
          contentType="comment"
          contentId="c1"
          showCount
          initialIsLiked={false}
          initialTotalLikes={7}
          renderIcon={({ isLiked }: any) => <span data-testid="heart">{isLiked ? 'filled' : 'empty'}</span>}
          renderCount={(total: number) => <span data-testid="count">{total}</span>}
        />
      </QueryClientProvider>
    );

    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('7'));
    // The heart must still be this viewer's.
    expect(screen.getByTestId('heart').textContent).toBe('filled');
  });

  it('does adopt a genuine change to whether this viewer liked it', async () => {
    const { rerender, client } = renderButton({ initialIsLiked: false, initialTotalLikes: 1 });

    rerender(
      <QueryClientProvider client={client}>
        <LikeButton
          contentType="comment"
          contentId="c1"
          showCount
          initialIsLiked
          initialTotalLikes={1}
          renderIcon={({ isLiked }: any) => <span data-testid="heart">{isLiked ? 'filled' : 'empty'}</span>}
          renderCount={(total: number) => <span data-testid="count">{total}</span>}
        />
      </QueryClientProvider>
    );

    await waitFor(() => expect(screen.getByTestId('heart').textContent).toBe('filled'));
  });

  it('shows the authoritative total rather than adding the server echo to its own guess', async () => {
    // The optimistic +1 and the snapshot that already counts it must not sum.
    (toggleReaction as jest.Mock).mockResolvedValue({ data: { action: 'added' } });

    const { rerender, client } = renderButton({ initialIsLiked: false, initialTotalLikes: 4 });

    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('5'));

    rerender(
      <QueryClientProvider client={client}>
        <LikeButton
          contentType="comment"
          contentId="c1"
          showCount
          initialIsLiked={false}
          initialTotalLikes={5}
          renderIcon={({ isLiked }: any) => <span data-testid="heart">{isLiked ? 'filled' : 'empty'}</span>}
          renderCount={(total: number) => <span data-testid="count">{total}</span>}
        />
      </QueryClientProvider>
    );

    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('5'));
  });
});
