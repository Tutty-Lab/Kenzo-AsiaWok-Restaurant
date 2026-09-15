// ============================================================================
// Vertrag -> Monats-Soll und Wochenbudgets.
//
// Zwei Vertragsarten:
//   - MONATSstunden (targetMinutes): das Monats-Soll steht direkt da.
//   - WOCHENstunden (weeklyHours): volle ISO-Wochen tragen den Vertrag, eine
//     Woche über zwei Monate wird geteilt – nach den Grundplan-Stunden der Tage,
//     die im Monat liegen. Hậu (40 h, Di–Fr 5 h, Sa/So 8,5 h = 37 h Grundplan):
//     Di+Mi am Monatsende tragen 10/37 der Woche = 10,8 h.
//
// Die Umrechnung steht hier an EINER Stelle, damit Scheduler, Prüfung und
// Anzeige dieselbe Zahl verwenden.
// ============================================================================

import type { Employee } from "../types";
import { DAY_WEIGHTS, parseIsoDate, weekdayKeyOf, type WeekdayKey } from "./demand";
import { weekStartOf } from "./weeks";
import { DEFAULT_WORK_HOURS, type WorkHoursConfig } from "./workHours";
import { paidFromPresence } from "./time";

/** ISO "yyyy-MM-dd" + n Tage (UTC, ohne Zeitzonen-Verschiebung). */
function addDaysIso(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Höchstens so viele Arbeitstage zählen je Woche (6-Tage-Regel). */
export const OPEN_DAYS_PER_WEEK = 6;
export const SCHEDULE_SLOT_MINUTES = 30;
/** Höchste bezahlte Zeit je Tag (§ 3 ArbZG, siehe validation.ts). */
export const MAX_PAID_MINUTES_PER_DAY = 10 * 60;

/** Extra opening days in a calendar week do not increase a weekly contract. */
export function contractOpenDays(openDaysByWeek: readonly number[]): number {
  return openDaysByWeek.reduce((sum, openDays) => sum + Math.min(openDays, OPEN_DAYS_PER_WEEK), 0);
}

/** Hat die Person überhaupt einen Grundplan eingetragen? */
export function hasBaseSchedule(emp: Employee): boolean {
  return Object.values(emp.baseSchedule ?? {}).some((blocks) => (blocks?.length ?? 0) > 0);
}

/** Bezahlte Minuten des Grundplans an einem Wochentag. */
export function baseMinutesOn(emp: Employee, weekday: WeekdayKey): number {
  return (emp.baseSchedule?.[weekday] ?? []).reduce(
    (sum, block) => sum + paidFromPresence(block.endMinutes - block.startMinutes),
    0,
  );
}

/** Bezahlte Minuten des Grundplans einer ganzen Woche. */
export function baseMinutesPerWeek(emp: Employee): number {
  return (Object.keys(DAY_WEIGHTS) as WeekdayKey[]).reduce((sum, weekday) => sum + baseMinutesOn(emp, weekday), 0);
}

/**
 * Monats-Soll in Minuten über eine Anzahl offener Tage (Tagesanteil 1/6 je Tag).
 * Nur noch für Aufrufer ohne Datumsliste (Altpfad, einzelne Tests).
 */
export function monthlyTargetMinutes(emp: Employee, openDaysInMonth: number): number {
  if (emp.weeklyHours != null) {
    return Math.max(0, Math.round((emp.weeklyHours * 60 * openDaysInMonth) / OPEN_DAYS_PER_WEEK));
  }
  return emp.targetMinutes;
}

export type WeekShare = {
  weekStart: string;
  /** Anteil dieser Woche, der in den Monat fällt (0..1). */
  share: number;
  /** Arbeitstage dieses Wochenteils ab Eintritt – Obergrenze 10 h je Tag. */
  days: number;
};

/**
 * Gewicht eines Wochentags in der NORMALEN Woche: Grundplan-Minuten der Person,
 * ohne Grundplan Tagesgewicht × Öffnungsminuten laut Wochenplan. Bewusst der
 * Wochentag, nicht der Feiertag des konkreten Datums – sonst ergäben die beiden
 * Monatsteile einer Woche zusammen mehr oder weniger als eine Woche.
 */
function weekdayFactor(emp: Employee, weekday: WeekdayKey, workHours: WorkHoursConfig): number {
  if (hasBaseSchedule(emp)) return baseMinutesOn(emp, weekday);
  const minutes = workHours.perWeekday[weekday].reduce((sum, block) => sum + (block.endMinutes - block.startMinutes), 0);
  return DAY_WEIGHTS[weekday] * minutes;
}

/**
 * Wochenanteile DIESER Person im Monat.
 *
 * Normale Woche = Wochentage, die in mindestens zwei Wochen des Monats offen
 * sind (ein einmalig geöffneter Montag zählt nicht). Tage vor dem Eintritt
 * (startDate) fallen weg.
 */
export function weekSharesFor(
  emp: Employee,
  openDates: readonly string[],
  workHours: WorkHoursConfig = DEFAULT_WORK_HOURS,
): WeekShare[] {
  const weeksByWeekday = new Map<WeekdayKey, Set<string>>();
  for (const date of openDates) {
    const weekday = weekdayKeyOf(parseIsoDate(date));
    weeksByWeekday.set(weekday, (weeksByWeekday.get(weekday) ?? new Set()).add(weekStartOf(date)));
  }
  const fullWeek = [...weeksByWeekday].reduce(
    (sum, [weekday, weeks]) => sum + (weeks.size >= 2 ? weekdayFactor(emp, weekday, workHours) : 0),
    0,
  );
  if (fullWeek <= 0) return [];

  const byWeek = new Map<string, { factor: number; days: number }>();
  for (const date of openDates) {
    if (emp.startDate != null && date < emp.startDate) continue;
    const factor = weekdayFactor(emp, weekdayKeyOf(parseIsoDate(date)), workHours);
    if (factor <= 0) continue;
    const week = weekStartOf(date);
    const entry = byWeek.get(week) ?? { factor: 0, days: 0 };
    entry.factor += factor;
    entry.days += 1;
    byWeek.set(week, entry);
  }
  return [...byWeek]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([weekStart, entry]) => ({ weekStart, share: Math.min(1, entry.factor / fullWeek), days: entry.days }));
}

