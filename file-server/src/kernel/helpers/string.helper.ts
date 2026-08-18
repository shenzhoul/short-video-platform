import { posix, sep } from "path";

/**
 * Convert POSIX path to platform-specific path
 * Useful when reading paths from database that are stored in POSIX format
 * @param posixPath - The POSIX path to convert
 * @returns Platform-specific path
 */
export const fromPosixPath = (posixPath: string) => {
  if (!posixPath) return '';

  // On Windows, convert forward slashes to backslashes
  if (process.platform === 'win32') {
    return posixPath.replace(/\//g, '\\');
  }

  // On Unix-like systems, keep as-is (already POSIX)
  return posixPath;
};

export const getExt = (path: string) => {
  const i = path.lastIndexOf('.');
  return i < 0 ? '' : path.substr(i);
};

export const isUrl = (str: string) => {
  /* eslint-disable */
  const regex = /(http|https):\/\/(\w+:{0,1}\w*)?(\S+)(:[0-9]+)?(\/|\/([\w#!:.?+=&%!\-\/]))?/;
  return regex.test(str);
  /* eslint-enable */
};

/**
 * to Linux path example /var/www/etc/
 * @param str
 * @returns
 */
export const toPosixPath = (str: string) => {
  if (!str) return '';

  return str.split(sep).join(posix.sep);
};

/**
 * get file name from the path
 * @type {String}
 */
export const getFileName = (fullPath: string, removeExtension: boolean) => {
  /* eslint-disable */
  const name = fullPath.replace(/^.*[\\\/]/, '');

  return removeExtension ? name.replace(/\.[^/.]+$/, '') : name;
  /* eslint-enable */
};

export const randomString = (len: number, charSetInput?: string) => {
  const charSet = charSetInput
    || 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let randomStr = '';
  for (let i = 0; i < len; i += 1) {
    const randomPoz = Math.floor(Math.random() * charSet.length);
    randomStr += charSet.substring(randomPoz, randomPoz + 1);
  }
  return randomStr;
};

export const getFilePath = (fullPath) => {
  if (!fullPath) return '';
  const posixPath = toPosixPath(fullPath);
  return posixPath.substring(0, posixPath.lastIndexOf('/'));
};