import Link from 'next/link';
import { z } from 'zod';
import { addLocalDays } from '@/domain/dates';
import { DayNutritionCard } from '@/components/NutrientComparison';
import { KitchenModeControls } from '@/components/KitchenModeControls';
import { getWorkspaceContext } from '@/app/workspace/context';
import { localToday, formatDecimal, formatLocalDate, nutrientBasisLabel } from '@/app/workspace/format';
import { projectPersonDay, projectPersonWeek } from '@/app/workspace/nutrition';
import { CompletionControl } from '@/features/planning/CompletionControls';
import { PlanDayCompletenessControl } from '@/features/planning/PlanDayCompletenessControl';
import { AddPrepReminder, PrepReminderStatus } from '@/features/planning/PrepReminderForms';
import { MealFeedbackForm } from '@/features/planning/MealFeedbackForm';
import { setPlanDayCompletenessAction, markBatchCookedAction, markDirectFoodProvidedAction, savePrepReminderAction, saveMealFeedbackAction } from '@/app/actions/planning';

const dateSchema = z.iso.date();
const slotLabels: Record<string, string> = { breakfast: 'Frühstück', lunch: 'Mittagessen', dinner: 'Abendessen', snack: 'Snack' };

function entryLabel(entry: { kind: string; label: string | null; food: { nameDe: string } | null }, recipeTitle?: string) {
  if (entry.kind === 'recipe_batch') return recipeTitle ?? entry.label ?? 'Rezeptversion nicht verfügbar';
  if (entry.kind === 'direct_food') return entry.food?.nameDe ?? entry.label ?? 'Lebensmittelversion nicht verfügbar';
  return entry.label ?? 'Flexible Mahlzeit';
}

