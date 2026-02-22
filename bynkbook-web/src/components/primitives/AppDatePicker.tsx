"use client";

import * as React from "react";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { inputH7, ringFocus } from "./tokens";

export type AppDatePickerProps = {
    value: string; // YYYY-MM-DD or ""
    onChange: (next: string) => void;

    placeholder?: string;
    disabled?: boolean;

    ariaLabel?: string;
    className?: string;

    allowClear?: boolean;
};

function pad2(n: number) {
    return String(n).padStart(2, "0");
}

function ymdToDateLocal(ymd: string): Date | null {
    if (!ymd) return null;
    const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]) - 1;
    const d = Number(m[3]);
    const dt = new Date(y, mo, d);
    return Number.isNaN(dt.getTime()) ? null : dt;
}

function dateToYmdLocal(dt: Date): string {
    return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

function formatPlaceholderOrPretty(ymd: string, placeholder: string) {
    const dt = ymdToDateLocal(ymd);
    if (!dt) return placeholder;
    try {
        return dt.toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "2-digit",
        });
    } catch {
        return ymd;
    }
}

function startOfMonth(d: Date) {
    return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d: Date, delta: number) {
    return new Date(d.getFullYear(), d.getMonth() + delta, 1);
}

function daysInMonth(d: Date) {
    return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

function sameDay(a: Date, b: Date) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function clampToDateOnly(d: Date) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function AppDatePicker({
    value,
    onChange,
    placeholder = "mm/dd/yy",
    disabled = false,
    ariaLabel = "Select date",
    className = "",
    allowClear = true,
}: AppDatePickerProps) {
    const [open, setOpen] = React.useState(false);

    const selected = ymdToDateLocal(value);
    const today = clampToDateOnly(new Date());

    const anchorRef = React.useRef<HTMLButtonElement | null>(null);
    const [popoverPos, setPopoverPos] = React.useState<{ left: number; top: number }>({ left: 0, top: 0 });

    const [viewMonth, setViewMonth] = React.useState<Date>(() => {
        return selected ? startOfMonth(selected) : startOfMonth(today);
    });

    // Keep view month in sync when value changes externally
    React.useEffect(() => {
        if (!selected) return;
        setViewMonth(startOfMonth(selected));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);

    // Close on outside click / escape
    const rootRef = React.useRef<HTMLDivElement | null>(null);
    React.useEffect(() => {
        if (!open) return;

        const onDocMouseDown = (e: MouseEvent) => {
            const el = rootRef.current;
            if (!el) return;
            if (e.target instanceof Node && !el.contains(e.target)) setOpen(false);
        };

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") setOpen(false);
        };

        const onScroll = () => {
            setOpen(false);
        };

        document.addEventListener("mousedown", onDocMouseDown);
        document.addEventListener("keydown", onKeyDown);
        window.addEventListener("scroll", onScroll, true);
        return () => {
            document.removeEventListener("mousedown", onDocMouseDown);
            document.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("scroll", onScroll, true);
        };
    }, [open]);

    const monthLabel = React.useMemo(() => {
        try {
            return viewMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" });
        } catch {
            return `${viewMonth.getFullYear()}-${pad2(viewMonth.getMonth() + 1)}`;
        }
    }, [viewMonth]);

    const grid = React.useMemo(() => {
        const first = startOfMonth(viewMonth);
        const firstDow = first.getDay(); // 0=Sun
        const dim = daysInMonth(viewMonth);

        const cells: Array<{ date: Date; inMonth: boolean }> = [];

        // Leading days (previous month)
        for (let i = 0; i < firstDow; i++) {
            const dt = new Date(first.getFullYear(), first.getMonth(), 1 - (firstDow - i));
            cells.push({ date: dt, inMonth: false });
        }

        // Month days
        for (let d = 1; d <= dim; d++) {
            cells.push({ date: new Date(first.getFullYear(), first.getMonth(), d), inMonth: true });
        }

        // Trailing days to complete weeks
        while (cells.length % 7 !== 0) {
            const last = cells[cells.length - 1].date;
            const dt = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1);
            cells.push({ date: dt, inMonth: false });
        }

        // Chunk to weeks
        const weeks: typeof cells[] = [];
        for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
        return weeks;
    }, [viewMonth]);

    return (
        <div ref={rootRef} className={["relative", className].join(" ")}>
            <button
                type="button"
                aria-label={ariaLabel}
                disabled={disabled}
                onClick={() => {
                    if (disabled) return;
                    setOpen((v) => !v);
                }}
                ref={anchorRef}
                className={[
                    inputH7,
                    "pl-8 pr-8 text-left flex items-center",
                    disabled ? "opacity-50 cursor-not-allowed" : "hover:bg-slate-50",
                ].join(" ")}
            >
                <CalendarDays className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <span className={value ? "text-slate-900" : "text-slate-400"}>
                    {formatPlaceholderOrPretty(value, placeholder)}
                </span>
            </button>

            {allowClear && value ? (
                <button
                    type="button"
                    className={[
                        "absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 rounded-md",
                        "inline-flex items-center justify-center",
                        "text-slate-500 hover:bg-slate-50",
                        ringFocus,
                        disabled ? "opacity-50 cursor-not-allowed" : "",
                    ].join(" ")}
                    onClick={() => onChange("")}
                    aria-label="Clear date"
                    disabled={disabled}
                    title="Clear"
                >
                    <X className="h-4 w-4" />
                </button>
            ) : null}

            {open
                ? typeof document !== "undefined"
                    ? (() => {
                        // compute position each render while open
                        const el = anchorRef.current;
                        if (el) {
                            const r = el.getBoundingClientRect();
                            const left = Math.max(8, Math.min(r.left, window.innerWidth - 320 - 8));
                            const top = r.bottom + 8;
                            // avoid setState loop if unchanged
                            if (popoverPos.left !== left || popoverPos.top !== top) {
                                // eslint-disable-next-line react-hooks/rules-of-hooks
                                setTimeout(() => setPopoverPos({ left, top }), 0);
                            }
                        }

                        return (
                            <div
                                style={{ position: "fixed", left: popoverPos.left, top: popoverPos.top, width: 320, zIndex: 60 }}
                                className="rounded-2xl border border-slate-200 bg-white shadow-xl p-3"
                            >
                                {/* Header */}
                                <div className="grid grid-cols-[40px_1fr_40px] items-center mb-2">
                                    <button
                                        type="button"
                                        className={[
                                            "h-9 w-9 rounded-xl border border-slate-200 bg-white hover:bg-slate-50",
                                            "inline-flex items-center justify-center",
                                            ringFocus,
                                        ].join(" ")}
                                        onClick={() => setViewMonth((m) => addMonths(m, -1))}
                                        aria-label="Previous month"
                                        title="Previous month"
                                    >
                                        <ChevronLeft className="h-5 w-5 text-slate-700" />
                                    </button>

                                    <div className="text-base font-semibold text-slate-900 text-center">{monthLabel}</div>

                                    <button
                                        type="button"
                                        className={[
                                            "h-9 w-9 rounded-xl border border-slate-200 bg-white hover:bg-slate-50",
                                            "inline-flex items-center justify-center",
                                            ringFocus,
                                        ].join(" ")}
                                        onClick={() => setViewMonth((m) => addMonths(m, 1))}
                                        aria-label="Next month"
                                        title="Next month"
                                    >
                                        <ChevronRight className="h-5 w-5 text-slate-700" />
                                    </button>
                                </div>

                                {/* Weekdays */}
                                <div className="grid grid-cols-7 text-[11px] font-medium text-slate-500 mb-1">
                                    <div className="text-center">Su</div>
                                    <div className="text-center">Mo</div>
                                    <div className="text-center">Tu</div>
                                    <div className="text-center">We</div>
                                    <div className="text-center">Th</div>
                                    <div className="text-center">Fr</div>
                                    <div className="text-center">Sa</div>
                                </div>

                                {/* Grid */}
                                <div className="grid grid-cols-7 gap-1">
                                    {grid.flat().map(({ date, inMonth }) => {
                                        const isToday = sameDay(date, today);
                                        const isSelected = selected ? sameDay(date, selected) : false;

                                        return (
                                            <button
                                                key={dateToYmdLocal(date)}
                                                type="button"
                                                className={[
                                                    "h-10 w-10 rounded-xl text-sm flex items-center justify-center",
                                                    inMonth ? "text-slate-900" : "text-slate-300",
                                                    !disabled ? "hover:bg-violet-50" : "",
                                                    isToday ? "bg-violet-50 ring-1 ring-violet-200" : "",
                                                    isSelected ? "bg-violet-600 text-white hover:bg-violet-600" : "",
                                                    ringFocus,
                                                ].join(" ")}
                                                disabled={disabled}
                                                onClick={() => {
                                                    if (disabled) return;
                                                    onChange(dateToYmdLocal(date));
                                                    setOpen(false);
                                                }}
                                                aria-label={date.toDateString()}
                                                title={date.toDateString()}
                                            >
                                                {date.getDate()}
                                            </button>
                                        );
                                    })}
                                </div>

                                {/* Footer */}
                                <div className="mt-2 flex items-center justify-between">
                                    <button
                                        type="button"
                                        className={["h-8 px-2 text-xs rounded-md hover:bg-slate-50", ringFocus].join(" ")}
                                        onClick={() => {
                                            onChange("");
                                            setOpen(false);
                                        }}
                                        disabled={disabled}
                                    >
                                        Clear
                                    </button>

                                    <button
                                        type="button"
                                        className={["h-8 px-2 text-xs rounded-md hover:bg-slate-50", ringFocus].join(" ")}
                                        onClick={() => {
                                            onChange(dateToYmdLocal(today));
                                            setViewMonth(startOfMonth(today));
                                            setOpen(false);
                                        }}
                                        disabled={disabled}
                                    >
                                        Today
                                    </button>
                                </div>
                            </div>
                        );
                    })()
                    : null
                : null}
        </div>
    );
}