'use client';

import { useActionState, useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ActionStatus, SubmitButton } from '@/components/SubmitButton';
import type { Household, PrivateProfileSnapshot } from '@/data/repository';
import type { DataActionState } from '@/app/actions/data';
import type { HouseholdAction } from '@/features/household/HouseholdWorkspace';
import type { HouseholdActionState } from '@/app/actions/household';

export type DataAction = (state: DataActionState, formData: FormData) => Promise<DataActionState>;

export function DataPrivacyWorkspace({ household, profile, activeUserId, canImport, operationIds, exportAction, previewAction, applyAction, deleteProfileAction }: {
  household: Household;
  profile: PrivateProfileSnapshot | null;
  activeUserId: string;
  canImport: boolean;
  operationIds: { profileExport: string; householdExport: string; importPreview: string; deleteProfile: string };
  exportAction: DataAction;
  previewAction: DataAction;
  applyAction: DataAction;
  deleteProfileAction: HouseholdAction;
}) {
  const ownsProfile = profile?.ownerUserId === activeUserId;
  return <div className="stack">
    <section className="card card-flat stack" aria-label="Daten & Privatsphäre">
      <p className="eyebrow">Daten & Privatsphäre</p><h2>Deine Daten, getrennt vom gemeinsamen Haushalt</h2>
      <p>Der Haushalt enthält gemeinsam genutzte Planung, Rezepte, Vorrat und Einkauf. Dein privates Profil enthält nur von dir erfasste Körper- und Referenzangaben. Das Löschen des privaten Profils löscht keine gemeinsamen Daten.</p>
      <p className="help">JSON-Import zeigt vor jeder Speicherung eine serverseitig erzeugte Vorschau mit Konflikten. Konten, Rollen, Einladungen und Mitgliedschaften können nicht aus einem Export übernommen werden.</p>
    </section>
    <section className="stack" aria-labelledby="data-export-heading">
      <div><p className="eyebrow">Portabel und lesbar</p><h2 id="data-export-heading">JSON-Export</h2><p className="muted">Exporte werden erst nach deiner ausdrücklichen Auswahl erzeugt und in deinem Browser heruntergeladen.</p></div>
      {ownsProfile ? <ExportForm household={household} scope="profile" operationId={operationIds.profileExport} action={exportAction} /> : <p className="card card-flat">Für die aktive Person ist kein eigenes privates Profil vorhanden. Ein Export fremder Körperdaten wird nicht angeboten.</p>}
      <ExportForm household={household} scope="household" operationId={operationIds.householdExport} action={exportAction} />
    </section>
    {ownsProfile && profile && <section className="card stack" aria-labelledby="private-profile-delete-heading">
      <p className="eyebrow">Nur dein privates Profil</p><h2 id="private-profile-delete-heading">Private Profilangaben löschen</h2>
      <p>Entfernt dein privates Profil, Messwerte und eigene Ziel-/Berechnungsdaten. Gemeinsame Rezepte, Haushaltspersonen, Mahlzeiten, Vorräte und Einkaufslisten bleiben bestehen.</p>
      <DeleteOwnProfileForm household={household} profile={profile} operationId={operationIds.deleteProfile} action={deleteProfileAction} />
    </section>}
    {canImport ? <ImportWorkflow household={household} previewOperationId={operationIds.importPreview} previewAction={previewAction} applyAction={applyAction} /> : <p className="alert">Du hast Leserechte. Nur Haushaltsmitglieder mit Bearbeitungsrechten können eine Importvorschau erstellen oder Daten importieren.</p>}
  </div>;
}

function useMutation(operationId: string, action: DataAction, refreshOnSuccess = false) {
  const router = useRouter();
  const [currentOperationId, setCurrentOperationId] = useState(operationId);
  const mutationAction = useCallback(async (previousState: DataActionState, formData: FormData) => {
    const result = await action(previousState, formData);
    if (result.savedOperationId === formData.get('operationId')) {
      setCurrentOperationId(crypto.randomUUID());
      if (refreshOnSuccess) router.refresh();
    }
    return result;
  }, [action, refreshOnSuccess, router]);
  const [state, formAction] = useActionState(mutationAction, {});
  return { currentOperationId, state, formAction };
}

