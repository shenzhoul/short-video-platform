'use client';

import { CreatorProfileTabItem } from '@components/creator/creator-profile-types';
import { Tabs } from '@components/ui/tabs';
import { resolveAvatarUrl } from '@lib/avatar';
import { useEffect, useRef } from 'react';
import { FiCalendar, FiCheck, FiChevronDown, FiPlus, FiTrash2 } from 'react-icons/fi';
import { LockIcon, SearchIcon } from 'src/icons';

interface CreatorProfileWorksToolbarProps {
  canEditProfile: boolean;
  filters: string[];
  previewAvatar: string;
  scrollStage: number;
  tabs: CreatorProfileTabItem[];
  activeTab: string;
  managementVariant: 'delete' | 'unlike';
  batchMode: boolean;
  selectedCount: number;
  allSelected: boolean;
  isProcessing: boolean;
  onTabChange: (tab: string) => void;
  onToggleBatchMode: () => void;
  onToggleSelectAll: () => void;
  onExecuteSelected: () => void;
}

export default function CreatorProfileWorksToolbar({
  canEditProfile,
  filters,
  previewAvatar,
  scrollStage,
  tabs,
  activeTab,
  managementVariant,
  batchMode,
  selectedCount,
  allSelected,
  isProcessing,
  onTabChange,
  onToggleBatchMode,
  onToggleSelectAll,
  onExecuteSelected
}: CreatorProfileWorksToolbarProps) {
  const partiallySelected = selectedCount > 0 && !allSelected;
  /**
   * Keep the selected tab inside the scroller.
   *
   * The strip scrolls horizontally on a compact viewport, and the selection can
   * arrive from somewhere other than a click on it — a `?tab=liked` deep link,
   * or the account menu's "I like it" row. Without this the page would open
   * with the active tab off the left or right edge and no sign that it was the
   * one selected.
   *
   * `nearest` rather than `center` so the common case, where the tab is already
   * visible, moves nothing at all.
   */
  const tabStripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const strip = tabStripRef.current;
    if (!strip || strip.scrollWidth <= strip.clientWidth) return;
    const selected = strip.querySelector<HTMLElement>('[data-profile-tab="active"]');
    selected?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeTab, tabs.length]);
  const profileTabs = tabs.map((tab) => ({
    ...tab,
    disabled: tab.locked
  }));
  const filterTabs = filters.map((filter) => ({
    key: filter,
    label: filter
  }));

  return (
    <div className={`sticky top-14 max-lg:top-8 z-50 transition-colors ${scrollStage >= 2 ? 'bg-(--page-bg) pt-2 max-lg:pt-1' : ''}`}>
      <div className='flex w-full relative items-center mx-auto'>
        <div className='w-full h-9 max-lg:h-7 flex relative items-center justify-between gap-2 mx-0 my-2.75 max-lg:my-1'>
          <div ref={tabStripRef} className='flex h-14 max-lg:h-7 min-w-0 flex-1 relative box-border max-lg:overflow-x-auto max-lg:overflow-y-hidden max-lg:[scrollbar-width:none] max-lg:[&::-webkit-scrollbar]:hidden'>
            <div className='shrink-0 relative outline-none whitespace-nowrap'>
              <Tabs tabs={profileTabs} value={activeTab} onChange={onTabChange}>
                {({ getTabProps, isActive }) => (
                  <>
                    {profileTabs.map((tab) => (
                      <div
                        className={`inline-block mr-6 max-lg:mr-3 text-[16px] py-3 max-lg:py-1.5 px-0 float-left ${isActive(tab) ? 'border-b-[3px] border-solid border-[rgba(254,44,85,1)] text-(--text-strong)' : 'text-(--text-muted) hover:text-(--text) hover:border-b-[3px] hover:border-solid hover:border-(--border-faint)'}`}
                        key={tab.key}
                        data-profile-tab={isActive(tab) ? 'active' : undefined}
                        {...getTabProps(tab)}
                      >
                        <div className='flex cursor-pointer mr-0 items-center'>
                          <h2 className='font-semibold flex items-center'>
                            <span className='mr-1.5 max-lg:mr-1 text-lg max-lg:text-[12px] leading-6.5 max-lg:leading-4'>
                              {tab.label}
                            </span>
                            {typeof tab.count === 'number' ? (
                              <span className='text-lg max-lg:text-[12px] leading-6.5 max-lg:leading-4'>{tab.count}</span>
                            ) : null}
                          </h2>
                          {tab.locked ? (
                            <LockIcon className='text-lg max-lg:text-[11px]' />
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </Tabs>
            </div>
          </div>
          {scrollStage >= 2 && !canEditProfile ? (
            <div className='bg-[rgba(254,44,85,.1)] w-26 h-10 cursor-pointer rounded-[20px] flex items-center absolute left-1/2 -translate-x-1/2'>
              <img src={resolveAvatarUrl(previewAvatar)} alt="" className='w-8 h-8 rounded-full ml-1' />
              <div className='text-[#ff2c55] text-sm leading-5.5 flex ml-0.5 items-center'>
                <FiPlus />
                <span>Follow</span>
              </div>
            </div>
          ) : null}
          <div className='h-12.5` mb-1.5 flex items-center' />
          {canEditProfile ? (
            <div className='h-12.5` mb-1.5 flex shrink-0 items-center'>
              <button
                type='button'
                onClick={onToggleBatchMode}
                className='min-w-28 max-lg:min-w-0 h-7 max-lg:h-5 shrink-0 cursor-pointer whitespace-nowrap px-3 max-lg:px-1.5 text-(--text-soft) bg-(--surface-muted) rounded-lg text-center text-[13px] max-lg:text-[10px] leading-7 max-lg:leading-5 transition hover:text-(--text-strong) hover:bg-(--active-bg)'
              >
                {batchMode ? 'Exit management' : 'Batch management'}
              </button>
            </div>
          ) : null}
        </div>
      </div>
      <div className='relative'>
        <div className='w-full'>
          <div className='h-11 max-lg:h-auto p-0 min-h-10 max-lg:min-h-0 flex items-center w-full'>
            <div className={`h-11 max-lg:h-7 w-full flex items-center justify-between gap-2 ${batchMode ? 'rounded-lg bg-(--surface-muted) px-3' : ''}`}>
              {batchMode ? (
                <div className='flex h-9 items-center gap-4 text-[13px] text-(--text-muted)'>
                  <button
                    type='button'
                    onClick={onToggleSelectAll}
                    className='flex cursor-pointer items-center gap-2 text-(--text) hover:text-(--text-strong)'
                  >
                    <span className={`flex h-4 w-4 items-center justify-center rounded ${allSelected || partiallySelected ? 'bg-[#ff2c55] text-white' : 'border border-(--border-strong)'}`}>
                      {allSelected ? <FiCheck className='text-[11px]' /> : null}
                      {partiallySelected ? <span className='block h-0.5 w-2 rounded-full bg-white' /> : null}
                    </span>
                    <span>{allSelected ? 'Cancel select all' : 'Select all'}</span>
                  </button>
                  <span className='h-4 border-l border-(--divider-strong)' />
                  <span>{selectedCount} {selectedCount === 1 ? 'work' : 'works'} selected</span>
                  <span className='h-4 border-l border-(--divider-strong)' />
                  <button
                    type='button'
                    disabled={!selectedCount || isProcessing}
                    onClick={onExecuteSelected}
                    className='flex cursor-pointer items-center gap-1.5 text-(--text-muted) transition hover:text-[#ff2c55] disabled:cursor-not-allowed disabled:opacity-40'
                  >
                    <FiTrash2 />
                    <span>
                      {isProcessing
                        ? managementVariant === 'delete' ? 'Deleting...' : 'Removing...'
                        : managementVariant === 'delete' ? 'Delete' : 'Unlike'}
                    </span>
                  </button>
                  {managementVariant === 'delete' ? (
                    <button
                      type='button'
                      disabled
                      className='flex items-center gap-1.5 text-(--text-disabled)'
                      title='Permission settings will be available later'
                    >
                      <LockIcon className='text-sm' />
                      <span>Permission settings</span>
                    </button>
                  ) : null}
                </div>
              ) : (
                <div className='relative box-border min-w-0 max-lg:flex-1 max-lg:overflow-x-auto max-lg:[scrollbar-width:none] max-lg:[&::-webkit-scrollbar]:hidden'>
                  {filterTabs.length ? (
                    <div className='relative outline-none whitespace-nowrap border-none max-lg:flex max-lg:items-center max-lg:gap-2'>
                      <Tabs tabs={filterTabs} defaultValue={filterTabs[0]?.key}>
                        {({ getTabProps, isActive }) => (
                          <>
                            {filterTabs.map((filter) => (
                              <div
                                className={`mr-2.5 max-lg:mr-0 shrink-0 outline-none rounded-md py-0.75 max-lg:py-0 px-3 max-lg:px-1.5 relative inline-block text-[14px] max-lg:text-[10px] leading-5 max-lg:leading-4 float-left max-lg:float-none ${isActive(filter) ? 'text-[rgba(254,44,85,1)] bg-[rgba(254,44,85,.12)]' : 'bg-(--active-bg) text-(--text-muted) cursor-pointer hover:text-(--text-strong)'}`}
                                key={filter.key}
                                {...getTabProps(filter)}
                              >
                                <div className='flex items-center '>
                                  <span className='mr-0.5'>{filter.label}</span>
                                  {filter.label === 'Private works' ? <LockIcon className='text-sm' /> : null}
                                </div>
                              </div>
                            ))}
                          </>
                        )}
                      </Tabs>
                    </div>
                  ) : null}
                </div>
              )}
              <div className='h-full flex shrink-0 items-center relative'>
                <div className='w-34.5 max-lg:w-auto h-9 flex relative items-center justify-end'>
                  <label className='flex w-full justify-center  items-center cursor-text text-(--text-subtle) transition hover:text-(--text-soft)'>
                    <SearchIcon className='mt-0.75 shrink-0 text-2xl max-lg:text-base' />
                    <span className='ml-1.5 block whitespace-nowrap text-[13px] max-lg:text-[12px] font-medium leading-4.25 hover:border-b hover:border-solid hover:border-(--text-soft)'>
                      {managementVariant === 'delete' ? 'Search for work' : 'Search liked'}
                    </span>
                  </label>
                </div>
                {managementVariant === 'delete' ? (
                  <>
                    <div className='mx-3 max-lg:mx-1.5 h-3 shrink-0 border-l-(--divider-strong) border-b-0 border-l border-solid inline-block align-middle' />
                    <div className='cursor-pointer flex relative shrink-0 items-center whitespace-nowrap ml-0 text-(--text-subtle) max-lg:text-[12px]'>
                      <FiCalendar className='mr-1 text-[13px]' />
                      <span>Date filtering</span>
                      <FiChevronDown className='ml-1 text-[14px]' />
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
