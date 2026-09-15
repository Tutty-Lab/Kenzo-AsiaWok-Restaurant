// ============================================================================
// Zentrale Datentypen. Intern wird IMMER in Minuten (Integer) gerechnet,
// niemals mit Fließkomma-Stunden.
// ============================================================================

import type { WeekdayKey } from "./lib/demand";
import type { DateOverride, DayWindow, WorkHoursConfig } from "./lib/workHours";

/**
 * Anstellungsart. MINIJOB ist arbeitsrechtlich eine Form der Teilzeit und wird
 * bei der Schichtplanung auch genauso behandelt – die Trennung dient der
 * Belegschaftsstruktur und dem Stundenzettel, nicht der Planung selbst.
 */
export type EmploymentType = "VOLLZEIT" | "TEILZEIT" | "MINIJOB";

export type ShiftType = "EARLY" | "LATE" | "CUSTOM";

/**
 * Grundplan einer Person: je Wochentag die üblichen Dienste (auch zwei am Tag,
 * z. B. 11:00–14:30 und 17:00–22:00). Feiertage, an denen der Laden offen hat,
 * nehmen den Sonntag. Fehlt ein Wochentag, arbeitet die Person dort nicht.
 */
export type BaseSchedule = Partial<Record<WeekdayKey, DayWindow[]>>;

export type Employee = {
  id: string;
  name: string;
  employmentType: EmploymentType;
  /**
   * Monatliches Soll in Minuten (Integer). 120 h => 7200. Gilt, wenn KEIN
   * Wochenvertrag (weeklyHours) eingetragen ist.
   */
  targetMinutes: number;
  /**
   * Vertragliche WOCHENstunden. Gesetzt => das Monats-Soll wird je Monat daraus
   * abgeleitet (contract.ts): volle Wochen = Vertrag, Randwochen anteilig nach
   * den Grundplan-Stunden der Tage im Monat.
   */
  weeklyHours?: number;
  /**
   * Grundplan je Wochentag. Der Scheduler legt genau diese Dienste an und
   * gleicht dann auf das Soll ab (kürzen/streichen, bei adjustable auch
   * verlängern). Fehlt der Grundplan, gelten die Öffnungszeiten des Ladens.
   */
  baseSchedule?: BaseSchedule;
  /**
   * true = die Dienste dürfen über den Grundplan hinaus verlängert werden, um das
   * Soll zu erreichen (bis 60′ vor Öffnung / 30′ nach Schluss). false = der
   * Rahmen bleibt; fehlende Stunden werden als Warnung gemeldet.
   */
  adjustable?: boolean;
  /**
   * Erster Arbeitstag als ISO-Datum "yyyy-MM-dd" (Eintritt/Vertragsbeginn).
   *
   * Gesetzt => Tage VOR diesem Datum sind gesperrt (kein Dienst) UND zählen
   * nicht ins Monats-Soll eines Wochenvertrags. Fehlt = von Monatsanfang an dabei.
   */
  startDate?: string;
};

export type Shift = {
  /** Explicit unpaid break, excluded from staffing coverage. */
  pauseStartMinutes?: number;
  id: string;
  employeeId: string;
  /** ISO-Datum "yyyy-MM-dd". */
  date: string;
  startMinutes: number;
  endMinutes: number;
  pauseMinutes: number;
  /** Bezahlte Arbeitszeit in Minuten = presence - pause. */
  paidMinutes: number;
  shiftType: ShiftType;
  /** true = automatisch generiert, false = manuell hinzugefügt/geändert. */
  generated: boolean;
};

export type Schedule = {
  companyName: string;
  /** Anschrift des Betriebs (erscheint auf dem Stundenzettel). */
  address: string;
  year: number;
  /** 1-basiert: 1 = Januar ... 12 = Dezember. */
  month: number;
  /** Arbeitszeit-Fenster (giờ làm) je Wochentag + Feiertag. */
  workHours: WorkHoursConfig;
  /** Ausnahmen für einzelne Daten (geschlossen / abweichende Zeiten). */
  dateOverrides: DateOverride[];
  employees: Employee[];
  shifts: Shift[];
  /**
   * Zeitpunkt der ersten Wochen-Ausgabe (ISO). Gesetzt = der Monat ist
   * gesperrt und darf nicht mehr geändert werden.
   *
   * Hintergrund: sobald eine Woche ausgedruckt im Laden hängt, muss der Stand
   * im System exakt dem Papier entsprechen – bei einer Kontrolle wird genau
   * das verglichen. Entsperren geht nur bewusst über die Oberfläche.
   */
  lockedAt?: string;
  /** Bereits gedruckte Wochen, als ISO-Datum des jeweiligen Montags. */
  printedWeeks?: string[];
};
