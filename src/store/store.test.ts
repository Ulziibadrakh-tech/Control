import { describe, expect, it } from 'vitest';
import {
  dispatch,
  fixedEnv,
  has,
  hydrate,
  listView,
  nextSteps,
  people,
  planOf,
  preview,
  promotionHint,
  published,
  roleOf,
  type PersonId,
  type Workspace,
} from '../core';
import { createLocalStore, memoryStorage } from './localStore';
import { decode, encode, SCHEMA } from './schema';
import { sampleWorkspace } from './seed';

const NOW = new Date(2026, 9, 4, 15, 30).getTime();

const byName = (ws: Workspace, name: string): PersonId => {
  const p = people(ws).find((x) => x.name === name);
  if (!p) throw new Error(`no ${name}`);
  return p.id;
};

describe('sample history', () => {
  it('replays under the real rules, in both languages', () => {
    for (const lang of ['en', 'mn'] as const) {
      const ws = sampleWorkspace('home', lang, NOW);
      expect(people(ws).length).toBe(5);
      expect(ws.replay.head).toBeGreaterThan(40);
      expect(hydrate(ws.data).replay.state.tasks.size).toBe(published(ws).tasks.size);
    }
  });

  it('tells the intended story', () => {
    const ws = sampleWorkspace('home', 'en', NOW);
    const saraa = byName(ws, 'Saraa');
    const bat = byName(ws, 'Bat');
    const dulmaa = byName(ws, 'Dulmaa');
    // An open suggestion prepared together by Saraa and Bat.
    expect(new Set(ws.open?.batches.map((b) => b.by))).toEqual(new Set([saraa, bat]));
    // Every one of Saraa's suggestions was accepted, so People suggests trusting her.
    expect(promotionHint(ws, saraa)?.count).toBe(7);
    expect(promotionHint(ws, bat)).toBeNull();
    // Today's list.
    const view = listView(ws, dulmaa, NOW);
    expect(view.doneToday.map((r) => r.text).sort()).toEqual(['Buy bread', 'Take morning pills']);
    expect(view.open.some((r) => r.pendingAdd !== null && r.text === 'Buy kefir')).toBe(true);
    expect(view.open.find((r) => r.text === 'Call about the radio')?.notes.length).toBe(1);
    expect(roleOf(ws.replay.state.people.get(bat)!.perms, 'home')).toBe('custom');
  });

  it('never puts anything in the future, even just after midnight', () => {
    const justAfterMidnight = new Date(2026, 9, 4, 0, 3).getTime();
    const ws = sampleWorkspace('home', 'en', justAfterMidnight);
    expect(Math.max(...ws.data.log.map((v) => v.at))).toBeLessThan(justAfterMidnight);
  });
});

describe('school sample', () => {
  it('replays under the real rules, in both languages, even just after midnight', () => {
    for (const lang of ['en', 'mn'] as const) {
      const ws = sampleWorkspace('school', lang, NOW);
      expect(people(ws).length).toBe(8);
      expect(ws.data.standard).toBe('school');
      expect(hydrate(ws.data).replay.state.steps.size).toBe(published(ws).steps.size);
    }
    const early = new Date(2026, 9, 4, 0, 3).getTime();
    const ws = sampleWorkspace('school', 'en', early);
    expect(Math.max(...ws.data.log.map((v) => v.at))).toBeLessThan(early);
  });

  it('tells the intended story', () => {
    const ws = sampleWorkspace('school', 'en', NOW);
    const [director, manager, saraa, tuya, anu, khulan, nomin, dorj] = [
      'Oyunchimeg',
      'Bat-Erdene',
      'Saraa',
      'Tuya',
      'Anu',
      'Khulan',
      'Nomin',
      'Dorj',
    ].map((n) => byName(ws, n));
    for (const [id, role] of [
      [director, 'director'],
      [manager, 'manager'],
      [saraa, 'teacher'],
      [anu, 'student'],
      [dorj, 'parent'],
    ] as const)
      expect(roleOf(ws.replay.state.people.get(id!)!.perms, 'school')).toBe(role);

    // Everyone has something sensible to do now, or is waiting for others.
    const now = (id: PersonId) => nextSteps(ws, id).now.map((s) => s.step.text);
    expect(now(saraa!)).toEqual(expect.arrayContaining(['Hold the meeting', 'Pack the first-aid kit']));
    expect(now(tuya!)).toContain('Print the papers');
    expect(now(manager!)).toContain('Book the bus');
    expect(now(anu!)).toEqual(['Do the homework']);
    expect(now(nomin!)).toEqual(expect.arrayContaining(['Revise', 'Do the homework']));
    expect(nextSteps(ws, tuya!).later.map((s) => s.step.text)).toContain('Hold the exam');

    // Exam week runs in rounds; some steps wait.
    const exam = [...published(ws).tasks.values()].find((t) => t.text === 'Exam week')!;
    const plan = planOf(published(ws), exam);
    expect(plan.height).toBe(5);
    expect(plan.rounds[0]!.length).toBe(3);

    // Strict control: students see only their part.
    const anuView = listView(ws, anu!, NOW).open.map((r) => r.text);
    expect(anuView).toContain('Reading homework: chapter 4');
    expect(anuView).not.toContain('Parent meeting');
    expect(anuView).not.toContain('Call the education office');
    expect(has(ws.replay.state.people.get(anu!)!.perms, 'see')).toBe(false);

    // A student's idea and a teacher's step for the director's plan are waiting together.
    expect(new Set(ws.open?.batches.filter((b) => b.status === 'pending').map((b) => b.by))).toEqual(new Set([khulan, tuya]));
  });
});

