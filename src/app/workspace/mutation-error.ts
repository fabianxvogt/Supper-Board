import 'server-only';
import { unstable_rethrow } from 'next/navigation';

export function mutationErrorMessage(error: unknown, fallback: string): string {
  unstable_rethrow(error);
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
  if (code === 'AUTH_REQUIRED') return 'Deine Anmeldung ist abgelaufen. Melde dich erneut an; der Entwurf bleibt erhalten.';
  if (code === 'FORBIDDEN') return 'Dein Haushaltszugriff erlaubt diese Änderung nicht.';
  if (code === 'REVISION_CONFLICT') return 'Seit dem Laden wurde geändert. Nichts wurde überschrieben; lade den aktuellen Stand und prüfe deine Eingabe.';
  if (code === 'IDEMPOTENCY_CONFLICT') return 'Dieser Speicherversuch gehört bereits zu einer anderen Eingabe. Lade den aktuellen Stand, bevor du erneut speicherst.';
  if (code === 'NOT_FOUND') return 'Der ausgewählte Eintrag ist nicht mehr verfügbar. Aktualisiere die Seite und prüfe deine Auswahl.';
  if (code === 'ALLOCATION_LIMIT') return 'Die Zuteilung überschreitet die noch verfügbare Kochmenge. Erhöhe die Kochmenge oder passe die Portionen an.';
  if (code === 'INSUFFICIENT_STOCK') return 'Die bestätigte Vorratsmenge reicht für diese Entnahme nicht aus. Der Bestand wurde nicht negativ verändert.';
  if (code === 'DUPLICATE_RECEIPT') return 'Diese Empfangsmenge wurde bereits übernommen. Für eine weitere Lieferung ändere zuerst die erwartete Menge.';
  if (code === 'VALIDATION') return 'Ein Eingabewert ist ungültig. Prüfe die markierten Felder und versuche es erneut.';
  if (code === 'INTEGRITY') return 'Diese Änderung würde einen ungültigen Haushalts- oder Planbezug erzeugen und wurde nicht gespeichert.';
  return fallback;
}
