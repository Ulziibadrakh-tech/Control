/**
 * Ready-made things to choose instead of typing.
 *
 * Tiles never move: elderly users find buttons by where they were last time,
 * so the catalog keeps a fixed order. What history teaches is shown without
 * reordering: the most used tiles get an "often" mark, and things a person has
 * written by hand more than once appear in their own group at the end.
 */
import { cleanText, findOpenTask } from './model';
import { preview, type Workspace } from './workspace';

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
  | 'pen';

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
