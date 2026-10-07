import { z } from 'zod';
import Link from 'next/link';
import { CatalogBrowser } from '@/features/catalog';
import { createHouseholdFoodAction, foodCategoriesAction, foodDetailsAction, searchFoodsAction } from '@/app/actions/catalog';
import { createRepository } from '@/data/repository';
import { createServerSupabaseClient, getVerifiedUser } from '@/lib/supabase/server';

function safeReturnTo(value: string | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/today';
  const url = new URL(value, 'https://supper-board.invalid');
  if (url.origin !== 'https://supper-board.invalid') return '/today';
  const dynamicRecipeEditor = /^\/recipes\/([^/]+)\/edit$/.exec(url.pathname);
  const allowedPath = ['/plan', '/recipes/new', '/inventory', '/shopping'].includes(url.pathname)
    || Boolean(dynamicRecipeEditor && z.uuid().safeParse(dynamicRecipeEditor[1]).success);
  if (!allowedPath) return '/today';
  return `${url.pathname}${url.search}${url.hash}`;
}

export default async function DiscoverFoodsPage({ searchParams }: { searchParams: Promise<{ q?: string; categoryId?: string; sourceMode?: string; returnTo?: string }> }) {
  const params = await searchParams;
  const query = params.q?.slice(0, 160) ?? '';
  const parsedCategoryId = params.categoryId ? z.uuid().safeParse(params.categoryId) : null;
  const categoryId = parsedCategoryId?.success ? parsedCategoryId.data : undefined;
  const parsedSourceMode = z.enum(['all', 'bls', 'household']).safeParse(params.sourceMode);
  const sourceMode = parsedSourceMode.success ? parsedSourceMode.data : 'all';
  const [initialPage, initialCategories] = await Promise.all([
    searchFoodsAction({ query, categoryId, sourceMode, limit: 24 }),
    foodCategoriesAction(),
  ]);
  const user = await getVerifiedUser();
  let ownFoodAction: typeof createHouseholdFoodAction | undefined;
  if (user) {
    const repository = createRepository(await createServerSupabaseClient());
    if ((await repository.listHouseholds()).length > 0) {
      ownFoodAction = createHouseholdFoodAction;
    }
  }
  return (
    <main className="page-wrap">
      <div className="page-heading"><div><p className="eyebrow">Lebensmittelkatalog</p><h1>Essen entdecken</h1><p>Versionierte Lebensmitteldaten und eigene Einträge mit nachvollziehbarer Herkunft.</p></div><div className="button-row"><Link className="button" href="/recipes">Rezepte</Link><Link className="button button-quiet" href={safeReturnTo(params.returnTo)}>Zurück</Link></div></div>
      <CatalogBrowser
        initialPage={initialPage}
        initialCategories={initialCategories}
        initialQuery={query}
        initialSourceMode={sourceMode}
        initialCategoryId={categoryId}
        searchAction={searchFoodsAction}
        detailsAction={foodDetailsAction}
        categoriesAction={foodCategoriesAction}
        ownFoodAction={ownFoodAction}
        returnTo={safeReturnTo(params.returnTo)}
      />
</main>
  );
}
