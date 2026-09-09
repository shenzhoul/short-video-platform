'use client';

import { useVisualViewportHeight } from '@hooks/use-visual-viewport-height';
import { ReactNode } from 'react';

/**
 * The page's content column.
 *
 * Its width subtracts two things: the fixed left navigation, and whatever the
 * right-side message workspace is currently taking. Both are read from CSS
 * variables that have a defined value at every width — the navigation's from
 * `--app-shell-nav-width`, which is 56px for the compact rail and 160px for the
 * labelled one, and the workspace's from a variable that defaults to zero — so
 * this expression is correct at every viewport and whether or not messages are
 * open, and this component never needs to know about either.
 *
 * That is what fixed the 1024–1279px band: the width was previously only
 * subtracted from `xl` up, while the fixed rail was already on screen from `lg`,
 * so for 256px of viewport range the navigation sat on top of the page content.
 *
 * Narrowing here is what drives the reflow: the feed grids inside are container
 * queried, so fewer columns fit as soon as this column shrinks.
 */

export default function MainPageSession({
  children
}: {
  children: ReactNode;
}) {
  /*
    Both shells (`MainThemeLayout`, `CreatorThemeLayout`) render this column, so
    correcting `--app-viewport-height` here covers every surface that sizes a
    full-height stage from it — and does it once rather than per feed.
  */
  useVisualViewportHeight();

  return (
    <div className='w-[calc(100%-var(--app-shell-nav-width)-var(--message-workspace-width,0px))] pt-(--app-header-height) min-h-0 max-xl:h-(--app-viewport-height) xl:h-screen flex flex-col transition-[width] duration-200 ease-out motion-reduce:transition-none'>
      {children}
    </div>
  );
}
