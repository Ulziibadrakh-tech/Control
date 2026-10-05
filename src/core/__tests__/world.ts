/** A small household to run scenarios in: one owner, an approver, two helpers with different rights, a viewer. */
import { expect } from 'vitest';
import { fixedEnv, type PersonId, type TaskId } from '../ids';
import { fromAtoms, presetPerms } from '../permissions';
import { HOUR } from '../time';
import { createWorkspace, dispatch, published, type Command, type Outcome, type Workspace } from '../workspace';

export const T0 = new Date(2026, 9, 1, 9, 0).getTime();

export function world() {
  const env = fixedEnv(T0);
  let ws: Workspace = createWorkspace(env, { name: 'Dulmaa' });
  const dulmaa = [...ws.replay.state.people.values()][0]!.id;

  const run = (who: PersonId, cmd: Command): Outcome => {
    env.advance(60_000);
    const o = dispatch(ws, who, cmd, env);
    if (o.kind !== 'refused') ws = o.ws;
    return o;
  };

  const ok = (who: PersonId, cmd: Command): Outcome => {
    const o = run(who, cmd);
    if (o.kind === 'refused') throw new Error(`refused: ${JSON.stringify(o.refusal)} for ${JSON.stringify(cmd)}`);
    return o;
  };

  const addPerson = (name: string, perms: ReturnType<typeof presetPerms>): PersonId => {
    const o = ok(dulmaa, { type: 'addPerson', name, perms });
    if (o.kind !== 'published') throw new Error('expected published');
    const c = o.version.changes[0];
    if (!c || c.op !== 'person.add') throw new Error('expected person.add');
    return c.person.id;
  };

  const anu = addPerson('Anu', presetPerms('approver'));
  const bat = addPerson('Bat', fromAtoms(['do:add', 'do:check', 'suggest:edit', 'suggest:remove']));
  const saraa = addPerson('Saraa', presetPerms('helper'));
  const bold = addPerson('Bold', presetPerms('viewer'));

  const taskId = (text: string): TaskId => {
    const all = [...published(ws).tasks.values()].filter((t) => t.text === text);
    const pub = all.find((t) => !t.done) ?? all[0];
    if (pub) return pub.id;
    const pending = [...(ws.evaluation?.preview.tasks.values() ?? [])].find((t) => t.text === text);
    if (pending) return pending.id;
    throw new Error(`no task "${text}"`);
  };

  return {
    env,
    get ws() {
      return ws;
    },
    set ws(next: Workspace) {
      ws = next;
    },
    run,
    ok,
    taskId,
    texts: () => [...published(ws).tasks.values()].map((t) => t.text).sort(),
    later: (hours: number) => env.advance(hours * HOUR),
    people: { dulmaa, anu, bat, saraa, bold },
  };
}

export function refusal(o: Outcome): string {
  expect(o.kind).toBe('refused');
  return o.kind === 'refused' ? o.refusal.code : '';
}
