// ============================================================================
// Grundplan-Scheduler mit der echten Belegschaft beider Filialen (Warburg).
// ============================================================================

import { describe, expect, it } from "vitest";
import type { Employee, Shift } from "../../types";
import { generateSchedule } from "../scheduler";
import { validateSchedule } from "../validation";
import { analyzeSchedule } from "../analyze";
import { datesOfMonth, parseIsoDate, weekdayKeyOf } from "../demand";
import { publicHolidays } from "../holidays";
import { resolveDay, type WorkHoursConfig } from "../workHours";
import { baseMinutesPerWeek, monthlyTargetMinutesFor, weeklyBudgetMinutes } from "../contract";
import { maxConsecutiveRun } from "../consecutive";
import { weekStartOf } from "../weeks";
import { storeById, initialScheduleFor } from "../stores";
import { normalizeEmployee } from "../../hooks/useSchedule";
import { validPause } from "../staffing";

const kenzo = storeById("kenzo");
const wok = storeById("asiawok");
const t = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));

function openDatesOf(workHours: WorkHoursConfig, year: number, month: number): string[] {
  const holidays = publicHolidays(year);
  return datesOfMonth(year, month).filter((date) => !resolveDay(workHours, date, holidays).closed);
}

function plan(store = kenzo, year = 2026, month = 9, employees: Employee[] = initialScheduleFor(store).employees) {
  const shifts = generateSchedule({ year, month, workHours: store.workHours, employees, rules: store.staffingRules });
  const openDates = openDatesOf(store.workHours, year, month);
  return { employees, shifts, openDates, validation: validateSchedule(employees, shifts, year, openDates, store.workHours) };
}

const of = (shifts: Shift[], employeeId: string) => shifts.filter((s) => s.employeeId === employeeId);
const hours = (shifts: Shift[]) => shifts.reduce((sum, s) => sum + s.paidMinutes, 0) / 60;
const time = (s: Shift) => `${String(Math.floor(s.startMinutes / 60)).padStart(2, "0")}:${String(s.startMinutes % 60).padStart(2, "0")}`;

