import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import { ANIMATED_IMAGE_FILES, REAL_IMAGE_HEADERS } from '../../hooks/__fixtures__/image-headers';

import CommentForm from './comment-form';

/**
 * The one image a comment may carry, from the composer's side.
 *
 * The rules worth defending: a comment needs text or an image; replacing one is
 * confirmed before anything is thrown away; and every path that lets an image go
 * cleans up both the local preview and the uploaded file.
 */

const mockUpload = jest.fn();
const mockDiscard = jest.fn();

jest.mock('@services/comment.service', () => ({
  uploadCommentImage: (...args: any[]) => mockUpload(...args),
  discardCommentImage: (...args: any[]) => mockDiscard(...args)
}));

jest.mock('@services/user.service', () => ({
  searchUsers: jest.fn().mockResolvedValue({ data: { data: [] } })
}));

const mockToastError = jest.fn();
// The shared package, not `react-toastify` directly: the app's only container
// is registered with a `containerId`, so a bare react-toastify call renders
// nothing at all.
jest.mock('@douyin-clone/shared-toast', () => ({
  toast: { error: (...args: any[]) => mockToastError(...args), success: jest.fn(), info: jest.fn() }
}));

const revoked: string[] = [];
beforeAll(() => {
  // jsdom has neither, and the hook is explicitly responsible for both.
  (URL as any).createObjectURL = jest.fn(() => `blob:preview-${Math.random()}`);
  (URL as any).revokeObjectURL = jest.fn((url: string) => revoked.push(url));
});

const creator = { _id: 'creator-1', username: 'creator' } as any;

function renderForm(onSubmit = jest.fn()) {
  render(<CommentForm objectId="post-1" creator={creator} onSubmit={onSubmit} isLoggedIn />);
  return { onSubmit };
}

/**
 * A real PNG signature followed by a real IHDR, so the composer's checks see a
 * genuine header.
 *
 * The signature alone is no longer enough: the composer reads the picture's
 * dimensions out of the same bytes, and a header with no IHDR describes a 0x0
 * image — which it correctly refuses. These say 64x48.
 */
const PNG_SIGNATURE = [
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, // IHDR length
  0x49, 0x48, 0x44, 0x52, // "IHDR"
  0x00, 0x00, 0x00, 0x40, // width  = 64
  0x00, 0x00, 0x00, 0x30 // height = 48
];

/**
 * A file the composer will actually look inside.
 *
 * The bytes are real rather than filler: the composer sniffs the header before
 * uploading, so a fixture made of `'x'` would be rejected — and one that jsdom
 * cannot slice would skip the check altogether and quietly stop testing it.
 */
const imageFile = (name = 'photo.png', type = 'image/png', size = 1024) => {
  const body = new Uint8Array([...PNG_SIGNATURE, ...new Array(Math.max(0, size - PNG_SIGNATURE.length)).fill(0x41)]);
  const file = new File([body], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  (file as any).slice = (start: number, end: number) => ({
    arrayBuffer: async () => body.slice(start, end).buffer
  });
  return file;
};

/** Bytes that are definitely not a picture, whatever the file is called. */
const notAnImage = (name = 'clip.png', type = 'image/png') => {
  const body = new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]);
  const file = new File([body], name, { type });
  Object.defineProperty(file, 'size', { value: body.length });
  (file as any).slice = (start: number, end: number) => ({
    arrayBuffer: async () => body.slice(start, end).buffer
  });
  return file;
};

const fileInput = () => screen.getByTestId('comment-image-input') as HTMLInputElement;
const textarea = () => screen.getByPlaceholderText('Add comment...') as HTMLTextAreaElement;
const submitButton = () => screen.getByRole('button', { name: 'Post comment' });

async function pick(file: File) {
  await act(async () => {
    await userEvent.upload(fileInput(), file);
  });
}

beforeEach(() => {
  revoked.length = 0;
  mockUpload.mockReset();
  mockDiscard.mockReset();
  mockToastError.mockReset();
  mockUpload.mockResolvedValue({ data: { _id: 'file-1' } });
  mockDiscard.mockResolvedValue({});
});

