import Link from 'next/link';
import Decimal from 'decimal.js';
import type { NutrientResult, NutrientWeekSummary, PersonDayResult, PersonWeekResult, TargetComparison } from '@/domain/types';
import { formatDecimal, formatLocalDate, nutrientLabel } from '@/app/workspace/format';

const HEADLINE_NUTRIENTS = ['energy_kcal', 'protein', 'available_carbohydrate', 'fat', 'dietary_fiber'];
const SOURCE_STATUS: Record<string, string> = {
  numeric: 'Zahlenwert', explicit_zero: 'Explizite Null', trace: 'Spur', below_limit: 'Unter Bestimmungsgrenze',
  missing: 'Wert fehlt', source_not_present: 'Nicht in der Quelle enthalten', unsupported_mapping: 'Nicht zugeordnet',
  quantity_unconfirmed: 'Menge unbestätigt', alternative_unselected: 'Alternative nicht gewählt',
};
const RELATIONS: Record<string, string> = { below: 'unter dem gewählten Ziel', at: 'am gewählten Ziel', within: 'im gewählten Bereich', above: 'über dem gewählten Ziel' };

function isEnergyValue(nutrient: NutrientResult | NutrientWeekSummary): boolean {
  return /energy|kcal|kilojoule/i.test(nutrient.nutrientId) || /^(kcal|kj)$/i.test(nutrient.unit);
}

function uncertainty(reasons: string[]): string {
  if (reasons.some((reason) => reason.includes('recipe_yield_unknown'))) return 'Bestätige die Basisportionen im Rezept und plane die neue Rezeptversion ein.';
  if (reasons.some((reason) => /quantity|basis|ingredient_unmapped|alternative/.test(reason))) return 'Prüfe Zutaten, gewählte Alternativen, Mengen und Bezugsbasis im Rezept.';
  if (reasons.some((reason) => /flexible_meal|meal_source|recipe_version/.test(reason))) return 'Ersetze den offenen Termin durch ein verfügbares Rezept oder Lebensmittel mit bestätigter Menge.';
  return 'Mindestens ein Quellwert fehlt oder ist nicht zugeordnet. Prüfe die Quelldetails; fehlende Werte werden nicht als null ergänzt.';
}

function targetText(comparison: TargetComparison): string {
  const target = comparison.target;
  if (target.type === 'range') return `Gewählter Zielbereich: ${formatDecimal(target.minimum)}–${formatDecimal(target.maximum)} ${target.unit}`;
  const prefix = target.type === 'minimum' ? 'Eigenes Minimum' : target.type === 'maximum' ? 'Eigenes Maximum' : 'Gewähltes Tagesziel';
  return `${prefix}: ${formatDecimal(target.amount)} ${target.unit}`;
}

function PlannedAmount({ value }: { value: NutrientResult }) {
  return <article className="list-row stack">
    <h4>{nutrientLabel(value.nutrientId)}</h4>
    <p>{value.status === 'complete' ? 'Vollständig berechenbar' : 'Datenlücke'} · Bekannte {value.status === 'complete' ? 'Summe' : 'Teilsumme'}: {formatDecimal(value.knownAmount)} {value.unit}</p>
    {value.status !== 'complete' && <p className="help">{uncertainty(value.missingReasons)}</p>}
    <p className="help">Exakter bekannter Wert: {value.knownAmount ?? 'unbekannt'} {value.unit} · Berechnung: {value.calculationVersion}</p>
    {value.missingReasons.length > 0 && <ul>{value.missingReasons.map((reason) => <li key={reason}><code>{reason}</code></li>)}</ul>}
    <p className="help">Quellversionen: {value.sourceVersionIds.join(', ') || 'keine'}</p>
    {value.contributions.length > 0 && <ul className="list-reset">{value.contributions.map((source, index) => <li className="list-row" key={`${source.ingredientId}-${index}`}>
      <p>Zutat {source.ingredientId} · {SOURCE_STATUS[source.status] ?? source.status} · {formatDecimal(source.amount)} {source.unit}</p>
      <p className="help">Lebensmittelversion: {source.foodVersionId ?? 'nicht zugeordnet'}{source.rawMarker != null ? ` · Originalmarker: ${source.rawMarker}` : ''}{source.sourceMethod ? ` · Methode: ${source.sourceMethod}` : ''}{source.sourceReference ? ` · Referenz: ${source.sourceReference}` : ''}{source.mappingVersion ? ` · Zuordnung: ${source.mappingVersion}` : ''}</p>
    </li>)}</ul>}
  </article>;
}

