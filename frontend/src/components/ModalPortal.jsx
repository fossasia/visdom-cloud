/* Copyright 2017-present, The Visdom Authors */
import { createPortal } from 'react-dom';

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
