import { MailMessage } from 'src/common/interfaces/mailer';

import {
  escapeHtml, humaniseMinutes, renderLayout, renderText, siteName
} from './layout';

export interface VerifyEmailTemplateParams {
  to: string;
  /** Display name, used only to open the message. Never an internal id. */
  name: string;
  verifyUrl: string;
  ttlMinutes: number;
}

/**
 * "Confirm your email address."
 *
 * What is deliberately **not** in here:
 *
 * - the password, in any form;
 * - any internal identifier — no `userId`, no token id, no database key. A
 *   recipient who forwards this email should not be handing over anything about
 *   how the system is put together;
 * - the bare token as text. It appears once, inside the URL, because a link has
 *   to contain it. Printing it separately would invite somebody to paste it
 *   somewhere it gets logged.
 *
 * The "if you didn't sign up" line matters more than it looks: this address may
 * belong to somebody who never asked, because anybody can type any address into
 * a signup form. Telling them to ignore it is the correct instruction — the
 * account cannot be used until this link is followed.
 */
export function renderVerifyEmail(params: VerifyEmailTemplateParams): MailMessage {
  const site = siteName();
  const validFor = humaniseMinutes(params.ttlMinutes);
  const greeting = params.name?.trim() ? `Hi ${params.name.trim()},` : 'Hi,';

  const bodyHtml = `
    <p style="margin:0 0 12px;">${escapeHtml(greeting)}</p>
    <p style="margin:0 0 12px;">Confirm this address to finish setting up your ${escapeHtml(site)} account. You will not be able to log in until you do.</p>
    <p style="margin:0;">This link is valid for <strong>${escapeHtml(validFor)}</strong>.</p>
  `.trim();

  const footnoteHtml = `
    If you did not create a ${escapeHtml(site)} account, you can ignore this email — nothing will happen and the address will not be used.
  `.trim();

  return {
    to: params.to,
    subject: `Confirm your email address for ${site}`,
    html: renderLayout({
      preheader: `Confirm your email address to finish setting up your ${site} account.`,
      heading: 'Confirm your email address',
      bodyHtml,
      action: { label: 'Confirm email address', url: params.verifyUrl },
      footnoteHtml
    }),
    text: renderText([
      greeting,
      '',
      `Confirm this address to finish setting up your ${site} account.`,
      'You will not be able to log in until you do.',
      '',
      params.verifyUrl,
      '',
      `This link is valid for ${validFor}.`,
      '',
      `If you did not create a ${site} account, you can ignore this email.`
    ])
  };
}
