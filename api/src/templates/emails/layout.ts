import { SETTING_KEYS } from 'src/common/constants/system';
import { SettingService } from 'src/services/system/setting/setting.service';

/**
 * Shared chrome for every transactional email, plus the escaping every template
 * depends on.
 *
 * Plain TypeScript functions rather than a template engine. Two templates do not
 * justify a rendering dependency, and a function that returns a string is
 * something a unit test can call directly and assert on — including asserting
 * that a hostile display name does not escape into markup.
 */

/**
 * Escape for HTML text and double-quoted attribute contexts.
 *
 * Every interpolation in every template goes through this. A display name is
 * user-controlled: somebody who signs up as `<img src=x onerror=…>` must not get
 * that rendered in a mail client that executes it, and must not be able to break
 * out of an `href="…"`.
 */
export function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** The product name, as it appears in subjects and body copy. */
export function siteName(): string {
  return SettingService.getValueByKey(SETTING_KEYS.SITE_NAME) || 'Douyin Clone';
}

/**
 * Render a duration in minutes as something a person reads without converting.
 * "1440 minutes" is technically the same information as "24 hours" and is
 * useless in a sentence.
 */
export function humaniseMinutes(minutes: number): string {
  if (minutes % (24 * 60) === 0) {
    const days = minutes / (24 * 60);
    return days === 1 ? '24 hours' : `${days} days`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? '1 hour' : `${hours} hours`;
  }
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

export interface LayoutParts {
  /** Short summary shown in the inbox preview line, before the body is opened. */
  preheader: string;
  heading: string;
  /** Already-escaped HTML for the message body, above the button. */
  bodyHtml: string;
  action: { label: string; url: string };
  /** Already-escaped HTML shown under the button. */
  footnoteHtml: string;
}

/**
 * Wrap a message body in the shared shell.
 *
 * Table-based layout with inline styles, which is not how anybody would write a
 * web page and is exactly how email has to be written: Outlook and several
 * webmail clients strip `<style>` blocks and have no meaningful flexbox support.
 *
 * Deliberately light on styling — no logo fetch, no web font, no external asset
 * of any kind. Remote images in a transactional email are blocked by default in
 * most clients, and a message whose meaning depends on one is a message that
 * arrives broken.
 */
export function renderLayout(parts: LayoutParts): string {
  const name = escapeHtml(siteName());
  const year = new Date().getFullYear();

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(parts.heading)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(parts.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 12px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;padding:32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#18181b;">
    <tr><td style="font-size:15px;font-weight:600;color:#ff2f5f;padding-bottom:24px;">${name}</td></tr>
    <tr><td style="font-size:21px;font-weight:700;line-height:1.3;padding-bottom:16px;">${escapeHtml(parts.heading)}</td></tr>
    <tr><td style="font-size:15px;line-height:1.6;color:#3f3f46;">${parts.bodyHtml}</td></tr>
    <tr><td style="padding:28px 0;">
      <a href="${escapeHtml(parts.action.url)}" style="display:inline-block;background:#ff2f5f;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:13px 26px;border-radius:8px;">${escapeHtml(parts.action.label)}</a>
    </td></tr>
    <tr><td style="font-size:13px;line-height:1.6;color:#71717a;">
      If the button does not work, copy this address into your browser:<br>
      <span style="word-break:break-all;color:#3f3f46;">${escapeHtml(parts.action.url)}</span>
    </td></tr>
    <tr><td style="font-size:13px;line-height:1.6;color:#71717a;padding-top:20px;border-top:1px solid #e4e4e7;margin-top:20px;">
      ${parts.footnoteHtml}
    </td></tr>
    <tr><td style="font-size:12px;color:#a1a1aa;padding-top:24px;">© ${year} ${name}</td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
}

/** Assemble the plain-text alternative. */
export function renderText(lines: string[]): string {
  return `${lines.filter((line) => line !== null && line !== undefined).join('\n')}\n`;
}
