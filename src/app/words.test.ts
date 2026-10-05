import { describe, expect, it } from 'vitest';
import { dispatch, fixedEnv, type Command, type Outcome, type Workspace } from '../core';
import { makeI18n } from '../i18n/i18n';
import { sampleWorkspace } from '../store/seed';
import { makeWords, toastFor } from './words';

describe('messages after an action', () => {
  it('says Undo, then Redo, then Undo again: never "Undone" after a redo', () => {
    const env = fixedEnv(new Date(2026, 9, 5, 15, 30).getTime());
    let ws: Workspace = sampleWorkspace('home', 'en', env.now());
    const me = [...ws.replay.state.people.values()].find((p) => p.name === 'Dulmaa')!.id;
    const i18n = makeI18n('en');
    const step = (cmd: Command): { o: Outcome; message: string; action: string | undefined; next?: Command } => {
      const before = ws;
      const o = dispatch(ws, me, cmd, env);
      if (o.kind === 'refused') throw new Error(o.refusal.code);
      ws = o.ws;
      let next: Command | undefined;
      const spec = toastFor(o, cmd, before, makeWords(i18n, ws, me), (c) => {
        next = c;
      });
      spec?.action?.run();
      return { o, message: spec?.message ?? '', action: spec?.action?.label, ...(next ? { next } : {}) };
    };
    const add = step({ type: 'add', text: 'Tea' });
    expect([add.message, add.action]).toEqual(['Added: “Tea”', 'Undo']);
    const undo = step(add.next!);
    expect([undo.message, undo.action]).toEqual(['Undone.', 'Redo']);
    const redo = step(undo.next!);
    expect([redo.message, redo.action]).toEqual(['Done again.', 'Undo']);
    const again = step(redo.next!);
    expect([again.message, again.action]).toEqual(['Undone.', 'Redo']);
  });
});
