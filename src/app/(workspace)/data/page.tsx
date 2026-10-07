import { randomUUID } from 'node:crypto';
import { getWorkspaceContext } from '@/app/workspace/context';
import { applyDataImportAction, exportDataAction, previewDataImportAction } from '@/app/actions/data';
import { deleteOwnPrivateProfileAction } from '@/app/actions/household';
import { DataPrivacyWorkspace } from '@/features/data/DataPrivacyWorkspace';

export default async function DataPage() {
  const { repository, household, user, membership, activePerson } = await getWorkspaceContext();
  const profile = activePerson && (activePerson.linkedUserId === user.id || activePerson.linkedUserId === null)
    ? await repository.getPrivateProfile(activePerson.id)
    : null;
  return (
    <main className="page-wrap">
      <header className="page-heading"><div><p className="eyebrow">Einstellungen</p><h1>Daten & Privatsphäre</h1><p>Eigene private Profile bleiben von gemeinsamen Haushaltsdaten getrennt. Exporte und Importe erfolgen nur auf deine ausdrückliche Auswahl.</p></div></header>
      <DataPrivacyWorkspace
        household={household}
        profile={profile}
        activeUserId={user.id}
        canImport={membership.role !== 'viewer'}
        operationIds={{ profileExport: randomUUID(), householdExport: randomUUID(), importPreview: randomUUID(), deleteProfile: randomUUID() }}
        exportAction={exportDataAction}
        previewAction={previewDataImportAction}
        applyAction={applyDataImportAction}
        deleteProfileAction={deleteOwnPrivateProfileAction}
      />
    </main>
  );
}
