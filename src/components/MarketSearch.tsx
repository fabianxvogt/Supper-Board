'use client';

import { useState } from 'react';

const MAPS_SEARCH = 'https://www.google.com/maps/search/';

type SearchPoint = { latitude: number; longitude: number };

function mapsUrl(query: string): string {
  const url = new URL(MAPS_SEARCH);
  url.searchParams.set('api', '1');
  url.searchParams.set('query', query);
  return url.toString();
}

export function MarketSearch({ postalCode = '', city = '', favoriteMerchant = '' }: { postalCode?: string; city?: string; favoriteMerchant?: string }) {
  const [postal, setPostal] = useState(postalCode);
  const [place, setPlace] = useState(city);
  const [point, setPoint] = useState<SearchPoint | null>(null);
  const [message, setMessage] = useState('');
  const locationQuery = point ? `${point.latitude},${point.longitude} supermarkets` : [favoriteMerchant, place, postal].filter(Boolean).join(' ') || 'Supermärkte';

  function useLocation() {
    if (!navigator.geolocation) {
      setMessage('Standort ist in diesem Browser nicht verfügbar. Gib eine Postleitzahl oder einen Ort ein.');
      return;
    }
    setMessage('Der Standort wird nur für diese Kartensuche verwendet und nicht in deinem Haushalt gespeichert.');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setPoint({ latitude: position.coords.latitude, longitude: position.coords.longitude });
        setMessage('Standort für diese Suche freigegeben.');
      },
      () => {
        setPoint(null);
        setMessage('Standort wurde nicht freigegeben oder ist nicht verfügbar. Suche stattdessen mit Postleitzahl oder Ort.');
      },
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 8_000 },
    );
  }

  return (
    <section className="card stack" aria-labelledby="market-search-heading">
      <div><p className="eyebrow">Händler & Standort</p><h2 id="market-search-heading">Märkte in deiner Nähe</h2><p className="muted">Öffnet eine externe Kartensuche. Das ist kein Filial- oder Preisverzeichnis und behauptet keine Warenverfügbarkeit.</p></div>
      <div className="form-grid">
        <label className="field" htmlFor="market-postal">Postleitzahl<input id="market-postal" autoComplete="postal-code" inputMode="numeric" maxLength={12} value={postal} onChange={(event) => { setPostal(event.currentTarget.value); setPoint(null); }} /></label>
        <label className="field" htmlFor="market-city">Ort<input id="market-city" autoComplete="address-level2" maxLength={100} value={place} onChange={(event) => { setPlace(event.currentTarget.value); setPoint(null); }} /></label>
      </div>
      <div className="button-row">
        <button className="button" type="button" onClick={useLocation}>Standort verwenden</button>
        <a className="button button-primary" href={mapsUrl(locationQuery)} target="_blank" rel="noopener noreferrer">Karte mit Märkten öffnen<span className="sr-only"> (öffnet neuen Tab)</span></a>
      </div>
      {message && <p className="help" role="status">{message}</p>}
    </section>
  );
}
