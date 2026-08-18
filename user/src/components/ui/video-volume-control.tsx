import { PointerEvent, useRef } from 'react';
import { MuteIcon, VolumeIcon } from 'src/icons';

interface VideoVolumeControlProps {
  volume: number;
  muted: boolean;
  onChange: (volume: number) => void;
  onToggleMute: () => void;
}

export default function VideoVolumeControl({
  volume,
  muted,
  onChange,
  onToggleMute
}: VideoVolumeControlProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const volumePercent = muted ? 0 : Math.round(volume * 100);

  const updateVolumeFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const track = trackRef.current;
    if (!track) return;
    const bounds = track.getBoundingClientRect();
    const nextPercent = ((bounds.bottom - event.clientY) / bounds.height) * 100;
    onChange(Math.max(0, Math.min(100, nextPercent)) / 100);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    updateVolumeFromPointer(event);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    updateVolumeFromPointer(event);
  };

  return (
    <div className="group/volume relative z-60 flex h-8 w-8 items-center justify-center">
      <span className="absolute bottom-8 h-3 w-14" aria-hidden />
      <div className="pointer-events-none absolute bottom-11 right-1/2 z-60 flex h-49 w-14 translate-x-1/2 flex-col items-center rounded-2xl bg-[#252631]/95 py-2 opacity-0 shadow-xl backdrop-blur-md transition-opacity group-hover/volume:pointer-events-auto group-hover/volume:opacity-100 group-focus-within/volume:pointer-events-auto group-focus-within/volume:opacity-100">
        <span className="text-[10px] font-semibold leading-4 text-white">{volumePercent}</span>
        <div
          ref={trackRef}
          role="slider"
          tabIndex={0}
          aria-label="Volume"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={volumePercent}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          className="relative my-2.5 flex min-h-0 w-7 flex-1 touch-none cursor-pointer items-center justify-center outline-none"
        >
          <span className="absolute bottom-0 top-0 w-1 rounded-full bg-white/25" />
          <span
            className="absolute bottom-0 w-1 rounded-full bg-white"
            style={{ height: `${volumePercent}%` }}
          />
          <span
            className="absolute h-3 w-3 rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,.35)]"
            style={{ bottom: `calc(${volumePercent}% - 6px)` }}
          />
        </div>
      </div>

      <button
        type="button"
        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-sm hover:bg-white/15"
        aria-label={muted ? 'Unmute' : 'Mute'}
        onClick={onToggleMute}
      >
        {muted ? <MuteIcon className="text-3xl" /> : <VolumeIcon className="text-3xl" />}
      </button>
    </div>
  );
}
