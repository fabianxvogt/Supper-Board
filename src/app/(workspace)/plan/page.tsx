import Link from 'next/link';
import { z } from 'zod';
import { domainDecimal } from '@/domain/amounts';
import { addLocalDays } from '@/domain/dates';
import type { PlanSnapshot, FoodDetails, FoodSearchHit } from '@/data/repository';
import { getWorkspaceContext } from '@/app/workspace/context';
import { formatDecimal, formatLocalDate, localToday, nutrientBasisLabel, slotNames } from '@/app/workspace/format';
import { KitchenModeControls } from '@/components/KitchenModeControls';
import { ScheduleBatchForm } from '@/features/planning/ScheduleBatchForm';
import { ScheduleDirectFoodForm } from '@/features/planning/ScheduleDirectFoodForm';
import { AllocateMealForm } from '@/features/planning/AllocateMealForm';
import { MovePlanForm, type MoveEntryChoice } from '@/features/planning/MovePlanForm';
import { SwapMealsForm, UndoPlanChangeForm } from '@/features/planning/PlanChangeControls';
import { CompletionControl } from '@/features/planning/CompletionControls';
import { PlanDayCompletenessControl } from '@/features/planning/PlanDayCompletenessControl';
import { ChecklistItemControl } from '@/features/planning/ChecklistItemControl';
import { MealFeedbackForm } from '@/features/planning/MealFeedbackForm';
import { PlanDraftEditor, type DraftEntryChoice, type DraftEntryInput } from '@/features/planning/PlanDraftEditor';
import { ApprovePlanDraftForm, DraftEntryReplacementForm } from '@/features/planning/PlanDraftControls';
import { scheduleBatchAction, scheduleDirectFoodAction, allocateMealAction, previewPlanMoveAction, movePlanAction, swapMealsAction, undoPlanChangeAction, setChecklistItemAction, setPlanDayCompletenessAction, markBatchCookedAction, markDirectFoodProvidedAction, saveMealFeedbackAction, createPlanDraftAction, replaceDraftEntryAction, approvePlanDraftAction } from '@/app/actions/planning';

const dateSchema = z.iso.date();
const uuidSchema = z.uuid();

function entryLabel(entry: PlanSnapshot['entries'][number], batch?: PlanSnapshot['batches'][number]) {
  if (entry.kind === 'recipe_batch') return batch?.recipe?.title ?? entry.label ?? 'Rezeptversion nicht verfügbar';
  if (entry.kind === 'direct_food') return entry.food?.nameDe ?? entry.label ?? 'Lebensmittelversion nicht verfügbar';
  return entry.label ?? 'Flexible Mahlzeit';
}

function stepText(step: Record<string, unknown>): string {
  return typeof step.text === 'string' ? step.text : 'Zubereitungsschritt';
}

function getDraftString(value: Record<string, unknown>, key: string): string | null {
  return typeof value[key] === 'string' ? value[key] as string : null;
}

