'use client';

import type { ComponentType } from 'react';
import { CommentIcon, LikePostIcon, TagIcon } from 'src/icons';

import type { NotificationIconKind } from './notification-presentation';

/**
 * The badge drawn over a notification's avatar.
 *
 * Maps the resolved icon kind to a component, so notification *types* are still
 * branched on in `notification-presentation.ts` alone. A row whose type resolves
 * to no kind renders no badge at all — that decision belongs to the caller, not
 * to a placeholder drawn here.
 *
 * The icons are self-contained gradient discs of a uniform size, so all badges
 * share their placement, background, radius and glyph colour by construction.
 */
const ICONS: Record<NotificationIconKind, ComponentType<{ className?: string }>> = {
  like: LikePostIcon,
  comment: CommentIcon,
  mention: TagIcon
};

export default function NotificationIcon({ kind }: { kind: NotificationIconKind | null }) {
  const Icon = kind ? ICONS[kind] : null;
  if (!Icon) return null;
  return <Icon className="text-xl" />;
}