describe('stored format', () => {
  it('round-trips exactly', () => {
    const ws = sampleWorkspace('home', 'mn', NOW);
    const stored = JSON.parse(JSON.stringify(encode(ws.data, 7, NOW)));
    const back = decode(stored);
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(back.value.rev).toBe(7);
      expect(back.value.data).toEqual(ws.data);
    }
  });

  it('stores permissions as readable names', () => {
    const ws = sampleWorkspace('home', 'en', NOW);
    expect(JSON.stringify(encode(ws.data, 1, NOW))).toContain('"suggest:remove"');
  });

  it('opens data saved by the first version as a home list where everyone still sees everything', () => {
    const ws = sampleWorkspace('home', 'en', NOW);
    // Make it look like schema 1: no standard, no "see", no "@own" atoms.
    const v1 = JSON.parse(
      JSON.stringify(encode(ws.data, 3, NOW), (k, v) =>
        Array.isArray(v) && v.every((a) => typeof a === 'string') && (k === 'perms' || k === 'from' || k === 'to')
          ? v.filter((a: string) => a !== 'see' && !a.endsWith('@own'))
          : v,
      ),
    );
    v1.schema = 1;
    delete v1.workspace.standard;
    const back = decode(v1);
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.value.data).toEqual(ws.data);
  });

  it('round-trips a school with plans exactly', () => {
    const ws = sampleWorkspace('school', 'mn', NOW);
    const back = decode(JSON.parse(JSON.stringify(encode(ws.data, 2, NOW))));
    expect(back.ok && back.value.data).toEqual(ws.data);
  });

  it('reports invalid data with where it went wrong', () => {
    const r = decode({ schema: 1, rev: 1, workspace: { id: 'w', log: [{ n: 1 }], suggestions: [] } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatchObject({ kind: 'invalid' });
  });

  it('recognises data from a newer version', () => {
    const r = decode({ schema: SCHEMA + 1, rev: 1, workspace: {} });
    expect(!r.ok && r.error).toEqual({ kind: 'newer', schema: SCHEMA + 1 });
  });
});

