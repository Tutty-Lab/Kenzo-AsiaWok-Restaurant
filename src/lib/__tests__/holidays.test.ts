import { describe, expect, it } from "vitest";
import { easterSunday, publicHolidays, publicHolidayNames } from "../holidays";
import { ASIA_WOK_WORK_HOURS, KENZO_WORK_HOURS, resolveDay } from "../workHours";
import { format } from "date-fns";

describe("Feiertage (NRW, Warburg)", () => {
  it("berechnet Ostersonntag korrekt", () => {
    expect(format(easterSunday(2026), "yyyy-MM-dd")).toBe("2026-04-05");
    expect(format(easterSunday(2024), "yyyy-MM-dd")).toBe("2024-03-31");
  });

  it("enthält die festen und beweglichen NRW-Feiertage 2026", () => {
    const h = publicHolidays(2026);
    expect(h.has("2026-01-01")).toBe(true); // Neujahr
    expect(h.has("2026-04-03")).toBe(true); // Karfreitag
    expect(h.has("2026-04-06")).toBe(true); // Ostermontag
    expect(h.has("2026-05-01")).toBe(true); // Tag der Arbeit
    expect(h.has("2026-05-14")).toBe(true); // Christi Himmelfahrt
    expect(h.has("2026-05-25")).toBe(true); // Pfingstmontag
    expect(h.has("2026-06-04")).toBe(true); // Fronleichnam
    expect(h.has("2026-10-03")).toBe(true); // Deutsche Einheit
    expect(h.has("2026-11-01")).toBe(true); // Allerheiligen
    expect(h.has("2026-12-25")).toBe(true);
    expect(h.has("2026-12-26")).toBe(true);
    expect(h.size).toBe(11);
  });

  it("enthält KEINE Feiertage anderer Bundesländer", () => {
    const h = publicHolidays(2026);
    expect(h.has("2026-01-06")).toBe(false); // Heilige Drei Könige – BW/BY/ST
    expect(h.has("2026-08-15")).toBe(false); // Mariä Himmelfahrt – BY/SL
    expect(h.has("2026-10-31")).toBe(false); // Reformationstag
    expect(h.has("2026-11-18")).toBe(false); // Buß- und Bettag – SN
  });

  it("Set und Namen bleiben deckungsgleich", () => {
    for (const year of [2024, 2026, 2027]) {
      expect(publicHolidays(year).size).toBe(publicHolidayNames(year).size);
    }
  });
});

describe("Öffnung an Feiertagen", () => {
  const holidays = publicHolidays(2026);

  it("Kenzo hat an einem Feiertag wie sonntags offen", () => {
    // 25.12.2026 ist ein Freitag.
    const day = resolveDay(KENZO_WORK_HOURS, "2026-12-25", holidays);
    expect(day.closed).toBe(false);
    expect(day.blocks).toEqual(KENZO_WORK_HOURS.holiday);
  });

  it("Kenzo bleibt an einem Montagsfeiertag zu (Ruhetag)", () => {
    expect(resolveDay(KENZO_WORK_HOURS, "2026-04-06", holidays).closed).toBe(true);
  });

  it("Asia Wok hat an Feiertagen und sonntags zu", () => {
    expect(resolveDay(ASIA_WOK_WORK_HOURS, "2026-10-03", holidays).closed).toBe(true); // Samstag, Feiertag
    expect(resolveDay(ASIA_WOK_WORK_HOURS, "2026-10-04", holidays).closed).toBe(true); // Sonntag
    expect(resolveDay(ASIA_WOK_WORK_HOURS, "2026-10-05", holidays).closed).toBe(false); // Montag
  });

  it("eine Datumsausnahme mit eigenen Zeiten öffnet auch einen Feiertag", () => {
    const day = resolveDay(ASIA_WOK_WORK_HOURS, "2026-10-03", holidays, {
      "2026-10-03": { date: "2026-10-03", closed: false, window: { startMinutes: 660, endMinutes: 900 } },
    });
    expect(day.closed).toBe(false);
  });
});
