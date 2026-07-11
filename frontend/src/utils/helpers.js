/* Copyright 2017-present, The Visdom Authors */

export const ROLE_BADGE = {
  admin: 'gc-badge-admin',
  member: 'gc-badge-member',
  viewer: 'gc-badge-viewer',
};

export const parseApiError = (err, defaultMsg = 'An error occurred.') => {
  const detail = err.response?.data?.detail;
  if (typeof detail === 'string') {
    return detail;
  }
  if (Array.isArray(detail)) {
    return detail.map((d) => d.msg).join(', ');
  }
  return defaultMsg;
};
