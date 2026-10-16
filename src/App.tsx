import { useEffect, useState, type ReactNode } from "react";
import { useSchedule, type UseScheduleReturn } from "./hooks/useSchedule";
import { GenerateScheduleDialog } from "./components/GenerateScheduleDialog";
import { SettingsTab } from "./components/SettingsTab";
import { EmployeesTab } from "./components/EmployeesTab";
import { ScheduleTab } from "./components/ScheduleTab";
import { StundenzettelTab } from "./components/StundenzettelTab";
import { DocsTab } from "./components/DocsTab";
import { Dashboard } from "./components/Dashboard";
import { LockScreen } from "./components/LockScreen";
import { isAuthenticated, logout } from "./lib/auth";
import { MONTH_NAMES_VI } from "./lib/dateFormat";
import { isScheduleYearAllowed, SCHEDULE_YEARS } from "./lib/years";

type TabId = "einstellungen" | "mitarbeiter" | "dienstplan" | "stundenzettel";

/**
 * Sichtbar als Tab sind die drei, mit denen täglich gearbeitet wird
 * (MAIN_TABS); Cài đặt und Tài liệu stecken im Menü ☰ oben rechts (wie die Demo).
 */
const TABS: { id: TabId; label: string }[] = [
  { id: "stundenzettel", label: "Chấm công" },
  { id: "dienstplan", label: "Lịch" },
  { id: "mitarbeiter", label: "Nhân viên" },
  { id: "einstellungen", label: "Cài đặt" },
];
const MAIN_TABS: TabId[] = ["stundenzettel", "dienstplan", "mitarbeiter"];

/** Merkt sich, welcher Laden zuletzt angezeigt wurde (nur Komfort). */
const VIEW_KEY = "stundenzettel-app:view";

export default function App() {
  const [unlocked, setUnlocked] = useState(() => isAuthenticated());

  if (!unlocked) return <LockScreen onUnlock={() => setUnlocked(true)} />;
  return <MainApp onLogout={() => setUnlocked(false)} />;
}

