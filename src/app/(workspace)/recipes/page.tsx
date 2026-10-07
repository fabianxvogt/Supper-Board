import Link from 'next/link';
import { getWorkspaceContext } from '@/app/workspace/context';
import { RecipeFavoriteControl } from '@/features/recipes/RecipeFavoriteControl';
import { setRecipeFavoriteAction } from '@/app/actions/recipes';

export default async function RecipesPage({ searchParams }: { searchParams: Promise<{ q?: string; favorites?: string; cursor?: string }> }) {
  const context = await getWorkspaceContext();
  const params = await searchParams;
  const query = params.q?.slice(0, 160) ?? '';
  const favoritesOnly = params.favorites === 'true';
  const page = await context.repository.listRecipes({ householdId: context.household.id, query, favoritesOnly, cursor: params.cursor, limit: 24 });
  return (
    <main className="page-wrap">
      <div className="page-heading"><div><p className="eyebrow">Versionierte Rezepte</p><h1>Rezepte</h1><p>Eigene Rezepte bleiben in unveränderlichen Versionen erhalten. Geplante Kochchargen verweisen auf ihren ursprünglichen Stand.</p></div><div className="button-row"><Link className="button button-primary" href="/recipes/new">Rezept erstellen</Link><Link className="button" href={`/discover/foods?returnTo=${encodeURIComponent('/recipes/new')}`}>Lebensmittel suchen</Link></div></div>
      <form className="card form-grid" action="/recipes" method="get">
        <label className="field" htmlFor="recipe-query">Rezept suchen<input id="recipe-query" name="q" maxLength={160} defaultValue={query} /></label>
        <label className="field" htmlFor="recipe-favorites">Ansicht<select id="recipe-favorites" name="favorites" defaultValue={favoritesOnly ? 'true' : 'false'}><option value="false">Alle Rezepte</option><option value="true">Nur Favoriten</option></select></label>
        <div className="form-actions"><button className="button" type="submit">Suchen</button></div>
      </form>
      {page.items.length ? <div className="grid grid-2 section">{page.items.map((recipe) => <article className="card stack" key={recipe.recipeId}>
        <div className="split"><div><p className="eyebrow">Version {recipe.versionNumber}</p><h2><Link href={`/recipes/${recipe.recipeId}`}>{recipe.title}</Link></h2></div><span className="status">{recipe.baseServings == null ? 'Basisportionen unbekannt' : `Basis ${recipe.baseServings} Portionen`}</span></div>
        {recipe.description && <p className="muted">{recipe.description}</p>}
        <p className="help">Aktualisiert: {new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' }).format(new Date(recipe.updatedAt))} · gespeicherte Version {recipe.currentVersionId}</p>
        <div className="button-row"><Link className="button button-small" href={`/recipes/${recipe.recipeId}`}>Rezept öffnen</Link><Link className="button button-small" href={`/recipes/${recipe.recipeId}/edit`}>Neue Version bearbeiten</Link></div>
        <RecipeFavoriteControl recipeVersionId={recipe.currentVersionId} favoriteRevision={recipe.favoriteRevision} isFavorite={recipe.isFavorite} operationId={crypto.randomUUID()} action={setRecipeFavoriteAction} />
      </article>)}</div> : <section className="empty-state section"><h2>{favoritesOnly ? 'Noch keine Favoriten' : 'Noch keine eigenen Rezepte'}</h2><p>{favoritesOnly ? 'Markiere ein Rezept mit dem Stern, um es hier wiederzufinden.' : 'Erstelle ein eigenes Rezept oder beginne mit einer Lebensmittelzuordnung. Es werden keine Beispieldaten angelegt.'}</p><Link className="button button-primary" href="/recipes/new">Eigenes Rezept erstellen</Link></section>}
      {page.nextCursor && <nav className="section form-actions" aria-label="Weitere Rezepte"><Link className="button" href={`/recipes?q=${encodeURIComponent(query)}&favorites=${favoritesOnly}&cursor=${encodeURIComponent(page.nextCursor)}`}>Weitere Rezepte laden</Link></nav>}
    </main>
  );
}
