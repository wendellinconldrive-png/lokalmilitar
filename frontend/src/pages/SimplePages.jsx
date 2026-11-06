import React, { useEffect, useState } from "react";
import { CrudPage } from "@/components/CrudPage";
import { api, formatBRL, formatDateShort } from "@/lib/api";
import { toast } from "sonner";
import { Printer } from "lucide-react";
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
      defaults={{ cep: "", address_number: "", address: "", distance_km: 0 }}
      fields={[
        { key: "name", label: "Nome", required: true }, { key: "cnpj", label: "CNPJ" },
        { key: "phone", label: "Telefone" }, { key: "email", label: "E-mail" },
        { key: "address", label: "CEP e endereço", wide: true, render: (props) => <CustomerAddressFields {...props} /> },
        { key: "distance_km", label: "KM do depósito até o endereço", type: "number" },
        { key: "notes", label: "Observações", type: "textarea", wide: true },
      ]}
      columns={[{ key: "name", label: "NOME" }, { key: "cnpj", label: "CNPJ" }, { key: "phone", label: "TELEFONE" }, { key: "email", label: "E-MAIL" }, { key: "address", label: "ENDEREÇO" }, { key: "distance_km", label: "KM DO DEPÓSITO" }]} />
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
  const fuelUnit = updated.fuel_type === "GNV" ? "m³" : "L";
  const estimatedQuantity = consumption > 0 ? Math.round((km / consumption) * 100) / 100 : 0;
  const price = Math.max(Number(updated.fuel_price_per_unit ?? updated.fuel_price_per_liter ?? 0), 0);
  const fuelings = updated.fuelings || [];
  const hasFuelings = fuelings.length > 0;
  const fuelQuantities = fuelings.reduce((quantities, fillup) => {
    const fuelType = fillup.fuel_type || updated.fuel_type;
    const fillupPrice = Number(fillup.price_per_unit ?? fillup.price_per_liter ?? (fuelType === updated.fuel_type ? price : 0));
    const quantity = fillupPrice > 0 ? Number(fillup.amount || 0) / fillupPrice : 0;
    const unit = fuelType === "GNV" ? "m³" : "L";
    quantities[fuelType] = {
      quantity: (quantities[fuelType]?.quantity || 0) + quantity,
      unit,
    };
    return quantities;
  }, {});
  const quantity = hasFuelings ? fuelQuantities[updated.fuel_type]?.quantity || 0 : estimatedQuantity;
  const fuelCost = hasFuelings
    ? fuelings.reduce((sum, fillup) => sum + Number(fillup.amount || 0), 0)
    : estimatedQuantity * price;
  const tolls = updated.tolls || [];
  const tollCost = Array.isArray(updated.tolls)
    ? tolls.reduce((sum, toll) => sum + Number(toll.amount || 0), 0)
    : Number(updated.toll_cost || 0);
  return {
    ...changes,
    fuel_quantity: Math.round(quantity * 100) / 100,
    fuel_quantities: Object.fromEntries(Object.entries(fuelQuantities).map(([fuel, value]) => [
      fuel,
      { ...value, quantity: Math.round(value.quantity * 100) / 100 },
    ])),
    estimated_fuel_quantity: estimatedQuantity,
    fuel_quantity_unit: fuelUnit,
    fuel_liters: fuelUnit === "L" ? Math.round(quantity * 100) / 100 : 0,
    estimated_fuel_liters: fuelUnit === "L" ? estimatedQuantity : 0,
    fuel_cost: Math.round(fuelCost * 100) / 100,
    toll_cost: Math.round(tollCost * 100) / 100,
  };
};
const formatTripFuelQuantities = (trip) => {
  const quantities = Object.entries(trip.fuel_quantities || {});
  if (quantities.length) {
    return quantities.map(([fuel, value]) => `${fuel}: ${value.quantity} ${value.unit}`).join(" · ");
  }
  return `${Number(trip.fuel_quantity ?? trip.fuel_liters ?? 0)} ${trip.fuel_quantity_unit || (trip.fuel_type === "GNV" ? "m³" : "L")}`;
};
const printTripReport = (trip) => {
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    toast.error("Permita pop-ups para imprimir o percurso");
    return;
  }
  const destinations = trip.destinations?.length
    ? trip.destinations
    : trip.destination_id
      ? [{ destination_type: trip.destination_type, destination_id: trip.destination_id }]
      : [];
  const date = String(trip.date || "").slice(0, 10).split("-").reverse().join("/") || "—";
  const totalCost = Number(trip.fuel_cost || 0) + Number(trip.toll_cost || 0)
    + Number(trip.daily_allowance || 0) + Number(trip.amount || 0);
  const detailRows = [
    ["Código do percurso", trip.id],
    ["Data", date],
    ["Objetivo / destino", trip.description],
    ["Rota", trip.route],
    ["Veículo", trip.vehicle_name],
    ["Código do veículo", trip.vehicle_id],
    ["Quilometragem percorrida", `${Number(trip.km || 0).toLocaleString("pt-BR")} km`],
    ["KM no painel", trip.odometer_km == null ? "—" : `${Number(trip.odometer_km).toLocaleString("pt-BR")} km`],
    ["Data do fechamento diário", trip.day_close_date],
    ["Combustível principal", trip.fuel_type],
    ["Consumo médio", trip.avg_consumption == null ? "—" : `${trip.avg_consumption} km/${trip.fuel_type === "GNV" ? "m³" : "L"}`],
    ["Preço por unidade", formatBRL(trip.fuel_price_per_unit ?? trip.fuel_price_per_liter)],
    ["Quantidade abastecida", formatTripFuelQuantities(trip)],
    ["Consumo estimado", `${Number(trip.estimated_fuel_quantity ?? trip.estimated_fuel_liters ?? 0)} ${trip.fuel_quantity_unit || (trip.fuel_type === "GNV" ? "m³" : "L")}`],
    ["Gasto com combustível", formatBRL(trip.fuel_cost)],
    ["Total de pedágios", formatBRL(trip.toll_cost)],
    ["Diária", formatBRL(trip.daily_allowance)],
    ["Outros gastos", formatBRL(trip.amount)],
    ["Total do percurso", formatBRL(totalCost)],
    ...(trip.created_at ? [["Registro criado em", trip.created_at]] : []),
  ];
  const renderTable = (headers, rows, emptyMessage) => `
    <table><thead><tr>${headers.map((header) => `<th>${escapeReportHtml(header)}</th>`).join("")}</tr></thead>
    <tbody>${rows.length
      ? rows.map((row) => `<tr>${row.map((value) => `<td>${escapeReportHtml(value ?? "—")}</td>`).join("")}</tr>`).join("")
      : `<tr><td colspan="${headers.length}" class="empty">${escapeReportHtml(emptyMessage)}</td></tr>`}</tbody></table>`;
  const destinationRows = destinations.map((destination, index) => [
    index + 1,
    destination.destination_type === "fornecedor" ? "Fornecedor" : "Cliente",
    destination.name,
    destination.address,
    destination.destination_id,
    destination.distance_km == null ? "—" : `${Number(destination.distance_km).toLocaleString("pt-BR")} km`,
  ]);
  const fuelingRows = (trip.fuelings || []).map((fueling) => [
    fueling.fuel_type || trip.fuel_type,
    formatBRL(fueling.amount),
    formatBRL(fueling.price_per_unit ?? fueling.price_per_liter),
    fueling.quantity == null ? "—" : `${fueling.quantity} ${fueling.unit || (fueling.fuel_type === "GNV" ? "m³" : "L")}`,
    fueling.liters == null ? "—" : `${fueling.liters} L`,
  ]);
  const tollRows = (trip.tolls || []).map((toll) => [toll.description, formatBRL(toll.amount)]);
  const quantityRows = Object.entries(trip.fuel_quantities || {}).map(([fuel, value]) => [
    fuel, value.quantity, value.unit,
  ]);
  printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8">
    <title>Relatório do percurso · ${escapeReportHtml(trip.description || trip.id)}</title>
    <style>
      body{font:12px Arial,sans-serif;padding:24px;color:#222}h1{color:#354017;font-size:20px;margin-bottom:4px}
      h2{color:#354017;font-size:15px;margin:22px 0 8px}p{margin:4px 0 14px}
      table{width:100%;border-collapse:collapse;margin:8px 0 16px;page-break-inside:auto}
      tr{page-break-inside:avoid}th,td{border:1px solid #aaa;padding:7px;text-align:left;vertical-align:top}
      th{background:#eee}.empty{text-align:center;color:#666}.summary{font-weight:bold;background:#f2f2ed}
      @media print{body{padding:0}}
    </style></head><body>
    <h1>LOKAL MILITAR — Relatório individual do percurso</h1>
    <p>Emitido em ${escapeReportHtml(new Date().toLocaleString("pt-BR"))}</p>
    <h2>Dados do percurso</h2>
    ${renderTable(["Informação", "Dado registrado"], detailRows, "Nenhum dado registrado.")}
    <h2>Destinos</h2>
    ${renderTable(["Ordem", "Tipo", "Nome", "Endereço", "Código do destino", "Distância cadastrada"], destinationRows, "Nenhum destino informado.")}
    <h2>Abastecimentos</h2>
    ${renderTable(["Combustível", "Valor gasto", "Preço por unidade", "Quantidade", "Litros"], fuelingRows, "Nenhum abastecimento detalhado.")}
    <h2>Quantidades por combustível</h2>
    ${renderTable(["Combustível", "Quantidade", "Unidade"], quantityRows, "Nenhuma quantidade discriminada por combustível.")}
    <h2>Pedágios</h2>
    ${renderTable(["Praça / observação", "Valor"], tollRows, "Nenhum pedágio informado.")}
    <table><tbody><tr class="summary"><th>Total de despesas do percurso</th><td>${escapeReportHtml(formatBRL(totalCost))}</td></tr></tbody></table>
    </body></html>`);
  printWindow.document.close();
  printWindow.setTimeout(() => printWindow.print(), 300);
};

function TripDestinationsField({ editing, setEditing, customers, suppliers }) {
  const [destinationType, setDestinationType] = useState("cliente");
  const [destinationId, setDestinationId] = useState("");
  const destinations = editing.destinations?.length
    ? editing.destinations
    : editing.destination_id
      ? [{ destination_type: editing.destination_type || "cliente", destination_id: editing.destination_id }]
      : [];
  const entries = destinationType === "fornecedor" ? suppliers : customers;
  const updateDestinations = (nextDestinations) => {
    const distance = nextDestinations.reduce((sum, stop) => {
      const source = stop.destination_type === "fornecedor" ? suppliers : customers;
      const entry = source.find((item) => item.id === stop.destination_id);
      return sum + Number(entry?.distance_km || 0) * 2;
    }, 0);
    const routeStops = nextDestinations.map((stop) => {
      const source = stop.destination_type === "fornecedor" ? suppliers : customers;
      const entry = source.find((item) => item.id === stop.destination_id);
      return entry?.address || entry?.name;
    }).filter(Boolean);
    setEditing({
      ...editing,
      destinations: nextDestinations,
      destination_type: nextDestinations[0]?.destination_type || "cliente",
      destination_id: nextDestinations[0]?.destination_id || "",
      km: distance,
      route: routeStops.length ? `Depósito → ${routeStops.join(" → ")} → Depósito` : "",
      ...recalculateTrip(editing, { km: distance }),
    });
  };
  const addDestination = () => {
    if (!destinationId) return;
    if (destinations.some((stop) => stop.destination_type === destinationType && stop.destination_id === destinationId)) {
      toast.error("Este destino já foi adicionado");
      return;
    }
    updateDestinations([...destinations, { destination_type: destinationType, destination_id: destinationId }]);
    setDestinationId("");
  };

  return (
    <div className="space-y-2" data-testid="trip-destinations">
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2">
        <select className="crud-input" value={destinationType} onChange={(event) => {
          setDestinationType(event.target.value);
          setDestinationId("");
        }} data-testid="trip-destination-type">
          <option value="cliente">Cliente</option>
          <option value="fornecedor">Fornecedor</option>
        </select>
        <select className="crud-input" value={destinationId} onChange={(event) => setDestinationId(event.target.value)} data-testid="trip-destination-select">
          <option value="">Selecione</option>
          {entries.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
        </select>
        <button type="button" className="lm-btn lm-btn-dark whitespace-nowrap" onClick={addDestination} disabled={!destinationId} data-testid="trip-add-destination">Adicionar destino</button>
      </div>
      {destinations.length ? (
        <ol className="space-y-1">
          {destinations.map((stop, index) => {
            const source = stop.destination_type === "fornecedor" ? suppliers : customers;
            const entry = source.find((item) => item.id === stop.destination_id);
            return (
              <li key={`${stop.destination_type}:${stop.destination_id}`} className="flex justify-between gap-2 text-xs border p-2">
                <span>{index + 1}. {stop.destination_type === "fornecedor" ? "Fornecedor" : "Cliente"}: {entry?.name || stop.name || "Destino"}</span>
                <button type="button" className="text-red-700" onClick={() => updateDestinations(destinations.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remover destino ${entry?.name || index + 1}`}>Remover</button>
              </li>
            );
          })}
        </ol>
      ) : <p className="text-xs text-neutral-500">Adicione um ou mais clientes/fornecedores antes do retorno ao depósito.</p>}
    </div>
  );
}

