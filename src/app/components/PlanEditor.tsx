/**
 * Breaking a new task into steps, right when it is written. Each step says who
 * does it and, only if it has to, what it waits for. The rounds are worked out
 * while you type: steps that wait for nothing all start straight away,
 * together. Rows never move; only their round number changes.
 */
import { Plus, X } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import {
  cleanText,
  levels,
  peopleWithRole,
  people,
  shapeOf,
  waitCost,
  wouldCycle,
  type DraftStep,
  type PersonId,
  type RoleKey,
  type Workspace,
} from '../../core';
import { useI18n } from '../../i18n/react';
import { useWords, useWorkspace } from '../context';

export type Who = { readonly kind: 'person'; readonly id: PersonId } | { readonly kind: 'group'; readonly role: RoleKey };

export interface DraftRow {
  readonly key: string;
  readonly text: string;
  readonly who: Who;
  readonly after: readonly string[];
}

let seq = 0;
export const newRow = (me: PersonId): DraftRow => ({ key: `row${++seq}`, text: '', who: { kind: 'person', id: me }, after: [] });

type GroupRole = Extract<RoleKey, 'student' | 'parent' | 'teacher'>;
const GROUP_ROLES: readonly GroupRole[] = ['student', 'parent', 'teacher'];

/** The rows as steps for the core: a group becomes one step per person, empty rows drop out, and so do waits for them. */
export function expandRows(ws: Workspace, rows: readonly DraftRow[]): DraftStep[] {
  const filled = rows.filter((r) => cleanText(r.text) !== '');
  const copies = new Map<string, string[]>();
  for (const r of filled) {
    copies.set(
      r.key,
      r.who.kind === 'person' ? [r.key] : peopleWithRole(ws, r.who.role).map((p) => `${r.key}:${p.id}`),
    );
  }
  const out: DraftStep[] = [];
  for (const r of filled) {
    const after = r.after.flatMap((k) => copies.get(k) ?? []);
    if (r.who.kind === 'person') out.push({ key: r.key, text: r.text, who: r.who.id, after });
    else for (const p of peopleWithRole(ws, r.who.role)) out.push({ key: `${r.key}:${p.id}`, text: r.text, who: p.id, after });
  }
  return out;
}

const whoValue = (w: Who): string => (w.kind === 'person' ? `p:${w.id}` : `g:${w.role}`);
const parseWho = (v: string): Who =>
  v.startsWith('g:') ? { kind: 'group', role: v.slice(2) as RoleKey } : { kind: 'person', id: v.slice(2) as PersonId };

/** The "Who" choice: people, then everyone with a role. */
export function WhoSelect({
  value,
  onChange,
  id,
  groups = true,
}: {
  readonly value: Who;
  readonly onChange: (w: Who) => void;
  readonly id: string;
  readonly groups?: boolean;
}) {
  const ws = useWorkspace();
  const w = useWords();
  const { t } = useI18n();
  const options = people(ws);
  return (
    <select id={id} className="select" value={whoValue(value)} onChange={(e) => onChange(parseWho(e.target.value))}>
      {options.map((p) => (
        <option key={p.id} value={`p:${p.id}`}>
          {p.name} · {w.roleName(p.perms)}
        </option>
      ))}
      {groups
        ? GROUP_ROLES.map((role) => {
            const n = peopleWithRole(ws, role).length;
            return n > 0 ? (
              <option key={role} value={`g:${role}`}>
                {t(`group.${role}` as const, { n })}
              </option>
            ) : null;
          })
        : null}
    </select>
  );
}

