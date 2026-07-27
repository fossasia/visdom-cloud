/* Copyright 2017-present, The Visdom Authors */

const NAMESPACE = 'visdom:';

const attempt = (fn, fallback = null) => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

const store = () => attempt(() => window.sessionStorage);

const scopedKey = (key, userId) => `${NAMESPACE}${userId || 'anon'}:${key}`;

export const readScoped = (key, userId, fallback = null) => {
  const target = store();
  if (!target || !userId) return fallback;

  return attempt(() => {
    const raw = target.getItem(scopedKey(key, userId));
    return raw === null ? fallback : JSON.parse(raw);
  }, fallback);
};

export const writeScoped = (key, userId, value) => {
  const target = store();
  if (!target || !userId) return;

  attempt(() => target.setItem(scopedKey(key, userId), JSON.stringify(value)));
};

const purge = (target, prefixes) => {
  if (!target) return;

  attempt(() =>
    Object.keys(target)
      .filter((key) => prefixes.some((prefix) => key.startsWith(prefix)))
      .forEach((key) => target.removeItem(key))
  );
};

export const clearAppStorage = () => {
  purge(store(), [NAMESPACE]);
  purge(attempt(() => window.localStorage), [NAMESPACE, 'visdom-']);
};
