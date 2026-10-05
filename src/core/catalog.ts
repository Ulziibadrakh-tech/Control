/**
 * Ready-made things to choose instead of typing.
 *
 * Home: single tasks as tiles. Tiles never move: elderly users find buttons
 * by where they were last time, so the catalog keeps a fixed order. What
 * history teaches is shown without reordering: the most used tiles get an
 * "often" mark, and things a person has written by hand more than once appear
 * in their own group at the end.
 *
 * School: ready-made plans, already broken into steps with as few waits as
 * the work allows. Each step asks for a role; choosing a plan fills in people
 * with that role, and "each" steps become one step per person (every student
 * revises on their own, at the same time).
 */
import type { PersonId } from './ids';
import { cleanText, findOpenTask, type Person } from './model';
import { rankOf, type PresetId } from './permissions';
import { shapeOf, type Shape } from './plan';
import { preview, type DraftStep, type Workspace } from './workspace';

export type Lang = 'en' | 'mn';

export type IconName =
  | 'pill'
  | 'water'
  | 'phone'
  | 'doctor'
  | 'basket'
  | 'bill'
  | 'walk'
  | 'plant'
  | 'cook'
  | 'tidy'
  | 'rest'
  | 'heart'
  | 'pen'
  | 'meeting'
  | 'exam'
  | 'homework'
  | 'trip'
  | 'concert'
  | 'lesson';

export interface CatalogItem {
  readonly key: string;
  readonly icon: IconName;
  readonly text: Readonly<Record<Lang, string>>;
}

export const CATALOG: readonly CatalogItem[] = [
  { key: 'pills', icon: 'pill', text: { en: 'Take my pills', mn: 'Эм уух' } },
  { key: 'water', icon: 'water', text: { en: 'Drink water', mn: 'Ус уух' } },
  { key: 'call', icon: 'phone', text: { en: 'Call the family', mn: 'Гэр бүлдээ залгах' } },
  { key: 'doctor', icon: 'doctor', text: { en: 'See the doctor', mn: 'Эмчид үзүүлэх' } },
  { key: 'shop', icon: 'basket', text: { en: 'Buy groceries', mn: 'Хүнс авах' } },
  { key: 'bills', icon: 'bill', text: { en: 'Pay the bills', mn: 'Төлбөр төлөх' } },
  { key: 'walk', icon: 'walk', text: { en: 'Go for a walk', mn: 'Салхинд гарч алхах' } },
  { key: 'plants', icon: 'plant', text: { en: 'Water the plants', mn: 'Цэцэг услах' } },
  { key: 'cook', icon: 'cook', text: { en: 'Cook a meal', mn: 'Хоол хийх' } },
  { key: 'tidy', icon: 'tidy', text: { en: 'Tidy up', mn: 'Гэр цэвэрлэх' } },
  { key: 'rest', icon: 'rest', text: { en: 'Have a rest', mn: 'Амрах' } },
  { key: 'pressure', icon: 'heart', text: { en: 'Check blood pressure', mn: 'Даралтаа үзэх' } },
];

export interface Choice {
  readonly key: string;
  readonly text: string;
  readonly icon: IconName;
  readonly uses: number;
  readonly onList: boolean;
  readonly often: boolean;
}

export interface Choices {
  readonly catalog: readonly Choice[];
  /** Things written by hand at least twice. */
  readonly own: readonly Choice[];
}

const norm = (s: string) => cleanText(s).toLocaleLowerCase();

export function choices(ws: Workspace, lang: Lang, opts: { minOwnUses?: number; maxOwn?: number } = {}): Choices {
  const minOwnUses = opts.minOwnUses ?? 2;
  const maxOwn = opts.maxOwn ?? 6;

  // How often each text was added on purpose (not by undo or going back).
  const uses = new Map<string, { text: string; n: number; first: number }>();
  for (const v of ws.data.log) {
    if (v.cause.type !== 'direct' && v.cause.type !== 'suggestion') continue;
    for (const c of v.changes) {
      if (c.op !== 'task.add') continue;
      const k = norm(c.task.text);
      const u = uses.get(k);
      if (u) u.n++;
      else uses.set(k, { text: c.task.text, n: 1, first: v.at });
    }
  }

  const view = preview(ws);
  const catalogKeys = new Set(CATALOG.flatMap((i) => [norm(i.text.en), norm(i.text.mn)]));

  const catalog: Choice[] = CATALOG.map((i) => {
    const text = i.text[lang];
    return {
      key: i.key,
      text,
      icon: i.icon,
      uses: uses.get(norm(text))?.n ?? 0,
      onList: findOpenTask(view, text) !== undefined,
      often: false,
    };
  });

  const own: Choice[] = [...uses.values()]
    .filter((u) => u.n >= minOwnUses && !catalogKeys.has(norm(u.text)))
    .sort((a, b) => a.first - b.first)
    .slice(0, maxOwn)
    .map((u) => ({
      key: `own:${norm(u.text)}`,
      text: u.text,
      icon: 'pen' as const,
      uses: u.n,
      onList: findOpenTask(view, u.text) !== undefined,
      often: false,
    }));

  const oftenKeys = new Set(
    [...catalog, ...own]
      .filter((c) => c.uses >= 3)
      .sort((a, b) => b.uses - a.uses)
      .slice(0, 3)
      .map((c) => c.key),
  );
  const mark = (c: Choice): Choice => (oftenKeys.has(c.key) ? { ...c, often: true } : c);
  return { catalog: catalog.map(mark), own: own.map(mark) };
}

