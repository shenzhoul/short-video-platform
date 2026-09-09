'use client';

import Dropdown from '@components/ui/dropdown-menu';
import { IUser } from '@interfaces/user';
import { resolveAvatarUrl } from '@lib/avatar';
import { useMemo, useState } from 'react';
import { MoreIcon, PlaylistArrowLeftIcon, PlaylistArrowRightIcon, SearchIcon, SortIcon } from 'src/icons';

import FollowingCreatorActionsModal from './following-creator-actions-modal';

type FollowingSort = 'recent' | 'earliest';

interface FollowingCreatorsRailProps {
  creators: IUser[];
  /** Heading above the list. Defaults to the following-page wording. */
  title?: string;
  activeCreatorId?: string;
  /**
   * Whether the rail is showing names.
   *
   * Owned by the feed rather than by the rail, because it decides the column
   * allocation for the whole row: the detail panel has to hold its measured
   * width whatever the rail is doing, and the stage cannot read a boolean that
   * lives inside its sibling.
   */
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onSelectCreator: (creatorId: string) => void;
  onUnfollowCreator: (creatorId: string) => Promise<void>;
}

const SORT_OPTIONS: Array<{ label: string; value: FollowingSort }> = [
  { label: 'Recently', value: 'recent' },
  { label: 'Earliest', value: 'earliest' }
];

