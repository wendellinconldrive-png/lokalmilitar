import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, formatBRL, formatDate } from "@/lib/api";
import { toast } from "sonner";
import { Download, Upload, Printer, FileText, FileSpreadsheet, Search, Trash2, ExternalLink, Plus, ChevronRight } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import ProductSearchSelect from "@/components/ProductSearchSelect";
import useSubmitLock from "@/hooks/useSubmitLock";
import { useAuth } from "@/contexts/AuthContext";
import { getStockHistoryRows } from "@/lib/stockHistory";
import { sortBySku } from "@/lib/utils";

const KIND_STYLE = {
  ENTRADA: "bg-green-100 text-green-800", SAIDA: "bg-red-100 text-red-800", AVARIA: "bg-red-200 text-red-900",
  DESMONTAGEM_SAIDA: "bg-amber-100 text-amber-800", DESMONTAGEM_ENTRADA: "bg-lime-100 text-lime-800",
  MONTAGEM_SAIDA: "bg-orange-100 text-orange-800", MONTAGEM_ENTRADA: "bg-blue-100 text-blue-800",
  SEM_BAIXA: "bg-amber-200 text-amber-950",
  DEVOLVIDO: "bg-yellow-100 text-yellow-900",
};
const KIND_LABEL = {
  DESMONTAGEM_SAIDA: "Desmont. (−)", DESMONTAGEM_ENTRADA: "Desmont. (+)",
  MONTAGEM_SAIDA: "Montagem (−)", MONTAGEM_ENTRADA: "Montagem (+)",
  SEM_BAIXA: "Sem baixa",
  DEVOLVIDO: "Devolvido",
};
const BLANK = { product_id: "", size: "", qty: 1, nf: "", reason: "", kind: "ENTRADA" };
const BLANK_ENTRY_ITEM = { product_id: "", size: "", qty: 1 };
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[character]));

const openPrint = (title, rows) => {
  const w = window.open("", "_blank");
  if (!w) return toast.error("Permita pop-ups para imprimir");
  w.document.write(`<html><head><title>${title}</title><style>
    body{font-family:Arial,sans-serif;padding:20px}h1{font-size:18px;margin:0 0 4px;color:#4B5320}
    table{width:100%;border-collapse:collapse;margin-top:10px}th{background:#111;color:#D9C9A0;text-align:left}
    th,td{border:1px solid #444;padding:4px 6px;font-size:11px}</style></head><body>
    <h1>LOKAL MILITAR — ${title}</h1><div style="font-size:11px">Emitido em ${new Date().toLocaleString("pt-BR")}</div>
    <table><thead><tr><th>SKU</th><th>Produto</th><th>Categoria</th><th>Tamanho</th><th>Quantidade</th></tr></thead>
    <tbody>${sortBySku(rows).map((r) => `<tr><td>${r.sku || ""}</td><td>${r.name}</td><td>${r.cat}</td><td>${r.size}</td><td>${r.stock}</td></tr>`).join("")}</tbody></table>
    <script>window.onload=()=>window.print()</script></body></html>`);
  w.document.close();
};

