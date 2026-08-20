import { render, screen } from '@testing-library/react';
import React from 'react';

import MessageComposer from './message-composer';
import MessageRestrictionNotice from './message-restriction-notice';

/**
 * The two things a restricted thread must get right.
 *
 * The notice follows the server's `requestState`, not the follow relation:
 * once a request has been answered both people may write freely even though
 * they still do not follow each other, and a notice keyed on `isMutualFollow`
 * stayed up forever describing a rule that no longer applied.
 *
 * The composer keeps one contained action group in every state. It used to be
 * replaced wholesale while the sender waited, which produced a second detached
 * box at the bottom of the panel saying almost the same thing as the notice.
 */

describe('restriction notice', () => {
  it('is shown while a request is unanswered', () => {
    render(<MessageRestrictionNotice requestState="waiting" awaitingReplyFrom="me" />);

    expect(screen.getByText(/only send one message until they reply/i)).toBeInTheDocument();
  });

  it('is shown before the first message, to explain the rule', () => {
    render(<MessageRestrictionNotice requestState="idle" awaitingReplyFrom={null} />);

    expect(screen.getByText(/until you follow each other/i)).toBeInTheDocument();
  });

  it('disappears once the request is accepted', () => {
    const { container } = render(
      <MessageRestrictionNotice requestState="accepted" awaitingReplyFrom={null} />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('stays hidden for the sender whose request was just accepted', () => {
    // `awaitingReplyFrom` can still read 'me' from a stale render; the state is
    // what decides, so this must not bring the notice back.
    const { container } = render(
      <MessageRestrictionNotice requestState="accepted" awaitingReplyFrom="me" />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('says nothing to mutual followers', () => {
    const { container } = render(
      <MessageRestrictionNotice requestState="mutual" awaitingReplyFrom={null} />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('says nothing before the conversation is known', () => {
    const { container } = render(
      <MessageRestrictionNotice requestState={null} awaitingReplyFrom={null} />
    );

    expect(container).toBeEmptyDOMElement();
  });
});

describe('composer containment', () => {
  const renderComposer = (canSend: boolean, awaiting: 'me' | 'them' | null) => render(
    <MessageComposer
      canSend={canSend}
      sending={false}
      awaitingReplyFrom={awaiting}
      onSend={jest.fn().mockResolvedValue(true)}
    />
  );

  it('puts the text area and one action group on the same surface', () => {
    renderComposer(true, null);

    const surface = screen.getByTestId('message-composer-surface');
    const actions = screen.getByTestId('message-composer-actions');

    expect(surface).toContainElement(actions);
    expect(surface).toContainElement(screen.getByLabelText('Message'));
    expect(actions).toContainElement(screen.getByLabelText('Attach photo or video'));
    expect(actions).toContainElement(screen.getByLabelText('Send message'));
  });

  it('keeps the same single surface while the sender is waiting', () => {
    renderComposer(false, 'me');

    expect(screen.getAllByTestId('message-composer-surface')).toHaveLength(1);
    expect(screen.getByTestId('message-composer-surface'))
      .toContainElement(screen.getByTestId('message-composer-actions'));
  });

  it('disables the controls while waiting instead of removing them', () => {
    renderComposer(false, 'me');

    expect(screen.getByLabelText('Message')).toBeDisabled();
    expect(screen.getByLabelText('Attach photo or video')).toBeDisabled();
    expect(screen.getByLabelText('Send message')).toBeDisabled();
  });

  it('does not repeat the restriction copy underneath the input', () => {
    renderComposer(false, 'me');

    expect(screen.queryByText(/one message until they reply/i)).not.toBeInTheDocument();
  });

  it('leaves the recipient of a request able to answer', () => {
    renderComposer(true, 'them');

    expect(screen.getByLabelText('Message')).not.toBeDisabled();
  });
});
