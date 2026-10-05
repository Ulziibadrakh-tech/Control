/** Small shared pieces: avatars, the progress bar, tile icons. */
import {
  CookingPot,
  Footprints,
  GlassWater,
  HeartPulse,
  PencilLine,
  Phone,
  Pill,
  Receipt,
  ShoppingBasket,
  Sofa,
  Sparkles,
  Sprout,
  Stethoscope,
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
};

export function TileIcon({ name }: { readonly name: IconName }) {
  const Icon = ICONS[name];
  return <Icon aria-hidden="true" size={26} strokeWidth={2.25} />;
}
