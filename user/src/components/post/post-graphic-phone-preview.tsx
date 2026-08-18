'use client';

import { Carousel, CarouselProgressControl } from '@components/ui/carousel';
import type { GraphicFileItem } from '@hooks/use-post-graphic-create';
import { GRAPHIC_SLIDE_DURATION_MS } from '@lib/post-graphic';
import { useProfile } from '@providers/profile.provider';
import { useState } from 'react';
import { DouyinFavicon } from 'src/icons';

interface PostGraphicPhonePreviewProps {
  items: GraphicFileItem[];
  caption: string;
}

export default function PostGraphicPhonePreview({ items, caption }: PostGraphicPhonePreviewProps) {
  const { current } = useProfile();
  const [isPlaying, setIsPlaying] = useState(false);
  const previewItems = items.filter(item => Boolean(item.previewUrl));
  const itemSignature = previewItems.map(item => `${item.id}:${item.fileId || item.file?.lastModified || ''}`).join('|');

  return (
    <div className="relative h-[515px] overflow-hidden rounded-[30px] bg-black [clip-path:inset(1px_round_30px)]">
      <div className="relative h-full w-full bg-black">
        <Carousel
          className="h-[505px] w-[243px]"
          playing={isPlaying}
          interval={GRAPHIC_SLIDE_DURATION_MS}
          resetKey={itemSignature}
          slideClassName="bg-black"
          control={<CarouselProgressControl className="bottom-[43px] z-[11]" />}
        >
          {previewItems.map((item, index) => (
            <img key={item.id} src={item.previewUrl} alt={`Graphic preview ${index + 1} of ${previewItems.length}`} className="h-full w-full object-contain" />
          ))}
        </Carousel>
        <button
          type="button"
          aria-label={isPlaying ? 'Pause graphic preview' : 'Play graphic preview'}
          className="absolute inset-0 z-[8] cursor-pointer bg-transparent"
          onClick={() => setIsPlaying(value => !value)}
        >
          {!isPlaying ? <img src="/play_icon.png" alt="" className="pointer-events-none absolute left-1/2 top-1/2 w-9 -translate-x-1/2 -translate-y-1/2" /> : null}
        </button>
      </div>
      <img src="/phone_image_layout.png" alt="" className="pointer-events-none absolute top-0 h-[515px] w-[243px]" />
      {current?.avatar ? <img src={current.avatar} alt="" className="absolute right-[10px] top-[184px] h-[30px] w-[30px] rounded-full border-[0.5px] border-white object-cover" /> : null}
      <div className="absolute right-[5px] top-[178px] h-[278px]">
        <img src="/phone_action_layout.png" alt="" className="pointer-events-none relative block h-[278px]" />
        <img src="/douyin_play_icon.png" alt="" className={`absolute bottom-2 right-1 h-[30px] w-[30px] rounded-full object-cover ${isPlaying ? 'post-create-douyin-disc-playing' : ''}`} />
      </div>
      <div className="absolute bottom-[65px] left-3 z-[9] flex flex-col items-start overflow-hidden text-white">
        <div className="w-[134px] truncate text-xs font-medium">@{current?.username || 'creator'}</div>
        {caption ? (
          <div className="-ml-2.5 line-clamp-4 w-[200px] scale-90 break-all text-xs leading-[17px]">
            {caption}
          </div>
        ) : null}
        <div className="-ml-[22px] flex h-[18px] scale-75 items-center text-xs leading-[18px] tracking-[0.027em] text-white [text-shadow:0_0.687151px_0.687151px_rgba(0,0,0,0.15)]">
          <DouyinFavicon className="mr-[3px] shrink-0 text-xs" />
          <div className="flex h-[13px] w-[163px] items-center overflow-hidden [mask-image:linear-gradient(90deg,transparent_-0.41%,#000_2.87%,#000_96.31%,transparent_99.59%)] [-webkit-mask-image:linear-gradient(90deg,transparent_-0.41%,#000_2.87%,#000_96.31%,transparent_99.59%)]">
            <div className="post-create-music-marquee w-max whitespace-nowrap">
              {current?.username || 'creator'} original sound&nbsp;&nbsp;&nbsp;{current?.username || 'creator'} original sound
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
