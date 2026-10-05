/**
 * Regressions from the independent review of plans and school roles. Each
 * test reproduces a confirmed finding and fails on the code before the fix.
 * Most are about rule 2 (people below "teacher" see only their own part) and
 * rule 6 (a change made from an old screen never silently overwrites).
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { HistoryPage } from '../../app/components/HistoryPage';
import { ServicesProvider, ToastProvider } from '../../app/context';
import { createPrefsStore } from '../../app/prefs';
import { I18nProvider } from '../../i18n/react';
import { createLocalStore, memoryStorage } from '../../store/localStore';
import { PLANS, planDraft } from '../catalog';
import { timeline } from '../describe';
import { promotionHint, week } from '../insights';
import { stepsOf } from '../model';
import { atomFor, has, presetPerms, withLevel } from '../permissions';
import { visibleSteps } from '../plan';
import { listView } from '../view';
import { acceptance, preview, published } from '../workspace';
import { school } from './school';
import { refusal } from './world';

describe('people who see only their part see only their part', () => {
  it('1. a student’s timeline shows only steps she may see', () => {
    const w = school();
    const { saraa, anu, manager } = w.people;
    w.ok(saraa, { type: 'add', text: 'Exam', steps: w.draft(saraa) });
    w.ok(saraa, { type: 'addStep', task: w.taskId('Exam'), text: 'Hide the answer key in drawer 3', who: saraa });
    w.ok(manager, { type: 'checkStep', id: w.stepId('Exam', 'Book the room'), done: true });
    const pub = published(w.ws);
    const exam = pub.tasks.get(w.taskId('Exam'))!;
    const allowed = new Set(visibleSteps(pub, pub.people.get(anu)!, exam).map((s) => s.text));
    expect(allowed).toEqual(new Set(['Tell the students']));
    const items = timeline(w.ws, anu);
    const leaked = items.flatMap((i) => i.phrases).filter((p) => p.kind.startsWith('step-') && 'text' in p && !allowed.has(p.text));
    expect(leaked).toEqual([]);
    // Not in the phrases, and not in the data that comes with them either.
    expect(JSON.stringify(items)).not.toContain('drawer 3');
    expect(JSON.stringify(items)).not.toContain('Book the room');
  });

  it('2. a student’s row carries no pending notes about steps she cannot see', () => {
    const w = school();
    const { saraa, anu, tuya } = w.people;
    w.ok(saraa, { type: 'add', text: 'Exam', steps: w.draft(saraa) });
    w.ok(tuya, { type: 'addStep', task: w.taskId('Exam'), text: 'Bring the answer key', who: tuya });
    w.ok(tuya, { type: 'checkStep', id: w.stepId('Exam', 'Book the room'), done: true });
    const row = listView(w.ws, anu, w.env.now()).open.find((r) => r.text === 'Exam')!;
    expect(row.notes.map((n) => n.change.op)).toEqual([]);
    // The teacher who owns the plan still sees both.
    const own = listView(w.ws, saraa, w.env.now()).open.find((r) => r.text === 'Exam')!;
    expect(own.notes.map((n) => n.change.op).sort()).toEqual(['step.add', 'step.check']);
  });

  it('3a. a published plan on a row shows only steps the student may see, and counts the rest', () => {
    const w = school();
    const { saraa, anu } = w.people;
    const exam = PLANS.find((p) => p.key === 'exam')!;
    w.ok(saraa, { type: 'add', text: 'Exam week', steps: planDraft(w.ws, exam, 'en', saraa) });
    const pub = published(w.ws);
    const task = pub.tasks.get(w.taskId('Exam week'))!;
    const allowed = new Set(visibleSteps(pub, pub.people.get(anu)!, task).map((s) => s.id));
    const row = listView(w.ws, anu, w.env.now()).open.find((r) => r.id === task.id)!;
    expect(row.plan!.partial).toBe(true);
    expect(row.plan!.steps.every((p) => allowed.has(p.step.id))).toBe(true);
    const shownWaits = row.plan!.steps.flatMap((p) => p.waitingFor);
    expect(shownWaits.filter((s) => !allowed.has(s.id)).map((s) => s.text)).toEqual([]);
    // What is withheld is still counted, so "waits for" stays true without naming it.
    const hold = row.plan!.steps.find((p) => p.step.who === anu && p.waitingFor.length + p.hiddenWaits > 0);
    expect(hold).toBeDefined();
    expect(row.plan!.width).toBe(0);
    expect(row.plan!.critical).toEqual([]);
  });

  it('3b. another student’s pending plan on a row shows only steps the student may see', () => {
    const w = school();
    const { anu, khulan, saraa, manager } = w.people;
    w.ok(khulan, {
      type: 'add',
      text: 'Class garden',
      steps: [
        { key: 'a', text: 'Water the plants', who: anu, after: [] },
        { key: 'b', text: 'Ask the director for money', who: saraa, after: [] },
        { key: 'c', text: 'Buy the soil', who: manager, after: ['b'] },
      ],
    });
    const pre = preview(w.ws);
    const task = pre.tasks.get(w.taskId('Class garden'))!;
    const allowed = new Set(visibleSteps(pre, pre.people.get(anu)!, task).map((s) => s.text));
    expect(allowed).toEqual(new Set(['Water the plants']));
    const row = listView(w.ws, anu, w.env.now()).open.find((r) => r.id === task.id)!;
    expect(row.plan!.steps.map((p) => p.step.text).filter((t) => !allowed.has(t))).toEqual([]);
  });

  it('6. the week chart on What changed counts only a student’s own part', () => {
    const w = school();
    const { saraa, anu, manager } = w.people;
    w.ok(saraa, { type: 'add', text: 'Exam', steps: w.draft(saraa) });
    w.ok(manager, { type: 'checkStep', id: w.stepId('Exam', 'Book the room'), done: true });
    w.ok(saraa, { type: 'add', text: 'Staff meeting' });
    w.ok(saraa, { type: 'check', id: w.taskId('Staff meeting'), done: true });
    expect(week(w.ws, w.env.now(), published(w.ws).people.get(anu)!).total).toBe(0);
    expect(week(w.ws, w.env.now(), published(w.ws).people.get(saraa)!).total).toBeGreaterThan(0);
    // And the page itself, which once asked without saying who was looking.
    vi.useFakeTimers();
    vi.setSystemTime(w.env.now() + 60_000);
    try {
      const ws = w.ws;
      const store = createLocalStore({ key: 'k', storage: memoryStorage(), seed: () => ws, warn: () => {} });
      const prefs = createPrefsStore();
      prefs.set({ me: anu, lang: 'en' });
      const page = createElement(ToastProvider, { children: createElement(HistoryPage) });
      const html = renderToStaticMarkup(
        createElement(ServicesProvider, {
          services: { store, prefs, env: w.env },
          children: createElement(I18nProvider, { lang: 'en', children: page }),
        }),
      );
      expect(html.match(/class="week__total">([^<]*)</)?.[1]).toBe('0 things done');
    } finally {
      vi.useRealTimers();
    }
  });

  it('7. refusals do not reveal tasks a student cannot see', () => {
    const w = school();
    const { director, anu } = w.people;
    w.ok(director, { type: 'add', text: 'Budget cut' });
    const id = w.taskId('Budget cut');
    const v = w.ok(director, { type: 'edit', id, text: 'Budget cut: let Tuya go' });
    w.ok(director, { type: 'edit', id, text: 'Budget cut: decided' });
    if (v.kind !== 'published') throw new Error();
    const undo = w.run(anu, { type: 'undo', version: v.version.n });
    expect(refusal(undo)).toBe('not-allowed');
    expect(JSON.stringify(undo)).not.toContain('let Tuya go');
    const restore = w.run(anu, { type: 'restore', to: v.version.n });
    expect(refusal(restore)).toBe('not-allowed');
    expect(JSON.stringify(restore)).not.toContain('let Tuya go');
    const dup = w.run(anu, { type: 'add', text: 'Budget cut: decided' });
    expect(dup.kind === 'refused' && dup.refusal.code).not.toBe('duplicate');
  });

  it('8. views asked for by someone no longer on the list show nothing', () => {
    const w = school();
    const { director, khulan } = w.people;
    w.ok(director, { type: 'add', text: 'Budget: cut the music teacher' });
    w.ok(director, { type: 'removePerson', id: khulan });
    expect(listView(w.ws, khulan, w.env.now())).toEqual({ open: [], doneToday: [], doneEarlier: 0 });
    expect(timeline(w.ws, khulan)).toEqual([]);
  });
});

describe('changes from an old screen', () => {
  it('4. waits and assignee changed from an old screen are refused, not silently overwritten', () => {
    const w = school();
    const { saraa, manager, khulan, dorj } = w.people;
    w.ok(saraa, { type: 'add', text: 'Exam', steps: w.draft(saraa) });
    const d = w.stepId('Exam', 'Tell the students');
    const a = w.stepId('Exam', 'Write the questions');
    const b = w.stepId('Exam', 'Book the room');
    const screen = w.step('Exam', 'Tell the students');
    w.ok(manager, { type: 'setWaits', id: d, after: [a] });
    w.ok(manager, { type: 'assignStep', id: d, who: khulan });
    // What the step sheet sends: the new value, and what was on screen.
    const waits = w.run(saraa, { type: 'setWaits', id: d, after: [...screen.after, b], from: screen.after });
    const who = w.run(saraa, { type: 'assignStep', id: d, who: dorj, from: screen.who });
    expect(refusal(waits)).toBe('changed-meanwhile');
    expect(refusal(who)).toBe('changed-meanwhile');
    const now = w.step('Exam', 'Tell the students');
    expect(now.after).toEqual([a]);
    expect(now.who).toBe(khulan);
    // From a fresh screen, the same changes go through.
    w.ok(saraa, { type: 'setWaits', id: d, after: [...now.after, b], from: now.after });
    w.ok(saraa, { type: 'assignStep', id: d, who: dorj, from: now.who });
    expect(w.step('Exam', 'Tell the students').who).toBe(dorj);
    expect([...w.step('Exam', 'Tell the students').after].sort()).toEqual([a, b].sort());
  });

  it('4b. a promotion from an old screen does not undo a role change made meanwhile', () => {
    const w = school();
    const { director, anu } = w.people;
    // The People page is open on two screens; on one, Anu is made a parent.
    const seen = published(w.ws).people.get(anu)!.perms;
    w.ok(director, { type: 'setPerms', id: anu, perms: presetPerms('parent') });
    // On the other, the hint's button is pressed with what that screen still shows.
    const promoted = withLevel(seen, 'add', 'do', 'own');
    expect(refusal(w.run(director, { type: 'setPerms', id: anu, perms: promoted, from: seen }))).toBe('changed-meanwhile');
    expect(published(w.ws).people.get(anu)!.perms).toBe(presetPerms('parent'));
  });
});

describe('suggestions and numbering', () => {
  it('5. undoing a person’s addition withdraws their waiting suggestions, like removing them does', () => {
    const w = school();
    const { director, saraa, tuya } = w.people;
    const added = w.ok(director, { type: 'addPerson', name: 'Zaya', perms: presetPerms('student') });
    if (added.kind !== 'published' || added.version.changes[0]?.op !== 'person.add') throw new Error();
    const zaya = added.version.changes[0].person.id;
    w.ok(zaya, { type: 'add', text: 'Zaya idea' });
    const idea = w.taskId('Zaya idea');
    w.ok(director, { type: 'undo', version: added.version.n });
    expect(published(w.ws).people.has(zaya)).toBe(false);
    expect(w.ws.open?.batches.some((b) => b.by === zaya && b.status === 'pending') ?? false).toBe(false);
    const verdict = acceptance(w.ws, published(w.ws).people.get(saraa)!);
    expect(!verdict.ok && verdict.refusal.code).not.toBe('own-only');
    w.run(tuya, { type: 'edit', id: idea, text: 'Zaya idea, improved' });
    if (w.ws.open) w.run(saraa, { type: 'accept', suggestion: w.ws.open.id });
    expect([...published(w.ws).tasks.values()].filter((t) => t.createdBy === zaya).map((t) => t.text)).toEqual([]);
  });

  it('9. step numbers are never reused within a plan', () => {
    const w = school();
    const { saraa, tuya, director } = w.people;
    w.ok(saraa, { type: 'add', text: 'Exam', steps: w.draft(saraa) });
    const t = w.taskId('Exam');
    expect(w.ok(tuya, { type: 'addStep', task: t, text: 'Bring pens', who: tuya }).kind).toBe('suggested');
    w.ok(saraa, { type: 'addStep', task: t, text: 'Mark the papers', who: saraa });
    w.ok(director, { type: 'accept', suggestion: w.ws.open!.id });
    const ns = stepsOf(published(w.ws), t).map((s) => s.n);
    expect(ns).toHaveLength(6);
    expect(ns.filter((n, i) => ns.indexOf(n) !== i)).toEqual([]);
  });

  it('10. the promotion hint goes away once its own suggestion is applied', () => {
    const w = school();
    const { anu, director, saraa } = w.people;
    for (let i = 0; i < 5; i++) {
      w.ok(anu, { type: 'add', text: `Idea ${i}` });
      w.ok(saraa, { type: 'accept', suggestion: w.ws.open!.id });
    }
    const hint = promotionHint(w.ws, anu);
    expect(hint).not.toBeNull();
    const p = published(w.ws).people.get(anu)!;
    const perms = hint!.actions.reduce((acc, a) => withLevel(acc, a, 'do', has(p.perms, atomFor('suggest', a)) ? 'all' : 'own'), p.perms);
    w.ok(director, { type: 'setPerms', id: anu, perms, from: p.perms });
    expect(promotionHint(w.ws, anu)).toBeNull();
  });
});

describe('four eyes, with steps', () => {
  it('an approver cannot slip their own change to a step past review on the back of someone else’s', () => {
    const w = school();
    const { director, saraa, tuya, manager } = w.people;
    w.ok(director, { type: 'add', text: 'Budget', steps: [{ key: 'a', text: 'Count the money', who: director, after: [] }] });
    const st = w.stepId('Budget', 'Count the money');
    expect(w.ok(saraa, { type: 'editStep', id: st, text: 'Count the money twice' }).kind).toBe('suggested');
    expect(w.ok(tuya, { type: 'assignStep', id: st, who: tuya }).kind).toBe('suggested');
    // Saraa looked at the step, but not at Tuya giving it to herself.
    expect(refusal(w.run(tuya, { type: 'accept', suggestion: w.ws.open!.id }))).toBe('own-only');
    expect(w.step('Budget', 'Count the money').who).toBe(director);
    // Someone who made neither change can accept both.
    w.ok(manager, { type: 'accept', suggestion: w.ws.open!.id });
    const now = published(w.ws).steps.get(st)!;
    expect(now.text).toBe('Count the money twice');
    expect(now.who).toBe(tuya);
  });

  it('an approver who changed nothing can still accept what someone else suggested', () => {
    const w = school();
    const { director, saraa, tuya } = w.people;
    w.ok(director, { type: 'add', text: 'Budget', steps: [{ key: 'a', text: 'Count the money', who: director, after: [] }] });
    const st = w.stepId('Budget', 'Count the money');
    w.ok(saraa, { type: 'editStep', id: st, text: 'Count the money twice' });
    w.ok(tuya, { type: 'accept', suggestion: w.ws.open!.id });
    expect(published(w.ws).steps.get(st)!.text).toBe('Count the money twice');
  });
});
