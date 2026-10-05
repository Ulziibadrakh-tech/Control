/**
 * A sheet: a modal panel on top of the page (a bottom sheet on phones).
 * Built on the native <dialog>, so focus stays inside, Escape closes it and
 * the page behind is inert. Rendering the component opens it; unmounting
 * closes it and gives focus back to whatever opened it.
 */
import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useI18n } from '../../i18n/react';
import { sheetLayer } from '../sheetLayer';

interface SheetProps {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
  /** Where focus goes first. The title by default, so phones do not pop the keyboard unasked. */
  readonly focus?: 'title' | 'field';
}

export function Sheet({ title, onClose, children, footer, focus = 'title' }: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const { t } = useI18n();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
    const field = focus === 'field' ? dialog.querySelector<HTMLElement>('input, textarea') : null;
    (field ?? dialog.querySelector<HTMLElement>('[data-autofocus]'))?.focus();
    sheetLayer.push(dialog);
    return () => {
      sheetLayer.remove(dialog);
      if (dialog.open) dialog.close();
      if (opener && opener.isConnected) opener.focus();
    };
  }, [focus]);

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onCloseRef.current();
      }}
      onMouseDown={(e) => {
        // A press on the dimmed area outside the panel closes the sheet.
        if (e.target === e.currentTarget) onCloseRef.current();
      }}
    >
      <div className="sheet__panel">
        <header className="sheet__head">
          <h2 id={titleId} className="sheet__title" tabIndex={-1} data-autofocus>
            {title}
          </h2>
          <button type="button" className="sheet__close" onClick={() => onCloseRef.current()}>
            <X aria-hidden="true" size={22} strokeWidth={2.5} />
            <span>{t('common.close')}</span>
          </button>
        </header>
        <div className="sheet__body">{children}</div>
        {footer ? <footer className="sheet__foot">{footer}</footer> : null}
      </div>
    </dialog>
  );
}
