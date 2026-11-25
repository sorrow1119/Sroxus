import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";

export default function ImageModelPicker({ label, value, models, onChange }: { label: string; value: string; models: string[]; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const all = [...new Set([...models, ...(value ? [value] : [])])];
  const filtered = all.filter((model) => model.toLowerCase().includes(search.trim().toLowerCase()));
  const manual = Boolean(search.trim() && !all.includes(search.trim()));
  const options = [...filtered, ...(manual ? [search.trim()] : [])];
  const select = (model: string) => { onChange(model); setOpen(false); trigger.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  return <div className="iw-model-picker" ref={root}>
    <button ref={trigger} type="button" className="iw-model-trigger" role="combobox" aria-label={label} aria-expanded={open} aria-haspopup="listbox" title={value || label} onClick={() => { setSearch(""); setActive(0); setOpen((state) => !state); }}><span>{value || "选择模型"}</span><small>{all.length}</small><ChevronDown size={14} /></button>
    {open && <div className="iw-model-menu">
      <div className="iw-search"><Search size={14} /><input ref={input} aria-label={`搜索${label}`} placeholder="搜索或手动输入模型名" value={search} onChange={(event) => { setSearch(event.target.value); setActive(0); }} onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setActive((index) => Math.max(0, Math.min(options.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))); }
        if (event.key === "Enter" && options[active]) { event.preventDefault(); select(options[active]); }
      }} /></div>
      <div role="listbox" aria-label={`${label}列表`} className="iw-model-list">{options.map((model, index) => <button key={model} role="option" aria-selected={model === value} data-active={index === active} title={model} onMouseEnter={() => setActive(index)} onClick={() => select(model)}><span>{model}{manual && index === options.length - 1 ? " · 手动输入" : ""}</span>{model === value && <Check size={15} />}</button>)}{!options.length && <span className="iw-muted">暂无已启用模型</span>}</div>
    </div>}
  </div>;
}
