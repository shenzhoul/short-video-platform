import { HttpException } from '@nestjs/common';
import { assertPostMediaReady } from './post-media-readiness.util';

/** Minimal stand-in for the file-server record shape this reads. */
const file = (processingStatus?: string) => ({ processingStatus }) as any;

/**
 * The publish-time media invariant behind recommendation eligibility
 * (rules/instructions §4). Enforced once, where a post's media set is
 * decided, so no feed — recommendation or otherwise — has to carry a
 * readiness clause and none of the five candidate sources can drift from
 * the others.
 */
describe('assertPostMediaReady', () => {
  it('allows a post whose media all finished processing', () => {
    expect(() => assertPostMediaReady(
      [file('completed'), file('completed')],
      ['f1', 'f2']
    )).not.toThrow();
  });

  it('allows media the pipeline legitimately skipped (already in a served format)', () => {
    expect(() => assertPostMediaReady([file('skipped')], ['f1'])).not.toThrow();
  });

  it('allows a file predating the field, which has no processing status at all', () => {
    expect(() => assertPostMediaReady([file(undefined)], ['f1'])).not.toThrow();
  });

  it('allows a text post with no media', () => {
    expect(() => assertPostMediaReady([], [])).not.toThrow();
  });

  it('refuses media still pending', () => {
    expect(() => assertPostMediaReady([file('completed'), file('pending')], ['f1', 'f2']))
      .toThrow(HttpException);
  });

  it('refuses media still processing', () => {
    expect(() => assertPostMediaReady([file('processing')], ['f1'])).toThrow(HttpException);
  });

  it('refuses media whose processing failed, with its own distinct message', () => {
    // "Wait a moment" is useless advice for something that will never finish.
    let failedMessage = '';
    try {
      assertPostMediaReady([file('failed')], ['f1']);
    } catch (error: any) {
      failedMessage = error.message;
    }

    let pendingMessage = '';
    try {
      assertPostMediaReady([file('pending')], ['f1']);
    } catch (error: any) {
      pendingMessage = error.message;
    }

    expect(failedMessage).toBeTruthy();
    expect(pendingMessage).toBeTruthy();
    expect(failedMessage).not.toBe(pendingMessage);
  });

  it('reports failure ahead of not-ready when a post has one of each', () => {
    // The unrecoverable problem is the one worth telling the author about.
    let message = '';
    try {
      assertPostMediaReady([file('pending'), file('failed')], ['f1', 'f2']);
    } catch (error: any) {
      message = error.message;
    }
    // Asserted on the locale key rather than the English text: `__t` falls
    // back to the key outside a request context, and the key is the stable
    // contract anyway.
    expect(message).toBe('errors.post_media_processing_failed');
  });

  it('refuses a dangling reference — an id that resolved to no file at all', () => {
    // Two ids asked for, one record came back: the post would publish
    // pointing at media that does not exist.
    expect(() => assertPostMediaReady([file('completed')], ['f1', 'f2'])).toThrow(HttpException);
  });

  it('refuses an unknown processing state rather than assuming it means ready', () => {
    // A newer file-server introducing a state this does not know about must
    // fail closed, not publish a post on a guess.
    expect(() => assertPostMediaReady([file('quarantined')], ['f1'])).toThrow(HttpException);
  });

  it('answers with a 400, not a 500 — this is the author\'s input to correct', () => {
    try {
      assertPostMediaReady([file('pending')], ['f1']);
      throw new Error('should have thrown');
    } catch (error: any) {
      expect(error.getStatus()).toBe(400);
    }
  });
});
