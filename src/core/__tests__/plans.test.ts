import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PLANS, planDraft } from '../catalog';
import { timeline } from '../describe';
import { stepsOf, isTaskDone } from '../model';
import { canSeeTask, planOf, planProblem, visibleSteps } from '../plan';
import { listView, nextSteps } from '../view';
import { published, preview, dispatch, type Command } from '../workspace';
import { PersonId } from '../ids';
import { refusal } from './world';
import { school } from './school';

describe('breaking a task down when it is created', () => {
  it('publishes a teacher’s plan with its steps, and works out the rounds', () => {
    const w = school();
    const { saraa } = w.people;
    const o = w.ok(saraa, { type: 'add', text: 'Exam', steps: w.draft(saraa) });
    expect(o.kind).toBe('published');
    const plan = planOf(published(w.ws), published(w.ws).tasks.get(w.taskId('Exam'))!);
    expect(plan.total).toBe(4);
    expect(plan.height).toBe(2);
    expect(plan.rounds.map((r) => r.map((s) => s.step.text))).toEqual([
      ['Write the questions', 'Book the room', 'Tell the students'],
      ['Hold the exam'],
    ]);
    expect(plan.width).toBe(3);
    expect(plan.steps.filter((s) => s.ready).map((s) => s.step.n)).toEqual([1, 2, 4]);
  });

  it('turns a student’s plan into a suggestion a teacher can OK', () => {
    const w = school();
    const { anu, khulan, saraa } = w.people;
    const o = w.ok(anu, {
      type: 'add',
      text: 'Class garden',
      steps: [
        { key: 'x', text: 'Buy seeds', who: anu, after: [] },
        { key: 'y', text: 'Plant them', who: khulan, after: ['x'] },
      ],
    });
    expect(o.kind).toBe('suggested');
    expect(published(w.ws).tasks.size).toBe(0);
    expect(stepsOf(preview(w.ws), w.taskId('Class garden')).length).toBe(2);
    w.ok(saraa, { type: 'accept', suggestion: w.ws.open!.id });
    expect(stepsOf(published(w.ws), w.taskId('Class garden')).map((s) => s.text)).toEqual(['Buy seeds', 'Plant them']);
  });

  it('refuses circles of waits and steps for people who are not here', () => {
    const w = school();
    const { saraa } = w.people;
    const circle = [
      { key: 'a', text: 'A', who: saraa, after: ['b'] },
      { key: 'b', text: 'B', who: saraa, after: ['a'] },
    ];
    expect(refusal(w.run(saraa, { type: 'add', text: 'Loop', steps: circle }))).toBe('cycle');
    const stranger = [{ key: 'a', text: 'A', who: PersonId('nobody'), after: [] }];
    expect(refusal(w.run(saraa, { type: 'add', text: 'Lost', steps: stranger }))).toBe('not-found');
  });
});

