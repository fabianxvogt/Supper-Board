import Link from 'next/link';
import { notFound } from 'next/navigation';
import { calculateRecipe } from '@/domain/nutrition';
import type { RecipeCalculation } from '@/domain/types';
import { formatDecimal, nutrientBasisLabel } from '@/app/workspace/format';
import { getWorkspaceContext } from '@/app/workspace/context';
import { RecipeFavoriteControl } from '@/features/recipes/RecipeFavoriteControl';
import { setRecipeFavoriteAction } from '@/app/actions/recipes';
import { RecipeNutritionTable } from '@/features/recipes/RecipeNutritionTable';

function stepText(step: Record<string, unknown>): string {
  return typeof step.text === 'string' ? step.text : '';
}

export default async function RecipeDetailPage({ params, searchParams }: { params: Promise<{ recipeId: string }>; searchParams: Promise<{ versionId?: string }> }) {
  const [{ recipeId }, query, context] = await Promise.all([params, searchParams, getWorkspaceContext()]);
  const current = await context.repository.getCurrentRecipe({ householdId: context.household.id, recipeId });
  if (!current) notFound();
  const versions = await context.repository.listRecipeVersions({ householdId: context.household.id, recipeId });
  const versionId = query.versionId && versions.some((version) => version.id === query.versionId) ? query.versionId : current.currentVersionId;
  const recipe = await context.repository.getRecipeDetails(versionId);
  if (recipe.recipeId !== recipeId || recipe.householdId !== context.household.id) notFound();
  let calculation: RecipeCalculation | null = null;
  let calculationError = '';
  try {
    calculation = calculateRecipe(recipe.recipeVersion);
  } catch (error) {
    calculationError = error instanceof Error ? error.message : 'Nährwertberechnung nicht verfügbar.';
  }
  const isCurrent = recipe.id === current.currentVersionId;
  const yieldLabel = recipe.yieldPortions ?? (recipe.yieldText ? `${recipe.yieldText} · ungeklärt` : 'unbekannt');
  return (
    <main className="page-wrap">
      <div className="page-heading"><div><p className="eyebrow">Rezeptversion {recipe.versionNumber}{isCurrent ? ' · aktuell' : ' · historisch'}</p><h1>{recipe.title}</h1><p>{recipe.description || 'Keine Beschreibung hinterlegt.'}</p></div><div className="button-row"><Link className="button button-primary" href={`/plan?recipeVersionId=${recipe.id}#add-meal`}>Diese Mahlzeit planen</Link><Link className="button" href="/recipes">Alle Rezepte</Link>{isCurrent && <Link className="button" href={`/recipes/${recipe.recipeId}/edit`}>Neue Version bearbeiten</Link>}</div></div>
      <section className="grid grid-3 card card-flat" aria-label="Rezeptangaben"><div className="metric"><span className="metric-label">Basisportionen</span><span className="metric-value">{yieldLabel}</span></div><div className="metric"><span className="metric-label">Aktive Zeit</span><span className="metric-value">{recipe.activeMinutes == null ? 'Offen' : `${recipe.activeMinutes} Min.`}</span></div><div className="metric"><span className="metric-label">Gesamtdauer</span><span className="metric-value">{recipe.totalMinutes == null ? 'Offen' : `${recipe.totalMinutes} Min.`}</span></div>{recipe.finishedWeightGrams && <div className="metric"><span className="metric-label">Fertiges Gesamtgewicht</span><span className="metric-value">{formatDecimal(recipe.finishedWeightGrams)} g</span></div>}</section>
      {recipe.yieldText && recipe.yieldPortions != null && <p className="help">Übernommene Originalangabe: {recipe.yieldText}</p>}
      <section className="section card stack"><div className="split"><div><p className="eyebrow">Versioniert</p><h2>Rezeptversionen</h2></div><RecipeFavoriteControl recipeVersionId={recipe.id} favoriteRevision={recipe.favoriteRevision} isFavorite={recipe.isFavorite} operationId={crypto.randomUUID()} action={setRecipeFavoriteAction} /></div><p className="help">Gespeichert am {new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(recipe.createdAt))} · Berechnung {recipe.calculationVersion}.</p><ol className="list-reset">{versions.map((version) => <li className="list-row split" key={version.id}><div><strong>Version {version.versionNumber}</strong><p className="help">{new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' }).format(new Date(version.createdAt))} · {version.id === current.currentVersionId ? 'Aktuelle Version' : 'Historische Version'}</p></div><Link className="button button-small" href={`/recipes/${recipe.recipeId}?versionId=${encodeURIComponent(version.id)}`}>Ansehen</Link></li>)}</ol>{!isCurrent && <p className="alert alert-info">Historische Versionen bleiben unverändert. Eine Bearbeitung startet auf der aktuellen Version.</p>}</section>
      <div className="grid grid-2 section">
        <section className="card stack"><p className="eyebrow">Mengen & Lebensmittelversionen</p><h2>Zutaten</h2>{recipe.ingredients.length ? <ul className="list-reset">{recipe.ingredients.map((ingredient) => <li className="list-row" key={ingredient.id}><strong>{ingredient.foodVersion?.name ?? ingredient.freeText ?? 'Unzugeordnete Zutat'}</strong>{ingredient.freeText && ingredient.foodVersion && <p className="help">Originalangabe: {ingredient.freeText}</p>}<p>{ingredient.quantity.amount == null ? 'Menge unbekannt' : `${formatDecimal(ingredient.quantity.amount)} ${ingredient.quantity.unit}`} · Mengenbasis: {nutrientBasisLabel(ingredient.quantity.basis)}{ingredient.quantity.confirmedGramsPerUnit ? ` · bestätigt ${formatDecimal(ingredient.quantity.confirmedGramsPerUnit)} g je Einheit` : ''}</p>{ingredient.foodVersion && <p className="help">Zustand: {ingredient.foodVersion.state || 'nicht ausgewiesen'}</p>}{ingredient.alternativeGroupId && <p className="help">Alternative {ingredient.alternativeGroupId} · {ingredient.selectedAlternative ? 'ausgewählt' : 'nicht ausgewählt'}</p>}{ingredient.foodVersion && <details><summary>Zuordnung und Originalwerte</summary><p className="help">Feste Lebensmittelversion: {ingredient.foodVersion.id}</p><p className="help">Originalmenge: {ingredient.quantity.amount ?? 'unbekannt'} {ingredient.quantity.unit}</p></details>}</li>)}</ul> : <p className="alert alert-info">Für diese Version sind keine strukturierten Zutaten gespeichert.</p>}</section>
        <section className="card stack"><p className="eyebrow">Schritte</p><h2>Zubereitung</h2>{recipe.steps.length ? <ol>{recipe.steps.map((step, index) => <li key={typeof step.id === 'string' ? step.id : index}>{stepText(step)}</li>)}</ol> : <p className="help">Keine Zubereitungsschritte hinterlegt.</p>}</section>
      </div>
      <section className="section card stack">
        <p className="eyebrow">Bekannte Werte · ohne Nullauffüllung</p>
        <h2>Nährwertberechnung</h2>
        {calculationError && <p className="alert alert-warning">Berechnung nicht verfügbar: {calculationError}</p>}
        {calculation && <>
          <p className="help">Gespeicherte Lebensmittel-, Mapping- und Rezeptversionen werden verwendet. Unzugeordnete Zutaten und offene Mengen werden ausdrücklich angezeigt.</p>
          {recipe.yieldPortions == null && <p className="alert alert-warning" role="status">Basisportionen unbekannt. Nährwerte der ganzen Charge bleiben sichtbar; pro Portion wird kein Wert berechnet.</p>}
          <RecipeNutritionTable calculation={calculation} />
          {calculation.total.nutrients.length === 0 && <p className="alert alert-info">Für diese Rezeptversion sind keine Nährwerte vollständig zu berechnen.</p>}
          {calculation.issues.length > 0 && <details><summary>Offene Berechnungsgrundlagen</summary>{calculation.issues.map((issue) => <p className="help" key={issue}>{issue === 'recipe_yield_unknown' ? 'Basisportionen unbekannt; Nährwerte je Portion werden nicht berechnet.' : issue}</p>)}</details>}
        </>}
      </section>
      <section className="section card stack"><p className="eyebrow">Historische Verwendung</p><h2>Geplante Kochchargen</h2><p>Jede Kochcharge behält ihre damals gespeicherte Rezeptversion. Plane diese angezeigte Version ausdrücklich; ältere Pläne werden nicht verändert.</p><Link className="button" href={`/plan?recipeVersionId=${recipe.id}#add-meal`}>Diese Mahlzeit planen</Link></section>
    </main>
  );
}
