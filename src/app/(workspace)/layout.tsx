import type { ReactNode } from 'react';
import { AppFrame } from '@/components/AppFrame';
import { signOutAction } from '@/app/actions/auth';
import { switchActiveContextAction } from '@/app/actions/context';
import { getWorkspaceContext } from '@/app/workspace/context';

export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  const context = await getWorkspaceContext();
  return (
    <AppFrame
      households={context.households.map((household) => ({ id: household.id, name: household.name }))}
      householdId={context.household.id}
      householdName={context.household.name}
      persons={context.persons.map((person) => ({ id: person.id, displayName: person.displayName }))}
      personId={context.activePerson?.id ?? null}
      personName={context.activePerson?.displayName ?? null}
      switchContextAction={switchActiveContextAction}
      signOutAction={signOutAction}
    >
      {children}
    </AppFrame>
  );
}