export default async function PlanPage({ searchParams }: { searchParams: Promise<{ start?: string; horizon?: string; personId?: string; foodVersionId?: string }> }) {
  const [params, context] = await Promise.all([searchParams, getWorkspaceContext()]);
  const today = localToday(context.household.timeZone);
  const parsedStart = params.start ? dateSchema.safeParse(params.start) : null;
  const startDate = parsedStart?.success ? parsedStart.data : today;
  const horizonDays: 7 | 14 = params.horizon === '14' ? 14 : 7;
  const endDate = addLocalDays(startDate, horizonDays - 1);
  const selectedPerson = context.persons.find((person) => person.id === params.personId) ?? null;
  let snapshot = await context.repository.getPlanSnapshot({ householdId: context.household.id, from: startDate, to: endDate });
  if (snapshot.plan && (snapshot.plan.startDate !== startDate || snapshot.plan.endDate !== endDate)) {
    snapshot = await context.repository.getPlanSnapshot({ householdId: context.household.id, from: snapshot.plan.startDate, to: snapshot.plan.endDate });
  }
  const [recipePage, foodPage, selectedFood] = await Promise.all([
    context.repository.listRecipes({ householdId: context.household.id, limit: 100 }),
    context.repository.searchFoods({ householdId: context.household.id, query: '', limit: 100 }),
    params.foodVersionId && uuidSchema.safeParse(params.foodVersionId).success
      ? context.repository.getFoodDetails(params.foodVersionId).catch(() => null)
      : Promise.resolve(null),
  ]);
  const recipes = recipePage.items.map((recipe) => ({ id: recipe.recipeId, currentVersionId: recipe.currentVersionId, title: recipe.title, baseServings: recipe.baseServings }));
  const persons = context.persons.map(({ id, displayName }) => ({ id, displayName }));
  const foodChoices: FoodSearchHit[] = foodPage.items;
  const plan = snapshot.plan;
  const fullEntries = snapshot.entries;
  const visibleEntries = fullEntries.filter((entry) => entry.date >= startDate && entry.date <= endDate).filter((entry) => !selectedPerson || snapshot.allocations.some((allocation) => allocation.entryId === entry.id && allocation.personId === selectedPerson.id)).sort((a, b) => a.date.localeCompare(b.date) || (['breakfast', 'lunch', 'dinner', 'snack'].indexOf(a.slot) - ['breakfast', 'lunch', 'dinner', 'snack'].indexOf(b.slot)) || a.id.localeCompare(b.id));
  const batchById: Record<string, (typeof snapshot.batches)[number]> = {};
  for (const batch of snapshot.batches) batchById[batch.id] = batch;
  const viewEntries: MoveEntryChoice[] = visibleEntries.map((entry) => ({ id: entry.id, date: entry.date, slot: slotNames[entry.slot] ?? entry.slot, label: entryLabel(entry, entry.batchId ? batchById[entry.batchId] : undefined) }));
  const replacementTargets: DraftEntryChoice[] = fullEntries.map((entry) => ({ id: entry.id, date: entry.date, slot: slotNames[entry.slot] ?? entry.slot, label: entryLabel(entry, entry.batchId ? batchById[entry.batchId] : undefined) }));
  const defaultMealDate = plan ? (startDate < plan.startDate ? plan.startDate : startDate > plan.endDate ? plan.endDate : startDate) : startDate;
  const selectedPersonQuery = selectedPerson ? `&personId=${encodeURIComponent(selectedPerson.id)}` : '';
  const catalogReturnTo = `/plan?start=${startDate}&horizon=${horizonDays}${selectedPersonQuery}`;
  const visibleDateList = Array.from({ length: horizonDays }, (_, index) => addLocalDays(startDate, index));
  const currentUndo = plan ? snapshot.changes.find((change) => !change.undoneAt && change.resultingRevision === snapshot.planRevision) : undefined;

  const draftDetails = await Promise.all(snapshot.drafts.map(async (draft) => {
    const entries = await Promise.all(draft.entries.map(async (rawEntry) => {
      const entry = rawEntry as Record<string, unknown>;
      const recipeVersionId = getDraftString(entry, 'recipeVersionId');
      const foodVersionId = getDraftString(entry, 'foodVersionId');
      const [recipe, food] = await Promise.all([
        recipeVersionId ? context.repository.getRecipeDetails(recipeVersionId).catch(() => null) : Promise.resolve(null),
        foodVersionId ? context.repository.getFoodDetails(foodVersionId).catch(() => null) : Promise.resolve(null),
      ]);
      const allocations = Array.isArray(entry.allocations) ? entry.allocations.flatMap((raw) => {
        if (typeof raw !== 'object' || raw === null) return [];
        const allocation = raw as Record<string, unknown>;
        return typeof allocation.personId === 'string' && typeof allocation.portions === 'string' ? [{ personId: allocation.personId, portions: allocation.portions }] : [];
      }) : [];
      let kind: DraftEntryInput['kind'];
      switch (entry.kind) {
        case 'recipe': kind = 'recipe'; break;
        case 'food': kind = 'food'; break;
        case 'flex': kind = 'flex'; break;
        default: throw new Error('Unknown persisted plan draft entry kind.');
      }
      const id = getDraftString(entry, 'id') ?? '';
      const date = getDraftString(entry, 'date') ?? startDate;
      const slot = getDraftString(entry, 'slot') ?? 'dinner';
      const label = getDraftString(entry, 'label') ?? recipe?.title ?? food?.nameDe ?? 'Flexible Mahlzeit';
      return {
        id, date, slot: slotNames[slot] ?? slot, label, kind,
        recipeVersionId, foodVersionId,
        cookPortions: getDraftString(entry, 'cookPortions'), quantityG: getDraftString(entry, 'quantityG'),
        replacesEntryId: getDraftString(entry, 'replacesEntryId'),
        replacementRequired: entry.replacementRequired === true, replacementResolved: entry.replacementResolved === true,
        allocations,
      };
    }));
    return { ...draft, entries };
  }));

  return (
    <main className="page-wrap">
      <div className="page-heading"><div><p className="eyebrow">{context.household.name} · gemeinsame Planung</p><h1>Plan</h1><p>{horizonDays} lokale Kalendertage · {selectedPerson ? `Filter: ${selectedPerson.displayName}` : 'alle Personen'} · Kochmenge und Zuteilungen bleiben getrennt.</p></div><div className="stack"><div className="button-row"><Link className="button button-quiet" href="/today">Heute ansehen</Link><Link className="button button-primary" href={`/discover/foods?returnTo=${encodeURIComponent(catalogReturnTo)}`}>Lebensmittel einplanen</Link></div><KitchenModeControls /></div></div>
      {plan ? <p className="help">Aktiver Plan: {plan.title} · {formatLocalDate(plan.startDate)} bis {formatLocalDate(plan.endDate)} · Revision {snapshot.planRevision}.</p> : <p className="alert alert-info">Für diesen Zeitraum gibt es noch keinen aktiven Plan. Beim ersten Speichern einer Kochcharge entsteht einer; du kannst auch eine einzelne Lebensmittelmahlzeit einplanen.</p>}
      <section className="grid grid-2 section" aria-label="Mahlzeit planen">
        <ScheduleBatchForm recipes={recipes} persons={persons} today={defaultMealDate} planId={plan?.id ?? null} planRevision={plan?.revision ?? null} planStartDate={plan?.startDate ?? startDate} planEndDate={plan?.endDate ?? endDate} planTitle={plan?.title ?? `${context.household.name} · ${horizonDays}-Tage-Plan`} operationId={crypto.randomUUID()} action={scheduleBatchAction} />
        {selectedFood ? <ScheduleDirectFoodForm food={selectedFood as FoodDetails} persons={persons} today={defaultMealDate} planId={plan?.id ?? null} planRevision={plan?.revision ?? null} planStartDate={plan?.startDate ?? startDate} planEndDate={plan?.endDate ?? endDate} operationId={crypto.randomUUID()} action={scheduleDirectFoodAction} /> : <section className="card stack"><p className="eyebrow">Direkt einplanen</p><h2>Einzelnes Lebensmittel</h2><p>Wähle ein Kataloglebensmittel aus, um eine grammbasierte Mahlzeit zu speichern. Die Zuteilung bleibt einer Person zugeordnet.</p><Link className="button" href={`/discover/foods?returnTo=${encodeURIComponent(catalogReturnTo)}`}>Lebensmittel auswählen</Link></section>}
      </section>
      <section className="section card stack" aria-labelledby="plan-days-heading"><p className="eyebrow">Mahlzeiten und Tagesstatus</p><h2 id="plan-days-heading">{formatLocalDate(startDate)} – {formatLocalDate(endDate)}</h2>
        <div className="stack">{visibleDateList.map((date) => {
          const dayEntries = visibleEntries.filter((entry) => entry.date === date);
          return <article className="card card-flat stack" key={date}>
            <div className="split plan-day-heading"><div><h3>{formatLocalDate(date)}</h3><p className="help">{dayEntries.length ? `${dayEntries.length} geplante Mahlzeit${dayEntries.length === 1 ? '' : 'en'}` : 'Noch keine Mahlzeiten eingeplant.'}</p></div><PlanDayCompletenessControl householdId={context.household.id} date={date} planRevision={snapshot.householdPlanRevision} isComplete={snapshot.completeDates.includes(date)} hasMeals={dayEntries.length > 0} operationId={crypto.randomUUID()} action={setPlanDayCompletenessAction} /></div>
            {dayEntries.length > 0 && <div className="stack">{dayEntries.map((entry) => {
              const batch = entry.batchId ? batchById[entry.batchId] : undefined;
              const label = entryLabel(entry, batch);
              const allocations = snapshot.allocations.filter((allocation) => allocation.entryId === entry.id);
              const allocationLine = selectedPerson ? allocations.find((allocation) => allocation.personId === selectedPerson.id) : null;
              const feedback = snapshot.feedback.find((item) => item.entryId === entry.id && item.personId === (selectedPerson?.id ?? null));
              const allocationUnit = entry.kind === 'direct_food' ? 'Anteile der Gesamtmenge' : 'Portionen';
              return <section className="list-row stack" key={entry.id}>
                <div className="split meal-entry-heading"><div><p className="eyebrow">{slotNames[entry.slot] ?? entry.slot}</p><h4>{batch?.recipe ? <Link href={`/recipes/${batch.recipe.recipeId}?versionId=${batch.recipe.id}`}>{label}</Link> : label}</h4><p className="help">{allocationLine ? `${selectedPerson?.displayName}: ${formatDecimal(allocationLine.portions)} ${allocationUnit}` : allocations.length ? allocations.map((allocation) => `${persons.find((person) => person.id === allocation.personId)?.displayName ?? 'Haushalt'} ${formatDecimal(allocation.portions)} ${allocationUnit}`).join(' · ') : `Noch keine persönlichen ${entry.kind === 'direct_food' ? 'Anteile' : 'Portionen'} zugeteilt.`}</p></div><span className={`status ${entry.kind === 'flex' ? 'status-warning' : ''}`}>{entry.kind === 'recipe_batch' ? 'Kochcharge' : entry.kind === 'direct_food' ? 'Lebensmittel' : 'Flexibel'}</span></div>
                {entry.kind === 'direct_food' && <><p>{entry.food?.nameDe ?? 'Lebensmittel nicht verfügbar'} · Geplante Gesamtmenge: {entry.quantityG ? `${formatDecimal(entry.quantityG)} g (${nutrientBasisLabel(entry.food?.nutrientBasis)})` : `Menge unbekannt (${nutrientBasisLabel(entry.food?.nutrientBasis)})`}</p><p className="help">Relative Personenzuteilungen teilen genau diese Gesamtmenge auf; sie vervielfachen sie nicht.</p>{plan && <CompletionControl householdId={context.household.id} targetId={entry.id} targetKind="direct_food" planId={plan.id} planRevision={snapshot.planRevision} targetRevision={entry.revision} completed={entry.provided} operationId={crypto.randomUUID()} action={markDirectFoodProvidedAction} />}</>}
                {entry.kind === 'flex' && <p className="help">Dieser Termin ist noch flexibel und trägt keine berechneten Nährwerte.</p>}
                {batch?.recipe && <MealFeedbackForm householdId={context.household.id} recipeId={batch.recipe.recipeId} recipeVersionId={batch.recipe.id} entryId={entry.id} personId={selectedPerson?.id} feedbackId={feedback?.id} feedbackRevision={feedback?.revision} rating={feedback?.rating} note={feedback?.note} wish={feedback?.wish} operationId={crypto.randomUUID()} action={saveMealFeedbackAction} />}
              </section>;
            })}</div>}
          </article>;
        })}</div>
      </section>
      {plan && <>
        <section className="section card stack" aria-labelledby="batch-heading"><p className="eyebrow">Kochmenge und Reste</p><h2 id="batch-heading">Geplante Kochchargen</h2>{snapshot.batches.length ? <div className="stack">{snapshot.batches.map((batch) => {
          const relatedEntries = fullEntries.filter((entry) => entry.batchId === batch.id);
          const allocationTotal = relatedEntries.flatMap((entry) => snapshot.allocations.filter((allocation) => allocation.entryId === entry.id)).reduce((sum, allocation) => sum.plus(domainDecimal(allocation.portions)), domainDecimal('0'));
          const remaining = domainDecimal(batch.cookPortions).minus(allocationTotal);
          const checklist = snapshot.checklistItems.filter((item) => item.batchId === batch.id);
          const recipe = batch.recipe;
          return <article className="card card-flat stack" key={batch.id}>
            <div className="split"><div><h3>{recipe ? <Link href={`/recipes/${recipe.recipeId}?versionId=${recipe.id}`}>{recipe.title}</Link> : 'Rezeptversion nicht verfügbar'}</h3><p>{formatLocalDate(batch.cookDate)} · {formatDecimal(batch.cookPortions)} Portionen gekocht · {remaining.gt(0) ? `${formatDecimal(remaining.toString())} noch nicht zugeteilt` : 'Keine freien Portionen'}</p>{batch.finalWeightG && <p className="help">Bestätigtes fertiges Gesamtgewicht: {formatDecimal(batch.finalWeightG)} g.</p>}</div><span className={`status ${batch.completed ? 'status-success' : ''}`}>{batch.completed ? 'Zubereitung erledigt' : 'Geplant'}</span></div>
            {relatedEntries.length > 0 && <ul>{relatedEntries.map((entry) => <li key={entry.id}>{entry.date} · {slotNames[entry.slot] ?? entry.slot}: {snapshot.allocations.filter((allocation) => allocation.entryId === entry.id).map((allocation) => `${persons.find((person) => person.id === allocation.personId)?.displayName ?? 'Haushalt'} ${formatDecimal(allocation.portions)}`).join(', ') || 'ohne Zuteilung'}</li>)}</ul>}
            {remaining.gt(0) && plan && <AllocateMealForm householdId={context.household.id} planId={plan.id} planRevision={snapshot.planRevision} batchId={batch.id} batchRevision={batch.revision} cookDate={batch.cookDate} persons={persons} remainingPortions={formatDecimal(remaining.toString())} operationId={crypto.randomUUID()} action={allocateMealAction} />}
            <CompletionControl householdId={context.household.id} targetId={batch.id} targetKind="batch" planId={plan.id} planRevision={snapshot.planRevision} targetRevision={batch.revision} completed={batch.completed} operationId={crypto.randomUUID()} action={markBatchCookedAction} />
            {recipe && <div><h4>Kochhilfe · gespeicherte Rezeptversion</h4><div className="grid grid-2"><section><h5>Zutaten</h5>{recipe.ingredients.length ? <ul className="list-reset">{recipe.ingredients.map((ingredient) => {
              const key = ingredient.id;
              const checked = checklist.find((item) => item.itemKind === 'ingredient' && item.itemKey === key)?.checked ?? false;
              const name = ingredient.foodVersion?.name ?? ingredient.freeText ?? 'Unzugeordnete Zutat';
              const quantity = ingredient.quantity.amount == null ? 'Menge offen' : `${formatDecimal(ingredient.quantity.amount)} ${ingredient.quantity.unit}`;
              return <ChecklistItemControl key={key} householdId={context.household.id} batchId={batch.id} itemKind="ingredient" itemKey={key} checked={checked} label={`${name} · ${quantity}`} batchRevision={batch.revision} operationId={crypto.randomUUID()} action={setChecklistItemAction} />;
            })}</ul> : <p className="help">Keine Zutatenliste gespeichert.</p>}</section><section><h5>Zubereitung</h5>{recipe.steps.length ? <ol className="list-reset">{recipe.steps.map((rawStep, index) => { const step = rawStep as Record<string, unknown>; const key = String(typeof step.position === 'number' ? step.position : index); const checked = checklist.find((item) => item.itemKind === 'step' && item.itemKey === key)?.checked ?? false; return <ChecklistItemControl key={key} householdId={context.household.id} batchId={batch.id} itemKind="step" itemKey={key} checked={checked} label={stepText(step)} batchRevision={batch.revision} operationId={crypto.randomUUID()} action={setChecklistItemAction} />; })}</ol> : <p className="help">Keine Zubereitungsschritte gespeichert.</p>}</section></div><p className="help">Abhaken ist nur eine Kochhilfe. Es wird kein Verzehr bestätigt und keine Vorratsmenge automatisch gebucht.</p></div>}
          </article>;
        })}</div> : <p className="help">Für diesen Zeitraum sind keine Kochchargen gespeichert.</p>}</section>
        {visibleEntries.length > 0 && <section className="section grid grid-2"><SwapMealsForm householdId={context.household.id} planId={plan.id} planRevision={snapshot.planRevision} entries={viewEntries} operationId={crypto.randomUUID()} action={swapMealsAction} /><MovePlanForm householdId={context.household.id} planId={plan.id} planRevision={snapshot.planRevision} entries={viewEntries} operationId={crypto.randomUUID()} previewAction={previewPlanMoveAction} commitAction={movePlanAction} /></section>}
        {currentUndo && <section className="section card stack"><p className="eyebrow">Letzte Änderung</p><h2>Planänderung zurücknehmen</h2><p>Nur möglich, solange keine spätere Planänderung diese Revision ersetzt hat.</p><UndoPlanChangeForm householdId={context.household.id} planId={plan.id} changeId={currentUndo.id} description={currentUndo.changeKind} planRevision={snapshot.planRevision} operationId={crypto.randomUUID()} action={undoPlanChangeAction} /></section>}
        <PlanDraftEditor householdId={context.household.id} planId={plan.id} planRevision={snapshot.planRevision} startDate={defaultMealDate} planStartDate={plan.startDate} planEndDate={plan.endDate} persons={persons} recipes={recipes} foods={foodChoices} existingEntries={replacementTargets} operationId={crypto.randomUUID()} action={createPlanDraftAction} />
        {draftDetails.length > 0 && <section className="section card stack" aria-labelledby="draft-list-heading"><p className="eyebrow">Manuell erstellte und spätere Entwürfe</p><h2 id="draft-list-heading">Planentwürfe</h2>{draftDetails.map((draft) => <article className="card card-flat stack" key={draft.id}><div className="split"><div><h3>{draft.title}</h3><p className="help">Revision {draft.revision} · Status: {draft.status}</p></div><span className="status">{draft.entries.length} Termine</span></div><ul className="list-reset">{draft.entries.map((entry) => <li className="list-row stack" key={entry.id}><div><strong>{entry.date} · {entry.slot} · {entry.label}</strong><p className="help">{entry.kind === 'flex' ? 'Flexibel / noch offen' : entry.kind === 'recipe' ? 'Rezeptversion gespeichert' : 'Einzelnes Lebensmittel'}{entry.replacementRequired && !entry.replacementResolved ? ' · Ersetzung noch offen' : ''}</p></div><DraftEntryReplacementForm householdId={context.household.id} draftId={draft.id} draftRevision={draft.revision} entry={entry} recipes={recipes} foods={foodChoices} persons={persons} existingEntries={replacementTargets} operationId={crypto.randomUUID()} action={replaceDraftEntryAction} /></li>)}</ul><ApprovePlanDraftForm householdId={context.household.id} planId={plan.id} planRevision={snapshot.planRevision} draft={draft} operationId={crypto.randomUUID()} action={approvePlanDraftAction} /></article>)}</section>}
      </>}
    </main>
  );
}
