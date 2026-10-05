/**
 * Regressions from the independent review. Each test reproduces a confirmed
 * finding and fails on the code before the fix.
 */
import { describe, expect, it } from 'vitest';
import { fromAtoms, presetPerms } from '../permissions';
import { acceptance, published } from '../workspace';
import { listView } from '../view';
import { HOUR } from '../time';
import { refusal, world } from './world';

describe('undo cannot get around the rules', () => {
  it('an approver cannot use undo to revert a suggestion they accepted', () => {
    const w = world();
    const { dulmaa, anu, saraa } = w.people;
    w.ok(dulmaa, { type: 'setPerms', id: anu, perms: fromAtoms(['approve']) });
    w.ok(saraa, { type: 'add', text: 'Take pills' });
    const accepted = w.ok(anu, { type: 'accept', suggestion: w.ws.open!.id });
    if (accepted.kind !== 'published') throw new Error();
    w.later(72);
    expect(refusal(w.run(anu, { type: 'remove', id: w.taskId('Take pills') }))).toBe('not-allowed');
    expect(refusal(w.run(anu, { type: 'undo', version: accepted.version.n }))).toBe('not-allowed');
    expect(w.texts()).toEqual(['Take pills']);
  });

  it('someone turned into "Can look" can no longer take back their old changes', () => {
    const w = world();
    const { dulmaa, bat } = w.people;
    const added = w.ok(bat, { type: 'add', text: 'Buy beer' });
    if (added.kind !== 'published') throw new Error();
    w.ok(dulmaa, { type: 'setPerms', id: bat, perms: presetPerms('viewer') });
    expect(refusal(w.run(bat, { type: 'add', text: 'More beer' }))).toBe('not-allowed');
    expect(refusal(w.run(bat, { type: 'undo', version: added.version.n }))).toBe('not-allowed');
  });

  it('still lets people take back their own change while they may make it', () => {
    const w = world();
    const { bat } = w.people;
    const added = w.ok(bat, { type: 'add', text: 'Fix the radio' });
    if (added.kind !== 'published') throw new Error();
    const undone = w.ok(bat, { type: 'undo', version: added.version.n });
    if (undone.kind !== 'published') throw new Error();
    // Redo goes through the normal rules: Bat may add.
    expect(w.ok(bat, { type: 'undo', version: undone.version.n }).kind).toBe('published');
    expect(w.texts()).toEqual(['Fix the radio']);
  });
});

describe('four eyes means a real second person', () => {
  it('removing a person withdraws their waiting suggestions', () => {
    const w = world();
    const { dulmaa, anu, saraa } = w.people;
    w.ok(dulmaa, { type: 'add', text: 'Medicine' });
    w.ok(dulmaa, { type: 'setPerms', id: anu, perms: fromAtoms(['approve', 'suggest:remove']) });
    w.ok(saraa, { type: 'add', text: 'Buy bread' });
    w.ok(dulmaa, { type: 'removePerson', id: saraa });
    expect(w.ws.open).toBeNull();
    w.ok(anu, { type: 'remove', id: w.taskId('Medicine') });
    expect(refusal(w.run(anu, { type: 'accept', suggestion: w.ws.open!.id }))).toBe('own-only');
  });

  it('changes that cancel out do not count as a second pair of eyes', () => {
    const w = world();
    const { dulmaa, anu, saraa } = w.people;
    w.ok(dulmaa, { type: 'add', text: 'Medicine' });
    w.ok(dulmaa, { type: 'setPerms', id: anu, perms: fromAtoms(['approve', 'suggest:remove']) });
    w.ok(saraa, { type: 'add', text: 'Kefir' });
    w.ok(anu, { type: 'remove', id: w.taskId('Kefir') });
    w.ok(anu, { type: 'remove', id: w.taskId('Medicine') });
    const anuPerson = w.ws.replay.state.people.get(anu)!;
    const verdict = acceptance(w.ws, anuPerson);
    expect(!verdict.ok && verdict.refusal.code).toBe('own-only');
    expect(w.run(dulmaa, { type: 'accept', suggestion: w.ws.open!.id }).kind).toBe('published');
    expect(w.texts()).toEqual([]);
  });
});

