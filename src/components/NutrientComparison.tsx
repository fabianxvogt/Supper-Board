import Decimal from 'decimal.js';
import type { NutrientResult, NutrientWeekSummary, PersonDayResult, PersonWeekResult, TargetComparison } from '@/domain/types';
import { formatDecimal, formatLocalDate, nutrientLabel } from '@/app/workspace/format';

function isEnergyValue(nutrient: NutrientResult | NutrientWeekSummary): boolean {
  return /energy|kcal|kilojoule/i.test(nutrient.nutrientId) || /^(kcal|kj)$/i.test(nutrient.unit);
}

function percentage(fraction: string | null | undefined): string | null {
  if (!fraction) return null;
  const value = Number(fraction) * 100;
  return Number.isFinite(value) ? `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }).format(value)} %` : null;
}

function targetText(comparison: TargetComparison | undefined): string {
  if (!comparison) return 'Kein Ziel gewählt';
  if (!comparison.available) {
    if (comparison.target.unit === 'energy_percent') return 'Dieses Referenzziel bleibt in E%; ohne ausdrücklich gewählte Planungsenergie ist kein Grammvergleich verfügbar.';
    return comparison.reason ? `Vergleich offen: ${comparison.reason}` : 'Vergleich offen';
  }
  const target = comparison.target;
  if (target.type === 'point' && target.amount) return `gewähltes Tagesziel: ${formatDecimal(target.amount)} ${target.unit}`;
  if (target.type === 'range' && target.minimum && target.maximum) return `gewählter Zielbereich: ${formatDecimal(target.minimum)}–${formatDecimal(target.maximum)} ${target.unit}`;
  if (target.type === 'minimum' && target.amount) return `eigenes Minimum: ${formatDecimal(target.amount)} ${target.unit}`;
  if (target.type === 'maximum' && target.amount) return `eigenes Maximum: ${formatDecimal(target.amount)} ${target.unit}`;
  return 'Zielwert unvollständig';
}

function PlannedAmount({ value }: { value: NutrientResult }) {
  const message = value.knownAmount == null ? 'Bekannte Summe nicht berechenbar' : `Bekannte Summe: ${formatDecimal(value.knownAmount)} ${value.unit}`;
  return (
    <div className="list-row">
      <div className="split"><strong>{nutrientLabel(value.nutrientId)}</strong><span className={`status ${value.status === 'complete' ? 'status-success' : 'status-warning'}`}>{value.status === 'complete' ? 'vollständig' : 'Daten unvollständig'}</span></div>
      <p style={{ margin: '.35rem 0' }}>{message}</p>
      {value.status !== 'complete' && value.missingReasons.length > 0 && <p className="help">Fehlt: {value.missingReasons.join('; ')}</p>}
    </div>
  );
}

function DayTargetRow({ comparison, nutrient }: { comparison: TargetComparison; nutrient?: NutrientResult }) {
  const amount = nutrient?.knownAmount == null ? 'unbekannt' : `${formatDecimal(nutrient.knownAmount)} ${nutrient.unit}`;
  const percent = nutrient?.status === 'complete' ? percentage(comparison.fractionOfPoint) : null;
  const width = percent ? Math.min(100, Math.max(0, Number(comparison.fractionOfPoint) * 100)) : 0;
  return (
    <div className="list-row">
      <div className="split"><strong>{nutrientLabel(comparison.nutrientId)}</strong><span>{amount}</span></div>
      <p className="help">{targetText(comparison)}</p>
      {comparison.target.isImportedUnverified && <p className="alert alert-warning">Unverifizierte Importangabe oder daraus abgeleitetes Ziel. Dieser Vergleich nutzt deinen gewählten Planungswert, keine geprüfte Bedarfsempfehlung.</p>}
      {percent && <><div className="progress" role="progressbar" aria-label={`${nutrientLabel(comparison.nutrientId)} im Verhältnis zum gewählten Tagesziel`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.max(0, Math.round(width)))}><span style={{ width: `${width}%` }} /></div><p className="help">{percent} des gewählten Tagesziels</p></>}
      {nutrient && nutrient.status !== 'complete' && <p className="help">Daten unvollständig: {nutrient.missingReasons.join('; ') || 'Mindestens ein Wert fehlt.'} Es wird keine vollständige Zielerfüllung angezeigt.</p>}
    </div>
  );
}
function weeklyPointComparison(week: PersonWeekResult, nutrientId: string): { percent: string; includedDays: number; isImportedUnverified: boolean } | null {
  let total = new Decimal(0);
  let includedDays = 0;
  let isImportedUnverified = false;
  for (const day of week.days) {
    if (day.status !== 'complete' || !day.planComplete) continue;
    const comparison = day.targetComparisons.find((item) => item.nutrientId === nutrientId && item.available && item.target.type === 'point' && item.fractionOfPoint != null);
    if (!comparison || comparison.fractionOfPoint == null) continue;
    total = total.plus(comparison.fractionOfPoint);
    includedDays += 1;
    isImportedUnverified ||= comparison.target.isImportedUnverified === true;
  }
  if (!includedDays) return null;
  const mean = total.dividedBy(includedDays).mul(100);
  return { percent: `${formatDecimal(mean.toFixed(2), 0)} %`, includedDays, isImportedUnverified };
}

