import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { getWorkspaceContext } from '@/app/workspace/context';
import { acceptInvitationAction, changeMemberRoleAction, createInvitationAction, createPersonAction, deleteHouseholdAction, deletePersonAction, removeMemberAction } from '@/app/actions/household';
import { HouseholdWorkspace } from '@/features/household/HouseholdWorkspace';

export default async function HouseholdPage({ searchParams }: { searchParams: Promise<{ inviteToken?: string }> }) {
  const params = await searchParams;
  const { repository, user, household, persons, membership } = await getWorkspaceContext();
  const [members, invitations] = await Promise.all([
    repository.listHouseholdMembers(household.id),
    repository.listInvitations(household.id),
  ]);
  return (
    <main className="page-wrap">
      <header className="page-heading"><div><p className="eyebrow">Haushalt & Personen</p><h1>Gemeinsam planen, private Profile schützen</h1><p>Personen und Konten sind getrennte Dinge. Rollen regeln Haushaltsänderungen; private Körperangaben bleiben privat.</p></div></header>
      <nav className="button-row" aria-label="Einstellungen">
        <Link className="button button-small" href="/profile">Mein privates Profil</Link>
        <Link className="button button-small" href="/data">Daten & Privatsphäre · Export und Löschen</Link>
      </nav>
      <HouseholdWorkspace
        household={household}
        activeUserId={user.id}
        activeRole={membership.role}
        persons={persons}
        members={members}
        invitations={invitations}
        invitationToken={params.inviteToken?.slice(0, 200) ?? ''}
        operationIds={{
          person: randomUUID(),
          invitation: randomUUID(),
          acceptance: randomUUID(),
          householdDelete: randomUUID(),
          roleChanges: Object.fromEntries(members.map((member) => [member.userId, randomUUID()])),
          memberRemovals: Object.fromEntries(members.map((member) => [member.userId, randomUUID()])),
          personRemovals: Object.fromEntries(persons.map((person) => [person.id, randomUUID()])),
        }}
        createPersonAction={createPersonAction}
        createInvitationAction={createInvitationAction}
        acceptInvitationAction={acceptInvitationAction}
        changeMemberRoleAction={changeMemberRoleAction}
        removeMemberAction={removeMemberAction}
        deletePersonAction={deletePersonAction}
        deleteHouseholdAction={deleteHouseholdAction}
      />
    </main>
  );
}