describe('doing the steps', () => {
  it('a step can only be ticked once what it waits for is done, and only unticked while nothing after it is', () => {
    const w = school();
    const { saraa, manager } = w.people;
    w.ok(saraa, { type: 'add', text: 'Exam', steps: w.draft(saraa) });
    const o = w.run(saraa, { type: 'checkStep', id: w.stepId('Exam', 'Hold the exam'), done: true });
    expect(o.kind === 'refused' && o.refusal).toMatchObject({ code: 'waits-for', text: 'Write the questions' });
    w.ok(saraa, { type: 'checkStep', id: w.stepId('Exam', 'Write the questions'), done: true });
    w.ok(manager, { type: 'checkStep', id: w.stepId('Exam', 'Book the room'), done: true });
    w.ok(saraa, { type: 'checkStep', id: w.stepId('Exam', 'Hold the exam'), done: true });
    expect(refusal(w.run(manager, { type: 'checkStep', id: w.stepId('Exam', 'Book the room'), done: false }))).toBe('later-done');
  });

  it('students tick their own steps; anyone else’s is not theirs to tick', () => {
    const w = school();
    const { saraa, anu, khulan } = w.people;
    w.ok(saraa, { type: 'add', text: 'Exam', steps: w.draft(saraa) });
    expect(w.ok(anu, { type: 'checkStep', id: w.stepId('Exam', 'Tell the students'), done: true }).kind).toBe('published');
    const o = w.run(khulan, { type: 'checkStep', id: w.stepId('Exam', 'Write the questions'), done: true });
    expect(o.kind === 'refused' && o.refusal).toEqual({ code: 'not-allowed', missing: ['suggest:check'] });
  });

  it('a teacher ticking a step in someone else’s plan, given to someone else, suggests it', () => {
    const w = school();
    const { saraa, tuya, manager } = w.people;
    w.ok(saraa, { type: 'add', text: 'Exam', steps: w.draft(saraa) });
    expect(w.ok(tuya, { type: 'checkStep', id: w.stepId('Exam', 'Book the room'), done: true }).kind).toBe('suggested');
    // The plan's owner may tick any step of her own plan.
    expect(w.ok(saraa, { type: 'checkStep', id: w.stepId('Exam', 'Book the room'), done: true }).kind).toBe('published');
    expect(w.ws.evaluation?.valid[0]?.changes).toEqual([]);
    void manager;
  });

  it('a plan is done when all its steps are, and cannot be ticked as a whole', () => {
    const w = school();
    const { saraa, manager, anu } = w.people;
    w.ok(saraa, { type: 'add', text: 'Exam', steps: w.draft(saraa) });
    expect(refusal(w.run(saraa, { type: 'check', id: w.taskId('Exam'), done: true }))).toBe('has-steps');
    for (const [who, text] of [
      [saraa, 'Write the questions'],
      [manager, 'Book the room'],
      [anu, 'Tell the students'],
      [saraa, 'Hold the exam'],
    ] as const)
      w.ok(who, { type: 'checkStep', id: w.stepId('Exam', text), done: true });
    const t = published(w.ws).tasks.get(w.taskId('Exam'))!;
    expect(isTaskDone(published(w.ws), t)).toBe(true);
    expect(listView(w.ws, saraa, w.env.now()).doneToday.map((r) => r.text)).toEqual(['Exam']);
  });

  it('lists each person’s next steps, and what they wait for', () => {
    const w = school();
    const { saraa, manager } = w.people;
    w.ok(saraa, { type: 'add', text: 'Exam', steps: w.draft(saraa) });
    expect(nextSteps(w.ws, saraa).now.map((s) => s.step.text)).toEqual(['Write the questions']);
    const later = nextSteps(w.ws, saraa).later;
    expect(later.map((s) => s.step.text)).toEqual(['Hold the exam']);
    expect(later[0]!.waitingFor.map((s) => s.text).sort()).toEqual(['Book the room', 'Write the questions']);
    expect(nextSteps(w.ws, manager).now.map((s) => s.step.text)).toEqual(['Book the room']);
  });
});