describe("Kenzo – Stammbelegschaft über zwei Jahre", () => {
  it("keine Fehler, Monatsverträge exakt, Wochenvertrag auf 30′ genau", () => {
    for (const year of [2026, 2027]) {
      for (let month = 1; month <= 12; month++) {
        const { shifts, validation, employees, openDates } = plan(kenzo, year, month);
        expect(validation.errors.filter((e) => e.severity !== "warning"), `${year}-${month}`).toEqual([]);
        expect(hours(of(shifts, "kz-2")), `Hiếu ${year}-${month}`).toBe(120);
        expect(hours(of(shifts, "kz-3")), `Ahmad ${year}-${month}`).toBe(11);
        const hau = employees.find((e) => e.id === "kz-1")!;
        const soll = monthlyTargetMinutesFor(hau, openDates, kenzo.workHours);
        expect(Math.abs(hours(of(shifts, "kz-1")) * 60 - soll), `Hậu ${year}-${month}`).toBeLessThan(30);
      }
    }
  });

  it("Hậu überschreitet in keiner ISO-Woche 40 h", () => {
    for (let month = 1; month <= 12; month++) {
      const byWeek = new Map<string, number>();
      for (const s of of(plan(kenzo, 2026, month).shifts, "kz-1")) {
        byWeek.set(weekStartOf(s.date), (byWeek.get(weekStartOf(s.date)) ?? 0) + s.paidMinutes);
      }
      for (const minutes of byWeek.values()) expect(minutes).toBeLessThanOrEqual(40 * 60);
    }
  });

  it("volle Woche: Grundplan 37 h, die fehlenden 3 h gehen an Do–So, nicht an Di/Mi", () => {
    const shifts = of(plan().shifts, "kz-1").filter((s) => weekStartOf(s.date) === "2026-09-07");
    expect(hours(shifts)).toBe(40);
    for (const date of ["2026-09-08", "2026-09-09"]) {
      const day = shifts.filter((s) => s.date === date);
      expect(day.map((s) => [s.startMinutes, s.endMinutes])).toEqual([[t("16:00"), t("21:00")]]);
    }
  });

  it("Randwoche am Monatsende: Di+Mi tragen 10/37 der Woche, abgerundet auf 30′", () => {
    const hau = initialScheduleFor(kenzo).employees[0];
    const dates = datesOfMonth(2026, 9);
    const budgets = weeklyBudgetMinutes(hau, openDatesOf(kenzo.workHours, 2026, 9), { first: dates[0], last: dates[dates.length - 1] }, kenzo.workHours);
    expect(baseMinutesPerWeek(hau)).toBe(37 * 60);
    expect(budgets.get("2026-09-28")).toBe(Math.floor((40 * 60 * 10) / 37 / 30) * 30); // 10,5 h
  });

  it("alle Dienste liegen in der Öffnung ±Vorbereitung/Aufräumen, nie montags, max. 10 h/Tag", () => {
    const { shifts } = plan(kenzo, 2026, 12);
    const holidays = publicHolidays(2026);
    for (const s of shifts) {
      const day = resolveDay(kenzo.workHours, s.date, holidays);
      expect(day.closed, s.date).toBe(false);
      expect(day.blocks.some((b) => s.startMinutes >= b.startMinutes - 60 && s.endMinutes <= b.endMinutes + 30), `${s.date} ${time(s)}`).toBe(true);
      expect(s.endMinutes - s.startMinutes - s.pauseMinutes).toBe(s.paidMinutes);
      if (s.pauseMinutes > 0) expect(validPause(s)).toBe(true);
    }
    const perDay = new Map<string, number>();
    for (const s of shifts) perDay.set(`${s.employeeId}${s.date}`, (perDay.get(`${s.employeeId}${s.date}`) ?? 0) + s.paidMinutes);
    for (const minutes of perDay.values()) expect(minutes).toBeLessThanOrEqual(600);
  });

  it("Ahmad bleibt im Rahmen Fr–So 18:00–21:00, verteilt über den Monat", () => {
    const shifts = of(plan().shifts, "kz-3");
    for (const s of shifts) {
      expect(["friday", "saturday", "sunday"]).toContain(weekdayKeyOf(parseIsoDate(s.date)));
      expect(s.startMinutes).toBe(t("18:00"));
      expect(s.endMinutes).toBeLessThanOrEqual(t("21:00"));
      expect(s.paidMinutes).toBeGreaterThanOrEqual(90);
    }
    expect(new Set(shifts.map((s) => weekStartOf(s.date))).size).toBeGreaterThanOrEqual(3);
  });

  it("Fr–So abends stehen mindestens zwei (Besetzungsregel der Filiale)", () => {
    for (let month = 1; month <= 12; month++) {
      const { shifts, employees } = plan(kenzo, 2026, month);
      const analysis = analyzeSchedule({ year: 2026, month, workHours: kenzo.workHours, employees, shifts, rules: kenzo.staffingRules });
      expect(analysis.peakViolations.map((d) => d.date), `2026-${month}`).toEqual([]);
    }
  });

  it("an einem Feiertag (Fr 25.12.) gilt der Sonntags-Grundplan", () => {
    const hau = of(plan(kenzo, 2026, 12).shifts, "kz-1").filter((s) => s.date === "2026-12-25");
    expect(hau).toHaveLength(2);
    expect(hau[0].startMinutes).toBeLessThanOrEqual(t("11:00"));
  });
});

describe("Asia Wok – fester Rahmen", () => {
  it("sonntags und an Feiertagen kein Dienst", () => {
    const { shifts } = plan(wok, 2026, 10);
    const holidays = publicHolidays(2026);
    for (const s of shifts) {
      expect(weekdayKeyOf(parseIsoDate(s.date))).not.toBe("sunday");
      expect(holidays.has(s.date)).toBe(false);
    }
  });

  it("Hậu (40 h/Monat, Mo–Fr 12–14): Rahmen bleibt, überzählige Tage fallen verteilt weg", () => {
    const shifts = of(plan(wok).shifts, "aw-1");
    expect(hours(shifts)).toBe(40);
    for (const s of shifts) expect([s.startMinutes, s.endMinutes]).toEqual([t("12:00"), t("14:00")]);
    // September 2026: 22 Werktage × 2 h = 44 h -> zwei Tage fallen weg, nicht in derselben Woche.
    const all = openDatesOf(wok.workHours, 2026, 9).filter((d) => weekdayKeyOf(parseIsoDate(d)) !== "saturday");
    const dropped = all.filter((d) => !shifts.some((s) => s.date === d));
    expect(dropped).toHaveLength(2);
    expect(weekStartOf(dropped[0])).not.toBe(weekStartOf(dropped[1]));
  });

  it("Ngự (43 h/Monat, Do–Sa 17–19) bleibt kurz: Warnung, kein Fehler", () => {
    const { shifts, validation } = plan(wok);
    expect(validation.errors.filter((e) => e.severity !== "warning")).toEqual([]);
    const ngu = of(shifts, "aw-2");
    expect(hours(ngu)).toBeLessThan(43);
    for (const s of ngu) expect([s.startMinutes, s.endMinutes]).toEqual([t("17:00"), t("19:00")]);
    expect(validation.errors.some((e) => e.employeeId === "aw-2" && e.severity === "warning")).toBe(true);
  });
});

