/* Copyright 2017-present, The Visdom Authors */

const DEFAULT_TTL_MS = 30000;

const entries = new Map();
const inflight = new Map();

export const cachedGet = (key, fetcher, { ttl = DEFAULT_TTL_MS, force = false } = {}) => {
  if (!force) {
    const entry = entries.get(key);
    if (entry && entry.expiresAt > Date.now()) {
      return Promise.resolve(entry.value);
    }

    const pending = inflight.get(key);
    if (pending) return pending;
  }

  const request = fetcher()
    .then((value) => {
      entries.set(key, { value, expiresAt: Date.now() + ttl });
      return value;
    })
    .finally(() => {
      if (inflight.get(key) === request) inflight.delete(key);
    });

  inflight.set(key, request);
  return request;
};

export const invalidate = (prefix) => {
  [...entries.keys()].filter((key) => key.startsWith(prefix)).forEach((key) => entries.delete(key));
  [...inflight.keys()].filter((key) => key.startsWith(prefix)).forEach((key) => inflight.delete(key));
};

export const clearRequestCache = () => {
  entries.clear();
  inflight.clear();
};
