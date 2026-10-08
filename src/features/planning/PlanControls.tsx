import type { LocalDate } from '@/domain/types';
import { addLocalDays } from '@/domain/dates';
import type { SchedulePersonChoice } from '@/features/planning/ScheduleBatchForm';
import { formatLocalDate } from '@/app/workspace/format';

export function PlanControls({ startDate, horizonDays, personId, persons }: { startDate: LocalDate; horizonDays: 7 | 14; personId: string; persons: SchedulePersonChoice[] }) {
  const previousStart = addLocalDays(startDate, -horizonDays);
  const nextStart = addLocalDays(startDate, horizonDays);
  return (
    <details className="card card-flat stack">
      <summary>Zeitraum und Person ändern</summary>
      <div className="split">
        <a className="button button-small" href={`/plan?start=${previousStart}&horizon=${horizonDays}&personId=${encodeURIComponent(personId)}`} aria-label={`Vorheriger Zeitraum ab ${formatLocalDate(previousStart)}`}>← Zurück</a>
        <a className="button button-small" href={`/plan?start=${nextStart}&horizon=${horizonDays}&personId=${encodeURIComponent(personId)}`} aria-label={`Nächster Zeitraum ab ${formatLocalDate(nextStart)}`}>Weiter →</a>
      </div>
      <form className="form-grid" method="get" action="/plan">
        <label className="field" htmlFor="plan-start">Zeitraum beginnt<input id="plan-start" name="start" type="date" defaultValue={startDate} /></label>
        <label className="field" htmlFor="plan-horizon">Planlänge<select id="plan-horizon" name="horizon" defaultValue={horizonDays}><option value="7">7 Tage</option><option value="14">14 Tage</option></select></label>
        <label className="field" htmlFor="plan-person">Person<select id="plan-person" name="personId" defaultValue={personId}><option value="">Alle Personen</option>{persons.map((person) => <option key={person.id} value={person.id}>{person.displayName}</option>)}</select></label>
        <div className="form-actions"><button className="button" type="submit">Ansicht aktualisieren</button></div>
      </form>
    </details>
  );
}
