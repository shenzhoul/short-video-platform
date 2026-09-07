'use client';

import { CreatorMenu } from '@components/layout/creator/creator-menu';
import Logo from '@components/layout/logo';
import SidebarBottom from '@components/layout/sidebar-bottom';
import { useRouter } from 'next/navigation';
import {
  FiChevronDown,
  FiPlusSquare
} from 'react-icons/fi';

/**
 * Sidebar for Creator Management.
 *
 * Kept separate from the Home navigation rather than branching inside it: the two answer different
 * questions ("what do I want to watch" vs "what have I published") and share no menu items.
 *
 * Publish points at the existing publish entry, so every upload flow keeps the URLs it already has.
 */
export default function CreatorNavigation() {
  const router = useRouter();

  return (
    <>
      <div className='w-(--app-shell-nav-width) h-full shrink-0 transition-[width] duration-200 ease-out motion-reduce:transition-none' />
      <div className='fixed left-0 top-0 flex h-(--app-viewport-height) w-(--app-shell-nav-width) flex-col bg-(--page-bg) text-(--text-strong) transition-[width] duration-200 ease-out motion-reduce:transition-none z-99'>
        <div className='max-lg:hidden flex justify-center'><Logo /></div>
        <div className='flex my-3 mx-5 max-lg:mx-1 max-lg:my-2'>
          <button
            type="button"
            onClick={() => router.push('/creator/publish')}
            className="flex h-10 w-full cursor-pointer items-center justify-between max-lg:justify-center rounded-md bg-[#fe2c55] px-3 max-lg:px-0 text-[14px] max-lg:text-[9px] font-semibold text-white transition-colors hover:bg-[#e9274e] active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#fe2c55]"
          >
            <span className="flex items-center gap-2 max-lg:flex-col max-lg:gap-0.5">
              <FiPlusSquare className="text-base" />
              <span>Publish</span>
            </span>
            <FiChevronDown className="text-base max-lg:hidden" />
          </button>
        </div>
        <div className='p-2 max-lg:px-0.5 overflow-hidden overflow-y-auto scrollbar-custom
              h-full min-h-0 flex flex-col justify-between'
        >
          {/* Navigation Menu */}
          <CreatorMenu />
          <SidebarBottom />
        </div>
      </div>
    </>
  );
}
