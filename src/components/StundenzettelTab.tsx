import { useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { UseScheduleReturn } from "../hooks/useSchedule";
import type { Employee } from "../types";
import { StundenzettelPage } from "./StundenzettelPage";
import { SchedulePrintPage, type SchedulePrintLayout } from "./SchedulePrintPage";
import { elementsToPdf, safeFileName, sharePdf } from "../lib/pdf";
import { chromeIntentUrl, detectInAppBrowser } from "../lib/inAppBrowser";
import { isScheduleYearAllowed, SCHEDULE_YEAR_RANGE_LABEL } from "../lib/years";
import { weeksOfMonth } from "../lib/weeks";
import { datesOfMonth } from "../lib/demand";
import { monthLabel } from "../lib/shiftOps";

/** Dienstplan-Ausdruck (Monat oder eine Woche). */
type ScheduleRange = {
  dates: string[];
  title: string;
  layout: SchedulePrintLayout;
  /** Gesetzt bei einer Woche: nach dem Ausgeben werden BEIDE Filialen gesperrt. */
  weekStart?: string;
};

/** Was gerade auf die PDF-Bühne gerendert wird (für BEIDE Filialen). */
type PdfJob =
  | { kind: "stundenzettel"; szDates?: string[]; szLabel?: string }
  | { kind: "schedule"; range: ScheduleRange };

export function StundenzettelTab({ stores }: { stores: UseScheduleReturn[] }) {
  // Beide Filialen laufen im selben Monat (Kopf steuert beide). Monat/Wochen
  // kommen deshalb aus der ersten Filiale.
  const primary = stores[0];
  const { schedule } = primary;
  const anyLocked = stores.some((s) => s.isLocked);
  const lockedStamp = stores.map((s) => s.schedule.lockedAt).find(Boolean);

  const unlockAll = () => {
    for (const s of stores) if (s.isLocked) s.unlockMonth();
  };
  const regenerateAll = () => {
    for (const s of stores) {
      if (s.isLocked) s.unlockMonth();
      s.generate();
    }
  };

  // Trình duyệt nhúng (Zalo, Messenger, Facebook …) không lưu được file tải thẳng.
  const inApp = useMemo(
    () => detectInAppBrowser(typeof navigator === "undefined" ? "" : navigator.userAgent),
    [],
  );
  const pageUrl = typeof window === "undefined" ? "" : window.location.href;
  const chromeUrl = inApp.platform === "android" ? chromeIntentUrl(pageUrl) : null;

  // ── Auswahl: WER und WAS ────────────────────────────────────────────────
  // who: "all" = alle Mitarbeiter beider Filialen, sonst "<storeId>:<empId>".
  const [who, setWho] = useState<string>("all");
  // what: "stundenzettel" | "sz-<weekStart>" | "month" | "<weekStart>".
  const [what, setWhat] = useState<string>("stundenzettel");

  const weeks = useMemo(
    () => weeksOfMonth(schedule.year, schedule.month),
    [schedule.year, schedule.month],
  );

  // PDF-Bühne.
  const [pdfJob, setPdfJob] = useState<PdfJob | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfProgress, setPdfProgress] = useState<string>("");
  const pdfStage = useRef<HTMLDivElement>(null);
  /** Lỗi tạo PDF – hiện ngay trên trang (alert bị trình duyệt nhúng chặn). */
  const [pdfError, setPdfError] = useState<string | null>(null);
  /** Trình duyệt nhúng: PDF đã tạo xong, chờ người dùng bấm Lưu / Chia sẻ. */
  const [readyPdf, setReadyPdf] = useState<{ blob: Blob; filename: string } | null>(null);
  const [shareNote, setShareNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  /** Zweiter Klick für das Entsperren – ohne native Dialoge. */
  const [confirmUnlock, setConfirmUnlock] = useState(false);

  const monthTag = `${schedule.year}-${String(schedule.month).padStart(2, "0")}`;

  // ── WER auflösen ─────────────────────────────────────────────────────────
  const parsedWho = who === "all" ? null : who.split(":");
  const whoStoreId = parsedWho?.[0];
  const whoEmpId = parsedWho?.[1];

  /** Mitarbeiter dieser Filiale, die in den Stundenzettel-Ausdruck kommen. */
  const chosenFor = (store: UseScheduleReturn): Employee[] => {
    if (who === "all") return store.schedule.employees;
    if (store.storeId !== whoStoreId) return [];
    return store.schedule.employees.filter((e) => e.id === whoEmpId);
  };

  /** employeeIds für den Dienstplan-Ausdruck: undefined = ganze Filiale. */
  const employeeIdsFor = (store: UseScheduleReturn): string[] | undefined => {
    if (who === "all") return undefined;
    if (store.storeId !== whoStoreId) return []; // diese Filiale nicht betroffen
    return [whoEmpId as string];
  };

  // Vorschau + Dateiname: eine konkrete Person (oder die erste im „all"-Fall).
  const previewStore = who === "all" ? primary : stores.find((s) => s.storeId === whoStoreId) ?? primary;
  const previewEmployee =
    who === "all"
      ? previewStore.schedule.employees[0] ?? null
      : previewStore.schedule.employees.find((e) => e.id === whoEmpId) ?? null;
  const whoTag = who === "all" ? "tat_ca" : safeFileName(previewEmployee?.name ?? whoEmpId ?? who);

  const startPdf = () => {
    setPdfBusy(true);
    setPdfError(null);
    setReadyPdf(null);
    setShareNote(null);
  };
  const progress = (current: number, total: number) => {
    if (total > 1) setPdfProgress(`${current}/${total}`);
  };
  /** Rechner/Chrome/Safari: đã tải thẳng. Trình duyệt nhúng: giữ file để bấm Lưu / Chia sẻ. */
  const finishPdf = (blob: Blob | null, filename: string) => {
    if (inApp.inApp && blob) setReadyPdf({ blob, filename });
  };
  const errorText = (err: unknown) =>
    `Không tạo được PDF: ${err instanceof Error ? err.message : String(err)}`;

  /** Sau khi flushSync dựng xong sân khấu, gom mọi trang của cả 2 quán ra 1 PDF. */
  async function renderStageToPdf(filename: string) {
    const pages = Array.from(
      pdfStage.current?.querySelectorAll<HTMLElement>(".stundenzettel-page") ?? [],
    );
    return finishPdf(await elementsToPdf(pages, filename, progress, { download: !inApp.inApp }), filename);
  }

  /** Stundenzettel-PDF (Monat oder Woche) für beide Filialen. */
  async function doPdf(job: Extract<PdfJob, { kind: "stundenzettel" }>, filename: string) {
    const total = stores.reduce((n, s) => n + chosenFor(s).length, 0);
    if (total === 0 || pdfBusy) return;
    startPdf();
    setPdfProgress(total > 1 ? `1/${total}` : "");
    flushSync(() => setPdfJob(job));
    try {
      await renderStageToPdf(filename);
    } catch (err) {
      setPdfError(errorText(err));
    } finally {
      setPdfJob(null);
      setPdfBusy(false);
      setPdfProgress("");
    }
  }

  /** Dienstplan-PDF (Monat oder Woche) für beide Filialen. Eine Woche sperrt beide. */
  async function doPdfSchedule(range: ScheduleRange, filename: string) {
    if (range.dates.length === 0 || pdfBusy) return;
    startPdf();
    setPdfProgress("");
    flushSync(() => setPdfJob({ kind: "schedule", range }));
    try {
      await renderStageToPdf(filename);
      if (range.weekStart) for (const s of stores) s.markWeekPrinted(range.weekStart);
    } catch (err) {
      setPdfError(errorText(err));
    } finally {
      setPdfJob(null);
      setPdfBusy(false);
      setPdfProgress("");
    }
  }

  /** Gọi trực tiếp trong lúc bấm – bảng Chia sẻ cần thao tác người dùng còn "mới". */
  async function onSharePdf() {
    if (!readyPdf) return;
    const result = await sharePdf(readyPdf.blob, readyPdf.filename);
    if (result === "shared") {
      setReadyPdf(null);
      setShareNote(null);
    } else if (result !== "cancelled") {
      setShareNote(
        `${inApp.name ?? "Trình duyệt này"} không cho lưu hoặc chia sẻ file. Hãy mở app bằng trình duyệt (Chrome/Safari) rồi xuất lại.`,
      );
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(pageUrl);
      setCopied(true);
    } catch {
      setCopied(false);
      setShareNote("Không sao chép tự động được – hãy giữ tay vào ô link bên dưới để sao chép.");
    }
  }

  const openInBrowserHelp = (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {chromeUrl && (
          <a
            href={chromeUrl}
            className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
          >
            Mở bằng Chrome
          </a>
        )}
        <button
          type="button"
          onClick={() => void copyLink()}
          className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          {copied ? "Đã sao chép link" : "Sao chép link"}
        </button>
      </div>
      <p className="text-xs">
        {inApp.platform === "ios"
          ? "Hoặc bấm ⋯ ở góc trên → Mở trong Safari (hoặc trình duyệt), rồi xuất PDF lại."
          : "Hoặc bấm ⋮ ở góc trên → Mở bằng trình duyệt, rồi xuất PDF lại."}
      </p>
      <input
        readOnly
        value={pageUrl}
        onFocus={(e) => e.currentTarget.select()}
        className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-600"
        aria-label="Link của app"
      />
    </div>
  );

  // Was genau ist gewählt? Baut den passenden Dienstplan-Auftrag.
  function scheduleRangeFor(target: string): ScheduleRange | null {
    if (target === "month") {
      return {
        dates: datesOfMonth(schedule.year, schedule.month),
        title: monthLabel(schedule.year, schedule.month),
        // 31 Tagesspalten passen nicht hochkant auf A4.
        layout: "byDate",
      };
    }
    const w = weeks.find((x) => x.weekStart === target);
    if (!w) return null;
    return {
      dates: w.dates,
      title: `Woche ${w.label} · ${monthLabel(schedule.year, schedule.month)}`,
      // Leute untereinander, Tage nebeneinander – bei 7 Spalten gut auf Papier.
      layout: "byEmployee",
      weekStart: w.weekStart,
    };
  }

  // Wochen-Stundenzettel: nur die Tage dieser Woche, mit Wochentitel oben rechts.
  function szWeekFor(weekStart: string): { dates: string[]; label: string } | null {
    const w = weeks.find((x) => x.weekStart === weekStart);
    if (!w) return null;
    return { dates: w.dates, label: `Woche ${w.label}${schedule.year}` };
  }

  function onPdf() {
    if (what === "stundenzettel") {
      void doPdf({ kind: "stundenzettel" }, `Stundenzettel_${whoTag}_${monthTag}.pdf`);
      return;
    }
    if (what.startsWith("sz-")) {
      const weekStart = what.slice(3);
      const sz = szWeekFor(weekStart);
      if (sz) {
        void doPdf(
          { kind: "stundenzettel", szDates: sz.dates, szLabel: sz.label },
          `Stundenzettel_${whoTag}_${monthTag}_tuan_${weekStart}.pdf`,
        );
      }
      return;
    }
    const range = scheduleRangeFor(what);
    if (!range) return;
    const suffix = what === "month" ? "thang" : `tuan_${what}`;
    void doPdfSchedule(range, `Dienstplan_${whoTag}_${suffix}_${monthTag}.pdf`);
  }

  const allEmployees = stores.flatMap((s) => s.schedule.employees);
  if (allEmployees.length === 0) {
    return (
      <div className="no-print rounded bg-white border border-slate-200 p-6 text-center text-slate-400">
        Vui lòng thêm nhân viên và tạo lịch làm việc trước.
      </div>
    );
  }

  const hasSchedule = stores.some((s) => s.schedule.shifts.length > 0);

  return (
    <>
      {/* Điều khiển (không in) */}
      <div className="no-print">
        {/* ---- In & Xuất ---- */}
        <div className="rounded-lg border border-slate-200 bg-white p-3 mb-4">
          <div className="text-sm font-medium text-slate-700 mb-2">Xuất file PDF · cả 2 quán</div>

          {inApp.inApp && !readyPdf && (
            <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <div className="font-semibold">
                Bạn đang mở app trong {inApp.name}
              </div>
              <p className="mt-0.5 text-xs">
                Trình duyệt trong {inApp.name} không tải được file PDF thẳng về máy. Bạn vẫn có thể tạo
                PDF rồi bấm <b>Lưu / Chia sẻ PDF</b>; nếu máy không cho, hãy mở app bằng trình duyệt.
              </p>
              {openInBrowserHelp}
            </div>
          )}

          <div className="flex flex-wrap items-end gap-3">
            {/* WER */}
            <label className="flex w-full min-w-0 flex-col gap-1 sm:w-auto">
              <span className="text-xs text-slate-500">Cho ai</span>
              <select
                className="w-full max-w-full rounded border border-slate-300 px-2 py-2 text-sm sm:w-auto sm:min-w-[12rem]"
                value={who}
                onChange={(e) => setWho(e.target.value)}
              >
                <option value="all">Tất cả (cả 2 quán)</option>
                {stores.map((s) => (
                  <optgroup key={s.storeId} label={s.storeConfig.shortName}>
                    {s.schedule.employees.map((e) => (
                      <option key={`${s.storeId}:${e.id}`} value={`${s.storeId}:${e.id}`}>
                        {e.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>

            {/* WAS */}
            <label className="flex w-full min-w-0 flex-col gap-1 sm:w-auto">
              <span className="text-xs text-slate-500">Nội dung</span>
              <select
                className="w-full max-w-full rounded border border-slate-300 px-2 py-2 text-sm sm:w-auto sm:min-w-[14rem]"
                value={what}
                onChange={(e) => setWhat(e.target.value)}
              >
                <option value="stundenzettel">Bảng chấm công (Stundenzettel) — cả tháng</option>
                {weeks.map((w) => (
                  <option key={`sz-${w.weekStart}`} value={`sz-${w.weekStart}`}>
                    Bảng chấm công (Stundenzettel) — tuần {w.label}
                  </option>
                ))}
                <option value="month">Lịch làm việc — cả tháng</option>
                {weeks.map((w) => {
                  const printed = stores.some((s) => (s.schedule.printedWeeks ?? []).includes(w.weekStart));
                  return (
                    <option key={w.weekStart} value={w.weekStart}>
                      Lịch làm việc — tuần {w.label}
                      {printed ? " ✓ (đã xuất)" : ""}
                    </option>
                  );
                })}
              </select>
            </label>

            {/* Hành động */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                disabled={pdfBusy || !hasSchedule || !isScheduleYearAllowed(schedule.year)}
                onClick={onPdf}
                className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 active:bg-slate-800 disabled:opacity-40 shadow-sm"
              >
                {pdfBusy ? `Đang tạo PDF ${pdfProgress ? `(${pdfProgress})` : "…"}` : "Xuất PDF"}
              </button>
              <button
                type="button"
                disabled={pdfBusy || allEmployees.length === 0}
                onClick={regenerateAll}
                className="rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 active:bg-slate-100 shadow-sm"
                title="Tạo lại lịch cả 2 quán theo lịch cơ bản của từng người"
              >
                Tạo lại lịch (2 quán)
              </button>
              {pdfBusy && (
                <span className="text-sm text-slate-500">
                  {pdfProgress ? `Đang xử lý trang ${pdfProgress}…` : "Đang tạo PDF…"}
                </span>
              )}
            </div>
          </div>

          {pdfError && (
            <div role="alert" className="mt-3 flex items-start justify-between gap-3 rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
              <span>{pdfError}</span>
              <button type="button" onClick={() => setPdfError(null)} className="text-rose-700 hover:text-rose-900" aria-label="Đóng">
                ✕
              </button>
            </div>
          )}

          {readyPdf && (
            <div role="status" className="mt-3 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-950">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold">PDF đã sẵn sàng</div>
                  <div className="text-xs break-all">{readyPdf.filename}</div>
                </div>
                <button
                  type="button"
                  onClick={() => { setReadyPdf(null); setShareNote(null); }}
                  className="text-emerald-800 hover:text-emerald-950"
                  aria-label="Đóng"
                >
                  ✕
                </button>
              </div>
              <button
                type="button"
                onClick={() => void onSharePdf()}
                className="mt-2 rounded bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
              >
                Lưu / Chia sẻ PDF
              </button>
              <p className="mt-1 text-xs">
                Trong bảng chia sẻ chọn <b>Lưu vào Tệp</b> (iPhone) hoặc gửi qua Zalo/Mail.
              </p>
              {shareNote && (
                <div className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-amber-900">
                  <div className="text-sm">{shareNote}</div>
                  {openInBrowserHelp}
                </div>
              )}
            </div>
          )}

          {!hasSchedule && (
            <p className="mt-2 text-sm text-slate-400">
              Chưa có lịch. Bấm „Tạo lịch làm việc" ở trên để tạo cho cả 2 quán.
            </p>
          )}
          {!isScheduleYearAllowed(schedule.year) && (
            <p role="alert" className="mt-2 text-sm text-rose-700">
              Chỉ xuất lịch cho các năm {SCHEDULE_YEAR_RANGE_LABEL}. Chọn năm trong khoảng này ở thanh trên cùng.
            </p>
          )}

          <p className="mt-2 text-xs text-slate-500">
            <b>Bảng chấm công (Stundenzettel)</b> theo mẫu tiếng Đức để nộp — một tờ mỗi người của
            <b> cả 2 quán</b> gộp trong một file, chọn cả tháng hoặc từng tuần. <b>Lịch làm việc</b> là
            lịch treo ở quán (cả tháng hoặc từng tuần). <b>Xuất lịch một tuần sẽ khóa lịch tháng của cả
            2 quán</b> để bản đã xuất luôn khớp với hệ thống. Trên máy tính, Chrome và Safari, PDF tải
            thẳng về máy; mở app từ link trong Zalo/Messenger/Facebook thì bấm <b>Lưu / Chia sẻ PDF</b>
            sau khi tạo.
          </p>

          {anyLocked && (
            <div className="mt-3 rounded bg-amber-50 border border-amber-200 text-amber-900 text-sm px-3 py-2">
              <div className="font-medium">
                Lịch tháng này đã khóa vì đã in
                {lockedStamp && ` lúc ${new Date(lockedStamp).toLocaleString("vi-VN")}`}.
              </div>
              <div className="mt-0.5">
                Không sửa được ca, không đổi nhân viên. Vẫn in được bình thường. (Tạo lại lịch cũng sẽ
                mở khóa.)
              </div>

              {!confirmUnlock ? (
                <button
                  onClick={() => setConfirmUnlock(true)}
                  className="mt-2 rounded border border-amber-400 bg-white px-3 py-1 text-sm font-medium text-amber-900 hover:bg-amber-100"
                >
                  Mở khóa (2 quán)
                </button>
              ) : (
                <div className="mt-2 rounded border border-amber-300 bg-white px-3 py-2">
                  <div className="text-amber-900">
                    Mở khóa lịch tháng này cho cả 2 quán? Bản đã in ở quán sẽ không còn khớp với hệ
                    thống. Sau khi sửa, hãy in lại tuần đó và thay bản cũ.
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => {
                        unlockAll();
                        setConfirmUnlock(false);
                      }}
                      className="rounded bg-amber-600 px-3 py-1 text-sm font-medium text-white hover:bg-amber-700"
                    >
                      Xác nhận mở khóa
                    </button>
                    <button
                      onClick={() => setConfirmUnlock(false)}
                      className="rounded border border-slate-300 bg-white px-3 py-1 text-sm text-slate-600 hover:bg-slate-50"
                    >
                      Huỷ
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Xem trước trên màn hình cho nhân viên đã chọn */}
        {previewEmployee && (
          <>
            <div className="mb-1 text-xs text-slate-500">
              Xem trước bảng chấm công: <b>{previewEmployee.name}</b>{" "}
              <span className="text-slate-400">({previewStore.storeConfig.shortName})</span>
              {who === "all" && " — chọn một người ở ô „Cho ai“ để xem người khác"}
            </div>
            <div className="rounded-lg border border-slate-300 shadow-sm bg-white overflow-x-auto">
              <StundenzettelPage schedule={previewStore.schedule} employee={previewEmployee} />
            </div>
          </>
        )}
      </div>

      {/* Sân khấu ngoài màn hình – chỉ có nội dung trong lúc tạo PDF (cả 2 quán) */}
      <div ref={pdfStage} aria-hidden="true" className="pdf-stage no-print">
        {pdfJob?.kind === "schedule"
          ? stores.map((s) => {
              const empIds = employeeIdsFor(s);
              // Filiale nicht betroffen (bestimmte Person aus anderer Filiale) oder ohne Plan.
              if (empIds && empIds.length === 0) return null;
              if (s.schedule.shifts.length === 0) return null;
              return (
                <SchedulePrintPage
                  key={s.storeId}
                  schedule={s.schedule}
                  dates={pdfJob.range.dates}
                  title={`${s.storeConfig.shortName} · ${pdfJob.range.title}`}
                  layout={pdfJob.range.layout}
                  employeeIds={empIds}
                />
              );
            })
          : pdfJob?.kind === "stundenzettel"
            ? stores.flatMap((s) =>
                chosenFor(s).map((emp) => (
                  <StundenzettelPage
                    key={`${s.storeId}:${emp.id}`}
                    schedule={s.schedule}
                    employee={emp}
                    dates={pdfJob.szDates}
                    periodLabel={pdfJob.szLabel}
                  />
                )),
              )
            : null}
      </div>
    </>
  );
}