describe('attaching an image to a comment', () => {
  it('shows a preview once an image is chosen', async () => {
    renderForm();
    await pick(imageFile());

    expect(await screen.findByTestId('comment-image-preview')).toBeInTheDocument();
    await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(1));
  });

  it('keeps the text the author already typed', async () => {
    renderForm();
    await userEvent.type(textarea(), 'look at this');
    await pick(imageFile());

    await screen.findByTestId('comment-image-preview');
    expect(textarea().value).toBe('look at this');
  });

  it('submits text and the image together', async () => {
    const { onSubmit } = renderForm();
    await userEvent.type(textarea(), 'nice one');
    await pick(imageFile());
    await waitFor(() => expect(mockUpload).toHaveBeenCalled());

    await act(async () => { await userEvent.click(submitButton()); });

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      content: 'nice one', imageId: 'file-1'
    });
  });

  it('submits an image with no text at all', async () => {
    const { onSubmit } = renderForm();
    await pick(imageFile());
    await waitFor(() => expect(mockUpload).toHaveBeenCalled());

    await act(async () => { await userEvent.click(submitButton()); });

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].imageId).toBe('file-1');
    expect(onSubmit.mock.calls[0][0].content).toBe('');
  });

  it('refuses to submit with neither text nor image', async () => {
    const { onSubmit } = renderForm();

    expect(submitButton()).toBeDisabled();
    await act(async () => { await userEvent.click(submitButton()); });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('will not submit while the upload is still running', async () => {
    // Posting now would reference a file that does not exist yet.
    let resolveUpload: (value: any) => void = () => { };
    mockUpload.mockReturnValue(new Promise((resolve) => { resolveUpload = resolve; }));

    const { onSubmit } = renderForm();
    await pick(imageFile());

    await screen.findByTestId('comment-image-uploading');
    expect(submitButton()).toBeDisabled();

    await act(async () => { resolveUpload({ data: { _id: 'file-1' } }); });
    await waitFor(() => expect(submitButton()).not.toBeDisabled());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('does not upload a video', async () => {
    renderForm();
    const video = new File(['x'], 'clip.mp4', { type: 'video/mp4' });

    // Set directly rather than through `userEvent.upload`, which honours the
    // `accept` filter and would never deliver the file. Bypassing it is the
    // point: `accept` is a hint to the picker, and the code behind it still has
    // to refuse what a non-conforming client hands over.
    await act(async () => {
      Object.defineProperty(fileInput(), 'files', { value: [video], configurable: true });
      fireEvent.change(fileInput());
    });

    // Rejected before an upload is spent on it; the real check is still the
    // server inspecting the bytes. Nothing is held either — a file that can
    // never be sent must not sit in the composer looking like an attachment.
    expect(mockUpload).not.toHaveBeenCalled();
    expect(screen.queryByTestId('comment-image-preview')).not.toBeInTheDocument();
    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Invalid image format'));
  });

  it('reports an oversized image without uploading it', async () => {
    renderForm();
    await pick(imageFile('huge.png', 'image/png', 11 * 1024 * 1024));

    expect(mockUpload).not.toHaveBeenCalled();
    expect(screen.queryByTestId('comment-image-preview')).not.toBeInTheDocument();
    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith(
      expect.stringContaining('10MB')
    ));
  });

  it('an invalid pick does not turn the next one into a replacement', async () => {
    // The composer was left holding the rejected file, so choosing a good one
    // afterwards asked whether to replace something that was never attached.
    renderForm();
    await pick(imageFile('huge.png', 'image/png', 11 * 1024 * 1024));
    await pick(imageFile('fine.png'));

    expect(screen.queryByText('Replace the current image?')).not.toBeInTheDocument();
    await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(1));
    expect(await screen.findByTestId('comment-image-preview')).toBeInTheDocument();
  });

  it('shows friendly wording when the upload fails', async () => {
    mockUpload.mockRejectedValue(new Error('E11000 at /srv/uploads/x.png'));
    renderForm();
    await pick(imageFile());

    const error = await screen.findByTestId('comment-image-error');
    expect(error.textContent).toContain('could not be uploaded');
    expect(error.textContent).not.toContain('srv');
  });
});

