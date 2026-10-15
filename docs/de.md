# Winix

## Überblick

Steuere deine **vernetzten Winix-Luftreiniger** (C545, C610, AM90, T810,
5500-2 Wi-Fi, Tower…) aus Gladys: Betrieb, Modus, Lüftergeschwindigkeit,
Plasmawave, und verfolge die Luftqualität, die PM2.5-Partikel, wenn das
Modell sie misst, die Umgebungshelligkeit und den Verschleiß des Filters.

Die Integration läuft über die **Winix-Cloud**, die der App Winix Smart, und
braucht daher eine Internetverbindung und ein Winix-Konto.

> Entwickelt **ohne die Hardware**: Der Austausch mit der Winix-Cloud folgt
> den Open-Source-Projekten, die ihn beschrieben haben, und ihren echten
> Antworten, aber die Integration wurde noch an keinem echten Luftreiniger
> ausprobiert. Rückmeldungen sind willkommen, im Gladys-Forum oder in den
> Issues des GitHub-Repositorys.
>
> Diese Integration ist **nicht mit Winix verbunden**: ein
> Community-Projekt, von Winix weder unterstützt noch empfohlen.

## Voraussetzungen

- Gladys **5.1.0** oder neuer.
- Ein Winix-WLAN-Luftreiniger, der schon in der App **Winix Smart**
  eingerichtet ist (die App verbindet ihn mit dem WLAN, die Integration
  nicht).
- Die E-Mail-Adresse und das Passwort, mit denen du dich in der App Winix
  Smart anmeldest.
- Winix-Luftentfeuchter und -Klimageräte werden nicht unterstützt und daher
  übergangen.

## Konfiguration

1. Installiere die Integration: **Integrationen → Von GitHub installieren**
   oder aus dem Katalog.
2. Gib im Tab **Konfiguration** die **E-Mail-Adresse** und das **Passwort**
   des Winix-Kontos ein.
3. Wähle das **Aktualisierungsintervall** (standardmäßig 2 Minuten, 1 bis 5)
   und die **Sprache der Funktionsnamen** (standardmäßig Französisch).
4. Speichere: Der Verbindungsstatus erscheint oben auf der Seite. Deine
   Luftreiniger erscheinen im Tab **Entdecken**; füge sie hinzu.

**Wichtig – die App auf dem Handy.** Winix erlaubt nur eine mobile Sitzung
pro Konto. Die erste Anmeldung von Gladys kann die Winix-App auf deinem Handy
abmelden: Melde dich in der App einfach neu an. Die Integration öffnet nur
eine Sitzung, um deine Luftreiniger aufzulisten (erster Start, neue Suche in
**Entdecken**); Lesen und Befehle brauchen keine, sie läuft also weiter, wenn
das Handy die Sitzung zurücknimmt.

## Die Geräte

Ein Gerät pro Luftreiniger, benannt wie in der Winix-App:

| Funktion                   | Typ                      | Was sie macht                                                               |
| -------------------------- | ------------------------ | --------------------------------------------------------------------------- |
| Betrieb                    | Schalter, steuerbar      | schaltet den Luftreiniger ein oder aus                                      |
| Modus                      | Liste, steuerbar         | Auto, Manuell oder Schlaf                                                   |
| Lüftergeschwindigkeit      | Stufe 0 bis 4, steuerbar | 0 Schlaf, 1 niedrig, 2 mittel, 3 hoch, 4 Turbo (5 Super Clean: Tower Prime) |
| Plasmawave                 | Schalter, steuerbar      | schaltet Plasmawave ein oder aus                                            |
| Luftverschmutzung          | Risikostufe 0 bis 3      | der Farbring von Winix: 0 gut, 1 mittel, 2 schlecht, 3 sehr schlecht        |
| PM2.5                      | µg/m³                    | nur bei Modellen mit diesem Sensor                                          |
| Umgebungshelligkeit        | Rohwert                  | der Messwert des Lichtsensors (ohne Einheit, Winix gibt keine an)           |
| Filterlebensdauer          | %                        | was vom Filter übrig ist, 0 %, wenn er fällig ist                           |
| Verbleibende Filterstunden | Stunden                  | verbleibende Betriebsstunden bis zum Wechsel                                |
| Online                     | ja / nein                | die Winix-Cloud hat Nachricht vom Luftreiniger                              |

- Eine Geschwindigkeit zu wählen schaltet den Luftreiniger in den manuellen
  Modus, wie in der App. Im Modus Auto ist die angezeigte Geschwindigkeit die,
  die das Gerät gewählt hat.
- Ein Modus oder eine Geschwindigkeit schaltet den Luftreiniger ein, wenn er
  aus war.
- Die Filterlebensdauer kommt vom Stundenzähler des Luftreinigers und der für
  das Modell vorgesehenen Dauer (6 480 h, also 9 Monate, bei den meisten).
  Der Wert sollte wieder bei 100 % beginnen, wenn der Filterzähler nach einem
  Wechsel am Gerät zurückgesetzt wird (an echter Hardware zu bestätigen).
- Die Sensoren (PM2.5, Helligkeit) werden beim ersten Lesen erkannt. Kommt
  ein Sensor später hinzu, bietet der Tab Entdecken **Aktualisieren** an.

## Widget

