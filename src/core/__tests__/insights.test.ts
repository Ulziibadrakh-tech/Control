import { describe, expect, it } from 'vitest';
import { choices } from '../catalog';
import { timeline } from '../describe';
import { acceptedStreak, progress, promotionHint, review, story, week, PROMOTION_STREAK } from '../insights';
import { DAY, HOUR, startOfDay } from '../time';
import { listView } from '../view';
import { world } from './world';

describe('insights', () => {
  it('counts what is done today and what is left', () => {
    const w = world();
    const { dulmaa } = w.people;
    w.ok(dulmaa, { type: 'add', text: 'A' });
    w.ok(dulmaa, { type: 'add', text: 'B' });
    w.ok(dulmaa, { type: 'check', id: w.taskId('A'), done: true });
    const me = w.ws.replay.state.people.get(dulmaa)!;
    expect(progress(w.ws, w.env.now(), me)).toEqual({ done: 1, open: 1 });
    // Tomorrow, yesterday's done task is tidied away.
    const tomorrow = startOfDay(w.env.now()) + DAY + 9 * HOUR;
    expect(progress(w.ws, tomorrow, me)).toEqual({ done: 0, open: 1 });
    expect(listView(w.ws, dulmaa, tomorrow).doneEarlier).toBe(1);
  });

  it('shows the week, oldest day first, against the week before', () => {
    const w = world();
    const { dulmaa } = w.people;
    for (const text of ['A', 'B', 'C']) {
      w.ok(dulmaa, { type: 'add', text });
      w.ok(dulmaa, { type: 'check', id: w.taskId(text), done: true });
      w.later(24);
    }
    const wk = week(w.ws, w.env.now(), w.ws.replay.state.people.get(dulmaa)!);
    expect(wk.days.length).toBe(7);
    expect(wk.total).toBe(3);
    expect(wk.days.at(-1)?.count).toBe(0);
    expect(wk.previous).toBe(0);
  });

  it('tells the story of a task', () => {
    const w = world();
    const { dulmaa, anu } = w.people;
    w.ok(dulmaa, { type: 'add', text: 'Doctor' });
    const id = w.taskId('Doctor');
    w.later(48);
    w.ok(anu, { type: 'edit', id, text: 'Doctor on Thursday' });
    w.ok(dulmaa, { type: 'check', id, done: true });
    const s = story(w.ws, id, w.env.now());
    expect(s?.events.map((e) => e.kind)).toEqual(['added', 'edited', 'ticked']);
    expect(s?.ageDays).toBe(2);
    expect(s?.facts.edits).toBe(1);
  });

  it('explains a suggestion before it is accepted', () => {
    const w = world();
    const { dulmaa, saraa, bat } = w.people;
    w.ok(dulmaa, { type: 'add', text: 'Radio' });
    w.later(24 * 12);
    w.ok(saraa, { type: 'add', text: 'Kefir' });
    w.ok(bat, { type: 'remove', id: w.taskId('Radio') });
    const r = review(w.ws, w.env.now());
    expect(r).toMatchObject({ added: 1, removed: 1, openNow: 1, openAfter: 1 });
    const batBatch = w.ws.open!.batches[1]!.id;
    expect(r?.notes.get(batBatch)).toEqual([{ kind: 'age', days: 12 }]);
  });

  it('suggests trusting someone whose suggestions are always accepted', () => {
    const w = world();
    const { dulmaa, saraa } = w.people;
    for (let i = 0; i < PROMOTION_STREAK; i++) {
      w.ok(saraa, { type: 'add', text: `Idea ${i}` });
      w.ok(dulmaa, { type: 'accept', suggestion: w.ws.open!.id });
    }
    expect(promotionHint(w.ws, saraa)).toEqual({ count: PROMOTION_STREAK, actions: ['add'] });
    w.ok(saraa, { type: 'add', text: 'Bad idea' });
    w.ok(dulmaa, { type: 'decline', suggestion: w.ws.open!.id });
    expect(acceptedStreak(w.ws, saraa).count).toBe(0);
    expect(promotionHint(w.ws, saraa)).toBeNull();
  });

  it('keeps choice tiles in a fixed order and learns hand-written favourites', () => {
    const w = world();
    const { dulmaa } = w.people;
    for (let i = 0; i < 3; i++) {
      w.ok(dulmaa, { type: 'add', text: 'Feed the cat' });
      w.ok(dulmaa, { type: 'check', id: w.taskId('Feed the cat'), done: true });
    }
    w.ok(dulmaa, { type: 'add', text: 'Drink water' });
    const c = choices(w.ws, 'en');
    expect(c.catalog.map((x) => x.key).slice(0, 3)).toEqual(['pills', 'water', 'call']);
    expect(c.catalog.find((x) => x.key === 'water')?.onList).toBe(true);
    expect(c.own.map((x) => x.text)).toEqual(['Feed the cat']);
    expect(c.own[0]?.often).toBe(true);
  });

  it('describes history newest first and knows what can be undone', () => {
    const w = world();
    const { dulmaa, bold } = w.people;
    w.ok(dulmaa, { type: 'add', text: 'Tea' });
    const items = timeline(w.ws, dulmaa);
    const first = items[0];
    expect(first?.type === 'version' && first.phrases).toEqual([{ kind: 'added', text: 'Tea', steps: 0 }]);
    expect(first?.type === 'version' && first.undo).toEqual({ kind: 'do' });
    const forBold = timeline(w.ws, bold)[0];
    expect(forBold?.type === 'version' && forBold.undo.kind).toBe('no');
  });
});
