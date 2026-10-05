import { LayoutGrid, PencilLine } from 'lucide-react';
import { useId, useState, type KeyboardEvent } from 'react';
import type { TaskId } from '../../core';
import { useI18n } from '../../i18n/react';
import { usePrefs } from '../context';
import type { Panel } from '../prefs';
import { ChoosePanel, WritePanel } from './AddPanels';
import type { DraftRow } from './PlanEditor';
import { Sheet } from './Sheet';
import { TaskList } from './TaskList';

const PANELS: readonly Panel[] = ['write', 'choose'];

function PanelIcon({ panel }: { readonly panel: Panel }) {
  return panel === 'write' ? (
    <PencilLine aria-hidden="true" size={24} strokeWidth={2.4} />
  ) : (
    <LayoutGrid aria-hidden="true" size={24} strokeWidth={2.4} />
  );
}

interface Draft {
  readonly draft: string;
  readonly setDraft: (s: string) => void;
  readonly rows: readonly DraftRow[] | null;
  readonly setRows: (rows: DraftRow[] | null) => void;
}

/** Wide screens: the two options sit beside the list as tabs. */
function SideOptions({ draft, setDraft, rows, setRows }: Draft) {
  const [prefs, setPrefs] = usePrefs();
  const { t } = useI18n();
  const id = useId();
  const panel = prefs.panel;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const next: Panel = panel === 'write' ? 'choose' : 'write';
    setPrefs({ panel: next });
    document.getElementById(`${id}-${next}`)?.focus();
  };

  return (
    <div className="side__card">
      <div className="seg seg--big" role="tablist" aria-label={t('side.label')} onKeyDown={onKeyDown}>
        {PANELS.map((p) => (
          <button
            key={p}
            id={`${id}-${p}`}
            type="button"
            role="tab"
            className="seg__btn"
            aria-selected={panel === p}
            aria-controls={`${id}-panel`}
            tabIndex={panel === p ? 0 : -1}
            onClick={() => setPrefs({ panel: p })}
          >
            <PanelIcon panel={p} />
            <span>{t(p === 'write' ? 'side.write' : 'side.choose')}</span>
          </button>
        ))}
      </div>
      <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${panel}`} className="side__panel">
        {panel === 'write' ? <WritePanel draft={draft} setDraft={setDraft} rows={rows} setRows={setRows} /> : <ChoosePanel />}
      </div>
    </div>
  );
}

export function Home({
  onOpenTask,
  onOpenReview,
}: {
  readonly onOpenTask: (id: TaskId) => void;
  readonly onOpenReview: () => void;
}) {
  const { t } = useI18n();
  // What is being written survives switching between the side panel and the phone sheet.
  const [draft, setDraft] = useState('');
  const [rows, setRows] = useState<DraftRow[] | null>(null);
  const [sheet, setSheet] = useState<Panel | null>(null);

  return (
    <div className="home">
      <aside className="side" aria-label={t('side.label')}>
        <SideOptions draft={draft} setDraft={setDraft} rows={rows} setRows={setRows} />
      </aside>

      <TaskList onOpenTask={onOpenTask} onOpenReview={onOpenReview} />

      {/* Narrow screens: the same two options as big buttons at the bottom. */}
      <div className="bottombar" role="group" aria-label={t('side.label')}>
        {PANELS.map((p) => (
          <button
            key={p}
            type="button"
            className={`btn btn--big ${p === 'write' ? 'btn--primary' : 'btn--accent-quiet'}`}
            onClick={() => setSheet(p)}
          >
            <PanelIcon panel={p} />
            {t(p === 'write' ? 'side.write' : 'side.choose')}
          </button>
        ))}
      </div>

      {sheet ? (
        <Sheet
          title={t(sheet === 'write' ? 'side.write' : 'side.choose')}
          onClose={() => setSheet(null)}
          focus={sheet === 'write' ? 'field' : 'title'}
        >
          {sheet === 'write' ? (
            <WritePanel draft={draft} setDraft={setDraft} rows={rows} setRows={setRows} onAdded={() => setSheet(null)} />
          ) : (
            <ChoosePanel />
          )}
        </Sheet>
      ) : null}
    </div>
  );
}