export default async function TodayPage({ searchParams }: { searchParams: Promise<{ date?: string; personId?: string; hideEnergy?: string }> }) {
  const [params, context] = await Promise.all([searchParams, getWorkspaceContext()]);
  const today = localToday(context.household.timeZone);
  const parsedDate = params.date ? dateSchema.safeParse(params.date) : null;
  const date = parsedDate?.success ? parsedDate.data : today;
  const selectedPerson = context.persons.find((person) => person.id === params.personId) ?? context.activePerson ?? context.persons[0] ?? null;
  const end = addLocalDays(date, 6);
  const [snapshot, targetVersions] = await Promise.all([
    context.repository.getPlanSnapshot({ householdId: context.household.id, from: date, to: end }),
    (async () => {
      if (!selectedPerson) return [];
      if (selectedPerson.linkedUserId === context.user.id || selectedPerson.linkedUserId === null) {
        const profile = await context.repository.getPrivateProfile(selectedPerson.id, date);
        if (profile?.ownerUserId === context.user.id) {
          const targets = await context.repository.getProfileTargets(profile.profileId, date);
          return targets.versions;
        }
        if (selectedPerson.linkedUserId === context.user.id) return [];
      }
      const shared = await context.repository.getSharedPersonTargets({ householdId: context.household.id, personId: selectedPerson.id, asOfDate: date });
      return shared ? [shared] : [];
    })(),
  ]);
  const day = selectedPerson ? projectPersonDay({ snapshot, personId: selectedPerson.id, date, targetVersions }) : null;
  const week = selectedPerson ? projectPersonWeek({ snapshot, personId: selectedPerson.id, startDate: date, targetVersions }) : null;
  const batchesById: Record<string, (typeof snapshot.batches)[number]> = {};
  for (const batch of snapshot.batches) batchesById[batch.id] = batch;
  const planById = Object.fromEntries(snapshot.plans.map((plan) => [plan.id, plan]));
  const entriesToday = snapshot.entries.filter((entry) => entry.date === date).sort((a, b) => (['breakfast', 'lunch', 'dinner', 'snack'].indexOf(a.slot) - ['breakfast', 'lunch', 'dinner', 'snack'].indexOf(b.slot)) || a.id.localeCompare(b.id));
  const upcoming = snapshot.entries.filter((entry) => entry.date > date).sort((a, b) => a.date.localeCompare(b.date) || a.slot.localeCompare(b.slot));
  const reminders = [...snapshot.reminders].sort((a, b) => a.date.localeCompare(b.date));
  const selectedPersonName = selectedPerson?.displayName ?? 'Person auswählen';
  const personQuery = selectedPerson ? `&personId=${encodeURIComponent(selectedPerson.id)}` : '';
  const backDate = addLocalDays(date, -1);
  const nextDate = addLocalDays(date, 1);

  return (
    <main className="page-wrap">
      <div className="page-heading"><div><p className="eyebrow">{context.household.name} · Heute</p><h1>{formatLocalDate(date)}</h1><p>Alle Mahlzeiten des lokalen Kalendertags für {selectedPersonName}; Haushalt und persönliche Zuteilung bleiben getrennt.</p></div><div className="stack"><div className="button-row"><Link className="button button-quiet" href={`/today?date=${backDate}${personQuery}`}>← Vorheriger Tag</Link><Link className="button button-quiet" href={`/today?date=${today}${personQuery}`}>Heute</Link><Link className="button button-quiet" href={`/today?date=${nextDate}${personQuery}`}>Nächster Tag →</Link></div><KitchenModeControls /></div></div>
      <div className="card card-flat"><form className="form-grid" method="get" action="/today">
        <label className="field" htmlFor="today-date">Kalendertag<input id="today-date" name="date" type="date" defaultValue={date} /></label>
        <label className="field" htmlFor="today-person">Persönliche Ansicht<select id="today-person" name="personId" defaultValue={selectedPerson?.id ?? ''}><option value="">Person auswählen</option>{context.persons.map((person) => <option key={person.id} value={person.id}>{person.displayName}</option>)}</select></label>
        <label className="inline" htmlFor="today-hide-energy"><input id="today-hide-energy" type="checkbox" name="hideEnergy" value="true" defaultChecked={params.hideEnergy === 'true'} />Energie ausblenden</label>
        <div className="form-actions"><button className="button" type="submit">Ansicht aktualisieren</button></div>
      </form></div>
      <div className="stack section">
        <section className="card stack" aria-labelledby="today-meals-heading"><p className="eyebrow">Mehrere Slots · persönliche Portion</p><h2 id="today-meals-heading">Mahlzeiten am Tag</h2>
          {entriesToday.length ? <div className="stack">{entriesToday.map((entry) => {
            const batch = entry.batchId ? batchesById[entry.batchId] : null;
            const entryPlan = planById[entry.planId];
            const label = entryLabel(entry, batch?.recipe?.title);
            const allocation = snapshot.allocations.find((item) => item.entryId === entry.id && item.personId === selectedPerson?.id);
            const entryFeedback = snapshot.feedback.find((item) => item.entryId === entry.id && item.personId === selectedPerson?.id);
            return <article className="card card-flat stack" key={entry.id}>
              <div className="split"><div><p className="eyebrow">{slotLabels[entry.slot] ?? entry.slot}</p><h3>{entry.kind === 'recipe_batch' && batch?.recipe ? <Link href={`/recipes/${batch.recipe.recipeId}?versionId=${batch.recipe.id}`}>{label}</Link> : label}</h3></div><span className={`status ${entry.kind === 'flex' ? 'status-warning' : ''}`}>{entry.kind === 'recipe_batch' ? 'Kochcharge' : entry.kind === 'direct_food' ? 'Lebensmittel' : 'Flexibel'}</span></div>
              {allocation ? <p>Deine Zuteilung: <strong>{formatDecimal(allocation.portions)} {entry.kind === 'direct_food' ? 'Anteile der Gesamtmenge' : 'Portionen'}</strong></p> : <p className="help">Für {selectedPersonName} ist keine Zuteilung eingetragen.</p>}
              {entry.kind === 'direct_food' && <p className="help">Geplante Gesamtmenge: {entry.quantityG ? `${formatDecimal(entry.quantityG)} g` : 'unbekannt'} · Aufteilung nach den relativen Personenzuteilungen · Bezugsbasis: {nutrientBasisLabel(entry.food?.nutrientBasis)}</p>}
              {batch && entryPlan && snapshot.entries.find((candidate) => candidate.batchId === batch.id && candidate.date === date)?.id === entry.id && <CompletionControl householdId={context.household.id} targetId={batch.id} targetKind="batch" planId={batch.planId} planRevision={planById[batch.planId].revision} targetRevision={batch.revision} completed={batch.completed} operationId={crypto.randomUUID()} action={markBatchCookedAction} />}
              {entry.kind === 'recipe_batch' && batch?.recipe && <p className="help">Zutaten und Schritte der historischen Rezeptversion findest du in <Link href={`/recipes/${batch.recipe.recipeId}?versionId=${batch.recipe.id}`}>Rezept öffnen</Link>.</p>}
              {entry.kind === 'direct_food' && entryPlan && <CompletionControl householdId={context.household.id} targetId={entry.id} targetKind="direct_food" planId={entryPlan.id} planRevision={entryPlan.revision} targetRevision={entry.revision} completed={entry.provided} operationId={crypto.randomUUID()} action={markDirectFoodProvidedAction} />}
              {entry.kind === 'recipe_batch' && batch && <div><h4>Erinnerungen vor dieser Mahlzeit</h4><ul className="list-reset">{reminders.filter((reminder) => reminder.entryId === entry.id || reminder.batchId === batch.id).map((reminder) => <PrepReminderStatus key={reminder.id} householdId={context.household.id} reminder={reminder} operationId={crypto.randomUUID()} action={savePrepReminderAction} />)}</ul><AddPrepReminder householdId={context.household.id} entryId={entry.id} defaultDate={entry.date} operationId={crypto.randomUUID()} action={savePrepReminderAction} /></div>}
              {batch?.recipe && <details><summary>Bewertung und Wunsch</summary><MealFeedbackForm householdId={context.household.id} recipeId={batch.recipe.recipeId} recipeVersionId={batch.recipe.id} entryId={entry.id} personId={selectedPerson?.id} feedbackId={entryFeedback?.id} feedbackRevision={entryFeedback?.revision} rating={entryFeedback?.rating} note={entryFeedback?.note} wish={entryFeedback?.wish} operationId={crypto.randomUUID()} action={saveMealFeedbackAction} /></details>}
            </article>;
          })}</div> : <div className="empty-state"><p>Für heute ist noch nichts geplant. Ein leerer Tag steht nicht für Fasten oder eine Aufnahme von null.</p><Link className="button" href={`/plan?start=${date}&horizon=7${personQuery}&addMeal=true#add-meal`}>Mahlzeit hinzufügen</Link></div>}
        </section>
        <div className="button-row"><Link className="button button-primary" href={`/plan?start=${date}&horizon=7${personQuery}&addMeal=true#add-meal`}>Mahlzeit hinzufügen</Link><Link className="button" href="/shopping">Einkaufsliste</Link><Link className="button button-quiet" href="/inventory">Vorrat prüfen</Link></div>
      </div>
      <details className="section card stack"><summary>Kommende Mahlzeiten ({upcoming.length})</summary>{upcoming.length ? <ul className="list-reset">{upcoming.map((entry) => { const batch = entry.batchId ? batchesById[entry.batchId] : null; const allocation = snapshot.allocations.find((item) => item.entryId === entry.id && item.personId === selectedPerson?.id); return <li className="list-row split" key={entry.id}><div><strong>{entry.date} · {slotLabels[entry.slot] ?? entry.slot} · {entryLabel(entry, batch?.recipe?.title)}</strong><p className="help">{allocation ? `${formatDecimal(allocation.portions)} ${entry.kind === 'direct_food' ? 'Anteile der Gesamtmenge' : 'Portionen'} für ${selectedPersonName}` : `Noch keine Zuteilung für ${selectedPersonName}`}</p></div>{batch?.recipe && <Link className="button button-small" href={`/recipes/${batch.recipe.recipeId}?versionId=${batch.recipe.id}`}>Rezept ansehen</Link>}</li>; })}</ul> : <p className="help">Im geladenen Zeitraum stehen keine weiteren Mahlzeiten.</p>}</details>
      {reminders.some((reminder) => !reminder.entryId && !reminder.batchId) && <section className="section card stack"><p className="eyebrow">Vor dem Essen</p><h2>Haushaltserinnerungen</h2><p>Auftau- und Vorbereitungshinweise sind keine Haltbarkeits- oder Lebensmittelsicherheitszusage.</p><ul className="list-reset">{reminders.filter((reminder) => !reminder.entryId && !reminder.batchId).map((reminder) => <PrepReminderStatus key={reminder.id} householdId={context.household.id} reminder={reminder} operationId={crypto.randomUUID()} action={savePrepReminderAction} />)}</ul></section>}
      <section className="section card stack" aria-labelledby="today-nutrition-heading"><p className="eyebrow">Geplant, nicht verzehrt</p><h2 id="today-nutrition-heading">{selectedPersonName} · Nährstoffübersicht</h2><p className="help">Körperwerte anderer Haushaltsmitglieder werden nicht angezeigt. Zielvergleiche erscheinen nur für dein eigenes Profil oder ausdrücklich freigegebene Zielversionen.</p>{day && <DayNutritionCard day={day} week={week ?? undefined} hideEnergy={params.hideEnergy === 'true'} />}{!selectedPerson && <p className="alert alert-info">Wähle eine Person, um geplante persönliche Zuteilungen anzusehen.</p>}</section>
      <details className="section card stack"><summary>Haushaltsplanung für diesen Tag abschließen oder öffnen</summary><PlanDayCompletenessControl key={date} householdId={context.household.id} date={date} planRevision={snapshot.householdPlanRevision} isComplete={snapshot.completeDates.includes(date)} hasMeals={entriesToday.length > 0} operationId={crypto.randomUUID()} action={setPlanDayCompletenessAction} /></details>
    </main>
  );
}

