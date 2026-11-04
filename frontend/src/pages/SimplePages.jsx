import React, { useEffect, useState } from "react";
import { CrudPage } from "@/components/CrudPage";
import { api, formatBRL, formatDateShort } from "@/lib/api";
import { toast } from "sonner";
import useSubmitLock from "@/hooks/useSubmitLock";
import CustomerAddressFields from "@/components/CustomerAddressFields";
import { formatCustomerPhone } from "@/lib/customerFields";

const sumBox = (label, value) => (
  <div className="lokal-panel p-3 mt-3 text-right font-mono text-sm" data-testid="total-box">{label}: <b>{value}</b></div>
);

export function Customers() {
  const sortByCustomerName = (first, second) => first.name.localeCompare(second.name, "pt-BR", { sensitivity: "base" });
  return (
    <CrudPage title="Clientes" subtitle="Cadastro de clientes militares e lojas" endpoint="customers" testid="customers"
      defaults={{ phone: "", cep: "", address_number: "", address: "", distance_km: 0 }}
      sortRows={sortByCustomerName}
      prepareEdit={(customer) => ({ ...customer, phone: formatCustomerPhone(customer.phone) })}
      fields={[
        { key: "name", label: "Nome / Loja", required: true, wide: true },
        { key: "cpf", label: "CPF / CNPJ" },
        { key: "phone", label: "Celular", onChange: (value) => ({ phone: formatCustomerPhone(value) }) },
        { key: "address", label: "CEP e endereço", wide: true, render: (props) => <CustomerAddressFields {...props} /> },
        { key: "distance_km", label: "KM do depósito até o endereço", type: "number" },
      ]}
      columns={[
        { key: "name", label: "NOME / LOJA" }, { key: "cpf", label: "CPF" },
        { key: "phone", label: "CELULAR", render: (customer) => formatCustomerPhone(customer.phone) },
        { key: "address", label: "ENDEREÇO" }, { key: "distance_km", label: "KM DO DEPÓSITO" },
      ]} />
  );
}

export function Categories() {
  const [cats, setCats] = useState([]);
  useEffect(() => { api.get("/categories").then((r) => setCats(r.data)); }, []);
  const parentName = (id) => cats.find((c) => c.id === id)?.name || "";
  return (
    <CrudPage title="Categorias" subtitle="Categorias e subcategorias com cor, ícone e grade" endpoint="categories" testid="categories"
      defaults={{ color: "#4B5320", icon: "Package" }}
      fields={[
        { key: "name", label: "Nome", required: true },
        { key: "parent_id", label: "Subcategoria de", type: "select", options: cats.filter((c) => !c.parent_id).map((c) => ({ value: c.id, label: c.name })) },
        { key: "color", label: "Cor", type: "color" },
        { key: "icon", label: "Ícone", type: "select", options: ["Package", "Shirt", "Footprints", "Award", "Star", "Shield"] },
        { key: "size_grid", label: "Grade de tamanhos", type: "select", options: ["ROUPA", "CALCADOS"] },
      ]}
      columns={[
        { label: "COR", render: (r) => <span className="inline-block w-4 h-4 border" style={{ background: r.color }} /> },
        { key: "name", label: "NOME" }, { label: "SUBCATEGORIA DE", render: (r) => parentName(r.parent_id) }, { key: "icon", label: "ÍCONE" }, { key: "size_grid", label: "GRADE" },
      ]} />
  );
}

export function Suppliers() {
  return (
    <CrudPage title="Fornecedores" endpoint="suppliers" testid="suppliers"
      fields={[
        { key: "name", label: "Nome", required: true }, { key: "cnpj", label: "CNPJ" },
        { key: "phone", label: "Telefone" }, { key: "email", label: "E-mail" },
        { key: "distance_km", label: "KM do depósito até o endereço", type: "number" },
        { key: "notes", label: "Observações", type: "textarea", wide: true },
      ]}
      columns={[{ key: "name", label: "NOME" }, { key: "cnpj", label: "CNPJ" }, { key: "phone", label: "TELEFONE" }, { key: "email", label: "E-MAIL" }, { key: "distance_km", label: "KM DO DEPÓSITO" }]} />
  );
}

