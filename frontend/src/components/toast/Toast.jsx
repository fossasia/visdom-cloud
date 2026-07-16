/* Copyright 2017-present, The Visdom Authors */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';

const EXIT_ANIMATION_MS = 200;

const ICONS = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const Toast = ({ message, type = 'info', duration = 4000, shape = 'rect', onDismiss }) => {
  const [isLeaving, setIsLeaving] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const isLeavingRef = useRef(false);
  const dismissTimerRef = useRef(null);
  const exitTimerRef = useRef(null);
  const remainingRef = useRef(duration);
  const startedAtRef = useRef(0);
  const onDismissRef = useRef(onDismiss);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  const startExit = useCallback(() => {
    if (isLeavingRef.current) return;
    isLeavingRef.current = true;
    setIsLeaving(true);
    exitTimerRef.current = setTimeout(() => onDismissRef.current(), EXIT_ANIMATION_MS);
  }, []);

  const startDismissTimer = useCallback(
    (ms) => {
      if (ms <= 0) return;
      startedAtRef.current = Date.now();
      dismissTimerRef.current = setTimeout(startExit, ms);
    },
    [startExit]
  );

  useEffect(() => {
    remainingRef.current = duration;
    startDismissTimer(duration);
    return () => {
      clearTimeout(dismissTimerRef.current);
      clearTimeout(exitTimerRef.current);
    };
  }, [duration, startDismissTimer]);

  const handleMouseEnter = () => {
    if (duration <= 0 || isLeavingRef.current) return;
    clearTimeout(dismissTimerRef.current);
    remainingRef.current -= Date.now() - startedAtRef.current;
    setIsPaused(true);
  };

  const handleMouseLeave = () => {
    if (duration <= 0 || isLeavingRef.current) return;
    setIsPaused(false);
    startDismissTimer(remainingRef.current);
  };

  const isPill = shape === 'pill';
  const Icon = ICONS[type] || Info;
  const isSevere = type === 'error' || type === 'warning';

  const className = [
    'visdom-toast',
    `visdom-toast-${type}`,
    isPill ? 'visdom-toast-pill' : '',
    isLeaving ? 'visdom-toast-leaving' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={className}
      role={isSevere ? 'alert' : 'status'}
      aria-live={isSevere ? 'assertive' : 'polite'}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {!isPill && (
        <span className="visdom-toast-icon" aria-hidden="true">
          <Icon size={16} />
        </span>
      )}

      <span className="visdom-toast-message">{message}</span>

      {!isPill && (
        <button
          aria-label="Dismiss notification"
          className="visdom-toast-close"
          onClick={startExit}
          type="button"
        >
          &times;
        </button>
      )}

      {!isPill && duration > 0 && !isLeaving && (
        <div
          className="visdom-toast-progress"
          style={{
            animationDuration: `${duration}ms`,
            animationPlayState: isPaused ? 'paused' : 'running',
          }}
        />
      )}
    </div>
  );
};

export default Toast;
