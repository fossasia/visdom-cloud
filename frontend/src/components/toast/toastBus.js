/* Copyright 2017-present, The Visdom Authors */

const listeners = new Set();
let idCounter = 0;

const DEFAULT_DURATION = 4000;
const DEFAULT_POSITION = 'top-right';
const DEFAULT_SHAPE = 'rect';

const emit = (action) => {
  listeners.forEach((fn) => fn(action));
};

export const subscribeToasts = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export const showToast = (message, type = 'info', options = {}) => {
  const {
    duration = DEFAULT_DURATION,
    position = DEFAULT_POSITION,
    shape = DEFAULT_SHAPE,
  } = options;

  const id = `toast-${Date.now()}-${idCounter++}`;
  emit({ type: 'add', toast: { id, message, type, duration, position, shape } });
  return id;
};

export const dismissToast = (id) => {
  emit({ type: 'dismiss', id });
};
