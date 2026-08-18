export const setRedirectUrl = (url: string) => {
  if (typeof window !== 'undefined') {
    localStorage.setItem('redirectUrl', url);
  }
};

export const getRedirectUrl = () => {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('redirectUrl');
  }
  return null;
};

export const removeRedirectUrl = () => {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('redirectUrl');
  }
};
