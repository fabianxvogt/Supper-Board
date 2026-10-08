import { expect, test } from './fixtures';

test('synthetic owner adopts a reviewed target, creates and plans a recipe, uses kitchen controls, and replaces a draft entry', async ({ page, owner }) => {
  const { suffix } = owner;
  const recipeTitle = `E2E Rezept ${suffix}`;
  const draftTitle = `E2E Ersatz ${suffix}`;
  const ingredientName = `E2E Zutat ${suffix}`;

  await page.getByText('Einstellungen', { exact: true }).click();
  await page.getByRole('link', { name: 'Mein Profil', exact: true }).click();
  const today = await page.locator('#age-date').getAttribute('max');
  if (!today) throw new Error('The profile must expose its authoritative household-local date.');
  const planStart = today;
  await page.getByLabel('Nährwertdarstellung').selectOption('manual');
  await page.getByText('Optionale Körperangaben & Berechnungshilfe', { exact: true }).click();
  await page.getByLabel('Bestätigtes Alter (optional)', { exact: true }).fill('30');
  await page.getByLabel('Bezugsdatum für dieses Alter').fill(today);
  await page.getByText('Gewicht, Größe und Alltag für eine Energieschätzung ergänzen (optional)', { exact: true }).click();
  await page.getByLabel('Gewicht (kg, optional)', { exact: true }).fill('70');
  await page.getByLabel('Messdatum des Gewichts').fill(today);
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/profile'),
    page.getByRole('button', { name: 'Privates Profil speichern' }).click(),
  ]);
  const manualTargetForm = page.locator('form').filter({ has: page.locator('input[name="targetCount"]') });
  await page.locator('input[name="target.0.nutrientCode"]').fill('fiber');
  await page.locator('input[name="target.0.unit"]').fill('g');
  await page.locator('input[name="target.0.pointValue"]').fill('25');
  await page.getByRole('button', { name: 'Zielversion speichern' }).click();
  await expect(manualTargetForm.getByRole('alert')).toBeVisible();
  await expect(page.locator('input[name="target.0.nutrientCode"]')).toHaveValue('fiber');
  await page.locator('input[name="target.0.nutrientCode"]').fill('dietary_fiber');
  await page.getByRole('button', { name: 'Weiteres Ziel hinzufügen' }).click();
  await page.locator('input[name="target.1.nutrientCode"]').fill('protein');
  await page.locator('input[name="target.1.unit"]').fill('g');
  await page.locator('input[name="target.1.pointValue"]').fill('80');
  await manualTargetForm.locator('fieldset').nth(1).getByLabel('Dieses Grammziel manuell sperren').check();
  await page.getByRole('button', { name: 'Zielversion speichern' }).click();
  await page.getByText('Gespeicherte Zielversionen ansehen', { exact: true }).click();
  await expect(page.getByText(/Ballaststoffe: 25 g/)).toBeVisible();
  await expect(page.getByText(/Protein: 80 g/)).toBeVisible();
  await page.getByText('Freigegebene Referenzwerte prüfen und bewusst übernehmen', { exact: true }).click();
  const proteinAdoption = page.locator('form:has(input[name="referenceId"][value="efsa_q27_protein_pri"])');
  await proteinAdoption.getByRole('button', { name: 'Vorschau der Zieländerung anzeigen' }).click();
  await expect(proteinAdoption.getByRole('region', { name: 'Vorschau der Zielübernahme' })).toBeVisible();
  await expect(proteinAdoption.getByText('Berechnet mit bestätigtem Körpergewicht: 70 kg')).toBeVisible();
  await expect(proteinAdoption.getByText(/Bisheriges persönliches Ziel: 80 g · manuelles Ziel/)).toBeVisible();
  const unlockProtein = proteinAdoption.getByLabel('Dieses gesperrte Ziel ausdrücklich entsperren und ersetzen');
  await expect(proteinAdoption.getByRole('button', { name: 'Zielübernahme bestätigen' })).toBeDisabled();
  await unlockProtein.check();
  await proteinAdoption.getByRole('button', { name: 'Vorschau aktualisieren' }).click();
  await expect(proteinAdoption.getByRole('button', { name: 'Zielübernahme bestätigen' })).toBeEnabled();
  await proteinAdoption.getByRole('button', { name: 'Zielübernahme bestätigen' }).click();
  const targetHistory = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Gespeicherte Zielversionen', exact: true }) });
  await expect(targetHistory.getByText(/Gewichtsgrundlage 70 kg · Quellkennung efsa_q27_protein_pri/)).toBeVisible();
  const fiberAdoption = page.locator('form:has(input[name="referenceId"][value="efsa_q28_fibre_ai"])');
  await fiberAdoption.getByRole('button', { name: 'Vorschau der Zieländerung anzeigen' }).click();
  await expect(fiberAdoption.getByRole('region', { name: 'Vorschau der Zielübernahme' })).toBeVisible();
  await expect(fiberAdoption.getByText(/Protein: .+ g · übernommene Referenz · Quellkennung efsa_q27_protein_pri · Gewichtsgrundlage 70 kg/)).toBeVisible();
  await fiberAdoption.getByRole('button', { name: 'Zielübernahme bestätigen' }).click();
  await expect(targetHistory.getByText(/Ballaststoffe: 25 g · übernommene Referenz · Quellkennung efsa_q28_fibre_ai/)).toBeVisible();
  await expect(page.getByText(/Protein: .+ g · übernommene Referenz/).first()).toBeVisible();
  await expect(page.getByText(/Gewichtsgrundlage 70 kg · Quellkennung efsa_q27_protein_pri/).first()).toBeVisible();
  const carbohydrateAdoption = page.locator('form:has(input[name="referenceId"][value="efsa_q28_available_carbohydrate_ri"])');
  await carbohydrateAdoption.getByRole('button', { name: 'Vorschau der Zieländerung anzeigen' }).click();
  await carbohydrateAdoption.getByRole('button', { name: 'Zielübernahme bestätigen' }).click();
  await expect(targetHistory.getByText(/Verfügbare Kohlenhydrate: 45–60 E% · übernommene Referenz/)).toBeVisible();
  await carbohydrateAdoption.getByLabel('Ausdrücklich gewählte Planungsenergie (kcal/Tag, optional)').fill('2000');
  await carbohydrateAdoption.getByRole('button', { name: 'Vorschau der Zieländerung anzeigen' }).click();
  await expect(carbohydrateAdoption.getByRole('region', { name: 'Vorschau der Zielübernahme' }).getByText('Grammumrechnung mit gewählter Planungsenergie: 2000 kcal/Tag')).toBeVisible();
  await expect(carbohydrateAdoption.getByRole('region', { name: 'Vorschau der Zielübernahme' }).getByText(/225–300 g/)).toBeVisible();
  await carbohydrateAdoption.getByRole('button', { name: 'Zielübernahme bestätigen' }).click();
  await expect(targetHistory.getByText(/Planungsenergie 2000 kcal\/Tag · Quellkennung efsa_q28_available_carbohydrate_ri/).first()).toBeVisible();

  await page.goto('/recipes/new');
  await page.getByLabel('Rezeptname').fill(recipeTitle);
  await page.getByLabel('Basisportionen').fill('1');
  await page.getByRole('button', { name: 'Zutat hinzufügen', exact: true }).click();
  await page.getByLabel('Originaltext').fill(ingredientName);
  await page.getByLabel('Menge', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Schritt hinzufügen' }).click();
  await page.getByLabel('Schritt 1').fill(`E2E Schritt ${suffix}`);
  await page.getByRole('button', { name: 'Rezeptversion speichern' }).click();
  await expect(page).toHaveURL(/\/recipes\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { name: recipeTitle })).toBeVisible();

  await page.getByRole('link', { name: 'Diese Mahlzeit planen', exact: true }).first().click();
  const scheduleRecipe = page.locator('#schedule-recipe');
  const recipeVersionId = new URL(page.url()).searchParams.get('recipeVersionId');
  expect(recipeVersionId).toBeTruthy();
  await expect(scheduleRecipe).toHaveValue(recipeVersionId!);
  await page.getByLabel('Kochdatum').fill(planStart);
  await page.getByLabel('Kochmenge (Portionen)').fill('2');
  await page.getByRole('button', { name: 'Charge einplanen' }).click();
  await expect(page.getByRole('heading', { name: recipeTitle }).first()).toBeVisible();

  await page.getByText('Kochhilfe · Zutaten und Schritte der gespeicherten Rezeptversion', { exact: true }).click();
  await page.getByRole('button', { name: 'Abhaken' }).first().click();
  await expect(page.getByText('Erledigt', { exact: true })).toBeVisible();
  await page.goto(`/today?date=${planStart}`);
  await expect(page.getByRole('heading', { name: recipeTitle })).toBeVisible();

  await page.getByText('Auftauen oder Vorbereitung erinnern').click();
  await page.getByLabel('Hinweis').fill(`E2E Erinnerung ${suffix}`);
  await page.getByRole('button', { name: 'Erinnerung speichern' }).click();
  await expect(page.getByText(`E2E Erinnerung ${suffix}`)).toBeVisible();
  await page.getByText('Bewerten, Notiz oder Wunsch speichern', { exact: true }).click();
  await page.getByLabel('Notiz zur Mahlzeit').fill(`E2E Notiz ${suffix}`);
  await page.getByRole('button', { name: 'Rückmeldung speichern' }).click();
  await page.getByRole('button', { name: 'Zubereitung erledigt' }).click();
  await expect(page.getByText('Zubereitung erledigt', { exact: true })).toBeVisible();

  await page.goto(`/plan?start=${planStart}&horizon=7`);
  await page.getByText(/^Termine ändern und Entwurf erstellen ·/).click();
  await page.getByLabel('Titel des Entwurfs').fill(draftTitle);
  const replacesEntry = page.getByLabel('Ersetzt bisherigen Termin');
  const targetOption = replacesEntry.locator('option').filter({ hasText: recipeTitle }).first();
  const targetEntryId = await targetOption.getAttribute('value');
  expect(targetEntryId).toBeTruthy();
  await replacesEntry.selectOption(targetEntryId!);
  await page.getByRole('button', { name: 'Entwurf speichern' }).click();
  await page.getByText(/^Gespeicherte Planentwürfe \(/).click();
  const savedDraft = page.locator('article').filter({ has: page.getByRole('heading', { name: draftTitle, exact: true }) });
  await expect(savedDraft).toBeVisible();
  const replacement = savedDraft.locator('details').filter({ hasText: 'Entwurfseintrag ersetzen oder vervollständigen' });
  await replacement.locator('summary').click();
  await replacement.locator('select[name="kind"]').selectOption('recipe');
  const replacementRecipe = replacement.locator('select[name="recipeVersionId"] option').filter({ hasText: recipeTitle }).first();
  const replacementVersionId = await replacementRecipe.getAttribute('value');
  expect(replacementVersionId).toBeTruthy();
  await replacement.locator('select[name="recipeVersionId"]').selectOption(replacementVersionId!);
  await replacement.locator('input[name="cookPortions"]').fill('1');
  await replacement.getByRole('button', { name: 'Entwurfseintrag speichern' }).click();
  await savedDraft.getByRole('button', { name: /freigeben/ }).click();
  await expect(savedDraft.getByText(/Status: approved/)).toBeVisible();
});

