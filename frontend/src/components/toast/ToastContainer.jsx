/* Copyright 2017-present, The Visdom Authors */
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Toast from './Toast';
import { subscribeToasts } from './toastBus';

const POSITIONS = [
  'top-left',
  'top-center',
  'top-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
];

const ToastContainer = () => {
  const [toasts, setToasts] = useState([]);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    return subscribeToasts((action) => {
      if (action.type === 'add') {
        setToasts((prev) => [...prev, action.toast]);
      } else if (action.type === 'dismiss') {
        removeToast(action.id);
      }
    });
  }, [removeToast]);

  if (toasts.length === 0) {
    return null;
  }

  return createPortal(
    <>
      {POSITIONS.map((position) => {
        const positionToasts = toasts.filter(
          (t) => (t.position || 'top-right') === position
        );
        if (positionToasts.length === 0) return null;

        return (
          <div
            className={`visdom-toast-container visdom-toast-container-${position}`}
            key={position}
          >
            {positionToasts.map((toast) => (
              <Toast
                duration={toast.duration}
                key={toast.id}
                message={toast.message}
                onDismiss={() => removeToast(toast.id)}
                shape={toast.shape}
                type={toast.type}
              />
            ))}
          </div>
        );
      })}
    </>,
    document.body
  );
};

export default ToastContainer;
