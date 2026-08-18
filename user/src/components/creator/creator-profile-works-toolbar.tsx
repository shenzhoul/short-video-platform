'use client';

import { CreatorProfileTabItem } from '@components/creator/creator-profile-types';
import { Tabs } from '@components/ui/tabs';
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
  const profileTabs = tabs.map((tab) => ({
    ...tab,
    disabled: tab.locked
  }));
  const filterTabs = filters.map((filter) => ({
    key: filter,
    label: filter
  }));

  return (
    <div className={`sticky top-14 z-50 transition-colors ${scrollStage >= 2 ? 'bg-(--page-bg) pt-2' : ''}`}>
      <div className='flex w-full relative items-center mx-auto'>
        <div className='w-full h-9 flex relative items-center justify-between mx-0 my-2.75'>
          <div className='flex h-14 relative box-border'>
            <div className='shrink-0 relative outline-none'>
              <Tabs tabs={profileTabs} value={activeTab} onChange={onTabChange}>
                {({ getTabProps, isActive }) => (
                  <>
                    {profileTabs.map((tab) => (
                      <div
                        className={`inline-block mr-6 text-[16px] py-3 px-0 float-left ${isActive(tab) ? 'border-b-[3px] border-solid border-[rgba(254,44,85,1)] text-(--text-strong)' : 'text-(--text-muted) hover:text-(--text) hover:border-b-[3px] hover:border-solid hover:border-(--border-faint)'}`}
                        key={tab.key}
                        {...getTabProps(tab)}
                      >
                        <div className='flex cursor-pointer mr-0 items-center'>
                          <h2 className='font-semibold flex items-center'>
                            <span className='mr-1.5 text-lg leading-6.5'>
                              {tab.label}
                            </span>
                            {typeof tab.count === 'number' ? (
                              <span className='text-lg leading-6.5'>{tab.count}</span>
                            ) : null}
                          </h2>
                          {tab.locked ? (
                            <LockIcon className='text-lg' />
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
              <img src={previewAvatar} alt="" className='w-8 h-8 rounded-full ml-1' />
              <div className='text-[#ff2c55] text-sm leading-5.5 flex ml-0.5 items-center'>
                <FiPlus />
                <span>Follow</span>
              </div>
            </div>
          ) : null}
          <div className='h-12.5` mb-1.5 flex items-center' />
          {canEditProfile ? (
            <div className='h-12.5` mb-1.5 flex items-center'>
              <button
                type='button'
                onClick={onToggleBatchMode}
                className='min-w-28 h-7 cursor-pointer px-3 text-(--text-soft) bg-(--surface-muted) rounded-lg text-center text-[13px] leading-7 transition hover:text-(--text-strong) hover:bg-(--active-bg)'
              >
                {batchMode ? 'Exit management' : 'Batch management'}
              </button>
            </div>
          ) : null}
        </div>
      </div>
      <div className='relative'>
        <div className='w-full'>
          <div className='h-11 p-0 min-h-10 flex items-center w-full'>
            <div className={`h-11 w-full flex items-center justify-between ${batchMode ? 'rounded-lg bg-(--surface-muted) px-3' : ''}`}>
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
                <div className='relative box-border'>
                  {filterTabs.length ? (
                    <div className='relative outline-none whitespace-nowrap border-none'>
                      <Tabs tabs={filterTabs} defaultValue={filterTabs[0]?.key}>
                        {({ getTabProps, isActive }) => (
                          <>
                            {filterTabs.map((filter) => (
                              <div
                                className={`mr-2.5 outline-none rounded-md py-0.75 px-3 relative inline-block text-[14px] leading-5 float-left ${isActive(filter) ? 'text-[rgba(254,44,85,1)] bg-[rgba(254,44,85,.12)]' : 'bg-(--active-bg) text-(--text-muted) cursor-pointer hover:text-(--text-strong)'}`}
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
              <div className='h-full flex items-center relative'>
                <div className='w-34.5 h-9 flex relative items-center justify-end'>
                  <label className='flex w-full justify-center  items-center cursor-text text-(--text-subtle) transition hover:text-(--text-soft)'>
                    <SearchIcon className='mt-0.75 shrink-0 text-2xl' />
                    <span className='ml-1.5 block text-[13px] font-medium leading-4.25 hover:border-b hover:border-solid hover:border-(--text-soft)'>
                      {managementVariant === 'delete' ? 'Search for work' : 'Search liked'}
                    </span>
                  </label>
                </div>
                {managementVariant === 'delete' ? (
                  <>
                    <div className='mx-3 h-3 border-l-(--divider-strong) border-b-0 border-l border-solid inline-block align-middle' />
                    <div className='cursor-pointer flex relative items-center ml-0 text-(--text-subtle)'>
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
