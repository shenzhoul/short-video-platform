import Dropdown from '@components/ui/dropdown-menu';
import { FiChevronDown } from 'react-icons/fi';
import { PlaylistIcon } from 'src/icons';

import {
  postCreateControlClassName,
  postCreateDropdownMenuClassName,
  PostCreateField,
  postCreatePlaceholderClassName,
  PostCreateSection
} from './post-create-layout';

export default function PostCreateExtendedInformation() {
  return (
    <PostCreateSection title="Extended information">
      <div className="mt-6 space-y-4">
        <PostCreateField
          label="Video chapter"
        >
          <div className='flex w-full items-center h-[62px] justify-start p-3 rounded-sm bg-(--action-card-bg)'>
            <div className='flex h-[38px] w-[38px] items-center justify-center rounded-sm bg-(--surface-raised) text-(--text-muted)'>
              <PlaylistIcon className='text-lg' />
            </div>
            <div className='m-0 grow'>
              <p className='ml-3 text-sm font-semibold leading-5 text-(--text-soft)'>Add chapter information to the progress bar to make the video structure clearer</p>
              <p className='ml-3 text-xs leading-[18px] text-(--text-muted)'>The number of chapters added will be displayed here</p>
            </div>
          </div>
        </PostCreateField>
        <PostCreateField
          label="Add tag"
          tooltip="Platform authors need to meet the thresholds for business components in different scenarios."
        >
          <div className="flex">
            <Dropdown
              className="shrink-0"
              trigger={(
                <button type="button" className={`${postCreateControlClassName} w-[104px]`}>
                  <span>location</span>
                  <FiChevronDown className="text-base text-(--text-muted)" />
                </button>
              )}
              width={104}
              position="left"
              menuClassName={postCreateDropdownMenuClassName}
            >
              <button type="button" className="block h-8 w-full rounded-sm px-2 text-left text-sm text-(--text-strong) hover:bg-(--surface-muted)">
                location
              </button>
            </Dropdown>
            <input
              placeholder="Enter geographic location"
              className="ml-2 h-8 flex-1 rounded-sm bg-(--action-card-bg) px-3 text-sm text-(--text-strong) caret-[#fe2c55] outline-none transition placeholder:text-(--text-muted) hover:bg-(--surface-hover) focus:bg-(--surface-hover)"
            />
          </div>
        </PostCreateField>
        <PostCreateField
          label={<span className="text-right">Associated<br />hotspot</span>}
          tooltip="Associate a trending hotspot when this post is related to a current topic."
        >
          <Dropdown
            className="w-full"
            trigger={(
              <button type="button" className={`${postCreateControlClassName} w-full`}>
                <span className={postCreatePlaceholderClassName}>Click to enter hot words</span>
                <FiChevronDown className="text-base text-(--text-muted)" />
              </button>
            )}
            width="100%"
            position="left"
            menuClassName={postCreateDropdownMenuClassName}
          >
            <button type="button" className="block h-9 w-full rounded-sm px-3 text-left text-sm text-(--text-strong) hover:bg-(--surface-muted)">
              Click to enter hot words
            </button>
          </Dropdown>
        </PostCreateField>
      </div>
    </PostCreateSection>
  );
}
