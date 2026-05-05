"use client";

import {
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent,
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

type RawCategoryOption =
  | string
  | {
      id?: string | null;
      name: string;
      archived_at?: string | null;
    };

export type CategoryComboboxOption = {
  id: string | null;
  name: string;
};

export function normalizeCategoryComboboxName(name: string): string {
  return (name || "").trim().replace(/\s+/g, " ");
}

function normKey(name: string): string {
  return normalizeCategoryComboboxName(name).toLowerCase();
}

function toOption(option: RawCategoryOption): CategoryComboboxOption {
  if (typeof option === "string") {
    return { id: null, name: option };
  }

  return { id: option.id ?? null, name: option.name };
}

function uniqueSortedOptions(options: RawCategoryOption[]): CategoryComboboxOption[] {
  const byName = new Map<string, CategoryComboboxOption>();

  for (const raw of options) {
    const option = toOption(raw);
    const name = normalizeCategoryComboboxName(option.name);
    if (!name) continue;

    const key = normKey(name);
    if (!byName.has(key)) {
      byName.set(key, { id: option.id, name });
    }
  }

  return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function filterOptions(query: string, options: CategoryComboboxOption[]) {
  const q = normKey(query);
  if (!q) return options;

  const starts = options.filter((option) => normKey(option.name).startsWith(q));
  const contains = options.filter(
    (option) => !normKey(option.name).startsWith(q) && normKey(option.name).includes(q)
  );

  return [...starts, ...contains];
}

type CategoryComboboxProps = {
  options: RawCategoryOption[];
  value?: string;
  categoryId?: string | null;
  onValueChange?: (value: string) => void;
  onChange?: (value: string, option: CategoryComboboxOption | null) => void;
  placeholder?: string;
  inputClassName?: string;
  allowCreate?: boolean;
  onCreate?: (name: string) => void | Promise<void>;
  allowClear?: boolean;
  onSubmit?: () => void;
  disabled?: boolean;
};

export const CategoryCombobox = forwardRef<HTMLInputElement, CategoryComboboxProps>(function CategoryCombobox(
  props,
  forwardedInputRef
) {
  const {
    options,
    value,
    categoryId,
    onValueChange,
    onChange,
    placeholder,
    inputClassName,
    allowCreate,
    onCreate,
    allowClear,
    onSubmit,
    disabled,
  } = props;

  const listboxId = useId();
  const localInputRef = useRef<HTMLInputElement | null>(null);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const [inner, setInner] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties | null>(null);

  const normalizedOptions = useMemo(() => uniqueSortedOptions(options), [options]);
  const optionById = useMemo(() => {
    const map = new Map<string, CategoryComboboxOption>();
    for (const option of normalizedOptions) {
      if (option.id) map.set(option.id, option);
    }
    return map;
  }, [normalizedOptions]);

  const isControlled = typeof value === "string";
  const resolvedValue =
    isControlled ? (value as string) : categoryId ? optionById.get(categoryId)?.name ?? inner : inner;
  const filtered = useMemo(() => filterOptions(resolvedValue, normalizedOptions), [resolvedValue, normalizedOptions]);
  const exactMatch = useMemo(() => {
    const key = normKey(resolvedValue);
    return key ? normalizedOptions.find((option) => normKey(option.name) === key) ?? null : null;
  }, [normalizedOptions, resolvedValue]);
  const canCreate =
    !!allowCreate &&
    !!onCreate &&
    !!normalizeCategoryComboboxName(resolvedValue) &&
    !exactMatch;

  useImperativeHandle(forwardedInputRef, () => localInputRef.current as HTMLInputElement);

  const setDisplayValue = (next: string, option: CategoryComboboxOption | null) => {
    if (localInputRef.current) localInputRef.current.value = next;
    if (!isControlled) setInner(next);
    onValueChange?.(next);
    onChange?.(next, option);
  };

  const selectOption = (option: CategoryComboboxOption) => {
    setDisplayValue(option.name, option);
    setOpen(false);
    requestAnimationFrame(() => localInputRef.current?.focus());
  };

  const updatePopover = () => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;

    const viewportPadding = 8;
    const maxWidth = Math.max(220, window.innerWidth - viewportPadding * 2);
    const width = Math.min(maxWidth, Math.max(rect.width, 320));
    const left = Math.min(Math.max(viewportPadding, rect.left), window.innerWidth - width - viewportPadding);

    setPopoverStyle({
      left,
      top: rect.bottom + 4,
      width,
      maxWidth,
    });
  };

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(updatePopover);

    window.addEventListener("resize", updatePopover);
    window.addEventListener("scroll", updatePopover, true);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updatePopover);
      window.removeEventListener("scroll", updatePopover, true);
    };
  }, [open]);

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    const option = normalizedOptions.find((candidate) => normKey(candidate.name) === normKey(next)) ?? null;

    setDisplayValue(next, option);
    setActive(0);
    setOpen(true);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      setActive((prev) => {
        const max = Math.max(0, filtered.length - 1);
        if (e.key === "ArrowDown") return Math.min(max, prev + 1);
        return Math.max(0, prev - 1);
      });
      return;
    }

    if (e.key === "Enter") {
      if (open && filtered[activeIndex]) {
        e.preventDefault();
        selectOption(filtered[activeIndex]);
        onSubmit?.();
        return;
      }

      onSubmit?.();
    }
  };

  const activeIndex = Math.min(active, Math.max(0, filtered.length - 1));
  const portalRoot = typeof document !== "undefined" ? document.body : null;
  const popover =
    portalRoot && open && (filtered.length > 0 || canCreate) && popoverStyle
      ? createPortal(
          <div
            id={listboxId}
            role="listbox"
            className="fixed z-[100] max-h-60 overflow-auto rounded-md border border-bb-border bg-bb-surface-card p-0 shadow-lg"
            style={popoverStyle}
          >
            {allowClear && resolvedValue ? (
              <button
                type="button"
                role="option"
                aria-selected={false}
                className="flex w-full items-center px-2 py-1.5 text-left text-xs text-bb-text-muted hover:bg-bb-table-row-hover"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setDisplayValue("", null);
                  setOpen(false);
                }}
                title="Uncategorized"
              >
                Uncategorized
              </button>
            ) : null}

            {canCreate ? (
              <button
                type="button"
                role="option"
                aria-selected={false}
                className="flex w-full min-w-0 items-center px-2 py-1.5 text-left text-xs hover:bg-bb-table-row-hover"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  void onCreate?.(normalizeCategoryComboboxName(resolvedValue));
                  setOpen(false);
                }}
                title={`Create "${normalizeCategoryComboboxName(resolvedValue)}"`}
              >
                <span className="shrink-0 text-bb-text">Create</span>
                <span className="ml-1 min-w-0 whitespace-normal break-words font-medium leading-snug text-bb-text">
                  &quot;{normalizeCategoryComboboxName(resolvedValue)}&quot;
                </span>
              </button>
            ) : null}

            {filtered.map((option, idx) => (
              <button
                key={option.id ?? option.name}
                type="button"
                role="option"
                aria-selected={idx === activeIndex}
                className={
                  "flex w-full min-w-0 items-center px-2 py-1.5 text-left text-xs text-bb-text hover:bg-bb-table-row-hover " +
                  (idx === activeIndex ? "bg-bb-table-row-hover" : "bg-bb-surface-card")
                }
                onMouseEnter={() => setActive(idx)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => selectOption(option)}
                title={option.name}
              >
                <span className="min-w-0 whitespace-normal break-words leading-snug">{option.name}</span>
              </button>
            ))}
          </div>,
          portalRoot
        )
      : null;

  return (
    <div ref={anchorRef} className="relative min-w-0">
      <input
        ref={localInputRef}
        className={inputClassName}
        placeholder={placeholder}
        value={resolvedValue}
        disabled={disabled}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listboxId}
        onFocus={() => {
          updatePopover();
          setOpen(true);
        }}
        onClick={() => {
          updatePopover();
          setOpen(true);
        }}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
      />
      {popover}
    </div>
  );
});
