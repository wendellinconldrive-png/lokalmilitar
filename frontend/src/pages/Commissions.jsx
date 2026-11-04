import React, { useEffect, useMemo, useState } from "react";
import { api, formatBRL, formatDateShort } from "@/lib/api";
import { toast } from "sonner";
import { FileSpreadsheet, Printer, CircleCheck, UserPlus, Trash2, Pencil } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import CustomerSignaturePad from "@/components/CustomerSignaturePad";
import CustomerAddressFields from "@/components/CustomerAddressFields";
import { formatCustomerPhone } from "@/lib/customerFields";
import { getCurrentMonth, inPeriod, periodLabel } from "@/lib/commissionPeriod";
import useSubmitLock from "@/hooks/useSubmitLock";

const PERIODS = [["hoje", "Hoje"], ["semana", "Semana"], ["mes", "Mês"], ["todos", "Todos"]];
const EMPTY_VENDOR = {
  name: "", phone: "", cpf: "", cep: "", address_number: "",
  address: "", distance_km: 0, signature: "",
};
function VendorsPanel({ vendors, onEdit, onDelete }) {
  return (
    <div className="lm-card p-4" data-testid="vendors-panel">
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-head text-lg font-semibold">Funcionários</h2>
        <span className="text-xs text-neutral-500">{vendors.length} cadastrado(s)</span>
      </div>
      <div className="max-h-44 space-y-1 overflow-y-auto">
        {vendors.map((v) => (
          <div key={v.id} className="flex items-center justify-between gap-2 bg-[#E8E2D5] rounded px-3 py-2 font-head text-sm">
            <div className="min-w-0">
              <div className="truncate">{v.name}</div>
              <div className="font-body text-xs">{formatCustomerPhone(v.phone) || "Sem telefone"}{v.cpf ? ` · CPF ${v.cpf}` : ""}</div>
            </div>
            <div className="flex shrink-0">
              <button onClick={() => onEdit(v)} title="Editar dados do funcionário" data-testid={`vendor-edit-${v.id}`}><Pencil size={14} /></button>
              <button onClick={() => onDelete(v.id)} title="Remover funcionário" data-testid={`vendor-del-${v.id}`}><Trash2 size={14} /></button>
            </div>
          </div>
        ))}
        {vendors.length === 0 && <div className="text-xs text-neutral-500">Nenhum funcionário cadastrado.</div>}
      </div>
    </div>
  );
}

