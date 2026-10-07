# Vorrat und Einkauf: Bedienverhalten

## Vorrat (`/inventory`)

Ein Vorratseintrag kann qualitativ oder mit einer tatsächlich gezählten Menge erfasst werden. Bei Mengen bleiben Einheit und Mengenbasis sichtbar; Gramm je Einheit dürfen nur für eine bestätigte Umrechnung angegeben werden. Eine qualitative Angabe wie „vorhanden“ wird nicht als exakte Menge vom Einkaufsbedarf abgezogen. Lagerort und Freitext bleiben erhalten, auch wenn ein Lebensmittel noch nicht eindeutig dem Katalog zugeordnet werden kann.

Bestandsbewegungen protokollieren tatsächliche Zugänge und Entnahmen. Sie verändern keine Rezept- oder Planmengen. Absolute Korrekturen erfolgen als ausdrückliche Bestandsaufnahme statt als nachträglich erfundene Bewegung. Eine zuletzt gebuchte Bewegung kann revisionsgeprüft als Gegenbuchung aufgehoben werden; ältere Journaleinträge bleiben bestehen.

Die Bewegungsmaske verwendet die Einheit des ausgewählten Vorrats. Abgelehnte Mengen behalten ihre Eingaben; erst eine bestätigte Buchung setzt einen unveränderten Bewegungsentwurf zurück. Eine zwischenzeitlich neu bearbeitete Eingabe bleibt erhalten.

Die Bestandsmaske hält Werte und Ausgangsrevision gemeinsam. Ein unberührter Entwurf übernimmt den neuen Serverbestand, etwa400g nach einer Entnahme aus500g. Bereits bearbeitete Werte behalten ihre ältere Revision: eine fremde Änderung erzeugt einen Konflikt statt einer stillen Korrektur mit alten Mengen.

## Einkauf (`/shopping`)

Die Einkaufsliste ist eine aktuelle, haushaltsweite Projektion aus geplantem Bedarf, bestätigtem Vorrat und offenen Beschaffungen. Unklare Mengen bleiben Prüfpunkte. Freie Extras sind getrennte Einträge und werden nicht automatisch mit ähnlich benannten Lebensmitteln zusammengelegt; ihre eingegebene Einheit wird unverändert angezeigt. Listeneinträge können abgehakt und wieder geöffnet werden.

Ein Snapshot friert die offenen Mengen samt Quellen und Revisionen ein. Abgehakte Zeilen werden nicht in einen neuen Snapshot übernommen. Ein Snapshot kann als JSON heruntergeladen und separat als extern bestellt markiert werden. Diese Markierung übermittelt keine Bestellung an Händler und bucht keinen Vorrat.

Offene Bestellpositionen trennen erwartete, tatsächlich erhaltene und stornierte Mengen. Ein tatsächlicher Teileingang wird in der Bestelleinheit gebucht und bleibt im Wareneingangsjournal sichtbar; nicht gelieferte Restmengen bleiben offen, bis sie erhalten oder ausdrücklich storniert werden. Eine fehlende bestätigte Einheitenumrechnung wird nicht stillschweigend ergänzt. Es gibt keine angebundenen Preis-, Verfügbarkeits- oder Händlerbestell-Feeds. Märkte werden über eine manuelle Kartensuche gefunden; gespeicherte Händlerlinks und Marktpräferenzen stammen aus der Eingabe des Haushalts.

## Haushalt und private Daten (`/household`, `/join/<token>`, `/data`)

Haushaltsrollen steuern gemeinsame Änderungen: Viewer lesen, Besitzer und Editor können die jeweils erlaubten Beschaffungs- und Haushaltsdaten ändern. Private Körper- und Referenzangaben werden separat dem eigenen Konto zugeordnet.

Eine Einladung erzeugt einen geheimen, einmaligen Link mit Ablaufzeit. Es wird keine Einladungs-E-Mail gesendet. Die eingeladene Person meldet sich an und bestätigt ausdrücklich, mit welcher Haushaltsperson das Konto verknüpft wird; Namen allein führen nie zu einer automatischen Verknüpfung. Der Link ist wie ein Zugangsschlüssel zu behandeln.

Der JSON-Export unterscheidet zwischen dem eigenen privaten Profil und berechtigten gemeinsamen Haushaltsdaten. Ein Import beginnt mit einer serverseitigen Vorschau und einem Konfliktbericht; erst ein eigener Bestätigungsschritt wendet sie an. Konten, Rollen, Mitgliedschaften und Einladungen können nicht aus einem JSON-Dokument importiert werden. Das Löschen des eigenen privaten Profils ist von der Löschung gemeinsamer Haushaltsdaten getrennt.

## Browser-Abnahmelauf

Der echte Browser-Workflow in `tests/e2e/procurement.spec.ts` verwendet keine API-Mocks. Er erstellt bei `E2E_SYNTHETIC=1` ein synthetisches Konto und einen eigenen Haushalt, prüft zurückgewiesene Eingaben und eine tatsächliche Entnahme, friert eine Liste ein und ergänzt danach einen neuen Kaffee-Eintrag. Die alte Bestellung enthält nur ihre eingefrorenen Positionen; Teileingang, Storno, Gegenbuchung und JSON-Export bleiben nachvollziehbar. Es wird keine Händlerbestellung gesendet. Der Lauf löscht anschließend nur seinen eigenen Haushalt über den Besitzerbefehl und sein exakt zugeordnetes Auth-Konto; ein Bereinigungsfehler wird nicht als Erfolg ausgegeben.