describe('the composer keeps its original shape', () => {
  it('stays a single row with nothing attached', () => {
    renderForm();

    const row = textarea().parentElement!;
    // The original one-line input: text and actions share a row, and the
    // composer keeps the height it has always had.
    expect(row.className).toContain('items-center');
    expect(row.className).not.toContain('flex-col');
    expect(screen.queryByTestId('comment-image-preview')).not.toBeInTheDocument();
  });

  it('keeps the toolbar inline when nothing is attached', () => {
    renderForm();

    const toolbar = screen.getByTestId('comment-toolbar');
    // Same parent as the textarea means the same row.
    expect(toolbar.parentElement).toBe(textarea().parentElement);
  });

  it('adds exactly one row when an image is attached', async () => {
    renderForm();
    await pick(imageFile());
    await screen.findByTestId('comment-image-preview');

    const row = textarea().parentElement!;
    expect(row.className).toContain('flex-col');
    // Thumbnail and actions share the row beneath the text rather than becoming
    // two more stacked blocks.
    const preview = screen.getByTestId('comment-image-preview');
    const toolbar = screen.getByTestId('comment-toolbar');
    expect(preview.parentElement).toBe(toolbar.parentElement);
  });

  it('puts the thumbnail on the left of that row and the actions on the right', async () => {
    renderForm();
    await pick(imageFile());
    await screen.findByTestId('comment-image-preview');

    const preview = screen.getByTestId('comment-image-preview');
    const toolbar = screen.getByTestId('comment-toolbar');
    expect(
      // eslint-disable-next-line no-bitwise
      preview.compareDocumentPosition(toolbar) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(preview.parentElement!.className).toContain('justify-between');
  });

  it('keeps the thumbnail small', async () => {
    renderForm();
    await pick(imageFile());
    await screen.findByTestId('comment-image-preview');

    // 60px — large enough to recognise, small enough that the composer grows by
    // one modest row rather than becoming a panel.
    const frame = screen.getByTestId('comment-image-preview').firstElementChild!;
    const classes = frame.className.split(' ');
    expect(classes).toContain('h-15');
    expect(classes).toContain('w-15');
  });

  it('puts the text box above the image preview', async () => {
    renderForm();
    await pick(imageFile());
    await screen.findByTestId('comment-image-preview');

    const preview = screen.getByTestId('comment-image-preview');
    // The attachment used to sit above the text box, where it read as belonging
    // to whatever was above the composer rather than to this comment.
    expect(
      // eslint-disable-next-line no-bitwise
      textarea().compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('puts the toolbar below the preview', async () => {
    renderForm();
    await pick(imageFile());
    await screen.findByTestId('comment-image-preview');

    const preview = screen.getByTestId('comment-image-preview');
    const send = submitButton();
    expect(
      // eslint-disable-next-line no-bitwise
      preview.compareDocumentPosition(send) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('orders the toolbar image, mention, emoji, send', () => {
    renderForm();

    const labels = ['Attach an image', 'Mention someone', 'Add an emoji', 'Post comment'];
    const positions = labels.map((label) => {
      const button = screen.getByRole('button', { name: label });
      return [...document.querySelectorAll('button')].indexOf(button);
    });

    // Strictly increasing means the rendered order matches the intended one.
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(new Set(positions).size).toBe(4);
  });

  it('shows no preview area at all with nothing attached', () => {
    renderForm();
    expect(screen.queryByTestId('comment-image-preview')).not.toBeInTheDocument();
  });
});

describe('removing a pending image', () => {
  it('drops the image and keeps the text', async () => {
    renderForm();
    await userEvent.type(textarea(), 'still here');
    await pick(imageFile());
    await waitFor(() => expect(mockUpload).toHaveBeenCalled());

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Remove image' }));
    });

    await waitFor(() => expect(screen.queryByTestId('comment-image-preview')).not.toBeInTheDocument());
    expect(textarea().value).toBe('still here');
  });

  it('discards the uploaded file and revokes the preview', async () => {
    renderForm();
    await pick(imageFile());
    await waitFor(() => expect(mockUpload).toHaveBeenCalled());

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Remove image' }));
    });

    await waitFor(() => expect(mockDiscard).toHaveBeenCalledWith('file-1'));
    expect(revoked.length).toBeGreaterThan(0);
  });

  it('keeps the delete control small and tucked into the corner', async () => {
    // A 28px ringed badge covered a third of a 60px thumbnail. The visible
    // control is 16px; the hit area is widened by a pseudo-element instead, so
    // it stays easy to hit without taking more of the picture.
    renderForm();
    await pick(imageFile());
    await screen.findByTestId('comment-image-preview');

    const remove = screen.getByTestId('comment-image-remove');
    const classes = remove.className.split(/\s+/);
    expect(classes).toContain('h-4');
    expect(classes).toContain('w-4');
    expect(remove.className).toContain('before:-inset-1');
    expect(remove.className).toContain('absolute');
  });

  it('hides the control without reserving space for it', async () => {
    // Opacity, not conditional rendering: revealing it must not nudge the
    // thumbnail underneath.
    renderForm();
    await pick(imageFile());
    await screen.findByTestId('comment-image-preview');

    const remove = screen.getByTestId('comment-image-remove');
    expect(remove.className).toContain('opacity-0');
    expect(remove.className).toContain('group-hover/preview:opacity-100');
    expect(remove.className).toContain('group-focus-within/preview:opacity-100');
    // Absolutely positioned, so it is outside the thumbnail's own flow.
    expect(remove.className).toContain('absolute');
  });

  it('labels the delete control and keeps it reachable by keyboard', async () => {
    renderForm();
    await pick(imageFile());
    await screen.findByTestId('comment-image-preview');

    const remove = screen.getByRole('button', { name: 'Remove image' });
    // Present in the tree rather than conditionally rendered on hover, so it can
    // be tabbed to — hover-only would exclude keyboard and touch users.
    expect(remove).toBeInTheDocument();
    remove.focus();
    expect(document.activeElement).toBe(remove);
  });

  it('renders the chosen image, not a placeholder', async () => {
    renderForm();
    await pick(imageFile('holiday.jpg', 'image/jpeg'));
    await screen.findByTestId('comment-image-preview');

    const img = screen.getByTestId('comment-image-preview').querySelector('img')!;
    // The real object URL for the selected file, filled rather than letterboxed
    // — a thumbnail this small reads better cropped, matching the reference.
    expect(img.getAttribute('src')).toMatch(/^blob:/);
    expect(img.className).toContain('object-cover');
    expect(img.getAttribute('alt')).toBe('holiday.jpg');
  });

  it('does not open the picker or submit anything', async () => {
    const { onSubmit } = renderForm();
    await pick(imageFile());
    await waitFor(() => expect(mockUpload).toHaveBeenCalled());

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Remove image' }));
    });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(mockUpload).toHaveBeenCalledTimes(1);
  });

  it('lets a new image be chosen afterwards with no dialog', async () => {
    renderForm();
    await pick(imageFile());
    await waitFor(() => expect(mockUpload).toHaveBeenCalled());
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Remove image' }));
    });
    await waitFor(() => expect(screen.queryByTestId('comment-image-preview')).not.toBeInTheDocument());

    await pick(imageFile('second.png'));

    // Nothing is being replaced, so nothing is asked.
    expect(screen.queryByText('Replace the current image?')).not.toBeInTheDocument();
    await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(2));
  });
});