describe("Grenzfälle", () => {
  const person = (patch: Partial<Employee>): Employee => ({
    id: "x", name: "X", employmentType: "MINIJOB", targetMinutes: 0, ...patch,
  });

  it("fester Rahmen mit Rest: kürzt auf das Soll, nie unter 1,5 h", () => {
    const x = person({ targetMinutes: 180, baseSchedule: { monday: [{ startMinutes: t("12:00"), endMinutes: t("14:00") }] } });
    const shifts = plan(wok, 2026, 9, [x]).shifts;
    expect(hours(shifts)).toBe(3);
    for (const s of shifts) expect(s.paidMinutes).toBeGreaterThanOrEqual(90);
  });

  it("verstellbar über 6 h: Pause mit gültiger Uhrzeit, Prüfung ohne Fehler", () => {
    const x = person({
      employmentType: "TEILZEIT", targetMinutes: 26 * 60, adjustable: true,
      baseSchedule: { monday: [{ startMinutes: t("11:00"), endMinutes: t("17:00") }] },
    });
    const result = plan(wok, 2026, 9, [x]);
    expect(hours(result.shifts)).toBe(26);
    expect(result.shifts.some((s) => s.pauseMinutes > 0)).toBe(true);
    expect(result.validation.errors.filter((e) => e.severity !== "warning")).toEqual([]);
  });

  it("verstellbar, Grundplan zu klein: erst verlängern, dann ein Mittagsdienst am Arbeitstag", () => {
    // 4 Freitage × 4,5 h = 18 h; Abend höchstens 16:00–22:00 = 24 h, der Rest mittags.
    const x = person({
      targetMinutes: 36 * 60, adjustable: true,
      baseSchedule: { friday: [{ startMinutes: t("17:00"), endMinutes: t("21:30") }] },
    });
    const shifts = plan(kenzo, 2026, 9, [x]).shifts;
    expect(hours(shifts)).toBe(36);
    expect(shifts.every((s) => weekdayKeyOf(parseIsoDate(s.date)) === "friday")).toBe(true);
    expect(shifts.some((s) => s.endMinutes <= t("15:00"))).toBe(true);
  });

  it("verstellbar, aber mehr als 10 h/Tag nötig: bleibt unter dem Soll statt die Tagesgrenze zu brechen", () => {
    const x = person({
      targetMinutes: 60 * 60, adjustable: true,
      baseSchedule: { friday: [{ startMinutes: t("17:00"), endMinutes: t("21:30") }] },
    });
    const result = plan(kenzo, 2026, 9, [x]);
    expect(hours(result.shifts)).toBe(40); // 4 Freitage × 10 h
    expect(result.validation.errors.filter((e) => e.severity !== "warning")).toEqual([]);
  });

  it("höchstens 6 Tage am Stück, auch wenn der Laden 7 Tage offen hat", () => {
    const sevenDays: WorkHoursConfig = { ...kenzo.workHours, closedWeekdays: { ...kenzo.workHours.closedWeekdays, monday: false } };
    const every = Object.fromEntries(
      (["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const)
        .map((key) => [key, [{ startMinutes: t("17:00"), endMinutes: t("21:00") }]]),
    );
    const x = person({ targetMinutes: 200 * 60, baseSchedule: every });
    const shifts = generateSchedule({ year: 2026, month: 9, workHours: sevenDays, employees: [x] });
    expect(maxConsecutiveRun(new Set(shifts.map((s) => s.date)))).toBeLessThanOrEqual(6);
  });

  it("Eintritt mitten im Monat: vorher kein Dienst", () => {
    const x = person({ targetMinutes: 20 * 60, startDate: "2026-09-15", baseSchedule: { friday: [{ startMinutes: t("17:00"), endMinutes: t("21:00") }] } });
    const shifts = plan(kenzo, 2026, 9, [x]).shifts;
    expect(shifts.every((s) => s.date >= "2026-09-15")).toBe(true);
  });
});

describe("normalizeEmployee", () => {
  it("wirft kaputte Blöcke und alte Felder weg", () => {
    const raw = {
      id: "a", name: "A", employmentType: "WHATEVER", targetMinutes: 600.4, fixedShift: { startMinutes: 1, endMinutes: 2 },
      baseSchedule: { monday: [{ startMinutes: 900, endMinutes: 800 }, { startMinutes: 1020, endMinutes: 1260 }], tuesday: "x" },
    } as unknown as Employee;
    const clean = normalizeEmployee(raw);
    expect(clean).toEqual({
      id: "a", name: "A", employmentType: "TEILZEIT", targetMinutes: 600, adjustable: false,
      baseSchedule: { monday: [{ startMinutes: 1020, endMinutes: 1260 }] },
    });
  });
});
