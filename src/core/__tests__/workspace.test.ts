import { describe, expect, it } from 'vitest';
import { PersonId } from '../ids';
import { has, presetPerms, fromAtoms } from '../permissions';
import { hydrate, preview, published, managers } from '../workspace';
import { listView } from '../view';
import { timeline } from '../describe';
import { refusal, world } from './world';

describe('direct changes', () => {
  it('lets the owner add, tick, change and remove, each as a version', () => {
    const w = world();
    const { dulmaa } = w.people;
    const before = w.ws.replay.head;
    w.ok(dulmaa, { type: 'add', text: '  Buy   bread ' });
    const id = w.taskId('Buy bread');
    w.ok(dulmaa, { type: 'check', id, done: true });
    w.ok(dulmaa, { type: 'edit', id, text: 'Buy rye bread' });
    w.ok(dulmaa, { type: 'remove', id });
    expect(w.ws.replay.head).toBe(before + 4);
    expect(w.texts()).toEqual([]);
  });

  it('refuses empty, overlong and duplicate tasks (a double tap adds once)', () => {
    const w = world();
    const { dulmaa } = w.people;
    expect(refusal(w.run(dulmaa, { type: 'add', text: '   ' }))).toBe('empty-text');
    expect(refusal(w.run(dulmaa, { type: 'add', text: 'x'.repeat(121) }))).toBe('too-long');
    w.ok(dulmaa, { type: 'add', text: 'Call Anu' });
    expect(refusal(w.run(dulmaa, { type: 'add', text: 'call anu' }))).toBe('duplicate');
  });

  it('allows the same words again once the earlier one is done', () => {
    const w = world();
    const { dulmaa } = w.people;
    w.ok(dulmaa, { type: 'add', text: 'Take pills' });
    w.ok(dulmaa, { type: 'check', id: w.taskId('Take pills'), done: true });
    expect(w.run(dulmaa, { type: 'add', text: 'Take pills' }).kind).toBe('published');
  });

  it('refuses people who are not on the list, and viewers', () => {
    const w = world();
    expect(refusal(w.run(PersonId('stranger'), { type: 'add', text: 'x' }))).toBe('not-a-member');
    const o = w.run(w.people.bold, { type: 'add', text: 'x' });
    expect(o.kind === 'refused' && o.refusal.code === 'not-allowed' && o.refusal.missing).toEqual(['suggest:add@own']);
  });

  it('rebuilds exactly the same state from the stored log', () => {
    const w = world();
    const { dulmaa, saraa } = w.people;
    w.ok(dulmaa, { type: 'add', text: 'A' });
    w.ok(saraa, { type: 'add', text: 'B' });
    w.ok(dulmaa, { type: 'check', id: w.taskId('A'), done: true });
    const again = hydrate(JSON.parse(JSON.stringify(w.ws.data)));
    expect([...again.replay.state.tasks.values()]).toEqual([...published(w.ws).tasks.values()]);
    expect(again.open?.id).toBe(w.ws.open?.id);
  });
});

