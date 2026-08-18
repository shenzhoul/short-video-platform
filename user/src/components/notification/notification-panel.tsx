'use client';

import Dropdown from '@components/ui/dropdown-menu';
import { NOTIFICATION_FILTER, NotificationFilter } from '@interfaces/notification';
import { useNotifications } from '@providers/notification.provider';
import { useEffect, useState } from 'react';
import { FiChevronDown } from 'react-icons/fi';

import NotificationList from './notification-list';

const FILTER_OPTIONS: Array<{ label: string; value: NotificationFilter | null }> = [
  { label: 'All', value: null },
  { label: 'Followers', value: NOTIFICATION_FILTER.FOLLOWERS },
  { label: 'Mentions', value: NOTIFICATION_FILTER.MENTIONS },
  { label: 'Comments', value: NOTIFICATION_FILTER.COMMENTS },
  { label: 'Likes', value: NOTIFICATION_FILTER.LIKES }
];

/** Compact interaction feed shown under the existing header bell. */
export default function NotificationPanel({ onNavigate }: { onNavigate: () => void }) {
  const {
    categoryFilter, ensureLoaded, markAllRead, setCategoryFilter
  } = useNotifications();
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const activeFilter = FILTER_OPTIONS.find((option) => option.value === categoryFilter)
    || FILTER_OPTIONS[0];

  useEffect(() => {
    ensureLoaded();
  }, [ensureLoaded]);

  /**
   * Notifications are marked read when the panel CLOSES, not when it opens.
   *
   * Two things were previously collapsed into one event: "there is new activity"
   * (the bell indicator) and "this row is no longer visually new" (the per-row
   * dot). Marking read on open cleared both at once, so the badge vanished the
   * instant the panel appeared and the rows the user came to look at never
   * showed their dots at all.
   *
   * Deferring to close separates them. During a viewing session the badge stays
   * lit and every row that arrived since the last session keeps its dot —
   * including one that lands while the panel is open. On close the batch is
   * marked seen, so the badge clears and the next session shows those rows as
   * ordinary history.
   */
  useEffect(() => () => {
    void markAllRead();
  }, [markAllRead]);

  return (
    <div className="max-h-175 min-h-134 h-auto overflow-visible rounded-sm">
      <div className="rounded-2xl overflow-hidden">
        <div className="w-full rounded-sm flex relative overflow-hidden items-center flex-col justify-start">
          <div className="w-full h-13 grow-0 shrink-0 items-center justify-between flex pt-0.5 px-5">
            <div className="text-(--text) shrink-0 text-[16px] font-medium">
              Interactive messages
            </div>

            <Dropdown
              trigger={(
                <button
                  type="button"
                  aria-expanded={filterMenuOpen}
                  aria-haspopup="menu"
                  className="text-[14px] flex cursor-pointer items-center gap-1 font-medium text-(--text-muted)"
                >
                  {activeFilter.label}
                  <FiChevronDown
                    aria-hidden="true"
                    className={`text-[13px] transition-transform ${filterMenuOpen ? 'rotate-180' : ''}`}
                  />
                </button>
              )}
              position="right"
              triggerMode="click"
              width={128}
              open={filterMenuOpen}
              onOpenChange={setFilterMenuOpen}
              className="z-10"
              menuClassName="!top-9 !mt-0 !overflow-hidden !rounded-lg !border-none !bg-(--surface-raised) !py-2 !shadow-(--shadow-popover)"
            >
              <div role="menu" aria-label="Filter notifications">
                {FILTER_OPTIONS.map((option) => {
                  const isActive = option.value === categoryFilter;
                  return (
                    <button
                      key={option.value || 'all'}
                      type="button"
                      role="menuitemradio"
                      aria-checked={isActive}
                      onClick={() => {
                        setCategoryFilter(option.value);
                        setFilterMenuOpen(false);
                      }}
                      className={`flex h-12 w-full cursor-pointer items-center px-8 text-left text-[14px] font-medium transition hover:bg-(--hover-bg) ${isActive ? 'text-(--text)' : 'text-(--text-muted)'
                        }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </Dropdown>
          </div>

          <div className="min-h-120 max-h-[calc(70vh-56px)] w-full flex flex-col grow shrink relative overflow-y-auto overscroll-contain">
            <NotificationList onNavigate={onNavigate} />
          </div>
        </div>
      </div>
    </div>
  );
}