describe('changing a plan', () => {
  it('adds a step later, and lets it wait for others', () => {
    const w = school();
    const { saraa, manager } = w.people;
    w.ok(saraa, { type: 'add', text: 'Exam', steps: w.draft(saraa) });
    w.ok(saraa, {
      type: 'addStep',
      task: w.taskId('Exam'),
      text: 'Mark the papers',
      who: saraa,
      after: [w.stepId('Exam', 'Hold the exam')],
    });
    const plan = planOf(published(w.ws), published(w.ws).tasks.get(w.taskId('Exam'))!);
    expect(plan.height).toBe(3);
    expect(plan.steps.at(-1)?.step.n).toBe(5);
    // The manager may change anyone's plan; another teacher only suggests it.
    expect(w.ok(manager, { type: 'addStep', task: w.taskId('Exam'), text: 'Count chairs', who: manager }).kind).toBe(
      'published',
    );
    expect(w.ok(w.people.tuya, { type: 'addStep', task: w.taskId('Exam'), text: 'Bring pens', who: w.people.tuya }).kind).toBe(
      'suggested',
    );
  });

  it('refuses waits that go round in a circle, and done steps waiting for undone ones', () => {
    const w = school();
    const { saraa } = w.people;
    w.ok(saraa, { type: 'add', text: 'Exam', steps: w.draft(saraa) });
    const a = w.stepId('Exam', 'Write the questions');
    const c = w.stepId('Exam', 'Hold the exam');
    const d = w.stepId('Exam', 'Tell the students');
    expect(refusal(w.run(saraa, { type: 'setWaits', id: a, after: [c] }))).toBe('cycle');
    w.ok(w.people.anu, { type: 'checkStep', id: d, done: true });
    const o = w.run(saraa, { type: 'setWaits', id: d, after: [a] });
    expect(o.kind === 'refused' && o.refusal).toEqual({ code: 'order', text: 'Tell the students', waitsFor: 'Write the questions' });
  });

  it('removing a step lets nothing start earlier than before: its waits pass on', () => {
    const w = school();
    const { saraa } = w.people;
    w.ok(saraa, {
      type: 'add',
      text: 'Chain',
      steps: [
        { key: 'a', text: 'A', who: saraa, after: [] },
        { key: 'b', text: 'B', who: saraa, after: ['a'] },
        { key: 'c', text: 'C', who: saraa, after: ['b'] },
      ],
    });
    const removed = w.ok(saraa, { type: 'removeStep', id: w.stepId('Chain', 'B') });
    expect(w.step('Chain', 'C').after).toEqual([w.stepId('Chain', 'A')]);
    if (removed.kind !== 'published') throw new Error();
    w.ok(saraa, { type: 'undo', version: removed.version.n });
    expect(w.step('Chain', 'C').after).toEqual([w.stepId('Chain', 'B')]);
    expect(stepsOf(published(w.ws), w.taskId('Chain')).length).toBe(3);
  });

  it('removing a plan takes its steps with it, and undo brings the whole plan back', () => {
    const w = school();
    const { saraa } = w.people;
    w.ok(saraa, { type: 'add', text: 'Exam', steps: w.draft(saraa) });
    const o = w.ok(saraa, { type: 'remove', id: w.taskId('Exam') });
    expect(published(w.ws).steps.size).toBe(0);
    if (o.kind !== 'published') throw new Error();
    w.ok(saraa, { type: 'undo', version: o.version.n });
    expect(stepsOf(published(w.ws), w.taskId('Exam')).length).toBe(4);
  });

  it('an old tick cannot be undone once a later step is done', () => {
    const w = school();
    const { saraa, manager } = w.people;
    w.ok(saraa, { type: 'add', text: 'Exam', steps: w.draft(saraa) });
    const first = w.ok(saraa, { type: 'checkStep', id: w.stepId('Exam', 'Write the questions'), done: true });
    w.ok(manager, { type: 'checkStep', id: w.stepId('Exam', 'Book the room'), done: true });
    w.ok(saraa, { type: 'checkStep', id: w.stepId('Exam', 'Hold the exam'), done: true });
    if (first.kind !== 'published') throw new Error();
    const o = w.run(saraa, { type: 'undo', version: first.version.n });
    expect(o.kind === 'refused' && o.refusal).toEqual({ code: 'order', text: 'Hold the exam', waitsFor: 'Write the questions' });
  });

  it('a suggestion that would break the plan becomes out of date instead', () => {
    const w = school();
    const { saraa, tuya } = w.people;
    w.ok(saraa, { type: 'add', text: 'Exam', steps: w.draft(saraa) });
    // Tuya suggests that telling the students should wait for the questions.
    w.ok(tuya, { type: 'setWaits', id: w.stepId('Exam', 'Tell the students'), after: [w.stepId('Exam', 'Write the questions')] });
    // Meanwhile the owner removes the questions step.
    w.ok(saraa, { type: 'removeStep', id: w.stepId('Exam', 'Write the questions') });
    expect(w.ws.evaluation?.stale.length).toBe(1);
    expect(w.ws.evaluation?.stale[0]?.problem?.code).toBe('missing-dep');
  });
});

describe('who sees what', () => {
  it('students and parents see only their part; teachers see everything', () => {
    const w = school();
    const { saraa, anu, dorj, tuya } = w.people;
    w.ok(saraa, { type: 'add', text: 'Exam', steps: w.draft(saraa) });
    w.ok(saraa, { type: 'add', text: 'Staff meeting' });
    const pub = published(w.ws);
    const exam = pub.tasks.get(w.taskId('Exam'))!;
    const anuP = pub.people.get(anu)!;
    expect(canSeeTask(pub, anuP, exam)).toBe(true);
    expect(canSeeTask(pub, pub.people.get(dorj)!, exam)).toBe(false);
    expect(visibleSteps(pub, anuP, exam).map((s) => s.text)).toEqual(['Tell the students']);
    expect(listView(w.ws, anu, w.env.now()).open.map((r) => r.text)).toEqual(['Exam']);
    expect(listView(w.ws, tuya, w.env.now()).open.map((r) => r.text).sort()).toEqual(['Exam', 'Staff meeting']);
    const history = timeline(w.ws, anu).flatMap((i) => i.phrases.map((p) => p.kind));
    expect(history).not.toContain('step-added');
    expect(timeline(w.ws, anu).some((i) => i.phrases.some((p) => p.kind === 'added' && p.text === 'Staff meeting'))).toBe(false);
  });
});