function WeekNutrition({ week, hideEnergy }: { week: PersonWeekResult; hideEnergy: boolean }) {
  const summaries = week.nutrientSummaries.filter((summary) => !hideEnergy || !isEnergyValue(summary));
  return (
    <div className="card card-flat stack">
      <h3>Wochendurchschnitt je einbezogenem Tag</h3>
      <p className="help">Nur Tage mit verwertbaren geplanten Werten zählen. Dies ist eine Planungsansicht, keine Verzehr- oder Diagnoseaussage.</p>
      <ul className="list-reset">
        {summaries.map((summary) => {
          const comparison = weeklyPointComparison(week, summary.nutrientId);
          return <li className="list-row" key={summary.nutrientId}>
            <div className="split"><strong>{nutrientLabel(summary.nutrientId)}</strong><span>{summary.averagePerIncludedDay == null ? 'unbekannt' : `${formatDecimal(summary.averagePerIncludedDay)} ${summary.unit}`}</span></div>
            <p className="help">{summary.status === 'complete' ? 'Vollständige Werte' : `Daten ${summary.status}; ${summary.includedDayCount} Tage einbezogen, ${summary.excludedDayCount} ausgeschlossen`}</p>
            {comparison && <p className="help">Durchschnittlich {comparison.percent} des jeweiligen gewählten Tagesziels an {comparison.includedDays} vollständigen Plantagen.</p>}
            {comparison?.isImportedUnverified && <p className="alert alert-warning">Mindestens ein einbezogenes Ziel stammt aus einem unverifizierten Import oder wurde daraus abgeleitet. Der Durchschnitt ist keine geprüfte Bedarfsempfehlung.</p>}
          </li>;
        })}
        {!summaries.length && <li className="help">Für diesen Zeitraum gibt es noch keine Nährwerte.</li>}
      </ul>
    </div>
  );
}

export function DayNutritionCard({ day, week, hideEnergy = false }: { day: PersonDayResult; week?: PersonWeekResult; hideEnergy?: boolean }) {
  const visibleTotals = day.totals.filter((nutrient) => !hideEnergy || !isEnergyValue(nutrient));
  const totalMap: Record<string, NutrientResult> = Object.create(null);
  for (const nutrient of visibleTotals) totalMap[nutrient.nutrientId] = nutrient;
  const comparisons = day.targetComparisons.filter((item) => !hideEnergy || !/energy|kcal|kilojoule/i.test(item.nutrientId));
  const isEmpty = day.status === 'empty';
  return (
    <section className="card stack" aria-labelledby="day-nutrition-heading">
      <div className="split"><div><p className="eyebrow">Persönliche Planung</p><h2 id="day-nutrition-heading">{formatLocalDate(day.date)} · bekannte Werte</h2></div><span className={`status ${day.planComplete ? 'status-success' : 'status-warning'}`}>{day.planComplete ? 'Tagesplan als vollständig markiert' : 'Tagesplan unvollständig'}</span></div>
      {isEmpty && <p className="alert alert-info">Für diesen Tag ist nichts geplant. Das bedeutet nicht, dass du nichts gegessen hast; der Tag wird nicht als Nullaufnahme bewertet.</p>}
      {!isEmpty && day.missingReasons.length > 0 && <div className="alert alert-warning"><strong>Der Tagesvergleich ist unvollständig.</strong><ul>{day.missingReasons.map((reason) => <li key={reason}>{reason === 'recipe_yield_unknown' ? 'Die Basisportionen eines geplanten Rezepts sind unbekannt. Sein persönlicher Nährwertanteil kann deshalb nicht berechnet werden.' : reason}</li>)}</ul><p>Bekannte Teilsummen bleiben sichtbar; fehlende Mahlzeitenanteile werden nicht als null angenommen.</p></div>}
      {visibleTotals.length > 0 && <div className="metric-grid">{visibleTotals.filter((nutrient) => nutrient.status === 'complete').slice(0, 4).map((nutrient) => <div className="metric" key={nutrient.nutrientId}><span className="metric-label">{nutrientLabel(nutrient.nutrientId)}</span><span className="metric-value">{formatDecimal(nutrient.knownAmount)} <small>{nutrient.unit}</small></span></div>)}</div>}
      {visibleTotals.some((nutrient) => nutrient.status !== 'complete') && <div className="alert alert-warning"><strong>Bekannte Teilsummen – Daten unvollständig</strong><ul>{visibleTotals.filter((nutrient) => nutrient.status !== 'complete').map((nutrient) => <li key={nutrient.nutrientId}>{nutrientLabel(nutrient.nutrientId)}: {nutrient.knownAmount == null ? 'Wert unbekannt' : `${formatDecimal(nutrient.knownAmount)} ${nutrient.unit}`} · {nutrient.missingReasons.join('; ') || 'mindestens ein Quellwert fehlt'}</li>)}</ul></div>}
      {comparisons.length > 0 && <div className="stack"><h3>Vergleich mit deinen gewählten Zielen</h3>{comparisons.map((comparison) => <DayTargetRow key={comparison.nutrientId} comparison={comparison} nutrient={totalMap[comparison.nutrientId]} />)}</div>}
      <details>
        <summary className="button button-quiet">Alle vorhandenen Nährwerte und Datenlücken</summary>
        <div className="stack">{visibleTotals.length ? visibleTotals.map((nutrient) => <PlannedAmount key={nutrient.nutrientId} value={nutrient} />) : <p className="help">Für diese Person liegen noch keine auswertbaren Mahlzeitenwerte vor.</p>}</div>
      </details>
      {week && <><div className="alert alert-info"><strong>Woche {formatLocalDate(week.startDate)}–{formatLocalDate(week.endDate)}:</strong> {week.completeDayCount} vollständige Tage, {week.plannedDayCount} Tage mit Plan, {week.excludedDayCount} Tage ohne verwertbare Werte. Leere Tage werden nicht als Null gemittelt.</div><WeekNutrition week={week} hideEnergy={hideEnergy} /></>}
      {!day.planComplete && <p className="help">„Tagesplan vollständig“ bestätigt nur, dass du alle geplanten Slots erfasst hast. Es ist keine Verzehrsbestätigung.</p>}
    </section>
  );
}
