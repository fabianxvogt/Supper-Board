import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { expect, test as base } from '@playwright/test';

interface SyntheticOwner {
  suffix: string;
  personName: string;
  householdName: string;
}

export const test = base.extend<{ owner: SyntheticOwner }>({
  owner: async ({ page }, runFixture) => {
    base.skip(process.env.E2E_SYNTHETIC !== '1', 'Set E2E_SYNTHETIC=1 for isolated local application workflows.');
    const apiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!apiUrl || !publishableKey || !serviceKey) throw new Error('Local E2E fixture environment is required.');
    const url = new URL(apiUrl);
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.port !== '55321') throw new Error('E2E fixtures refuse non-project Supabase hosts.');
    const suffix = randomUUID();
    const email = `e2e-owner-${suffix}@example.invalid`;
    const password = `Supper-${suffix}-Local!`;
    const householdName = `E2E ${suffix}`;
    const personName = 'Synthetische Person';
    const client = createClient(apiUrl, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
    let registrationAttempted = false;
    try {
      await page.goto('/register');
      await page.getByLabel('E-Mail-Adresse').fill(email);
      await page.getByLabel('Passwort').fill(password);
      registrationAttempted = true;
      await page.getByRole('button', { name: 'Konto erstellen' }).click();
      await expect(page).toHaveURL(/\/onboarding\/household(?:\?|$)/);
      await page.getByLabel('Haushaltsname').fill(householdName);
      await page.getByLabel('Erste Person').fill(personName);
      await page.getByRole('button', { name: 'Haushalt dauerhaft anlegen' }).click();
      await expect(page).toHaveURL(/\/today(?:\?|$)/);
      await runFixture({ suffix, personName, householdName });
    } finally {
      if (registrationAttempted) {
        const signedIn = await client.auth.signInWithPassword({ email, password });
        if (signedIn.error || !signedIn.data.user || signedIn.data.user.email !== email) throw new Error('Owned E2E account cleanup could not authenticate its exact synthetic actor.');
        const { data: households, error: readError } = await client.from('households').select('id,name,revision').eq('name', householdName);
        if (readError) throw new Error('Owned E2E household cleanup could not read its revision.');
        for (const household of households ?? []) {
          const { error: deleteError } = await client.rpc('delete_household', { p_command: {
            operationId: randomUUID(), expectedRevisions: { [household.id]: household.revision },
            payload: { householdId: household.id, confirmName: householdName },
          } });
          if (deleteError) throw new Error(`Owned E2E household cleanup failed: ${deleteError.code}`);
        }
        const admin = createClient(apiUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
        const { error: accountError } = await admin.auth.admin.deleteUser(signedIn.data.user.id);
        if (accountError) throw new Error('Owned E2E account cleanup failed.');
        await client.auth.signOut({ scope: 'local' });
      }
    }
  },
});

export { expect };
