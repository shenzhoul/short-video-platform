'use client';

import { ReactNode } from 'react';

/**
 * The page's content column.
 *
 * Its width subtracts two things: the fixed left navigation, and whatever the
 * right-side message workspace is currently taking. The second is read from a
 * CSS variable that defaults to zero, so this expression is correct whether or
 * not messages are open and this component never needs to know about them.
 *
 * Narrowing here is what drives the reflow: the feed grids inside are container
 * queried, so fewer columns fit as soon as this column shrinks.
 */

export default function MainPageSession({
  children
}: {
  children: ReactNode;
}) {
  return (
    <div className='max-lg:w-full pt-(--app-header-height) xl:h-screen xl:min-h-0 flex flex-col xl:w-[calc(100%-160px-var(--message-workspace-width,0))] transition-[width] duration-200 ease-out motion-reduce:transition-none'>
      {children}
    </div>
  );
}
