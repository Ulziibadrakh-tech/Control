/**
 * A task's plan, as rounds. Everything in a round can be done at the same
 * time; a round starts when what it waits for is done. The numbers on top
 * (rounds, how many at once, rounds to go) are the plan's shape, computed from
 * its partial order: no schedule can be shorter than its number of rounds.
 */
import { Check, Hourglass, Plus } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import {
  nodesOf,
  planFor,
  published,
  routeAction,
  stepsOf,
  wouldCycle,
  type PersonId,
  type PlanStep,
  type StepId,
  type Task,
} from '../../core';
import { useI18n } from '../../i18n/react';
import { useMe, useRun, useWords, useWorkspace } from '../context';
import { Avatar } from './bits';
import { WhoSelect, type Who } from './PlanEditor';
import { settled } from './TaskList';

type Item = { readonly kind: 'step'; readonly step: PlanStep } | { readonly kind: 'group'; readonly steps: readonly PlanStep[] };

/** Copies of one step for several people (same words, same waits, same round) read as one line. */
function group(steps: readonly PlanStep[]): Item[] {
  const out: Item[] = [];
  const key = (s: PlanStep) => `${s.step.text}\u0000${s.step.after.join(',')}`;
  const byKey = new Map<string, PlanStep[]>();
  for (const s of steps) {
    const k = key(s);
    const list = byKey.get(k);
    if (list) list.push(s);
    else byKey.set(k, [s]);
  }
  const done = new Set<string>();
  for (const s of steps) {
    const k = key(s);
    if (done.has(k)) continue;
    done.add(k);
    const list = byKey.get(k) ?? [s];
    out.push(list.length > 1 ? { kind: 'group', steps: list } : { kind: 'step', step: s });
  }
  return out;
}

export function PlanView({ task, onOpenStep }: { readonly task: Task; readonly onOpenStep: (id: StepId) => void }) {
  const ws = useWorkspace();
  const me = useMe();
  const { t } = useI18n();
  const pub = published(ws);
  // All of it, or only this person's part (with the rest of the plan's shape withheld).
  const plan = useMemo(() => (me ? planFor(pub, me, task) : null), [pub, me, task]);
  if (!me || !plan) return null;

  const partial = plan.partial;
  const own = task.createdBy === me.id;
  const addRoute = routeAction(me.perms, 'add', own ? 'own' : 'all');

  return (
    <section className="plan" aria-labelledby={`plan-${task.id}`}>
      <h3 id={`plan-${task.id}`} className="plan__title">
        {t('plan.steps')}
      </h3>
      {plan.total > 0 && !partial ? (
        <div className="plan__shape">
          <p className="plan__summary">{t('plan.summary', { total: plan.total, rounds: plan.height, width: plan.width })}</p>
          <p className="plan__progress">{t('plan.progress', { done: plan.done, total: plan.total, left: plan.left })}</p>
          {plan.height < plan.total ? (
            <p className="note">{t('shape.faster', { rounds: plan.height, steps: plan.total })}</p>
          ) : null}
          {plan.height > 2 ? (
            <p className="note">
              {t('plan.longest', {
                list: plan.critical.map((id) => pub.steps.get(id)?.text ?? '…').join(' → '),
              })}
            </p>
          ) : null}
        </div>
      ) : null}
      {partial ? <p className="note">{t('plan.yourPart')}</p> : null}

      {plan.total > 0 ? (
        <ol className="rounds">
          {plan.rounds.map((items, i) => {
            if (items.length === 0) return null;
            // "Now" wherever something can be done now: work runs ahead in parallel, so more than one round can be "now".
            // Judged on what this person sees, so a partial view never hints at steps it does not show.
            const status = items.every((s) => s.step.done) ? 'done' : items.some((s) => s.ready) ? 'now' : 'later';
            return (
              <li key={i} className="round" data-status={status}>
                <div className="round__head">
                  <h4 className="round__title">{t('shape.round', { n: i + 1 })}</h4>
                  <span className="round__status">{t(status === 'done' ? 'plan.done' : status === 'now' ? 'plan.now' : 'plan.later')}</span>
                </div>
                <ul className="round__steps">
                  {group(items).map((it) =>
                    it.kind === 'step' ? (
                      <StepRow key={it.step.step.id} item={it.step} task={task} onOpen={onOpenStep} />
                    ) : (
                      <GroupRow key={it.steps[0]!.step.id} items={it.steps} task={task} />
                    ),
                  )}
                </ul>
              </li>
            );
          })}
        </ol>
      ) : null}

      {addRoute !== 'deny' ? <AddStep task={task} suggest={addRoute === 'suggest'} /> : null}
    </section>
  );
}