describe('choosing a second image', () => {
  const pickSecond = async () => {
    renderForm();
    await pick(imageFile('first.png'));
    await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(1));
    mockUpload.mockResolvedValue({ data: { _id: 'file-2' } });
    await pick(imageFile('second.png'));
  };

  it('asks before replacing', async () => {
    await pickSecond();

    expect(await screen.findByText('Replace the current image?')).toBeInTheDocument();
    // The old image is still attached and the new one has not been uploaded.
    expect(mockUpload).toHaveBeenCalledTimes(1);
  });

  it('cancelling keeps the first image and uploads nothing', async () => {
    await pickSecond();
    await screen.findByText('Replace the current image?');

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    });

    await waitFor(() => expect(screen.queryByText('Replace the current image?')).not.toBeInTheDocument());
    expect(screen.getByTestId('comment-image-preview')).toBeInTheDocument();
    // Nothing was uploaded for the candidate, so there is nothing to discard.
    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(mockDiscard).not.toHaveBeenCalled();
  });

  it('replacing uploads the new image and discards the old one', async () => {
    await pickSecond();
    await screen.findByText('Replace the current image?');

    await act(async () => {
      await userEvent.click(screen.getByTestId('comment-image-replace-confirm'));
    });

    await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(2));
    // The old file is cleaned from the server, not merely forgotten.
    await waitFor(() => expect(mockDiscard).toHaveBeenCalledWith('file-1'));
  });

  it('keeps the old image when the new one fails', async () => {
    renderForm();
    await pick(imageFile('first.png'));
    await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(1));

    mockUpload.mockRejectedValue(new Error('upload failed'));
    await pick(imageFile('second.png'));
    await screen.findByText('Replace the current image?');

    await act(async () => {
      await userEvent.click(screen.getByTestId('comment-image-replace-confirm'));
    });

    // Nothing was discarded, because nothing successfully took its place.
    await waitFor(() => expect(screen.queryByText('Replace the current image?')).not.toBeInTheDocument());
    expect(mockDiscard).not.toHaveBeenCalledWith('file-1');
  });

  it('keeps the text through a replacement', async () => {
    renderForm();
    await userEvent.type(textarea(), 'my words');
    await pick(imageFile('first.png'));
    await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(1));
    mockUpload.mockResolvedValue({ data: { _id: 'file-2' } });
    await pick(imageFile('second.png'));
    await screen.findByText('Replace the current image?');

    await act(async () => {
      await userEvent.click(screen.getByTestId('comment-image-replace-confirm'));
    });

    await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(2));
    expect(textarea().value).toBe('my words');
  });
});