function DayTargetRow({ comparison, nutrient }: { comparison: TargetComparison; nutrient?: NutrientResult }) {
  return <div className="list-row">
    <div className="split"><strong>{nutrientLabel(comparison.nutrientId)}</strong><span>{formatDecimal(comparison.plannedAmount)} {comparison.plannedUnit}</span></div>
    <p className="help">{targetText(comparison)} · {comparison.available ? RELATIONS[comparison.relation ?? ''] ?? 'vergleichbar' : comparison.reason === 'plan_incomplete' ? 'Vergleich offen: Planung und Zuteilungen prüfen.' : 'Vergleich offen: Quellwerte oder Einheiten unvollständig.'}</p>
    {!comparison.available && nutrient?.status !== 'complete' && <p className="help">{uncertainty(nutrient?.missingReasons ?? [])}</p>}
    {comparison.target.unit === 'energy_percent' && <p className="help">Dieses Referenzziel bleibt in E%; ohne ausdrücklich gewählte Planungsenergie ist kein Grammvergleich verfügbar.</p>}
    {comparison.available && comparison.fractionOfPoint != null && <p>{formatDecimal(new Decimal(comparison.fractionOfPoint).times(100).toFixed(2), 0)} % des gewählten Tagesziels</p>}
    {comparison.target.isImportedUnverified && <p className="help">Unverifizierte Importangabe oder daraus abgeleitetes Ziel; keine geprüfte Bedarfsempfehlung.</p>}
  </div>;
}

function weeklyPointComparison(week: PersonWeekResult, nutrientId: string): { percent: string; includedDays: number; isImportedUnverified: boolean } | null {
  let total = new Decimal(0);
  let includedDays = 0;
  let isImportedUnverified = false;
  for (const day of week.days) {
    if (!day.planComplete || day.entries.length === 0) continue;
    const comparison = day.targetComparisons.find((item) => item.nutrientId === nutrientId && item.available && item.target.type === 'point' && item.fractionOfPoint != null);
    if (!comparison || comparison.fractionOfPoint == null) continue;
    total = total.plus(comparison.fractionOfPoint);
    includedDays += 1;
    isImportedUnverified ||= comparison.target.isImportedUnverified === true;
  }
  if (!includedDays) return null;
  return { percent: `${formatDecimal(total.dividedBy(includedDays).mul(100).toFixed(2), 0)} %`, includedDays, isImportedUnverified };
}

function WeekNutrition({ week, nutrientIds }: { week: PersonWeekResult; nutrientIds: string[] }) {
  return <section className="card card-flat stack"><h3>Wochendurchschnitt je einbezogenem Tag</h3>
    <p className="help">Nur abgeschlossene Planung und vollständige Beiträge für den jeweiligen Nährstoff zählen. Andere Quellkomponenten sperren diesen Durchschnitt nicht.</p>
    <ul className="list-reset">{nutrientIds.map((id) => {
      const summary = week.nutrientSummaries.find((row) => row.nutrientId === id);
      const comparison = weeklyPointComparison(week, id);
      return <li className="list-row" key={id}>
        <div className="split"><strong>{nutrientLabel(id)}</strong><span>{formatDecimal(summary?.averagePerIncludedDay, id === 'energy_kcal' ? 0 : 2)} {summary?.unit ?? (id === 'energy_kcal' ? 'kcal' : '')}</span></div>
        <p className="help">{summary?.includedDayCount ?? 0} Tage einbezogen, {summary?.excludedDayCount ?? 7} ausgeschlossen.</p>
        {comparison && <p className="help">Durchschnittlich {comparison.percent} des jeweiligen gewählten Tagesziels an {comparison.includedDays} einbezogenen Tagen.</p>}
        {comparison?.isImportedUnverified && <p className="help">Mindestens ein Ziel stammt aus einem unverifizierten Import oder wurde daraus abgeleitet; keine geprüfte Bedarfsempfehlung.</p>}
      </li>;
    })}</ul>
  </section>;
}