export default function FollowingCreatorsRail({
  creators, activeCreatorId, expanded, onExpandedChange, onSelectCreator, onUnfollowCreator,
  title = 'My following'
}: FollowingCreatorsRailProps) {
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
      /*
        The secondary strip is an avatar column on a compact viewport, matching
        the reference: 28px collapsed (a 20px avatar plus its gutters), never a
        labelled rail. The 56px it used to be cost the media stage a fifth of
        its width for a column that shows nothing but circles.

        Expanded it is 88px (`w-22`), measured off
        `douyin-following-expanded-reference.png`: ~93px of that capture's 467px
        of app width, scaled to our 440px viewport. It was 128px -- a third of
        the whole content area -- and every element inside it still carried its
        desktop type, so the header row ("List" plus the sort control)
        overflowed and was clipped by the media column beside it.
      */
      className={`relative z-50 h-full shrink-0 border-r border-(--border-faint) text-(--text-strong) transition-[width] duration-200 ${expanded ? 'w-52 max-lg:w-22' : 'w-18 max-lg:w-7'}`}
    >
      <div className="flex h-full min-h-0 flex-col py-3 max-lg:py-1">
        <div className="mb-2 max-lg:mb-1 flex h-8 max-lg:h-5 shrink-0 items-center justify-between gap-1 px-3 max-lg:px-1">
          <button
            type="button"
            onClick={() => onExpandedChange(!expanded)}
            className={`flex h-8 max-lg:h-5 cursor-pointer items-center rounded-lg text-(--text-muted) transition hover:bg-(--hover-bg) hover:text-(--text-strong) focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#fe2c55] ${expanded ? 'gap-1 px-1.5 max-lg:gap-0.5 max-lg:px-0 text-sm max-lg:text-[9px] font-semibold' : 'mx-auto w-9 max-lg:w-full justify-center'}`}
            aria-label={expanded ? 'Collapse following list' : 'Expand following list'}
            aria-expanded={expanded}
          >
            {expanded ? <PlaylistArrowLeftIcon className="text-xl max-lg:text-[13px]" /> : <PlaylistArrowRightIcon className="text-xl max-lg:text-[13px]" />}
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
                  className="flex h-8 max-lg:h-5 cursor-pointer items-center gap-1 max-lg:gap-0.5 rounded-lg px-1.5 max-lg:px-0 text-[13px] max-lg:text-[9px] text-(--text-muted) transition hover:bg-(--hover-bg) hover:text-(--text-strong) focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#fe2c55]"
                  aria-label={`Sort following list: ${selectedSortLabel}`}
                >
                  {/*
                    Compact, the sort control is its icon alone. "Recently"
                    truncated to "Recen..." and still pushed the icon under the
                    media column's edge; the accessible name on the button
                    carries the current value, and the menu shows both options.
                    A caption may be hidden -- a control may not.
                  */}
                  <span className="max-w-25 truncate max-lg:hidden">{selectedSortLabel}</span>
                  <SortIcon className="shrink-0 text-lg max-lg:text-[11px]" />
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

        <div className={`mb-2 max-lg:mb-1 shrink-0 ${expanded ? 'px-3 max-lg:px-1' : 'px-4 max-lg:px-1'}`}>
          <label
            className="flex h-9 max-lg:h-5 cursor-text items-center rounded-xl max-lg:rounded-md border border-(--border-soft) bg-(--surface-muted) text-(--text-muted) transition hover:border-(--divider-strong) focus-within:border-(--divider-strong)"
            onClick={() => onExpandedChange(true)}
          >
            <SearchIcon className={`shrink-0 text-2xl max-lg:text-[11px] ${expanded ? 'ml-2 max-lg:ml-1' : 'mx-auto'}`} />
            {expanded ? (
              <input
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="Search following"
                className="h-full min-w-0 flex-1 bg-transparent px-1.5 max-lg:px-1 pr-3 max-lg:pr-1 text-[13px] max-lg:text-[9px] text-(--text-strong) outline-none placeholder:text-(--text-faint)"
              />
            ) : null}
          </label>
        </div>

        {expanded ? (
          <p className="mb-1 max-lg:mb-0.5 h-8 max-lg:h-4 shrink-0 px-4 max-lg:px-1 py-1.5 max-lg:py-0 text-sm max-lg:text-[9px] max-lg:leading-4 font-semibold text-(--text-muted)">
            {title} ({creators.length})
          </p>
        ) : null}

        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2 max-lg:px-0.5 pb-2 max-lg:pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <ul className="flex flex-col items-center">
            {filteredCreators.map(creator => {
              const creatorName = creator.name || creator.username;
              const isActive = activeCreatorId === creator._id;

              return (
                <li key={creator._id} className="w-full">
                  <div
                    className={`group relative flex h-12 max-lg:h-7 w-full items-center rounded-xl max-lg:rounded-lg transition hover:bg-(--hover-bg) focus-within:bg-(--hover-bg) ${expanded ? 'px-3 max-lg:px-1' : 'justify-center px-0'} ${isActive ? 'bg-(--active-bg)' : ''}`}
                  >
                    <button
                      type="button"
                      onClick={() => onSelectCreator(creator._id)}
                      className={`flex h-full min-w-0 cursor-pointer items-center focus-visible:outline-2 focus-visible:outline-[#fe2c55] ${expanded ? 'flex-1' : 'justify-center'}`}
                      aria-label={`Show posts by ${creatorName}`}
                    >
                      <span className={`relative h-8 w-8 max-lg:h-5 max-lg:w-5 shrink-0 overflow-hidden rounded-full border border-(--border-faint) ${!expanded && isActive ? 'ring-2 max-lg:ring-1 ring-[#fe2c55] ring-offset-2 max-lg:ring-offset-1 ring-offset-(--surface)' : ''}`}>
                        <img src={resolveAvatarUrl(creator.avatar)} alt="" className="h-full w-full object-cover" />
                      </span>

                      {expanded ? (
                        <span className="ml-2 max-lg:ml-1 min-w-0 flex-1 truncate text-left text-[13px] max-lg:text-[10px] font-normal text-(--text)">
                          {creatorName}
                        </span>
                      ) : null}
                    </button>
                    {expanded ? (
                      <button
                        type="button"
                        onClick={() => setActionCreator(creator)}
                        /*
                          Compact, this floats over the row's right edge instead
                          of sitting in the flex line. It is hidden until hover,
                          but `opacity-0` still reserves its 32px -- a third of
                          an 88px rail permanently spent on a control that is
                          not visible, taken straight out of the name.
                        */
                        className="ml-1 max-lg:ml-0 flex h-8 w-8 max-lg:h-5 max-lg:w-5 shrink-0 cursor-pointer items-center justify-center rounded-lg max-lg:absolute max-lg:right-0 max-lg:bg-(--surface) text-(--text-muted) opacity-0 transition hover:text-(--text-strong) focus:opacity-100 focus-visible:outline-2 focus-visible:outline-[#fe2c55] group-hover:opacity-100 group-focus-within:opacity-100"
                        aria-label={`More actions for ${creatorName}`}
                      >
                        <MoreIcon className="text-xl max-lg:text-[13px]" />
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
