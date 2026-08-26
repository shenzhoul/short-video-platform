import { act, renderHook, waitFor } from '@testing-library/react';

jest.mock('@services/post.service', () => ({
  findById: jest.fn(),
  update: jest.fn(),
  uploadThumbnail: jest.fn()
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() })
}));

jest.mock('@douyin-clone/shared-toast', () => ({
  toast: { success: jest.fn(), error: jest.fn() }
}));

jest.mock('@lib/utils', () => ({
  showErrorMessage: jest.fn()
}));

jest.mock('@lib/post-mentions', () => ({
  resolveMentionedUserIds: jest.fn().mockResolvedValue([])
}));

import { findById, update as updatePost } from '@services/post.service';
import { usePostEdit } from './use-post-edit';

const mockedFindById = findById as jest.MockedFunction<typeof findById>;
const mockedUpdatePost = updatePost as jest.MockedFunction<typeof updatePost>;

const editablePost = (overrides: Record<string, any> = {}) => ({
  _id: 'post-1',
  type: 'video',
  status: 'active',
  title: 'Diving',
  text: 'A diving trip',
  fileIds: ['file-1'],
  files: [{ _id: 'file-1', type: 'video/mp4', url: 'http://x/v.mp4', thumbnails: [] }],
  topicKey: 'travel',
  coverDisplayRatio: '4:3',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides
});

/**
 * The edit screen has no category control. It must therefore say nothing about the category, so the
 * API's "field absent means leave it alone" branch is what applies — including when the post's
 * category has since been disabled, which resending the key would turn into a failed caption edit.
 */
describe('usePostEdit category handling', () => {
  beforeEach(() => {
    mockedUpdatePost.mockResolvedValue({ data: {} } as any);
  });

  const loadAndSubmit = async (post: Record<string, any>) => {
    mockedFindById.mockResolvedValue({ data: post } as any);

    const { result } = renderHook(() => usePostEdit('post-1'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.setTitle('Diving, updated');
    });

    await act(async () => {
      await result.current.handleSave();
    });

    await waitFor(() => expect(mockedUpdatePost).toHaveBeenCalledTimes(1));
    return mockedUpdatePost.mock.calls[0][1] as Record<string, any>;
  };

  it('omits topicKey entirely from the update payload', async () => {
    const payload = await loadAndSubmit(editablePost());

    expect(payload).not.toHaveProperty('topicKey');
  });

  it('still sends the fields this screen actually edits', async () => {
    const payload = await loadAndSubmit(editablePost());

    expect(payload).toMatchObject({
      type: 'video',
      status: 'active',
      title: 'Diving, updated'
    });
  });

  it('omits topicKey even for a post filed under a category an admin has since disabled', async () => {
    // The creator cannot see or change the category here, so a disabled one must not make the
    // caption edit fail. Sending nothing is what keeps the API from revalidating a dead key.
    const payload = await loadAndSubmit(editablePost({ topicKey: 'retired-category' }));

    expect(payload).not.toHaveProperty('topicKey');
    expect(mockedUpdatePost).toHaveBeenCalledTimes(1);
  });

  it('does not expose category state for a caller to wire a control to', async () => {
    mockedFindById.mockResolvedValue({ data: editablePost() } as any);

    const { result } = renderHook(() => usePostEdit('post-1'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current).not.toHaveProperty('topicKey');
    expect(result.current).not.toHaveProperty('setTopicKey');
  });
});