function MainApp({ onLogout }: { onLogout: () => void }) {
  // Beide Filialen laufen gleichzeitig – jede mit eigenem State, eigener
  // Persistenz und eigener Sync. Angezeigt wird die in der Reihe über der
  // Übersicht gewählte; erzeugt wird für beide zusammen.
  const kenzo = useSchedule("kenzo");
  const wok = useSchedule("asiawok");
  const stores = [kenzo, wok];
  // Monat/Jahr sind für beide gleich (der Ausdruck muss zusammenpassen).
  const primary = kenzo;

  const [viewId, setViewId] = useState<string>(() => {
    try {
      return localStorage.getItem(VIEW_KEY) ?? "kenzo";
    } catch {
      return "kenzo";
    }
  });
  const chooseStore = (id: string) => {
    setViewId(id);
    try {
      localStorage.setItem(VIEW_KEY, id);
    } catch {
      // egal – nur eine Bequemlichkeit
    }
  };
  const view = stores.find((s) => s.storeId === viewId) ?? kenzo;

  const [tab, setTab] = useState<TabId>("stundenzettel");
  const [menuOpen, setMenuOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const refreshApp = async () => {
    setRefreshing(true);
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      // Höchstens 3 s auf die Update-Prüfung warten (schlechtes Netz).
      await Promise.race([reg?.update(), new Promise((resolve) => setTimeout(resolve, 3000))]);
    } catch {
      // egal – trotzdem neu laden
    }
    window.location.reload();
  };
  /** Trang Tài liệu mở riêng; đóng lại thì về đúng tab đang làm. */
  const [docsOpen, setDocsOpen] = useState(false);

  const openTab = (id: TabId) => {
    setTab(id);
    setDocsOpen(false);
  };

  /** Monat/Jahr für BEIDE Filialen setzen. */
  const setPeriod = (patch: { year?: number; month?: number }) => {
    for (const s of stores) s.updateMeta(patch);
  };

  // Popup statt window.confirm: eingebettete Browser (Messenger, Zalo) schlucken den.
  const [genDialogOpen, setGenDialogOpen] = useState(false);
  // Kurze Erfolgsmeldung nach dem Erzeugen. genStamp steigt bei jedem
  // erfolgreichen Lauf; der Effekt liest DANACH die (frische) Prüfung beider
  // Filialen aus.
  const [toast, setToast] = useState<string | null>(null);
  const genStampSum = kenzo.genStamp + wok.genStamp;
  useEffect(() => {
    if (genStampSum === 0) return;
    const allErrors = stores.flatMap((s) => s.validation.errors);
    const fehler = allErrors.filter((e) => e.severity !== "warning").length;
    const warn = allErrors.filter((e) => e.severity === "warning").length;
    setToast(
      fehler > 0
        ? `Đã tạo lịch 2 quán — nhưng còn ${fehler} lỗi, xem chi tiết ở phần trạng thái.`
        : warn > 0
          ? `✓ Đã tạo lịch 2 quán (còn ${warn} cảnh báo thiếu giờ — bấm (i) để xem).`
          : "✓ Đã tạo lịch mới cho cả 2 quán — hợp lệ, theo lịch cơ bản của từng người.",
    );
    const t = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(t);
  }, [genStampSum]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Kurzer Stand eines Ladens für den Umschalter. */
  const storeStatus = (s: UseScheduleReturn) =>
    s.schedule.shifts.length === 0
      ? "chưa tạo lịch"
      : s.validation.errors.some((e) => e.severity !== "warning")
        ? "có lỗi"
        : s.validation.errors.length > 0
          ? `${s.validation.errors.length} cảnh báo`
          : "ổn";

  return (
    <div className="min-h-screen">
      {/* iPhone-App vom Home-Bildschirm (black-translucent): Inhalt unter die Statusleiste schieben. */}
      <header className="no-print bg-slate-900 text-white shadow sticky top-0 z-30 pt-[env(safe-area-inset-top)]">
        <div className="mx-auto max-w-[1500px] px-3 sm:px-4 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-base sm:text-lg font-semibold" title={`bản ${__BUILD__}`}>
              Lịch làm việc &amp; Bảng chấm công
            </h1>
            {stores.some((s) => s.remoteStatus === "error") && (
              <p className="text-xs text-rose-300">Lỗi đồng bộ — dữ liệu chỉ lưu trên máy này</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/* Aus dem Menü geöffnete Seite: steht direkt neben dem Menü, mit ✕ zurück. */}
            {(docsOpen || !MAIN_TABS.includes(tab)) && (
              <span className="inline-flex items-center gap-1 rounded-md bg-white py-1.5 pl-3 pr-1 text-sm font-medium text-slate-900">
                {docsOpen ? "Tài liệu" : TABS.find((t) => t.id === tab)?.label}
                <button
                  type="button"
                  onClick={() => openTab("stundenzettel")}
                  aria-label="Đóng"
                  className="rounded px-1.5 text-slate-400 hover:text-slate-900"
                >
                  ✕
                </button>
              </span>
            )}
            {/* Tải lại: als App vom Home-Bildschirm gibt es keine Browserleiste zum Neuladen. */}
            <button
              type="button"
              onClick={() => void refreshApp()}
              disabled={refreshing}
              aria-label="Tải lại"
              title="Tải lại"
              className="flex h-9 w-9 items-center justify-center rounded bg-slate-700 text-lg leading-none hover:bg-slate-600 disabled:opacity-60"
            >
              <span className={refreshing ? "inline-block animate-spin" : "inline-block"}>↻</span>
            </button>
            {/* Menu: alles, was nicht täglich gebraucht wird. */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((open) => !open)}
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                className={`rounded px-3 py-2 text-sm font-medium ${menuOpen ? "bg-white text-slate-900" : "bg-slate-700 hover:bg-slate-600"}`}
              >
                ☰ Menu
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                  <div
                    role="menu"
                    className="absolute right-0 z-50 mt-2 w-52 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 text-sm text-slate-800 shadow-lg"
                  >
                    {(
                      [
                        ["Cài đặt", () => openTab("einstellungen")],
                        ["Tài liệu", () => setDocsOpen(true)],
                        [
                          "Đăng xuất",
                          () => {
                            logout();
                            onLogout();
                          },
                        ],
                      ] as const
                    ).map(([label, action]) => (
                      <button
                        key={label}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          action();
                          setMenuOpen(false);
                        }}
                        className="block w-full px-4 py-2 text-left hover:bg-slate-50"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="no-print mx-auto max-w-[1500px] px-3 sm:px-4 pt-4 space-y-3">
        {/* Quán đang xem – hai nút kèm trạng thái từng quán. */}
        <div role="tablist" aria-label="Quán" className="grid grid-cols-2 gap-2">
          {stores.map((s) => {
            const active = s.storeId === view.storeId;
            return (
              <button
                key={s.storeId}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => chooseStore(s.storeId)}
                className={`rounded-xl border px-3 py-2 text-left ${
                  active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-slate-400"
                }`}
              >
                <div className="text-sm font-semibold">{s.storeConfig.shortName}</div>
                <div className={`text-xs ${active ? "text-slate-300" : "text-slate-500"}`}>{storeStatus(s)}</div>
              </button>
            );
          })}
        </div>
        <Dashboard store={view} />
      </div>

      <nav className="no-print mx-auto max-w-[1500px] px-3 sm:px-4 mt-4">
        <div className="flex flex-wrap items-center gap-2">
          {/* Chấm công · Lịch · Nhân viên als Segment; Tháng + Tạo lịch rechts. */}
          <div className="inline-flex rounded-xl border border-slate-200 bg-white p-0.5">
            {TABS.filter((t) => MAIN_TABS.includes(t.id)).map((t) => {
              const active = !docsOpen && tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => openTab(t.id)}
                  aria-current={active ? "page" : undefined}
                  className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${
                    active ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
          <div className="ml-auto flex items-center gap-2">
            {/* Tháng/năm dùng chung cho cả 2 quán – bản in phải cùng kỳ. */}
            <select
              aria-label="Tháng"
              value={`${primary.schedule.year}-${primary.schedule.month}`}
              onChange={(e) => {
                const [year, month] = e.target.value.split("-").map(Number);
                setPeriod({ year, month });
              }}
              className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm text-slate-800"
            >
              {(isScheduleYearAllowed(primary.schedule.year) ? SCHEDULE_YEARS : [primary.schedule.year, ...SCHEDULE_YEARS]).flatMap(
                (year) =>
                  MONTH_NAMES_VI.map((name, i) => (
                    <option key={`${year}-${i + 1}`} value={`${year}-${i + 1}`}>
                      {name}/{year}
                    </option>
                  )),
              )}
            </select>
            {/* „Tạo lịch" – wichtigste Aktion. */}
            <button
              type="button"
              onClick={() => setGenDialogOpen(true)}
              disabled={stores.every((s) => s.schedule.employees.length === 0)}
              className="whitespace-nowrap rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-40"
            >
              Tạo lịch
            </button>
          </div>
        </div>
      </nav>

      {/* Popup chọn tháng/năm – nhắc kiểm tra ngày lễ/giờ đặc biệt, cảnh báo thay lịch và mở khóa. */}
      {genDialogOpen && (
        <GenerateScheduleDialog
          currentYear={primary.schedule.year}
          currentMonth={primary.schedule.month}
          hasShifts={stores.some((s) => s.schedule.shifts.length > 0)}
          isLocked={stores.some((s) => s.isLocked)}
          dateOverrides={stores.flatMap((s) => s.schedule.dateOverrides)}
          onClose={() => setGenDialogOpen(false)}
          onOpenSettings={() => {
            setGenDialogOpen(false);
            openTab("einstellungen");
          }}
          onConfirm={(target) => {
            setGenDialogOpen(false);
            for (const s of stores) s.generate(target);
            openTab("dienstplan");
          }}
        />
      )}

      {(stores.some((s) => s.genError) || toast) && (
        <div className="no-print mx-auto max-w-[1500px] px-3 sm:px-4 mt-3 space-y-2">
          {stores
            .filter((s) => s.genError)
            .map((s) => (
              <div
                key={s.storeId}
                role="alert"
                className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900"
              >
                {s.storeConfig.shortName}: {s.genError}
              </div>
            ))}
          {/* Erfolgsmeldung nach „Tạo lịch"; Details stehen aufklappbar in der Übersicht. */}
          {toast && (
            <div
              role="status"
              className={`flex items-start gap-2 rounded border px-3 py-2 text-sm ${
                toast.startsWith("✓")
                  ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                  : "bg-amber-50 border-amber-200 text-amber-900"
              }`}
            >
              <span className="flex-1">{toast}</span>
              <button type="button" onClick={() => setToast(null)} className="shrink-0 opacity-60 hover:opacity-100" aria-label="Đóng">
                ×
              </button>
            </div>
          )}
        </div>
      )}

      <main className="mx-auto max-w-[1500px] px-3 sm:px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {docsOpen ? (
          <div className="no-print">
            <DocsTab stores={stores.map((s) => s.storeConfig)} />
          </div>
        ) : (
          <>
            <div className="no-print space-y-6">
              {tab === "einstellungen" && (
                <StoreSection store={view}>
                  <SettingsTab store={view} />
                </StoreSection>
              )}
              {tab === "mitarbeiter" && (
                <StoreSection store={view}>
                  <EmployeesTab store={view} />
                </StoreSection>
              )}
            </div>
            {/*
              „Chấm công" enthält den Druckbereich (Stundenzettel UND Dienstplan)
              und darf deshalb NICHT im no-print-Container liegen. Der Tab blendet
              seine Bedienelemente selbst aus und gibt wie bisher beide Läden aus.
            */}
            {tab === "dienstplan" && (
              <StoreSection store={view}>
                <ScheduleTab store={view} />
              </StoreSection>
            )}
            {tab === "stundenzettel" && <StundenzettelTab stores={stores} />}
          </>
        )}
      </main>
    </div>
  );
}

/** Ein Filial-Abschnitt mit Kopfzeile (Filialname). Kopf ist nie im Druck. */
function StoreSection({ store, children }: { store: UseScheduleReturn; children: ReactNode }) {
  return (
    <section>
      <div className="no-print mb-2 flex items-center gap-2">
        <span className="rounded-md bg-slate-900 px-2.5 py-1 text-sm font-semibold text-white">
          {store.storeConfig.shortName}
        </span>
        <span className="text-sm text-slate-500">{store.storeConfig.name}</span>
      </div>
      {children}
    </section>
  );
}
