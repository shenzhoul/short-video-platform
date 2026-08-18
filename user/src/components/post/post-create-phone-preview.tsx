'use client';

import { useProfile } from '@providers/profile.provider';
import { useEffect, useRef, useState } from 'react';
import { DouyinFavicon } from 'src/icons';

interface PostCreatePhonePreviewProps {
  previewUrl: string;
  caption: string;
}

export default function PostCreatePhonePreview({
  previewUrl,
  caption
}: PostCreatePhonePreviewProps) {
  const { current } = useProfile();
  const creatorName = current?.username || 'creator';
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    setIsPlaying(false);
  }, [previewUrl]);

  const togglePlayback = async () => {
    const video = videoRef.current;
    if (!video || !previewUrl) return;

    if (video.paused) {
      try {
        await video.play();
      } catch {
        setIsPlaying(false);
      }
    } else {
      video.pause();
    }
  };

  return (
    <div className="relative h-[515px] overflow-hidden rounded-[30px] bg-black [clip-path:inset(1px_round_30px)]">
      <div className="relative h-full w-full bg-black">
        <video
          ref={videoRef}
          key={previewUrl}
          src={previewUrl || undefined}
          loop
          muted
          playsInline
          className="pointer-events-none aspect-[243/505] h-[505px] w-[243px] overflow-clip object-contain"
          onEnded={() => setIsPlaying(false)}
          onError={() => setIsPlaying(false)}
          onPause={() => setIsPlaying(false)}
          onPlay={() => setIsPlaying(true)}
        />
        <button
          type="button"
          aria-label={isPlaying ? 'Pause video preview' : 'Play video preview'}
          className="absolute inset-0 z-[8] cursor-pointer bg-transparent"
          onClick={togglePlayback}
        >
          {!isPlaying ? (
            <img
              src="/play_icon.png"
              alt=""
              className="pointer-events-none absolute left-1/2 top-1/2 w-9 -translate-x-1/2 -translate-y-1/2"
            />
          ) : null}
        </button>
        <div className="absolute bottom-[50px] left-[5px] z-[9] h-[14px] w-[calc(100%-10px)] rounded-md py-[5px]">
          <div className="absolute h-1 w-full rounded-md bg-[hsla(0,0%,100%,.2)]" />
          <div className="absolute left-0 h-1 w-0 rounded-md bg-white" />
          <div className="absolute left-0 z-[1] h-1 w-1 -translate-x-1/2 rounded-full bg-white" />
        </div>
      </div>
      <img
        src="/phone_layout.png"
        alt=""
        className="pointer-events-none absolute top-0 h-[515px] w-[243px]"
      />
      {current?.avatar ? (
        <img
          src={current.avatar}
          alt=""
          className="absolute right-[10px] top-[184px] h-[30px] w-[30px] rounded-[20px] border-[0.5px] border-white"
        />
      ) : null}
      <div className="absolute right-[5px] top-[178px] h-[278px]">
        <img
          src="/phone_action_layout.png"
          alt=""
          className="pointer-events-none relative block h-[278px]"
        />
        <img
          src="/douyin_play_icon.png"
          alt=""
          className={`absolute bottom-2 right-1 block h-[30px] w-[30px] overflow-hidden rounded-full object-cover ${isPlaying ? 'post-create-douyin-disc-playing' : ''}`}
        />
      </div>
      <div className="absolute bottom-[65px] left-3 flex flex-col items-start overflow-hidden">
        <div className="w-[134px] overflow-hidden truncate text-xs font-medium leading-[13px] tracking-[-0.8px] text-white [text-shadow:0_0.687151px_0.687151px_rgba(0,0,0,0.15)]">
          @{creatorName}
        </div>
        {caption ? (
          <div className="-ml-2.5 w-[200px] scale-90 overflow-hidden break-all text-xs leading-[17px] tracking-[0.05em] text-white [text-shadow:0_0.687151px_0.687151px_rgba(0,0,0,0.15)]">
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