export function PlanEditor({
  rows,
  setRows,
  me,
}: {
  readonly rows: readonly DraftRow[];
  readonly setRows: (rows: DraftRow[]) => void;
  readonly me: PersonId;
}) {
  const ws = useWorkspace();
  const { t } = useI18n();
  const id = useId();
  const [hint, setHint] = useState<{ key: string; n: number } | null>(null);

  const nodes = useMemo(() => rows.map((r) => ({ id: r.key, after: r.after })), [rows]);
  const level = useMemo(() => levels(nodes), [nodes]);
  const shape = useMemo(() => shapeOf(expandRows(ws, rows).map((d) => ({ id: d.key, after: d.after }))), [ws, rows]);

  const update = (key: string, patch: Partial<DraftRow>) => setRows(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const remove = (key: string) => {
    setRows(rows.filter((r) => r.key !== key).map((r) => ({ ...r, after: r.after.filter((a) => a !== key) })));
    if (hint?.key === key) setHint(null);
  };
  const toggleWait = (row: DraftRow, dep: string) => {
    const on = row.after.includes(dep);
    const after = on ? row.after.filter((a) => a !== dep) : [...row.after, dep];
    if (!on) {
      const n = waitCost(nodes, row.key, dep);
      setHint(n > 0 ? { key: row.key, n } : null);
    } else if (hint?.key === row.key) setHint(null);
    update(row.key, { after });
  };

  return (
    <div className="pedit">
      <ol className="psteps">
        {rows.map((row, i) => {
          const others = rows.filter((r) => r.key !== row.key);
          return (
            <li key={row.key} className="pstep">
              <div className="pstep__top">
                <span className="pstep__n" aria-hidden="true">
                  {i + 1}
                </span>
                <label className="sr-only" htmlFor={`${id}-${row.key}`}>
                  {t('write.stepLabel', { n: i + 1 })}
                </label>
                <input
                  id={`${id}-${row.key}`}
                  className="field field--step"
                  type="text"
                  value={row.text}
                  placeholder={t('write.stepPlaceholder')}
                  autoComplete="off"
                  onChange={(e) => update(row.key, { text: e.target.value })}
                />
                {rows.length > 1 ? (
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={t('write.removeStep', { n: i + 1 })}
                    onClick={() => remove(row.key)}
                  >
                    <X aria-hidden="true" size={20} strokeWidth={2.75} />
                  </button>
                ) : null}
              </div>
              <div className="pstep__meta">
                <span className="pstep__round">{t('shape.round', { n: (level.get(row.key) ?? 0) + 1 })}</span>
                <label className="pstep__who" htmlFor={`${id}-${row.key}-who`}>
                  <span>{t('write.who')}</span>
                </label>
                <WhoSelect id={`${id}-${row.key}-who`} value={row.who} onChange={(who) => update(row.key, { who })} />
              </div>
              {others.length > 0 ? (
                <div className="pstep__waits" role="group" aria-label={`${t('write.waits')}: ${t('write.stepLabel', { n: i + 1 })}`}>
                  <span className="pstep__label">{t('write.waits')}</span>
                  {row.after.length === 0 ? <span className="pstep__none">{t('write.waitsNone')}</span> : null}
                  <span className="wchips">
                    {others.map((o) => {
                      const n = rows.indexOf(o) + 1;
                      const on = row.after.includes(o.key);
                      const circle = !on && wouldCycle(nodes, row.key, [...row.after, o.key]);
                      return (
                        <button
                          key={o.key}
                          type="button"
                          className="wchip"
                          aria-pressed={on}
                          disabled={circle}
                          title={circle ? t('shape.circle') : undefined}
                          onClick={() => toggleWait(row, o.key)}
                        >
                          <span className="wchip__n">{n}</span>
                          <span className="wchip__text">{cleanText(o.text) || t('write.stepLabel', { n })}</span>
                        </button>
                      );
                    })}
                  </span>
                </div>
              ) : null}
              {hint?.key === row.key ? <p className="pstep__hint">{t('shape.cost', { n: hint.n })}</p> : null}
            </li>
          );
        })}
      </ol>
      <button type="button" className="btn btn--quiet btn--small" onClick={() => setRows([...rows, newRow(me)])}>
        <Plus aria-hidden="true" size={20} strokeWidth={2.75} />
        {t('write.addStep')}
      </button>
      {shape.steps > 0 ? (
        <div className="shape" aria-live="polite">
          <p className="shape__line">{t('shape.line', { steps: shape.steps, rounds: shape.rounds, startNow: shape.startNow })}</p>
          {shape.rounds > 1 && shape.rounds === shape.steps ? (
            <p className="shape__note">{t('shape.chain')}</p>
          ) : shape.rounds < shape.steps ? (
            <p className="shape__note">{t('shape.faster', { rounds: shape.rounds, steps: shape.steps })}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
