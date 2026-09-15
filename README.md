# Dienstplan & Stundenzettel — KENZO & Asia Wok Warburg

Eine App für zwei Filialen in 34414 Warburg (Nordrhein-Westfalen). Die
Oberfläche ist auf Vietnamesisch; umgeschaltet wird im Tab „Cài đặt" (Feld
„Cửa hàng") oder in der Kopfzeile. Der Sperrbildschirm prüft das Passwort der
zuletzt gewählten Filiale. Jede Filiale hat eigene Mitarbeiter, Öffnungszeiten,
Pläne, ein eigenes Passwort und eine eigene Zeile in Supabase.

| Filiale | `store_id` | Anschrift | Öffnung |
|---|---|---|---|
| KENZO Asia Kitchen & Sushi Lounge | `kenzo` | Hauptstraße 19 | Mo Ruhetag · Di–Mi 17:00–21:00 · Do–So 12:00–14:30 und 17:00–21:30 · Feiertag wie Sonntag |
| Asia Wok Warburg | `asiawok` | Paderborner Tor 126a | Mo–Sa 11:00–19:30 · So und Feiertag geschlossen |

Feiertage: NRW (`src/lib/holidays.ts`).

## Planung nach Grundplan

Jede Person hat einen **Grundplan je Wochentag** (bis zu zwei Dienste am Tag)
und einen Vertrag in **Wochen- oder Monatsstunden**. Der Scheduler
(`src/lib/baseScheduler.ts`) legt den Grundplan in alle offenen Tage des Monats
und gleicht dann auf den Vertrag ab:

- **Zu viel:** kürzen oder streichen – zuerst wo keine Besetzungslücke entsteht,
  dann an den Tagen mit der niedrigsten Priorität (Fr/Sa/So = 1,5, sonst 1,0;
  Abenddienst +0,25). Verstellbare Personen verlieren erst Vorbereitungszeit
  außerhalb der Öffnung, dann 30′-Schritte (höchstens 1 h unter Grundplan), dann
  ganze Dienste. Fester Rahmen: erst ganze Dienste (über den Monat verteilt).
- **Zu wenig:** nur bei „Được điều chỉnh": in 30′-Schritten verlängern, zuerst wo
  eine Besetzungslücke geschlossen wird, dann Fr–So abends; höchstens 60′ vor
  Öffnung und 30′ nach Schluss. Reicht das nicht, ein neuer 2-h-Dienst an einem
  Arbeitstag. Fester Rahmen bleibt kurz und wird als Warnung gemeldet.
- **Wochenvertrag:** volle ISO-Wochen = Vertrag; eine Woche über zwei Monate wird
  nach den Grundplan-Stunden der Tage im Monat geteilt (`src/lib/contract.ts`).
- **Grenzen:** 10 h bezahlt je Tag, 6 Tage am Stück, Dienst ≥ 1,5 h, Pause nach
  § 4 ArbZG mit fester Uhrzeit.

Besetzungsregel Kenzo: Fr–So (und Feiertage) 18:00–21:00 mindestens zwei
Personen. Asia Wok: keine Regel, der Bericht zeigt nur die Besetzung.

## Startbelegschaft (Stand September 2026)

Kenzo: Nguyễn Duy Hậu (Vollzeit 40 h/Woche, verstellbar), Phương Văn Trọng Hiếu
(120 h/Monat, verstellbar), Ahmad Zia Omami (11 h/Monat, Fr–So 18–21 Uhr).
Asia Wok: Nguyễn Duy Hậu (Minijob 40 h/Monat, Mo–Fr 12–14 Uhr – laut Betrieb
eine andere Person mit gleichem Namen), Bùi Xuân Ngự (43 h/Monat, Do–Sa 17–19 Uhr,
Rahmen bleibt, Fehlstunden werden gemeldet). Siehe `src/lib/sampleData.ts`.

## Entwicklung

```bash
npm install
npm run dev
npm run test
npm run build
```

Persistenz über LocalStorage (Schlüssel je Filiale) und optional Supabase
(`store_data`, eine Zeile je `store_id`), konfiguriert mit `VITE_SUPABASE_URL`
und `VITE_SUPABASE_ANON_KEY`. `VITE_STORE_ID_PREFIX` (z. B. `test-`) lenkt lokal
auf Testzeilen um. Die Passwortsperre im Client ersetzt keine Zugriffskontrolle.

Wichtige Module:

- `src/lib/stores.ts`: Filialen (Name, Anschrift, Öffnung, Besetzungsregeln, Startbelegschaft).
- `src/lib/baseScheduler.ts`: Planung nach Grundplan.
- `src/lib/contract.ts`: Monats-Soll und Wochenbudgets.
- `src/lib/workHours.ts`: Öffnungsblöcke, Ruhetage, Feiertagsschließung, Ausnahmen.
- `src/lib/analyze.ts`, `src/lib/validation.ts`: Besetzung und Vertragsprüfung.
- `src/hooks/useSchedule.ts`: Zustand je Filiale, Umschalten, Sync.
