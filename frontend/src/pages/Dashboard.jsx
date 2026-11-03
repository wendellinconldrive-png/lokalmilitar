import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, formatBRL } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Shirt, Footprints, Package, Award, ClipboardList, Clock, Users, CircleDollarSign, AlertTriangle, Scissors, Car, Shield, Star, ClipboardCheck, Printer, CalendarDays, CalendarPlus, Download, Trash2 } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, CartesianGrid } from "recharts";
import { DASHBOARD_KPIS, getVisibleDashboardGridPositions } from "@/pages/dashboardPreferences";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import useSubmitLock from "@/hooks/useSubmitLock";

const ICONS = { Shirt, Footprints, Package, Award, Shield, Star };
const UNIT = { "Fardamento": "peças", "Calçados": "pares" };
const localDateValue = () => {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
};

const DashboardCardHeader = ({ children, icon: Icon, iconColor, textColor }) => (
  <div className="lm-card-head" style={{ background: "var(--card-header-background)", color: textColor || "var(--card-header-text)" }}>
    <span className="text-[15px]">{children}</span>
    {Icon && <Icon size={18} color={iconColor} />}
  </div>
);

const CategoryCard = ({ cat, onClick, colors, textColor, position }) => {
  const Icon = ICONS[cat.icon] || Package;
  return (
    <button onClick={onClick} className="lokal-tile dashboard-grid-item text-left overflow-hidden" style={{ background: colors.card_background, color: textColor || colors.card_text, borderColor: colors.card_border, "--dashboard-row": position.row, "--dashboard-column": position.column }} data-testid={`card-cat-${cat.name}`}>
      <DashboardCardHeader icon={Icon} iconColor={colors.chart_accent} textColor={textColor}>{cat.name}</DashboardCardHeader>
      <div className="px-4 py-3">
        <div className="flex items-baseline gap-2"><span className="font-head text-3xl font-bold">{Math.round(cat.qty)}</span><span className="text-sm" style={{ color: textColor || "var(--muted-text-color)" }}>{UNIT[cat.name] || "unid"}</span></div>
      </div>
    </button>
  );
};

const Kpi = ({ icon: Icon, label, value, sub, onClick, testid, colors, textColor, position }) => (
  <button onClick={onClick} className="lokal-tile dashboard-grid-item text-left overflow-hidden" style={{ background: colors.card_background, color: textColor || colors.card_text, borderColor: colors.card_border, "--dashboard-row": position.row, "--dashboard-column": position.column }} data-testid={testid}>
    <DashboardCardHeader icon={Icon} iconColor={colors.chart_accent} textColor={textColor}>{label}</DashboardCardHeader>
    <div className="px-4 py-3">
      <div className="font-head text-2xl font-bold leading-tight">{value}</div>
      {sub && <div className="text-sm truncate" style={{ color: textColor || "var(--muted-text-color)" }}>{sub}</div>}
    </div>
  </button>
);

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[character]));