/** Fixed headline nutrients; full per-source diagnostics remain keyboard accessible. */
export function DayNutritionCard({ day, week, hideEnergy = false }: { day: PersonDayResult; week?: PersonWeekResult; hideEnergy?: boolean }) {
  const visibleTotals = day.totals.filter((row) => !hideEnergy || !isEnergyValue(row));
  const comparisons = day.targetComparisons.filter((row) => !hideEnergy || !/energy|kcal|kilojoule/i.test(row.nutrientId));
  const headlineIds = HEADLINE_NUTRIENTS.filter((id) => !hideEnergy || id !== 'energy_kcal');
  const headlineRows = headlineIds.map((id) => visibleTotals.find((row) => row.nutrientId === id));
  return <div className="stack">
    <p className="help">{day.entries.length === 0 ? 'Für diese Person gibt es keine zugeteilten Mahlzeiten. Das ist keine Nullaufnahme.' : day.planComplete ? 'Haushaltsplan abgeschlossen. Das bestätigt die erfassten Termine, nicht die persönliche Nährstoffabdeckung.' : 'Haushaltsplan noch offen. Prüfe die Mahlzeiten und schließe die Planung ab, bevor du Tagesziele vergleichst.'}</p>
    {day.missingReasons.length > 0 && <p className="alert alert-warning">{uncertainty(day.missingReasons)} Bekannte Teilsummen bleiben sichtbar.</p>}
    <div className="metric-grid">{headlineIds.map((id, index) => {
      const nutrient = headlineRows[index];
      return <div className="metric" key={id}>
        <span className="metric-label">{nutrientLabel(id)}</span>
        <span className="metric-value">{formatDecimal(nutrient?.knownAmount, id === 'energy_kcal' ? 0 : 2)} <small>{nutrient?.unit ?? (id === 'energy_kcal' ? 'kcal' : 'g')}</small></span>
        <span className="help">{nutrient?.status === 'complete' ? 'Alle Beiträge berechenbar' : nutrient?.knownAmount != null ? 'Bekannte Teilsumme' : 'Quellwert offen'}</span>
      </div>;
    })}</div>
    {day.entries.length > 0 && headlineRows.some((row) => !row || row.status !== 'complete') && <p className="help">Datenlücken betreffen nur den jeweiligen Nährstoff. <Link href={`/plan?start=${day.date}&personId=${encodeURIComponent(day.personId)}`}>Mahlzeiten und Zuteilungen prüfen</Link>; Originalwerte stehen in den Quelldetails unten.</p>}
    {comparisons.length > 0 && <section className="stack"><h3>Vergleich mit deinen gewählten Zielen</h3>{comparisons.map((comparison) => <DayTargetRow key={comparison.nutrientId} comparison={comparison} nutrient={visibleTotals.find((row) => row.nutrientId === comparison.nutrientId)} />)}</section>}
    {week && <><p className="help">Woche {formatLocalDate(week.startDate)}–{formatLocalDate(week.endDate)}: {week.scheduleCompleteDayCount} abgeschlossene Haushaltsplantage mit persönlichen Zuteilungen · {week.plannedDayCount} Tage mit Zuteilung. Nährstoffabdeckung ist davon unabhängig. Leere Tage werden nicht als null gemittelt.</p><WeekNutrition week={week} nutrientIds={headlineIds} /></>}
    <details><summary>Alle Nährwerte, Datenlücken und Originalquellen ({visibleTotals.length})</summary>
      <div className="stack">{visibleTotals.map((nutrient) => <PlannedAmount key={nutrient.nutrientId} value={nutrient} />)}
        {!visibleTotals.length && <p className="help">Keine berechenbaren Quellwerte für diese Person. Prüfe persönliche Zuteilungen und die Rezeptbasis.</p>}
        {week && <><WeekNutrition week={week} nutrientIds={week.nutrientSummaries.filter((row) => !hideEnergy || !isEnergyValue(row)).map((row) => row.nutrientId)} /><ul className="list-reset">{week.nutrientSummaries.filter((row) => !hideEnergy || !isEnergyValue(row)).map((row) => <li className="list-row" key={row.nutrientId}>{nutrientLabel(row.nutrientId)} · bekannte Wochensumme (einschließlich Teilsummen): {formatDecimal(row.knownTotal)} {row.unit}</li>)}</ul></>}
      </div>
    </details>
  </div>;
}