/**
 * Minuten eines Wochenteils: Vertrag × Anteil. Nur ein ANGEBROCHENER Wochenteil
 * wird auf 10 h je Arbeitstag gedeckelt – eine volle Woche behält den ganzen
 * Vertrag, damit ein unerfüllbarer Vertrag weiter gewarnt wird.
 */
function weekPartMinutes(weeklyMinutes: number, week: WeekShare): number {
  if (week.share >= 1) return weeklyMinutes;
  return Math.min(weeklyMinutes * week.share, week.days * MAX_PAID_MINUTES_PER_DAY);
}

/**
 * Monats-Soll dieser Person in Minuten. Wochenvertrag: Summe der Wochenteile
 * (respektiert Startdatum und 10-h-Tagesgrenze). Monatsvertrag: targetMinutes.
 */
export function monthlyTargetMinutesFor(
  emp: Employee,
  openDates: readonly string[],
  workHours: WorkHoursConfig = DEFAULT_WORK_HOURS,
): number {
  if (emp.weeklyHours == null) return emp.targetMinutes;
  const weekly = emp.weeklyHours * 60;
  return Math.max(0, Math.round(weekSharesFor(emp, openDates, workHours).reduce((sum, week) => sum + weekPartMinutes(weekly, week), 0)));
}

/**
 * Wochenbudgets (Minuten im 30-Minuten-Raster) für eine Person mit Wochenvertrag.
 *
 * - Volle Wochen bekommen genau den Vertrag.
 * - Eine Woche am MonatsENDE wird abgerundet, eine am MonatsANFANG aufgerundet –
 *   beide Teile zusammen liegen nie über dem Wochenvertrag.
 * - Kein Wochenteil trägt mehr als 10 h je Arbeitstag.
 * - Wochen ganz im Monat teilen die Rundungsreste nach größtem Rest, damit der
 *   Monat höchstens eine halbe Rastereinheit vom Soll abweicht.
 */
export function weeklyBudgetMinutes(
  emp: Employee,
  openDates: readonly string[],
  monthBounds: { first: string; last: string },
  workHours: WorkHoursConfig = DEFAULT_WORK_HOURS,
): Map<string, number> {
  const result = new Map<string, number>();
  if (emp.weeklyHours == null || emp.weeklyHours <= 0) return result;
  const weeklyMinutes = emp.weeklyHours * 60;
  const contractSlots = Math.floor(weeklyMinutes / SCHEDULE_SLOT_MINUTES + 1e-9);
  const weeks = weekSharesFor(emp, openDates, workHours).map((week) => ({
    weekStart: week.weekStart,
    slots: weekPartMinutes(weeklyMinutes, week) / SCHEDULE_SLOT_MINUTES,
    capSlots: Math.min(contractSlots, Math.floor((week.days * MAX_PAID_MINUTES_PER_DAY) / SCHEDULE_SLOT_MINUTES)),
    endsAfterMonth: addDaysIso(week.weekStart, 6) > monthBounds.last,
    startsBeforeMonth: week.weekStart < monthBounds.first,
  }));

  const whole = new Map<string, number>();
  for (const week of weeks) {
    const rounded = week.endsAfterMonth
      ? Math.floor(week.slots + 1e-9)
      : week.startsBeforeMonth ? Math.ceil(week.slots - 1e-9) : Math.floor(week.slots + 1e-9);
    whole.set(week.weekStart, Math.min(rounded, week.capSlots));
  }
  const interior = weeks.filter((week) => !week.endsAfterMonth && !week.startsBeforeMonth);
  const allocated = () => [...whole.values()].reduce((sum, value) => sum + value, 0);
  let rest = Math.round(weeks.reduce((sum, week) => sum + week.slots, 0)) - allocated();
  const byFraction = [...interior].sort((a, b) => (b.slots % 1) - (a.slots % 1) || a.weekStart.localeCompare(b.weekStart));
  for (const week of byFraction) {
    if (rest <= 0) break;
    if (whole.get(week.weekStart)! >= week.capSlots) continue;
    whole.set(week.weekStart, whole.get(week.weekStart)! + 1);
    rest -= 1;
  }
  for (const week of [...byFraction].reverse()) {
    if (rest >= 0) break;
    if (whole.get(week.weekStart)! <= 0) continue;
    whole.set(week.weekStart, whole.get(week.weekStart)! - 1);
    rest += 1;
  }
  for (const week of weeks) {
    result.set(week.weekStart, whole.get(week.weekStart)! * SCHEDULE_SLOT_MINUTES);
  }
  return result;
}
