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
          {/*
            The main tabs fit; they do not scroll.

            They used to be a horizontal scroller, which put "Collection" half
            off the edge and needed a fade to explain itself. The reference
            shows all of them at once, so the strip is `overflow-hidden` and the
            tabs share the width: each may shrink and ellipsizes its own label
            rather than pushing the strip wider. The full label stays in the
            accessible name and the `title`, so the visual truncation loses
            nothing.
          */}
          <div
            ref={tabStripRef}
            data-profile-tab-strip
            className='flex h-14 max-lg:h-7 min-w-0 flex-1 relative box-border overflow-hidden'
          >
            <div className='shrink-0 max-lg:shrink max-lg:min-w-0 max-lg:flex-1 relative outline-none whitespace-nowrap max-lg:flex max-lg:items-center'>
              <Tabs tabs={profileTabs} value={activeTab} onChange={onTabChange}>
                {({ getTabProps, isActive }) => (
                  <>
                    {/*
                      Compact: the active tab keeps its whole label; the others
                      share what is left but grow no wider than their own label
                      (`max-w-max`). Without that cap, three short tabs on
                      another creator's profile were stretched across the row —
                      "Recommended" took 150px and "I like it" floated in the
                      middle of the right half. Now they sit packed left with one
                      gap, and still shrink and ellipsize when seven tabs share an
                      owner's row.
                    */}
                    {profileTabs.map((tab) => (
                      <div
                        className={`inline-block mr-6 max-lg:mr-3 max-lg:last:mr-0 max-lg:min-w-0 text-[16px] py-3 max-lg:py-1.5 px-0 float-left max-lg:float-none ${isActive(tab)
                          ? 'max-lg:shrink-0 border-b-[3px] max-lg:border-b-2 border-solid border-[rgba(254,44,85,1)] text-(--text-strong)'
                          : 'max-lg:flex-1 max-lg:basis-0 max-lg:max-w-max text-(--text-muted) hover:text-(--text) hover:border-b-[3px] max-lg:hover:border-b-2 hover:border-solid hover:border-(--border-faint)'}`}
                        key={tab.key}
                        data-profile-tab={isActive(tab) ? 'active' : undefined}
                        // The visual label may be clipped at a compact width;
                        // the accessible name and the tooltip always carry the
                        // whole thing, including the count.
                        aria-label={[
                          tab.label,
                          typeof tab.count === 'number' ? String(tab.count) : null,
                          // The padlock is dropped from the compact row to buy
                          // its tab ~11px of a 35px share, so the name has to
                          // carry what the glyph was saying.
                          tab.locked ? '(locked)' : null
                        ].filter(Boolean).join(' ')}
                        title={tab.label}
                        {...getTabProps(tab)}
                      >
                        <div className='flex cursor-pointer mr-0 min-w-0 items-center'>
                          <h2 className='font-semibold flex min-w-0 items-center'>
                            <span className='mr-1.5 max-lg:mr-0.5 min-w-0 truncate text-lg max-lg:text-[11px] leading-6.5 max-lg:leading-4'>
                              {tab.label}
                            </span>
                            {typeof tab.count === 'number' ? (
                              <span className='shrink-0 text-lg max-lg:text-[11px] leading-6.5 max-lg:leading-4'>{tab.count}</span>
                            ) : null}
                          </h2>
                          {tab.locked ? (
                            <LockIcon className='shrink-0 text-lg max-lg:hidden' />
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
              {/*
                Counted in the tabs' width budget, so it takes the compact
                short label with the full name kept accessible. "Batch
                management" is ~108px at 10px against ~42px for "Manage", which
                is the difference between the tab strip fitting and not.
              */}
              <button
                type='button'
                onClick={onToggleBatchMode}
                aria-label={batchMode ? 'Exit management' : 'Batch management'}
                title={batchMode ? 'Exit management' : 'Batch management'}
                className='min-w-28 max-lg:min-w-0 h-7 max-lg:h-5 shrink-0 cursor-pointer whitespace-nowrap px-3 max-lg:px-1.5 text-(--text-soft) bg-(--surface-muted) rounded-lg text-center text-[13px] max-lg:text-[10px] leading-7 max-lg:leading-5 transition hover:text-(--text-strong) hover:bg-(--active-bg)'
              >
                <span className='max-lg:hidden'>{batchMode ? 'Exit management' : 'Batch management'}</span>
                <span className='lg:hidden'>{batchMode ? 'Exit' : 'Manage'}</span>
              </button>
            </div>
          ) : null}
        </div>
      </div>
      <div className='relative'>
        <div className='w-full'>
          {/*
            With the compact search hidden, a tab that also has no filters (the
            liked tab passes an empty list) would leave an empty toolbar band.
            The row is dropped entirely in that case rather than collapsed to
            zero height, so nothing reserves space and nothing is focusable
            inside it.
          */}
          <div className={`h-11 max-lg:h-auto p-0 min-h-10 max-lg:min-h-0 flex items-center w-full ${!batchMode && !filterTabs.length ? 'max-lg:hidden' : ''}`}>
            <div className={`h-11 max-lg:h-7 w-full min-w-0 flex items-center justify-between gap-2 max-lg:gap-1.5 ${batchMode ? 'rounded-lg bg-(--surface-muted) px-3 max-lg:px-1.5' : ''}`}>
              {batchMode ? (
                <div
                  data-batch-toolbar
                  className='flex h-9 max-lg:h-7 min-w-0 flex-1 items-center gap-4 max-lg:gap-2 text-[13px] max-lg:text-[10px] text-(--text-muted) max-lg:overflow-x-auto max-lg:whitespace-nowrap max-lg:[scrollbar-width:none] max-lg:[&::-webkit-scrollbar]:hidden'
                >
                  <button
                    type='button'
                    onClick={onToggleSelectAll}
                    className='flex shrink-0 cursor-pointer items-center gap-2 max-lg:gap-1 text-(--text) hover:text-(--text-strong)'
                  >
                    <span className={`flex h-4 w-4 max-lg:h-3 max-lg:w-3 shrink-0 items-center justify-center rounded ${allSelected || partiallySelected ? 'bg-[#ff2c55] text-white' : 'border border-(--border-strong)'}`}>
                      {allSelected ? <FiCheck className='text-[11px]' /> : null}
                      {partiallySelected ? <span className='block h-0.5 w-2 rounded-full bg-white' /> : null}
                    </span>
                    <span>{allSelected ? 'Cancel select all' : 'Select all'}</span>
                  </button>
                  <span className='h-4 max-lg:h-3 shrink-0 border-l border-(--divider-strong)' />
                  {/*
                    The count is the one thing that must always be readable, so
                    it keeps its word at every width — it just stops wrapping.
                  */}
                  <span className='shrink-0'>{selectedCount} {selectedCount === 1 ? 'work' : 'works'} selected</span>
                  <span className='h-4 max-lg:h-3 shrink-0 border-l border-(--divider-strong)' />
                  <button
                    type='button'
                    disabled={!selectedCount || isProcessing}
                    onClick={onExecuteSelected}
                    className='flex shrink-0 cursor-pointer items-center gap-1.5 max-lg:gap-1 text-(--text-muted) transition hover:text-[#ff2c55] disabled:cursor-not-allowed disabled:opacity-40'
                  >
                    <FiTrash2 className='shrink-0' />
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
                      className='flex shrink-0 items-center gap-1.5 max-lg:gap-1 text-(--text-disabled)'
                      title='Permission settings will be available later'
                    >
                      <LockIcon className='text-sm max-lg:text-[11px] shrink-0' />
                      <span className='max-lg:hidden'>Permission settings</span>
                      <span className='lg:hidden'>Permissions</span>
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
                                className={`mr-2.5 max-lg:mr-0 shrink-0 outline-none rounded-md max-lg:rounded py-0.75 max-lg:py-0.5 px-3 max-lg:px-2 relative inline-block text-[14px] max-lg:text-[10px] leading-5 max-lg:leading-4 float-left max-lg:float-none ${isActive(filter) ? 'text-[rgba(254,44,85,1)] bg-[rgba(254,44,85,.12)]' : 'bg-(--active-bg) text-(--text-muted) cursor-pointer hover:text-(--text-strong)'}`}
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
              <div className='h-full flex shrink-0 items-center relative max-lg:hidden'>
                <div className='w-34.5 max-lg:w-auto h-9 max-lg:h-7 flex relative items-center justify-end'>
                  <label
                    className='flex w-full justify-center items-center cursor-text text-(--text-subtle) transition hover:text-(--text-soft)'
                    aria-label={managementVariant === 'delete' ? 'Search for work' : 'Search liked'}
                  >
                    <SearchIcon className='mt-0.75 shrink-0 text-2xl max-lg:text-base' />
                    <span className={`ml-1.5 max-lg:ml-1 block whitespace-nowrap text-[13px] max-lg:text-[10px] font-medium leading-4.25 hover:border-b hover:border-solid hover:border-(--text-soft) ${batchMode ? 'max-lg:hidden' : ''}`}>
                      {managementVariant === 'delete' ? 'Search for work' : 'Search liked'}
                    </span>
                  </label>
                </div>
                {managementVariant === 'delete' ? (
                  <>
                    <div className={`mx-3 max-lg:mx-1.5 h-3 shrink-0 border-l-(--divider-strong) border-b-0 border-l border-solid inline-block align-middle ${batchMode ? 'max-lg:hidden' : ''}`} />
                    <div className={`cursor-pointer flex relative shrink-0 items-center whitespace-nowrap ml-0 text-(--text-subtle) max-lg:text-[10px] ${batchMode ? 'max-lg:hidden' : ''}`}>
                      <FiCalendar className='mr-1 max-lg:mr-0.5 text-[13px] max-lg:text-[11px]' />
                      <span>Date filtering</span>
                      <FiChevronDown className='ml-1 max-lg:ml-0.5 text-[14px] max-lg:text-[11px]' />
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