/* ------------------------------------------------------- school plans */

export type RoleKey = Extract<PresetId, 'director' | 'manager' | 'teacher' | 'student' | 'parent'>;

export interface TemplateStep {
  readonly key: string;
  readonly text: Readonly<Record<Lang, string>>;
  readonly role: RoleKey;
  /** One step for every person with this role, all at the same time. */
  readonly each?: boolean;
  readonly after: readonly string[];
}

export interface PlanTemplate {
  readonly key: string;
  readonly icon: IconName;
  readonly title: Readonly<Record<Lang, string>>;
  readonly steps: readonly TemplateStep[];
}

const step = (key: string, en: string, mn: string, role: RoleKey, after: string[] = [], each = false): TemplateStep => ({
  key,
  text: { en, mn },
  role,
  after,
  ...(each ? { each } : {}),
});

/** Fixed order, like the home tiles. Waits only where the work really needs them. */
export const PLANS: readonly PlanTemplate[] = [
  {
    key: 'parents',
    icon: 'meeting',
    title: { en: 'Parent meeting', mn: 'Эцэг эхийн хурал' },
    steps: [
      step('date', 'Set the date', 'Хурлын өдрийг товлох', 'manager'),
      step('progress', 'Prepare each student’s progress', 'Сурагч бүрийн явцыг бэлтгэх', 'teacher'),
      step('hall', 'Book the hall', 'Танхим захиалах', 'manager', ['date']),
      step('invite', 'Write and send the invitation', 'Урилга бичиж илгээх', 'teacher', ['date']),
      step('confirm', 'Say whether you can come', 'Ирэх эсэхээ мэдэгдэх', 'parent', ['invite'], true),
      step('hold', 'Hold the meeting', 'Хурлаа хийх', 'teacher', ['hall', 'progress', 'confirm']),
    ],
  },
  {
    key: 'exam',
    icon: 'exam',
    title: { en: 'Exam week', mn: 'Шалгалтын долоо хоног' },
    steps: [
      step('questions', 'Write the questions', 'Шалгалтын асуулт бэлтгэх', 'teacher'),
      step('rooms', 'Book the rooms', 'Анги танхим хуваарилах', 'manager'),
      step('timetable', 'Tell students the timetable', 'Хуваарийг сурагчдад мэдэгдэх', 'teacher'),
      step('check', 'Check the questions', 'Асуултыг хянах', 'manager', ['questions']),
      step('revise', 'Revise', 'Давтлага хийх', 'student', ['timetable'], true),
      step('print', 'Print the papers', 'Материал хэвлэх', 'teacher', ['check']),
      step('hold', 'Hold the exam', 'Шалгалт авах', 'teacher', ['rooms', 'print', 'revise']),
      step('mark', 'Mark the papers', 'Дүн гаргах', 'teacher', ['hold']),
    ],
  },
  {
    key: 'homework',
    icon: 'homework',
    title: { en: 'Homework', mn: 'Гэрийн даалгавар' },
    steps: [
      step('give', 'Give the homework', 'Даалгавар өгөх', 'teacher'),
      step('do', 'Do the homework', 'Даалгавраа хийх', 'student', ['give'], true),
      step('check', 'Check the homework', 'Даалгавар шалгах', 'teacher', ['do']),
    ],
  },
  {
    key: 'trip',
    icon: 'trip',
    title: { en: 'Field trip', mn: 'Аялал' },
    steps: [
      step('place', 'Choose the place and date', 'Газар, өдрөө сонгох', 'teacher'),
      step('kit', 'Pack the first-aid kit', 'Анхны тусламжийн хэрэгсэл бэлтгэх', 'teacher'),
      step('approve', 'Approve the trip', 'Аяллыг зөвшөөрөх', 'director', ['place']),
      step('bus', 'Book the bus', 'Автобус захиалах', 'manager', ['approve']),
      step('slip', 'Sign the permission slip', 'Зөвшөөрлийн хуудсанд гарын үсэг зурах', 'parent', ['approve'], true),
      step('go', 'Go on the trip', 'Аялалдаа гарах', 'teacher', ['bus', 'slip', 'kit']),
    ],
  },
  {
    key: 'concert',
    icon: 'concert',
    title: { en: 'School concert', mn: 'Сургуулийн тоглолт' },
    steps: [
      step('programme', 'Choose the programme', 'Хөтөлбөрөө сонгох', 'teacher'),
      step('decorate', 'Decorate the hall', 'Танхим чимэглэх', 'manager'),
      step('rehearse', 'Rehearse', 'Бэлтгэл хийх', 'student', ['programme'], true),
      step('invite', 'Invite the parents', 'Эцэг эхчүүдийг урих', 'teacher', ['programme']),
      step('show', 'Hold the concert', 'Тоглолтоо хийх', 'director', ['rehearse', 'decorate', 'invite']),
    ],
  },
  {
    key: 'lesson',
    icon: 'lesson',
    title: { en: 'Lesson plan check', mn: 'Хичээлийн төлөвлөгөө хянах' },
    steps: [
      step('write', 'Write the lesson plan', 'Хичээлийн төлөвлөгөө бичих', 'teacher'),
      step('review', 'Review the plan', 'Төлөвлөгөөг хянах', 'manager', ['write']),
      step('fix', 'Make the corrections', 'Засвар оруулах', 'teacher', ['review']),
      step('sign', 'Sign it off', 'Батлах', 'director', ['fix']),
    ],
  },
];