describe('going back never overwrites someone else’s words', () => {
  function setup() {
    const w = world();
    const { dulmaa } = w.people;
    const mark = w.ok(dulmaa, { type: 'add', text: 'Milk' });
    const removed = w.ok(dulmaa, { type: 'remove', id: w.taskId('Milk') });
    if (mark.kind !== 'published' || removed.kind !== 'published') throw new Error();
    w.ok(dulmaa, { type: 'undo', version: removed.version.n }); // the same task comes back
    w.ok(dulmaa, { type: 'edit', id: w.taskId('Milk'), text: 'Oat milk' });
    return { w, mark: mark.version.n };
  }

  it('turns remove-and-put-back into an edit that conflicts like one', () => {
    const { w, mark } = setup();
    const { dulmaa, anu, saraa } = w.people;
    w.ok(saraa, { type: 'restore', to: mark });
    const batch = w.ws.open!.batches[0]!;
    expect(batch.changes.map((c) => c.op)).toEqual(['task.edit']);
    w.ok(anu, { type: 'edit', id: w.taskId('Oat milk'), text: 'Oat milk, 2 litres' });
    expect(refusal(w.run(dulmaa, { type: 'accept', suggestion: w.ws.open!.id }))).toBe('nothing-to-accept');
    expect(w.texts()).toEqual(['Oat milk, 2 litres']);
  });

  it('does not bring back a task someone deleted after the suggestion was made', () => {
    const { w, mark } = setup();
    const { dulmaa, anu, saraa } = w.people;
    w.ok(saraa, { type: 'restore', to: mark });
    w.ok(anu, { type: 'remove', id: w.taskId('Oat milk') });
    expect(refusal(w.run(dulmaa, { type: 'accept', suggestion: w.ws.open!.id }))).toBe('nothing-to-accept');
    expect(w.texts()).toEqual([]);
  });
});

describe('undo keeps the same rules as adding', () => {
  it('cannot bring back a second person with the same name', () => {
    const w = world();
    const { dulmaa, bat } = w.people;
    const removed = w.ok(dulmaa, { type: 'removePerson', id: bat });
    if (removed.kind !== 'published') throw new Error();
    w.ok(dulmaa, { type: 'addPerson', name: 'Bat', perms: presetPerms('helper') });
    const o = w.run(dulmaa, { type: 'undo', version: removed.version.n });
    expect(o.kind === 'refused' && o.refusal).toEqual({ code: 'name-taken', name: 'Bat' });
  });
});

describe('the list', () => {
  it('never shows a task done days ago under "Done today", even with a suggestion on it', () => {
    const w = world();
    const { dulmaa, bat } = w.people;
    w.ok(dulmaa, { type: 'add', text: 'Old job' });
    w.ok(dulmaa, { type: 'check', id: w.taskId('Old job'), done: true });
    w.later(3 * 24);
    w.ok(bat, { type: 'remove', id: w.taskId('Old job') });
    const view = listView(w.ws, dulmaa, w.env.now());
    expect(view.doneToday).toEqual([]);
    expect(view.doneEarlier).toBe(1);
  });
});

describe('edits made from an old screen', () => {
  it('refuses to save words over a change someone made meanwhile', () => {
    const w = world();
    const { dulmaa, anu } = w.people;
    w.ok(dulmaa, { type: 'add', text: 'Call Anu' });
    const id = w.taskId('Call Anu');
    w.ok(anu, { type: 'edit', id, text: 'Call Anu at 6' });
    expect(refusal(w.run(dulmaa, { type: 'edit', id, text: 'Call Anu tonight', from: 'Call Anu' }))).toBe('changed-meanwhile');
    expect(w.texts()).toEqual(['Call Anu at 6']);
  });

  it('refuses to save a role over a change someone made meanwhile', () => {
    const w = world();
    const { dulmaa, anu, saraa } = w.people;
    w.ok(dulmaa, { type: 'setPerms', id: anu, perms: presetPerms('owner') });
    w.ok(anu, { type: 'setPerms', id: saraa, perms: presetPerms('editor') });
    const stale = presetPerms('helper');
    expect(refusal(w.run(dulmaa, { type: 'setPerms', id: saraa, perms: presetPerms('viewer'), from: stale }))).toBe(
      'changed-meanwhile',
    );
    expect(published(w.ws).people.get(saraa)?.perms).toBe(presetPerms('editor'));
  });
});

describe('timing', () => {
  it('the world helper advances time between commands', () => {
    const w = world();
    const t = w.env.now();
    w.ok(w.people.dulmaa, { type: 'add', text: 'x' });
    expect(w.env.now()).toBeGreaterThan(t);
    expect(HOUR).toBe(3_600_000);
  });
});