/** "Waits for “Print the papers” and 2 more steps": the steps this person may see by name, the rest as a number. */
export function waitsText(item: PlanStep, t: ReturnType<typeof useI18n>['t'], list: (items: readonly string[]) => string): string {
  const names = item.waitingFor.map((d) => `“${d.text}”`);
  if (item.hiddenWaits > 0) names.push(t('plan.waitsMore', { n: item.hiddenWaits }));
  return t('plan.waitsFor', { list: list(names) });
}

/** Can this person tick (or untick) this step? Their own step, or any step of their own plan, or anyone's with the right. */
function useTickRoute(task: Task, who: PersonId) {
  const me = useMe();
  if (!me) return 'deny' as const;
  const own = who === me.id || task.createdBy === me.id;
  return routeAction(me.perms, 'check', own ? 'own' : 'all');
}

function StepRow({ item, task, onOpen }: { readonly item: PlanStep; readonly task: Task; readonly onOpen: (id: StepId) => void }) {
  const run = useRun();
  const w = useWords();
  const { t, list } = useI18n();
  const route = useTickRoute(task, item.step.who);
  const st = item.step;
  const canTick = route !== 'deny' && (st.done || item.ready);

  return (
    <li className="srow" data-done={st.done || undefined} data-waiting={!st.done && !item.ready ? true : undefined}>
      {canTick ? (
        <button
          type="button"
          role="checkbox"
          className="tick tick--sm"
          aria-checked={st.done}
          aria-label={st.text}
          onClick={() => {
            if (settled(st.id)) run({ type: 'checkStep', id: st.id, done: !st.done });
          }}
        >
          <Check aria-hidden="true" size={20} strokeWidth={3.25} />
        </button>
      ) : !st.done && !item.ready ? (
        <span className="tick tick--sm tick--still tick--blocked" aria-hidden="true">
          <Hourglass size={16} strokeWidth={2.75} />
        </span>
      ) : (
        <span className="tick tick--sm tick--still" data-on={st.done || undefined} aria-hidden="true">
          <Check size={20} strokeWidth={3.25} />
        </span>
      )}
      <button type="button" className="srow__main" aria-haspopup="dialog" onClick={() => onOpen(st.id)}>
        <span className="srow__text">{st.text}</span>
        <span className="srow__who">
          <Avatar person={w.person(st.who)} size="sm" />
          {w.nameOrLeft(st.who)}
        </span>
        {item.waitingFor.length + item.hiddenWaits > 0 ? <span className="srow__wait">{waitsText(item, t, list)}</span> : null}
      </button>
    </li>
  );
}