const total = (rows, fn) => formatBRL(rows.reduce((s, r) => s + fn(r), 0));
const FUEL_TYPES = ["Gasolina", "Etanol", "Diesel", "GNV"];
const escapeReportHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[character]));
const printRecordsReport = ({ title, filterLabel, rows, columns }) => {
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    toast.error("Permita pop-ups para imprimir o relatório");
    return;
  }
  const reportRows = rows.map((row) => `
    <tr>${columns.map((column) => {
      const value = column.value(row);
      return `<td>${escapeReportHtml(value ?? "—")}</td>`;
    }).join("")}</tr>`);
  printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeReportHtml(title)}</title>
    <style>body{font:12px Arial,sans-serif;padding:24px;color:#222}h1{color:#354017;font-size:20px}table{width:100%;border-collapse:collapse;margin-top:16px}th,td{border:1px solid #aaa;padding:7px;text-align:left}th{background:#eee}.summary{margin-top:16px;font-weight:bold}@media print{body{padding:0}}</style>
    </head><body><h1>LOKAL MILITAR — ${escapeReportHtml(title)}</h1>
    <p>Filtro: ${escapeReportHtml(filterLabel)} · Gerado em ${escapeReportHtml(new Date().toLocaleString("pt-BR"))}</p>
    <table><thead><tr>${columns.map((column) => `<th>${escapeReportHtml(column.label)}</th>`).join("")}</tr></thead>
    <tbody>${reportRows.length ? reportRows.join("") : `<tr><td colspan="${columns.length}" style="text-align:center">Nenhum registro encontrado.</td></tr>`}</tbody></table>
    <div class="summary">${rows.length} registro(s)</div></body></html>`);
  printWindow.document.close();
  printWindow.setTimeout(() => printWindow.print(), 300);
};
const getTravelPeriodRange = (type, value) => {
  if (type === "week") {
    const match = /^(\d{4})-W(\d{2})$/.exec(value);
    if (!match) return null;
    const year = Number(match[1]);
    const week = Number(match[2]);
    const januaryFourth = new Date(Date.UTC(year, 0, 4));
    const weekday = (januaryFourth.getUTCDay() + 6) % 7;
    const start = new Date(januaryFourth.getTime() - weekday * 86400000 + (week - 1) * 7 * 86400000);
    const end = new Date(start.getTime() + 7 * 86400000);
    return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10), label: `Semana ${week} de ${year}` };
  }
  if (type === "month") {
    const match = /^(\d{4})-(\d{2})$/.exec(value);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const end = new Date(Date.UTC(year, month, 1));
    return { start: `${match[1]}-${match[2]}-01`, end: end.toISOString().slice(0, 10), label: `${match[2]}/${match[1]}` };
  }
  if (!/^\d{4}$/.test(value)) return null;
  const year = Number(value);
  return { start: `${value}-01-01`, end: `${year + 1}-01-01`, label: value };
};
const recalculateTrip = (trip, changes = {}) => {
  const updated = { ...trip, ...changes };
  const km = Math.max(Number(updated.km || 0), 0);
  const consumption = Number(updated.avg_consumption || 0);
  const liters = consumption > 0 ? Math.round((km / consumption) * 100) / 100 : 0;
  const price = Math.max(Number(updated.fuel_price_per_liter || 0), 0);
  return { ...changes, fuel_liters: liters, fuel_cost: Math.round(liters * price * 100) / 100 };
};

export function Vehicles() {
  return (
    <CrudPage title="Veículos" subtitle="Cadastro de veículos e quilometragem acumulada" endpoint="vehicles" testid="vehicles"
      defaults={{ active: true, current_km: 0, avg_consumption: 0, fuel_types: [] }}
      fields={[
        { key: "name", label: "Nome do veículo", required: true },
        { key: "model", label: "Modelo" },
        { key: "plate", label: "Placa" },
        {
          key: "fuel_types", label: "Combustíveis utilizados", type: "multiselect", options: FUEL_TYPES,
          defaultValue: (editing) => editing.fuel_type ? [editing.fuel_type] : [],
          onChange: (value) => ({ fuel_types: value, fuel_type: value[0] || "" }),
        },
        { key: "avg_consumption", label: "Consumo médio (km/l)", type: "number" },
        { key: "current_km", label: "Quilometragem atual", type: "number" },
        { key: "active", label: "Veículo ativo", type: "checkbox" },
      ]}
      columns={[
        { key: "name", label: "VEÍCULO" }, { key: "model", label: "MODELO" }, { key: "plate", label: "PLACA" },
        { label: "COMBUSTÍVEIS", render: (vehicle) => (vehicle.fuel_types?.length ? vehicle.fuel_types : vehicle.fuel_type ? [vehicle.fuel_type] : []).join(", ") },
        { key: "avg_consumption", label: "KM/L" }, { key: "current_km", label: "KM ATUAL" },
        { label: "SITUAÇÃO", render: (vehicle) => vehicle.active === false ? "Inativo" : "Ativo" },
      ]} />
  );
}

export function Insumos() {
  const [suppliers, setSuppliers] = useState([]);
  const [selectedSupply, setSelectedSupply] = useState("");
  const { run: withSubmitLock, isPending } = useSubmitLock();
  useEffect(() => { api.get("/suppliers").then((r) => setSuppliers(r.data)); }, []);
  const supName = (id) => suppliers.find((s) => s.id === id)?.name || "-";
  const supplyReportFilters = ({ rows }) => {
    const supplies = [...new Set(rows.map((row) => row.description?.trim()).filter(Boolean))]
      .sort((first, second) => first.localeCompare(second, "pt-BR"));
    return (
      <section className="lokal-panel p-3 my-3 flex flex-wrap items-end gap-3" data-testid="insumos-report-filters">
        <div className="font-head text-sm">Relatório de insumos</div>
        <label className="text-xs font-mono">
          Insumo
          <select className="lm-input mt-1" value={selectedSupply} onChange={(event) => setSelectedSupply(event.target.value)} data-testid="insumos-report-filter">
            <option value="">Todos os insumos</option>
            {supplies.map((supply) => <option key={supply} value={supply}>{supply}</option>)}
          </select>
        </label>
        <button className="lm-btn lm-btn-dark" onClick={() => {
          const filteredRows = selectedSupply ? rows.filter((row) => row.description?.trim() === selectedSupply) : rows;
          printRecordsReport({
            title: "Relatório de insumos",
            filterLabel: selectedSupply || "Todos os insumos",
            rows: filteredRows,
            columns: [
              { label: "DATA", value: (row) => formatDateShort(row.date) },
              { label: "DESCRIÇÃO", value: (row) => row.description },
              { label: "FORNECEDOR", value: (row) => supName(row.supplier_id) },
              { label: "VALOR", value: (row) => formatBRL(row.amount) },
              { label: "COMPRADO", value: (row) => `${Number(row.quantity || 0)} ${row.unit || ""}` },
              { label: "CONSUMIDO", value: (row) => `${Math.max(Number(row.quantity || 0) - Number(row.remaining_quantity || 0), 0)} ${row.unit || ""}` },
              { label: "RESTANTE", value: (row) => `${Number(row.remaining_quantity || 0)} ${row.unit || ""}` },
            ],
          });
        }} data-testid="print-insumos-report">
          Imprimir relatório de insumos
        </button>
      </section>
    );
  };
  return (
    <CrudPage title="Insumos" subtitle="Linhas, botões, tecidos, embalagens e outros gastos" endpoint="expenses" testid="insumos"
      filter={(r) => r.type === "INSUMO"} defaults={{ type: "INSUMO", date: new Date().toISOString().slice(0, 10) }}
      headerContent={supplyReportFilters}
      fields={[
        { key: "description", label: "Descrição", required: true, wide: true },
        { key: "amount", label: "Valor (R$)", type: "number", required: true },
        { key: "quantity", label: "Quantidade comprada", type: "number", required: true },
        { key: "unit", label: "Unidade (un, m, kg...)" },
        { key: "date", label: "Data", type: "date" },
        { key: "supplier_id", label: "Fornecedor", type: "select", options: suppliers.map((s) => ({ value: s.id, label: s.name })) },
      ]}
      columns={[
        { label: "DATA", render: (r) => formatDateShort(r.date) }, { key: "description", label: "DESCRIÇÃO" },
        { label: "FORNECEDOR", render: (r) => supName(r.supplier_id) }, { label: "VALOR", render: (r) => formatBRL(r.amount) },
        { label: "COMPRADO", render: (r) => `${Number(r.quantity || 0)} ${r.unit || ""}` },
        { label: "CONSUMIDO", render: (r) => `${Math.max(Number(r.quantity || 0) - Number(r.remaining_quantity || 0), 0)} ${r.unit || ""}` },
        { label: "RESTANTE", render: (r) => `${Number(r.remaining_quantity || 0)} ${r.unit || ""}` },
      ]}
      rowActions={(row, reload) => (
        <button className="text-xs text-green-800 px-2 py-1" disabled={Number(row.remaining_quantity || 0) <= 0 || isPending(`consume:${row.id}`)}
          onClick={() => withSubmitLock(`consume:${row.id}`, async () => {
            const raw = window.prompt(`Quantidade usada (restam ${row.remaining_quantity} ${row.unit || ""}):`);
            if (raw === null) return;
            const quantity = Number(raw);
            if (!Number.isFinite(quantity) || quantity <= 0) return toast.error("Informe uma quantidade válida");
            try {
              await api.post(`/expenses/${row.id}/consume`, { quantity });
              toast.success("Consumo registrado");
              reload();
            } catch (error) {
              toast.error(error.response?.data?.detail || "Não foi possível registrar o consumo");
            }
          })}
        >
          {isPending(`consume:${row.id}`) ? "Registrando..." : "Consumir"}
        </button>
      )}
      footer={(rows) => sumBox("Total em insumos", total(rows, (r) => Number(r.amount || 0)))} />
  );
}

export function Viagens() {
  const [customers, setCustomers] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [fuelPrices, setFuelPrices] = useState({});
  const [reportPeriodType, setReportPeriodType] = useState("week");
  const [reportPeriod, setReportPeriod] = useState(() => {
    const now = new Date();
    const date = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
    return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
  });
  useEffect(() => {
    Promise.all([api.get("/customers"), api.get("/suppliers"), api.get("/vehicles"), api.get("/settings")])
      .then(([c, s, v, settings]) => {
        setCustomers(c.data);
        setSuppliers(s.data);
        setVehicles(v.data.filter((vehicle) => vehicle.active !== false));
        setFuelPrices(settings.data.fuel_prices || {});
      })
      .catch(() => toast.error("Não foi possível carregar clientes, fornecedores e veículos"));
  }, []);
  const destinationOptions = (editing) => (editing.destination_type === "fornecedor" ? suppliers : customers)
    .map((entry) => ({ value: entry.id, label: entry.name }));
  const selectedVehicle = (editing) => vehicles.find((vehicle) => vehicle.id === editing.vehicle_id);
  const availableFuels = (editing) => {
    const vehicle = selectedVehicle(editing);
    const fuels = vehicle?.fuel_types?.length ? vehicle.fuel_types : vehicle?.fuel_type ? [vehicle.fuel_type] : FUEL_TYPES;
    return editing.fuel_type && !fuels.includes(editing.fuel_type) ? [...fuels, editing.fuel_type] : fuels;
  };
  const prepareTripEdit = (trip) => {
    const vehicle = vehicles.find((item) => item.id === trip.vehicle_id);
    const fuel = trip.fuel_type || vehicle?.fuel_types?.[0] || vehicle?.fuel_type || FUEL_TYPES[0];
    const consumption = Number(trip.avg_consumption || vehicle?.avg_consumption || 0);
    const price = Number(trip.fuel_price_per_liter || fuelPrices[fuel] || 0);
    return {
      ...trip,
      ...recalculateTrip(trip, {
        fuel_type: fuel,
        avg_consumption: consumption,
        fuel_price_per_liter: price,
      }),
    };
  };
  const printTravelReport = async () => {
    const range = getTravelPeriodRange(reportPeriodType, reportPeriod);
    if (!range) {
      toast.error("Selecione um período válido para o relatório");
      return;
    }
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      toast.error("Permita pop-ups para imprimir o relatório");
      return;
    }
    try {
      const { data: expenses } = await api.get("/expenses");
      const trips = expenses
        .filter((expense) => expense.type === "VIAGEM")
        .filter((trip) => {
          const date = String(trip.date || "").slice(0, 10);
          return date >= range.start && date < range.end;
        })
        .sort((first, second) => String(first.date).localeCompare(String(second.date)));
      const totalKm = trips.reduce((sum, trip) => sum + Number(trip.km || 0), 0);
      const rows = trips.map((trip) => `
        <tr><td>${escapeReportHtml(String(trip.date || "").slice(0, 10).split("-").reverse().join("/"))}</td>
        <td>${escapeReportHtml(trip.description)}</td><td>${escapeReportHtml(trip.route)}</td>
        <td>${escapeReportHtml(trip.vehicle_name || vehicles.find((vehicle) => vehicle.id === trip.vehicle_id)?.name || "—")}</td>
        <td>${escapeReportHtml(trip.fuel_type || "—")}</td><td>${escapeReportHtml(Number(trip.km || 0).toLocaleString("pt-BR"))}</td></tr>`);
      printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Relatório de percursos · ${escapeReportHtml(range.label)}</title>
        <style>body{font:12px Arial,sans-serif;padding:24px;color:#222}h1{color:#354017;font-size:20px}table{width:100%;border-collapse:collapse;margin-top:16px}th,td{border:1px solid #aaa;padding:7px;text-align:left}th{background:#eee}.summary{margin-top:16px;padding:10px;border:1px solid #aaa;font-weight:bold}</style>
        </head><body><h1>LOKAL MILITAR — Relatório de percursos</h1><p>Período: ${escapeReportHtml(range.label)} · ${escapeReportHtml(range.start)} a ${escapeReportHtml(new Date(new Date(`${range.end}T00:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10))}</p>
        <table><thead><tr><th>Data</th><th>Percurso</th><th>Rota</th><th>Veículo</th><th>Combustível</th><th>KM percorridos</th></tr></thead>
        <tbody>${rows.length ? rows.join("") : '<tr><td colspan="6" style="text-align:center">Nenhum percurso registrado no período.</td></tr>'}</tbody></table>
        <div class="summary">Quilometragem total percorrida: ${escapeReportHtml(totalKm.toLocaleString("pt-BR"))} km</div></body></html>`);
      printWindow.document.close();
      printWindow.setTimeout(() => printWindow.print(), 300);
    } catch (error) {
      printWindow.close();
      toast.error(error.response?.data?.detail || "Não foi possível gerar o relatório de percursos");
    }
  };
  const travelReportFilters = (
    <section className="lokal-panel p-3 my-3 flex flex-wrap items-end gap-3" data-testid="travel-report-filters">
        <div className="font-head text-sm">Relatório de percursos</div>
        <label className="text-xs font-mono">
          Período
          <select className="lm-input mt-1" value={reportPeriodType} onChange={(event) => {
            const type = event.target.value;
            setReportPeriodType(type);
            const now = new Date();
            if (type === "month") setReportPeriod(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
            else if (type === "year") setReportPeriod(String(now.getFullYear()));
            else {
              const date = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
              date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
              const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
              const week = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
              setReportPeriod(`${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`);
            }
          }} data-testid="travel-report-period-type">
            <option value="week">Semana</option><option value="month">Mês</option><option value="year">Ano</option>
          </select>
        </label>
        <label className="text-xs font-mono">
          {reportPeriodType === "week" ? "Semana selecionada" : reportPeriodType === "month" ? "Mês selecionado" : "Ano selecionado"}
          <input
            className="lm-input mt-1"
            type={reportPeriodType === "year" ? "number" : reportPeriodType}
            min={reportPeriodType === "year" ? 2000 : undefined}
            max={reportPeriodType === "year" ? 2100 : undefined}
            step={reportPeriodType === "year" ? 1 : undefined}
            value={reportPeriod}
            onChange={(event) => setReportPeriod(event.target.value)}
            data-testid="travel-report-period"
          />
        </label>
        <button className="lm-btn lm-btn-dark" onClick={printTravelReport} data-testid="print-travel-report">
          Imprimir relatório de percursos
        </button>
      </section>
  );
  return (
      <CrudPage title="Viagens & Rotas" subtitle="Registro de rotas, combustível, pedágios e quilometragem fora das entregas" endpoint="expenses" testid="viagens"
      headerContent={travelReportFilters}
      filter={(r) => r.type === "VIAGEM"} prepareEdit={prepareTripEdit}
      defaults={{ type: "VIAGEM", destination_type: "cliente", fuel_type: FUEL_TYPES[0], fuel_price_per_liter: Number(fuelPrices[FUEL_TYPES[0]] || 0), date: new Date().toISOString().slice(0, 10) }}
      fields={[
        { key: "destination_type", label: "Tipo de destino", type: "select", options: [{ value: "cliente", label: "Cliente" }, { value: "fornecedor", label: "Fornecedor" }], onChange: (value, editing) => ({ destination_type: value, destination_id: "", ...recalculateTrip(editing, { km: 0 }), route: "", description: "" }) },
        { key: "destination_id", label: "Cliente / fornecedor cadastrado", type: "select", options: destinationOptions, onChange: (value, editing) => {
          const entry = (editing.destination_type === "fornecedor" ? suppliers : customers).find((item) => item.id === value);
          return { destination_id: value, ...recalculateTrip(editing, { km: Number(entry?.distance_km || 0) * 2 }), route: entry ? `Depósito → ${entry.address || entry.name} → Depósito` : "", description: entry ? `Viagem até ${entry.name}` : "" };
        } },
        { key: "description", label: "Destino / Objetivo", required: true, wide: true },
        { key: "route", label: "Rota (origem → destino)", wide: true },
        { key: "date", label: "Data", type: "date" },
        { key: "vehicle_id", label: "Veículo", type: "select", options: vehicles.map((vehicle) => ({ value: vehicle.id, label: `${vehicle.name}${vehicle.plate ? ` · ${vehicle.plate}` : ""}` })), onChange: (value, editing) => {
          const vehicle = vehicles.find((item) => item.id === value);
          const fuels = vehicle?.fuel_types?.length ? vehicle.fuel_types : vehicle?.fuel_type ? [vehicle.fuel_type] : [];
          const fuel = fuels.includes(editing.fuel_type) ? editing.fuel_type : fuels[0] || editing.fuel_type;
          const price = Number(fuelPrices[fuel] ?? editing.fuel_price_per_liter ?? 0);
          const consumption = Number(vehicle?.avg_consumption || 0);
          return { vehicle_id: value, fuel_type: fuel, avg_consumption: consumption, fuel_price_per_liter: price, ...recalculateTrip(editing, { fuel_type: fuel, avg_consumption: consumption, fuel_price_per_liter: price }) };
        } },
        { key: "km", label: "KM rodados (ida e volta)", type: "number", onChange: (value, editing) => ({ km: value, ...recalculateTrip(editing, { km: value }) }) },
        { key: "fuel_type", label: "Combustível", type: "select", options: availableFuels, onChange: (value, editing) => {
          const price = Number(fuelPrices[value] || 0);
          return { fuel_type: value, fuel_price_per_liter: price, ...recalculateTrip(editing, { fuel_type: value, fuel_price_per_liter: price }) };
        } },
        { key: "avg_consumption", label: "Consumo médio (km/l)", type: "number", onChange: (value, editing) => ({ avg_consumption: value, ...recalculateTrip(editing, { avg_consumption: value }) }) },
        { key: "fuel_liters", label: "Litros estimados", type: "number", readOnly: true },
        { key: "fuel_price_per_liter", label: "Preço por litro (R$)", type: "number", onChange: (value, editing) => ({ fuel_price_per_liter: value, ...recalculateTrip(editing, { fuel_price_per_liter: value }) }) },
        { key: "fuel_cost", label: "Gasto combustível (R$)", type: "number", readOnly: true },
        { key: "toll_cost", label: "Pedágios (R$)", type: "number" },
        { key: "amount", label: "Outros gastos (R$)", type: "number" },
      ]}
      columns={[
        { label: "DATA", render: (r) => formatDateShort(r.date) }, { key: "description", label: "DESTINO" },
        { key: "route", label: "ROTA" }, { key: "km", label: "KM" },
        { label: "KM NO PAINEL", render: (r) => r.odometer_km ?? "—" },
        { label: "COMBUSTÍVEL", render: (r) => formatBRL(r.fuel_cost) }, { label: "PEDÁGIOS", render: (r) => formatBRL(r.toll_cost) },
        { label: "TOTAL", render: (r) => formatBRL(Number(r.fuel_cost || 0) + Number(r.toll_cost || 0) + Number(r.amount || 0)) },
      ]}
      footer={(rows) => sumBox("Total em viagens", total(rows, (r) => Number(r.fuel_cost || 0) + Number(r.toll_cost || 0) + Number(r.amount || 0)))} />
  );
}

export function Manutencao() {
  const [vehicles, setVehicles] = useState([]);
  const [services, setServices] = useState([]);
  const [selectedVehicle, setSelectedVehicle] = useState("");
  useEffect(() => {
    Promise.all([api.get("/vehicles"), api.get("/expenses")])
      .then(([vehicleResponse, expenseResponse]) => {
        setVehicles(vehicleResponse.data);
        setServices([...new Set(expenseResponse.data
          .filter((expense) => expense.type === "MANUTENCAO")
          .map((expense) => expense.description?.trim())
          .filter(Boolean))]);
      })
      .catch(() => toast.error("Não foi possível carregar veículos e serviços anteriores"));
  }, []);
  const serviceSuggestions = (editing) => {
    const query = String(editing.description || "").trim().toLocaleLowerCase();
    return services.filter((service) => !query || service.toLocaleLowerCase().includes(query));
  };
  const vehicleOptions = (editing) => vehicles
    .filter((vehicle) => vehicle.active !== false || vehicle.id === editing.vehicle_id)
    .map((vehicle) => ({
      value: vehicle.id,
      label: [vehicle.name, vehicle.model, vehicle.plate].filter(Boolean).join(" · "),
    }));
  const updateVehicleDetails = (vehicleId) => {
    const vehicle = vehicles.find((item) => item.id === vehicleId);
    return {
      vehicle_id: vehicleId,
      vehicle_model: vehicle ? [vehicle.name, vehicle.model].filter(Boolean).join(" · ") : "",
      plate: vehicle?.plate || "",
      km: vehicle?.current_km ?? "",
    };
  };
  const maintenanceReportFilters = ({ rows }) => {
    const vehicle = vehicles.find((item) => item.id === selectedVehicle);
    const vehicleLabel = vehicle ? [vehicle.name, vehicle.model, vehicle.plate].filter(Boolean).join(" · ") : "Todos os veículos";
    return (
      <section className="lokal-panel p-3 my-3 flex flex-wrap items-end gap-3" data-testid="maintenance-report-filters">
        <div className="font-head text-sm">Relatório de manutenção</div>
        <label className="text-xs font-mono">
          Veículo
          <select className="lm-input mt-1" value={selectedVehicle} onChange={(event) => setSelectedVehicle(event.target.value)} data-testid="maintenance-report-filter">
            <option value="">Todos os veículos</option>
            {vehicles.map((item) => (
              <option key={item.id} value={item.id}>{[item.name, item.model, item.plate].filter(Boolean).join(" · ")}</option>
            ))}
          </select>
        </label>
        <button className="lm-btn lm-btn-dark" onClick={() => {
          const filteredRows = selectedVehicle ? rows.filter((row) => row.vehicle_id === selectedVehicle) : rows;
          printRecordsReport({
            title: "Relatório de manutenção",
            filterLabel: vehicleLabel,
            rows: filteredRows,
            columns: [
              { label: "DATA", value: (row) => formatDateShort(row.date) },
              { label: "SERVIÇO", value: (row) => row.description },
              { label: "VEÍCULO", value: (row) => row.vehicle_model },
              { label: "PLACA", value: (row) => row.plate },
              { label: "KM", value: (row) => row.km },
              { label: "VALOR", value: (row) => formatBRL(row.amount) },
              { label: "PRÓX. REVISÃO", value: (row) => formatDateShort(row.next_review_date) },
            ],
          });
        }} data-testid="print-maintenance-report">
          Imprimir relatório de manutenção
        </button>
      </section>
    );
  };
  return (
    <CrudPage title="Manutenção Veículo" subtitle="Revisões, trocas de óleo, pneus e reparos" endpoint="expenses" testid="manutencao"
      filter={(r) => r.type === "MANUTENCAO"} defaults={{ type: "MANUTENCAO", date: new Date().toISOString().slice(0, 10) }}
      headerContent={maintenanceReportFilters}
      onSaved={(maintenance) => {
        const service = maintenance.description?.trim();
        if (service) setServices((previous) => previous.includes(service) ? previous : [...previous, service]);
      }}
      fields={[
        { key: "description", label: "Serviço", required: true, wide: true, suggestions: serviceSuggestions },
        { key: "vehicle_id", label: "Veículo cadastrado", type: "select", required: true, options: vehicleOptions, onChange: updateVehicleDetails },
        { key: "vehicle_model", label: "Veículo / Modelo", readOnly: true },
        { key: "plate", label: "Placa", readOnly: true },
        { key: "km", label: "KM atual", type: "number", readOnly: true },
        { key: "amount", label: "Valor (R$)", type: "number", required: true },
        { key: "date", label: "Data", type: "date" }, { key: "next_review_date", label: "Próxima revisão", type: "date" },
      ]}
      columns={[
        { label: "DATA", render: (r) => formatDateShort(r.date) }, { key: "description", label: "SERVIÇO" },
        { key: "vehicle_model", label: "VEÍCULO" }, { key: "plate", label: "PLACA" }, { key: "km", label: "KM" },
        { label: "VALOR", render: (r) => formatBRL(r.amount) }, { label: "PRÓX. REVISÃO", render: (r) => formatDateShort(r.next_review_date) },
      ]}
      footer={(rows) => sumBox("Total em manutenção", total(rows, (r) => Number(r.amount || 0)))} />
  );
}
