"use client";

import { useState, useMemo, useRef, useEffect, useId } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { normalizeCpfDigits } from "@/lib/cpf";
import type { Client } from "@/types";

function getClientManualPhoneDisplay(c: Client): string {
  const manual = c.manualPhone?.toString().trim() ?? "";
  if (!manual) return "Numero nao identificado";
  // Se vier como identificador "@lid" ou com letras, caimos no fallback.
  if (manual.includes("@") || /[a-z]/i.test(manual)) return "Numero nao identificado";
  return manual;
}

function formatClientLabel(c: Client): string {
  const phoneDisplay = getClientManualPhoneDisplay(c);
  if (c.name) return `${c.name} · ${phoneDisplay}`;
  return phoneDisplay;
}

export interface ClientComboboxProps {
  clients: Client[];
  value: string;
  onChange: (clientId: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** id para acessibilidade / label htmlFor */
  id?: string;
}

export function ClientCombobox({
  clients,
  value,
  onChange,
  placeholder = "Buscar ou selecionar cliente…",
  disabled,
  className,
  id,
}: ClientComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const selected = useMemo(
    () => clients.find((c) => c.id === value),
    [clients, value],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const digits = q.replace(/\D/g, "");
    if (!q) return clients;
    return clients.filter((c) => {
      const name = (c.name ?? "").toLowerCase();
      const phone = (c.phone ?? "").replace(/\D/g, "");
      const manual = (c.manualPhone ?? "").toLowerCase();
      const manualDigits = (c.manualPhone ?? "").replace(/\D/g, "");
      const email = (c.email ?? "").toLowerCase();
      const cpfDigits = normalizeCpfDigits(c.cpf ?? "");
      return (
        name.includes(q) ||
        email.includes(q) ||
        manual.includes(q) ||
        (digits.length > 0 && phone.includes(digits)) ||
        (digits.length > 0 && manualDigits.includes(digits)) ||
        (digits.length > 0 && cpfDigits.includes(digits))
      );
    });
  }, [clients, query]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const openMenu = () => {
    if (disabled) return;
    setQuery("");
    setOpen(true);
  };

  return (
    <div
      ref={rootRef}
      className={cn(
        "relative w-full",
        open && "z-50",
        className,
      )}
    >
      <div
        className={cn(
          "relative flex min-h-[47px] w-full items-center rounded-[4px] border bg-[#FAFAFA] dark:bg-[#212225] dark:border-[#40485A]",
          "border-[#727B8E]/10 px-[19px] py-2 pr-10",
          !disabled &&
            "cursor-text focus-within:border-[#1E62EC] focus-within:ring-1 focus-within:ring-[#1E62EC]/30",
          disabled && "opacity-50",
        )}
      >
        <input
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          disabled={disabled}
          placeholder={placeholder}
          value={open ? query : selected ? formatClientLabel(selected) : ""}
          readOnly={!open}
          onChange={(e) => {
            if (open) setQuery(e.target.value);
          }}
          onFocus={() => openMenu()}
          onClick={() => openMenu()}
          onKeyDown={(e) => {
            if (open && e.key === "Escape") {
              e.stopPropagation();
              setOpen(false);
            }
          }}
          className="w-full cursor-[inherit] bg-transparent font-be-vietnam-pro text-sm font-normal leading-5 text-[#434A57] outline-none placeholder:text-[#727B8E] dark:text-[#f5f9fc] dark:placeholder:text-[#8a94a6]"
        />
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          disabled={disabled}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (open) setOpen(false);
            else openMenu();
          }}
          className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded text-[#727B8E] transition-transform hover:bg-black/5 dark:text-[#8a94a6] dark:hover:bg-white/5"
        >
          <ChevronDown
            className={cn(
              "h-4 w-4 transition-transform",
              open && "rotate-180",
            )}
          />
        </button>
      </div>

      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-60 overflow-y-auto rounded-[4px] border border-[#727B8E]/15 bg-white py-1 shadow-lg dark:border-[#40485A] dark:bg-[#1A1B1D]"
        >
          {filtered.length === 0 ? (
            <li className="px-4 py-3 text-sm text-[#727B8E] dark:text-[#8a94a6]">
              Nenhum cliente encontrado
            </li>
          ) : (
            filtered.map((c) => (
              <li key={c.id} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={value === c.id}
                  className={cn(
                    "w-full px-4 py-2.5 text-left text-sm transition-colors hover:bg-[#F4F6F9] dark:hover:bg-[#212225]",
                    value === c.id &&
                      "bg-[#1E62EC]/10 dark:bg-[#2172e5]/15",
                  )}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onChange(c.id);
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  <span className="font-medium text-[#434A57] dark:text-[#f5f9fc]">
                    {c.name || "Sem nome"}
                  </span>
                  {getClientManualPhoneDisplay(c) ? (
                    <span className="mt-0.5 block text-xs text-[#727B8E] dark:text-[#8a94a6]">
                      {getClientManualPhoneDisplay(c)}
                    </span>
                  ) : null}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