describe('local store', () => {
  const seed = () => sampleWorkspace('home', 'en', NOW);
  const quiet = () => {};

  it('starts from the sample when nothing is saved, and saves it', () => {
    const storage = memoryStorage();
    const store = createLocalStore({ key: 'k', storage, seed, warn: quiet });
    expect(store.status()).toEqual({ persistent: true, recovered: false, newerData: false });
    expect(storage.getItem('k')).not.toBeNull();
    const again = createLocalStore({ key: 'k', storage, seed: () => { throw new Error('should not seed'); }, warn: quiet });
    expect(again.get().data).toEqual(store.get().data);
  });

  it('keeps unreadable data aside instead of destroying it', () => {
    const storage = memoryStorage();
    storage.setItem('k', '{not json');
    const store = createLocalStore({ key: 'k', storage, seed, now: () => 42, warn: quiet });
    expect(store.status().recovered).toBe(true);
    expect(storage.getItem('k.unreadable.42')).toBe('{not json');
  });

  it('leaves data from a newer version untouched', () => {
    const storage = memoryStorage();
    const newer = JSON.stringify({ schema: SCHEMA + 1, rev: 3, workspace: {} });
    storage.setItem('k', newer);
    const store = createLocalStore({ key: 'k', storage, seed, warn: quiet });
    expect(store.status()).toMatchObject({ newerData: true, persistent: false });
    store.transact((ws) => {
      const me = byName(ws, 'Dulmaa');
      const o = dispatch(ws, me, { type: 'add', text: 'Tea' }, fixedEnv(NOW));
      return { next: o.kind === 'refused' ? null : o.ws, result: null };
    });
    expect(storage.getItem('k')).toBe(newer);
  });

  it('works in memory when storage is unavailable', () => {
    const store = createLocalStore({ key: 'k', storage: null, seed, warn: quiet });
    expect(store.status().persistent).toBe(false);
    expect(store.get().replay.head).toBeGreaterThan(0);
  });

  it('keeps two tabs in step: a write starts from the newest saved version', () => {
    const storage = memoryStorage();
    const a = createLocalStore({ key: 'k', storage, seed, warn: quiet });
    const b = createLocalStore({ key: 'k', storage, seed, warn: quiet });
    const env = fixedEnv(NOW + 60_000);
    const add = (text: string) => (ws: Workspace) => {
      const o = dispatch(ws, byName(ws, 'Dulmaa'), { type: 'add', text }, env);
      return { next: o.kind === 'refused' ? null : o.ws, result: o.kind };
    };
    expect(a.transact(add('From tab A'))).toBe('published');
    expect(b.transact(add('From tab B'))).toBe('published');
    a.sync();
    const texts = [...preview(a.get()).tasks.values()].map((t) => t.text);
    expect(texts).toContain('From tab A');
    expect(texts).toContain('From tab B');
  });

  const addAs = (text: string) => (ws: Workspace) => {
    const o = dispatch(ws, byName(ws, 'Dulmaa'), { type: 'add', text }, fixedEnv(NOW + 60_000, text));
    return { next: o.kind === 'refused' ? null : o.ws, result: o.kind };
  };
  const texts = (ws: Workspace) => [...preview(ws).tasks.values()].map((t) => t.text);

  it('never overwrites data that a newer version saved later from another tab', () => {
    const storage = memoryStorage();
    const a = createLocalStore({ key: 'k', storage, seed, warn: quiet });
    const newer = JSON.stringify({ schema: SCHEMA + 1, rev: 9, workspace: {} });
    storage.setItem('k', newer);
    storage.setItem('k.rev', '9:from-a-newer-app');
    a.sync();
    expect(a.status()).toMatchObject({ newerData: true, persistent: false });
    a.transact(addAs('Tea'));
    expect(storage.getItem('k')).toBe(newer);
  });

  it('keeps every action in memory when saving fails, and saves them all once it works again', () => {
    const inner = memoryStorage();
    let failing = false;
    const flaky = {
      getItem: (k: string) => inner.getItem(k),
      setItem: (k: string, v: string) => {
        if (failing) throw new Error('QuotaExceededError');
        inner.setItem(k, v);
      },
      removeItem: (k: string) => inner.removeItem(k),
    };
    const a = createLocalStore({ key: 'k', storage: flaky, seed, warn: quiet });
    failing = true;
    a.transact(addAs('First'));
    a.transact(addAs('Second'));
    expect(texts(a.get())).toEqual(expect.arrayContaining(['First', 'Second']));
    expect(a.status().persistent).toBe(false);
    failing = false;
    a.transact(addAs('Third'));
    expect(a.status().persistent).toBe(true);
    const reopened = createLocalStore({ key: 'k', storage: inner, seed, warn: quiet });
    expect(texts(reopened.get())).toEqual(expect.arrayContaining(['First', 'Second', 'Third']));
  });

  it('"start over" in one tab is seen by the other, and not undone by its next write', () => {
    const storage = memoryStorage();
    const a = createLocalStore({ key: 'k', storage, seed, warn: quiet });
    const b = createLocalStore({ key: 'k', storage, seed, warn: quiet });
    a.transact(addAs('From A'));
    b.replace(sampleWorkspace('home', 'en', NOW));
    a.sync();
    expect(texts(a.get())).not.toContain('From A');
    a.transact(addAs('After'));
    const reopened = createLocalStore({ key: 'k', storage, seed, warn: quiet });
    expect(texts(reopened.get())).toContain('After');
    expect(texts(reopened.get())).not.toContain('From A');
  });

  it('notifies subscribers on change only', () => {
    const store = createLocalStore({ key: 'k', storage: memoryStorage(), seed, warn: quiet });
    let calls = 0;
    const off = store.subscribe(() => calls++);
    store.transact(() => ({ next: null, result: null }));
    expect(calls).toBe(0);
    store.replace(seed());
    expect(calls).toBe(1);
    off();
    store.replace(seed());
    expect(calls).toBe(1);
  });
});
