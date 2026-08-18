import * as sharp from 'sharp';

interface HslComponents {
  h: number;
  s: number;
  l: number;
}

export function rgbToHslComponents(r: number, g: number, b: number): HslComponents {
  r /= 255;
  g /= 255;
  b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    if (max === g) h = (b - r) / d + 2;
    if (max === b) h = (r - g) / d + 4;

    h /= 6;
  }

  return {
    h: Math.floor(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100)
  };
}

export function rgbToHsl(r: number, g: number, b: number) {
  const { h, s, l } = rgbToHslComponents(r, g, b);

  return `hsl(${h}deg ${s}% ${l}%)`;
}

export function rgbToCoverBackgroundHsl(r: number, g: number, b: number) {
  const { h, s } = rgbToHslComponents(r, g, b);

  return `hsl(${h}deg ${Math.min(s, 40)}% 15%)`;
}

export async function extractDominantHsl(imagePath: string) {
  const { dominant } = await sharp(imagePath)
    .resize(32, 32, { fit: 'cover' })
    .stats();

  return rgbToCoverBackgroundHsl(dominant.r, dominant.g, dominant.b);
}
