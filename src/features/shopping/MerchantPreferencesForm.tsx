'use client';

import { useActionState, useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ActionStatus, SubmitButton } from '@/components/SubmitButton';
import type { ShoppingActionState } from '@/app/actions/shopping';

export type MerchantLink = { id?: string; label: string; url: string; linkType: 'product' | 'search' | 'store' | 'map' };
export type MerchantPreferenceAction = (state: ShoppingActionState, formData: FormData) => Promise<ShoppingActionState>;

export function MerchantPreferencesForm({ householdId, revision, postalCode, city, favoriteMerchant, links, operationId, action }: {
  householdId: string;
  revision: number | null;
  postalCode: string;
  city: string;
  favoriteMerchant: string;
  links: MerchantLink[];
  operationId: string;
  action: MerchantPreferenceAction;
}) {
  const router = useRouter();
  const [currentOperationId, setCurrentOperationId] = useState(operationId);
  const [currentLinks, setCurrentLinks] = useState(links.map(({ label, url, linkType }) => ({ label, url, linkType })));
  const [newLink, setNewLink] = useState<MerchantLink>({ label: '', url: '', linkType: 'search' });
  const mutationAction = useCallback(async (previousState: ShoppingActionState, formData: FormData) => {
    const result = await action(previousState, formData);
    if (result.savedOperationId === formData.get('operationId')) {
      setCurrentOperationId(crypto.randomUUID());
      router.refresh();
    }
    return result;
  }, [action, router]);
  const [state, formAction] = useActionState(mutationAction, {});
  function addLink() {
    if (!newLink.label.trim() || !newLink.url.trim()) return;
    setCurrentLinks((previous) => [...previous, { ...newLink, label: newLink.label.trim(), url: newLink.url.trim() }]);
    setNewLink({ label: '', url: '', linkType: 'search' });
  }
  return (
    <form className="card stack" action={formAction}>
      <input type="hidden" name="operationId" value={currentOperationId} />
      <input type="hidden" name="householdId" value={householdId} />
      {revision !== null && <input type="hidden" name="expectedRevision" value={revision} />}
      <input type="hidden" name="linksJson" value={JSON.stringify(currentLinks)} />
      <p className="eyebrow">Markt & Händlerlink</p><h2>Manuelle Marktangaben</h2>
      <div className="form-grid">
        <label className="field" htmlFor="merchant-postal-code">Postleitzahl<input id="merchant-postal-code" name="postalCode" defaultValue={postalCode} autoComplete="postal-code" maxLength={20} /></label>
        <label className="field" htmlFor="merchant-city">Ort<input id="merchant-city" name="city" defaultValue={city} autoComplete="address-level2" maxLength={100} /></label>
        <label className="field" htmlFor="merchant-favorite">Bevorzugter Markt<input id="merchant-favorite" name="favoriteMerchant" defaultValue={favoriteMerchant} maxLength={120} placeholder="Zum Beispiel Marktname" /></label>
      </div>
      <fieldset className="stack"><legend>Gespeicherte Links</legend>
        {currentLinks.length === 0 ? <p className="muted">Noch keine Links gespeichert.</p> : <ul className="stack">{currentLinks.map((link, index) => <li className="split" key={`${link.url}-${index}`}><span>{link.label} · {link.linkType}</span><button className="button button-small button-quiet" type="button" onClick={() => setCurrentLinks((previous) => previous.filter((_, itemIndex) => itemIndex !== index))}>Entfernen</button></li>)}</ul>}
        <div className="form-grid">
          <label className="field" htmlFor="merchant-link-label">Linkname<input id="merchant-link-label" value={newLink.label} onChange={(event) => setNewLink((value) => ({ ...value, label: event.currentTarget.value }))} maxLength={120} /></label>
          <label className="field" htmlFor="merchant-link-url">HTTPS-Adresse<input id="merchant-link-url" type="url" inputMode="url" value={newLink.url} onChange={(event) => setNewLink((value) => ({ ...value, url: event.currentTarget.value }))} maxLength={2048} placeholder="https://…" /></label>
          <label className="field" htmlFor="merchant-link-type">Linktyp<select id="merchant-link-type" value={newLink.linkType} onChange={(event) => setNewLink((value) => ({ ...value, linkType: event.currentTarget.value as MerchantLink['linkType'] }))}><option value="product">Bestätigte Produktseite</option><option value="search">Händlersuche</option><option value="store">Filialseite</option><option value="map">Kartensuche</option></select></label>
        </div>
        <button className="button button-small" type="button" onClick={addLink}>Link zur Liste hinzufügen</button>
        <p className="help">Gespeichert werden nur gültige HTTPS-Adressen. Ein Produktlink behauptet keine Produktzuordnung oder Verfügbarkeit, sofern du sie nicht selbst bestätigst.</p>
      </fieldset>
      <ActionStatus error={state.error} message={state.savedOperationId ? 'Marktangaben gespeichert.' : null} />
      <SubmitButton>Marktauswahl speichern</SubmitButton>
    </form>
  );
}
