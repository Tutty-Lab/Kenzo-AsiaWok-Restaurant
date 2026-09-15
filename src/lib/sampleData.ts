// ============================================================================
// Startbelegschaft beider Filialen laut Angabe des Betriebs (September 2026).
//
// Nguyễn Duy Hậu steht in BEIDEN Listen – laut Betrieb zwei verschiedene
// Personen mit gleichem Namen. Es gibt deshalb keine filialübergreifende Prüfung.
// ============================================================================

import type { BaseSchedule, Employee } from "../types";
import type { WeekdayKey } from "./demand";
import type { DayWindow } from "./workHours";

/** "17:30" -> 1050 */
const t = (value: string): number => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
const block = (from: string, to: string): DayWindow => ({ startMinutes: t(from), endMinutes: t(to) });

/** Gleiche Dienste für mehrere Wochentage. */
function days(keys: WeekdayKey[], blocks: DayWindow[]): BaseSchedule {
  return Object.fromEntries(keys.map((key) => [key, blocks.map((b) => ({ ...b }))]));
}

/**
 * KENZO Asia Kitchen & Sushi Lounge, Hauptstraße 19, 34414 Warburg.
 *
 * ANNAHMEN, die der Betrieb bestätigen sollte:
 *   - Hiếu Di–Mi „17:00–20:30 hoặc 21:00": Grundplan bis 20:30, der Scheduler
 *     verlängert bis 21:00, wenn Stunden fehlen.
 *   - Ahmad „chủ yếu T6, T7, CN buổi tối" ohne Uhrzeit: Rahmen 18:00–21:00.
 */
export function kenzoEmployees(): Employee[] {
  return [
    {
      id: "kz-1",
      name: "Nguyễn Duy Hậu",
      employmentType: "VOLLZEIT",
      targetMinutes: 0,
      weeklyHours: 40,
      adjustable: true,
      baseSchedule: {
        ...days(["tuesday", "wednesday", "thursday", "friday"], [block("16:00", "21:00")]),
        ...days(["saturday", "sunday"], [block("11:00", "14:30"), block("17:00", "22:00")]),
      },
    },
    {
      id: "kz-2",
      name: "Phương Văn Trọng Hiếu",
      employmentType: "TEILZEIT",
      targetMinutes: 120 * 60,
      adjustable: true,
      baseSchedule: {
        ...days(["tuesday", "wednesday"], [block("17:00", "20:30")]),
        ...days(["thursday", "friday"], [block("17:00", "21:00")]),
        ...days(["saturday", "sunday"], [block("12:00", "14:00"), block("17:00", "21:00")]),
      },
    },
    {
      id: "kz-3",
      name: "Ahmad Zia Omami",
      employmentType: "MINIJOB",
      targetMinutes: 11 * 60,
      adjustable: false,
      baseSchedule: days(["friday", "saturday", "sunday"], [block("18:00", "21:00")]),
    },
  ];
}

/**
 * Asia Wok Warburg, Paderborner Tor 126a, 34414 Warburg.
 *
 * Ngự „17:00–18:30 hoặc 19:00", Rahmen bleibt (Betrieb: „Giữ khung, chấp nhận
 * thiếu"): Grundplan bis 19:00, die fehlenden Stunden erscheinen als Warnung.
 */
export function asiaWokEmployees(): Employee[] {
  return [
    {
      id: "aw-1",
      name: "Nguyễn Duy Hậu",
      employmentType: "MINIJOB",
      targetMinutes: 40 * 60,
      adjustable: false,
      baseSchedule: days(["monday", "tuesday", "wednesday", "thursday", "friday"], [block("12:00", "14:00")]),
    },
    {
      id: "aw-2",
      name: "Bùi Xuân Ngự",
      employmentType: "MINIJOB",
      targetMinutes: 43 * 60,
      adjustable: false,
      baseSchedule: days(["thursday", "friday", "saturday"], [block("17:00", "19:00")]),
    },
  ];
}