test('minimum and maximum goals retain their thresholds after reload and require explicit sharing consent', async ({ page, owner }) => {
  await page.getByText('Einstellungen', { exact: true }).click();
  await page.getByRole('link', { name: 'Mein Profil', exact: true }).click();
  await page.getByLabel('Nährwertdarstellung').selectOption('manual');
  await page.getByLabel('Vorlieben (optional)').fill(`Synthetic threshold fixture ${owner.suffix}`);
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/profile'),
    page.getByRole('button', { name: 'Privates Profil speichern' }).click(),
  ]);
  await page.locator('input[name="target.0.nutrientCode"]').fill('energy_kcal');
  await page.locator('input[name="target.0.unit"]').fill('kcal');
  await page.locator('select[name="target.0.targetKind"]').selectOption('minimum');
  await page.locator('input[name="target.0.minimum"]').fill('1900');
  await page.getByRole('button', { name: 'Weiteres Ziel hinzufügen' }).click();
  await page.locator('input[name="target.1.nutrientCode"]').fill('protein');
  await page.locator('input[name="target.1.unit"]').fill('g');
  await page.locator('select[name="target.1.targetKind"]').selectOption('maximum');
  await page.locator('input[name="target.1.maximum"]').fill('96');
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/profile'),
    page.getByRole('button', { name: 'Zielversion speichern' }).click(),
  ]);
  await page.reload();
  await expect(page.locator('select[name="target.0.targetKind"]')).toHaveValue('minimum');
  await expect(page.locator('input[name="target.0.minimum"]')).toHaveValue('1900');
  await expect(page.locator('select[name="target.1.targetKind"]')).toHaveValue('maximum');
  await expect(page.locator('input[name="target.1.maximum"]')).toHaveValue('96');
  const sharingConsent = page.locator('input[name="shareTargetsWithHousehold"]');
  await sharingConsent.check();
  await sharingConsent.evaluate((element) => { (element as HTMLInputElement).value = 'false'; });
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/profile'),
    page.getByRole('button', { name: 'Privates Profil speichern' }).click(),
  ]);
  await page.reload();
  await expect(sharingConsent).not.toBeChecked();
});
