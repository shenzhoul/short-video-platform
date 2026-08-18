'use client';

import Dropdown from '@components/ui/dropdown-menu';
import { IUser } from '@interfaces/user';
import { useMemo, useState } from 'react';
import { MoreIcon, PlaylistArrowLeftIcon, PlaylistArrowRightIcon, SearchIcon, SortIcon } from 'src/icons';

import FollowingCreatorActionsModal from './following-creator-actions-modal';

type FollowingSort = 'recent' | 'earliest';

interface FollowingCreatorsRailProps {
  creators: IUser[];
  activeCreatorId?: string;
  onSelectCreator: (creatorId: string) => void;
  onUnfollowCreator: (creatorId: string) => Promise<void>;
}

const SORT_OPTIONS: Array<{ label: string; value: FollowingSort }> = [
  { label: 'Recently', value: 'recent' },
  { label: 'Earliest', value: 'earliest' }
];

export default function FollowingCreatorsRail({ creators, activeCreatorId, onSelectCreator, onUnfollowCreator }: FollowingCreatorsRailProps) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<FollowingSort>('recent');
  const [actionCreator, setActionCreator] = useState<IUser | null>(null);

  const filteredCreators = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const matches = normalizedQuery
      ? creators.filter(creator => `${creator.name || ''} ${creator.username || ''}`.toLowerCase().includes(normalizedQuery))
      : creators;

    return sort === 'earliest' ? [...matches].reverse() : matches;
  }, [creators, query, sort]);

  const selectedSortLabel = SORT_OPTIONS.find(option => option.value === sort)?.label || SORT_OPTIONS[0].label;

  return (
    <aside
      className={`relative z-50 h-full shrink-0 border-r border-(--border-faint) text-(--text-strong) transition-[width] duration-200 ${expanded ? 'w-52' : 'w-18'}`}
    >
      <div className="flex h-full min-h-0 flex-col py-3">
        <div className="mb-2 flex h-8 shrink-0 items-center justify-between px-3">
          <button
            type="button"
            onClick={() => setExpanded(current => !current)}
            className={`flex h-8 cursor-pointer items-center rounded-lg text-(--text-muted) transition hover:bg-(--hover-bg) hover:text-(--text-strong) focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#fe2c55] ${expanded ? 'gap-1 px-1.5 text-sm font-semibold' : 'mx-auto w-9 justify-center'}`}
            aria-label={expanded ? 'Collapse following list' : 'Expand following list'}
            aria-expanded={expanded}
          >
            {expanded ? <PlaylistArrowLeftIcon className="text-xl" /> : <PlaylistArrowRightIcon className="text-xl" />}
            {expanded ? <span>List</span> : null}
          </button>

          {expanded ? (
            <Dropdown
              triggerMode="hover"
              position="right"
              width={132}
              className="shrink-0"
              menuClassName="!mt-1 !rounded-xl !border-none !bg-(--surface-raised) !p-1.5 !text-(--text-strong) !shadow-[var(--shadow-popover)]"
              trigger={(
                <button
                  type="button"
                  className="flex h-8 cursor-pointer items-center gap-1 rounded-lg px-1.5 text-[13px] text-(--text-muted) transition hover:bg-(--hover-bg) hover:text-(--text-strong) focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#fe2c55]"
                  aria-label={`Sort following list: ${selectedSortLabel}`}
                >
                  <span className="max-w-25 truncate">{selectedSortLabel}</span>
                  <SortIcon className="shrink-0 text-lg" />
                </button>
              )}
            >
              <div className="flex flex-col py-0.5">
                {SORT_OPTIONS.map(option => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setSort(option.value)}
                    className={`h-10 cursor-pointer rounded-lg px-3 text-left text-[13px] transition hover:bg-(--hover-bg) ${sort === option.value ? 'text-[#fe2c55]' : 'text-(--text-soft)'}`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </Dropdown>
          ) : null}
        </div>

        <div className={`mb-2 shrink-0 ${expanded ? 'px-3' : 'px-4'}`}>
          <label
            className="flex h-9 cursor-text items-center rounded-xl border border-(--border-soft) bg-(--surface-muted) text-(--text-muted) transition hover:border-(--divider-strong) focus-within:border-(--divider-strong)"
            onClick={() => setExpanded(true)}
          >
            <SearchIcon className={`shrink-0 text-2xl ${expanded ? 'ml-2' : 'mx-auto'}`} />
            {expanded ? (
              <input
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="Search following"
                className="h-full min-w-0 flex-1 bg-transparent px-1.5 pr-3 text-[13px] text-(--text-strong) outline-none placeholder:text-(--text-faint)"
              />
            ) : null}
          </label>
        </div>

        {expanded ? (
          <p className="mb-1 h-8 shrink-0 px-4 py-1.5 text-sm font-semibold text-(--text-muted)">
            My following ({creators.length})
          </p>
        ) : null}

        <div className="home-feed-scrollbar min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2 pb-2">
          <ul className="flex flex-col items-center">
            {filteredCreators.map(creator => {
              const creatorName = creator.name || creator.username;
              const isActive = activeCreatorId === creator._id;

              return (
                <li key={creator._id} className="w-full">
                  <div
                    className={`group flex h-12 w-full items-center rounded-xl transition hover:bg-(--hover-bg) focus-within:bg-(--hover-bg) ${expanded ? 'px-3' : 'justify-center px-0'} ${isActive ? 'bg-(--active-bg)' : ''}`}
                  >
                    <button
                      type="button"
                      onClick={() => onSelectCreator(creator._id)}
                      className={`flex h-full min-w-0 cursor-pointer items-center focus-visible:outline-2 focus-visible:outline-[#fe2c55] ${expanded ? 'flex-1' : 'justify-center'}`}
                      aria-label={`Show posts by ${creatorName}`}
                    >
                      <span className={`relative h-8 w-8 shrink-0 overflow-hidden rounded-full border border-(--border-faint) ${!expanded && isActive ? 'ring-2 ring-[#fe2c55] ring-offset-2 ring-offset-(--surface)' : ''}`}>
                        <img src={creator.avatar || '/no_avatar.jpeg'} alt="" className="h-full w-full object-cover" />
                      </span>

                      {expanded ? (
                        <span className="ml-2 min-w-0 flex-1 truncate text-left text-[13px] font-normal text-(--text)">
                          {creatorName}
                        </span>
                      ) : null}
                    </button>
                    {expanded ? (
                      <button
                        type="button"
                        onClick={() => setActionCreator(creator)}
                        className="ml-1 flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-(--text-muted) opacity-0 transition hover:text-(--text-strong) focus:opacity-100 focus-visible:outline-2 focus-visible:outline-[#fe2c55] group-hover:opacity-100 group-focus-within:opacity-100"
                        aria-label={`More actions for ${creatorName}`}
                      >
                        <MoreIcon className="text-xl" />
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      <FollowingCreatorActionsModal
        creator={actionCreator}
        onClose={() => setActionCreator(null)}
        onUnfollow={onUnfollowCreator}
      />
    </aside>
  );
}
