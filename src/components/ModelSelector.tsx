import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n";
import type { ModelChoice } from "../hooks/useChatStore";

interface ModelSelectorProps {
  choices: ModelChoice[];
  selected: ModelChoice | null;
  disabled?: boolean;
  onSelect: (choice: ModelChoice | null) => void;
}

type ModelCapability = "text" | "vision" | "tools" | "web" | "reasoning";

export default function ModelSelector({ choices, selected, disabled, onSelect }: ModelSelectorProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) {
      return choices;
    }
    return choices.filter((choice) => {
      const haystack = `${choice.providerName} ${choice.model} ${choice.label}`.toLowerCase();
      return haystack.includes(keyword);
    });
  }, [choices, query]);

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    window.addEventListener("mousedown", handleClick);
    return () => window.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  return (
    <div ref={rootRef} className="relative w-[320px] max-w-[34vw]">
      <button
        type="button"
        disabled={disabled || !choices.length}
        onClick={() => {
          setOpen((value) => !value);
          setQuery("");
        }}
        className="flex h-9 w-full items-center justify-between gap-2 rounded-md border border-[#343b49] bg-[#0f1117] px-3 text-left text-sm text-slate-100 outline-none hover:bg-[#151820] disabled:cursor-not-allowed disabled:opacity-60"
        title={t("models.selectTitle")}
      >
        <span className="min-w-0 flex-1 truncate">{selected ? selected.label : t("models.empty")}</span>
        <span className="shrink-0 text-xs text-slate-500">v</span>
      </button>

      {open && (
        <div className="absolute right-0 top-10 z-30 w-[420px] overflow-hidden rounded-md border border-[#343b49] bg-[#151820] shadow-2xl">
          <div className="border-b border-[#2a2f3a] p-2">
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("models.search")}
              className="h-9 w-full rounded-md border border-[#343b49] bg-[#0f1117] px-3 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-[#3b82f6]"
            />
          </div>
          <div className="max-h-80 overflow-y-auto p-1">
            {filtered.length ? (
              filtered.map((choice) => {
                const active = selected?.providerId === choice.providerId && selected.model === choice.model;
                return (
                  <button
                    key={`${choice.providerId}::${choice.model}`}
                    type="button"
                    onClick={() => {
                      onSelect(choice);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center gap-3 rounded px-2 py-2 text-left text-sm ${
                      active ? "bg-[#243047] text-slate-100" : "text-slate-300 hover:bg-[#202633]"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{choice.model}</div>
                      <div className="truncate text-xs text-slate-500">{choice.providerName}</div>
                    </div>
                    <CapabilityBadges capabilities={choice.capabilities} />
                  </button>
                );
              })
            ) : (
              <div className="px-3 py-6 text-center text-sm text-slate-500">{t("models.noMatch")}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CapabilityBadges({ capabilities }: { capabilities: ModelCapability[] }) {
  const { t } = useI18n();

  if (!capabilities.length) {
    return <span className="shrink-0 text-xs text-slate-600">{t("models.text")}</span>;
  }
  return (
    <div className="flex shrink-0 flex-wrap justify-end gap-1">
      {capabilities.map((capability) => (
        <span
          key={capability}
          title={capabilityLabel(t, capability)}
          className="rounded border border-[#3b4658] bg-[#101620] px-1.5 py-0.5 text-[11px] text-slate-300"
        >
          {capabilityLabel(t, capability)}
        </span>
      ))}
    </div>
  );
}

function matchesAny(value: string, needles: string[]) {
  return needles.some((needle) => value.includes(needle));
}

function capabilityLabel(t: (key: string) => string, capability: ModelCapability) {
  if (capability === "vision") {
    return t("models.vision");
  }
  if (capability === "tools") {
    return t("models.tools");
  }
  return t("models.web");
}

