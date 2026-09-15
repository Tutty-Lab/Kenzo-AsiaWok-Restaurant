import { useMemo, useState } from "react";
import type { UseScheduleReturn } from "../hooks/useSchedule";
import type { BaseSchedule, Employee, EmploymentType } from "../types";
import { WEEKDAY_SHORT_VI, type WeekdayKey } from "../lib/demand";
import { baseMinutesOn, baseMinutesPerWeek, monthlyTargetMinutesFor } from "../lib/contract";
import { employmentLabelVi, employmentShortVi } from "../lib/employment";
import { minutesToShortHours, minutesToTime, timeToMinutes } from "../lib/time";
import { effectiveWeekdayKey, type DayWindow, type WorkHoursConfig } from "../lib/workHours";
import { publicHolidays } from "../lib/holidays";
import { hasStarted } from "../lib/availability";

const inputClass =
  "rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500";

const WEEKDAY_ORDER: WeekdayKey[] = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

type BlockDraft = { start: string; end: string };

/**
 * Entwurf, während im Blatt getippt wird. Die Stunden sind ein STRING, damit
 * man das Feld leeren und „43,5" mit Komma tippen kann.
 */
type Draft = {
  name: string;
  employmentType: EmploymentType;
  unit: "week" | "month";
  hours: string;
  adjustable: boolean;
  base: Record<WeekdayKey, BlockDraft[]>;
  startDate: string; // "yyyy-MM-dd" hoặc "" = từ đầu tháng
};

const hoursText = (value: number) => String(Math.round(value * 100) / 100).replace(".", ",");