describe('suggestions', () => {
  it('turns a helper’s action into a suggestion shown in place', () => {
    const w = world();
    const { saraa, dulmaa } = w.people;
    const o = w.ok(saraa, { type: 'add', text: 'Buy kefir' });
    expect(o.kind).toBe('suggested');
    expect(w.texts()).toEqual([]);
    const seenBySaraa = listView(w.ws, saraa, w.env.now());
    expect(seenBySaraa.open[0]?.pendingAdd?.mine).toBe(true);
    const seenByDulmaa = listView(w.ws, dulmaa, w.env.now());
    expect(seenByDulmaa.open[0]?.pendingAdd?.mine).toBe(false);
  });

  it('combines two people’s work into one change that only an approver can publish', () => {
    const w = world();
    const { dulmaa, bat, saraa } = w.people;
    w.ok(dulmaa, { type: 'add', text: 'Call about the radio' });
    w.ok(saraa, { type: 'add', text: 'Buy kefir' }); // Saraa may only suggest adding
    w.ok(bat, { type: 'remove', id: w.taskId('Call about the radio') }); // Bat may only suggest removing
    expect(w.ws.open?.batches.length).toBe(2);
    expect(refusal(w.run(saraa, { type: 'accept', suggestion: w.ws.open!.id }))).toBe('not-allowed');

    const o = w.ok(dulmaa, { type: 'accept', suggestion: w.ws.open!.id });
    expect(o.kind).toBe('published');
    if (o.kind === 'published') {
      expect(o.version.cause).toMatchObject({ type: 'suggestion', contributors: [saraa, bat] });
      expect(o.version.by).toBe(dulmaa);
    }
    expect(w.texts()).toEqual(['Buy kefir']);
    expect(w.ws.open).toBeNull();
  });

  it('keeps four eyes on every change: nobody approves only their own suggestion', () => {
    const w = world();
    const { dulmaa, anu } = w.people;
    w.ok(dulmaa, { type: 'setPerms', id: anu, perms: fromAtoms(['approve', 'suggest:add']) });
    w.ok(anu, { type: 'add', text: 'Plant tulips' });
    expect(refusal(w.run(anu, { type: 'accept', suggestion: w.ws.open!.id }))).toBe('own-only');
    expect(w.run(dulmaa, { type: 'accept', suggestion: w.ws.open!.id }).kind).toBe('published');
  });

  it('declines a whole suggestion, or just one part of it', () => {
    const w = world();
    const { dulmaa, saraa } = w.people;
    w.ok(saraa, { type: 'add', text: 'A' });
    w.ok(saraa, { type: 'add', text: 'B' });
    const [first] = w.ws.open!.batches;
    w.ok(dulmaa, { type: 'declineBatch', suggestion: w.ws.open!.id, batch: first!.id });
    expect(w.ws.open?.batches.filter((b) => b.status === 'pending').length).toBe(1);
    w.ok(dulmaa, { type: 'accept', suggestion: w.ws.open!.id });
    expect(w.texts()).toEqual(['B']);

    w.ok(saraa, { type: 'add', text: 'C' });
    w.ok(dulmaa, { type: 'decline', suggestion: w.ws.open!.id });
    expect(w.texts()).toEqual(['B']);
    expect(timeline(w.ws, dulmaa).some((i) => i.type === 'declined')).toBe(true);
  });

  it('lets people take back only their own suggestions', () => {
    const w = world();
    const { saraa, bat } = w.people;
    w.ok(saraa, { type: 'add', text: 'A' });
    const batch = w.ws.open!.batches[0]!.id;
    expect(refusal(w.run(bat, { type: 'withdraw', batch }))).toBe('not-yours');
    w.ok(saraa, { type: 'withdraw', batch });
    expect(w.ws.open).toBeNull();
    expect(w.ws.data.suggestions[0]?.resolution?.type).toBe('withdrawn');
  });

  it('reports a suggestion as out of date when the list changed under it', () => {
    const w = world();
    const { dulmaa, saraa } = w.people;
    w.ok(dulmaa, { type: 'add', text: 'Milk' });
    w.ok(saraa, { type: 'edit', id: w.taskId('Milk'), text: 'Kefir' });
    w.ok(dulmaa, { type: 'edit', id: w.taskId('Milk'), text: 'Oat milk' });
    expect(w.ws.evaluation?.stale.length).toBe(1);
    expect(refusal(w.run(dulmaa, { type: 'accept', suggestion: w.ws.open!.id }))).toBe('nothing-to-accept');
  });

  it('still removes a task that was ticked off after the removal was suggested', () => {
    const w = world();
    const { dulmaa, bat } = w.people;
    w.ok(dulmaa, { type: 'add', text: 'Old task' });
    w.ok(bat, { type: 'remove', id: w.taskId('Old task') });
    w.ok(dulmaa, { type: 'check', id: w.taskId('Old task'), done: true });
    w.ok(dulmaa, { type: 'accept', suggestion: w.ws.open!.id });
    expect(w.texts()).toEqual([]);
  });

  it('closes a suggestion that has become true without an empty version', () => {
    const w = world();
    const { dulmaa, saraa } = w.people;
    w.ok(dulmaa, { type: 'add', text: 'Walk' });
    w.ok(saraa, { type: 'check', id: w.taskId('Walk'), done: true });
    w.ok(dulmaa, { type: 'check', id: w.taskId('Walk'), done: true });
    const head = w.ws.replay.head;
    const o = w.ok(dulmaa, { type: 'accept', suggestion: w.ws.open!.id });
    expect(o.kind === 'updated' && o.what).toBe('accepted-nothing-left');
    expect(w.ws.replay.head).toBe(head);
  });

  it('does not let doers act on a task that is only suggested yet', () => {
    const w = world();
    const { dulmaa, saraa } = w.people;
    w.ok(saraa, { type: 'add', text: 'Kefir' });
    expect(refusal(w.run(dulmaa, { type: 'check', id: w.taskId('Kefir'), done: true }))).toBe('pending');
  });

  it('lets a helper build on their own pending suggestion', () => {
    const w = world();
    const { dulmaa, saraa } = w.people;
    w.ok(saraa, { type: 'add', text: 'Kefir' });
    w.ok(saraa, { type: 'edit', id: w.taskId('Kefir'), text: 'Kefir, 2 litres' });
    expect([...preview(w.ws).tasks.values()].map((t) => t.text)).toEqual(['Kefir, 2 litres']);
    w.ok(dulmaa, { type: 'accept', suggestion: w.ws.open!.id });
    expect(w.texts()).toEqual(['Kefir, 2 litres']);
  });
});

