// ============================================================================
// Die Filialen, die dieses Repo bedient. Umschalten passiert in der Kopfzeile;
// jede Filiale hat ihre eigene Zeile in der gemeinsamen Supabase-Tabelle
// (Schlüssel = id), eigene Öffnungszeiten und eigene Besetzungsregeln.
// ============================================================================

import type { Employee, Schedule } from "../types";
import { asiaWokEmployees, kenzoEmployees } from "./sampleData";
import { clip, type StaffingRule } from "./staffing";
import { ASIA_WOK_WORK_HOURS, KENZO_WORK_HOURS, type WorkHoursConfig } from "./workHours";

export type StoreConfig = {
  /** Schlüssel der Zeile in store_data – nach dem Anlegen NICHT mehr ändern. */
  id: string;
  name: string;
  /** Kurzname für den Umschalter. */
  shortName: string;
  address: string;
  workHours: WorkHoursConfig;
  /** Besetzungsregeln für Độ phủ und Warnungen. Leer = nur anzeigen, nicht prüfen. */
  staffingRules: readonly StaffingRule[];
  /** Belegschaft beim allerersten Öffnen. */
  sampleEmployees: () => Employee[];
};

export const STORES: StoreConfig[] = [
  {
    id: "kenzo",
    name: "KENZO Asia Kitchen & Sushi Lounge",
    shortName: "Kenzo",
    address: "Hauptstraße 19, 34414 Warburg",
    workHours: KENZO_WORK_HOURS,
    // Betrieb: „đông nhất T6, T7, CN; ưu tiên nhiều nhân viên ca tối 3 ngày này".
    // Fr–So abends (und geöffnete Feiertage, die wie Sonntag zählen) mindestens
    // zwei; dort verlängert der Scheduler auch zuerst (baseScheduler.ts).
    staffingRules: [
      {
        label: "Tối T6–CN",
        when: "18:00–21:00 thứ Sáu, thứ Bảy, Chủ nhật và ngày lễ",
        minStaff: 2,
        maxStaff: Infinity,
        weekdays: ["friday", "saturday", "sunday"],
        windows: clip(18 * 60, 21 * 60),
      },
    ],
    sampleEmployees: kenzoEmployees,
  },
  {
    id: "asiawok",
    name: "Asia Wok Warburg",
    shortName: "Asia Wok",
    address: "Paderborner Tor 126a, 34414 Warburg",
    workHours: ASIA_WOK_WORK_HOURS,
    // Keine Mindestbesetzung vorgegeben – der Bericht zeigt nur, wer da ist.
    staffingRules: [],
    sampleEmployees: asiaWokEmployees,
  },
];

export const DEFAULT_STORE_ID = STORES[0].id;

/** Merkt sich die zuletzt gewählte Filiale auf diesem Gerät. */
const STORE_KEY = "stundenzettel-app:store";

export function loadStoreId(): string {
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved && STORES.some((s) => s.id === saved)) return saved;
  } catch {
    /* ignorieren */
  }
  return DEFAULT_STORE_ID;
}

export function saveStoreId(id: string): void {
  try {
    localStorage.setItem(STORE_KEY, id);
  } catch {
    /* ignorieren */
  }
}

export function storeById(id: string): StoreConfig {
  return STORES.find((s) => s.id === id) ?? STORES[0];
}

/** Startstand einer Filiale: September 2026 mit der Belegschaft aus der Angabe. */
export function initialScheduleFor(store: StoreConfig): Schedule {
  return {
    companyName: store.name,
    address: store.address,
    year: 2026,
    month: 9,
    workHours: structuredClone(store.workHours),
    dateOverrides: [],
    employees: store.sampleEmployees(),
    shifts: [],
  };
}
