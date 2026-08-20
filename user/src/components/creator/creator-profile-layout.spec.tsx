import { act, render, screen } from '@testing-library/react';
import React from 'react';

import CreatorProfileHeader from './creator-profile-header';
import { MessageWorkspaceProvider } from '../../providers/message-workspace.provider';

/**
 * The profile hero shares its row with the message workspace, which is where the
 * two regressions came from: the action buttons wrapped onto a second row, and
 * the cover was narrowed along with the content and left a gap under the header.
 *
 * These tests pin the two structural contracts behind that layout:
 *
 * - the four actions stay one group, in one order, whether the workspace is open
 *   or closed — the workspace must never rearrange or drop an action;
 * - the workspace width applies to the hero *content* and not to the cover, so
 *   the cover artwork stays full-bleed behind the header.
 *
 * They deliberately assert structure, not pixels. Widths are measured for real
 * in the browser, where a layout engine exists.
 */

jest.mock('next-auth/react', () => ({
  useSession: () => ({ status: 'authenticated', data: { user: { _id: 'me' } } })
}));

jest.mock('next/navigation', () => ({
  usePathname: () => '/blueice',
  useRouter: () => ({ push: jest.fn() })
}));

const openConversationWith = jest.fn();
jest.mock('@providers/message.provider', () => ({
  useMessages: () => ({ hasUnread: false, openConversationWith })
}));

jest.mock('@hooks/use-follow-creator', () => ({
  useFollowCreator: () => ({ isFollowed: false, following: false, toggleFollow: jest.fn() })
}));

// The cover owns file uploads and its own preview state; here it only needs to
// be locatable so we can assert what it is *not* nested inside.
jest.mock('@components/shared/cover-upload', () => ({
  __esModule: true,
  default: () => <div data-testid="profile-cover" />
}));

jest.mock('@components/creator/creator-profile-bio', () => ({
  __esModule: true,
  default: () => <div />
}));

jest.mock('@components/creator/creator-profile-follower-following', () => ({
  __esModule: true,
  default: () => null
}));

jest.mock('@components/ui/hover-reveal-panel', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}));

const creator = {
  _id: 'creator-1',
  username: 'blueice',
  name: 'Jiang Shiyi',
  stats: { totalFollower: 0, totalFollowing: 0, totalLike: 0 }
} as never;

const currentUser = { _id: 'me', username: 'devuser' } as never;

function renderProfileHeader() {
  return render(
    <MessageWorkspaceProvider>
      <CreatorProfileHeader
        creator={creator}
        currentUser={currentUser}
        canEditProfile={false}
        previewName="Jiang Shiyi"
        previewBio=""
        previewAvatar="/avatar.png"
        previewCover="/cover.png"
        previewCoverBgColor="#000"
        onOpenEdit={jest.fn()}
        onOpenAvatarPreview={jest.fn()}
        onPreviewCoverChange={jest.fn()}
        onPreviewCoverBgColorChange={jest.fn()}
      />
    </MessageWorkspaceProvider>
  );
}

/**
 * The element carrying the message-workspace width contract.
 *
 * Found by scanning class names rather than with an attribute selector: the
 * class is an arbitrary Tailwind value containing brackets and parentheses,
 * which jsdom's selector parser will not match reliably.
 */
function findWidthContractElement(container: HTMLElement): HTMLElement | null {
  return Array.from(container.querySelectorAll<HTMLElement>('*'))
    .find(el => el.className
      && typeof el.className === 'string'
      && el.className.includes('var(--message-workspace-width')) ?? null;
}

/** The action group as the DOM sees it, in visual (source) order. */
function readActionGroup(): string[] {
  const message = screen.getByLabelText('Message this creator');
  // The Message button and the Follow button are siblings; the download block
  // sits beside that pair inside the shared `ml-auto` row.
  const group = message.parentElement?.parentElement as HTMLElement;
  return Array.from(group.querySelectorAll('button, a, div'))
    .map(el => (el.getAttribute('aria-label') || el.textContent || '').trim())
    .filter(text => /^(Follow|Following|Message this creator|Download the PC client|Download)$/.test(text));
}

beforeEach(() => {
  openConversationWith.mockReset();
});

describe('profile action row', () => {
  it('keeps the four actions in one group, in order', () => {
    renderProfileHeader();

    expect(readActionGroup()).toEqual([
      'Follow',
      'Message this creator',
      'Download the PC client',
      'Download'
    ]);
  });

  it('does not rearrange or drop an action when the workspace opens', async () => {
    renderProfileHeader();
    const before = readActionGroup();

    await act(async () => { screen.getByLabelText('Message this creator').click(); });

    expect(readActionGroup()).toEqual(before);
    expect(screen.getByLabelText('Message this creator')).toBeInTheDocument();
  });

  it('opens the conversation with this creator', async () => {
    renderProfileHeader();

    await act(async () => { screen.getByLabelText('Message this creator').click(); });

    expect(openConversationWith).toHaveBeenCalledWith('creator-1');
  });
});

describe('profile width contract', () => {
  it('applies the workspace width to the hero content', () => {
    const { container } = renderProfileHeader();

    const constrained = findWidthContractElement(container);
    expect(constrained).not.toBeNull();
    expect(constrained).toContainElement(screen.getByLabelText('Message this creator'));
  });

  it('leaves the cover outside the constrained content', () => {
    const { container } = renderProfileHeader();

    const constrained = findWidthContractElement(container) as HTMLElement;
    expect(constrained).not.toBeNull();
    expect(constrained).not.toContainElement(screen.getByTestId('profile-cover'));
  });
});
