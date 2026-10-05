/** Small shared pieces: avatars, the progress bar and ring, tile icons. */
import {
  BookOpen,
  Bus,
  ClipboardCheck,
  CookingPot,
  Footprints,
  GlassWater,
  HeartPulse,
  Music,
  NotebookPen,
  PencilLine,
  Phone,
  Pill,
  Receipt,
  ShoppingBasket,
  Sofa,
  Sparkles,
  Sprout,
  Stethoscope,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { IconName, Person } from '../../core';

export function Avatar({
  person,
  size = 'md',
}: {
  readonly person: Pick<Person, 'name' | 'hue'> | undefined;
  readonly size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const initial = person ? (Array.from(person.name.trim())[0] ?? '?').toLocaleUpperCase() : '?';
  return (
    <span className={`avatar avatar--${size} hue-${person?.hue ?? 'clay'}`} aria-hidden="true">
      {initial}
    </span>
  );
}

export function ProgressBar({ done, total, label }: { readonly done: number; readonly total: number; readonly label: string }) {
  if (total <= 0) return null;
  const pct = Math.round((done / total) * 100);
  return (
    <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label={label}>
      <span className="bar__fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

const ICONS: Record<IconName, LucideIcon> = {
  pill: Pill,
  water: GlassWater,
  phone: Phone,
  doctor: Stethoscope,
  basket: ShoppingBasket,
  bill: Receipt,
  walk: Footprints,
  plant: Sprout,
  cook: CookingPot,
  tidy: Sparkles,
  rest: Sofa,
  heart: HeartPulse,
  pen: PencilLine,
  meeting: Users,
  exam: ClipboardCheck,
  homework: BookOpen,
  trip: Bus,
  concert: Music,
  lesson: NotebookPen,
};

export function TileIcon({ name }: { readonly name: IconName }) {
  const Icon = ICONS[name];
  return <Icon aria-hidden="true" size={26} strokeWidth={2.25} />;
}

/**
 * A plan's progress as a ring with "2/5" inside. Shown where a single task has
 * its tick circle, so a plan reads as "in progress" at a glance; it is not a
 * button (a plan is ticked off step by step).
 */
export function Ring({ done, total, label }: { readonly done: number; readonly total: number; readonly label: string }) {
  const r = 20;
  const c = 2 * Math.PI * r;
  const part = total > 0 ? done / total : 0;
  return (
    <span className="ring" role="img" aria-label={label} data-done={done === total || undefined}>
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <circle className="ring__track" cx="24" cy="24" r={r} />
        <circle
          className="ring__fill"
          cx="24"
          cy="24"
          r={r}
          strokeDasharray={`${c * part} ${c}`}
          transform="rotate(-90 24 24)"
        />
      </svg>
      <span className="ring__text" aria-hidden="true">
        {done}/{total}
      </span>
    </span>
  );
}
