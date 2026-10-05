/**
 * One message at a time, at the bottom of the screen, read out by screen
 * readers. It stays ten seconds and waits while it is hovered or focused, so
 * nobody has to rush to press Undo.
 */
import { Redo2, Undo2, X } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../../i18n/react';
import { useToast } from '../context';
import { sheetLayer } from '../sheetLayer';

const LIFETIME_MS = 10_000;
/** A second tap this soon after a message appears is the tail of a double tap, not a decision. */
const SETTLE_MS = 500;

export function ToastHost() {
  const { current, dismiss } = useToast();
  const { t } = useI18n();
  const [paused, setPaused] = useState(false);
  const shownAt = useRef(0);
  const host = useSyncExternalStore(sheetLayer.subscribe, sheetLayer.top, () => null);

  useEffect(() => {
    if (!current || paused) return;
    const id = window.setTimeout(dismiss, LIFETIME_MS);
    return () => window.clearTimeout(id);
  }, [current, paused, dismiss]);

  useEffect(() => {
    setPaused(false);
    shownAt.current = performance.now();
  }, [current]);

  const Icon = current?.action?.kind === 'redo' ? Redo2 : Undo2;

  const region = (
    <div className="toasts" role="status" aria-live="polite" aria-atomic="true">
      {current ? (
        <div
          key={current.id}
          className={`toast toast--${current.tone}`}
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocus={() => setPaused(true)}
          onBlur={() => setPaused(false)}
        >
          <p className="toast__msg">{current.message}</p>
          {current.action ? (
            <button
              type="button"
              className="toast__action"
              onClick={() => {
                if (performance.now() - shownAt.current < SETTLE_MS) return;
                current.action?.run();
              }}
            >
              {current.action.kind !== 'takeBack' ? <Icon aria-hidden="true" size={20} strokeWidth={2.5} /> : null}
              {current.action.label}
            </button>
          ) : null}
          <button type="button" className="toast__close" aria-label={t('toast.dismiss')} onClick={dismiss}>
            <X aria-hidden="true" size={22} strokeWidth={2.5} />
          </button>
        </div>
      ) : null}
    </div>
  );

  return createPortal(region, host ?? document.body);
}