describe('undo and going back', () => {
  it('lets people take back their own change even without the inverse right', () => {
    const w = world();
    const { bat } = w.people;
    const o = w.ok(bat, { type: 'add', text: 'Fix the radio' }); // Bat may add, not remove
    if (o.kind !== 'published') throw new Error();
    expect(w.ok(bat, { type: 'undo', version: o.version.n }).kind).toBe('published');
    expect(w.texts()).toEqual([]);
  });

  it('routes undoing someone else’s change like any other change', () => {
    const w = world();
    const { dulmaa, bat } = w.people;
    const o = w.ok(dulmaa, { type: 'add', text: 'Pay the bill' });
    if (o.kind !== 'published') throw new Error();
    expect(w.ok(bat, { type: 'undo', version: o.version.n }).kind).toBe('suggested');
  });

  it('explains who changed something when an undo no longer fits', () => {
    const w = world();
    const { dulmaa, anu } = w.people;
    w.ok(dulmaa, { type: 'add', text: 'a' });
    const e = w.ok(dulmaa, { type: 'edit', id: w.taskId('a'), text: 'b' });
    w.ok(anu, { type: 'edit', id: w.taskId('b'), text: 'c' });
    if (e.kind !== 'published') throw new Error();
    const o = w.run(dulmaa, { type: 'undo', version: e.version.n });
    expect(o.kind === 'refused' && o.refusal).toMatchObject({ code: 'conflict', laterBy: anu });
  });

  it('undoes an undo (redo)', () => {
    const w = world();
    const { dulmaa } = w.people;
    const a = w.ok(dulmaa, { type: 'add', text: 'Tea' });
    if (a.kind !== 'published') throw new Error();
    const u = w.ok(dulmaa, { type: 'undo', version: a.version.n });
    if (u.kind !== 'published') throw new Error();
    w.ok(dulmaa, { type: 'undo', version: u.version.n });
    expect(w.texts()).toEqual(['Tea']);
  });

  it('goes back to how the tasks were at an earlier moment, as one new version', () => {
    const w = world();
    const { dulmaa, saraa, bold } = w.people;
    w.ok(dulmaa, { type: 'add', text: 'A' });
    const mark = w.ok(dulmaa, { type: 'add', text: 'B' });
    if (mark.kind !== 'published') throw new Error();
    w.ok(dulmaa, { type: 'remove', id: w.taskId('A') });
    w.ok(dulmaa, { type: 'add', text: 'C' });
    w.ok(dulmaa, { type: 'check', id: w.taskId('B'), done: true });

    expect(refusal(w.run(bold, { type: 'restore', to: mark.version.n }))).toBe('not-allowed');
    expect(w.ok(saraa, { type: 'restore', to: mark.version.n }).kind).toBe('suggested');
    w.ok(saraa, { type: 'withdraw', batch: w.ws.open!.batches[0]!.id });

    const r = w.ok(dulmaa, { type: 'restore', to: mark.version.n });
    expect(r.kind === 'published' && r.version.cause).toEqual({ type: 'restore', to: mark.version.n });
    expect(w.texts()).toEqual(['A', 'B']);
    expect([...published(w.ws).tasks.values()].every((t) => !t.done)).toBe(true);
    expect(refusal(w.run(dulmaa, { type: 'restore', to: w.ws.replay.head }))).toBe('nothing-to-restore');
  });

  it('cannot undo the creation of the list', () => {
    const w = world();
    expect(refusal(w.run(w.people.dulmaa, { type: 'undo', version: 1 }))).toBe('setup');
  });
});

