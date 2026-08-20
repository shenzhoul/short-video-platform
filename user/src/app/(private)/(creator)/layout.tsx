import CreatorThemeLayout from '@components/layout/creator/creator-theme-layout';
import { ReactNode } from 'react';

interface Layout {
  children: ReactNode;
}

/**
 * Creator Management — publishing and managing your own content — so this group
 * gets the creator sidebar rather than the Home one.
 *
 * Narrowed from `(private)` to `(private)/(creator)` when Messages arrived: it
 * is authenticated but is not creator management, so it needs the Home shell
 * instead. Route groups are not part of the URL, so every creator path is
 * unchanged by the move.
 */
export default function CreatorLayout({ children }: Layout) {
  return (
    <main>
      <CreatorThemeLayout>
        {children}
      </CreatorThemeLayout>
    </main>
  );
}