Das Dashboard-Widget **Winix-Luftreiniger** zeigt einen in seinen
Einstellungen gewählten Luftreiniger: PM2.5 und Filter live, Modus,
Luftqualität und Filterstunden, und vier Tasten **Auto**, **Manuell**,
**Schlaf** und **Ausschalten** (eine Taste **Einschalten**, wenn er aus ist).
Der aktuelle Modus trägt ein Häkchen.

## Szenen-Auslöser und -Aktionen

Die Integration fügt weder Auslöser noch Szenen-Aktion hinzu: Alles läuft
über die Funktionen des Geräts, die die Szenen von Gladys schon lesen und
steuern. Ein „Filter wechseln“ ist die Schwelle **Filterlebensdauer ≤ 5 %**
einer Szene, ausgelöst einmal beim Überschreiten; ein eigener Auslöser würde
sie wiederholen.

## Szenen-Beispiele

- **Ruhige Nacht**: Um 22:30 Uhr den **Modus** des Luftreinigers im
  Schlafzimmer auf **Schlaf** setzen; um 7 Uhr zurück auf **Auto**.
- **Schlechte Luft**: Wenn die **Luftverschmutzung** im Wohnzimmer 2 oder
  mehr erreicht (oder **PM2.5** über 25 µg/m³), die
  **Lüftergeschwindigkeit** auf 4 setzen und eine Nachricht senden; zurück
  auf **Auto**, wenn sie auf 0 fällt.
- **Filter**: Wenn die **Filterlebensdauer** unter 5 % fällt, „Filter für
  den Luftreiniger bestellen“ senden.
- **Leeres Haus**: Wenn alle weg sind, die Luftreiniger ausschalten; bei der
  Rückkehr des Ersten wieder in **Auto** einschalten.

## Aktualisierung und Bedingungen der Winix-Cloud

- Jeder zu Gladys hinzugefügte Luftreiniger wird standardmäßig alle
  **2 Minuten** gelesen (1 bis 5 je nach Konfiguration), einer nach dem
  anderen. Nur Werte, die sich ändern, gehen an Gladys, mit einer Erinnerung
  alle 6 h für die, die sich nicht bewegen.
- Winix veröffentlicht weder API noch Kontingent. Die Cloud lehnt eine Flut
  von Anfragen etwa eine Minute lang ab: Die Integration wartet dann eine
  Minute, bevor sie weitermacht. Vermeide das Ein-Minuten-Intervall, wenn du
  viele Luftreiniger hast.
- Nach einem Befehl wird der Luftreiniger 5 Sekunden später neu gelesen, um
  zu zeigen, was er wirklich getan hat.
- Das Konto wird nur beim ersten Start und bei jeder Suche in **Entdecken**
  genutzt; die Sitzung (Refresh-Token, Kennung) und die Liste der
  Luftreiniger bleiben in `/data`.

## Daten und Datenschutz

- Das Passwort bleibt in der Konfiguration von Gladys; es geht nur an den
  Anmeldedienst von Winix (AWS Cognito) und nie im Klartext: Die Anmeldung
  nutzt das Protokoll SRP.
- `/data/winix-session.json` speichert das Refresh-Token, die Kennung des
  Kontos und die Liste der Luftreiniger, lesbar nur für den Container.
- Kein Token, Passwort oder keine Kennung erscheint in den Protokollen.

## Fehlerbehebung

- **„Winix hat die E-Mail-Adresse oder das Passwort abgelehnt“**: Prüfe sie,
  indem du dich in der Winix-App anmeldest, und speichere sie erneut. Die
  Integration versucht dieselben Zugangsdaten nicht selbst erneut, um das
  Konto nicht zu sperren.
- **Die App auf dem Handy meldet mich ab**: Das ist die einzige Sitzung von
  Winix (siehe Konfiguration). Melde dich in der App neu an; Gladys liest und
  steuert die Luftreiniger weiter.
- **„Die Winix-Cloud antwortet nicht“**: ein Ausfall des Internets oder von
  Winix. Die Integration versucht es bei jedem Zyklus erneut und meldet es
  einmal in den Protokollen.
- **Ein Luftreiniger ist „offline“**: Er ist ausgesteckt oder hat kein WLAN
  mehr. Prüfe ihn in der Winix-App.
- **Ein neuer Luftreiniger erscheint nicht**: Starte eine Suche im Tab
  **Entdecken**.
- **Mehr Details**: Setze `LOG_LEVEL=debug` in den Protokollen der
  Integration.

## Grenzen

- Hängt von der Winix-Cloud und vom Internet ab: keine lokale Steuerung.
- Noch nicht an echter Hardware ausprobiert; die Codes und Antworten stammen
  aus den im README genannten Open-Source-Projekten.
- Eine mobile Sitzung pro Winix-Konto (siehe Konfiguration).
- Nur Luftreiniger: weder Luftentfeuchter noch Klimageräte von Winix.
- Keine Kindersicherung, keine Display-Helligkeit, kein Timer: Die Befehle
  sind Betrieb, Modus, Geschwindigkeit und Plasmawave.
- Die Luftqualität ist die Winix-Anzeige mit 3 oder 4 Stufen, kein
  Luftqualitätsindex; die Umgebungshelligkeit ist ein Rohwert.
- Die Funktionsnamen werden beim Hinzufügen des Geräts festgelegt: Eine
  spätere Änderung der Sprache benennt sie nicht um.
