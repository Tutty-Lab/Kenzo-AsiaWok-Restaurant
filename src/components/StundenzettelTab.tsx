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

/** Dienstplan-Ausdruck (Monat oder eine Woche), evtl. auf eine Person gefiltert. */
type ScheduleRange = {
  dates: string[];
  title: string;
  layout: SchedulePrintLayout;
  employeeIds?: string[];
  /** Gesetzt bei einer Woche: nach dem Ausgeben wird der Monat gesperrt. */
  weekStart?: string;
};

export function StundenzettelTab({ store }: { store: UseScheduleReturn }) {
  const { schedule, isLocked, markWeekPrinted, unlockMonth, generate } = store;

  // Trình duyệt nhúng (Zalo, Messenger, Facebook …) không lưu được file tải thẳng.
  const inApp = useMemo(
    () => detectInAppBrowser(typeof navigator === "undefined" ? "" : navigator.userAgent),
    [],
  );
  const pageUrl = typeof window === "undefined" ? "" : window.location.href;
  const chromeUrl = inApp.platform === "android" ? chromeIntentUrl(pageUrl) : null;

  // ── Auswahl: WER (eine Person oder der ganze Laden) und WAS ─────────────
  // who: "all" = ganzer Laden, sonst eine employeeId.
  const [who, setWho] = useState<string>("all");
  // what: "stundenzettel" (Monats-Stundenzettel) | "month" (Dienstplan Monat)
  //       | ein weekStart (Dienstplan dieser Woche).
  const [what, setWhat] = useState<string>("stundenzettel");

  const weeks = useMemo(
    () => weeksOfMonth(schedule.year, schedule.month),
    [schedule.year, schedule.month],
  );

  // PDF-Bühne.
  const [pdfList, setPdfList] = useState<Employee[] | null>(null);
  const [pdfSchedule, setPdfSchedule] = useState<ScheduleRange | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfProgress, setPdfProgress] = useState<string>("");
  const pdfStage = useRef<HTMLDivElement>(null);
  /** Lỗi tạo PDF – hiện ngay trên trang (alert bị trình duyệt nhúng chặn). */
  const [pdfError, setPdfError] = useState<string | null>(null);
  /** Trình duyệt nhúng: PDF đã tạo xong, chờ người dùng bấm Lưu / Chia sẻ. */
  const [readyPdf, setReadyPdf] = useState<{ blob: Blob; filename: string } | null>(null);
  const [shareNote, setShareNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Zeitraum für den Stundenzettel-Ausdruck: gesetzt => Wochen-Zettel (nur diese
  // Tage), leer => ganzer Monat.
  const [szDates, setSzDates] = useState<string[] | undefined>(undefined);
  const [szLabel, setSzLabel] = useState<string | undefined>(undefined);

  /** Zweiter Klick für das Entsperren – ohne native Dialoge, siehe unten. */
  const [confirmUnlock, setConfirmUnlock] = useState(false);

  const monthTag = `${schedule.year}-${String(schedule.month).padStart(2, "0")}`;

  // Für WER: die betroffenen Mitarbeiter (Reihenfolge wie im Plan).
  const chosenEmployees =
    who === "all"
      ? schedule.employees
      : schedule.employees.filter((e) => e.id === who);
  // Für die Vorschau und die Dateinamen: eine konkrete Person.
  const previewEmployee =
    who === "all" ? schedule.employees[0] ?? null : chosenEmployees[0] ?? null;
  const employeeIds = who === "all" ? undefined : [who];
  const whoTag = who === "all" ? "tat_ca" : safeFileName(previewEmployee?.name ?? who);

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

  /**
   * PDF: các trang phải được render thật (không display:none) thì html2canvas
   * mới chụp được – vì vậy dùng "sân khấu" nằm ngoài màn hình.
   */
  async function doPdf(
    list: Employee[],
    filename: string,
    sz?: { dates?: string[]; label?: string },
  ) {
    if (list.length === 0 || pdfBusy) return;
    startPdf();
    setPdfProgress(list.length > 1 ? `1/${list.length}` : "");
    flushSync(() => {
      setPdfSchedule(null);
      setSzDates(sz?.dates);
      setSzLabel(sz?.label);
      setPdfList(list);
    });
    try {
      const pages = Array.from(
        pdfStage.current?.querySelectorAll<HTMLElement>(".stundenzettel-page") ?? [],
      );
      finishPdf(await elementsToPdf(pages, filename, progress, { download: !inApp.inApp }), filename);
    } catch (err) {
      setPdfError(errorText(err));
    } finally {
      setPdfList(null);
      setPdfBusy(false);
      setPdfProgress("");
    }
  }

  /** PDF eines Dienstplans (Monat oder Woche). Eine Woche sperrt den Monat. */
  async function doPdfSchedule(range: ScheduleRange, filename: string) {
    if (range.dates.length === 0 || pdfBusy) return;
    startPdf();
    setPdfProgress("");
    flushSync(() => {
      setPdfList(null);
      setPdfSchedule(range);
    });
    try {
      const pages = Array.from(
        pdfStage.current?.querySelectorAll<HTMLElement>(".stundenzettel-page") ?? [],
      );
      finishPdf(await elementsToPdf(pages, filename, progress, { download: !inApp.inApp }), filename);
      if (range.weekStart) markWeekPrinted(range.weekStart);
    } catch (err) {
      setPdfError(errorText(err));
    } finally {
      setPdfSchedule(null);
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

  // Was genau ist gewählt? Baut den passenden Ausdruck-Auftrag.
  function scheduleRangeFor(target: string): ScheduleRange | null {
    if (target === "month") {
      return {
        dates: datesOfMonth(schedule.year, schedule.month),
        title: monthLabel(schedule.year, schedule.month),
        // 31 Tagesspalten passen nicht hochkant auf A4.
        layout: "byDate",
        employeeIds,
      };
    }
    const w = weeks.find((x) => x.weekStart === target);
    if (!w) return null;
    return {
      dates: w.dates,
      title: `Woche ${w.label} · ${monthLabel(schedule.year, schedule.month)}`,
      // Leute untereinander, Tage nebeneinander – bei 7 Spalten gut auf Papier.
      layout: "byEmployee",
      employeeIds,
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
      void doPdf(chosenEmployees, `Stundenzettel_${whoTag}_${monthTag}.pdf`);
      return;
    }
    if (what.startsWith("sz-")) {
      const weekStart = what.slice(3);
      const sz = szWeekFor(weekStart);
      if (sz) {
        void doPdf(chosenEmployees, `Stundenzettel_${whoTag}_${monthTag}_tuan_${weekStart}.pdf`, sz);
      }
      return;
    }
    const range = scheduleRangeFor(what);
    if (!range) return;
    const suffix = what === "month" ? "thang" : `tuan_${what}`;
    void doPdfSchedule(range, `Dienstplan_${whoTag}_${suffix}_${monthTag}.pdf`);
  }

  // Vùng in KHÔNG được dọn theo sự kiện "afterprint": trên Android sự kiện đó
  // bắn ra ngay khi gọi window.print(), trước lúc trình duyệt dựng xong trang
  // — nội dung bị xoá mất và tờ in ra trắng. Vùng này vốn đã ẩn trên màn hình
  // nên cứ để nguyên; lần in sau sẽ ghi đè bằng danh sách mới.

  if (schedule.employees.length === 0) {
    return (
      <div className="no-print rounded bg-white border border-slate-200 p-6 text-center text-slate-400">
        Vui lòng thêm nhân viên và tạo lịch làm việc trước.
      </div>
    );
  }

  const hasSchedule = schedule.shifts.length > 0;

  return (
    <>
      {/* Điều khiển (không in) */}
      <div className="no-print">
        {/* ---- In & Xuất ---- */}
        <div className="rounded-lg border border-slate-200 bg-white p-3 mb-4">
          <div className="text-sm font-medium text-slate-700 mb-2">Xuất file PDF</div>

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
                className="w-full max-w-full rounded border border-slate-300 px-2 py-2 text-sm sm:w-auto sm:min-w-[10rem]"
                value={who}
                onChange={(e) => setWho(e.target.value)}
              >
                <option value="all">Tất cả (cả quán)</option>
                {schedule.employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
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
                  const printed = (schedule.printedWeeks ?? []).includes(w.weekStart);
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
                disabled={pdfBusy || schedule.employees.length === 0}
                onClick={() => {
                  if (isLocked) unlockMonth();
                  generate();
                }}
                className="rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 active:bg-slate-100 shadow-sm"
                title="Tạo lại lịch theo lịch cơ bản của từng người"
              >
                Tạo lại lịch
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
              Chưa có lịch. Sang tab „Lịch làm việc" để tạo.
            </p>
          )}
          {!isScheduleYearAllowed(schedule.year) && (
            <p role="alert" className="mt-2 text-sm text-rose-700">
              Chỉ xuất lịch cho các năm {SCHEDULE_YEAR_RANGE_LABEL}. Tạo lịch cho năm trong khoảng này ở tab „Lịch làm việc".
            </p>
          )}

          <p className="mt-2 text-xs text-slate-500">
            <b>Bảng chấm công (Stundenzettel)</b> theo mẫu tiếng Đức để nộp — một tờ mỗi người, chọn
            cả tháng hoặc từng tuần. <b>Lịch làm việc</b> là lịch treo ở quán (cả tháng hoặc từng
            tuần, cho cả quán hoặc một người). <b>Xuất lịch một tuần sẽ khóa lịch tháng</b> để bản
            đã xuất luôn khớp với hệ thống. Trên máy tính, Chrome và Safari, PDF tải thẳng về máy; mở
            app từ link trong Zalo/Messenger/Facebook thì bấm <b>Lưu / Chia sẻ PDF</b> sau khi tạo.
          </p>

          {isLocked && (
            <div className="mt-3 rounded bg-amber-50 border border-amber-200 text-amber-900 text-sm px-3 py-2">
              <div className="font-medium">
                Lịch tháng này đã khóa vì đã in
                {schedule.lockedAt &&
                  ` lúc ${new Date(schedule.lockedAt).toLocaleString("vi-VN")}`}
                .
              </div>
              <div className="mt-0.5">
                Không sửa được ca, không đổi nhân viên. Vẫn in được bình thường. (Tạo lại lịch ở tab
                „Lịch làm việc" cũng sẽ mở khóa.)
              </div>

              {/*
                Bewusst KEIN window.confirm: In-App-Browser (Messenger,
                Facebook) unterdrücken die native Rückfrage teilweise. Sie
                liefert dann stillschweigend false, der Klick tut nichts, und
                niemand erfährt warum. Die Rückfrage steht deshalb direkt hier.
              */}
              {!confirmUnlock ? (
                <button
                  onClick={() => setConfirmUnlock(true)}
                  className="mt-2 rounded border border-amber-400 bg-white px-3 py-1 text-sm font-medium text-amber-900 hover:bg-amber-100"
                >
                  Mở khóa
                </button>
              ) : (
                <div className="mt-2 rounded border border-amber-300 bg-white px-3 py-2">
                  <div className="text-amber-900">
                    Mở khóa lịch tháng này? Bản đã in ở quán sẽ không còn khớp với hệ thống. Sau
                    khi sửa, hãy in lại tuần đó và thay bản cũ.
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => {
                        unlockMonth();
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
              Xem trước bảng chấm công: <b>{previewEmployee.name}</b>
              {who === "all" && " (chọn một người ở ô „Cho ai“ để xem người khác)"}
            </div>
            <div className="rounded-lg border border-slate-300 shadow-sm bg-white overflow-x-auto">
              <StundenzettelPage schedule={schedule} employee={previewEmployee} />
            </div>
          </>
        )}
      </div>

      {/* Sân khấu ngoài màn hình – chỉ có nội dung trong lúc tạo PDF */}
      <div ref={pdfStage} aria-hidden="true" className="pdf-stage no-print">
        {pdfSchedule ? (
          <SchedulePrintPage
            schedule={schedule}
            dates={pdfSchedule.dates}
            title={pdfSchedule.title}
            layout={pdfSchedule.layout}
            employeeIds={pdfSchedule.employeeIds}
          />
        ) : (
          (pdfList ?? []).map((emp) => (
            <StundenzettelPage
              key={emp.id}
              schedule={schedule}
              employee={emp}
              dates={szDates}
              periodLabel={szLabel}
            />
          ))
        )}
      </div>
    </>
  );
}
