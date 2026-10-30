import React from "react";
import { formatBRL, formatDateShort } from "@/lib/api";
import BrandMark from "@/components/BrandMark";
import { sortBySku } from "@/lib/utils";

const C = { olive: "#4B5320", ink: "#111", khaki: "#C3B091", gold: "#B8860B", line: "#D9D2C3", soft: "#F6F3EC" };
const TYPE_LABEL = { VENDA: "Pedido de venda", TROCA: "Troca", DEVOLUCAO: "Devolução", ORCAMENTO: "Orçamento" };
const unitOf = (size) => (/^\d+$/.test(String(size || "")) ? "PAR" : "UN");
const num = (v) => Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const Label = ({ children }) => (
  <div style={{ fontSize: 8.5, letterSpacing: 1, textTransform: "uppercase", color: "#6b6557", fontWeight: 700, marginBottom: 2 }}>{children}</div>
);
const Info = ({ label, value, strong }) => (
  <div style={{ marginBottom: 6 }}><Label>{label}</Label><div style={{ fontSize: strong ? 13 : 11, fontWeight: strong ? 700 : 500 }}>{value || "—"}</div></div>
);
const Box = ({ title, children, style }) => (
  <div style={{ border: `1px solid ${C.line}`, borderRadius: 6, overflow: "hidden", ...style }}>
    <div style={{ background: C.soft, padding: "5px 10px", fontSize: 9, fontWeight: 800, letterSpacing: 1.2, textTransform: "uppercase", color: C.olive, borderBottom: `1px solid ${C.line}` }}>{title}</div>
    <div style={{ padding: "8px 10px" }}>{children}</div>
  </div>
);
const th = { background: C.ink, color: "#E9DFC6", fontSize: 9, letterSpacing: 0.8, textTransform: "uppercase", padding: "6px 8px", textAlign: "left", border: "none" };
const td = { padding: "6px 8px", fontSize: 10.5, borderBottom: `1px solid ${C.line}`, borderLeft: "none", borderRight: "none", borderTop: "none" };

function ItemsTable({ items }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead><tr>
        <th style={{ ...th, width: 22 }}>#</th><th style={th}>Descrição do produto</th><th style={th}>Código</th>
        <th style={{ ...th, textAlign: "center" }}>Tam.</th><th style={{ ...th, textAlign: "center" }}>Un.</th>
        <th style={{ ...th, textAlign: "right" }}>Qtd.</th>
      </tr></thead>
      <tbody>
        {items.map((it, i) => (
          <tr key={i} style={{ background: i % 2 ? C.soft : "#fff" }}>
            <td style={{ ...td, color: "#888" }}>{i + 1}</td>
            <td style={{ ...td, fontWeight: 600 }}>{(it.name || "").toUpperCase()}</td>
            <td style={{ ...td, fontFamily: "monospace", fontSize: 9.5 }}>{it.sku || "—"}</td>
            <td style={{ ...td, textAlign: "center" }}><span style={{ background: "#E8E2D5", borderRadius: 3, padding: "1px 6px", fontWeight: 700 }}>{it.size || "—"}</span></td>
            <td style={{ ...td, textAlign: "center" }}>{unitOf(it.size)}</td>
            <td style={{ ...td, textAlign: "right" }}>{num(it.qty)}</td>
          </tr>
        ))}
        {items.length === 0 && <tr><td colSpan={6} style={{ ...td, textAlign: "center", color: "#888" }}>Nenhum item</td></tr>}
      </tbody>
    </table>
  );
}