describe('after a successful send', () => {
  it('clears the composer without deleting the attached file', async () => {
    // The file belongs to the comment now. Discarding it here is exactly the
    // late cleanup the server exists to refuse.
    const { onSubmit } = renderForm();
    await userEvent.type(textarea(), 'done');
    await pick(imageFile());
    await waitFor(() => expect(mockUpload).toHaveBeenCalled());

    await act(async () => { await userEvent.click(submitButton()); });

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId('comment-image-preview')).not.toBeInTheDocument());
    expect(textarea().value).toBe('');
    expect(mockDiscard).not.toHaveBeenCalled();
  });

  it('revokes the preview it was holding', async () => {
    const { onSubmit } = renderForm();
    await pick(imageFile());
    await waitFor(() => expect(mockUpload).toHaveBeenCalled());

    await act(async () => { await userEvent.click(submitButton()); });

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(revoked.length).toBeGreaterThan(0);
  });
});

describe('a comment carrying only an image', () => {
  it('sends with no text at all', async () => {
    mockUpload.mockResolvedValue({ data: { _id: 'file-only' } });
    const onSubmit = jest.fn().mockResolvedValue({ _id: 'comment-1' });
    renderForm(onSubmit);

    await pick(imageFile());
    await waitFor(() => expect(screen.getByTestId('comment-image-preview')).toBeInTheDocument());

    // The text box is untouched, which is the whole case: an image on its own
    // is a comment, and used to be refused as an empty one after its file had
    // already been uploaded and stored.
    expect(textarea().value).toBe('');
    expect(submitButton()).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(submitButton());
    });

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const sent = onSubmit.mock.calls[0][0];
    expect(sent.imageId).toBe('file-only');
    expect(sent.content).toBe('');
  });

  it('refuses to send when there is neither text nor an image', async () => {
    const onSubmit = jest.fn();
    renderForm(onSubmit);

    expect(submitButton()).toBeDisabled();
    await act(async () => {
      fireEvent.submit(textarea().closest('form') as HTMLFormElement);
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('will not send while the upload is still running', async () => {
    let finish: (value: any) => void = () => undefined;
    mockUpload.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const onSubmit = jest.fn();
    renderForm(onSubmit);

    await pick(imageFile());
    await waitFor(() => expect(screen.getByTestId('comment-image-uploading')).toBeInTheDocument());
    // No id yet, so there is nothing to reference — posting now would create a
    // comment pointing at a file that may never exist.
    expect(submitButton()).toBeDisabled();

    await act(async () => {
      finish({ data: { _id: 'file-late' } });
    });
    await waitFor(() => expect(submitButton()).not.toBeDisabled());
  });
});

describe('when the comment cannot be created', () => {
  it('keeps the text and the image so the attempt can be retried', async () => {
    mockUpload.mockResolvedValue({ data: { _id: 'file-keep' } });
    // `null` is how the list reports "not created" — see the composer's
    // onSubmit contract.
    const onSubmit = jest.fn().mockResolvedValue(null);
    renderForm(onSubmit);

    await pick(imageFile());
    await waitFor(() => expect(screen.getByTestId('comment-image-preview')).toBeInTheDocument());
    await act(async () => {
      await userEvent.type(textarea(), 'worth keeping');
    });

    await act(async () => {
      fireEvent.click(submitButton());
    });

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(textarea().value).toBe('worth keeping');
    expect(screen.getByTestId('comment-image-preview')).toBeInTheDocument();
    // The file belongs to nothing yet, but it is the draft the author still
    // has — discarding it here would delete the picture they can see.
    expect(mockDiscard).not.toHaveBeenCalled();
  });

  it('still clears when the comment is created', async () => {
    mockUpload.mockResolvedValue({ data: { _id: 'file-sent' } });
    const onSubmit = jest.fn().mockResolvedValue({ _id: 'comment-2' });
    renderForm(onSubmit);

    await pick(imageFile());
    await waitFor(() => expect(screen.getByTestId('comment-image-preview')).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(submitButton());
    });

    await waitFor(() => expect(screen.queryByTestId('comment-image-preview')).not.toBeInTheDocument());
    expect(textarea().value).toBe('');
    expect(mockDiscard).not.toHaveBeenCalled();
  });
});

describe('picking a file that is not an image', () => {
  it('says so and uploads nothing', async () => {
    renderForm();
    await pick(notAnImage());

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Invalid image format'));
    expect(mockUpload).not.toHaveBeenCalled();
    expect(screen.queryByTestId('comment-image-preview')).not.toBeInTheDocument();
  });

  it('keeps the image already attached and raises no replace dialog', async () => {
    mockUpload.mockResolvedValue({ data: { _id: 'file-first' } });
    renderForm();

    await pick(imageFile('first.png'));
    await waitFor(() => expect(screen.getByTestId('comment-image-preview')).toBeInTheDocument());
    mockUpload.mockClear();

    await pick(notAnImage('second.png'));

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Invalid image format'));
    // The dialog is about discarding something. Nothing is being discarded, so
    // there is nothing to ask about.
    expect(screen.queryByTestId('comment-image-replace-confirm')).not.toBeInTheDocument();
    expect(screen.getByTestId('comment-image-preview')).toBeInTheDocument();
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockDiscard).not.toHaveBeenCalled();
  });

  it('lets the same file be picked again after a rejection', async () => {
    renderForm();
    await pick(notAnImage());
    await waitFor(() => expect(mockToastError).toHaveBeenCalled());
    // Cleared, or the browser fires no change event for an identical pick and
    // the second attempt silently does nothing.
    expect(fileInput().value).toBe('');
  });

  it('reports the server refusing a file the browser let through', async () => {
    const refused: Error & { code?: string } = new Error('rejected');
    refused.code = 'INVALID_COMMENT_IMAGE_FORMAT';
    mockUpload.mockRejectedValue(refused);
    renderForm();

    await pick(imageFile());

    await waitFor(() => expect(screen.getByTestId('comment-image-error')).toHaveTextContent('Invalid image format'));
    expect(submitButton()).toBeDisabled();
  });
});

