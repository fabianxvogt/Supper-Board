export const SOURCE_CATEGORY_HIERARCHY_VERSION = 'bls4-source-groups-v1';
export const DISPLAY_CATEGORY_HIERARCHY_VERSION = 'supper-board-display-v1';

export interface CatalogDisplayRoot {
  code: string;
  nameDe: string;
  nameEn: null;
}

export const DISPLAY_CATEGORY_ROOTS: readonly CatalogDisplayRoot[] = [
  { code: 'display_vegetables_mushrooms', nameDe: 'Gemüse & Pilze', nameEn: null },
  { code: 'display_fruit', nameDe: 'Obst', nameEn: null },
  { code: 'display_grains_potatoes_starches', nameDe: 'Getreide, Kartoffeln & Stärkeprodukte', nameEn: null },
  { code: 'display_legumes_nuts_seeds', nameDe: 'Hülsenfrüchte, Nüsse & Samen', nameEn: null },
  { code: 'display_dairy_eggs_alternatives', nameDe: 'Milchprodukte, Eier & Alternativen', nameEn: null },
  { code: 'display_meat_fish_alternatives', nameDe: 'Fleisch, Fisch & Alternativen', nameEn: null },
  { code: 'display_fats_oils', nameDe: 'Fette & Öle', nameEn: null },
  { code: 'display_drinks', nameDe: 'Getränke', nameEn: null },
  { code: 'display_seasonings_cooking', nameDe: 'Würzmittel & Kochzutaten', nameEn: null },
  { code: 'display_sweets_snacks', nameDe: 'Süßwaren & Knabbereien', nameEn: null },
  { code: 'display_composed_dishes', nameDe: 'Zusammengesetzte Speisen', nameEn: null },
];

// This reviewed crosswalk groups official BLS source groups under the app's
// navigation roots. It deliberately keeps mixed source groups intact as named leaves.
export const BLS_DISPLAY_PARENT_CODE_BY_SOURCE_CODE: Readonly<Record<string, string>> = {
  B: 'display_grains_potatoes_starches',
  C: 'display_grains_potatoes_starches',
  D: 'display_sweets_snacks',
  E: 'display_dairy_eggs_alternatives',
  F: 'display_fruit',
  G: 'display_vegetables_mushrooms',
  H: 'display_legumes_nuts_seeds',
  K: 'display_grains_potatoes_starches',
  M: 'display_dairy_eggs_alternatives',
  N: 'display_drinks',
  P: 'display_drinks',
  Q: 'display_fats_oils',
  R: 'display_seasonings_cooking',
  S: 'display_sweets_snacks',
  T: 'display_meat_fish_alternatives',
  U: 'display_meat_fish_alternatives',
  V: 'display_meat_fish_alternatives',
  W: 'display_meat_fish_alternatives',
  X: 'display_composed_dishes',
  Y: 'display_composed_dishes',
};

export interface BlsSourceCategory {
  sourceCode: string;
  code: string;
  nameDe: string;
  nameEn: null;
}

// The official BLS website labels each leading food-code letter with these source groups.
export const BLS_SOURCE_CATEGORIES: readonly BlsSourceCategory[] = [
  { sourceCode: 'B', code: 'bls_bread', nameDe: 'Brot und Kleingebäck', nameEn: null },
  { sourceCode: 'C', code: 'bls_cereals', nameDe: 'Cerealien, Getreide, Getreideprodukte, Reis- und Haferdrinks', nameEn: null },
  { sourceCode: 'D', code: 'bls_fine_baked_goods', nameDe: 'Dauerbackwaren, Kuchen, Feinbackwaren', nameEn: null },
  { sourceCode: 'E', code: 'bls_eggs_pasta', nameDe: 'Eier und Eierprodukte, Teigwaren', nameEn: null },
  { sourceCode: 'F', code: 'bls_fruit', nameDe: 'Früchte, Obst und Obsterzeugnisse (Fruchtsäfte, Konserven)', nameEn: null },
  { sourceCode: 'G', code: 'bls_vegetables', nameDe: 'Gemüse und Gemüseerzeugnisse (Gemüsesäfte, Konserven)', nameEn: null },
  { sourceCode: 'H', code: 'bls_legumes_nuts_alternatives', nameDe: 'Hülsenfrüchte (reif), Schalenobst, Öl- und andere Samen, pflanzliche Milch-, Fleisch- und Wurstalternativen', nameEn: null },
  { sourceCode: 'K', code: 'bls_potatoes_starches_mushrooms', nameDe: 'Kartoffeln und Kartoffelerzeugnisse, stärkereiche Pflanzenteile, Pilze', nameEn: null },
  { sourceCode: 'M', code: 'bls_dairy', nameDe: 'Milch, Milcherzeugnisse, Käse', nameEn: null },
  { sourceCode: 'N', code: 'bls_non_alcoholic_drinks', nameDe: 'Alkoholfreie Getränke (Kaffee, Tee, Erfrischungsgetränke)', nameEn: null },
  { sourceCode: 'P', code: 'bls_alcoholic_drinks', nameDe: 'Alkoholische Getränke (Bier, Wein, Spirituosen)', nameEn: null },
  { sourceCode: 'Q', code: 'bls_fats_oils', nameDe: 'Speisefette und Öle', nameEn: null },
  { sourceCode: 'R', code: 'bls_seasonings_cooking', nameDe: 'Würzmittel, Saucen, Back- und Kochzutaten', nameEn: null },
  { sourceCode: 'S', code: 'bls_sweets', nameDe: 'Süßwaren, Zucker, Schokolade, Eis und süße Aufstriche', nameEn: null },
  { sourceCode: 'T', code: 'bls_fish_shellfish', nameDe: 'Fische, Krusten-, Schalen- und Weichtiere', nameEn: null },
  { sourceCode: 'U', code: 'bls_red_meat', nameDe: 'Rind-, Kalb-, Schweine-, Schaf- und Lammfleisch', nameEn: null },
  { sourceCode: 'V', code: 'bls_game_poultry_offal', nameDe: 'Wild, Geflügel, Federwild, Innereien', nameEn: null },
  { sourceCode: 'W', code: 'bls_meat_products', nameDe: 'Fleisch- und Wurstwaren', nameEn: null },
  { sourceCode: 'X', code: 'bls_plant_dominant_dishes', nameDe: 'Menükomponenten überwiegend pflanzlich', nameEn: null },
  { sourceCode: 'Y', code: 'bls_animal_dominant_dishes', nameDe: 'Menükomponenten überwiegend tierisch', nameEn: null },
  { sourceCode: '?', code: 'unassigned', nameDe: 'Noch nicht zugeordnet', nameEn: null },
];

const categoriesBySourceCode: Record<string, BlsSourceCategory> = Object.create(null);
for (const category of BLS_SOURCE_CATEGORIES) categoriesBySourceCode[category.sourceCode] = category;
export const BLS_SOURCE_CATEGORY_BY_SOURCE_CODE: Readonly<Record<string, BlsSourceCategory>> = categoriesBySourceCode;