function ExportForm({ household, scope, operationId, action }: { household: Household; scope: 'profile' | 'household'; operationId: string; action: DataAction }) {
  const { currentOperationId, state, formAction } = useMutation(operationId, action);
  return <form className="card stack" action={formAction}>
    <input type="hidden" name="operationId" value={currentOperationId} /><input type="hidden" name="householdId" value={household.id} /><input type="hidden" name="scope" value={scope} />
    <div><h3>{scope === 'profile' ? 'Eigenes privates Profil exportieren' : 'Berechtigte Haushaltsdaten exportieren'}</h3><p>{scope === 'profile' ? 'Nur dein eigenes Profil, deine Messwerte und privaten Ziele.' : `Gemeinsame Daten aus „${household.name}“. Authentifizierungsidentitäten und Mitgliedschaftsrollen sind nicht enthalten.`}</p></div>
    <ActionStatus error={state.error} message={state.exportJson ? 'Der JSON-Export wurde erstellt. Er wurde nicht automatisch versandt.' : null} />
    <SubmitButton>{scope === 'profile' ? 'Eigenes Profil als JSON exportieren' : 'Haushaltsdaten als JSON exportieren'}</SubmitButton>
    {state.exportJson && <JsonDownload filename={state.exportFilename ?? `supper-board-${scope}.json`} json={state.exportJson} />}
  </form>;
}

function DeleteOwnProfileForm({ household, profile, operationId, action }: { household: Household; profile: PrivateProfileSnapshot; operationId: string; action: HouseholdAction }) {
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
  return <form className="stack" action={formAction}>
    <input type="hidden" name="operationId" value={currentOperationId} /><input type="hidden" name="householdId" value={household.id} /><input type="hidden" name="profileId" value={profile.profileId} /><input type="hidden" name="expectedProfileRevision" value={profile.revision} />
    <label className="field" htmlFor="confirm-profile-delete"><input id="confirm-profile-delete" type="checkbox" name="confirmDelete" value="true" required /> Ich bestätige, dass nur mein privates Profil mit seinen Mess- und Zielangaben gelöscht wird.</label>
    <p className="help">Nur du kannst dein Profil löschen. Haushaltsrollen allein gewähren keinen Zugriff auf diese Angaben.</p>
    <ActionStatus error={state.error} message={state.savedOperationId ? 'Dein privates Profil wurde gelöscht. Gemeinsame Haushaltsdaten bleiben erhalten.' : null} />
    <SubmitButton className="button button-danger">Nur mein privates Profil löschen</SubmitButton>
  </form>;
}

function ImportWorkflow({ household, previewOperationId, previewAction, applyAction }: { household: Household; previewOperationId: string; previewAction: DataAction; applyAction: DataAction }) {
  const [documentJson, setDocumentJson] = useState('');
  const [filename, setFilename] = useState('');
  const [readError, setReadError] = useState('');
  const [fileGeneration, setFileGeneration] = useState(0);
  const [format, setFormat] = useState<'household-json' | 'legacy-demo-seed'>('household-json');
  const [currentPreviewOperationId, setCurrentPreviewOperationId] = useState(previewOperationId);
  async function readFile(file: File | undefined) {
    if (!file) return;
    setFileGeneration((generation) => generation + 1);
    setCurrentPreviewOperationId(crypto.randomUUID());
    setReadError('');
    setFilename('');
    setDocumentJson('');
    if (file.size > 5_000_000) {
      setReadError('Die Datei ist größer als 5 MB. Wähle eine kleinere Datei.');
      return;
    }
    try {
      const text = await file.text();
      setFilename(file.name);
      setDocumentJson(text);
    } catch {
      setReadError('Die Datei konnte nicht gelesen werden. Deine gespeicherten Daten wurden nicht verändert.');
    }
  }
  function changeFormat(nextFormat: 'household-json' | 'legacy-demo-seed') {
    setFormat(nextFormat);
    setFileGeneration((generation) => generation + 1);
    setCurrentPreviewOperationId(crypto.randomUUID());
    setReadError('');
    setFilename('');
    setDocumentJson('');
  }
  return <section className="stack" aria-labelledby="data-import-heading">
    <div><p className="eyebrow">Kontrollierter Import</p><h2 id="data-import-heading">JSON prüfen, Konflikte ansehen, dann speichern</h2><p className="muted">Importierte Dokumente erzeugen zunächst nur eine Vorschau. Authentifizierungsidentitäten, Rollen und Mitgliedschaften werden nie importiert.</p></div>
    <label className="field" htmlFor="data-import-format">Importformat auswählen<select id="data-import-format" value={format} onChange={(event) => changeFormat(event.currentTarget.value as 'household-json' | 'legacy-demo-seed')}><option value="household-json">Portabler Supper-Board-JSON-Export</option><option value="legacy-demo-seed">Originaler Demo-Seed oder synthetischer Legacy-Seed</option></select></label>
    {format === 'legacy-demo-seed' && <p className="alert alert-warning">Nur ausdrücklich ausgewählte Dateien werden geprüft. Verwende `docs/seed.js` oder ein JSON-Beispiel mit dem Schema `supper-board-legacy-demo-seed-v1`. JavaScript wird nicht ausgeführt; Browser-localStorage-Änderungen werden nicht automatisch ausgelesen.</p>}
    <label className="field" htmlFor="data-import-file">{format === 'legacy-demo-seed' ? 'Legacy-Seeddatei auswählen' : 'JSON-Datei auswählen'}<input id="data-import-file" type="file" accept={format === 'legacy-demo-seed' ? '.js,.json,application/json,text/javascript,application/javascript' : 'application/json,.json'} onChange={(event) => { void readFile(event.currentTarget.files?.[0]); }} /></label>
    {filename && <p className="help">Ausgewählte Datei: {filename}. Fehlerhafte Eingaben bleiben erhalten, bis du eine andere Datei auswählst.</p>}
    {readError && <p className="form-error" role="alert">{readError}</p>}
    <ImportPreview key={fileGeneration} household={household} documentJson={documentJson} importFormat={format} operationId={currentPreviewOperationId} previewAction={previewAction} applyAction={applyAction} />
  </section>;
}