/** One step for many people ("every student"): one line, and a chip per person to tick their own. */
function GroupRow({ items, task }: { readonly items: readonly PlanStep[]; readonly task: Task }) {
  const run = useRun();
  const w = useWords();
  const me = useMe();
  const { t, list } = useI18n();
  const first = items[0]!.step;
  const done = items.filter((s) => s.step.done).length;
  const ready = items.every((s) => s.ready || s.step.done);
  return (
    <li className="sgroup" data-done={done === items.length || undefined}>
      <div className="sgroup__head">
        <span className="srow__text">{first.text}</span>
        <span className="sgroup__count">{t('plan.groupDone', { done, total: items.length })}</span>
      </div>
      {!ready ? <span className="srow__wait">{waitsText(items.find((s) => !s.ready && !s.step.done) ?? items[0]!, t, list)}</span> : null}
      <ul className="pchips">
        {items.map((s) => {
          const own = me && (s.step.who === me.id || task.createdBy === me.id);
          const route = me ? routeAction(me.perms, 'check', own ? 'own' : 'all') : 'deny';
          const canTick = route !== 'deny' && (s.step.done || s.ready);
          const label = `${first.text}: ${w.nameOrLeft(s.step.who)}`;
          return (
            <li key={s.step.id}>
              {canTick ? (
                <button
                  type="button"
                  role="checkbox"
                  className="pchip"
                  aria-checked={s.step.done}
                  aria-label={label}
                  onClick={() => {
                    if (settled(s.step.id)) run({ type: 'checkStep', id: s.step.id, done: !s.step.done });
                  }}
                >
                  <span className="pchip__box" aria-hidden="true">
                    <Check size={16} strokeWidth={3.5} />
                  </span>
                  <Avatar person={w.person(s.step.who)} size="sm" />
                  <span>{w.nameOrLeft(s.step.who)}</span>
                </button>
              ) : (
                <span className="pchip pchip--still" data-on={s.step.done || undefined}>
                  <span className="pchip__box" aria-hidden="true">
                    <Check size={16} strokeWidth={3.5} />
                  </span>
                  <Avatar person={w.person(s.step.who)} size="sm" />
                  <span>
                    <span className="sr-only">{s.step.done ? '✓ ' : ''}</span>
                    {w.nameOrLeft(s.step.who)}
                  </span>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </li>
  );
}

/** Adding a step to an existing plan (or breaking a task down later). Folded away until asked for. */
function AddStep({ task, suggest }: { readonly task: Task; readonly suggest: boolean }) {
  const ws = useWorkspace();
  const me = useMe();
  const run = useRun();
  const w = useWords();
  const { t } = useI18n();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [who, setWho] = useState<Who | null>(null);
  const [after, setAfter] = useState<StepId[]>([]);
  const [error, setError] = useState<string | null>(null);
  if (!me) return null;
  const siblings = stepsOf(published(ws), task.id);

  if (!open) {
    return (
      <button type="button" className="btn btn--quiet btn--block" onClick={() => setOpen(true)}>
        <Plus aria-hidden="true" size={22} strokeWidth={2.75} />
        {t(suggest ? 'plan.addStepSuggest' : 'plan.addStep')}
      </button>
    );
  }

  const person: Who = who ?? { kind: 'person', id: me.id };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (person.kind !== 'person') return;
    const o = run({ type: 'addStep', task: task.id, text, who: person.id, after }, { quietRefusals: true });
    if (o.kind === 'refused') {
      setError(w.refusal(o.refusal));
      return;
    }
    setText('');
    setAfter([]);
    setError(null);
    setOpen(false);
  };

  return (
    <form className="addstep" onSubmit={submit} noValidate>
      <label className="field-label" htmlFor={id}>
        {t('addstep.label')}
      </label>
      <input
        id={id}
        className="field field--step"
        type="text"
        value={text}
        autoComplete="off"
        placeholder={t('write.stepPlaceholder')}
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
        aria-invalid={error ? true : undefined}
      />
      <div className="pstep__meta">
        <label className="pstep__who" htmlFor={`${id}-who`}>
          <span>{t('write.who')}</span>
        </label>
        <WhoSelect id={`${id}-who`} value={person} groups={false} onChange={setWho} />
      </div>
      {siblings.length > 0 ? (
        <div className="pstep__waits" role="group" aria-label={t('write.waits')}>
          <span className="pstep__label">{t('write.waits')}</span>
          {after.length === 0 ? <span className="pstep__none">{t('write.waitsNone')}</span> : null}
          <span className="wchips">
            {siblings.map((s) => {
              const on = after.includes(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  className="wchip"
                  aria-pressed={on}
                  onClick={() => setAfter(on ? after.filter((a) => a !== s.id) : [...after, s.id])}
                >
                  <span className="wchip__n">{s.n}</span>
                  <span className="wchip__text">{s.text}</span>
                </button>
              );
            })}
          </span>
        </div>
      ) : null}
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="confirm__row">
        <button type="submit" className="btn btn--primary">
          <Plus aria-hidden="true" size={20} strokeWidth={2.75} />
          {t(suggest ? 'addstep.suggest' : 'addstep.add')}
        </button>
        <button type="button" className="btn btn--quiet" onClick={() => setOpen(false)}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );
}

/** For the step sheet: which other steps this one could wait for without a circle. */
export function waitOptions(ws: ReturnType<typeof useWorkspace>, stepId: StepId) {
  const pub = published(ws);
  const st = pub.steps.get(stepId);
  if (!st) return [];
  const siblings = stepsOf(pub, st.task);
  const nodes = nodesOf(siblings);
  return siblings
    .filter((s) => s.id !== st.id)
    .map((s) => ({ step: s, on: st.after.includes(s.id), circle: !st.after.includes(s.id) && wouldCycle(nodes, st.id, [...st.after, s.id]) }));
}
