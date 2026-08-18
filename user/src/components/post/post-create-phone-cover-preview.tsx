'use client';

import type { PostCoverRatio } from '@hooks/use-post-create';
import { useProfile } from '@providers/profile.provider';

interface PostCreatePhoneCoverPreviewProps {
  caption: string;
  cover4x3Url?: string;
  cover3x4Url?: string;
  ratio: PostCoverRatio;
  onRatioChange: (ratio: PostCoverRatio) => void;
}

interface CoverCardProps {
  paddingClassName: string;
  coverUrl?: string;
  caption?: string;
  avatarUrl?: string;
  creatorName?: string;
}

function CoverCard({
  paddingClassName,
  coverUrl,
  caption,
  avatarUrl,
  creatorName
}: CoverCardProps) {
  return (
    <div className="relative mb-1.5 w-full rounded-[6px] bg-[hsla(0,0%,100%,.1)]">
      <div className={`${paddingClassName} relative`}>
        {coverUrl ? (
          <img
            src={coverUrl}
            alt="Selected video cover"
            className="absolute h-full w-full rounded-t-[6px] object-cover"
          />
        ) : null}
      </div>
      <div className="rounded-b-[8px] bg-[hsla(0,0%,100%,.03)] px-[6px] pb-[6px] text-[8px] text-white">
        <div className="line-clamp-2 w-[140px] origin-left scale-[0.7] break-all text-[12px] font-medium leading-[18px]">
          <div>{caption || 'Please fill in the title of the work...'}</div>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <div className="mr-1 h-[15px] w-[15px] flex-col justify-center rounded-[50%] bg-[hsla(0,0%,100%,.2)]">
              {avatarUrl ? (
                <img src={avatarUrl} alt="" className="h-full w-full rounded-[50%]" />
              ) : null}
            </div>
            <div className="w-[56px] origin-left truncate text-[8px]">{creatorName}</div>
          </div>
          <div className="flex items-center text-[9px]">
            <img src="/heart_ico.png" alt="" width={12} height={12} />
            <span className="inline-block text-[8px]">0</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function PlaceholderCard({ paddingClassName }: { paddingClassName: string }) {
  return (
    <div className="relative mb-1.5 w-full rounded-[6px] bg-[hsla(0,0%,100%,.1)]">
      <div className={`${paddingClassName} relative bg-[linear-gradient(180deg,transparent,rgba(0,0,0,.3))] opacity-[.2]`} />
      <div className="rounded-b-[8px] bg-[hsla(0,0%,100%,.03)] px-[6px] pb-[6px] text-[8px] text-[hsla(0,0%,100%,.2)]">
        <div className="line-clamp-2 w-[140px] origin-left scale-[0.7] break-all text-[12px] font-medium leading-[18px]">
          <div>************************</div>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <div className="mr-1 h-[15px] w-[15px] rounded-[50%] bg-[hsla(0,0%,100%,.2)]" />
            <div className="w-[56px] origin-left truncate text-[8px]">***</div>
          </div>
          <div className="flex items-center text-[9px]">
            <img src="/heart_ico_dark.png" alt="" width={12} height={12} />
            <span className="inline-block text-[8px]">0</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function HorizontalHeaderCard() {
  return (
    <div className="px-2.5">
      <div className="relative mb-1.5 w-full rounded-[6px] bg-[hsla(0,0%,100%,.1)]">
        <div className="relative bg-[linear-gradient(180deg,transparent,rgba(0,0,0,.3))] pb-[56.52%] opacity-[.2]" />
        <div className="rounded-b-[8px] bg-[hsla(0,0%,100%,0.03)] px-[6px] pb-[6px] text-[8px] text-[hsla(0,0%,100%,0.2)]">
          <div className="line-clamp-2 w-[140px] origin-left scale-[0.7] break-all text-[12px] font-medium leading-[18px]">
            <div>************************</div>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <div className="mr-1 h-[15px] w-[15px] rounded-[50%] bg-[hsla(0,0%,100%,.2)]" />
              <div className="w-[56px] origin-left truncate text-[8px]">***</div>
            </div>
            <div className="flex items-center">
              <img src="/heart_ico_dark.png" alt="" width={12} height={12} />
              <span className="inline-block text-[8px] text-[hsla(0,0%,100%,.2)]">0</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PostCreatePhoneCoverPreview({
  caption,
  cover4x3Url,
  cover3x4Url,
  ratio,
  onRatioChange
}: PostCreatePhoneCoverPreviewProps) {
  const { current } = useProfile();
  const isHorizontal = ratio === '4:3';
  const coverUrl = isHorizontal ? cover4x3Url : cover3x4Url;
  const creatorName = current?.username || current?.name || 'creator';
  const selectedPadding = isHorizontal ? 'pb-[75%]' : 'pb-[133.33%]';
  const oppositePadding = isHorizontal ? 'pb-[133.33%]' : 'pb-[75%]';

  return (
    <div className="relative h-[515px] w-[243px] overflow-hidden rounded-[30px] bg-black [clip-path:inset(1px_round_30px)]">
      <img
        src="/phone_layout.png"
        alt=""
        className="pointer-events-none absolute top-0 z-1 h-[515px] w-[243px]"
      />
      {isHorizontal ? (
        <div className="absolute left-[5px] top-[32px] z-1 h-[26px] w-[232px] bg-black">
          <img src="/phone_header_layout.png" alt="" className="pointer-events-none" />
        </div>
      ) : null}
      <div className="absolute top-[66px] w-full bg-black">
        {isHorizontal ? <HorizontalHeaderCard /> : null}
        <div className="flex items-start justify-between px-2.5">
          <div className="mr-1.5 flex h-[400px] flex-1 flex-col items-center justify-start overflow-hidden">
            <CoverCard
              paddingClassName={selectedPadding}
              coverUrl={coverUrl}
              caption={caption}
              avatarUrl={current?.avatar}
              creatorName={creatorName}
            />
            <PlaceholderCard paddingClassName={oppositePadding} />
            <PlaceholderCard paddingClassName={oppositePadding} />
          </div>
          <div className="flex h-[400px] flex-1 flex-col items-center justify-start overflow-hidden">
            <PlaceholderCard paddingClassName={selectedPadding} />
            <PlaceholderCard paddingClassName={selectedPadding} />
          </div>
        </div>
      </div>
      <div className="absolute bottom-[69px] left-0 right-0 z-1 m-auto flex h-[22px] w-[104px] items-center rounded-[9999px] bg-white">
        <div
          role="button"
          tabIndex={0}
          aria-pressed={isHorizontal}
          onClick={() => onRatioChange('4:3')}
          onKeyDown={event => {
            if (event.key === 'Enter' || event.key === ' ') onRatioChange('4:3');
          }}
          className={`relative flex flex-1 cursor-pointer justify-center text-[10px] after:absolute after:right-0 after:h-3 after:w-px after:bg-[#f2f2f4] after:content-[''] ${isHorizontal ? 'text-[#fe2c55]' : 'text-[rgba(22,24,35,.34)]'}`}
        >
          Horizontal
        </div>
        <div
          role="button"
          tabIndex={0}
          aria-pressed={!isHorizontal}
          onClick={() => onRatioChange('3:4')}
          onKeyDown={event => {
            if (event.key === 'Enter' || event.key === ' ') onRatioChange('3:4');
          }}
          className={`relative flex flex-1 cursor-pointer justify-center text-[10px] ${isHorizontal ? 'text-[rgba(22,24,35,.34)]' : 'text-[#fe2c55]'}`}
        >
          Vertical
        </div>
      </div>
    </div>
  );
}
