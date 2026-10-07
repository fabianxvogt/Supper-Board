'use client';

import { useActionState, useCallback, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { ActionStatus, SubmitButton } from '@/components/SubmitButton';
import { CopyTextButton } from '@/components/CopyTextButton';
import type { Household, HouseholdMember, Person } from '@/data/repository';
import type { HouseholdActionState } from '@/app/actions/household';

import { InvitationAcceptanceForm } from '@/features/household/InvitationAcceptanceForm';
const subscribeToOrigin = () => () => {};
const getClientOrigin = () => window.location.origin;
const getServerOrigin = () => '';
export type HouseholdAction = (state: HouseholdActionState, formData: FormData) => Promise<HouseholdActionState>;

function useMutation(operationId: string, action: HouseholdAction) {
  const router = useRouter();
  const [currentOperationId, setCurrentOperationId] = useState(operationId);
  const mutationAction = useCallback(async (previousState: HouseholdActionState, formData: FormData) => {
    const result = await action(previousState, formData);
    if (result.savedOperationId === formData.get('operationId')) {
      setCurrentOperationId(crypto.randomUUID());
      router.refresh();
    }
    return result;
  }, [action, router]);
  const [state, formAction] = useActionState(mutationAction, {});
  return { currentOperationId, state, formAction };
}

export function HouseholdWorkspace({ household, activeUserId, activeRole, persons, members, invitations, invitationToken, operationIds, createPersonAction, createInvitationAction, acceptInvitationAction, changeMemberRoleAction, removeMemberAction, deletePersonAction, deleteHouseholdAction }: {
  household: Household;
  activeUserId: string;
  activeRole: HouseholdMember['role'];
  persons: Person[];
  members: HouseholdMember[];
  invitations: Array<{ id: string; role: string; invitedEmail: string | null; expiresAt: string; acceptedAt: string | null }>;
  invitationToken: string;
  operationIds: { person: string; invitation: string; acceptance: string; householdDelete: string; roleChanges: Record<string, string>; memberRemovals: Record<string, string>; personRemovals: Record<string, string> };
  createPersonAction: HouseholdAction;
  createInvitationAction: HouseholdAction;
  acceptInvitationAction: HouseholdAction;
  changeMemberRoleAction: HouseholdAction;
  removeMemberAction: HouseholdAction;
  deletePersonAction: HouseholdAction;
  deleteHouseholdAction: HouseholdAction;
}) {
  const canEdit = activeRole !== 'viewer';
  const isOwner = activeRole === 'owner';
  const ownerCount = members.filter((member) => member.role === 'owner').length;
  return <div className="stack">
    <section className="card card-flat stack" aria-label="Haushaltsübersicht">
      <div className="split"><div><p className="eyebrow">Aktiver Haushalt</p><h2>{household.name}</h2><p className="muted">Deine Rolle: {roleName(activeRole)} · Haushaltsrevision {household.revision}</p></div><span className="status">{persons.length} Personen · {members.length} Konten</span></div>
      <p className="help">Haushaltsmitglieder teilen Plan, Rezeptbibliothek, Vorrat und Einkauf gemäß ihrer Rolle. Private Körperangaben werden nicht dadurch sichtbar, dass jemand dem Haushalt angehört.</p>
    </section>

    <section className="stack" aria-labelledby="household-persons-heading">
      <div><p className="eyebrow">Planungspersonen</p><h2 id="household-persons-heading">Personen im Haushalt</h2><p className="muted">Eine Person kann als Gast ohne eigenes Konto geplant werden. Ein Account wird erst über eine ausdrückliche Einladung kontrolliert verknüpft.</p></div>
      {persons.length === 0 ? <p className="empty-state">Noch keine Planungspersonen.</p> : <ul className="stack">{persons.map((person) => <PersonCard key={person.id} person={person} householdId={household.id} canEdit={canEdit} operationId={operationIds.personRemovals[person.id]} deleteAction={deletePersonAction} />)}</ul>}
      {canEdit && <CreatePersonForm householdId={household.id} operationId={operationIds.person} action={createPersonAction} />}
    </section>

    <section className="stack" aria-labelledby="household-members-heading">
      <div><p className="eyebrow">Zugriff & Rollen</p><h2 id="household-members-heading">Konten im Haushalt</h2><p className="muted">Viewer können lesen, aber keine Haushaltsänderungen speichern. Besitzerwechsel erfolgt kontrolliert: erst eine weitere Person zum Besitzer machen, danach die eigene Rolle oder Mitgliedschaft ändern.</p></div>
      <ul className="stack">{members.map((member) => <MemberCard key={member.userId} member={member} household={household} activeUserId={activeUserId} ownerCount={ownerCount} isOwner={isOwner} roleOperationId={operationIds.roleChanges[member.userId]} removalOperationId={operationIds.memberRemovals[member.userId]} changeRoleAction={changeMemberRoleAction} removeMemberAction={removeMemberAction} />)}</ul>
      {canEdit && <CreateInvitationForm householdId={household.id} operationId={operationIds.invitation} action={createInvitationAction} />}
      {invitations.length > 0 && <div className="card stack"><h3>Einladungsstatus</h3><ul className="stack">{invitations.map((invite) => <li key={invite.id}><strong>{invite.invitedEmail ?? 'Einladung ohne E-Mail-Bindung'}</strong><p>Rolle {roleName(invite.role)} · gültig bis {new Date(invite.expiresAt).toLocaleString('de-DE')} · {invite.acceptedAt ? 'angenommen' : 'noch nicht angenommen'}</p></li>)}</ul><p className="help">Einladungen versenden keine E-Mail. Teile den Einladungslink auf einem von dir gewählten, sicheren Weg.</p></div>}
      {canEdit && <InvitationAcceptanceForm token={invitationToken} operationId={operationIds.acceptance} action={acceptInvitationAction} />}
    </section>

    {isOwner && <details className="card stack"><summary className="button button-quiet">Haushalt vollständig löschen</summary><div className="stack"><p className="alert">Diese Aktion löscht gemeinsame Haushaltsdaten. Sie ist getrennt vom Löschen deines privaten Profils. Ein fremdes privates Profil blockiert die Löschung und wird nicht automatisch entfernt.</p><DeleteHouseholdForm household={household} operationId={operationIds.householdDelete} action={deleteHouseholdAction} /></div></details>}
  </div>;
}

function CreatePersonForm({ householdId, operationId, action }: { householdId: string; operationId: string; action: HouseholdAction }) {
  const { currentOperationId, state, formAction } = useMutation(operationId, action);
  return <form className="card stack" action={formAction}>
    <input type="hidden" name="operationId" value={currentOperationId} /><input type="hidden" name="householdId" value={householdId} />
    <p className="eyebrow">Neue Planungsperson</p><h3>Person hinzufügen</h3>
    <div className="form-grid"><label className="field" htmlFor="person-display-name">Anzeigename<input id="person-display-name" name="displayName" maxLength={80} required /></label><label className="field" htmlFor="person-nutrition-mode">Nährwertanzeige<select id="person-nutrition-mode" name="nutritionMode" defaultValue="view"><option value="view">Werte ansehen</option><option value="manual">Eigene Ziele</option><option value="guided">Berechnungshilfe, falls verfügbar</option></select></label></div>
    <p className="help">Dieses Formular verknüpft kein Konto und fragt keine Körperdaten ab.</p><ActionStatus error={state.error} message={state.savedOperationId ? 'Planungsperson gespeichert.' : null} /><SubmitButton>Person speichern</SubmitButton>
  </form>;
}

function PersonCard({ person, householdId, canEdit, operationId, deleteAction }: { person: Person; householdId: string; canEdit: boolean; operationId: string; deleteAction: HouseholdAction }) {
  const { currentOperationId, state, formAction } = useMutation(operationId, deleteAction);
  return <li className="card stack"><div className="split"><div><h3>{person.displayName}</h3><p>{person.linkedUserId ? 'Mit einem angemeldeten Konto verknüpft' : 'Gastprofil ohne Konto'} · {person.nutritionMode === 'view' ? 'Werte ansehen' : person.nutritionMode === 'manual' ? 'Eigene Ziele' : 'Berechnungshilfe'}</p></div><span className="status">Planperson</span></div>{canEdit && <details><summary className="button button-small button-quiet">Planungsperson entfernen</summary><form className="stack" action={formAction}><input type="hidden" name="operationId" value={currentOperationId} /><input type="hidden" name="householdId" value={householdId} /><input type="hidden" name="personId" value={person.id} /><p className="help">Gespeicherte gemeinsame Mahlzeiten werden nicht still gelöscht. Ein privates Profil muss separat unter Daten & Privatsphäre entfernt werden.</p><ActionStatus error={state.error} message={state.savedOperationId ? 'Planungsperson entfernt.' : null} /><SubmitButton className="button button-small button-danger">Planungsperson endgültig entfernen</SubmitButton></form></details>}</li>;
}

function CreateInvitationForm({ householdId, operationId, action }: { householdId: string; operationId: string; action: HouseholdAction }) {
  const { currentOperationId, state, formAction } = useMutation(operationId, action);
  const origin = useSyncExternalStore(subscribeToOrigin, getClientOrigin, getServerOrigin);
  const inviteLink = state.invitationToken && origin ? new URL(`/join/${encodeURIComponent(state.invitationToken)}`, origin).toString() : '';
  return <form className="card stack" action={formAction}>
    <input type="hidden" name="operationId" value={currentOperationId} /><input type="hidden" name="householdId" value={householdId} />
    <p className="eyebrow">Kontrollierte Konto-Verknüpfung</p><h3>Mitglied einladen</h3>
    <div className="form-grid"><label className="field" htmlFor="invite-email">E-Mail, optional<input id="invite-email" name="email" type="email" autoComplete="email" maxLength={254} /></label><label className="field" htmlFor="invite-role">Rolle<select id="invite-role" name="role" defaultValue="viewer"><option value="viewer">Viewer · lesen</option><option value="editor">Editor · bearbeiten</option></select></label><label className="field" htmlFor="invite-hours">Einladung gültig für Stunden<input id="invite-hours" name="expiresInHours" type="number" min="1" max="168" defaultValue="72" required /></label></div>
    <p className="help">Beim Annehmen wird das angemeldete Konto explizit mit einer Haushaltsperson verknüpft. Es wird keine Nachricht gesendet und kein Konto anhand eines Namens verbunden.</p>
    <ActionStatus error={state.error} message={state.savedOperationId ? 'Einladung erstellt. Teile den geheimen Link selbst; er läuft ab und kann nur einmal angenommen werden.' : null} /><SubmitButton>Einladung erstellen</SubmitButton>
    {state.invitationToken && inviteLink && <div className="card card-flat stack"><p><strong>Einmaliger Einladungslink</strong> · gültig bis {state.invitationExpiresAt ? new Date(state.invitationExpiresAt).toLocaleString('de-DE') : 'Zeitpunkt unbekannt'}</p><CopyTextButton text={inviteLink} label="Einladungslink kopieren" /><p className="help">Der Token wird nicht per E-Mail versandt. Behandle ihn wie einen Zugangsschlüssel.</p></div>}
  </form>;
}


function MemberCard({ member, household, activeUserId, ownerCount, isOwner, roleOperationId, removalOperationId, changeRoleAction, removeMemberAction }: { member: HouseholdMember; household: Household; activeUserId: string; ownerCount: number; isOwner: boolean; roleOperationId: string; removalOperationId: string; changeRoleAction: HouseholdAction; removeMemberAction: HouseholdAction }) {
  const roleMutation = useMutation(roleOperationId, changeRoleAction);
  const removalMutation = useMutation(removalOperationId, removeMemberAction);
  const isSelf = member.userId === activeUserId;
  const isLastOwner = member.role === 'owner' && ownerCount <= 1;
  return <li className="card stack"><div className="split"><div><h3>{member.personName ?? (isSelf ? 'Dein Konto' : 'Haushaltskonto')}</h3><p>{isSelf ? 'Aktuell angemeldet' : 'Einladung angenommen'} · {roleName(member.role)}</p></div><span className={`status ${member.role === 'owner' ? 'status-success' : ''}`}>{member.role === 'owner' ? 'Besitzer' : member.role === 'editor' ? 'Editor' : 'Viewer'}</span></div>
    {isOwner && <div className="form-grid">
      <form className="stack" action={roleMutation.formAction}>
        <input type="hidden" name="operationId" value={roleMutation.currentOperationId} /><input type="hidden" name="householdId" value={household.id} /><input type="hidden" name="userId" value={member.userId} /><input type="hidden" name="expectedHouseholdRevision" value={household.revision} />
        <label className="field" htmlFor={`member-role-${member.userId}`}>Haushaltsrolle<select id={`member-role-${member.userId}`} name="role" defaultValue={member.role}><option value="owner">Besitzer</option><option value="editor">Editor</option><option value="viewer">Viewer</option></select></label>
        <ActionStatus error={roleMutation.state.error} message={roleMutation.state.savedOperationId ? 'Mitgliederrolle gespeichert.' : null} /><SubmitButton className="button button-small">Rolle ändern</SubmitButton>
      </form>
      <form className="stack" action={removalMutation.formAction}>
        <input type="hidden" name="operationId" value={removalMutation.currentOperationId} /><input type="hidden" name="householdId" value={household.id} /><input type="hidden" name="userId" value={member.userId} /><input type="hidden" name="expectedHouseholdRevision" value={household.revision} />
        <p className="help">Die Entfernung trennt nur den Kontozugriff; die Planungsperson und gemeinsame Historie werden nicht automatisch gelöscht.</p>
        {isLastOwner && <p className="alert">Der letzte Besitzer kann nicht entfernt werden.</p>}
        <ActionStatus error={removalMutation.state.error} message={removalMutation.state.savedOperationId ? 'Mitgliedschaft entfernt.' : null} /><SubmitButton className="button button-small button-danger" disabled={isLastOwner}>Mitgliedschaft entfernen</SubmitButton>
      </form>
    </div>}
    {!isOwner && isSelf && <p className="help">Für Rollenänderungen oder Mitgliedsverwaltung ist ein Besitzer erforderlich.</p>}
  </li>;
}

function DeleteHouseholdForm({ household, operationId, action }: { household: Household; operationId: string; action: HouseholdAction }) {
  const { currentOperationId, state, formAction } = useMutation(operationId, action);
  return <form className="stack" action={formAction}>
    <input type="hidden" name="operationId" value={currentOperationId} /><input type="hidden" name="householdId" value={household.id} /><input type="hidden" name="householdName" value={household.name} /><input type="hidden" name="expectedHouseholdRevision" value={household.revision} />
    <label className="field" htmlFor="confirm-household-delete">Haushaltsnamen zur Bestätigung erneut eingeben<input id="confirm-household-delete" name="confirmName" maxLength={80} required /></label>
    <ActionStatus error={state.error} message={state.savedOperationId ? 'Der Haushalt wurde gelöscht.' : null} /><SubmitButton className="button button-danger">Haushalt und gemeinsame Daten löschen</SubmitButton>
  </form>;
}

function roleName(role: string): string {
  if (role === 'owner') return 'Besitzer';
  if (role === 'editor') return 'Editor';
  if (role === 'viewer') return 'Viewer';
  return role;
}