export default function Stock() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [products, setProducts] = useState([]);
  const [movements, setMovements] = useState([]);
  const [categories, setCategories] = useState([]);
  const [orders, setOrders] = useState([]);
  const [repairingOrders, setRepairingOrders] = useState(() => new Set());
  const [params] = useSearchParams();
  const [tab, setTab] = useState("posicao");
  const [q, setQ] = useState("");
  const [expandedGroups, setExpandedGroups] = useState(() => new Set());
  const [cat, setCat] = useState(params.get("cat") || "");
  const [subcategory, setSubcategory] = useState("");
  const [onlyLow, setOnlyLow] = useState(params.get("low") === "1");
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [entryItems, setEntryItems] = useState([BLANK_ENTRY_ITEM]);
  const [entryPrintOpen, setEntryPrintOpen] = useState(false);
  const [entrySearch, setEntrySearch] = useState("");
  const [entryDate, setEntryDate] = useState("");
  const [selectedEntryGroups, setSelectedEntryGroups] = useState(() => new Set());
  const [reconciliationOpen, setReconciliationOpen] = useState(false);
  const [reconciliationSearch, setReconciliationSearch] = useState("");
  const [countedQuantities, setCountedQuantities] = useState({});
  const { run: withSubmitLock, isPending } = useSubmitLock();

  const load = async () => {
    const [p, m, c, o] = await Promise.all([api.get("/products"), api.get("/stock_movements"), api.get("/categories"), api.get("/orders")]);
    setProducts(p.data); setMovements(m.data); setCategories(c.data); setOrders(o.data);
  };
  useEffect(() => { load(); }, []);
  const repairOrderStock = async (orderId) => {
    const order = orders.find((item) => item.id === orderId);
    if (!order) return toast.error("Pedido não encontrado. Atualize a tela e tente novamente.");
    setRepairingOrders((current) => new Set(current).add(orderId));
    try {
      await api.post(`/orders/${orderId}/repair-stock`);
      toast.success(`Baixa do pedido #${order.number} conferida e corrigida`);
      await load();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Não foi possível corrigir a baixa do pedido");
    } finally {
      setRepairingOrders((current) => {
        const next = new Set(current);
        next.delete(orderId);
        return next;
      });
    }
  };

  const catMap = useMemo(() => Object.fromEntries(categories.map((c) => [c.id, c.name])), [categories]);
  const topCategories = useMemo(() => categories.filter((category) => !category.parent_id), [categories]);
  const subcategories = useMemo(
    () => categories.filter((category) => category.parent_id && (!cat || topCategories.find((parent) => parent.name === cat)?.id === category.parent_id)),
    [categories, cat, topCategories],
  );
  const allRows = useMemo(() => products.flatMap((p) => (p.sizes || []).map((s) => ({
    id: `${p.id}:${s.size}`, product_id: p.id, sku: p.sku, name: p.name, cat: catMap[p.category_id] || "-", subcategory_id: p.subcategory_id || "", subcategory: catMap[p.subcategory_id] || "", size: s.size, stock: Number(s.stock || 0),
    min: Number(s.stock_min || 0), cost: p.cost, price: p.price, shelf: p.shelf,
  }))), [products, catMap]);
  const rows = allRows.filter((r) => (!cat || r.cat === cat) && (!subcategory || r.subcategory_id === subcategory) && (!onlyLow || (r.min > 0 && r.stock <= r.min))
    && (!q || (r.name + r.sku + r.size).toLowerCase().includes(q.toLowerCase())));
  const groupedRows = useMemo(() => {
    const groups = new Map();
    rows.forEach((row) => {
      const group = groups.get(row.product_id);
      if (group) group.push(row);
      else groups.set(row.product_id, [row]);
    });
    return [...groups.entries()].map(([id, variants]) => ({ id, variants, product: variants[0] }));
  }, [rows]);
  const totals = (list) => ({ items: list.reduce((s, r) => s + r.stock, 0), value: list.reduce((s, r) => s + r.stock * Number(r.price || 0), 0) });
  const all = totals(allRows);

  const printBy = (byCat) => {
    if (byCat && !cat) return toast.error("Selecione uma categoria no filtro");
    const list = byCat ? allRows.filter((r) => r.cat === cat) : allRows;
    openPrint(byCat ? `Estoque · ${cat}` : "Estoque completo", list);
  };
  const printReconciliationSheet = () => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return toast.error("Permita pop-ups para imprimir a conferência");
    const tableRows = sortBySku(allRows).map((row) => `
      <tr>
        <td>${escapeHtml(row.name)}</td>
        <td>${escapeHtml(row.size)}</td>
        <td>${escapeHtml(row.stock)}</td>
        <td class="count-cell"></td>
      </tr>`).join("");
    printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Conferência de estoque</title>
      <style>
        body{font:12px Arial,sans-serif;padding:24px;color:#222}
        h1{font-size:18px;color:#354017;margin:0 0 6px}
        p{margin:0 0 12px}
        table{width:100%;border-collapse:collapse}
        th,td{border:1px solid #888;padding:6px;text-align:left}
        th{background:#eee}
        .count-cell{width:22%;height:26px}
        @media print{body{padding:0}}
      </style></head><body>
      <h1>LOKAL MILITAR — Conferência de Estoque</h1>
      <p>Emitido em ${escapeHtml(new Date().toLocaleString("pt-BR"))}</p>
      <table><thead><tr><th>Produto</th><th>Tamanho</th><th>Quantidade atual</th><th>Contagem</th></tr></thead>
      <tbody>${tableRows}</tbody></table>
      <script>window.onload=()=>window.print()</script></body></html>`);
    printWindow.document.close();
  };
  const submitReconciliation = () => withSubmitLock("stock-reconciliation", async () => {
    const enteredRows = allRows.flatMap((row) => {
      const rawQuantity = countedQuantities[row.id];
      if (rawQuantity === undefined || rawQuantity.trim() === "") return [];
      const quantity = Number(rawQuantity);
      if (!Number.isFinite(quantity) || quantity < 0) return [{ invalid: true }];
      return [{ product_id: row.product_id, size: row.size, quantity }];
    });
    if (!enteredRows.length) return toast.error("Informe a contagem de ao menos um tamanho");
    if (enteredRows.some((row) => row.invalid)) return toast.error("Informe quantidades válidas e iguais ou maiores que zero");

    let updated;
    try {
      ({ data: { updated } } = await api.post("/stock_movements/reconcile", {
        items: enteredRows,
      }));
    } catch (error) {
      toast.error(error.response?.data?.detail || "Não foi possível aplicar a conferência do estoque");
      if (error.response?.status === 409) {
        setCountedQuantities({});
        try {
          await load();
        } catch {
          toast.error("Não foi possível atualizar o estoque após o conflito. Atualize a página antes de tentar novamente.");
        }
      }
      return;
    }

    toast.success(updated ? `${updated} quantidade(s) corrigida(s) no estoque` : "As quantidades informadas já estavam corretas");
    setCountedQuantities({});
    setReconciliationOpen(false);
    try {
      await load();
    } catch {
      toast.error("A conferência foi aplicada, mas não foi possível atualizar os dados da tela.");
    }
  });
  const reconciliationRows = allRows.filter((row) => (
    !reconciliationSearch
    || `${row.name} ${row.sku} ${row.size}`.toLocaleLowerCase().includes(reconciliationSearch.trim().toLocaleLowerCase())
  ));
  const exportExcel = () => {
    const head = ["SKU", "Produto", "Categoria", "Tamanho", "Qtd", "Custo", "Venda", "Local"];
    const csv = [head, ...rows.map((r) => [r.sku, r.name, r.cat, r.size, r.stock, r.cost, r.price, r.shelf || ""])]
      .map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(";")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv" })); a.download = "estoque-lokal-militar.csv"; a.click();
  };

  const product = products.find((p) => p.id === form.product_id);
  const submit = () => withSubmitLock("movement", async () => {
    if (modal === "in") {
      const invalidIndex = entryItems.findIndex((item) => (
        !item.product_id || !item.size || !Number.isFinite(Number(item.qty)) || Number(item.qty) <= 0
      ));
      if (invalidIndex >= 0) return toast.error(`Preencha produto, tamanho e quantidade do item ${invalidIndex + 1}`);

      for (let index = 0; index < entryItems.length; index += 1) {
        const item = entryItems[index];
        const itemProduct = products.find((p) => p.id === item.product_id);
        try {
          await api.post("/stock_movements", {
            ...item,
            nf: form.nf,
            reason: form.reason,
            kind: "ENTRADA",
            product_name: itemProduct?.name,
            sku: itemProduct?.sku,
          });
        } catch (error) {
          const remainingItems = entryItems.slice(index);
          setEntryItems(remainingItems);
          toast.error(
            `Não foi possível registrar o item ${index + 1}. ${index > 0 ? `${index} entrada(s) já foram registradas. ` : ""}${error.response?.data?.detail || "Revise os itens restantes e tente novamente."}`,
          );
          return;
        }
      }

      toast.success(`${entryItems.length} entrada(s) de estoque registrada(s)`);
      setModal(null); setForm(BLANK); setEntryItems([BLANK_ENTRY_ITEM]); load();
      return;
    }
    if (!form.product_id || !form.size || !form.qty) return toast.error("Produto, tamanho e quantidade são obrigatórios");
    await api.post("/stock_movements", { ...form, product_name: product?.name, sku: product?.sku });
    toast.success(form.kind === "ENTRADA" ? "Entrada registrada" : "Saída registrada");
    setModal(null); setForm(BLANK); load();
  });
  const delMov = async (id) => {
    if (!window.confirm("Excluir o registro e estornar sua quantidade no estoque?")) return;
    try {
      await api.delete(`/stock_movements/${id}`);
      toast.success("Registro excluído e estoque atualizado");
      load();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Não foi possível excluir o registro");
    }
  };
  const printOrder = (orderId) => {
    const order = orders.find((item) => item.id === orderId);
    if (!order) return toast.error("Pedido relacionado não encontrado");
    window.open(`/pedidos?printOrder=${encodeURIComponent(orderId)}`, "_blank", "noopener,noreferrer");
  };
  const entryGroups = useMemo(() => {
    const groupedEntries = new Map();
    movements.filter((movement) => movement.kind === "ENTRADA").forEach((entry) => {
      const nf = entry.nf?.trim() || "";
      const entryDate = entry.created_at?.slice(0, 10) || "";
      const groupKey = nf ? `nf:${nf}` : `without-nf:${entryDate}`;
      const group = groupedEntries.get(groupKey) || { nf, items: [] };
      group.items.push(entry);
      groupedEntries.set(groupKey, group);
    });
    return [...groupedEntries.entries()].map(([id, group]) => ({ id, ...group }));
  }, [movements]);
  const filteredEntryGroups = entryGroups.filter(({ nf, items }) => {
    const search = entrySearch.trim().toLocaleLowerCase();
    const matchesSearch = !search || `${nf} ${items.map((item) => `${item.product_name} ${item.sku || ""} ${item.reason || ""}`).join(" ")}`.toLocaleLowerCase().includes(search);
    const matchesDate = !entryDate || items.some((item) => item.created_at?.slice(0, 10) === entryDate);
    return matchesSearch && matchesDate;
  });
  const printSelectedEntries = () => {
    const groupsToPrint = entryGroups.filter(({ id }) => selectedEntryGroups.has(id));
    if (!groupsToPrint.length) return toast.error("Selecione ao menos uma entrada para imprimir");

    const sections = groupsToPrint.map(({ nf, items }) => {
      const orderedItems = [...items].sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
      const totalQuantity = orderedItems.reduce((total, item) => total + Number(item.qty || 0), 0);
      const dates = [...new Set(orderedItems.map((item) => formatDate(item.created_at)))];
      const reasons = [...new Set(orderedItems.map((item) => item.reason).filter(Boolean))];
      return `
        <section>
          <h2>${nf ? `Nota Fiscal ${escapeHtml(nf)}` : "Entrada sem número de NF"}</h2>
          <p>Data: ${escapeHtml(dates.join(" · ")) || "—"}${reasons.length ? ` · Observação: ${escapeHtml(reasons.join(" · "))}` : ""}</p>
          <table><thead><tr><th>SKU</th><th>Produto</th><th>Tamanho</th><th>Quantidade</th></tr></thead>
          <tbody>${orderedItems.map((item) => `<tr><td>${escapeHtml(item.sku || "")}</td><td>${escapeHtml(item.product_name)}</td><td>${escapeHtml(item.size || "—")}</td><td>${escapeHtml(item.qty)}</td></tr>`).join("")}</tbody></table>
          <p class="total">Total da entrada: ${escapeHtml(totalQuantity)}</p>
        </section>`;
    }).join("");
    const printWindow = window.open("", "_blank");
    if (!printWindow) return toast.error("Permita pop-ups para imprimir as entradas");
    printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Entradas de estoque</title>
      <style>body{font:12px Arial,sans-serif;padding:24px;color:#222}h1{font-size:20px;color:#354017}h2{font-size:15px;margin-bottom:4px;color:#354017}section{margin-top:24px;page-break-inside:avoid}p{margin:5px 0}table{width:100%;border-collapse:collapse;margin-top:8px}th,td{border:1px solid #aaa;padding:6px;text-align:left}th{background:#eee}.total{text-align:right;font-weight:bold}</style>
      </head><body><h1>LOKAL MILITAR — Entradas de Estoque</h1>
      <p>Emitido em ${escapeHtml(new Date().toLocaleString("pt-BR"))} · ${groupsToPrint.length} grupo(s) de entrada</p>
      ${sections}
      </body></html>`);
    printWindow.document.close();
    printWindow.setTimeout(() => printWindow.print(), 500);
    setEntryPrintOpen(false);
    setSelectedEntryGroups(new Set());
  };
  const movs = useMemo(() => {
    const search = q.trim().toLocaleLowerCase();
    return getStockHistoryRows(movements, orders).filter((movement) => (
      !search || `${movement.product_name} ${movement.reason || ""} ${movement.sku || ""} ${movement.nf || ""} ${movement.order_number || ""}`
        .toLocaleLowerCase().includes(search)
    ));
  }, [movements, orders, q]);

  return (
    <div data-testid="stock-page">
      <div className="lm-page-head flex items-end justify-between gap-3 flex-wrap">
        <div><h1>Estoque — Entrada / Saída</h1><p>{all.items} itens · {formatBRL(all.value)} em valor de venda</p></div>
        <div className="flex gap-2">
          <button className="lm-btn lm-btn-olive" onClick={() => { setForm({ ...BLANK, kind: "ENTRADA" }); setEntryItems([BLANK_ENTRY_ITEM]); setModal("in"); }} data-testid="btn-entry"><Download size={16} />Entrada (NF)</button>
          <button className="lm-btn lm-btn-red" onClick={() => { setForm({ ...BLANK, kind: "SAIDA" }); setModal("out"); }} data-testid="btn-exit"><Upload size={16} />Saída / Avaria</button>
        </div>
      </div>

      <div className="lm-card p-3 flex flex-wrap gap-2 mb-4">
        <button className="lm-btn lm-btn-dark" onClick={() => printBy(false)} data-testid="btn-print-full"><Printer size={15} />Imprimir estoque completo A4</button>
        <button className="lm-btn lm-btn-outline" onClick={() => { setCountedQuantities({}); setReconciliationSearch(""); setReconciliationOpen(true); }} data-testid="btn-stock-reconciliation"><FileText size={15} />Conferência de estoque</button>
        <button className="lm-btn lm-btn-dark" onClick={() => printBy(true)} data-testid="btn-print-cat"><Printer size={15} />Imprimir estoque por categoria</button>
        <button className="lm-btn lm-btn-gold" onClick={() => openPrint("Estoque", rows)} data-testid="btn-export-pdf"><FileText size={15} />Exportar PDF</button>
        <button className="lm-btn lm-btn-outline" onClick={exportExcel} data-testid="btn-export-excel"><FileSpreadsheet size={15} />Exportar Excel</button>
      </div>

      <div className="flex flex-wrap gap-2 mb-3 items-stretch">
        <div className="lm-seg">
          <button className={tab === "posicao" ? "on" : ""} onClick={() => setTab("posicao")} data-testid="tab-posicao">Posição atual</button>
          <button className={tab === "historico" ? "on" : ""} onClick={() => setTab("historico")} data-testid="tab-historico">Histórico</button>
        </div>
        {tab === "historico" && (
          <button
            className="lm-btn lm-btn-dark"
            onClick={() => {
              setEntrySearch("");
              setEntryDate("");
              setSelectedEntryGroups(new Set());
              setEntryPrintOpen(true);
            }}
            data-testid="btn-print-nf-entries"
          >
            <Printer size={15} />Imprimir entradas de estoque
          </button>
        )}
        <div className="relative flex-1 min-w-[200px]"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input className="lm-input lm-search-input h-full" placeholder="Buscar..." value={q} onChange={(e) => setQ(e.target.value)} data-testid="stock-search" /></div>
        <select className="lm-input !w-56" value={cat} onChange={(e) => { setCat(e.target.value); setSubcategory(""); }} data-testid="stock-cat-filter">
          <option value="">Todas categorias</option>{topCategories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
        </select>
        <select className="lm-input !w-56" value={subcategory} onChange={(e) => setSubcategory(e.target.value)} data-testid="stock-subcategory-filter">
          <option value="">Todas subcategorias</option>{subcategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <label className="lm-btn lm-btn-outline cursor-pointer"><input type="checkbox" checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} data-testid="stock-only-low" />Só estoque baixo</label>
      </div>

      <div className="lm-table-wrap overflow-x-auto">
        {tab === "posicao" ? (
          <table className="lm-table">
            <thead><tr><th>SKU</th><th>Produto</th><th>Categoria</th><th>Tamanho</th><th>Qtd</th><th>Custo</th><th>Venda</th><th>Local</th></tr></thead>
            <tbody>
              {groupedRows.map(({ id, variants, product: r }) => {
                const isGroup = variants.length > 1;
                const isExpanded = expandedGroups.has(id);
                const groupStock = variants.reduce((total, variant) => total + variant.stock, 0);
                const groupIsLow = variants.some((variant) => variant.min > 0 && variant.stock <= variant.min);
                return (
                  <React.Fragment key={id}>
                    <tr>
                      <td className="text-xs">{r.sku}</td>
                      <td className="font-head">
                        <div className="flex items-center gap-1">
                          {isGroup && (
                            <button
                              type="button"
                              className="rounded p-1 hover:bg-black/10"
                              onClick={() => setExpandedGroups((current) => {
                                const next = new Set(current);
                                if (next.has(id)) next.delete(id);
                                else next.add(id);
                                return next;
                              })}
                              aria-expanded={isExpanded}
                              aria-label={`${isExpanded ? "Recolher" : "Expandir"} variedades de ${r.name}`}
                              data-testid={`stock-group-toggle-${id}`}
                            >
                              <ChevronRight size={16} className={`transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                            </button>
                          )}
                          <span>{r.name}</span>
                        </div>
                      </td>
                      <td>{r.cat}</td>
                      <td><span className="chip">{isGroup ? `${variants.length} variedades` : r.size}</span></td>
                      <td><span className={`chip ${groupIsLow ? "chip-low" : ""}`}>{groupStock}</span></td>
                      <td>{formatBRL(r.cost)}</td><td>{formatBRL(r.price)}</td><td>{r.shelf}</td>
                    </tr>
                    {isGroup && isExpanded && variants.map((variant) => (
                      <tr key={variant.id} className="bg-black/[0.03]">
                        <td className="text-xs">{variant.sku}</td>
                        <td className="font-head pl-10">{variant.name}</td>
                        <td>{variant.cat}</td>
                        <td><span className="chip">{variant.size}</span></td>
                        <td><span className={`chip ${variant.min > 0 && variant.stock <= variant.min ? "chip-low" : ""}`}>{variant.stock}</span></td>
                        <td>{formatBRL(variant.cost)}</td><td>{formatBRL(variant.price)}</td><td>{variant.shelf}</td>
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={8} className="text-center text-neutral-500 py-8">Nenhum item.</td></tr>}
            </tbody>
          </table>
        ) : (
          <table className="lm-table">
            <thead><tr><th>Data</th><th>Tipo</th><th>Produto</th><th>Tam</th><th>Qtd.</th><th>Venda</th><th>Motivo</th><th>NF</th><th></th></tr></thead>
            <tbody>
              {movs.map((m) => (
                <tr key={m.id}>
                  <td className="text-xs whitespace-nowrap">{formatDate(m.created_at)}</td>
                  <td><span className={`badge ${KIND_STYLE[m.kind] || "bg-neutral-200"}`}>{KIND_LABEL[m.kind] || m.kind}</span></td>
                  <td className="font-head">{m.product_name}{m.order_id && <button className="ml-2 inline-flex items-center gap-1 text-xs underline" onClick={() => printOrder(m.order_id)} title="Abrir impressão A4 do pedido"><ExternalLink size={12} />Pedido #{m.order_number || orders.find((o) => o.id === m.order_id)?.number || ""}</button>}</td>
                  <td><span className="chip">{m.size}</span></td>
                  <td>{m.qty}{m.groupedCount > 1 && <div className="text-xs text-neutral-500">{m.groupedCount} movimentações</div>}</td>
                  <td>
                    {m.expectedQty == null ? "—" : (
                      <span className={m.reconciliation === "matched" ? "text-green-800" : "font-semibold text-red-700"} data-testid="stock-history-reconciliation">
                        {m.expectedQty}
                        {m.reconciliation === "matched" ? " · OK" : m.reconciliation === "missing" ? " · Sem saída" : ` · Histórico ${m.qty > m.expectedQty ? "+" : ""}${m.qty - m.expectedQty}`}
                      </span>
                    )}
                  </td>
                  <td className="text-sm">{m.reason}</td><td>{m.nf}</td>
                  <td className="whitespace-nowrap">
                    {isAdmin && m.order_id && m.reconciliation && m.reconciliation !== "matched" && (
                      <button
                        className="text-xs underline mr-2 disabled:opacity-50"
                        onClick={() => repairOrderStock(m.order_id)}
                        disabled={repairingOrders.has(m.order_id)}
                        data-testid={`repair-order-stock-${m.order_id}`}
                      >
                        {repairingOrders.has(m.order_id) ? "Corrigindo..." : "Corrigir baixa"}
                      </button>
                    )}
                    {!m.order_id && <button className="p-1 hover:bg-red-100 rounded" onClick={() => delMov(m.id)} aria-label="Excluir movimentação e estornar estoque"><Trash2 size={14} /></button>}
                  </td>
                </tr>
              ))}
              {movs.length === 0 && <tr><td colSpan={9} className="text-center text-neutral-500 py-8">Sem movimentações.</td></tr>}
            </tbody>
          </table>
        )}
      </div>

      <Dialog open={!!modal} onOpenChange={(o) => !o && setModal(null)}>
        <DialogContent data-testid="stock-modal">
          <DialogHeader><DialogTitle className="font-head">{modal === "in" ? "Entrada por NF" : "Saída / Avaria"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {modal === "in" ? (
              <>
                <div className="space-y-3 max-h-[45vh] overflow-y-auto pr-1">
                  {entryItems.map((item, index) => {
                    const itemProduct = products.find((p) => p.id === item.product_id);
                    return (
                      <div key={index} className="border rounded p-3 space-y-2" data-testid={`entry-item-${index}`}>
                        <div className="flex items-center justify-between">
                          <span className="font-head text-sm">Produto {index + 1}</span>
                          {entryItems.length > 1 && (
                            <button type="button" className="p-1 text-red-700 hover:bg-red-100 rounded" onClick={() => setEntryItems(entryItems.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remover produto ${index + 1}`} data-testid={`remove-entry-item-${index}`}>
                              <Trash2 size={16} />
                            </button>
                          )}
                        </div>
                        <ProductSearchSelect
                          products={products}
                          value={item.product_id}
                          onChange={(productId) => setEntryItems(entryItems.map((entry, itemIndex) => itemIndex === index ? { ...entry, product_id: productId, size: "" } : entry))}
                          inputClassName="lm-input"
                          testid={index === 0 ? "mov-product" : `mov-product-${index}`}
                        />
                        <div className="grid grid-cols-[1fr_120px] gap-2">
                          <select className="lm-input" value={item.size} onChange={(e) => setEntryItems(entryItems.map((entry, itemIndex) => itemIndex === index ? { ...entry, size: e.target.value } : entry))} data-testid={index === 0 ? "mov-size" : `mov-size-${index}`}>
                            <option value="">— Tamanho —</option>{(itemProduct?.sizes || []).map((s) => <option key={s.size} value={s.size}>{s.size} (atual {s.stock})</option>)}
                          </select>
                          <input className="lm-input" type="number" min="0.01" step="any" placeholder="Quantidade" value={item.qty} onChange={(e) => setEntryItems(entryItems.map((entry, itemIndex) => itemIndex === index ? { ...entry, qty: e.target.value } : entry))} data-testid={index === 0 ? "mov-qty" : `mov-qty-${index}`} />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <button type="button" className="lm-btn lm-btn-outline w-full justify-center" onClick={() => setEntryItems([...entryItems, { ...BLANK_ENTRY_ITEM }])} data-testid="add-entry-item">
                  <Plus size={16} />Adicionar outro produto
                </button>
              </>
            ) : (
              <>
                <ProductSearchSelect
                  products={products}
                  value={form.product_id}
                  onChange={(productId) => setForm({ ...form, product_id: productId, size: "" })}
                  inputClassName="lm-input"
                  testid="mov-product"
                />
                <select className="lm-input" value={form.size} onChange={(e) => setForm({ ...form, size: e.target.value })} data-testid="mov-size">
                  <option value="">— Tamanho —</option>{(product?.sizes || []).map((s) => <option key={s.size} value={s.size}>{s.size} (atual {s.stock})</option>)}
                </select>
                <input className="lm-input" type="number" min="1" placeholder="Quantidade" value={form.qty} onChange={(e) => setForm({ ...form, qty: Number(e.target.value) })} data-testid="mov-qty" />
              </>
            )}
            {modal === "in" && <input className="lm-input" placeholder="Número da NF" value={form.nf} onChange={(e) => setForm({ ...form, nf: e.target.value })} data-testid="mov-nf" />}
            {modal === "out" && (
              <select className="lm-input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} data-testid="mov-kind">
                <option value="SAIDA">Saída manual</option><option value="AVARIA">Avaria</option>
              </select>
            )}
            <input className="lm-input" placeholder="Observação / motivo" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} data-testid="mov-reason" />
            <button className={`lm-btn w-full justify-center ${modal === "in" ? "lm-btn-olive" : "lm-btn-red"}`} onClick={submit} disabled={isPending("movement")} data-testid="mov-submit">
              {isPending("movement") ? "Registrando..." : "Registrar"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={entryPrintOpen} onOpenChange={setEntryPrintOpen}>
        <DialogContent className="max-w-2xl" data-testid="entry-print-dialog">
          <DialogHeader>
            <DialogTitle className="font-head">Selecionar entradas para impressão</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-neutral-600">Filtre por produto, SKU, número da NF ou data e marque as entradas que deseja imprimir.</p>
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <input
                className="lm-input"
                placeholder="Buscar produto, SKU ou número da NF..."
                value={entrySearch}
                onChange={(event) => setEntrySearch(event.target.value)}
                data-testid="entry-print-search"
              />
              <label className="flex items-center gap-2 text-sm">
                Data da entrada
                <input
                  type="date"
                  className="lm-input"
                  value={entryDate}
                  onChange={(event) => setEntryDate(event.target.value)}
                  data-testid="entry-print-date"
                />
              </label>
            </div>
            <div className="flex items-center justify-between gap-2 text-sm">
              <span>{filteredEntryGroups.length} entrada(s) encontrada(s)</span>
              <button
                type="button"
                className="text-olive-800 underline"
                onClick={() => setSelectedEntryGroups(new Set(filteredEntryGroups.map(({ id }) => id)))}
                disabled={!filteredEntryGroups.length}
                data-testid="entry-print-select-filtered"
              >
                Selecionar resultados
              </button>
            </div>
            <div className="max-h-64 space-y-2 overflow-y-auto rounded border p-2">
              {filteredEntryGroups.map(({ id, nf, items }) => {
                const dates = [...new Set(items.map((item) => item.created_at?.slice(0, 10)).filter(Boolean))];
                const productsInGroup = [...new Set(items.map((item) => item.product_name).filter(Boolean))];
                const quantity = items.reduce((total, item) => total + Number(item.qty || 0), 0);
                return (
                  <label key={id} className="flex cursor-pointer items-start gap-3 rounded border p-3 hover:bg-[#F4EFE3]">
                    <input
                      type="checkbox"
                      checked={selectedEntryGroups.has(id)}
                      onChange={(event) => setSelectedEntryGroups((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(id);
                        else next.delete(id);
                        return next;
                      })}
                      data-testid={`entry-print-select-${id}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{nf ? `NF ${nf}` : "Entrada sem número de NF"}</span>
                      <span className="block truncate text-sm text-neutral-600">{productsInGroup.join(", ") || "Produto não identificado"}</span>
                      <span className="block text-xs text-neutral-500">
                        {dates.map((date) => formatDate(date)).join(" · ") || "Data não informada"} · {items.length} item(ns) · Quantidade: {quantity}
                      </span>
                    </span>
                  </label>
                );
              })}
              {filteredEntryGroups.length === 0 && (
                <p className="py-6 text-center text-sm text-neutral-500">Nenhuma entrada encontrada para os filtros informados.</p>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className="lm-btn lm-btn-outline" onClick={() => setEntryPrintOpen(false)}>Cancelar</button>
              <button
                type="button"
                className="lm-btn lm-btn-olive"
                onClick={printSelectedEntries}
                disabled={selectedEntryGroups.size === 0}
                data-testid="entry-print-confirm"
              >
                <Printer size={15} />Imprimir selecionadas ({selectedEntryGroups.size})
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={reconciliationOpen} onOpenChange={setReconciliationOpen}>
        <DialogContent className="max-w-4xl" data-testid="stock-reconciliation-dialog">
          <DialogHeader>
            <DialogTitle className="font-head">Conferência de estoque</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-neutral-600">
            Imprima a folha para contagem ou informe a quantidade conferida. Campos em branco não alteram o estoque.
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              className="lm-input min-w-[200px] flex-1"
              placeholder="Buscar produto ou tamanho..."
              value={reconciliationSearch}
              onChange={(event) => setReconciliationSearch(event.target.value)}
              data-testid="stock-reconciliation-search"
            />
            <button type="button" className="lm-btn lm-btn-dark" onClick={printReconciliationSheet} data-testid="btn-print-stock-reconciliation">
              <Printer size={15} />Imprimir folha de contagem
            </button>
          </div>
          <div className="max-h-[55vh] overflow-auto rounded border">
            <table className="lm-table">
              <thead className="sticky top-0">
                <tr><th>Produto</th><th>Tamanho</th><th>Quantidade atual</th><th>Contagem</th></tr>
              </thead>
              <tbody>
                {reconciliationRows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.name}</td>
                    <td>{row.size}</td>
                    <td>{row.stock}</td>
                    <td>
                      <input
                        className="lm-input !w-32"
                        type="number"
                        min="0"
                        step="any"
                        value={countedQuantities[row.id] ?? ""}
                        onChange={(event) => setCountedQuantities((current) => ({ ...current, [row.id]: event.target.value }))}
                        aria-label={`Contagem de ${row.name}, tamanho ${row.size}`}
                        data-testid={`stock-count-${row.id}`}
                      />
                    </td>
                  </tr>
                ))}
                {reconciliationRows.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-neutral-500">Nenhum tamanho encontrado.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="lm-btn lm-btn-outline" onClick={() => setReconciliationOpen(false)}>Cancelar</button>
            <button
              type="button"
              className="lm-btn lm-btn-olive"
              onClick={submitReconciliation}
              disabled={isPending("stock-reconciliation")}
              data-testid="btn-submit-stock-reconciliation"
            >
              {isPending("stock-reconciliation") ? "Aplicando..." : "Finalizar e corrigir estoque"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