function parseHours(text: string): number {
  const value = Number(text.trim().replace(",", "."));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function draftFrom(emp?: Employee): Draft {
  const base = Object.fromEntries(
    WEEKDAY_ORDER.map((key) => [
      key,
      (emp?.baseSchedule?.[key] ?? []).map((b) => ({ start: minutesToTime(b.startMinutes), end: minutesToTime(b.endMinutes) })),
    ]),
  ) as Record<WeekdayKey, BlockDraft[]>;
  const weekly = emp?.weeklyHours != null;
  return {
    name: emp?.name ?? "",
    employmentType: emp?.employmentType ?? "TEILZEIT",
    unit: weekly ? "week" : "month",
    hours: emp ? hoursText(weekly ? emp.weeklyHours! : emp.targetMinutes / 60) : "",
    adjustable: emp?.adjustable ?? false,
    base,
    startDate: emp?.startDate ?? "",
  };
}

function windowOf(block: BlockDraft): DayWindow | null {
  try {
    const startMinutes = timeToMinutes(block.start);
    const endMinutes = timeToMinutes(block.end);
    return endMinutes > startMinutes ? { startMinutes, endMinutes } : null;
  } catch {
    return null;
  }
}

/** Entwurf -> Mitarbeiter-Felder (ohne id). */
function draftToEmployee(d: Draft): Omit<Employee, "id"> {
  const hours = parseHours(d.hours);
  const baseSchedule: BaseSchedule = {};
  for (const key of WEEKDAY_ORDER) {
    const blocks = d.base[key].map(windowOf).filter((b): b is DayWindow => b !== null);
    if (blocks.length > 0) baseSchedule[key] = blocks.sort((a, b) => a.startMinutes - b.startMinutes);
  }
  return {
    name: d.name.trim() || "Nhân viên mới",
    employmentType: d.employmentType,
    targetMinutes: d.unit === "month" ? Math.round(hours * 60) : 0,
    ...(d.unit === "week" ? { weeklyHours: hours } : {}),
    ...(Object.keys(baseSchedule).length > 0 ? { baseSchedule } : {}),
    adjustable: d.adjustable,
    // Leeres Feld = von Monatsanfang an dabei (kein Eintrittsdatum).
    ...(/^\d{4}-\d{2}-\d{2}$/.test(d.startDate) ? { startDate: d.startDate } : {}),
  };
}

const blocksLabel = (blocks: DayWindow[]) =>
  blocks.map((b) => `${minutesToTime(b.startMinutes)}–${minutesToTime(b.endMinutes)}`).join(" + ");

/** "T3–T6 16:00–21:00 · T7–CN 11:00–14:30 + 17:00–22:00" – gleiche Nachbartage zusammengefasst. */
export function baseScheduleSummary(base: BaseSchedule | undefined): string {
  const groups: { from: WeekdayKey; to: WeekdayKey; label: string }[] = [];
  for (const key of WEEKDAY_ORDER) {
    const blocks = base?.[key] ?? [];
    if (blocks.length === 0) continue;
    const label = blocksLabel(blocks);
    const last = groups[groups.length - 1];
    const previousDay = WEEKDAY_ORDER[WEEKDAY_ORDER.indexOf(key) - 1];
    if (last && last.label === label && last.to === previousDay) last.to = key;
    else groups.push({ from: key, to: key, label });
  }
  return groups
    .map((g) => `${WEEKDAY_SHORT_VI[g.from]}${g.from === g.to ? "" : `–${WEEKDAY_SHORT_VI[g.to]}`} ${g.label}`)
    .join(" · ");
}

/** Bezahlte Minuten des Grundplans an den offenen Tagen dieses Monats (Feiertag = Sonntag). */
function baseMinutesInMonth(emp: Omit<Employee, "id">, openDates: readonly string[], year: number): number {
  const holidays = publicHolidays(year);
  const withId = { ...emp, id: "preview" };
  return openDates
    .filter((date) => hasStarted(withId, date))
    .reduce((sum, date) => sum + baseMinutesOn(withId, effectiveWeekdayKey(date, holidays)), 0);
}

export function EmployeesTab({ store }: { store: UseScheduleReturn }) {
  const { schedule, openDates, addEmployee, updateEmployee, removeEmployee, storeConfig } = store;
  const locked = Boolean(schedule.lockedAt);

  // null = zu; "new" = anlegen; sonst = die id, die bearbeitet wird.
  const [offen, setOffen] = useState<null | "new" | string>(null);
  const bearbeitet = useMemo(
    () =>
      typeof offen === "string" && offen !== "new"
        ? schedule.employees.find((e) => e.id === offen)
        : undefined,
    [offen, schedule.employees],
  );

  return (
    <section className="rounded-lg bg-white border border-slate-200 p-4 sm:p-5 shadow-sm">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-base font-semibold text-slate-900">
          Nhân viên · {storeConfig.shortName}
          {schedule.employees.length > 0 && (
            <span className="ml-2 text-sm font-normal text-slate-400">{schedule.employees.length}</span>
          )}
        </h2>
        <button
          onClick={() => setOffen("new")}
          disabled={locked}
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 active:bg-slate-800 disabled:opacity-40"
        >
          + Thêm
        </button>
      </div>
      <p className="text-xs text-slate-500 mb-4">
        Mỗi người có <b>lịch cơ bản</b> theo thứ. Lịch tạo ra theo đúng lịch đó rồi chỉnh cho khớp hợp đồng
        (theo tuần hoặc theo tháng): thừa thì cắt bớt, thiếu thì kéo dài ca nếu bật <b>Được điều chỉnh</b>.
        Bấm vào một người để sửa.
      </p>

      {locked && (
        <div className="mb-3 rounded bg-amber-50 border border-amber-200 text-amber-900 text-sm px-3 py-2">
          Lịch tháng này đã khoá vì đã in — mở khoá ở tab <b>Bảng chấm công</b> để sửa nhân viên.
        </div>
      )}

      {schedule.employees.length === 0 ? (
        <div className="py-8 text-center text-slate-400">
          Chưa có nhân viên. Bấm <b>+ Thêm</b> để tạo.
        </div>
      ) : (
        <ul className="space-y-2">
          {schedule.employees.map((emp) => (
            <li key={emp.id}>
              <button
                onClick={() => setOffen(emp.id)}
                className="w-full text-left rounded-lg border border-slate-200 p-3 flex items-center gap-3 hover:bg-slate-50 active:bg-slate-100 transition-colors"
              >
                <EmployeeSummaryRow emp={emp} openDates={openDates} workHours={schedule.workHours} year={schedule.year} />
                <span className="text-slate-300 text-lg leading-none">›</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {!locked && (
        <button
          onClick={() => setOffen("new")}
          aria-label="Thêm nhân viên"
          className="sm:hidden fixed bottom-5 right-5 z-40 h-14 w-14 rounded-full bg-slate-900 text-white text-2xl shadow-lg active:bg-slate-700 flex items-center justify-center"
        >
          +
        </button>
      )}

      {offen !== null && !locked && (
        <EmployeeSheet
          key={bearbeitet?.id ?? "new"}
          employee={bearbeitet}
          openDates={openDates}
          workHours={schedule.workHours}
          year={schedule.year}
          onClose={() => setOffen(null)}
          onSave={(felder) => {
            if (bearbeitet) updateEmployee(bearbeitet.id, felder);
            else addEmployee(felder);
            setOffen(null);
          }}
          onDelete={
            bearbeitet
              ? () => {
                  removeEmployee(bearbeitet.id);
                  setOffen(null);
                }
              : undefined
          }
        />
      )}
    </section>
  );
}

/** Kompakte Zeile in der Liste: Name, Art, Vertrag, Grundplan. */
function EmployeeSummaryRow({
  emp,
  openDates,
  workHours,
  year,
}: {
  emp: Employee;
  openDates: readonly string[];
  workHours: WorkHoursConfig;
  year: number;
}) {
  const sollMin = monthlyTargetMinutesFor(emp, openDates, workHours);
  const baseMonth = baseMinutesInMonth(emp, openDates, year);
  const hasBase = baseMinutesPerWeek(emp) > 0;
  const short = hasBase && !emp.adjustable && baseMonth < sollMin;

  return (
    <div className="flex-1 min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-slate-900 truncate">{emp.name}</span>
        <span className="shrink-0 rounded bg-slate-100 text-slate-600 text-[11px] px-1.5 py-0.5">
          {employmentShortVi(emp.employmentType)}
        </span>
        <span className={`shrink-0 rounded text-[11px] px-1.5 py-0.5 ${emp.adjustable ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
          {emp.adjustable ? "được điều chỉnh" : "giữ khung"}
        </span>
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
        <span>
          {emp.weeklyHours != null ? `${hoursText(emp.weeklyHours)}h/tuần` : `${hoursText(emp.targetMinutes / 60)}h/tháng`}
          {" · tháng này "}{minutesToShortHours(sollMin)}
        </span>
        {hasBase && (
          <span className={short ? "text-amber-700" : ""}>
            · lịch cơ bản {minutesToShortHours(baseMinutesPerWeek(emp))}/tuần, tháng này {minutesToShortHours(baseMonth)}
            {short && " (thiếu)"}
          </span>
        )}
      </div>
      <div className="mt-0.5 text-xs text-slate-600">
        {hasBase ? baseScheduleSummary(emp.baseSchedule) : <span className="text-amber-700">Chưa có lịch cơ bản — xếp theo giờ mở cửa</span>}
      </div>
    </div>
  );
}

/**
 * Ein Blatt zum Anlegen ODER Bearbeiten – auf dem Handy von unten, am Desktop
 * mittig. Alle Felder an einem Ort, statt in der Liste zu suchen.
 */
function EmployeeSheet({
  employee,
  openDates,
  workHours,
  year,
  onClose,
  onSave,
  onDelete,
}: {
  employee?: Employee;
  openDates: readonly string[];
  workHours: WorkHoursConfig;
  year: number;
  onClose: () => void;
  onSave: (felder: Omit<Employee, "id">) => void;
  onDelete?: () => void;
}) {
  const [d, setD] = useState<Draft>(() => draftFrom(employee));
  const [loeschFrage, setLoeschFrage] = useState(false);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) =>
    setD((prev) => ({ ...prev, [k]: v }));
  const setBlocks = (key: WeekdayKey, blocks: BlockDraft[]) =>
    setD((prev) => ({ ...prev, base: { ...prev.base, [key]: blocks } }));

  const preview = draftToEmployee(d);
  const sollMin = monthlyTargetMinutesFor({ ...preview, id: employee?.id ?? "preview" }, openDates, workHours);
  const baseWeek = baseMinutesPerWeek({ ...preview, id: "preview" });
  const baseMonth = baseMinutesInMonth(preview, openDates, year);
  const invalidBlocks = WEEKDAY_ORDER.some((key) => d.base[key].some((b) => windowOf(b) === null));

  /** Neuer Block: nächster Öffnungsblock dieses Tages, sonst 17:00–21:00. */
  function addBlock(key: WeekdayKey) {
    const existing = d.base[key];
    const open = workHours.perWeekday[key][existing.length];
    const block = open
      ? { start: minutesToTime(open.startMinutes), end: minutesToTime(open.endMinutes) }
      : { start: "17:00", end: "21:00" };
    setBlocks(key, [...existing, block]);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-lg max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-lg bg-white shadow-xl border border-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between">
          <h3 className="font-semibold text-slate-900">{employee ? "Sửa nhân viên" : "Thêm nhân viên"}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none" aria-label="Đóng">
            ✕
          </button>
        </div>

        <div className="px-4 py-3 space-y-4">
          <label className="block">
            <span className="text-xs text-slate-600">Tên</span>
            <input
              autoFocus={!employee}
              className={`${inputClass} w-full mt-1`}
              value={d.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Tên nhân viên"
            />
          </label>

          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className="text-xs text-slate-600">Hình thức</span>
              <select
                className={`${inputClass} w-full mt-1`}
                value={d.employmentType}
                onChange={(e) => set("employmentType", e.target.value as EmploymentType)}
              >
                <option value="VOLLZEIT">{employmentLabelVi("VOLLZEIT")}</option>
                <option value="TEILZEIT">{employmentLabelVi("TEILZEIT")}</option>
                <option value="MINIJOB">{employmentLabelVi("MINIJOB")}</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-slate-600">Hợp đồng theo</span>
              <select
                className={`${inputClass} w-full mt-1`}
                value={d.unit}
                onChange={(e) => set("unit", e.target.value as Draft["unit"])}
              >
                <option value="week">Tuần</option>
                <option value="month">Tháng</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-slate-600">Số giờ</span>
              <input
                inputMode="decimal"
                className={`${inputClass} w-full mt-1`}
                value={d.hours}
                onChange={(e) => set("hours", e.target.value)}
                placeholder={d.unit === "week" ? "VD 40" : "VD 43,5"}
              />
            </label>
          </div>
          <div className="text-xs text-slate-500">
            Tháng này: định mức <b>{minutesToShortHours(sollMin)}</b> · lịch cơ bản{" "}
            <b className={baseMonth < sollMin && !d.adjustable ? "text-amber-700" : ""}>{minutesToShortHours(baseMonth)}</b>
            {baseWeek > 0 && <> ({minutesToShortHours(baseWeek)}/tuần)</>}
            {baseMonth > sollMin && " — sẽ cắt bớt ngày ít ưu tiên"}
            {baseMonth < sollMin && (d.adjustable ? " — sẽ kéo dài ca, ưu tiên tối T6–CN" : " — sẽ báo thiếu giờ")}
          </div>

          <label className="flex items-start gap-2 text-sm text-slate-700 cursor-pointer select-none">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={d.adjustable}
              onChange={(e) => set("adjustable", e.target.checked)}
            />
            <span>
              Được điều chỉnh để đủ giờ
              <span className="block text-xs text-slate-500">
                Kéo dài ca theo bước 30′, tối đa 60′ trước giờ mở và 30′ sau giờ đóng. Không bật = giữ đúng khung, thiếu thì báo.
              </span>
            </span>
          </label>

          {/* Lịch cơ bản theo thứ – mỗi ngày có thể 2 ca (trưa + tối). */}
          <div className="rounded-lg border border-slate-200">
            <div className="border-b border-slate-100 px-3 py-2 text-sm font-medium text-slate-700">Lịch cơ bản</div>
            <div className="divide-y divide-slate-100">
              {WEEKDAY_ORDER.map((key) => {
                const blocks = d.base[key];
                const closed = workHours.closedWeekdays[key];
                return (
                  <div key={key} className="flex items-start gap-2 px-3 py-2">
                    <div className="w-10 shrink-0 pt-1.5">
                      <div className={`text-sm font-medium ${closed ? "text-slate-400" : "text-slate-700"}`}>{WEEKDAY_SHORT_VI[key]}</div>
                      {closed && <div className="text-[10px] leading-tight text-slate-400">quán nghỉ</div>}
                    </div>
                    <div className="flex-1 space-y-1">
                      {blocks.length === 0 && <div className="pt-1.5 text-xs text-slate-400">Nghỉ</div>}
                      {blocks.map((block, index) => (
                        <div key={index} className="flex items-center gap-1.5">
                          <input
                            type="time"
                            className={`${inputClass} min-w-0 flex-1 sm:flex-none`}
                            value={block.start}
                            onChange={(e) => setBlocks(key, blocks.map((b, i) => (i === index ? { ...b, start: e.target.value } : b)))}
                          />
                          <span className="text-slate-400">–</span>
                          <input
                            type="time"
                            className={`${inputClass} min-w-0 flex-1 sm:flex-none`}
                            value={block.end}
                            onChange={(e) => setBlocks(key, blocks.map((b, i) => (i === index ? { ...b, end: e.target.value } : b)))}
                          />
                          <button
                            type="button"
                            onClick={() => setBlocks(key, blocks.filter((_, i) => i !== index))}
                            className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50"
                            aria-label={`Xoá ca ${WEEKDAY_SHORT_VI[key]}`}
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                      {blocks.some((b) => windowOf(b) === null) && (
                        <div className="text-xs text-rose-600">Giờ ra phải sau giờ vào.</div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => addBlock(key)}
                      disabled={blocks.length >= 2}
                      className="shrink-0 rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-30"
                    >
                      + Ca
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Ngày vào làm (Eintritt) – vào giữa tháng thì không bị báo thiếu giờ. */}
          <label className="block">
            <span className="text-xs text-slate-600">Ngày vào làm</span>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="date"
                className={inputClass}
                value={d.startDate}
                onChange={(e) => set("startDate", e.target.value)}
              />
              {d.startDate && (
                <button type="button" onClick={() => set("startDate", "")} className="text-xs text-slate-500 hover:text-slate-700 underline">
                  Xoá
                </button>
              )}
            </div>
            <span className="mt-1 block text-xs text-slate-400">
              Bỏ trống = làm từ đầu tháng. Các ngày trước ngày vào làm không xếp ca.
            </span>
          </label>
        </div>

        <div className="sticky bottom-0 bg-white border-t border-slate-200 px-4 py-3">
          {loeschFrage ? (
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-slate-600">Xoá nhân viên này?</span>
              <div className="flex gap-2">
                <button onClick={() => setLoeschFrage(false)} className="rounded px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">
                  Không
                </button>
                <button onClick={onDelete} className="rounded bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700">
                  Xoá
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              {onDelete ? (
                <button onClick={() => setLoeschFrage(true)} className="text-rose-600 hover:text-rose-800 text-sm font-medium">
                  Xoá
                </button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <button onClick={onClose} className="rounded px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
                  Huỷ
                </button>
                <button
                  onClick={() => onSave(preview)}
                  disabled={invalidBlocks || parseHours(d.hours) <= 0}
                  className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-40"
                >
                  Lưu
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
