import Dropdown from '@components/ui/dropdown-menu';
import { FiChevronDown, FiEdit2, FiMusic } from 'react-icons/fi';

import {
  postCreateControlClassName,
  postCreateDropdownMenuClassName,
  PostCreateField,
  postCreatePlaceholderClassName,
  PostCreateSection
} from './post-create-layout';

export default function PostGraphicExtendedInformation() {
  return (
    <PostCreateSection title="Extended information">
      <div className="mt-6 space-y-4">
        <PostCreateField label="Choose music">
          <button type="button" className="flex h-[62px] w-full items-center rounded-sm bg-(--action-card-bg) p-3 text-left hover:bg-(--surface-hover)">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-(--surface-raised) text-xl text-(--text-muted)"><FiMusic /></span>
            <span className="ml-3 flex-1 text-sm">Add music</span>
            <FiEdit2 className="mr-2 text-(--text-muted)" />
            <span className="text-sm font-semibold text-(--text-soft)">Choose music</span>
          </button>
        </PostCreateField>
        <PostCreateField label="Add tag" tooltip="Platform authors need to meet the thresholds set by the platform when mounting business components in different scenarios.">
          <div className="flex">
            <Dropdown
              className="shrink-0"
              trigger={<button type="button" className={`${postCreateControlClassName} w-[104px]`}><span>location</span><FiChevronDown /></button>}
              width={104}
              position="left"
              menuClassName={postCreateDropdownMenuClassName}
            >
              <button type="button" className="block h-8 w-full px-2 text-left text-sm hover:bg-(--surface-muted)">location</button>
            </Dropdown>
            <input placeholder="Relevant location" className="ml-2 h-8 flex-1 rounded-sm bg-(--action-card-bg) px-3 text-sm caret-[#fe2c55] outline-none placeholder:text-(--text-muted) hover:bg-(--surface-hover) focus:bg-(--surface-hover)" />
          </div>
        </PostCreateField>
        <PostCreateField label={<span className="text-right">Associated<br />hotspot</span>} tooltip="You can apply to be associated with a hotspot. If the video is indeed very related to the hotspot, it will enter the Douyin hotspot list. If it is not related, it will not take effect.">
          <Dropdown
            className="w-full"
            trigger={<button type="button" className={`${postCreateControlClassName} w-full`}><span className={postCreatePlaceholderClassName}>Click to enter hot words</span><FiChevronDown /></button>}
            width="100%"
            position="left"
            menuClassName={postCreateDropdownMenuClassName}
          >
            <button type="button" className="block h-9 w-full px-3 text-left text-sm hover:bg-(--surface-muted)">Click to enter hot words</button>
          </Dropdown>
        </PostCreateField>
      </div>
    </PostCreateSection>
  );
}
