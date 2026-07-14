/* Copyright 2017-present, The Visdom Authors */
import { dismissToast, showToast } from './toastBus';

const toast = {
  show: showToast,
  success: (message, options) => showToast(message, 'success', options),
  error: (message, options) => showToast(message, 'error', options),
  info: (message, options) => showToast(message, 'info', options),
  warning: (message, options) => showToast(message, 'warning', options),
  dismiss: dismissToast,
};

export const useToast = () => toast;

export default useToast;