function TripFuelingsField({ editing, setEditing, fuelPrices, fuelTypes, recalculate }) {
  const fuelings = editing.fuelings || [];
  const setFuelings = (nextFuelings) => setEditing({
    ...editing,
    fuelings: nextFuelings,
    ...recalculate(editing, { fuelings: nextFuelings }),
  });
  return (
    <div className="space-y-2" data-testid="trip-fuelings">
      {fuelings.map((fillup, index) => (
        <div key={index} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end border p-2">
          <label className="text-xs">Combustível
            <select className="crud-input" value={fillup.fuel_type || editing.fuel_type || ""} onChange={(event) => {
              const fuelType = event.target.value;
              const next = fuelings.map((item, itemIndex) => itemIndex === index
                ? { ...item, fuel_type: fuelType, price_per_unit: fuelPrices[fuelType] || "" }
                : item);
              setFuelings(next);
            }} data-testid={`trip-fueling-type-${index}`}>
              {fuelTypes.map((fuel) => <option key={fuel} value={fuel}>{fuel}</option>)}
            </select>
          </label>
          <label className="text-xs">Valor gasto (R$)
            <input className="crud-input" type="number" min="0" step="0.01" value={fillup.amount ?? ""} onChange={(event) => {
              const next = fuelings.map((item, itemIndex) => itemIndex === index ? { ...item, amount: event.target.value } : item);
              setFuelings(next);
            }} data-testid={`trip-fueling-amount-${index}`} />
          </label>
          <label className="text-xs">Preço por {(fillup.fuel_type || editing.fuel_type) === "GNV" ? "m³" : "litro"} (R$)
            <input className="crud-input" type="number" min="0" step="0.01" value={fillup.price_per_unit ?? fillup.price_per_liter ?? ""} onChange={(event) => {
              const next = fuelings.map((item, itemIndex) => itemIndex === index ? { ...item, price_per_unit: event.target.value } : item);
              setFuelings(next);
            }} data-testid={`trip-fueling-price-${index}`} />
          </label>
          <button type="button" className="text-xs text-red-700 px-2 py-2" onClick={() => setFuelings(fuelings.filter((_, itemIndex) => itemIndex !== index))}>Remover</button>
        </div>
      ))}
      <button type="button" className="lm-btn lm-btn-dark" onClick={() => setFuelings([...fuelings, {
        amount: "",
        price_per_unit: editing.fuel_price_per_unit || editing.fuel_price_per_liter || fuelPrices[editing.fuel_type] || "",
        fuel_type: editing.fuel_type,
      }])} data-testid="trip-add-fueling">Adicionar abastecimento</button>
      {Object.entries(editing.fuel_quantities || {}).map(([fuel, value]) => (
        <p key={fuel} className="text-xs text-neutral-600">{fuel}: {value.quantity} {value.unit}</p>
      ))}
      <p className="text-xs text-neutral-600">Cada abastecimento é calculado separadamente pelo combustível e preço por unidade. O consumo estimado usa o combustível principal selecionado acima.</p>
    </div>
  );
}

