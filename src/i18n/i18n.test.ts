import { describe, expect, it } from 'vitest';
import { en, mn } from './messages';
import { makeI18n } from './i18n';

const NOW = new Date(2026, 9, 4, 15, 30).getTime();

describe('translations', () => {
  it('has every English key in Mongolian and nothing extra', () => {
    expect(Object.keys(mn).sort()).toEqual(Object.keys(en).sort());
  });

  it('fills placeholders and plurals', () => {
    const t = makeI18n('en').t;
    expect(t('toast.added', { text: 'Tea' })).toBe('Added: “Tea”');
    expect(t('list.progress', { done: 2, open: 1 })).toBe('2 done today, 1 to go');
    expect(t('list.progress', { done: 0, open: 1 })).toBe('1 thing to do');
    expect(t('banner.approver', { names: 'Saraa and Bat', people: 2, n: 2 })).toBe('Saraa and Bat suggest 2 changes.');
    expect(t('banner.approver', { names: 'Saraa', people: 1, n: 1 })).toBe('Saraa suggests a change.');
  });

  it('formats Mongolian by hand, the same in every browser', () => {
    const m = makeI18n('mn');
    expect(m.dateLong(NOW)).toBe('Ням, 10-р сарын 4');
    expect(m.time(NOW)).toBe('15:30');
    expect(m.ago(NOW - 3 * 3600_000, NOW)).toBe('3 цагийн өмнө');
    expect(m.people(['Сараа', 'Бат'])).toBe('Сараа, Бат нар');
    expect(m.either(['Дулмаа', 'Ану'])).toBe('Дулмаа эсвэл Ану');
    expect(m.weekdayShort(NOW)).toBe('Ня');
    expect(m.when(NOW - 24 * 3600_000, NOW)).toBe('өчигдөр 15:30');
  });

  it('uses a 24-hour clock in English too', () => {
    expect(makeI18n('en').time(NOW)).toBe('15:30');
  });
});
