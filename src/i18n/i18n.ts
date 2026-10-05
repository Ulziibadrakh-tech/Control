/** Translation and formatting. One object per language, built once and passed down through React context. */
import type { Lang } from '../core';
import { addDays, startOfDay } from '../core';
import { en, mn, type Key, type Msg, type Params } from './messages';

const DICTS: Record<Lang, Record<Key, Msg>> = { en, mn };
const LOCALE: Record<Lang, string> = { en: 'en-GB', mn: 'mn-MN' };

export interface I18n {
  readonly lang: Lang;
  readonly locale: string;
  t(key: Key, params?: Params): string;
  /** "Saraa and Bat" / "Сараа, Бат нар" */
  people(names: readonly string[]): string;
  /** "Dulmaa or Anu" / "Дулмаа эсвэл Ану" */
  either(names: readonly string[]): string;
  /** A list of short phrases: "add things and tick off". */
  list(items: readonly string[]): string;
  time(ts: number): string;
  /** "Today", "Yesterday", "Monday 28 September" — for grouping. */
  day(ts: number, now: number): string;
  /** "Sunday, 4 October" — for the header. */
  dateLong(ts: number): string;
  /** "today at 09:12", "on Monday at 10:00", "on 12 September". */
  when(ts: number, now: number): string;
  /** "10 minutes ago" */
  ago(ts: number, now: number): string;
  weekdayShort(ts: number): string;
}

const capitalize = (s: string) => (s ? s.charAt(0).toLocaleUpperCase() + s.slice(1) : s);

function interpolate(template: string, params: Params | undefined): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const v = params[name];
    return v === undefined ? whole : String(v);
  });
}

/**
 * Mongolian is formatted by hand. Many browsers ship without Mongolian locale
 * data and would silently fall back to English ("Sunday", "3 hours ago",
 * "03:30 PM"), so we never depend on Intl for it.
 */
const MN_WEEKDAYS = ['ням', 'даваа', 'мягмар', 'лхагва', 'пүрэв', 'баасан', 'бямба'] as const;
const MN_WEEKDAYS_SHORT = ['Ня', 'Да', 'Мя', 'Лх', 'Пү', 'Ба', 'Бя'] as const;
const pad = (n: number) => String(n).padStart(2, '0');

function mnAgo(ts: number, now: number): string {
  const s = Math.round((now - ts) / 1000);
  if (s < 60) return 'саяхан';
  if (s < 3600) return `${Math.round(s / 60)} минутын өмнө`;
  if (s < 86_400) return `${Math.round(s / 3600)} цагийн өмнө`;
  const days = Math.round(s / 86_400);
  return days === 1 ? 'өчигдөр' : `${days} өдрийн өмнө`;
}

export function makeI18n(lang: Lang): I18n {
  const dict = DICTS[lang];
  const locale = LOCALE[lang];
  const mn = lang === 'mn';
  const timeFmt = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const weekdayFmt = new Intl.DateTimeFormat(locale, { weekday: 'long' });
  const weekdayShortFmt = new Intl.DateTimeFormat(locale, { weekday: 'short' });
  const monthDayFmt = new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric' });
  const rel = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const and = new Intl.ListFormat(locale, { type: 'conjunction' });
  const or = new Intl.ListFormat(locale, { type: 'disjunction' });

  const weekday = (ts: number): string => (mn ? (MN_WEEKDAYS[new Date(ts).getDay()] ?? '') : weekdayFmt.format(ts));
  // "10-р сарын 4" is how dates are written in everyday Mongolian.
  const monthDay = (ts: number): string => {
    if (!mn) return monthDayFmt.format(ts);
    const d = new Date(ts);
    return `${d.getMonth() + 1}-р сарын ${d.getDate()}`;
  };
  const clock = (ts: number): string => {
    if (!mn) return timeFmt.format(ts);
    const d = new Date(ts);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const t = (key: Key, params?: Params): string => {
    const m = dict[key];
    return typeof m === 'function' ? m(params ?? {}) : interpolate(m, params);
  };

  return {
    lang,
    locale,
    t,
    people(names) {
      if (names.length <= 1) return names[0] ?? '';
      return mn ? `${names.join(', ')} нар` : and.format(names);
    },
    either(names) {
      if (names.length <= 1) return names[0] ?? '';
      return mn ? `${names.slice(0, -1).join(', ')} эсвэл ${names[names.length - 1]}` : or.format(names);
    },
    list(items) {
      if (items.length <= 1) return items[0] ?? '';
      return mn ? items.join(', ') : and.format(items);
    },
    time: clock,
    day(ts, now) {
      const d = startOfDay(ts);
      const today = startOfDay(now);
      if (d === today) return t('history.today');
      if (d === addDays(today, -1)) return t('history.yesterday');
      return capitalize(`${weekday(ts)}, ${monthDay(ts)}`);
    },
    dateLong: (ts) => capitalize(`${weekday(ts)}, ${monthDay(ts)}`),
    when(ts, now) {
      const d = startOfDay(ts);
      const today = startOfDay(now);
      const time = clock(ts);
      if (d === today) return t('when.today', { time });
      if (d === addDays(today, -1)) return t('when.yesterday', { time });
      if (d > addDays(today, -7)) return t('when.weekday', { day: weekday(ts), time });
      return t('when.date', { date: monthDay(ts) });
    },
    ago(ts, now) {
      if (mn) return mnAgo(ts, now);
      const s = Math.round((ts - now) / 1000);
      const abs = Math.abs(s);
      if (abs < 60) return rel.format(0, 'second');
      if (abs < 3600) return rel.format(Math.round(s / 60), 'minute');
      if (abs < 86_400) return rel.format(Math.round(s / 3600), 'hour');
      return rel.format(Math.round(s / 86_400), 'day');
    },
    weekdayShort: (ts) => (mn ? (MN_WEEKDAYS_SHORT[new Date(ts).getDay()] ?? '') : capitalize(weekdayShortFmt.format(ts))),
  };
}

export function detectLang(): Lang {
  try {
    const langs = typeof navigator === 'undefined' ? [] : (navigator.languages ?? [navigator.language]);
    return langs.some((l) => l?.toLowerCase().startsWith('mn')) ? 'mn' : 'en';
  } catch {
    return 'en';
  }
}

export type { Key, Params };