describe('people and roles', () => {
  it('only lets managers change who can do what', () => {
    const w = world();
    const { anu, saraa } = w.people;
    expect(refusal(w.run(anu, { type: 'setPerms', id: saraa, perms: presetPerms('editor') }))).toBe('not-allowed');
    expect(refusal(w.run(anu, { type: 'addPerson', name: 'Tuya', perms: presetPerms('viewer') }))).toBe('not-allowed');
  });

  it('keeps names unique and non-empty', () => {
    const w = world();
    const { dulmaa } = w.people;
    expect(refusal(w.run(dulmaa, { type: 'addPerson', name: ' anu ', perms: presetPerms('viewer') }))).toBe('name-taken');
    expect(refusal(w.run(dulmaa, { type: 'addPerson', name: ' ', perms: presetPerms('viewer') }))).toBe('empty-name');
  });

  it('always keeps someone who can decide who does what', () => {
    const w = world();
    const { dulmaa } = w.people;
    expect(refusal(w.run(dulmaa, { type: 'setPerms', id: dulmaa, perms: presetPerms('approver') }))).toBe('last-owner');
    expect(refusal(w.run(dulmaa, { type: 'removePerson', id: dulmaa }))).toBe('self-remove');
    expect(managers(w.ws).length).toBe(1);
  });

  it('protects the invariant on undo too', () => {
    const w = world();
    const { dulmaa, anu } = w.people;
    const promote = w.ok(dulmaa, { type: 'setPerms', id: anu, perms: presetPerms('owner') });
    w.ok(anu, { type: 'setPerms', id: dulmaa, perms: presetPerms('editor') });
    if (promote.kind !== 'published') throw new Error();
    // Dulmaa can no longer manage, so she cannot undo her way back in.
    expect(refusal(w.run(dulmaa, { type: 'undo', version: promote.version.n }))).toBe('not-allowed');
    // Anu undoing her own promotion would leave nobody in charge.
    expect(refusal(w.run(anu, { type: 'undo', version: promote.version.n }))).toBe('last-owner');
    expect(has(w.ws.replay.state.people.get(anu)!.perms, 'manage')).toBe(true);
  });

  it('records role changes in history and can undo them', () => {
    const w = world();
    const { dulmaa, saraa } = w.people;
    const o = w.ok(dulmaa, { type: 'setPerms', id: saraa, perms: presetPerms('editor') });
    if (o.kind !== 'published') throw new Error();
    w.ok(dulmaa, { type: 'undo', version: o.version.n });
    expect(w.ws.replay.state.people.get(saraa)?.perms).toBe(presetPerms('helper'));
  });
});