/**
 * Replacing an image with one the composer can already tell is too large.
 *
 * The replace dialog asks a destructive question — "throw away the picture you
 * chose?" — so it must never be asked about a file that was never going to be
 * accepted. AVIF and HEIC are the formats where that used to happen: their size
 * lives in a nested ISO-BMFF box, the client did not read it, and an oversized
 * one therefore reached the dialog.
 *
 * The rule underneath is stronger than the dialog, and holds however the
 * rejection arrives: the attached image is not let go until its replacement has
 * been confirmed good.
 */
describe('replacing an image with an oversized AVIF or HEIC', () => {
  /** A real file from the shared fixtures, sliceable the way the hook reads it. */
  const fixtureFile = (name: string, filename: string, type: string) => {
    const bytes = Buffer.from(REAL_IMAGE_HEADERS[name], 'base64');
    const file = new File([bytes], filename, { type });
    Object.defineProperty(file, 'size', { value: bytes.length });
    (file as any).slice = (start: number, end: number) => ({
      arrayBuffer: async () => Uint8Array.from(bytes).slice(start, end).buffer
    });
    (file as any).arrayBuffer = async () => Uint8Array.from(bytes).buffer;
    return file;
  };

  /** Attach a valid image and return once its preview is on screen. */
  const attachFirstImage = async () => {
    mockUpload.mockResolvedValue({ data: { _id: 'file-first' } });
    renderForm();
    await pick(imageFile('first.png'));
    await waitFor(() => expect(screen.getByTestId('comment-image-preview')).toBeInTheDocument());
    mockUpload.mockClear();
    mockDiscard.mockClear();
    revoked.length = 0;
  };

  it.each([
    ['AVIF', 'avif_13000x100', 'wide.avif', 'image/avif'],
    ['HEIC', 'heic_13000x100', 'wide.heic', 'image/heic']
  ])('refuses an oversized %s without opening the replace dialog', async (_label, fixture, filename, type) => {
    await attachFirstImage();

    await pick(fixtureFile(fixture, filename, type));

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Image resolution is too large'));
    // Nothing is being discarded, so there is nothing to ask about.
    expect(screen.queryByTestId('comment-image-replace-confirm')).not.toBeInTheDocument();
    // No upload means no durable record and no bytes on disk to reclaim.
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockDiscard).not.toHaveBeenCalled();
  });

  it('refuses a frame flood without opening the replace dialog either', async () => {
    // The other format the client can measure ahead of the dialog: a GIF's frame
    // count is only knowable by walking it, and 301 frames is over the limit
    // while being unremarkable in every other way.
    const bytes = Buffer.from(ANIMATED_IMAGE_FILES.gif_4x4_301frames, 'base64');
    const flood = new File([bytes], 'flood.gif', { type: 'image/gif' });
    Object.defineProperty(flood, 'size', { value: bytes.length });
    (flood as any).slice = (start: number, end: number) => ({
      arrayBuffer: async () => Uint8Array.from(bytes).slice(start, end).buffer
    });
    (flood as any).arrayBuffer = async () => Uint8Array.from(bytes).buffer;

    await attachFirstImage();
    await pick(flood);

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Image resolution is too large'));
    expect(screen.queryByTestId('comment-image-replace-confirm')).not.toBeInTheDocument();
    expect(screen.getByTestId('comment-image-preview')).toBeInTheDocument();
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockDiscard).not.toHaveBeenCalled();
  });

  it('leaves the attached image and its draft exactly as they were', async () => {
    await attachFirstImage();
    const before = (screen.getByTestId('comment-image-preview') as HTMLImageElement).src;
    await userEvent.type(textarea(), 'my caption');

    await pick(fixtureFile('avif_13000x100', 'wide.avif', 'image/avif'));
    await waitFor(() => expect(mockToastError).toHaveBeenCalled());

    expect((screen.getByTestId('comment-image-preview') as HTMLImageElement).src).toBe(before);
    expect(textarea().value).toBe('my caption');
    // The preview URL is still live — revoking it would blank the thumbnail of
    // an image the author never agreed to let go.
    expect(revoked).not.toContain(before);
  });

  it('still sends the original image afterwards', async () => {
    const onSubmit = jest.fn().mockResolvedValue({});
    mockUpload.mockResolvedValue({ data: { _id: 'file-first' } });
    render(<CommentForm objectId="post-1" creator={creator} onSubmit={onSubmit} isLoggedIn />);
    await pick(imageFile('first.png'));
    await waitFor(() => expect(screen.getByTestId('comment-image-preview')).toBeInTheDocument());

    await pick(fixtureFile('heic_13000x100', 'wide.heic', 'image/heic'));
    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Image resolution is too large'));

    await userEvent.type(textarea(), 'still here');
    await act(async () => {
      fireEvent.submit(textarea().closest('form') as HTMLFormElement);
    });

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ content: 'still here', imageId: 'file-first' });
  });

  it('keeps the first image when only the server can tell the second is too large', async () => {
    // The case the client cannot pre-judge: a picture inside every limit it can
    // measure, refused once the decoder counts what it really holds. The dialog
    // is right to open here — and the original still must not be let go until
    // the replacement has actually succeeded.
    await attachFirstImage();
    const refused: Error & { code?: string } = new Error('too large');
    refused.code = 'COMMENT_IMAGE_DIMENSIONS_EXCEEDED';
    mockUpload.mockRejectedValue(refused);

    await pick(imageFile('second.png'));
    await waitFor(() => expect(screen.getByTestId('comment-image-replace-confirm')).toBeInTheDocument());
    await act(async () => {
      await userEvent.click(screen.getByTestId('comment-image-replace-confirm'));
    });

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Image resolution is too large'));
    expect(screen.getByTestId('comment-image-preview')).toBeInTheDocument();
    // The original file is still the composer's, so nothing about it is discarded.
    expect(mockDiscard).not.toHaveBeenCalledWith('file-first');
  });
});
