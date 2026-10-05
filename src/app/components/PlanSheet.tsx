/**
 * A ready-made plan, before it is added: its rounds, who does each step
 * (filled in by role, and changeable), and one button. Steps for "every
 * student" are shown once, with the people who will each get their own.
 */
import { Plus } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import {
  levels,
  planDraft,
  routeAction,
  shapeOf,
  type PersonId,
  type PlanDraftStep,
  type PlanTemplate,
} from '../../core';
import { useI18n } from '../../i18n/react';
import { useMe, useRun, useWords, useWorkspace } from '../context';
import { Avatar } from './bits';
import { WhoSelect } from './PlanEditor';
import { Sheet } from './Sheet';

interface Item {
  readonly from: string;
  readonly text: string;
  readonly role: PlanDraftStep['role'];
  readonly steps: readonly PlanDraftStep[];
  readonly each: boolean;
}

export function PlanSheet({ template, onClose }: { readonly template: PlanTemplate; readonly onClose: () => void }) {
  const ws = useWorkspace();
  const me = useMe();
  const run = useRun();
  const w = useWords();
  const { t, lang } = useI18n();
  const id = useId();
  const [who, setWho] = useState<Readonly<Record<string, PersonId>>>({});
  const [error, setError] = useState<string | null>(null);

  const base = useMemo(() => (me ? planDraft(ws, template, lang, me.id) : []), [ws, template, lang, me]);
  const steps = useMemo(() => base.map((d) => (d.each ? d : { ...d, who: who[d.key] ?? d.who })), [base, who]);
  const nodes = useMemo(() => steps.map((d) => ({ id: d.key, after: d.after })), [steps]);
  const shape = useMemo(() => shapeOf(nodes), [nodes]);
  const level = useMemo(() => levels(nodes), [nodes]);

  // Group the copies of an "each" step back into one line per template step, in rounds.
  const rounds = useMemo(() => {
    const out: Item[][] = [];
    const seen = new Map<string, Item>();
    for (const d of steps) {
      const l = level.get(d.key) ?? 0;
      while (out.length <= l) out.push([]);
      const prev = seen.get(d.from);
      if (prev) {
        const merged: Item = { ...prev, steps: [...prev.steps, d] };
        seen.set(d.from, merged);
        const round = out[l]!;
        round[round.indexOf(prev)] = merged;
      } else {
        const item: Item = { from: d.from, text: d.text, role: d.role, steps: [d], each: d.each };
        seen.set(d.from, item);
        out[l]!.push(item);
      }
    }
    return out;
  }, [steps, level]);

  if (!me) return null;
  const route = routeAction(me.perms, 'add', 'own');

  const add = () => {
    const o = run(
      {
        type: 'add',
        text: template.title[lang],
        steps: steps.map(({ key, text, who: person, after }) => ({ key, text, who: person, after })),
      },
      { quietRefusals: true },
    );
    if (o.kind === 'refused') setError(w.refusal(o.refusal));
    else onClose();
  };

  return (
    <Sheet
      title={template.title[lang]}
      onClose={onClose}
      footer={
        <>
          {error ? (
            <p className="field-error" role="alert">
              {error}
            </p>
          ) : null}
          <button type="button" className="btn btn--primary btn--big btn--block" onClick={add}>
            <Plus aria-hidden="true" size={24} strokeWidth={2.75} />
            {t(route === 'do' ? 'plan.add' : 'plan.suggest')}
          </button>
          <button type="button" className="btn btn--quiet btn--block" onClick={onClose}>
            {t('common.cancel')}
          </button>
        </>
      }
    >
      <p className="sheet__lead">{t('plan.summary', { total: shape.steps, rounds: shape.rounds, width: shape.width })}</p>
      {shape.rounds < shape.steps ? <p className="note">{t('shape.faster', { rounds: shape.rounds, steps: shape.steps })}</p> : null}

      <ol className="rounds">
        {rounds.map((round, i) => (
          <li key={i} className="round">
            <h3 className="round__title">{t('shape.round', { n: i + 1 })}</h3>
            <ul className="round__steps">
              {round.map((item) => (
                <li key={item.from} className="pprev">
                  <span className="pprev__text">{item.text}</span>
                  {item.each ? (
                    <span className="pprev__group">
                      <span className="pprev__role">
                        {item.role === 'student' || item.role === 'parent' || item.role === 'teacher'
                          ? t(`group.${item.role}` as const, { n: item.steps.length })
                          : w.role(item.role)}
                      </span>
                      <span className="pprev__faces">
                        {item.steps.map((s) => (
                          <Avatar key={s.key} person={w.person(s.who)} size="sm" />
                        ))}
                      </span>
                    </span>
                  ) : (
                    <span className="pprev__who">
                      <label className="pprev__role" htmlFor={`${id}-${item.from}`}>
                        {w.role(item.role)}
                      </label>
                      <WhoSelect
                        id={`${id}-${item.from}`}
                        groups={false}
                        value={{ kind: 'person', id: item.steps[0]!.who }}
                        onChange={(v) => {
                          if (v.kind === 'person') setWho({ ...who, [item.steps[0]!.key]: v.id });
                        }}
                      />
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </Sheet>
  );
}