describe('ready-made plans', () => {
  it('fill in people by role, and give every student their own step', () => {
    const w = school();
    const { tuya, anu, khulan, manager } = w.people;
    const exam = PLANS.find((p) => p.key === 'exam')!;
    const draft = planDraft(w.ws, exam, 'en', tuya);
    expect(draft.filter((d) => d.from === 'revise').map((d) => d.who)).toEqual([anu, khulan]);
    expect(draft.find((d) => d.from === 'rooms')?.who).toBe(manager);
    expect(draft.find((d) => d.from === 'questions')?.who).toBe(tuya);
    expect(draft.find((d) => d.from === 'hold')?.after).toEqual(expect.arrayContaining(draft.filter((d) => d.from === 'revise').map((d) => d.key)));
    expect(w.ok(tuya, { type: 'add', text: exam.title.en, steps: draft }).kind).toBe('published');
    const plan = planOf(published(w.ws), published(w.ws).tasks.get(w.taskId('Exam week'))!);
    expect(plan.height).toBe(5);
  });

  it('every ready-made plan is a valid plan, in both languages', () => {
    const w = school();
    for (const t of PLANS)
      for (const lang of ['en', 'mn'] as const) {
        const o = dispatch(w.ws, w.people.director, { type: 'add', text: t.title[lang], steps: planDraft(w.ws, t, lang, w.people.director) }, w.env);
        expect(o.kind).toBe('published');
      }
  });
});

describe('no sequence of actions breaks a plan’s rules', () => {
  it('keeps every plan sound for any mix of people and actions', () => {
    const intentArb = fc.record({ kind: fc.nat(9), who: fc.nat(6), pick: fc.nat(40), pick2: fc.nat(40), flag: fc.boolean() });
    fc.assert(
      fc.property(fc.array(intentArb, { minLength: 10, maxLength: 60 }), (intents) => {
        const w = school();
        const everyone = Object.values(w.people);
        w.ok(w.people.saraa, { type: 'add', text: 'Exam', steps: w.draft(w.people.saraa) });
        for (const it of intents) {
          const who = everyone[it.who % everyone.length]!;
          const pre = preview(w.ws);
          const steps = [...pre.steps.values()];
          const tasks = [...pre.tasks.values()];
          const st = steps[it.pick % Math.max(1, steps.length)];
          const other = steps[it.pick2 % Math.max(1, steps.length)];
          const task = tasks[it.pick % Math.max(1, tasks.length)];
          let cmd: Command | null = null;
          switch (it.kind) {
            case 0:
              if (st) cmd = { type: 'checkStep', id: st.id, done: it.flag };
              break;
            case 1:
              if (st && other) cmd = { type: 'setWaits', id: st.id, after: it.flag ? [other.id] : [] };
              break;
            case 2:
              if (st) cmd = { type: 'removeStep', id: st.id };
              break;
            case 3:
              if (task) cmd = { type: 'addStep', task: task.id, text: `S${it.pick}`, who, after: other && other.task === task.id ? [other.id] : [] };
              break;
            case 4:
              if (task) cmd = { type: 'remove', id: task.id };
              break;
            case 5: {
              const n = w.ws.replay.head;
              cmd = { type: 'undo', version: 2 + (it.pick % Math.max(1, n - 1)) };
              break;
            }
            case 6:
              cmd = { type: 'restore', to: 1 + (it.pick % w.ws.replay.head) };
              break;
            case 7:
              if (w.ws.open) cmd = { type: 'accept', suggestion: w.ws.open.id };
              break;
            case 8:
              if (st) cmd = { type: 'assignStep', id: st.id, who: everyone[it.pick2 % everyone.length]! };
              break;
            default:
              cmd = { type: 'add', text: `Task ${it.pick}`, steps: it.flag ? w.draft(who) : [] };
          }
          if (!cmd) continue;
          w.run(who, cmd);
          const pub = published(w.ws);
          expect(planProblem(pub, pub.tasks.keys())).toBeNull();
          expect(planProblem(pub, [...pub.steps.values()].map((s) => s.task))).toBeNull();
          const prev = preview(w.ws);
          expect(planProblem(prev, [...prev.steps.values()].map((s) => s.task))).toBeNull();
        }
      }),
      { numRuns: 250 },
    );
  });
});
