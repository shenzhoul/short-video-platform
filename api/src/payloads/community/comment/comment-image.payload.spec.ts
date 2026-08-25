// The sanitiser pulls jsdom in, which the API's node test environment cannot
// load. Sanitising is covered by its own tests; what matters here is the
// validation contract, so the decorator is reduced to a pass-through.
jest.mock('src/common/decorators/sanitize-html.decorator', () => ({
  SanitizeHtmlStrict: () => () => undefined
}));

// eslint-disable-next-line import/first
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ObjectId } from 'mongodb';

import { CommentCreatePayload } from './comment.payload';

/**
 * What the edge accepts before anything reaches a service.
 *
 * Text and image are each optional and the pair is not: a comment with neither
 * is an empty row that renders as nothing. And "at most one image" is enforced
 * by the shape of the field itself — a single id — rather than by a length check
 * somebody could forget to apply.
 */
async function errorsFor(input: Record<string, any>) {
  const payload = plainToInstance(CommentCreatePayload, {
    objectType: 'post',
    objectId: new ObjectId().toString(),
    ...input
  });
  const errors = await validate(payload as any);
  return errors.map((error) => error.property);
}

describe('CommentCreatePayload', () => {
  it('accepts text on its own', async () => {
    expect(await errorsFor({ content: 'just words' })).toEqual([]);
  });

  it('accepts an image on its own', async () => {
    expect(await errorsFor({ imageId: new ObjectId().toString() })).toEqual([]);
  });

  it('accepts text and an image together', async () => {
    expect(await errorsFor({
      content: 'look at this', imageId: new ObjectId().toString()
    })).toEqual([]);
  });

  it('refuses a comment with neither', async () => {
    const errors = await errorsFor({});
    expect(errors).toContain('hasContent');
  });

  it('refuses whitespace as if it were empty', async () => {
    // Otherwise a spacebar would post a blank row.
    const errors = await errorsFor({ content: '   \n  ' });
    expect(errors).toContain('hasContent');
  });

  it('refuses two image ids', async () => {
    // The field is one id, so an array cannot satisfy it. "At most one" is the
    // shape of the contract rather than a rule to remember.
    const errors = await errorsFor({
      imageId: [new ObjectId().toString(), new ObjectId().toString()] as any
    });
    expect(errors).toContain('imageId');
  });

  it('refuses an image id that is not an id', async () => {
    expect(await errorsFor({ imageId: '../../etc/passwd' })).toContain('imageId');
  });

  it('refuses an object where an id belongs', async () => {
    expect(await errorsFor({ imageId: { $ne: null } as any })).toContain('imageId');
  });

  it('still enforces the text limit', async () => {
    expect(await errorsFor({ content: 'x'.repeat(1001) })).toContain('content');
  });
});
