import { appMessage as message } from '@lib/antd-message';

export function getResponseError(data: any) {
  if (!data) {
    return '';
  }

  if (Array.isArray(data.message)) {
    const item = data.message[0];
    if (!item.constraints) {
      return data.error || 'Bad request!';
    }
    return Object.values(item.constraints)[0];
  }

  // TODO - parse for langauge or others
  return typeof data.message === 'string' && (data.message === 'cyclic object value' ? 'Bad request!' : data.message);
}

export function validateUsername(text: string) {
  return /^[a-z0-9]+$/.test(text);
}

export async function showError(e: any) {
  const error = await e;
  message.error(error?.message || e || 'Something went wrong, please try again later');
  // toast.error(error?.message || e || 'Something went wrong, please try again later');
}

export async function showSuccess(info, text = 'Successful implementation') {
  // toast.success(info || text);
  message.success(info || text);
}

/**
 * Converts a file to a data URL (base64) for immediate display
 * Useful when you need to show an image before it's uploaded to the server
 *
 * @param file - The file to convert
 * @returns Promise that resolves to a base64 data URL string
 *
 * @example
 * ```typescript
 * const imagePreview = await convertFileToDataUrl(file);
 * setImageSrc(imagePreview); // Can be used directly in img src
 * ```
 */
export function convertFileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result;
      if (typeof result === 'string') {
        resolve(result);
      } else {
        reject(new Error('Failed to convert file to data URL'));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

/**
 * Gets the best available image URL for display
 * Tries to use the server URL first, falls back to base64 if not available
 *
 * @param fileInfo - File information object that may contain a URL
 * @param file - The original file to convert to base64 if needed
 * @returns Promise that resolves to either a server URL or base64 data URL
 *
 * @example
 * ```typescript
 * const displayUrl = await getImageDisplayUrl(uploadResult.fileInfo, originalFile);
 * setImageSrc(displayUrl); // Always gets a displayable URL
 * ```
 */
export async function getImageDisplayUrl(fileInfo: any, file: File): Promise<string> {
  // If server provided a URL, use it
  if (fileInfo?.url) {
    return fileInfo.url;
  }

  // Otherwise, convert file to base64 for immediate display
  return convertFileToDataUrl(file);
}