function ImportPreview({ household, documentJson, importFormat, operationId, previewAction, applyAction }: { household: Household; documentJson: string; importFormat: 'household-json' | 'legacy-demo-seed'; operationId: string; previewAction: DataAction; applyAction: DataAction }) {
  const preview = useMutation(operationId, previewAction);
  return <div className="stack">
    <form className="card stack" action={preview.formAction}>
      <input type="hidden" name="operationId" value={preview.currentOperationId} /><input type="hidden" name="householdId" value={household.id} /><input type="hidden" name="documentJson" value={documentJson} /><input type="hidden" name="importFormat" value={importFormat} />
      <ActionStatus error={preview.state.error} message={preview.state.previewId ? 'Servervorschau erstellt. Prüfe Konflikte und offene Zuordnungen vor dem Schreiben.' : null} />
      <SubmitButton disabled={!documentJson}>Importvorschau erstellen</SubmitButton>
    </form>
    {preview.state.report !== undefined && <section className="card stack" aria-labelledby="import-report-heading">
      <h3 id="import-report-heading">Serverseitiger Konflikt- und Prüfbericht</h3><p>Die Vorschau ist an dein Konto, diesen Haushalt, den Dateihash und eine kurze Ablaufzeit gebunden.</p><pre className="code-block">{JSON.stringify(preview.state.report, null, 2)}</pre>
      {preview.state.previewId && preview.state.previewToken && <ApplyImportForm key={preview.state.previewId} household={household} previewId={preview.state.previewId} previewToken={preview.state.previewToken} action={applyAction} />}
    </section>}
  </div>;
}


function ApplyImportForm({ household, previewId, previewToken, action }: { household: Household; previewId: string; previewToken: string; action: DataAction }) {
  const apply = useMutation(previewId, action, true);
  return <form className="stack" action={apply.formAction}>
    <input type="hidden" name="operationId" value={apply.currentOperationId} /><input type="hidden" name="householdId" value={household.id} /><input type="hidden" name="previewId" value={previewId} /><input type="hidden" name="previewToken" value={previewToken} /><input type="hidden" name="expectedHouseholdRevision" value={household.revision} />
    <p className="alert">Beim Import werden keine Konten oder Haushaltsmitgliedschaften angelegt. Ungeklärte Legacy-Mengen bleiben Prüfpunkte statt erfundener Werte.</p>
    <ActionStatus error={apply.state.error} message={apply.state.savedOperationId ? (apply.state.alreadyImported ? `Diese Quelle wurde bereits importiert; es wurden keine Datensätze dupliziert. ${apply.state.legacyIssueCount ?? 0} offene Zuordnungs-/Legacy-Prüfpunkte bleiben erhalten.` : `Import abgeschlossen. ${apply.state.legacyIssueCount ?? 0} offene Zuordnungs-/Legacy-Prüfpunkte.`) : null} />
    {apply.state.importedCounts !== undefined && <pre className="code-block">{JSON.stringify(apply.state.importedCounts, null, 2)}</pre>}
    <SubmitButton disabled={Boolean(apply.state.savedOperationId)}>Geprüften Import dauerhaft anwenden</SubmitButton>
  </form>;
}

function JsonDownload({ filename, json }: { filename: string; json: string }) {
  const [error, setError] = useState('');
  function download() {
    try {
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setError('');
    } catch {
      setError('Dateidownload nicht verfügbar. Nutze das unten stehende Textfeld für manuelles Kopieren.');
    }
  }
  return <div className="stack"><button className="button" type="button" onClick={download}>JSON-Datei herunterladen</button><label className="field" htmlFor={`export-${filename}`}>Exportinhalt zum manuellen Kopieren<textarea id={`export-${filename}`} readOnly value={json} rows={8} onFocus={(event) => event.currentTarget.select()} /></label>{error && <p className="form-error" role="alert">{error}</p>}</div>;
}
