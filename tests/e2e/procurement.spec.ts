import { expect, test } from './fixtures';

test('synthetic owner records stock, orders a frozen list, receives a part, cancels the remainder, reverses the receipt and exports its history', async ({ page, owner }) => {
  const { suffix } = owner;

  await page.goto('/inventory');
  await page.getByLabel('Bezeichnung').fill(`E2E Vorrat ${suffix}`);
  await page.getByLabel('Erfassungsart').selectOption('exact');
  await page.getByLabel('Menge, falls gezählt').fill('500');
  await page.getByLabel('Einheit').fill('g');
  await page.getByRole('button', { name: 'Vorratseintrag speichern' }).click();
  await page.getByText('Bestandsbewegung dokumentieren').click();
  const movementForm = page.locator('form').filter({ has: page.getByRole('button', { name: 'Bewegung speichern', exact: true }) });
  await movementForm.getByLabel('Tatsächliche Menge').fill('NaN');
  await movementForm.getByRole('button', { name: 'Bewegung speichern', exact: true }).click();
  await expect(movementForm.getByRole('alert')).toBeVisible();
  await expect(movementForm.getByLabel('Tatsächliche Menge')).toHaveValue('NaN');
  await expect(page.getByLabel('Menge, falls gemessen')).toHaveValue('500');
  await page.getByLabel('Tatsächliche Menge').fill('100');
  await page.getByLabel('Richtung').selectOption('out');
  await page.getByLabel('Grund').selectOption('use');
  await page.getByRole('button', { name: 'Bewegung speichern' }).click();
  await expect(page.getByLabel('Menge, falls gemessen')).toHaveValue('400');

  await page.goto('/shopping');
  await page.getByLabel('Artikel').fill(`E2E Kräuter ${suffix}`);
  await page.getByLabel('Tatsächliche Menge, falls bekannt').fill('2');
  await page.getByLabel('Einheit').fill('Packung');
  await page.getByRole('button', { name: 'Extra hinzufügen' }).click();
  await expect(page.getByLabel('Aktueller Listentext')).toHaveValue(new RegExp(`E2E Kräuter ${suffix}.*2(?:\\.0+)? Packung`));

  await page.getByRole('button', { name: 'Aktuelle offene Mengen als Snapshot speichern' }).click();
  await expect(page).toHaveURL(/\/shopping\?snapshotId=/);
  const snapshotUrl = page.url();
  await page.goto('/shopping');
  const newExtra = page.locator('form').filter({ has: page.getByRole('button', { name: 'Extra hinzufügen', exact: true }) });
  await newExtra.getByLabel('Artikel').fill(`E2E Kaffee ${suffix}`);
  await newExtra.getByLabel('Tatsächliche Menge, falls bekannt').fill('3');
  await newExtra.getByLabel('Einheit').fill('Packung');
  await newExtra.getByRole('button', { name: 'Extra hinzufügen', exact: true }).click();
  await expect(page.getByLabel('Aktueller Listentext')).toHaveValue(new RegExp(`E2E Kaffee ${suffix}.*3(?:\\.0+)? Packung`));
  await page.goto(snapshotUrl);
  const frozenSnapshot = page.locator('article[aria-labelledby="snapshot-detail-heading"]');
  await expect(frozenSnapshot).toContainText(`E2E Kräuter ${suffix}`);
  await expect(frozenSnapshot).not.toContainText(`E2E Kaffee ${suffix}`);
  await page.getByRole('button', { name: 'Extern bestellt markieren' }).click();
  await expect(page.getByText('Extern bestellt', { exact: true })).toBeVisible();
  await page.goto('/shopping');
  await expect(page.getByLabel('Aktueller Listentext')).toHaveValue(new RegExp(`E2E Kaffee ${suffix}.*3(?:\\.0+)? Packung`));
  await page.goto(snapshotUrl);
  await expect(page.locator('article[aria-label^="Bestellposition"]')).toHaveCount(1);

  await page.getByLabel('Tatsächlich erhaltene Teilmenge').fill('1');
  await page.getByLabel('Lagerort des Zugangs').selectOption('fridge');
  await page.getByRole('button', { name: 'Tatsächlichen Zugang übernehmen' }).click();
  await expect(page.getByText(/erhalten 1(?:\.0+)? Packung/i).first()).toBeVisible();
  const procurementPosition = page.locator('article[aria-label^="Bestellposition"]').filter({ hasText: `E2E Kräuter ${suffix}` });
  await expect(procurementPosition).toContainText('Kühlschrank');
  await page.getByLabel('Nicht mehr erwartete Menge, falls zu stornieren').fill('1');
  await page.getByRole('button', { name: 'Nicht mehr erwartete Menge stornieren' }).click();
  await expect(page.getByText(/erhalten 1(?:\.0+)? Packung/i).first()).toBeVisible();
  await expect(page.getByText(/storniert 1(?:\.0+)? Packung/i)).toBeVisible();

  await page.goto('/inventory');
  const receivedInventoryItem = page.locator('article[aria-labelledby^="inventory-"]').filter({ hasText: `E2E Kräuter ${suffix}` });
  await expect(receivedInventoryItem).toContainText(/1(?:\.0+)? Packung/);
  await expect(receivedInventoryItem).toContainText('Kühlschrank');
  await receivedInventoryItem.getByText(/^Bestandsjournal \(/).click();
  await receivedInventoryItem.getByRole('button', { name: 'Letzte Bewegung rückgängig machen' }).click();
  await expect(receivedInventoryItem).toContainText(/Bestand danach:\s*0(?:\.0+)? Packung/);

  await page.goto(snapshotUrl);
  await expect(page.getByText(/erhalten 0(?:\.0+)? Packung/i).first()).toBeVisible();
  await expect(procurementPosition.getByText(/storniert 1(?:\.0+)? Packung/i)).toBeVisible();
  await expect(page.getByText(/Rückgängig gemacht, nicht mehr als Zugang gezählt/).first()).toBeVisible();

  await page.goto('/data');
  await page.getByRole('button', { name: 'Haushaltsdaten als JSON exportieren' }).click();
  const exportedDocument = await page.getByLabel('Exportinhalt zum manuellen Kopieren').inputValue();
  const document = JSON.parse(exportedDocument);
  expect(document.records.auth_users).toBeUndefined();
  const receipt = document.records.procurement_receipts.find((item: { storage_location: string }) => item.storage_location === 'fridge');
  expect(Number(receipt.quantity)).toBe(1);
  expect(Number.isFinite(Date.parse(receipt.reversed_at))).toBe(true);
});
