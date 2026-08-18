import { getCroppedImg, getRotatedImage } from '@lib/utils/crop/cropUtils';
import getOrientation from 'get-orientation/browser';
import React, { useCallback, useEffect, useState } from 'react';
import Cropper from 'react-easy-crop';

import RangeSlider from './range-slider';

interface ImageCropModalProps {
  file: File;
  aspect?: number;
  width?: number;
  height?: number;
  onDone: (blob: Blob) => void;
  onCancel: () => void;
  shape?: 'rect' | 'round';
}

const readFile = (file: File): Promise<string> => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(reader.result as string), false);
    reader.readAsDataURL(file);
  });
};

const ImageCropModal: React.FC<ImageCropModalProps> = ({ file, aspect, onDone, onCancel, shape = 'rect' }) => {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<any>(null);

  useEffect(() => {
    async function prepareImage() {
      const dataUrl = await readFile(file);
      // auto-rotate for phone pictures
      let orientation = 1;
      try {
        orientation = await (getOrientation as any).default(file);
      } catch {
        orientation = 1;
      }
      if (orientation > 1) {
        const rotated = await getRotatedImage(dataUrl, orientation);
        setImageSrc(rotated);
      } else {
        setImageSrc(dataUrl);
      }
    }
    prepareImage();
  }, [file]);

  const onCropComplete = useCallback((_: any, croppedPixels: any) => {
    setCroppedAreaPixels(croppedPixels);
  }, []);

  const handleCrop = useCallback(async () => {
    if (!imageSrc || !croppedAreaPixels) return;
    const croppedBlob = await getCroppedImg(imageSrc, croppedAreaPixels, rotation);
    if (croppedBlob) onDone(croppedBlob);
  }, [imageSrc, croppedAreaPixels, rotation, onDone]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center">
      <div className="bg-surface relative flex h-full w-full max-w-2xl flex-col overflow-hidden rounded-lg shadow-lg sm:rounded-none pt-[60px] pb-[80px] md:py-0">
        <div className="overflow-y-auto p-4 sm:p-6">
          <h2 className="mb-4 text-lg font-semibold">Crop Image</h2>
          <div className="mb-4 flex w-full flex-col gap-2">
            <label className="text-sm">Zoom</label>
            <RangeSlider min={1} max={3} step={0.01} value={zoom} onChange={setZoom} />
            <label className="text-sm mt-2">Rotation</label>
            <RangeSlider min={0} max={360} step={1} value={rotation} onChange={setRotation} />
          </div>
          <div className="relative h-[45dvh] w-full rounded bg-surface-muted">
            {imageSrc ? (
              <Cropper
                image={imageSrc}
                crop={crop}
                zoom={zoom}
                rotation={rotation}
                aspect={aspect}
                onCropChange={setCrop}
                onCropComplete={onCropComplete}
                onZoomChange={setZoom}
                onRotationChange={setRotation}
                cropShape={shape}
                showGrid
              />
            ) : null}
          </div>
        </div>
        <div className="border-t border-white/10 p-4 sm:p-6">
          <div className="flex gap-3 flex-row justify-end">
            <button
              type="button"
              className="w-full rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600 sm:w-auto"
              onClick={handleCrop}
            >
              Crop & Confirm
            </button>
            <button
              type="button"
              className="w-full rounded bg-gray-300 px-4 py-2 opacity-70 hover:bg-gray-400 sm:w-auto"
              onClick={onCancel}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ImageCropModal;
