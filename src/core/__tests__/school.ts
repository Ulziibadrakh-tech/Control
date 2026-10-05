/** A small school to run plan scenarios in. */
import { fixedEnv, type PersonId, type StepId, type TaskId } from '../ids';
import { stepsOf } from '../model';
import { presetPerms, type PresetId } from '../permissions';
import { createWorkspace, dispatch, published, preview, type Command, type DraftStep, type Outcome, type Workspace } from '../workspace';
import { T0 } from './world';

export function school() {
  const env = fixedEnv(T0, 'k');
  let ws: Workspace = createWorkspace(env, { name: 'Oyuna' }, 'school');
  const director = [...ws.replay.state.people.values()][0]!.id;

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
  const join = (name: string, role: PresetId): PersonId => {
    const o = ok(director, { type: 'addPerson', name, perms: presetPerms(role) });
    if (o.kind !== 'published' || o.version.changes[0]?.op !== 'person.add') throw new Error('expected person.add');
    return o.version.changes[0].person.id;
  };

  const manager = join('Bat', 'manager');
  const saraa = join('Saraa', 'teacher');
  const tuya = join('Tuya', 'teacher');
  const anu = join('Anu', 'student');
  const khulan = join('Khulan', 'student');
  const dorj = join('Dorj', 'parent');

  const taskId = (text: string): TaskId => {
    const t =
      [...published(ws).tasks.values()].find((x) => x.text === text) ??
      [...preview(ws).tasks.values()].find((x) => x.text === text);
    if (!t) throw new Error(`no task "${text}"`);
    return t.id;
  };
  const stepId = (task: string, text: string, who?: PersonId): StepId => {
    const id = taskId(task);
    const s = [...stepsOf(published(ws), id), ...stepsOf(preview(ws), id)].find(
      (x) => x.text === text && (who === undefined || x.who === who),
    );
    if (!s) throw new Error(`no step "${text}" in "${task}"`);
    return s.id;
  };
  const step = (task: string, text: string, who?: PersonId) => published(ws).steps.get(stepId(task, text, who))!;

  /** The plan used in most tests:  a ─┬─ c        (c waits for a and b; d waits for nothing)
   *                               b ─┘          */
  const draft = (owner: PersonId): DraftStep[] => [
    { key: 'a', text: 'Write the questions', who: owner, after: [] },
    { key: 'b', text: 'Book the room', who: manager, after: [] },
    { key: 'c', text: 'Hold the exam', who: owner, after: ['a', 'b'] },
    { key: 'd', text: 'Tell the students', who: anu, after: [] },
  ];

  return {
    env,
    get ws() {
      return ws;
    },
    run,
    ok,
    taskId,
    stepId,
    step,
    draft,
    people: { director, manager, saraa, tuya, anu, khulan, dorj },
  };
}