function ReturnsSection({ returned, exchanged }) {
  if (!returned.length && !exchanged.length) return null;
  const rows = [
    ...returned.map((r) => ({ ...r, kind: "DEVOLVIDO", note: "Retornou ao estoque", color: "#B42318", bg: "#FDECEC" })),
    ...exchanged.map((r) => ({ ...r, kind: "ENTREGUE NA TROCA", note: "Saiu do estoque", color: C.olive, bg: "#EEF1E1" })),
  ];
  return (
    <div style={{ marginTop: 12, border: `1.5px solid ${C.gold}`, borderRadius: 6, overflow: "hidden" }}>
      <div style={{ background: "#FBF3DF", padding: "6px 10px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid ${C.gold}` }}>
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.2, color: "#7a5a07" }}>⇄ TROCAS E DEVOLUÇÕES DESTE PEDIDO</span>
        <span style={{ fontSize: 9.5, color: "#7a5a07" }}>Devolvidos: <b>{returned.reduce((s, r) => s + Number(r.qty || 0), 0)}</b> · Entregues na troca: <b>{exchanged.reduce((s, r) => s + Number(r.qty || 0), 0)}</b></span>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr>
          <th style={{ ...th, background: "#3a3a2a" }}>Movimento</th><th style={{ ...th, background: "#3a3a2a" }}>Produto</th>
          <th style={{ ...th, background: "#3a3a2a", textAlign: "center" }}>Tam.</th><th style={{ ...th, background: "#3a3a2a", textAlign: "right" }}>Qtd.</th>
          <th style={{ ...th, background: "#3a3a2a" }}>Motivo / observação</th>
        </tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td style={td}><span style={{ background: r.bg, color: r.color, fontWeight: 800, fontSize: 8.5, padding: "2px 6px", borderRadius: 3, letterSpacing: 0.5 }}>{r.kind}</span>
                <div style={{ fontSize: 8, color: "#888", marginTop: 2 }}>{r.note}</div></td>
              <td style={{ ...td, fontWeight: 600 }}>{(r.name || "").toUpperCase()}</td>
              <td style={{ ...td, textAlign: "center" }}>{r.size || "—"}</td>
              <td style={{ ...td, textAlign: "right" }}>{num(r.qty)}</td>
              <td style={td}>{r.reason || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function PrintOrderA4({ order, settings, customer, vendor, captureRef }) {
  if (!order) return null;
  const items = sortBySku(order.items || []);
  const returned = order.returned_items || [];
  const exchanged = order.exchanged_items || [];
  const somaQtd = items.reduce((s, i) => s + Number(i.qty || 0), 0);

  return (
    <div ref={captureRef} className="print-a4" style={{ color: C.ink, WebkitPrintColorAdjust: "exact", printColorAdjust: "exact", fontFamily: "Arial, Helvetica, sans-serif" }} data-testid="print-a4-layout">
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: 10, borderBottom: `3px solid ${C.olive}` }}>
        <BrandMark light />
        <div style={{ textAlign: "right", fontSize: 9.5, lineHeight: 1.5, color: "#333" }}>
          <div style={{ fontWeight: 800, fontSize: 11, color: C.ink }}>{settings?.store_full_name}</div>
          <div>{settings?.address}</div>
          <div>CNPJ: {settings?.cnpj}</div>
          <div>{[settings?.phone, settings?.instagram].filter(Boolean).join(" · ")}</div>
        </div>
      </div>

      {/* Title band */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "12px 0", background: C.ink, color: "#fff", borderRadius: 6, padding: "10px 14px" }}>
        <div>
          <div style={{ fontSize: 9, letterSpacing: 2, color: C.khaki, textTransform: "uppercase" }}>{TYPE_LABEL[order.type] || order.type}</div>
          <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: 0.5 }}>PEDIDO Nº {order.number}</div>
        </div>
        <div style={{ display: "flex", gap: 18, textAlign: "right" }}>
          <div><div style={{ fontSize: 8.5, color: C.khaki, letterSpacing: 1 }}>DATA</div><div style={{ fontSize: 12, fontWeight: 700 }}>{formatDateShort(order.created_at)}</div></div>
          <div><div style={{ fontSize: 8.5, color: C.khaki, letterSpacing: 1 }}>PREVISTA</div><div style={{ fontSize: 12, fontWeight: 700 }}>{order.expected_date ? formatDateShort(order.expected_date) : "—"}</div></div>
          {["Entregue", "Retirado"].includes(order.status) && (
            <div><div style={{ fontSize: 8.5, color: C.khaki, letterSpacing: 1 }}>STATUS</div>
              <div style={{ fontSize: 10, fontWeight: 800, background: C.gold, color: C.ink, borderRadius: 3, padding: "2px 8px", marginTop: 2 }}>{order.status.toUpperCase()}</div></div>
          )}
        </div>
      </div>

      {/* Info */}
      <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 10 }}>
        <Box title="Cliente">
          <Info label="Nome / Loja" value={order.customer_name || customer?.name} strong />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <Info label="Telefone" value={customer?.phone} />
            <Info label="Endereço" value={customer?.address} />
          </div>
        </Box>
        <Box title="Atendimento">
          <Info label="Vendedor" value={order.vendor_name} strong />
          <Info label="Telefone do vendedor" value={vendor?.phone} />
          {order.delivery_type === "CORREIO" && <Info label="Forma de entrega" value="Correio/transportadora" />}
          {order.status === "Entregue" && order.delivery_type === "ENTREGA" && order.vehicle_name && <Info label="Veículo utilizado" value={order.vehicle_name} />}
          {order.original_order_id && <Info label="Referente ao pedido" value={order.original_number ? `#${order.original_number}` : "Vinculado"} />}
          {order.avulsa && <Info label="Tipo" value="Troca/devolução avulsa" />}
        </Box>
      </div>

      {/* Items */}
      <div style={{ marginTop: 12 }}>
        <Label>{order.type === "TROCA" ? "Itens entregues ao cliente" : "Itens do pedido"}</Label>
        <div style={{ border: `1px solid ${C.line}`, borderRadius: 6, overflow: "hidden" }}><ItemsTable items={items} /></div>
      </div>

      {/* Totals */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
        <div style={{ width: 260, border: `1px solid ${C.line}`, borderRadius: 6, overflow: "hidden", fontSize: 10.5 }}>
          {[["Nº de itens", items.length], ["Soma das quantidades", num(somaQtd)]].map(([l, v]) => (
            <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "5px 10px", borderBottom: `1px solid ${C.line}` }}><span style={{ color: "#555" }}>{l}</span><b>{v}</b></div>
          ))}
        </div>
      </div>

      <ReturnsSection returned={returned} exchanged={exchanged} />

      {/* Notes */}
      <Box title="Observações" style={{ marginTop: 12 }}>
        <div style={{ minHeight: 34, fontSize: 10.5, whiteSpace: "pre-wrap" }}>{order.notes || ""}</div>
      </Box>

      {settings?.pix_key && (
        <div style={{ marginTop: 8, fontSize: 10 }}>Chave PIX: <b>{settings.pix_key}</b></div>
      )}

      {/* Signatures */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 50, marginTop: 40, fontSize: 9.5, textAlign: "center", color: "#444" }}>
        <div>
          {order.signature && <img src={order.signature} alt="Assinatura do cliente" style={{ display: "block", maxWidth: "100%", height: 52, objectFit: "contain", margin: "0 auto 4px" }} />}
          <div style={{ borderTop: `1px solid ${C.ink}`, paddingTop: 4 }}>Assinatura do cliente</div>
        </div>
        <div>
          {vendor?.signature && <img src={vendor.signature} alt="Assinatura do vendedor" style={{ display: "block", maxWidth: "100%", height: 52, objectFit: "contain", margin: "0 auto 4px" }} />}
          <div style={{ borderTop: `1px solid ${C.ink}`, paddingTop: 4 }}>Assinatura do vendedor</div>
        </div>
      </div>

      <div style={{ marginTop: 22, paddingTop: 6, borderTop: `1px solid ${C.line}`, display: "flex", justifyContent: "space-between", fontSize: 8.5, color: "#777" }}>
        <span>{settings?.print_footer_text}</span><span>Emitido em {new Date().toLocaleString("pt-BR")}</span>
      </div>
    </div>
  );
}

