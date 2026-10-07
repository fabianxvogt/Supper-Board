import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Supper Board – gut geplant, entspannt gekocht', template: '%s · Supper Board' },
  description: 'Der persönliche Küchenplan für Rezepte, Mahlzeiten, Vorrat und Einkauf.',
  applicationName: 'Supper Board',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Supper Board' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#f6f2eb',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