/** People whose role (their highest rung on the ladder) is exactly this one. */
export function peopleWithRole(ws: Workspace, role: RoleKey): Person[] {
  return [...ws.replay.state.people.values()].filter((p) => rankOf(p.perms, ws.data.standard) === role);
}

/** Who a ready-made step goes to: me if it is my role, otherwise the first person with it, otherwise me. */
export function defaultAssignee(ws: Workspace, role: RoleKey, me: PersonId): PersonId {
  const mine = ws.replay.state.people.get(me);
  if (mine && rankOf(mine.perms, ws.data.standard) === role) return me;
  return peopleWithRole(ws, role)[0]?.id ?? me;
}

export interface PlanDraftStep extends DraftStep {
  /** The template step it came from. */
  readonly from: string;
  readonly role: RoleKey;
  /** True for one of the copies of an "each" step. */
  readonly each: boolean;
}

/**
 * Turn a ready-made plan into draft steps for these people. "Each" steps become
 * one copy per person with the role; whoever waited for the step waits for all
 * the copies. A role nobody has drops out, and so do waits for it.
 */
export function planDraft(ws: Workspace, t: PlanTemplate, lang: Lang, me: PersonId): PlanDraftStep[] {
  const copies = new Map<string, string[]>();
  const out: PlanDraftStep[] = [];
  for (const s of t.steps) {
    if (s.each) {
      const people = peopleWithRole(ws, s.role);
      copies.set(
        s.key,
        people.map((p) => `${s.key}:${p.id}`),
      );
      for (const p of people) out.push({ key: `${s.key}:${p.id}`, from: s.key, role: s.role, each: true, text: s.text[lang], who: p.id, after: s.after });
    } else {
      copies.set(s.key, [s.key]);
      out.push({ key: s.key, from: s.key, role: s.role, each: false, text: s.text[lang], who: defaultAssignee(ws, s.role, me), after: s.after });
    }
  }
  return out.map((d) => ({ ...d, after: d.after.flatMap((k) => copies.get(k) ?? []) }));
}

export interface PlanChoice {
  readonly key: string;
  readonly title: string;
  readonly icon: IconName;
  readonly shape: Shape;
  readonly onList: boolean;
}

export function planChoices(ws: Workspace, lang: Lang, me: PersonId): PlanChoice[] {
  const view = preview(ws);
  return PLANS.map((t) => {
    const draft = planDraft(ws, t, lang, me);
    return {
      key: t.key,
      title: t.title[lang],
      icon: t.icon,
      shape: shapeOf(draft.map((d) => ({ id: d.key, after: d.after }))),
      onList: findOpenTask(view, t.title[lang]) !== undefined,
    };
  });
}
