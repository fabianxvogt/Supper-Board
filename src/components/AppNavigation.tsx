'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { MouseEvent, ReactNode } from 'react';

const destinations = [
  { href: '/today', label: 'Heute', symbol: '◷' },
  { href: '/plan', label: 'Plan', symbol: '▦' },
  { href: '/discover', label: 'Entdecken', symbol: '⌕' },
  { href: '/inventory', label: 'Vorrat', symbol: '▤' },
  { href: '/shopping', label: 'Einkauf', symbol: '＋' },
] as const;

function isCurrentPath(pathname: string, href: string): boolean {
  if (href === '/discover') return pathname === href || pathname.startsWith('/discover/') || pathname.startsWith('/recipes');
  if (href === '/today') return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function DestinationLink({ href, label, symbol, mobile = false, pathname }: { href: string; label: string; symbol: string; mobile?: boolean; pathname: string }) {
  const current = isCurrentPath(pathname, href);
  return (
    <Link href={href} aria-current={current ? 'page' : undefined}>
      {mobile && <span aria-hidden="true">{symbol}</span>}
      <span>{label}</span>
    </Link>
  );
}

export function AppNavigation() {
  const pathname = usePathname();
  return (
    <>
      <nav className="app-nav" aria-label="Hauptnavigation">
        {destinations.map((item) => <DestinationLink key={item.href} {...item} pathname={pathname} />)}
      </nav>
      <nav className="mobile-nav" aria-label="Hauptnavigation mobil">
        {destinations.map((item) => <DestinationLink key={item.href} {...item} mobile pathname={pathname} />)}
      </nav>
    </>
  );
}

function closeSettingsAfterNavigation(event: MouseEvent<HTMLDetailsElement>): void {
  if (event.target instanceof Element && event.target.closest('a')) event.currentTarget.open = false;
}

export function AppSettingsMenu({ children }: { children: ReactNode }) {
  return (
    <details className="context-switcher" name="workspace-header-menu" onClick={closeSettingsAfterNavigation}>
      <summary className="button button-small button-quiet">Einstellungen</summary>
      <nav className="context-panel stack" aria-label="Profil, Haushalt und Datenschutz">{children}</nav>
    </details>
  );
}
