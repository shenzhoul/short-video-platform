import { Area } from 'react-easy-crop';

function createImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new window.Image();
    image.addEventListener('load', () => resolve(image));
    image.addEventListener('error', (error) => reject(error));
    image.setAttribute('crossOrigin', 'anonymous');
    image.src = url;
  });
}

export async function getCroppedImg(imageSrc: string, pixelCrop: Area, rotation = 0): Promise<Blob | null> {
  const image = await createImage(imageSrc);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  // Compute safe canvas area: expand to fit rotated image, limit to 4096 due to iOS canvas size constraints.
  const safeArea = Math.min(Math.max(image.width, image.height) * 2, 4096);

  canvas.width = safeArea;
  canvas.height = safeArea;

  if (ctx) {
    ctx.translate(safeArea / 2, safeArea / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.translate(-safeArea / 2, -safeArea / 2);
    ctx.drawImage(
      image,
      (safeArea - image.width) / 2,
      (safeArea - image.height) / 2
    );
    const data = ctx.getImageData(0, 0, safeArea, safeArea);
    canvas.width = pixelCrop.width;
    canvas.height = pixelCrop.height;
    ctx.putImageData(
      data,
      Math.round(-safeArea / 2 + image.width / 2 - pixelCrop.x),
      Math.round(-safeArea / 2 + image.height / 2 - pixelCrop.y)
    );
    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        resolve(blob);
      }, 'image/jpeg');
    });
  }
  return null;
}

export async function getRotatedImage(imageSrc: string, _orientation: number): Promise<string> {
  // For simplicity, just return the original imageSrc for now. Implement EXIF orientation if needed.
  return imageSrc;
}