const printDayClosure = (report) => {
  const printWindow = window.open("", "_blank");
  if (!printWindow) return false;
  const table = (headers, rows) => `
    <table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>
    <tbody>${rows.length ? rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${headers.length}">Sem movimentações</td></tr>`}</tbody></table>`;
  const orderRows = report.orders.map((order) => [
    `#${order.number}`, order.type, order.customer_name, order.status, formatBRL(order.total || 0),
  ]);
  const stockRows = report.stock_movements.map((movement) => [
    movement.kind, movement.product_name, movement.size, movement.qty, movement.nf || movement.reason || "",
  ]);
  const expenseRows = report.expenses.map((expense) => [
    expense.type, expense.description, expense.km ?? "", expense.odometer_km ?? "",
    formatBRL(Number(expense.amount || 0) + Number(expense.fuel_cost || 0) + Number(expense.toll_cost || 0)),
  ]);

  printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Fechamento do dia ${escapeHtml(report.date)}</title>
    <style>body{font:12px Arial,sans-serif;padding:24px;color:#222}h1,h2{color:#354017}h1{font-size:20px}h2{font-size:15px;margin-top:26px}table{width:100%;border-collapse:collapse;margin-top:8px}th,td{border:1px solid #aaa;padding:6px;text-align:left}th{background:#eee}.summary{display:flex;gap:24px;padding:12px 0}.summary div{padding:8px;border:1px solid #aaa}</style>
    </head><body><h1>LOKAL MILITAR — Fechamento do dia ${escapeHtml(report.date.split("-").reverse().join("/"))}</h1>
    <p>Registrado em ${escapeHtml(new Date(report.closed_at).toLocaleString("pt-BR"))} por ${escapeHtml(report.closed_by)}</p>
    <div class="summary"><div>Pedidos: ${report.summary.orders_count} · ${formatBRL(report.summary.orders_total)}</div><div>Movimentações de estoque: ${report.summary.stock_movements_count}</div><div>Despesas: ${report.summary.expenses_count} · ${formatBRL(report.summary.expenses_total)}</div></div>
    <h2>Pedidos, vendas, trocas e devoluções</h2>${table(["Pedido", "Tipo", "Cliente", "Status", "Total"], orderRows)}
    <h2>Movimentações de estoque</h2>${table(["Tipo", "Produto", "Tamanho", "Qtd.", "NF / Motivo"], stockRows)}
    <h2>Despesas, insumos e viagens</h2>${table(["Tipo", "Descrição", "KM", "KM no painel", "Valor"], expenseRows)}
    </body></html>`);
  printWindow.document.close();
  printWindow.setTimeout(() => printWindow.print(), 500);
  return true;
};

export default function Dashboard() {
  const { run: withSubmitLock, isPending } = useSubmitLock();
  const nav = useNavigate();
  const { dashboardPreferences, user, logout } = useAuth();
  const isAdmin = user?.role === "admin";
  const [data, setData] = useState(null);
  const [cats, setCats] = useState([]);
  const [error, setError] = useState("");
  const [closingDay, setClosingDay] = useState(false);
  const [closeDayDialogOpen, setCloseDayDialogOpen] = useState(false);
  const [vehicles, setVehicles] = useState([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState("");
  const [currentOdometer, setCurrentOdometer] = useState("");
  const [closureHistoryOpen, setClosureHistoryOpen] = useState(false);
  const [closureHistory, setClosureHistory] = useState([]);
  const [selectedClosureDate, setSelectedClosureDate] = useState("");
  const [loadingClosureHistory, setLoadingClosureHistory] = useState(false);
  const [closureReport, setClosureReport] = useState(null);
  const [downloadingBackup, setDownloadingBackup] = useState(false);
  const [events, setEvents] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventDialogOpen, setEventDialogOpen] = useState(false);
  const [eventTitle, setEventTitle] = useState("");
  const [eventDescription, setEventDescription] = useState("");
  const [eventDate, setEventDate] = useState(localDateValue);
  const { chart_days: chartDays, chart_type: chartType, order, visibility, grid_positions: configuredGridPositions } = dashboardPreferences;
  const showAnnouncements = dashboardPreferences.show_announcements !== false;
  const textColor = dashboardPreferences.card_text_customized ? dashboardPreferences.colors.card_text : null;
  const colors = {
    background: "transparent",
    card_background: "var(--panel-bg)",
    card_text: "var(--system-text-color)",
    card_border: "var(--line)",
    chart_line: "var(--olive)",
    chart_accent: "var(--gold)",
    chart_grid: "var(--line)",
  };

  useEffect(() => {
    setError("");
    api.get("/dashboard", { params: { days: chartDays } })
      .then(async ({ data: dashboardData }) => {
        setData(dashboardData);
        if (Array.isArray(dashboardData.categories)) {
          setCats(dashboardData.categories);
        } else {
          const { data: categories } = await api.get("/categories");
          setCats(categories);
        }
      })
      .catch(() => setError("Não foi possível carregar os dados do dashboard."));
  }, [chartDays]);

  useEffect(() => {
    let active = true;
    api.get("/dashboard/events")
      .then(({ data: loadedEvents }) => {
        if (active) setEvents(loadedEvents);
      })
      .catch((eventError) => {
        if (active) toast.error(eventError.response?.data?.detail || "Não foi possível carregar os eventos");
      })
      .finally(() => {
        if (active) setEventsLoading(false);
      });
    return () => { active = false; };
  }, []);

  const createEvent = () => withSubmitLock("create-dashboard-event", async () => {
    try {
      const { data: createdEvent } = await api.post("/dashboard/events", {
        title: eventTitle,
        description: eventDescription,
        event_date: eventDate,
      });
      setEvents((current) => [createdEvent, ...current].sort((first, second) => (
        second.event_date.localeCompare(first.event_date)
        || second.created_at.localeCompare(first.created_at)
      )));
      setEventTitle("");
      setEventDescription("");
      setEventDate(localDateValue());
      setEventDialogOpen(false);
      toast.success("Evento registrado");
    } catch (eventError) {
      toast.error(eventError.response?.data?.detail || "Não foi possível registrar o evento");
    }
  });

  const deleteEvent = async (eventId) => {
    if (!window.confirm("Excluir este evento do quadro de avisos?")) return;
    try {
      await api.delete(`/dashboard/events/${eventId}`);
      setEvents((current) => current.filter((event) => event.id !== eventId));
      toast.success("Evento removido");
    } catch (eventError) {
      toast.error(eventError.response?.data?.detail || "Não foi possível remover o evento");
    }
  };

  const openCloseDayDialog = async () => {
    try {
      const { data: availableVehicles } = await api.get("/vehicles");
      const activeVehicles = availableVehicles.filter((vehicle) => vehicle.active !== false);
      setVehicles(activeVehicles);
      setSelectedVehicleId(activeVehicles[0]?.id || "");
      setCurrentOdometer("");
      setCloseDayDialogOpen(true);
    } catch (vehiclesError) {
      toast.error(vehiclesError.response?.data?.detail || "Não foi possível carregar os veículos");
    }
  };

  const closeDay = (registerMileage = false) => withSubmitLock("close-day", async () => {
    let payload;
    if (registerMileage) {
      const vehicle = vehicles.find((item) => item.id === selectedVehicleId);
      const odometer = Number(currentOdometer);
      if (!vehicle) {
        toast.error("Selecione um veículo para registrar a quilometragem");
        return;
      }
      if (currentOdometer === "" || !Number.isFinite(odometer) || odometer < Number(vehicle.current_km || 0)) {
        toast.error(`Informe uma quilometragem igual ou maior que a registrada (${Number(vehicle.current_km || 0)} km)`);
        return;
      }
      payload = { vehicle_id: vehicle.id, current_km: odometer };
    }

    setClosingDay(true);
    try {
      const { data: report } = await api.post("/dashboard/close-day", payload);
      setCloseDayDialogOpen(false);
      setClosureReport(report);
      toast.success("Fechamento concluído. As sessões serão encerradas em todos os dispositivos.");
      window.setTimeout(logout, 8000);
    } catch (closeError) {
      toast.error(closeError.response?.data?.detail || "Não foi possível finalizar o dia");
    } finally {
      setClosingDay(false);
    }
  });

  const openClosureHistory = async () => {
    setLoadingClosureHistory(true);
    try {
      const { data: history } = await api.get("/dashboard/closures");
      setClosureHistory(history);
      setSelectedClosureDate(history[0]?.date || "");
      setClosureHistoryOpen(true);
    } catch (historyError) {
      toast.error(historyError.response?.data?.detail || "Não foi possível carregar os fechamentos anteriores");
    } finally {
      setLoadingClosureHistory(false);
    }
  };

  const showSelectedClosure = async () => {
    if (!selectedClosureDate) {
      toast.error("Selecione um dia registrado");
      return;
    }
    setLoadingClosureHistory(true);
    try {
      const { data: report } = await api.get(`/dashboard/closures/${selectedClosureDate}`);
      setClosureHistoryOpen(false);
      setClosureReport(report);
    } catch (historyError) {
      toast.error(historyError.response?.data?.detail || "Não foi possível carregar o fechamento selecionado");
    } finally {
      setLoadingClosureHistory(false);
    }
  };

  const downloadClosureBackup = async () => {
    if (!closureReport?.backup_id) {
      toast.error("Este fechamento não possui um backup associado");
      return;
    }
    setDownloadingBackup(true);
    try {
      const { data } = await api.get(`/dashboard/backups/${closureReport.backup_id}`, { responseType: "blob" });
      const url = URL.createObjectURL(data);
      const link = document.createElement("a");
      link.href = url;
      link.download = `lokal-militar-backup-${closureReport.date}.zip`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Não foi possível baixar o backup");
    } finally {
      setDownloadingBackup(false);
    }
  };

  if (error) return <div className="font-mono" role="alert">{error}</div>;
  if (!data) return <div className="font-mono">Carregando operação...</div>;

  const tiles = Object.entries(data.totals_by_cat).map(([name, v]) => ({ name, ...v, icon: cats.find((c) => c.name === name)?.icon }));
  const chartData = data.chart.map((d) => ({ label: d.date.slice(8, 10) + "/" + d.date.slice(5, 7), vendas: d.value }));
  const kpis = {
    orders_today: { icon: ClipboardList, label: "Pedidos hoje", value: data.orders_today, sub: formatBRL(data.orders_today_total), onClick: () => nav("/pedidos"), testid: "kpi-orders-today" },
    pending: { icon: Clock, label: "Pedidos pendentes", value: data.pending, sub: "Orçamento / Aprovado / Separado", onClick: () => nav("/pedidos"), testid: "kpi-pending" },
    customers: { icon: Users, label: "Clientes", value: data.customers, onClick: () => nav("/clientes"), testid: "kpi-customers" },
    commission_month: { icon: CircleDollarSign, label: "Comissão do mês", value: formatBRL(data.commission_month), onClick: () => nav("/comissoes"), testid: "kpi-commission" },
    low_stock: { icon: AlertTriangle, label: "Estoque baixo", value: data.low_stock.length, sub: "tamanhos no mínimo", onClick: () => nav("/estoque?low=1"), testid: "kpi-low-stock" },
    insumos: { icon: Scissors, label: "Gastos insumos (mês)", value: formatBRL(data.insumos_month), onClick: () => nav("/insumos"), testid: "kpi-insumos" },
    maintenance: { icon: Car, label: "Manutenção veículo", value: formatBRL(data.manut_month), sub: data.manut_alerts ? `${data.manut_alerts} revisão(ões) próxima(s)` : "Sem alertas", onClick: () => nav("/manutencao"), testid: "kpi-manutencao" },
  };
  const available = [
    ...tiles.map((tile) => `category:${tile.name}`),
    ...DASHBOARD_KPIS.map(({ id }) => id),
    "chart",
  ];
  const displayOrder = [...order.filter((id) => available.includes(id)), ...available.filter((id) => !order.includes(id))];
  const visibleItems = displayOrder.filter((id) => id === "chart"
    ? visibility.chart !== false || showAnnouncements
    : visibility[id] !== false);
  const gridPositions = getVisibleDashboardGridPositions(
    displayOrder,
    available.filter((id) => id !== "chart"),
    configuredGridPositions,
    visibility,
  );
  const renderItem = (id) => {
    if (id.startsWith("category:")) {
      const categoryName = id.slice("category:".length);
      const tile = tiles.find((item) => item.name === categoryName);
      return tile && <CategoryCard key={id} cat={tile} colors={colors} textColor={textColor} position={gridPositions[id]} onClick={() => nav(`/estoque?cat=${encodeURIComponent(tile.name)}`)} />;
    }
    if (id === "chart") {
      if (visibility.chart === false) {
        if (!showAnnouncements) return null;
        return (
          <section key="announcements" className="lm-card overflow-hidden col-span-full" style={{ background: colors.card_background, color: colors.card_text, borderColor: colors.card_border }} data-testid="dashboard-announcements">
            <DashboardCardHeader icon={CalendarDays} iconColor={colors.chart_accent} textColor={textColor}>Quadro de avisos</DashboardCardHeader>
            <div className="p-4 space-y-3">
              {eventsLoading ? <p className="text-sm text-neutral-500">Carregando eventos...</p> : events.length ? (
                events.map((event) => (
                  <article key={event.id} className="flex items-start justify-between gap-3 border-b pb-3 last:border-0 last:pb-0" data-testid={`dashboard-event-${event.id}`}>
                    <div>
                      <h3 className="font-semibold">{event.title}</h3>
                      <p className="text-xs text-neutral-500">
                        {new Date(`${event.event_date}T00:00:00`).toLocaleDateString("pt-BR")}
                        {event.created_by ? ` · Registrado por ${event.created_by}` : ""}
                      </p>
                      {event.description && <p className="mt-1 text-sm whitespace-pre-wrap">{event.description}</p>}
                    </div>
                    {isAdmin && <button className="text-red-700 p-1" onClick={() => deleteEvent(event.id)} aria-label={`Excluir evento ${event.title}`} title="Excluir evento">
                      <Trash2 size={15} />
                    </button>}
                  </article>
                ))
              ) : <p className="text-sm text-neutral-500">Nenhum evento registrado.</p>}
            </div>
          </section>
        );
      }
      return (
        <section key={id} className="lm-card overflow-hidden col-span-full" style={{ background: colors.card_background, color: colors.card_text, borderColor: colors.card_border }}>
          <DashboardCardHeader textColor={textColor}>Vendas · últimos {chartDays} dias</DashboardCardHeader>
          <div className="h-64 p-3">
            <ResponsiveContainer width="100%" height="100%">
              {chartType === "linha" ? (
                <LineChart data={chartData}>
                  <CartesianGrid stroke={colors.chart_grid} strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fill: "var(--muted-text-color)" }} style={{ fontSize: 12 }} /><YAxis tick={{ fill: "var(--muted-text-color)" }} style={{ fontSize: 12 }} />
                  <Tooltip formatter={(v) => formatBRL(v)} contentStyle={{ background: colors.card_background, color: colors.card_text, borderColor: colors.card_border }} />
                  <Line type="monotone" dataKey="vendas" stroke={colors.chart_line} strokeWidth={2.5} dot={{ fill: colors.chart_accent }} />
                </LineChart>
              ) : (
                <BarChart data={chartData}>
                  <CartesianGrid stroke={colors.chart_grid} strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fill: "var(--muted-text-color)" }} style={{ fontSize: 12 }} /><YAxis tick={{ fill: "var(--muted-text-color)" }} style={{ fontSize: 12 }} />
                  <Tooltip formatter={(v) => formatBRL(v)} contentStyle={{ background: colors.card_background, color: colors.card_text, borderColor: colors.card_border }} />
                  <Bar dataKey="vendas" fill={colors.chart_line} />
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
        </section>
      );
    }
    const kpi = kpis[id];
    if (!kpi) return null;
    return <Kpi key={id} {...kpi} colors={colors} textColor={textColor} position={gridPositions[id]} />;
  };

  return (
    <div className="space-y-4" style={{ color: colors.card_text }} data-testid="dashboard-page">
      <div className="lm-page-head flex items-end justify-between gap-3 flex-wrap">
        <div><h1 style={{ color: "var(--title-color)" }}>Dashboard</h1><p>Visão geral da operação · {new Date().toLocaleDateString("pt-BR")}</p></div>
        {isAdmin && (
          <div className="flex flex-wrap gap-2">
            <button className="lm-btn lm-btn-dark" onClick={openClosureHistory} disabled={loadingClosureHistory} data-testid="view-day-closures">
              <CalendarDays size={16} />{loadingClosureHistory ? "CARREGANDO..." : "DIAS ANTERIORES"}
            </button>
            <button className="lm-btn lm-btn-olive" onClick={() => setEventDialogOpen(true)} data-testid="register-dashboard-event">
              <CalendarPlus size={16} />REGISTRAR EVENTO
            </button>
            <button className="lm-btn lm-btn-olive" onClick={openCloseDayDialog} disabled={closingDay} data-testid="close-day">
              <ClipboardCheck size={16} />{closingDay ? "FINALIZANDO..." : "FINALIZAR DIA"}
            </button>
          </div>
        )}
      </div>
      {isAdmin && (
        <p className="text-xs text-neutral-600">
          Fechamento automático às 19h; mantenha uma sessão de administrador aberta. Ative as notificações no menu para receber o aviso das 18h50.
        </p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {visibleItems.map(renderItem)}
      </div>
      <Dialog open={eventDialogOpen} onOpenChange={setEventDialogOpen}>
        <DialogContent data-testid="dashboard-event-dialog">
          <DialogHeader>
            <DialogTitle className="font-head">Registrar evento</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <label className="block text-sm">Título
              <Input value={eventTitle} onChange={(event) => setEventTitle(event.target.value)} maxLength={120} data-testid="dashboard-event-title" />
            </label>
            <label className="block text-sm">Data
              <Input type="date" value={eventDate} onChange={(event) => setEventDate(event.target.value)} data-testid="dashboard-event-date" />
            </label>
            <label className="block text-sm">Aviso
              <textarea className="lm-input mt-1 min-h-24 w-full" value={eventDescription} onChange={(event) => setEventDescription(event.target.value)} maxLength={1000} data-testid="dashboard-event-description" />
            </label>
            <div className="flex justify-end gap-2">
              <button className="lm-btn lm-btn-dark" onClick={() => setEventDialogOpen(false)}>Cancelar</button>
              <button className="lm-btn lm-btn-olive" onClick={createEvent} disabled={!eventTitle.trim() || !eventDate || isPending("create-dashboard-event")} data-testid="save-dashboard-event">
                {isPending("create-dashboard-event") ? "SALVANDO..." : "REGISTRAR"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={closureHistoryOpen} onOpenChange={(isOpen) => !loadingClosureHistory && setClosureHistoryOpen(isOpen)}>
        <DialogContent data-testid="day-closure-history">
          <DialogHeader>
            <DialogTitle className="font-head">Fechamentos anteriores</DialogTitle>
          </DialogHeader>
          {closureHistory.length > 0 ? (
            <div className="space-y-4">
              <label className="block text-sm font-medium" htmlFor="day-closure-date">Selecione o dia registrado</label>
              <select
                id="day-closure-date"
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                value={selectedClosureDate}
                onChange={(event) => setSelectedClosureDate(event.target.value)}
                data-testid="day-closure-date"
              >
                {closureHistory.map((closure) => (
                  <option key={closure.date} value={closure.date}>
                    {closure.date.split("-").reverse().join("/")} · {closure.closed_by}
                  </option>
                ))}
              </select>
              <div className="flex justify-end gap-2">
                <button className="lm-btn lm-btn-dark" onClick={() => setClosureHistoryOpen(false)} disabled={loadingClosureHistory}>
                  Fechar
                </button>
                <button className="lm-btn lm-btn-olive" onClick={showSelectedClosure} disabled={loadingClosureHistory} data-testid="show-selected-day-closure">
                  {loadingClosureHistory ? "CARREGANDO..." : "Visualizar e imprimir"}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-neutral-600">Ainda não há fechamentos registrados.</p>
              <div className="flex justify-end">
                <button className="lm-btn lm-btn-dark" onClick={() => setClosureHistoryOpen(false)}>Fechar</button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={closeDayDialogOpen} onOpenChange={(isOpen) => !closingDay && setCloseDayDialogOpen(isOpen)}>
        <DialogContent data-testid="close-day-dialog">
          <DialogHeader>
            <DialogTitle className="font-head">Finalizar o dia</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-neutral-600">
              Se desejar, registre a quilometragem atual do veículo. A diferença será salva em Viagens como quilometragem fora das entregas.
            </p>
            {vehicles.length > 0 ? (
              <div className="space-y-3">
                <label className="block text-sm font-medium" htmlFor="close-day-vehicle">Veículo</label>
                <select
                  id="close-day-vehicle"
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                  value={selectedVehicleId}
                  onChange={(event) => setSelectedVehicleId(event.target.value)}
                  data-testid="close-day-vehicle"
                >
                  {vehicles.map((vehicle) => (
                    <option key={vehicle.id} value={vehicle.id}>
                      {vehicle.name}{vehicle.plate ? ` · ${vehicle.plate}` : ""}
                    </option>
                  ))}
                </select>
                <label className="block text-sm font-medium" htmlFor="close-day-odometer">
                  Quilometragem atual no painel (km)
                </label>
                <Input
                  id="close-day-odometer"
                  type="number"
                  min={vehicles.find((vehicle) => vehicle.id === selectedVehicleId)?.current_km || 0}
                  step="any"
                  value={currentOdometer}
                  onChange={(event) => setCurrentOdometer(event.target.value)}
                  placeholder={`Registrada: ${Number(vehicles.find((vehicle) => vehicle.id === selectedVehicleId)?.current_km || 0)} km`}
                  data-testid="close-day-odometer"
                />
              </div>
            ) : (
              <p className="text-sm text-neutral-600">Não há veículos ativos cadastrados. Você pode finalizar o dia sem registrar quilometragem.</p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <button className="lm-btn lm-btn-dark" onClick={() => setCloseDayDialogOpen(false)} disabled={closingDay}>
                Cancelar
              </button>
              <button className="lm-btn lm-btn-dark" onClick={() => closeDay(false)} disabled={closingDay} data-testid="close-day-without-mileage">
                Finalizar sem quilometragem
              </button>
              {vehicles.length > 0 && (
                <button className="lm-btn lm-btn-olive" onClick={() => closeDay(true)} disabled={closingDay} data-testid="close-day-with-mileage">
                  {closingDay ? "FINALIZANDO..." : "Finalizar e registrar KM"}
                </button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={!!closureReport} onOpenChange={(isOpen) => !isOpen && setClosureReport(null)}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto" data-testid="day-closure-report">
          <DialogHeader>
            <DialogTitle className="font-head">Fechamento do dia {closureReport?.date.split("-").reverse().join("/")}</DialogTitle>
          </DialogHeader>
          {closureReport && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-neutral-600">
                  {closureReport.already_closed ? "Relatório do dia já finalizado" : "Dia finalizado"}
                  {" · "}{new Date(closureReport.closed_at).toLocaleString("pt-BR")} · {closureReport.closed_by}
                </p>
                <div className="flex flex-wrap gap-2">
                {closureReport.backup_id && (
                  <button className="lm-btn lm-btn-dark" onClick={downloadClosureBackup} disabled={downloadingBackup} data-testid="download-day-backup">
                    <Download size={15} />{downloadingBackup ? "BAIXANDO..." : "Baixar backup ZIP"}
                  </button>
                )}
                <button className="lm-btn lm-btn-dark" onClick={() => {
                  if (!printDayClosure(closureReport)) toast.error("Permita pop-ups para imprimir o relatório");
                }} data-testid="print-day-closure"><Printer size={15} />Imprimir relatório</button>
                </div>
              </div>
              <div className="grid sm:grid-cols-3 gap-3" data-testid="day-closure-summary">
                <div className="lokal-panel p-3"><div className="font-head text-xs">Pedidos no relatório</div><div className="text-xl font-bold">{closureReport.summary.orders_count}</div><div>{formatBRL(closureReport.summary.orders_total)}</div></div>
                <div className="lokal-panel p-3"><div className="font-head text-xs">Movimentações de estoque</div><div className="text-xl font-bold">{closureReport.summary.stock_movements_count} lançamentos</div><div className="text-sm">{closureReport.summary.stock_out_quantity} saídas · {closureReport.summary.stock_return_quantity} devoluções</div></div>
                <div className="lokal-panel p-3"><div className="font-head text-xs">Despesas / viagens</div><div className="text-xl font-bold">{closureReport.summary.expenses_count}</div><div>{formatBRL(closureReport.summary.expenses_total)}</div></div>
              </div>
              <section>
                <h3 className="font-head mb-2">Pedidos, vendas, trocas e devoluções</h3>
                <div className="lm-table-wrap overflow-x-auto"><table className="lm-table">
                  <thead><tr><th>Pedido</th><th>Tipo</th><th>Cliente</th><th>Status</th><th>Total</th></tr></thead>
                  <tbody>{closureReport.orders.map((order) => <tr key={order.id}><td>#{order.number}</td><td>{order.type}</td><td>{order.customer_name}</td><td>{order.status}</td><td>{formatBRL(order.total || 0)}</td></tr>)}
                    {closureReport.orders.length === 0 && <tr><td colSpan={5} className="text-center py-3">Sem pedidos no dia.</td></tr>}</tbody>
                </table></div>
              </section>
              <section>
                <h3 className="font-head mb-2">Movimentações de estoque</h3>
                <div className="lm-table-wrap overflow-x-auto"><table className="lm-table">
                  <thead><tr><th>Tipo</th><th>Produto</th><th>Tamanho</th><th>Qtd.</th><th>NF / Motivo</th></tr></thead>
                  <tbody>{closureReport.stock_movements.map((movement) => <tr key={movement.id}><td>{movement.kind}</td><td>{movement.product_name}</td><td>{movement.size}</td><td>{movement.qty}</td><td>{movement.nf || movement.reason}</td></tr>)}
                    {closureReport.stock_movements.length === 0 && <tr><td colSpan={5} className="text-center py-3">Sem movimentações de estoque no dia.</td></tr>}</tbody>
                </table></div>
              </section>
              <section>
                <h3 className="font-head mb-2">Despesas, insumos e viagens</h3>
                <div className="lm-table-wrap overflow-x-auto"><table className="lm-table">
                  <thead><tr><th>Tipo</th><th>Descrição</th><th>KM</th><th>KM no painel</th><th>Valor</th></tr></thead>
                  <tbody>{closureReport.expenses.map((expense) => <tr key={expense.id}><td>{expense.type}</td><td>{expense.description}</td><td>{expense.km ?? "—"}</td><td>{expense.odometer_km ?? "—"}</td><td>{formatBRL(Number(expense.amount || 0) + Number(expense.fuel_cost || 0) + Number(expense.toll_cost || 0))}</td></tr>)}
                    {closureReport.expenses.length === 0 && <tr><td colSpan={5} className="text-center py-3">Sem despesas no dia.</td></tr>}</tbody>
                </table></div>
              </section>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
