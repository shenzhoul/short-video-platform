import { MailMessage } from 'src/common/interfaces/mailer';

import {
  escapeHtml, humaniseMinutes, renderLayout, renderText, siteName
} from './layout';

export interface ResetPasswordTemplateParams {
  to: string;
  name: string;
  resetUrl: string;
  ttlMinutes: number;
}

/**
 * "Reset your password."
 *
 * Same rules as the verification template — no password, no internal
 * identifiers, the token only inside the URL — with one addition that is
 * specific to recovery: the message says plainly that **nothing has changed
 * yet**.
 *
 * That sentence is the whole security value of this email for somebody who did
 * not request it. Without it, a recipient reads "reset your password" as "your
 * password was reset" and panics; with it, ignoring the message is obviously the
 * right response, which is exactly what we want them to do.
 */
export function renderResetPassword(params: ResetPasswordTemplateParams): MailMessage {
  const site = siteName();
  const validFor = humaniseMinutes(params.ttlMinutes);
  const greeting = params.name?.trim() ? `Hi ${params.name.trim()},` : 'Hi,';

  const bodyHtml = `
    <p style="margin:0 0 12px;">${escapeHtml(greeting)}</p>
    <p style="margin:0 0 12px;">Somebody asked to reset the password for your ${escapeHtml(site)} account. Choose a new one with the button below.</p>
    <p style="margin:0;">This link is valid for <strong>${escapeHtml(validFor)}</strong> and can be used once.</p>
  `.trim();

  const footnoteHtml = `
    If you did not ask for this, ignore this email — <strong>your password has not been changed</strong> and nobody can change it without this link.
  `.trim();

  return {
    to: params.to,
    subject: `Reset your ${site} password`,
    html: renderLayout({
      preheader: `Choose a new password for your ${site} account. This link expires in ${validFor}.`,
      heading: 'Reset your password',
      bodyHtml,
      action: { label: 'Choose a new password', url: params.resetUrl },
      footnoteHtml
    }),
    text: renderText([
      greeting,
      '',
      `Somebody asked to reset the password for your ${site} account.`,
      'Choose a new one here:',
      '',
      params.resetUrl,
      '',
      `This link is valid for ${validFor} and can be used once.`,
      '',
      'If you did not ask for this, ignore this email. Your password has not been changed',
      'and nobody can change it without this link.'
    ])
  };
}
