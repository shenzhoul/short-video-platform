'use client';

import { ReactNode } from 'react';

export default function MainPageSession({
  children
}: {
  children: ReactNode;
}) {
  return (
    <div className='max-lg:w-full pt-14 xl:h-screen xl:min-h-0 flex flex-col xl:w-[calc(100%-160px)]'>
      {children}
    </div>
  );
}
