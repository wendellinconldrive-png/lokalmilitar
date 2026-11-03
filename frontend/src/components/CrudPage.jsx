import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Plus, Edit, Trash2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import useSubmitLock from "@/hooks/useSubmitLock";

export const CrudPage = ({ title, subtitle, endpoint, fields, columns, defaults = {}, filter, testid, footer, rowActions, prepareEdit, headerContent, onSaved }) => {
  const [rows, setRows] = useState([]);
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState("");
  const { run: withSubmitLock, isPending } = useSubmitLock();

  const load = () => api.get(`/${endpoint}`).then((r) => setRows(filter ? r.data.filter(filter) : r.data));
  useEffect(() => { load(); }, [endpoint]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = () => withSubmitLock("save", async () => {
    const isHidden = (field) => typeof field.hidden === "function" ? field.hidden(editing) : !!field.hidden;
    const missing = fields.find((f) => !isHidden(f) && f.required && !editing[f.key]);
    if (missing) return toast.error(`${missing.label} é obrigatório`);
    const payload = { ...editing };
    fields.forEach((f) => { if (f.type === "number") payload[f.key] = Number(payload[f.key] || 0); });
    try {
      if (payload.id) await api.put(`/${endpoint}/${payload.id}`, payload);
      else await api.post(`/${endpoint}`, payload);
      onSaved?.(payload);
      toast.success("Registro salvo");
      setEditing(null); load();
    } catch (e) { toast.error(e.response?.data?.detail || "Erro ao salvar"); }
  });

  const remove = async (id) => {
    if (!window.confirm("Excluir registro?")) return;
    try {
      await api.delete(`/${endpoint}/${id}`);
      toast.success("Removido");
      load();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Não foi possível excluir o registro");
    }
  };

  const shown = rows.filter((r) => !search || JSON.stringify(r).toLowerCase().includes(search.toLowerCase()));

  return (
    <div data-testid={testid}>
      <header className="lm-page-head flex items-end justify-between flex-wrap gap-2">
        <div>
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button className="lm-btn lm-btn-olive" onClick={() => setEditing({ ...defaults })} data-testid={`${testid}-new`}>
          <Plus size={14} /> Novo
        </button>
      </header>
      {headerContent}
      <input placeholder="Buscar..." value={search} onChange={(e) => setSearch(e.target.value)}
        className="lm-input md:!w-80 mb-3" data-testid={`${testid}-search`} />
      <div className="lm-table-wrap overflow-x-auto">
        <table className="lm-table">
          <thead>
            <tr>{columns.map((c) => <th key={c.label} className="text-left p-2">{c.label}</th>)}<th className="p-2">AÇÕES</th></tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} className="border-t hover:bg-neutral-50" data-testid={`${testid}-row`}>
                {columns.map((c) => <td key={c.label} className="p-2">{c.render ? c.render(r) : r[c.key]}</td>)}
                <td className="p-2 whitespace-nowrap">
                  <button className="p-1 hover:bg-neutral-200" onClick={() => setEditing(prepareEdit ? prepareEdit(r) : { ...r })} data-testid={`${testid}-edit-${r.id}`}><Edit size={13} /></button>
                  {rowActions?.(r, load)}
                  <button className="p-1 hover:bg-red-100 text-red-700" onClick={() => remove(r.id)} data-testid={`${testid}-delete-${r.id}`}><Trash2 size={13} /></button>
                </td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={columns.length + 1} className="p-6 text-center text-neutral-500 text-xs">Nenhum registro.</td></tr>}
          </tbody>
        </table>
      </div>
      {footer && footer(shown)}

      <Sheet open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <SheetContent className="w-full md:max-w-2xl overflow-y-auto" style={{ background: "#FBF9F4" }}>
          <SheetHeader><SheetTitle className="lokal-stencil">{editing?.id ? "Editar" : "Novo"} · {title}</SheetTitle></SheetHeader>
          {editing && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
              {fields.filter((f) => !(typeof f.hidden === "function" ? f.hidden(editing) : f.hidden)).map((f) => (
                <label key={f.key} className={f.wide ? "md:col-span-2" : ""}>
                  <div className="text-[11px] font-mono text-neutral-500 mb-1">{f.label}{f.required ? " *" : ""}</div>
                  {f.type === "multiselect" ? (
                    <div className="crud-input space-y-1">
                      {(typeof f.options === "function" ? f.options(editing) : f.options || []).map((option) => {
                        const value = option.value ?? option;
                        const label = option.label ?? option;
                        const selectedValues = editing[f.key] ?? f.defaultValue?.(editing) ?? [];
                        return (
                          <div key={value} className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={selectedValues.includes(value)}
                              onChange={(event) => {
                                const nextValues = event.target.checked
                                  ? [...selectedValues, value]
                                  : selectedValues.filter((item) => item !== value);
                                setEditing({ ...editing, ...(f.onChange ? f.onChange(nextValues, editing) : { [f.key]: nextValues }) });
                              }}
                              aria-label={label}
                              data-testid={`field-${f.key}-${value}`}
                            />
                            <span>{label}</span>
                          </div>
                        );
                      })}
                    </div>
                  ) : f.type === "select" ? (
                    <select className="crud-input" value={editing[f.key] ?? ""} onChange={(e) => {
                      const value = e.target.value;
                      setEditing({ ...editing, ...(f.onChange ? f.onChange(value, editing) : { [f.key]: value }) });
                    }} data-testid={`field-${f.key}`}>
                      <option value="">—</option>
                      {(typeof f.options === "function" ? f.options(editing) : f.options || []).map((o) => <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>)}
                    </select>
                  ) : f.type === "textarea" ? (
                    <textarea className="crud-input" rows={3} value={editing[f.key] ?? ""} onChange={(e) => setEditing({ ...editing, ...(f.onChange ? f.onChange(e.target.value, editing) : { [f.key]: e.target.value }) })} data-testid={`field-${f.key}`} />
                  ) : f.type === "checkbox" ? (
                    <input className="crud-input" type="checkbox" checked={!!editing[f.key]} onChange={(e) => setEditing({ ...editing, ...(f.onChange ? f.onChange(e.target.checked, editing) : { [f.key]: e.target.checked }) })} data-testid={`field-${f.key}`} />
                  ) : (
                    <>
                      <input className="crud-input" type={f.type || "text"} step={f.type === "number" ? "0.01" : undefined}
                        readOnly={typeof f.readOnly === "function" ? f.readOnly(editing) : f.readOnly}
                        list={f.suggestions ? `crud-suggestions-${testid}-${f.key}` : undefined}
                        value={editing[f.key] ?? ""} onChange={(e) => setEditing({ ...editing, ...(f.onChange ? f.onChange(e.target.value, editing) : { [f.key]: e.target.value }) })} data-testid={`field-${f.key}`} />
                      {f.suggestions && (
                        <datalist id={`crud-suggestions-${testid}-${f.key}`}>
                          {(typeof f.suggestions === "function" ? f.suggestions(editing) : f.suggestions).map((suggestion) => (
                            <option key={suggestion} value={suggestion} />
                          ))}
                        </datalist>
                      )}
                    </>
                  )}
                </label>
              ))}
              <div className="md:col-span-2 flex gap-2 pt-3">
                <button className="lokal-btn-primary" onClick={save} disabled={isPending("save")} data-testid={`${testid}-save`}>
                  {isPending("save") ? "SALVANDO..." : "SALVAR"}
                </button>
                <button className="px-4 py-2 border rounded-sm" onClick={() => setEditing(null)}>Cancelar</button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
      <style>{`.crud-input{width:100%;border:1px solid #ccc;padding:6px 8px;border-radius:2px;font-size:13px}`}</style>
    </div>
  );
};