export function PrintOrder80mm({ order, settings }) {
  if (!order) return null;
  const dash = <div style={{ borderTop: "1px dashed #000", margin: "4px 0" }} />;
  const returned = order.returned_items || [];
  const exchanged = order.exchanged_items || [];
  const items = sortBySku(order.items || []);
  return (
    <div className="print-80">
      <div style={{ textAlign: "center", fontWeight: 700, fontSize: 13 }}>LOKAL MILITAR</div>
      <div style={{ textAlign: "center", fontSize: 9 }}>CNPJ {settings?.cnpj}</div>
      {dash}
      <div>{TYPE_LABEL[order.type] || order.type} <b>#{order.number}</b></div>
      <div>Data: {formatDateShort(order.created_at)}</div>
      <div>Cliente: {order.customer_name || "-"}</div>
      <div>Vendedor: {order.vendor_name || "-"}</div>
      {dash}
      {items.map((it, i) => (
        <div key={i} style={{ marginBottom: 2 }}>
          <div>{it.name} {it.size ? `T:${it.size}` : ""}</div>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span>{it.qty} x {num(it.unit_price)}</span><span>{num(it.subtotal || it.qty * it.unit_price)}</span></div>
        </div>
      ))}
      {dash}
      {Number(order.discount) > 0 && <div style={{ display: "flex", justifyContent: "space-between" }}><span>Desconto</span><span>-{num(order.discount)}</span></div>}
      <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 13 }}><span>TOTAL</span><span>{formatBRL(order.total || 0)}</span></div>
      <div>Pagamento: {order.payment}</div>
      {(returned.length > 0 || exchanged.length > 0) && (
        <>
          {dash}
          <div style={{ fontWeight: 700 }}>TROCAS / DEVOLUÇÕES</div>
          {returned.map((r, i) => <div key={"r" + i}>DEV: {r.qty}x {r.name} {r.size ? `T:${r.size}` : ""}{r.reason ? ` (${r.reason})` : ""}</div>)}
          {exchanged.map((r, i) => <div key={"e" + i}>TROCA: {r.qty}x {r.name} {r.size ? `T:${r.size}` : ""}</div>)}
        </>
      )}
      {settings?.pix_key && <div style={{ textAlign: "center", marginTop: 6, fontSize: 9 }}>PIX: {settings.pix_key}</div>}
      {dash}
      <div style={{ textAlign: "center", fontSize: 9 }}>{settings?.print_footer_text || "Obrigado pela preferência!"}</div>
    </div>
  );
}