export default function Commissions() {
  const [rows, setRows] = useState([]);
  const [orders, setOrders] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [stockMovements, setStockMovements] = useState([]);
  const [vendor, setVendor] = useState("ALL");
  const [period, setPeriod] = useState("mes");
  const [selectedMonth, setSelectedMonth] = useState(getCurrentMonth);
  const [paidF, setPaidF] = useState("all");
  const [vendorDialogOpen, setVendorDialogOpen] = useState(false);
  const [vendorForm, setVendorForm] = useState(EMPTY_VENDOR);
  const [editingVendorId, setEditingVendorId] = useState("");
  const { run: withSubmitLock, isPending } = useSubmitLock();

  const load = async () => {
    try {
      const [c, o, v, movements] = await Promise.all([
        api.get("/commissions"), api.get("/orders"), api.get("/vendors"), api.get("/stock_movements"),
      ]);
      setRows(c.data); setOrders(o.data); setVendors(v.data); setStockMovements(movements.data);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Não foi possível carregar comissões e funcionários");
    }
  };
  useEffect(() => { load(); }, []);

  const openNewVendor = () => {
    setVendorForm(EMPTY_VENDOR);
    setEditingVendorId("");
    setVendorDialogOpen(true);
  };
  const editVendor = async (vendorItem) => {
    try {
      const { data } = await api.get(`/vendors/${vendorItem.id}`);
      setEditingVendorId(data.id);
      setVendorForm({
        ...EMPTY_VENDOR,
        ...data,
        phone: formatCustomerPhone(data.phone),
      });
      setVendorDialogOpen(true);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Não foi possível carregar os dados do funcionário");
    }
  };
  const saveVendor = () => withSubmitLock("vendor", async () => {
    if (!vendorForm.name.trim() || !vendorForm.phone.trim() || !vendorForm.cpf.trim() || !vendorForm.signature) {
      toast.error("Informe nome, telefone, CPF e registre a assinatura");
      return;
    }
    const isEditing = Boolean(editingVendorId);
    const payload = {
      ...vendorForm,
      name: vendorForm.name.trim().toUpperCase(),
      phone: formatCustomerPhone(vendorForm.phone),
    };
    try {
      if (isEditing) await api.put(`/vendors/${editingVendorId}`, payload);
      else await api.post("/vendors", payload);
      await load();
      setVendorDialogOpen(false);
      setVendorForm(EMPTY_VENDOR);
      setEditingVendorId("");
      toast.success(isEditing ? "Dados do funcionário atualizados" : "Funcionário cadastrado");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Não foi possível salvar o funcionário");
    }
  });
  const deleteVendor = async (id) => {
    if (!window.confirm("Remover funcionário?")) return;
    try {
      await api.delete(`/vendors/${id}`);
      await load();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Não foi possível remover o funcionário");
    }
  };

  const orderById = useMemo(() => Object.fromEntries(orders.map((o) => [o.id, o])), [orders]);
  const reportStockMovements = useMemo(() => {
    const inboundKinds = new Set(["ENTRADA", "DESMONTAGEM_ENTRADA", "DESMONTAGEM_INV"]);
    return stockMovements.flatMap((movement) => {
      const order = orderById[movement.order_id];
      if (!order || !inPeriod(movement.created_at, period, selectedMonth) || (vendor !== "ALL" && order.vendor_name !== vendor)) return [];
      return [{
        ...movement,
        order,
        direction: inboundKinds.has(movement.kind) ? "ENTRADA" : "SAÍDA",
      }];
    });
  }, [stockMovements, orderById, period, selectedMonth, vendor]);
  const shown = rows.filter((r) => (vendor === "ALL" || r.vendor_name === vendor) && inPeriod(r.created_at, period, selectedMonth)
    && (paidF === "all" || (paidF === "paid" ? r.paid : !r.paid)));
  const pending = shown.filter((r) => !r.paid);
  const total = shown.reduce((s, r) => s + r.amount, 0);
  const items = shown.reduce((s, r) => s + r.items_count, 0);

  const pay = () => withSubmitLock("mark-paid", async () => {
    await api.post("/commissions/mark_paid", { ids: pending.map((r) => r.id) });
    toast.success("Comissões marcadas como pagas"); load();
  });
  const tableRows = shown.map((r) => [r.order_number, formatDateShort(r.created_at), r.vendor_name || "", orderById[r.order_id]?.customer_name || "", orderById[r.order_id]?.status || "", r.items_count, r.amount, r.paid ? "PAGA" : "PENDENTE"]);
  const movementRows = reportStockMovements.map((movement) => [
    movement.order.number,
    formatDateShort(movement.created_at),
    movement.order.vendor_name || "",
    movement.order.customer_name || "",
    movement.product_name || "",
    movement.size || "-",
    movement.direction,
    movement.qty,
    movement.kind,
    movement.reason || "",
  ]);
  const exportExcel = () => {
    const csv = [
      ["Comissões"],
      ["Pedido", "Data", "Vendedor", "Cliente", "Status", "Itens", "Comissão", "Situação"],
      ...tableRows,
      [],
      ["Movimentações de estoque vinculadas a pedidos (devoluções reduzem as unidades comissionáveis)"],
      ["Pedido", "Data", "Vendedor", "Cliente", "Produto", "Tamanho", "Movimento", "Quantidade", "Tipo", "Motivo"],
      ...movementRows,
    ]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv" })); a.download = "comissoes.csv"; a.click();
  };
  const printReport = () => {
    const w = window.open("", "_blank");
    if (!w) return toast.error("Permita pop-ups para imprimir o relatório");
    const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[character]);
    const reportPeriod = periodLabel(period, selectedMonth);
    w.document.write(`<html><head><title>Comissões</title><style>body{font-family:Arial;padding:20px}h1{color:#4B5320;font-size:18px}table{width:100%;border-collapse:collapse}th{background:#111;color:#D9C9A0}th,td{border:1px solid #444;padding:4px;font-size:11px;text-align:left}</style></head><body>
      <h1>LOKAL MILITAR — Relatório de Comissões</h1><div style="font-size:12px">Vendedor: ${escapeHtml(vendor === "ALL" ? "Todos" : vendor)} · Período: ${escapeHtml(reportPeriod)}</div>
      <table><thead><tr><th>Pedido</th><th>Data</th><th>Vendedor</th><th>Cliente</th><th>Status</th><th>Itens</th><th>Comissão</th><th>Situação</th></tr></thead>
      <tbody>${tableRows.map((r) => `<tr>${r.map((v, i) => `<td>${escapeHtml(i === 6 ? formatBRL(v) : v)}</td>`).join("")}</tr>`).join("")}</tbody></table>
      <h3 style="text-align:right">Itens: ${items} · Total: ${formatBRL(total)} · Pendente: ${formatBRL(pending.reduce((s, r) => s + r.amount, 0))}</h3>
      <h2>Movimentações de estoque vinculadas a pedidos (devoluções reduzem as unidades comissionáveis)</h2>
      <table><thead><tr><th>Pedido</th><th>Data</th><th>Vendedor</th><th>Cliente</th><th>Produto</th><th>Tamanho</th><th>Movimento</th><th>Quantidade</th><th>Tipo</th><th>Motivo</th></tr></thead>
      <tbody>${movementRows.map((r) => `<tr>${r.map((value) => `<td>${escapeHtml(value)}</td>`).join("")}</tr>`).join("")}</tbody></table>
      <script>window.onload=()=>window.print()</script></body></html>`);
    w.document.close();
  };

  return (
    <div data-testid="commissions-page">
      <div className="lm-page-head flex items-end justify-between gap-3 flex-wrap">
        <div><h1>Comissões</h1><p>Comissão por unidade configurada em cada produto; devoluções ao estoque reduzem o valor comissionável.</p></div>
        <div className="flex gap-2 flex-wrap">
          <button className="lm-btn lm-btn-olive" onClick={openNewVendor} data-testid="vendor-new"><UserPlus size={15} />Cadastrar funcionário</button>
          <button className="lm-btn lm-btn-outline" onClick={exportExcel} data-testid="com-excel"><FileSpreadsheet size={15} />Excel</button>
          <button className="lm-btn lm-btn-dark" onClick={printReport} data-testid="com-print"><Printer size={15} />Imprimir relatório de comissão</button>
          <button className="lm-btn lm-btn-gold" disabled={!pending.length || isPending("mark-paid")} onClick={pay} data-testid="com-pay">
            <CircleCheck size={15} />{isPending("mark-paid") ? "Salvando..." : "Marcar como pago"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <div className="lm-hero p-6 lg:col-span-2" data-testid="com-hero">
          <div className="font-head text-xs tracking-[0.2em] text-[#C3B091]">Comissão — {vendor === "ALL" ? "todos os vendedores" : vendor} — {periodLabel(period, selectedMonth)}</div>
          <div className="font-stencil text-6xl md:text-7xl text-[#B8860B] my-2" data-testid="com-total">{formatBRL(total)}</div>
          <div className="flex flex-wrap gap-6 text-sm">
            <span><b className="text-white">{items}</b> produtos vendidos</span>
            <span><b className="text-white">{shown.length}</b> pedidos</span>
            <span>Pendente: <b className="text-white">{formatBRL(pending.reduce((s, r) => s + r.amount, 0))}</b></span>
          </div>
        </div>
        <VendorsPanel vendors={vendors} onEdit={editVendor} onDelete={deleteVendor} />
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        <select className="lm-input !w-52" value={vendor} onChange={(e) => setVendor(e.target.value)} data-testid="com-vendor">
          <option value="ALL">Todos vendedores</option>{vendors.map((v) => <option key={v.id} value={v.name}>{v.name}</option>)}
        </select>
        <div className="lm-seg">{PERIODS.map(([k, l]) => <button key={k} className={period === k ? "on" : ""} onClick={() => setPeriod(k)} data-testid={`com-period-${k}`}>{l}</button>)}</div>
        {period === "mes" && (
          <label className="text-xs font-mono text-neutral-500">
            Mês das comissões
            <input
              type="month"
              className="lm-input mt-1"
              value={selectedMonth}
              onChange={(event) => setSelectedMonth(event.target.value)}
              data-testid="com-month"
            />
          </label>
        )}
        <select className="lm-input !w-52" value={paidF} onChange={(e) => setPaidF(e.target.value)} data-testid="com-paid-filter">
          <option value="all">Pagas e pendentes</option><option value="pending">Só pendentes</option><option value="paid">Só pagas</option>
        </select>
      </div>

      <div className="lm-table-wrap overflow-x-auto">
        <table className="lm-table">
          <thead><tr><th>Pedido</th><th>Data</th><th>Vendedor</th><th>Cliente</th><th>Status</th><th>Itens</th><th>Comissão</th><th>Situação</th></tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <td className="font-head font-bold">#{r.order_number}</td><td>{formatDateShort(r.created_at)}</td><td>{r.vendor_name}</td>
                <td>{orderById[r.order_id]?.customer_name}</td><td>{orderById[r.order_id]?.status}</td><td>{r.items_count}</td>
                <td className="font-semibold">{formatBRL(r.amount)}</td>
                <td><span className={`badge ${r.paid ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}>{r.paid ? "Paga" : "Pendente"}</span></td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={8} className="text-center text-neutral-600 py-10">Nenhum pedido gerou comissão neste período.</td></tr>}
          </tbody>
        </table>
      </div>

      <section className="mt-6 space-y-2" data-testid="commission-stock-movements">
        <div>
          <h2 className="font-head text-lg font-semibold">Movimentações de estoque vinculadas a pedidos</h2>
          <p className="text-xs text-neutral-500">Entradas e saídas vinculadas a pedidos. Produtos devolvidos ao estoque são descontados da comissão da venda original.</p>
        </div>
        <div className="lm-table-wrap overflow-x-auto">
          <table className="lm-table">
            <thead><tr><th>Pedido</th><th>Data</th><th>Vendedor</th><th>Cliente</th><th>Produto</th><th>Tamanho</th><th>Movimento</th><th>Qtd.</th><th>Tipo</th><th>Motivo</th></tr></thead>
            <tbody>
              {reportStockMovements.map((movement) => (
                <tr key={movement.id}>
                  <td className="font-head font-bold">#{movement.order.number}</td>
                  <td>{formatDateShort(movement.created_at)}</td>
                  <td>{movement.order.vendor_name}</td>
                  <td>{movement.order.customer_name}</td>
                  <td>{movement.product_name}</td>
                  <td>{movement.size || "-"}</td>
                  <td>{movement.direction}</td>
                  <td>{movement.qty}</td>
                  <td>{movement.kind}</td>
                  <td>{movement.reason}</td>
                </tr>
              ))}
              {reportStockMovements.length === 0 && (
                <tr><td colSpan={10} className="text-center text-neutral-600 py-6">Nenhuma movimentação de estoque vinculada a pedido neste período.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <Dialog
        open={vendorDialogOpen}
        onOpenChange={(isOpen) => {
          setVendorDialogOpen(isOpen);
          if (!isOpen) {
            setVendorForm(EMPTY_VENDOR);
            setEditingVendorId("");
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="vendor-dialog">
          <DialogHeader>
            <DialogTitle className="font-head">{editingVendorId ? "Editar funcionário" : "Cadastrar funcionário"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <label className="block text-xs font-mono text-neutral-500">
              Nome completo *
              <input
                className="lm-input mt-1"
                value={vendorForm.name}
                onChange={(event) => setVendorForm((current) => ({ ...current, name: event.target.value }))}
                data-testid="vendor-name"
              />
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block text-xs font-mono text-neutral-500">
                Celular *
                <input
                  className="lm-input mt-1"
                  type="tel"
                  inputMode="tel"
                  placeholder="(21) 98765-4321"
                  value={vendorForm.phone}
                  onChange={(event) => setVendorForm((current) => ({ ...current, phone: formatCustomerPhone(event.target.value) }))}
                  data-testid="vendor-phone"
                />
              </label>
              <label className="block text-xs font-mono text-neutral-500">
                CPF *
                <input
                  className="lm-input mt-1"
                  value={vendorForm.cpf}
                  onChange={(event) => setVendorForm((current) => ({ ...current, cpf: event.target.value }))}
                  data-testid="vendor-cpf"
                />
              </label>
            </div>
            <CustomerAddressFields editing={vendorForm} setEditing={setVendorForm} />
            <label className="block text-xs font-mono text-neutral-500">
              KM do depósito até o endereço
              <input className="lm-input mt-1" type="number" step="0.1" value={vendorForm.distance_km ?? ""} readOnly data-testid="vendor-distance" />
            </label>
            <CustomerSignaturePad
              initialValue={vendorForm.signature}
              onChange={(signature) => setVendorForm((current) => ({ ...current, signature }))}
              label="Assinatura do funcionário"
              testid="vendor-signature-pad"
              clearTestid="clear-vendor-signature"
            />
            <div className="flex flex-wrap gap-2 pt-2">
              <button
                className="lm-btn lm-btn-olive"
                onClick={saveVendor}
                disabled={isPending("vendor")}
                data-testid="vendor-add"
              >
                <UserPlus size={16} />{isPending("vendor") ? "Salvando..." : editingVendorId ? "Salvar funcionário" : "Cadastrar funcionário"}
              </button>
              <button className="lm-btn lm-btn-outline" onClick={() => setVendorDialogOpen(false)}>Cancelar</button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