function TripTollsField({ editing, setEditing, recalculate }) {
  const tolls = editing.tolls || [];
  const setTolls = (nextTolls) => setEditing({
    ...editing,
    tolls: nextTolls,
    ...recalculate(editing, { tolls: nextTolls }),
  });
  return (
    <div className="space-y-2" data-testid="trip-tolls">
      {tolls.map((toll, index) => (
        <div key={index} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-end">
          <label className="text-xs">Praça / observação
            <input className="crud-input" value={toll.description || ""} onChange={(event) => {
              setTolls(tolls.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item));
            }} />
          </label>
          <label className="text-xs">Valor (R$)
            <input className="crud-input" type="number" min="0" step="0.01" value={toll.amount ?? ""} onChange={(event) => {
              setTolls(tolls.map((item, itemIndex) => itemIndex === index ? { ...item, amount: event.target.value } : item));
            }} data-testid={`trip-toll-amount-${index}`} />
          </label>
          <button type="button" className="text-xs text-red-700 px-2 py-2" onClick={() => setTolls(tolls.filter((_, itemIndex) => itemIndex !== index))}>Remover</button>
        </div>
      ))}
      <button type="button" className="lm-btn lm-btn-dark" onClick={() => setTolls([...tolls, { description: "", amount: "" }])} data-testid="trip-add-toll">Adicionar pedágio</button>
    </div>
  );
}

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
        { key: "avg_consumption", label: (editing) => {
          const fuels = editing.fuel_types?.length ? editing.fuel_types : editing.fuel_type ? [editing.fuel_type] : [];
          return `Consumo médio (km/${fuels.length === 1 && fuels[0] === "GNV" ? "m³" : fuels.includes("GNV") ? "L ou m³" : "L"})`;
        }, type: "number" },
        { key: "current_km", label: "Quilometragem atual", type: "number" },
        { key: "active", label: "Veículo ativo", type: "checkbox" },
      ]}
      columns={[
        { key: "name", label: "VEÍCULO" }, { key: "model", label: "MODELO" }, { key: "plate", label: "PLACA" },
        { label: "COMBUSTÍVEIS", render: (vehicle) => (vehicle.fuel_types?.length ? vehicle.fuel_types : vehicle.fuel_type ? [vehicle.fuel_type] : []).join(", ") },
        { label: "CONSUMO MÉDIO", render: (vehicle) => {
          const fuels = vehicle.fuel_types?.length ? vehicle.fuel_types : vehicle.fuel_type ? [vehicle.fuel_type] : [];
          const unit = fuels.length === 1 && fuels[0] === "GNV" ? "m³" : fuels.includes("GNV") ? "L ou m³" : "L";
          return `${vehicle.avg_consumption || 0} km/${unit}`;
        } }, { key: "current_km", label: "KM ATUAL" },
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
  const [selectedReportVehicleIds, setSelectedReportVehicleIds] = useState([]);
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
        const activeVehicles = v.data.filter((vehicle) => vehicle.active !== false);
        setVehicles(activeVehicles);
        setSelectedReportVehicleIds(activeVehicles.map((vehicle) => vehicle.id));
        setFuelPrices(settings.data.fuel_prices || {});
      })
      .catch(() => toast.error("Não foi possível carregar clientes, fornecedores e veículos"));
  }, []);
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
    const price = Number(trip.fuel_price_per_unit ?? trip.fuel_price_per_liter ?? fuelPrices[fuel] ?? 0);
    return {
      ...trip,
      destinations: trip.destinations?.length ? trip.destinations : trip.destination_id ? [{
        destination_type: trip.destination_type || "cliente",
        destination_id: trip.destination_id,
      }] : [],
      fuelings: trip.fuelings || [],
      ...recalculateTrip(trip, {
        fuel_type: fuel,
        avg_consumption: consumption,
        fuel_price_per_unit: price,
      }),
    };
  };
  const printTravelReport = async () => {
    const range = getTravelPeriodRange(reportPeriodType, reportPeriod);
    if (!range) {
      toast.error("Selecione um período válido para o relatório");
      return;
    }
    if (!selectedReportVehicleIds.length) {
      toast.error("Selecione pelo menos um veículo para imprimir o relatório");
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
        .filter((trip) => selectedReportVehicleIds.includes(trip.vehicle_id))
        .filter((trip) => {
          const date = String(trip.date || "").slice(0, 10);
          return date >= range.start && date < range.end;
        })
        .sort((first, second) => String(first.date).localeCompare(String(second.date)));
      const totalKm = trips.reduce((sum, trip) => sum + Number(trip.km || 0), 0);
      const totalExpenses = trips.reduce((sum, trip) => (
        sum + Number(trip.fuel_cost || 0) + Number(trip.toll_cost || 0)
        + Number(trip.daily_allowance || 0) + Number(trip.amount || 0)
      ), 0);
      const rows = trips.map((trip) => `
        <tr><td>${escapeReportHtml(String(trip.date || "").slice(0, 10).split("-").reverse().join("/"))}</td>
        <td>${escapeReportHtml(trip.description)}</td><td>${escapeReportHtml(trip.route)}</td>
        <td>${escapeReportHtml(trip.vehicle_name || vehicles.find((vehicle) => vehicle.id === trip.vehicle_id)?.name || "—")}</td>
        <td>${escapeReportHtml(trip.fuel_type || "—")}</td>
        <td>${escapeReportHtml(formatTripFuelQuantities(trip))}</td>
        <td>${escapeReportHtml(Number(trip.km || 0).toLocaleString("pt-BR"))}</td>
        <td>${escapeReportHtml(formatBRL(trip.fuel_cost))}</td><td>${escapeReportHtml(formatBRL(trip.toll_cost))}</td>
        <td>${escapeReportHtml(formatBRL(trip.daily_allowance))}</td>
        <td>${escapeReportHtml(formatBRL(Number(trip.fuel_cost || 0) + Number(trip.toll_cost || 0) + Number(trip.daily_allowance || 0) + Number(trip.amount || 0)))}</td></tr>`);
      printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Relatório de percursos · ${escapeReportHtml(range.label)}</title>
        <style>body{font:12px Arial,sans-serif;padding:24px;color:#222}h1{color:#354017;font-size:20px}table{width:100%;border-collapse:collapse;margin-top:16px}th,td{border:1px solid #aaa;padding:7px;text-align:left}th{background:#eee}.summary{margin-top:16px;padding:10px;border:1px solid #aaa;font-weight:bold}</style>
        </head><body><h1>LOKAL MILITAR — Relatório de percursos</h1><p>Período: ${escapeReportHtml(range.label)} · ${escapeReportHtml(range.start)} a ${escapeReportHtml(new Date(new Date(`${range.end}T00:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10))}</p>
        <table><thead><tr><th>Data</th><th>Percurso</th><th>Rota</th><th>Veículo</th><th>Combustível</th><th>Quantidade</th><th>KM percorridos</th><th>Abastecimentos</th><th>Pedágios</th><th>Diária</th><th>Total</th></tr></thead>
        <tbody>${rows.length ? rows.join("") : '<tr><td colspan="11" style="text-align:center">Nenhum percurso registrado no período.</td></tr>'}</tbody></table>
        <div class="summary">Quilometragem total percorrida: ${escapeReportHtml(totalKm.toLocaleString("pt-BR"))} km · Despesas totais: ${escapeReportHtml(formatBRL(totalExpenses))}</div></body></html>`);
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
      <fieldset className="w-full">
        <legend className="text-xs font-mono mb-2">Veículos incluídos</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {vehicles.map((vehicle) => (
            <label key={vehicle.id} className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={selectedReportVehicleIds.includes(vehicle.id)}
                onChange={(event) => setSelectedReportVehicleIds((selected) => (
                  event.target.checked
                    ? [...selected, vehicle.id]
                    : selected.filter((id) => id !== vehicle.id)
                ))}
                data-testid={`travel-report-vehicle-${vehicle.id}`}
              />
              {[vehicle.name, vehicle.plate].filter(Boolean).join(" · ")}
            </label>
          ))}
          {!vehicles.length && <span className="text-xs text-neutral-500">Nenhum veículo ativo cadastrado.</span>}
        </div>
        {!!vehicles.length && (
          <button
            type="button"
            className="text-xs underline mt-2"
            onClick={() => setSelectedReportVehicleIds(vehicles.map((vehicle) => vehicle.id))}
            data-testid="travel-report-select-all-vehicles"
          >
            Selecionar todos
          </button>
        )}
      </fieldset>
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
      defaults={{ type: "VIAGEM", destination_type: "cliente", destinations: [], fuelings: [], tolls: [], fuel_type: FUEL_TYPES[0], fuel_price_per_unit: Number(fuelPrices[FUEL_TYPES[0]] || 0), date: new Date().toISOString().slice(0, 10) }}
      fields={[
        { key: "destinations", label: "Destinos antes do retorno ao estoque", wide: true, render: ({ editing, setEditing }) => <TripDestinationsField editing={editing} setEditing={setEditing} customers={customers} suppliers={suppliers} /> },
        { key: "description", label: "Destino / Objetivo", required: true, wide: true },
        { key: "route", label: "Rota (origem → destino)", wide: true },
        { key: "date", label: "Data", type: "date" },
        { key: "vehicle_id", label: "Veículo", type: "select", options: vehicles.map((vehicle) => ({ value: vehicle.id, label: `${vehicle.name}${vehicle.plate ? ` · ${vehicle.plate}` : ""}` })), onChange: (value, editing) => {
          const vehicle = vehicles.find((item) => item.id === value);
          const fuels = vehicle?.fuel_types?.length ? vehicle.fuel_types : vehicle?.fuel_type ? [vehicle.fuel_type] : [];
          const fuel = fuels.includes(editing.fuel_type) ? editing.fuel_type : fuels[0] || editing.fuel_type;
          const price = Number(fuelPrices[fuel] ?? editing.fuel_price_per_unit ?? editing.fuel_price_per_liter ?? 0);
          const consumption = Number(vehicle?.avg_consumption || 0);
          return { vehicle_id: value, fuel_type: fuel, avg_consumption: consumption, fuel_price_per_unit: price, ...recalculateTrip(editing, { fuel_type: fuel, avg_consumption: consumption, fuel_price_per_unit: price }) };
        } },
        { key: "km", label: "KM rodados (ida e volta)", type: "number", onChange: (value, editing) => ({ km: value, ...recalculateTrip(editing, { km: value }) }) },
        { key: "fuel_type", label: "Combustível", type: "select", options: availableFuels, onChange: (value, editing) => {
          const price = Number(fuelPrices[value] || 0);
          return { fuel_type: value, fuel_price_per_unit: price, ...recalculateTrip(editing, { fuel_type: value, fuel_price_per_unit: price }) };
        } },
        { key: "avg_consumption", label: (editing) => `Consumo médio (km/${editing.fuel_type === "GNV" ? "m³" : "L"})`, type: "number", onChange: (value, editing) => ({ avg_consumption: value, ...recalculateTrip(editing, { avg_consumption: value }) }) },
        { key: "fuel_quantity", label: "Combustível abastecido", render: ({ editing }) => <div className="crud-input">{formatTripFuelQuantities(editing)}</div> },
        { key: "estimated_fuel_quantity", label: (editing) => `Consumo estimado no percurso (${editing.fuel_type === "GNV" ? "m³" : "L"})`, type: "number", readOnly: true },
        { key: "fuel_price_per_unit", label: (editing) => `Preço por ${editing.fuel_type === "GNV" ? "m³" : "litro"} (R$)`, type: "number", onChange: (value, editing) => ({ fuel_price_per_unit: value, ...recalculateTrip(editing, { fuel_price_per_unit: value }) }) },
        { key: "fuel_cost", label: "Gasto combustível (R$)", type: "number", readOnly: true },
        { key: "fuelings", label: "Abastecimentos", wide: true, render: ({ editing, setEditing }) => <TripFuelingsField editing={editing} setEditing={setEditing} fuelPrices={fuelPrices} fuelTypes={availableFuels(editing)} recalculate={recalculateTrip} /> },
        { key: "toll_cost", label: "Total de pedágios (R$)", type: "number", readOnly: true },
        { key: "tolls", label: "Pedágios", wide: true, render: ({ editing, setEditing }) => <TripTollsField editing={editing} setEditing={setEditing} recalculate={recalculateTrip} /> },
        { key: "daily_allowance", label: "Diária (R$)", type: "number" },
        { key: "amount", label: "Outros gastos (R$)", type: "number" },
      ]}
      columns={[
        { label: "DATA", render: (r) => formatDateShort(r.date) }, { key: "description", label: "DESTINO" },
        { key: "route", label: "ROTA" }, { key: "km", label: "KM" },
        { label: "KM NO PAINEL", render: (r) => r.odometer_km ?? "—" },
        { label: "COMBUSTÍVEL", render: (r) => formatBRL(r.fuel_cost) }, { label: "PEDÁGIOS", render: (r) => formatBRL(r.toll_cost) },
        { label: "DIÁRIA", render: (r) => formatBRL(r.daily_allowance) },
        { label: "TOTAL", render: (r) => formatBRL(Number(r.fuel_cost || 0) + Number(r.toll_cost || 0) + Number(r.daily_allowance || 0) + Number(r.amount || 0)) },
      ]}
      rowActions={(trip) => (
        <button
          type="button"
          className="p-1 hover:bg-neutral-200"
          onClick={() => printTripReport(trip)}
          aria-label={`Imprimir relatório do percurso ${trip.description || trip.id}`}
          title="Imprimir relatório deste percurso"
          data-testid={`print-trip-report-${trip.id}`}
        >
          <Printer size={13} />
        </button>
      )}
      footer={(rows) => sumBox("Total em viagens", total(rows, (r) => Number(r.fuel_cost || 0) + Number(r.toll_cost || 0) + Number(r.daily_allowance || 0) + Number(r.amount || 0)))} />
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
