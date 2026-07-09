/* Copyright 2017-present, The Visdom Authors */
import { createPortal } from 'react-dom';

// Renders modals into document.body regardless of where they're triggered
// from in the tree — otherwise a modal opened from inside the sidebar stays
// a DOM descendant of it, and sidebar-scoped CSS (e.g. `.gc-sidebar .gc-btn`)
// leaks into the modal even though it's visually a full-screen overlay.
const ModalPortal = ({ onClose, wide, children }) => {
  return createPortal(
    <div className="gc-modal-overlay" onClick={onClose}>
      <div className={`gc-panel gc-modal ${wide ? 'gc-modal-wide' : ''}`} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>,
    document.body
  );
};

export default ModalPortal;
