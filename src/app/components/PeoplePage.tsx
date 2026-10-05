/**
 * People: who can do what, in sentences rather than a permission table.
 * Includes the data-driven hint ("her last 7 suggestions were all accepted")
 * and the team check: pick people, read what they can do together.
 */
import { ArrowLeft, Lightbulb, UserPlus } from 'lucide-react';
import { useState } from 'react';
import {
  activity,
  approvers,
  has,
  people,
  promotionHint,
  roleOf,
  summarize,
  teamPerms,
  withLevel,
  type Person,
  type PersonId,
} from '../../core';
import { useI18n } from '../../i18n/react';
import { useMe, useNow, useRun, useWords, useWorkspace } from '../context';
import { hrefOf, onRouteClick } from '../route';
import { Avatar } from './bits';
import { AddPersonSheet, RoleSheet } from './RoleSheet';

export function PeoplePage() {
  const ws = useWorkspace();
  const me = useMe();
  const now = useNow();
  const run = useRun();
  const w = useWords();
  const { t } = useI18n();
  const [editing, setEditing] = useState<PersonId | null>(null);
  const [adding, setAdding] = useState(false);
  if (!me) return null;

  const canManage = has(me.perms, 'manage');
  const everyone = people(ws);
  const editingPerson = editing ? ws.replay.state.people.get(editing) : undefined;

  return (
    <div className="page">
      <a className="back" href={hrefOf('home')} onClick={onRouteClick('home')}>
        <ArrowLeft aria-hidden="true" size={22} strokeWidth={2.5} />
        {t('nav.back')}
      </a>
      <h2 className="page__title" tabIndex={-1} data-page-title>
        {t('people.title')}
      </h2>
      <p className="page__intro">{t('people.intro')}</p>

      <ul className="people">
        {everyone.map((p) => {
          const hint = canManage && p.id !== me.id ? promotionHint(ws, p.id) : null;
          return (
            <li key={p.id} className="person">
              <Avatar person={p} size="lg" />
              <div className="person__body">
                <p className="person__name">
                  {p.name}
                  {p.id === me.id ? <span className="tag">{t('people.you')}</span> : null}
                </p>
                <p className="person__role">{w.role(roleOf(p.perms))}</p>
                {w.permsLines(p.perms).map((line, i) => (
                  <p key={i} className="person__desc">
                    {line}
                  </p>
                ))}
                <p className="person__activity">{t('people.thisWeek', { n: activity(ws, p.id, now) })}</p>
                {hint ? (
                  <div className="hint">
                    <Lightbulb aria-hidden="true" size={24} strokeWidth={2.25} />
                    <div>
                      <p className="hint__title">{t('people.hint', { name: p.name, n: hint.count })}</p>
                      <p className="hint__body">{t('people.hintWhat', { name: p.name, actions: w.actions(hint.actions) })}</p>
                      <button
                        type="button"
                        className="btn btn--small btn--primary"
                        onClick={() =>
                          run({
                            type: 'setPerms',
                            id: p.id,
                            perms: hint.actions.reduce((acc, a) => withLevel(acc, a, 'do'), p.perms),
                          })
                        }
                      >
                        {t('people.hintAction', { name: p.name })}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
              {canManage ? (
                <button type="button" className="btn btn--small btn--quiet person__change" onClick={() => setEditing(p.id)}>
                  {t('people.change')}
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>

      {canManage ? (
        <button type="button" className="btn btn--quiet btn--block add-person" onClick={() => setAdding(true)}>
          <UserPlus aria-hidden="true" size={22} strokeWidth={2.4} />
          {t('people.add')}
        </button>
      ) : (
        <p className="note">{t('people.readOnly', { names: w.managerNames() })}</p>
      )}

      <TeamCheck everyone={everyone} />

      {editingPerson ? <RoleSheet person={editingPerson} onClose={() => setEditing(null)} /> : null}
      {adding ? <AddPersonSheet onClose={() => setAdding(false)} /> : null}
    </div>
  );
}

/** "What can this team accomplish together, and under what conditions?" — answered in sentences. */
function TeamCheck({ everyone }: { readonly everyone: readonly Person[] }) {
  const ws = useWorkspace();
  const w = useWords();
  const { t, people: names, either } = useI18n();
  const [picked, setPicked] = useState<readonly PersonId[]>([]);
  const team = everyone.filter((p) => picked.includes(p.id));

  const toggle = (id: PersonId) =>
    setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  let lines: string[];
  if (team.length < 2) lines = [t('team.pick')];
  else {
    const s = summarize(teamPerms(team.map((p) => p.perms)));
    const who = names(team.map((p) => p.name));
    lines = [];
    if (s.can.length > 0) lines.push(t('team.can', { names: who, actions: w.actions(s.can) }));
    if (s.suggest.length > 0) lines.push(t('team.suggest', { actions: w.actions(s.suggest) }));
    if (s.approve) lines.push(t('team.approve'));
    else if (s.suggest.length > 0) {
      const outside = approvers(ws).filter((p) => !picked.includes(p.id));
      if (outside.length > 0) lines.push(t('team.needApprover', { names: either(outside.map((p) => p.name)) }));
    }
    if (lines.length === 0) lines.push(t('team.onlyLook'));
  }

  return (
    <section className="team" aria-labelledby="team-title">
      <h3 id="team-title" className="team__title">
        {t('team.title')}
      </h3>
      <p className="page__intro">{t('team.intro')}</p>
      <div className="chips">
        {everyone.map((p) => (
          <button key={p.id} type="button" className="chip" aria-pressed={picked.includes(p.id)} onClick={() => toggle(p.id)}>
            <Avatar person={p} size="sm" />
            {p.name}
          </button>
        ))}
      </div>
      <div className="team__result" aria-live="polite">
        {lines.map((l, i) => (
          <p key={i}>{l}</p>
        ))}
      </div>
    </section>
  );
}
