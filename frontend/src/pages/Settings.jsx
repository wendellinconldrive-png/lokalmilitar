import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth, DEFAULT_THEME } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Trash2, Download, Upload, Bell, CalendarDays, RefreshCw } from "lucide-react";
import useSubmitLock from "@/hooks/useSubmitLock";
import {
  DASHBOARD_KPIS,
  DEFAULT_DASHBOARD_PREFERENCES,
  getDashboardGridPositions,
  mergeDashboardPreferences,
} from "@/pages/dashboardPreferences";

const COLORS = [
  { name: "Branco", value: "#FFFFFF" }, { name: "Cinza Claro", value: "#F5F5F5" }, { name: "Bege", value: "#F5F0E6" },
  { name: "Azul Claro", value: "#E6F0FF" }, { name: "Verde Claro", value: "#E6FFE6" }, { name: "Escuro", value: "#1E1E1E" },
];
const PANEL_COLORS = [
  { name: "Creme", value: "#FBF9F4" }, { name: "Branco", value: "#FFFFFF" }, { name: "Bege", value: "#F5F0E6" },
  { name: "Caqui Claro", value: "#EDE4D0" }, { name: "Oliva Claro", value: "#E9ECDC" }, { name: "Cinza Claro", value: "#F0F0F0" },
  { name: "Escuro", value: "#1E1E1E" },
];
const decodeVapidKey = (value) => {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(window.atob(padded), (character) => character.charCodeAt(0));
};

const Swatches = ({ colors, current, onPick, prefix }) => (
  <div className="flex flex-wrap gap-3">
    {colors.map((c) => (
      <button key={c.value} onClick={() => onPick(c.value)} data-testid={`${prefix}-${c.name}`}
        className={`flex flex-col items-center gap-1 p-2 border rounded ${current === c.value ? "border-[#B8860B] ring-2 ring-[#B8860B]" : ""}`}>
        <span className="w-12 h-12 border rounded" style={{ background: c.value }} />
        <span className="text-[11px] font-head">{c.name}</span>
      </button>
    ))}
  </div>
);
const HEAD_FONTS = ["Oswald", "Bebas Neue", "Barlow Condensed", "Teko", "Black Ops One", "Saira Stencil One", "Rajdhani", "Roboto Condensed", "Archivo"];
const BODY_FONTS = ["Barlow", "IBM Plex Sans", "Source Sans 3", "Nunito Sans", "Roboto Condensed", "Archivo", "Rajdhani"];
const FUEL_TYPES = ["Gasolina", "Etanol", "Diesel", "GNV"];
const DEFAULT_FUEL_PRICES = Object.fromEntries(FUEL_TYPES.map((fuel) => [fuel, 0]));
const THEME_COLORS = [
  ["title_color", "Títulos"],
  ["text_color", "Textos"],
  ["muted_text_color", "Textos secundários"],
  ["border_color", "Contornos e divisórias"],
  ["input_bg", "Fundo dos campos"],
  ["input_text", "Texto dos campos"],
  ["primary_color", "Botões principais e seleção"],
  ["button_text", "Texto dos botões principais"],
  ["accent_color", "Destaques e detalhes"],
  ["chip_color", "Etiquetas e balões"],
  ["card_header_bg", "Fundo dos cabeçalhos de cartões"],
  ["card_header_text", "Texto dos cabeçalhos de cartões"],
  ["sidebar_color", "Fundo do menu lateral"],
  ["sidebar_text", "Texto do menu lateral"],
];
const dashboardItemId = (category) => `category:${category}`;
const dashboardItemLabel = (id, categories) => {
  if (id.startsWith("category:")) return `Estoque: ${id.slice("category:".length)}`;
  if (id === "chart") return "Gráfico de vendas";
  return DASHBOARD_KPIS.find((item) => item.id === id)?.label || id;
};

function ThemeSection({ theme, applyTheme, onSave, onReset, saving, resetting }) {
  return (
    <section className="lokal-panel p-4" data-testid="theme-section">
      <h2 className="lokal-stencil text-sm mb-1">Aparência — fontes e cores</h2>
      <p className="text-xs text-neutral-500 mb-3">Personalize cores do fundo, balões, textos, campos, contornos, menu, botões e cabeçalhos. As mudanças aparecem na hora; salve para manter em todas as abas.</p>
      <div className="grid md:grid-cols-2 gap-3">
        <label><div className="text-[11px] font-head text-neutral-600 mb-1">Fonte dos títulos</div>
          <select className="lm-input" value={theme.font_head} onChange={(e) => applyTheme({ font_head: e.target.value })} data-testid="theme-font-head">
            {HEAD_FONTS.map((f) => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
          </select></label>
        <label><div className="text-[11px] font-head text-neutral-600 mb-1">Fonte dos textos</div>
          <select className="lm-input" value={theme.font_body} onChange={(e) => applyTheme({ font_body: e.target.value })} data-testid="theme-font-body">
            {BODY_FONTS.map((f) => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
          </select></label>
        {THEME_COLORS.filter(([key]) => key !== "card_header_bg" || !theme.card_header_metallic).map(([k, l]) => (
          <label key={k} className="flex items-center gap-3">
            <input type="color" value={theme[k]} onChange={(e) => applyTheme({ [k]: e.target.value })} className="w-12 h-10 border rounded cursor-pointer" data-testid={`theme-${k}`} />
            <span className="text-sm">{l} <span className="font-mono text-xs text-neutral-500">{theme[k]}</span></span>
          </label>
        ))}
      </div>
      <div className="border rounded p-3 mt-3 space-y-3" data-testid="metallic-header-gradient">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={Boolean(theme.card_header_metallic)}
            onChange={(event) => applyTheme({ card_header_metallic: event.target.checked })}
            data-testid="theme-card-header-metallic"
          />
          Degradê metálico nos cabeçalhos de cartões e tabelas
        </label>
        {theme.card_header_metallic && (
          <>
            <div className="grid sm:grid-cols-2 gap-3">
              {[["card_header_gradient_start", "Cor inicial"], ["card_header_gradient_middle", "Tom metálico intermediário"], ["card_header_gradient_end", "Cor final"]].map(([key, label]) => (
                <label key={key} className="flex items-center gap-3">
                  <input
                    type="color"
                    value={theme[key]}
                    onChange={(event) => applyTheme({ [key]: event.target.value })}
                    className="w-12 h-10 border rounded cursor-pointer"
                    aria-label={label}
                    data-testid={`theme-${key}`}
                  />
                  <span className="text-sm">{label} <span className="font-mono text-xs text-neutral-500">{theme[key]}</span></span>
                </label>
              ))}
            </div>
            <div
              className="h-10 rounded border"
              style={{
                background: `linear-gradient(115deg, ${theme.card_header_gradient_start} 0%, color-mix(in srgb, ${theme.card_header_gradient_start} 65%, ${theme.card_header_gradient_middle}) 18%, ${theme.card_header_gradient_end} 40%, color-mix(in srgb, ${theme.card_header_gradient_end} 40%, ${theme.card_header_gradient_middle}) 52%, ${theme.card_header_gradient_start} 72%, ${theme.card_header_gradient_end} 100%)`,
              }}
              aria-label="Prévia do degradê metálico"
              data-testid="metallic-header-gradient-preview"
            />
          </>
        )}
      </div>
      <div className="lm-card p-3 mt-3" data-testid="theme-preview">
        <h3 className="text-xl font-bold" style={{ color: "var(--title-color)" }}>Prévia do título</h3>
        <p className="text-sm">Texto de exemplo com a fonte escolhida para o corpo do sistema.</p>
        <button className="lm-btn lm-btn-olive mt-2">Botão principal</button>
      </div>
      <div className="flex gap-2 mt-3">
        <button className="lm-btn lm-btn-olive" onClick={() => onSave(theme)} disabled={saving} data-testid="theme-save">
          {saving ? "Salvando..." : "Salvar aparência"}
        </button>
        <button className="lm-btn lm-btn-outline" onClick={onReset} disabled={resetting} data-testid="theme-reset">
          {resetting ? "Restaurando..." : "Restaurar padrão"}
        </button>
      </div>
    </section>
  );
}

function DashboardSection({ categories, initialPreferences, onSave, onChange, saving }) {
  const [preferences, setPreferences] = useState(initialPreferences);
  const itemIds = [
    ...categories.map((category) => dashboardItemId(category.name)),
    ...DASHBOARD_KPIS.map(({ id }) => id),
    "chart",
  ];
  const order = [
    ...preferences.order.filter((id) => itemIds.includes(id)),
    ...itemIds.filter((id) => !preferences.order.includes(id)),
  ];
  const positionableItemIds = itemIds.filter((id) => id !== "chart");
  const gridPositions = getDashboardGridPositions(order, positionableItemIds, preferences.grid_positions);

  useEffect(() => {
    setPreferences(mergeDashboardPreferences(initialPreferences));
  }, [initialPreferences]);

  const update = (patch) => {
    const next = mergeDashboardPreferences({ ...preferences, ...patch });
    setPreferences(next);
    onChange(next);
  };
  const move = (id, offset) => {
    const index = order.indexOf(id);
    const target = index + offset;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    [next[index], next[target]] = [next[target], next[index]];
    const nextGridPositions = { ...gridPositions };
    if (id !== "chart" && next[target] !== "chart") {
      [nextGridPositions[id], nextGridPositions[next[target]]] = [nextGridPositions[next[target]], nextGridPositions[id]];
    }
    update({ order: next, grid_positions: nextGridPositions });
  };
  const moveToGridPosition = (id, field, value) => {
    const current = gridPositions[id];
    const target = { ...current, [field]: Number(value) };
    const occupant = Object.entries(gridPositions).find(([otherId, position]) =>
      otherId !== id && position.row === target.row && position.column === target.column,
    )?.[0];
    const nextGridPositions = { ...gridPositions, [id]: target };
    if (occupant) nextGridPositions[occupant] = current;
    const nextOrder = [...order].sort((firstId, secondId) => {
      if (firstId === "chart") return 1;
      if (secondId === "chart") return -1;
      const first = nextGridPositions[firstId];
      const second = nextGridPositions[secondId];
      return first.row - second.row || first.column - second.column;
    });
    update({ order: nextOrder, grid_positions: nextGridPositions });
  };

  return (
    <section className="lokal-panel p-4 space-y-4" data-testid="dashboard-customization">
      <div>
        <h2 className="lokal-stencil text-sm mb-1">Personalizar dashboard</h2>
        <p className="text-xs text-neutral-500">Escolha os cartões visíveis, organize a posição na grade e ajuste o gráfico. Em telas menores, a posição se adapta à largura disponível.</p>
      </div>

      <div>
        <h3 className="font-head text-xs mb-2">Cartões e ordem</h3>
        <div className="grid md:grid-cols-2 gap-x-4">
          {order.map((id, index) => (
            <div key={id} className="flex items-center gap-2 border-b py-2">
              <input
                type="checkbox"
                checked={preferences.visibility[id] !== false}
                onChange={(event) => update({
                  visibility: { ...preferences.visibility, [id]: event.target.checked },
                })}
                aria-label={`Mostrar ${dashboardItemLabel(id, categories)}`}
                data-testid={`dashboard-visible-${id.replace(/[^a-zA-Z0-9_-]/g, "-")}`}
              />
              <span className="flex-1 text-sm">{dashboardItemLabel(id, categories)}</span>
              {id !== "chart" && (
                <>
                  <label className="text-xs">
                    Linha
                    <select
                      className="lm-input ml-1 w-16 px-1 py-1"
                      value={gridPositions[id].row}
                      onChange={(event) => moveToGridPosition(id, "row", event.target.value)}
                      aria-label={`Linha de ${dashboardItemLabel(id, categories)}`}
                      data-testid={`dashboard-row-${id.replace(/[^a-zA-Z0-9_-]/g, "-")}`}
                    >
                      {Array.from({ length: positionableItemIds.length }, (_, row) => row + 1).map((row) => (
                        <option key={row} value={row}>{row}</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs">
                    Coluna
                    <select
                      className="lm-input ml-1 w-16 px-1 py-1"
                      value={gridPositions[id].column}
                      onChange={(event) => moveToGridPosition(id, "column", event.target.value)}
                      aria-label={`Coluna de ${dashboardItemLabel(id, categories)}`}
                      data-testid={`dashboard-column-${id.replace(/[^a-zA-Z0-9_-]/g, "-")}`}
                    >
                      {[1, 2, 3, 4].map((column) => <option key={column} value={column}>{column}</option>)}
                    </select>
                  </label>
                </>
              )}
              <button className="lm-btn lm-btn-outline px-2 py-1" onClick={() => move(id, -1)} disabled={index === 0} aria-label={`Mover ${dashboardItemLabel(id, categories)} para cima`}>↑</button>
              <button className="lm-btn lm-btn-outline px-2 py-1" onClick={() => move(id, 1)} disabled={index === order.length - 1} aria-label={`Mover ${dashboardItemLabel(id, categories)} para baixo`}>↓</button>
            </div>
          ))}
        </div>
      </div>

      <label className="flex items-center gap-3 text-sm">
        <input
          type="color"
          value={preferences.colors.card_text}
          onChange={(event) => update({
            card_text_customized: true,
            colors: { ...preferences.colors, card_text: event.target.value },
          })}
          className="w-12 h-10 border rounded cursor-pointer"
          aria-label="Cor do texto dos cartões do Dashboard"
          data-testid="dashboard-card-text-color"
        />
        Cor do texto dos cartões do Dashboard
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={preferences.show_announcements}
          onChange={(event) => update({ show_announcements: event.target.checked })}
          data-testid="dashboard-announcements-visible"
        />
        Mostrar o quadro de avisos quando o gráfico estiver oculto
      </label>

      <div className="grid md:grid-cols-2 gap-3">
        <label className="text-sm">Tipo de gráfico
          <select className="lm-input mt-1" value={preferences.chart_type} onChange={(event) => update({ chart_type: event.target.value })} data-testid="dashboard-chart-type">
            <option value="linha">Linha</option>
            <option value="barras">Barras</option>
          </select>
        </label>
        <label className="text-sm">Período do gráfico
          <select className="lm-input mt-1" value={preferences.chart_days} onChange={(event) => update({ chart_days: Number(event.target.value) })} data-testid="dashboard-chart-days">
            {[7, 14, 30].map((days) => <option key={days} value={days}>Últimos {days} dias</option>)}
          </select>
        </label>
      </div>

      <div className="flex gap-2">
        <button className="lm-btn lm-btn-olive" onClick={() => onSave(preferences)} disabled={saving} data-testid="dashboard-save">
          {saving ? "Salvando..." : "Salvar dashboard"}
        </button>
        <button className="lm-btn lm-btn-outline" onClick={() => update({
          ...DEFAULT_DASHBOARD_PREFERENCES,
          order: itemIds,
        })} data-testid="dashboard-reset">Restaurar padrão</button>
      </div>
    </section>
  );
}

const STORE_FIELDS = [
  ["store_full_name", "Razão social"], ["cnpj", "CNPJ"], ["address", "Endereço"], ["phone", "Telefone"],
  ["instagram", "Instagram"], ["pix_key", "Chave PIX"], ["print_footer_text", "Rodapé da impressão"],
];

export default function Settings() {
  const { user, bg, applyBg, panel, applyPanel, theme, applyTheme, dashboardPreferences, applyDashboardPreferences } = useAuth();
  const { run: withSubmitLock, isPending } = useSubmitLock();
  const [s, setS] = useState(null);
  const [users, setUsers] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [categories, setCategories] = useState([]);
  const [nu, setNu] = useState({ name: "", email: "", password: "", role: "visualizador", vendor_id: "" });
  const [userEdits, setUserEdits] = useState({});
  const [passwordChange, setPasswordChange] = useState({ current_password: "", new_password: "" });
  const [invitations, setInvitations] = useState([]);
  const [currentOrderNumber, setCurrentOrderNumber] = useState("");
  const [inviteDays, setInviteDays] = useState(7);
  const [createdInviteLink, setCreatedInviteLink] = useState("");
  const [resetOptions, setResetOptions] = useState([]);
  const [resetMode, setResetMode] = useState("all");
  const [selectedResetGroups, setSelectedResetGroups] = useState([]);
  const [dayBackups, setDayBackups] = useState([]);
  const [backupFile, setBackupFile] = useState(null);
  const [restoringBackup, setRestoringBackup] = useState(false);
  const [googleCalendar, setGoogleCalendar] = useState(null);
  const [pushStatus, setPushStatus] = useState(null);
  const isAdmin = user?.role === "admin";

  const loadUsers = () => api.get("/auth/users").then((r) => {
    setUsers(r.data);
    setUserEdits(Object.fromEntries(r.data.map((item) => [item.id, {
      email: item.email, role: item.role, vendor_id: item.vendor_id || "", password: "",
    }])));
  });
  const loadInvitations = () => api.get("/auth/invitations").then((r) => setInvitations(r.data)).catch((error) => {
    toast.error(error.response?.data?.detail || "Não foi possível carregar os convites");
  });
  const loadResetOptions = () => api.get("/settings/data-reset/options")
    .then((response) => setResetOptions(response.data.groups))
    .catch((error) => toast.error(error.response?.data?.detail || "Não foi possível carregar os dados para limpeza"));
  const loadDayBackups = () => api.get("/dashboard/backups")
    .then((response) => setDayBackups(response.data))
    .catch((error) => toast.error(error.response?.data?.detail || "Não foi possível carregar os backups"));
  useEffect(() => {
    api.get("/settings").then((r) => {
      setS(r.data);
      if (r.data.dashboard_preferences) applyDashboardPreferences(r.data.dashboard_preferences);
    });
    (async () => {
      try {
        const registration = "serviceWorker" in navigator
          ? await navigator.serviceWorker.getRegistration("/push-service-worker.js")
          : null;
        const subscription = await registration?.pushManager.getSubscription();
        const response = await api.get("/notifications/push/status", {
          params: subscription?.endpoint ? { endpoint: subscription.endpoint } : {},
        });
        setPushStatus(response.data);
      } catch (error) {
        toast.error(error.response?.data?.detail || "Não foi possível consultar os avisos do navegador");
      }
    })();
    if (isAdmin) {
      api.get("/integrations/google-calendar/status").then((response) => setGoogleCalendar(response.data))
        .catch((error) => toast.error(error.response?.data?.detail || "Não foi possível consultar a integração com Google Agenda"));
      const callbackResult = new URLSearchParams(window.location.search).get("google_calendar");
      if (callbackResult) {
        if (callbackResult === "connected") toast.success("Google Agenda conectado");
        else toast.error("Não foi possível conectar o Google Agenda");
        window.history.replaceState({}, "", window.location.pathname);
      }
    }
    api.get("/categories").then((r) => setCategories(r.data));
    loadUsers();
    if (isAdmin) {
      api.get("/vendors").then((response) => setVendors(response.data)).catch((error) => {
        toast.error(error.response?.data?.detail || "Não foi possível carregar os vendedores");
      });
      loadInvitations();
      loadResetOptions();
      loadDayBackups();
      api.get("/orders/number-sequence").then((r) => {
        setCurrentOrderNumber(String(r.data.current_number));
      }).catch((error) => {
        toast.error(error.response?.data?.detail || "Não foi possível carregar a numeração dos pedidos");
      });
    }
  }, [applyDashboardPreferences, isAdmin]);

  const connectGoogleCalendar = async () => {
    try {
      const { data } = await api.post("/integrations/google-calendar/connect");
      window.location.assign(data.authorization_url);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Não foi possível iniciar a conexão com Google Agenda");
    }
  };

  const syncGoogleCalendar = () => withSubmitLock("google-calendar-sync", async () => {
    try {
      const { data } = await api.post("/integrations/google-calendar/sync");
      setGoogleCalendar((current) => ({ ...current, last_sync_at: data.last_sync_at, last_error: "" }));
      toast.success(`${data.synced_events} evento(s) sincronizado(s) com Google Agenda`);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Não foi possível sincronizar Google Agenda");
    }
  });

  const disconnectGoogleCalendar = () => withSubmitLock("google-calendar-disconnect", async () => {
    if (!window.confirm("Desconectar Google Agenda? Os eventos já sincronizados não serão apagados da conta Google.")) return;
    try {
      await api.delete("/integrations/google-calendar/disconnect");
      setGoogleCalendar((current) => ({ ...current, connected: false, email: "", last_error: "" }));
      toast.success("Google Agenda desconectado");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Não foi possível desconectar Google Agenda");
    }
  });

  const enablePushNotifications = () => withSubmitLock("enable-push", async () => {
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      toast.error("Este navegador não oferece notificações push");
      return;
    }
    if (!pushStatus?.configured) {
      toast.error("As notificações push ainda não foram configuradas no servidor");
      return;
    }
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        toast.error("Permita as notificações do navegador para ativar os avisos");
        return;
      }
      const registration = await navigator.serviceWorker.register("/push-service-worker.js");
      const [{ data }] = await Promise.all([
        api.get("/notifications/push/public-key"),
        registration.ready,
      ]);
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeVapidKey(data.public_key),
        });
      }
      await api.post("/notifications/push/subscribe", subscription.toJSON());
      setPushStatus((current) => ({ ...current, subscribed: true }));
      toast.success("Notificações ativadas neste navegador");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Não foi possível ativar as notificações neste navegador");
    }
  });

  const disablePushNotifications = () => withSubmitLock("disable-push", async () => {
    try {
      const registration = await navigator.serviceWorker.getRegistration("/push-service-worker.js");
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await api.delete("/notifications/push/subscribe", { data: subscription.toJSON() });
        await subscription.unsubscribe();
      }
      setPushStatus((current) => ({ ...current, subscribed: false }));
      toast.success("Notificações desativadas neste navegador");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Não foi possível desativar as notificações");
    }
  });

  const resetSystemData = () => withSubmitLock("reset-data", async () => {
    const groups = resetMode === "all"
      ? resetOptions.map((option) => option.id)
      : selectedResetGroups;
    if (!groups.length) {
      toast.error("Selecione os dados que deseja apagar");
      return;
    }
    const labels = resetOptions.filter((option) => groups.includes(option.id)).map((option) => option.label);
    if (!window.confirm(`Esta ação apagará permanentemente:\n\n${labels.join("\n")}\n\nUsuários, configurações e backups serão preservados. Deseja continuar?`)) return;
    if (window.prompt('Para confirmar, digite "ZERAR":') !== "ZERAR") {
      toast.error("Limpeza cancelada: confirmação não corresponde");
      return;
    }
    try {
      const { data } = await api.post("/settings/data-reset", { groups });
      if (data.order_number_reset) setCurrentOrderNumber("0");
      toast.success("Dados selecionados apagados. Usuários, configurações e backups foram preservados.");
      await loadResetOptions();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Não foi possível apagar os dados selecionados");
    }
  });

  const downloadBackup = async (backup) => {
    try {
      const { data } = await api.get(`/dashboard/backups/${backup.id}`, { responseType: "blob" });
      const url = URL.createObjectURL(data);
      const link = document.createElement("a");
      link.href = url;
      link.download = backup.filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Não foi possível baixar o backup");
    }
  };

  const restoreBackup = () => withSubmitLock("restore-backup", async () => {
    if (!backupFile) {
      toast.error("Selecione um arquivo ZIP de backup");
      return;
    }
    if (!window.confirm("A restauração substituirá produtos, pedidos, usuários, configurações e os demais dados pelos dados do backup. Os backups existentes serão preservados e uma cópia preventiva será criada. Deseja continuar?")) return;
    if (window.prompt('Para confirmar, digite "RESTAURAR":') !== "RESTAURAR") {
      toast.error("Restauração cancelada: confirmação não corresponde");
      return;
    }

    const formData = new FormData();
    formData.append("backup_file", backupFile);
    setRestoringBackup(true);
    try {
      const { data } = await api.post("/dashboard/backups/restore", formData);
      toast.success(`Backup restaurado. Cópia preventiva criada: ${data.safety_backup_filename}`);
      setBackupFile(null);
      await loadDayBackups();
      window.setTimeout(() => window.location.reload(), 1500);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Não foi possível restaurar o backup");
    } finally {
      setRestoringBackup(false);
    }
  });

  const saveCurrentOrderNumber = () => withSubmitLock("order-number", async () => {
    const currentNumber = Number(currentOrderNumber);
    if (!Number.isSafeInteger(currentNumber) || currentNumber < 0) {
      toast.error("Informe um número inteiro válido");
      return;
    }
    try {
      const { data } = await api.put("/orders/number-sequence", { current_number: currentNumber });
      setCurrentOrderNumber(String(data.current_number));
      toast.success(`Numeração atualizada. O próximo pedido será o #${data.current_number + 1}`);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Não foi possível atualizar a numeração dos pedidos");
    }
  });

  const createInvite = () => withSubmitLock("create-invite", async () => {
    try {
      const { data } = await api.post("/auth/invitations", { expires_in_days: Number(inviteDays) });
      const link = `${window.location.origin}/login?invite=${encodeURIComponent(data.code)}`;
      setCreatedInviteLink(link);
      await loadInvitations();
      toast.success("Convite criado. Copie e envie o link ao novo usuário.");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Não foi possível criar o convite");
    }
  });
  const copyInviteLink = async () => {
    try {
      await navigator.clipboard.writeText(createdInviteLink);
      toast.success("Link copiado");
    } catch {
      toast.error("Não foi possível copiar automaticamente; selecione e copie o link.");
    }
  };
  const revokeInvite = async (id) => {
    try {
      await api.delete(`/auth/invitations/${id}`);
      toast.success("Convite revogado");
      loadInvitations();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Não foi possível revogar o convite");
    }
  };

  const pickColor = async (c) => {
    applyBg(c);
    try {
      await api.put("/settings", { background_color: c });
      toast.success("Fundo atualizado");
    } catch {
      toast.error("Não foi possível salvar a cor de fundo");
    }
  };
  const pickPanel = async (c) => {
    applyPanel(c);
    try {
      await api.put("/settings", { panel_color: c });
      toast.success("Cor das janelas atualizada");
    } catch {
      toast.error("Não foi possível salvar a cor das janelas");
    }
  };
  const saveTheme = (t) => withSubmitLock("save-theme", async () => {
    try {
      await api.put("/settings", { theme: t });
      toast.success("Aparência salva");
    } catch {
      toast.error("Não foi possível salvar a aparência");
    }
  });
  const saveDashboard = (preferences) => withSubmitLock("save-dashboard", async () => {
    try {
      await api.put("/settings", { dashboard_preferences: preferences });
      applyDashboardPreferences(preferences);
      toast.success("Dashboard salvo");
    } catch {
      toast.error("Não foi possível salvar o dashboard");
    }
  });
  const resetAppearance = () => withSubmitLock("reset-appearance", async () => {
    applyTheme(DEFAULT_THEME);
    applyBg("#F5F0E6");
    applyPanel("#FBF9F4");
    try {
      await api.put("/settings", {
        theme: DEFAULT_THEME,
        background_color: "#F5F0E6",
        panel_color: "#FBF9F4",
      });
      toast.success("Aparência padrão restaurada");
    } catch {
      toast.error("Não foi possível salvar a aparência padrão");
    }
  });
  const saveStore = () => withSubmitLock("save-store", async () => {
    await api.put("/settings", s);
    toast.success("Dados salvos");
  });
  const saveFuelPrices = () => withSubmitLock("save-fuel-prices", async () => {
    const prices = Object.fromEntries(FUEL_TYPES.map((fuel) => [fuel, Number(s.fuel_prices?.[fuel] || 0)]));
    if (Object.values(prices).some((price) => !Number.isFinite(price) || price < 0)) {
      toast.error("Informe valores válidos e não negativos para os combustíveis");
      return;
    }
    try {
      const { data } = await api.put("/settings", { fuel_prices: prices });
      setS({ ...s, ...data });
      toast.success("Preços médios dos combustíveis salvos");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Não foi possível salvar os preços dos combustíveis");
    }
  });
  const updateUser = (id) => withSubmitLock(`update-user:${id}`, async () => {
    const update = userEdits[id];
    try {
      await api.put(`/auth/users/${id}`, {
        email: update.email,
        role: update.role,
        vendor_id: update.role === "vendedor" ? update.vendor_id || null : null,
        ...(update.password ? { password: update.password } : {}),
      });
      toast.success("Usuário atualizado");
      loadUsers();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Não foi possível atualizar o usuário");
    }
  });
  const changeOwnPassword = () => withSubmitLock("change-password", async () => {
    try {
      await api.put("/auth/password", passwordChange);
      setPasswordChange({ current_password: "", new_password: "" });
      toast.success("Senha alterada");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Não foi possível alterar a senha");
    }
  });
  const addUser = () => withSubmitLock("add-user", async () => {
    try { await api.post("/auth/users", nu); toast.success("Usuário criado"); setNu({ name: "", email: "", password: "", role: "visualizador", vendor_id: "" }); loadUsers(); }
    catch (e) { toast.error(typeof e.response?.data?.detail === "string" ? e.response.data.detail : "Erro ao criar usuário"); }
  });
  const delUser = async (id) => { if (!window.confirm("Excluir usuário?")) return; await api.delete(`/auth/users/${id}`); loadUsers(); };

  if (!s) return <div className="font-mono">Carregando...</div>;

  return (
    <div className="space-y-5" data-testid="settings-page">
      <div className="lm-page-head"><h1>Configurações</h1><p>Aparência, dados da empresa e usuários</p></div>

      <section className="lokal-panel p-4 space-y-3" data-testid="browser-notification-settings">
        <div>
          <h2 className="lokal-stencil text-sm mb-1">Notificações neste navegador</h2>
          <p className="text-xs text-neutral-500">
            Receba avisos de pedidos pendentes, eventos e revisões de veículos neste dispositivo.
            No plano gratuito do servidor, a entrega pode atrasar quando a API estiver suspensa.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!pushStatus?.subscribed ? (
            <button className="lm-btn lm-btn-olive" onClick={enablePushNotifications} disabled={isPending("enable-push") || !pushStatus?.configured} data-testid="enable-browser-notifications">
              <Bell size={15} />{isPending("enable-push") ? "ATIVANDO..." : "ATIVAR NESTE NAVEGADOR"}
            </button>
          ) : (
            <button className="lm-btn lm-btn-dark" onClick={disablePushNotifications} disabled={isPending("disable-push")} data-testid="disable-browser-notifications">
              {isPending("disable-push") ? "DESATIVANDO..." : "DESATIVAR NESTE NAVEGADOR"}
            </button>
          )}
          {pushStatus && !pushStatus.configured && <span className="self-center text-xs text-amber-700">A configuração do servidor ainda está pendente.</span>}
        </div>
      </section>

      {isAdmin && <section className="lokal-panel p-4 space-y-3" data-testid="google-calendar-settings">
        <div>
          <h2 className="lokal-stencil text-sm mb-1">Integração com Google Agenda</h2>
          <p className="text-xs text-neutral-500">
            Sincroniza eventos do dashboard, próximas revisões e lembretes diários dos pedidos em aberto.
            Eventos e revisões avisam um dia antes e no dia; pedidos pendentes avisam diariamente às 9h.
          </p>
        </div>
        {googleCalendar?.connected ? (
          <>
            <p className="text-sm">Conectado: <b>{googleCalendar.email || "Conta Google"}</b></p>
            {googleCalendar.last_sync_at && <p className="text-xs text-neutral-500">Última sincronização: {new Date(googleCalendar.last_sync_at).toLocaleString("pt-BR")}</p>}
            {googleCalendar.last_error && <p className="text-xs text-red-700">{googleCalendar.last_error}</p>}
            <div className="flex flex-wrap gap-2">
              <button className="lm-btn lm-btn-olive" onClick={syncGoogleCalendar} disabled={isPending("google-calendar-sync")} data-testid="sync-google-calendar">
                <RefreshCw size={15} />{isPending("google-calendar-sync") ? "SINCRONIZANDO..." : "SINCRONIZAR AGORA"}
              </button>
              <button className="lm-btn lm-btn-dark" onClick={disconnectGoogleCalendar} disabled={isPending("google-calendar-disconnect")} data-testid="disconnect-google-calendar">
                DESCONECTAR
              </button>
              <button className="lm-btn lm-btn-dark" onClick={connectGoogleCalendar} data-testid="reauthorize-google-calendar">
                REAUTORIZAR GOOGLE
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-xs text-neutral-500">
              A conexão é autorizada pelo administrador em uma conta Google. Depois de conectar, o sistema sincroniza automaticamente enquanto a API estiver ativa.
            </p>
            {googleCalendar?.missing_configuration?.length > 0 && (
              <p className="text-xs text-amber-700">Configuração pendente no servidor: {googleCalendar.missing_configuration.join(", ")}</p>
            )}
            <button className="lm-btn lm-btn-olive" onClick={connectGoogleCalendar} disabled={!googleCalendar?.configured} data-testid="connect-google-calendar">
              <CalendarDays size={15} />CONECTAR GOOGLE AGENDA
            </button>
          </>
        )}
      </section>}

      <section className="lokal-panel p-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h2 className="lokal-stencil text-sm">Cor de fundo do sistema</h2>
          <label className="flex items-center gap-2 text-xs font-mono">
            Personalizada
            <input type="color" value={bg} onChange={(e) => pickColor(e.target.value)} aria-label="Cor personalizada do fundo" />
          </label>
        </div>
        <Swatches colors={COLORS} current={bg} onPick={pickColor} prefix="bg-color" />
      </section>

      <section className="lokal-panel p-4">
        <div className="flex items-center justify-between gap-3 mb-1">
          <h2 className="lokal-stencil text-sm">Cor das janelas e balões</h2>
          <label className="flex items-center gap-2 text-xs font-mono">
            Personalizada
            <input type="color" value={panel} onChange={(e) => pickPanel(e.target.value)} aria-label="Cor personalizada das janelas e balões" />
          </label>
        </div>
        <p className="text-xs text-neutral-500 mb-3">Aplica-se a cartões, formulários laterais, janelas, balões e painéis.</p>
        <Swatches colors={PANEL_COLORS} current={panel} onPick={pickPanel} prefix="panel-color" />
      </section>

      <ThemeSection
        theme={theme}
        applyTheme={applyTheme}
        onSave={saveTheme}
        onReset={resetAppearance}
        saving={isPending("save-theme")}
        resetting={isPending("reset-appearance")}
      />

      <DashboardSection
        categories={categories}
        initialPreferences={dashboardPreferences}
        onChange={applyDashboardPreferences}
        onSave={saveDashboard}
        saving={isPending("save-dashboard")}
      />

      {isAdmin && <section className="lokal-panel p-4 space-y-3" data-testid="fuel-price-settings">
        <div>
          <h2 className="lokal-stencil text-sm mb-1">Valor médio dos combustíveis</h2>
          <p className="text-xs text-neutral-500">Os valores serão sugeridos automaticamente nas viagens conforme o combustível selecionado.</p>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          {FUEL_TYPES.map((fuel) => (
            <label key={fuel} className="text-sm">
              {fuel} (R$/litro)
              <input
                className="lm-input mt-1"
                type="number"
                min="0"
                step="0.01"
                value={s.fuel_prices?.[fuel] ?? DEFAULT_FUEL_PRICES[fuel]}
                onChange={(event) => setS({
                  ...s,
                  fuel_prices: { ...DEFAULT_FUEL_PRICES, ...s.fuel_prices, [fuel]: event.target.value },
                })}
                data-testid={`fuel-price-${fuel}`}
              />
            </label>
          ))}
        </div>
        <button className="lokal-btn-primary" onClick={saveFuelPrices} disabled={isPending("save-fuel-prices")} data-testid="save-fuel-prices">
          {isPending("save-fuel-prices") ? "SALVANDO..." : "SALVAR VALORES"}
        </button>
      </section>}

      {isAdmin && <section className="lokal-panel p-4 space-y-3" data-testid="order-number-settings">
        <div>
          <h2 className="lokal-stencil text-sm mb-1">Numeração dos pedidos</h2>
          <p className="text-xs text-neutral-500">Ajuste o número atual da sequência. O próximo pedido receberá o número informado mais 1. Não é possível usar um número menor que a sequência atual.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs font-mono">
            Número atual
            <input
              className="block border px-2 py-1.5 text-sm mt-1"
              type="number"
              min={currentOrderNumber || 0}
              step="1"
              value={currentOrderNumber}
              onChange={(event) => setCurrentOrderNumber(event.target.value)}
              aria-label="Número atual dos pedidos"
              data-testid="current-order-number"
            />
          </label>
          <button
            className="lokal-btn-primary"
            onClick={saveCurrentOrderNumber}
            disabled={currentOrderNumber === "" || isPending("order-number")}
            data-testid="save-order-number"
          >
            SALVAR NUMERAÇÃO
          </button>
        </div>
      </section>}

      {isAdmin && <section className="lokal-panel p-4 space-y-3 border border-red-300" data-testid="data-reset-settings">
        <div>
          <h2 className="lokal-stencil text-sm mb-1 text-red-900">Limpeza de dados do sistema</h2>
          <p className="text-xs text-neutral-600">A limpeza é permanente. Contas de usuário, configurações e backups ZIP não serão apagados.</p>
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" name="data-reset-mode" value="all" checked={resetMode === "all"} onChange={() => setResetMode("all")} data-testid="reset-mode-all" />
            Zerar todos os dados operacionais
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="data-reset-mode" value="partial" checked={resetMode === "partial"} onChange={() => setResetMode("partial")} data-testid="reset-mode-partial" />
            Selecionar dados parciais
          </label>
        </div>
        {resetMode === "partial" && (
          <div className="grid sm:grid-cols-2 gap-2 border rounded p-3">
            {resetOptions.map((option) => (
              <label key={option.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selectedResetGroups.includes(option.id)}
                  onChange={(event) => setSelectedResetGroups((selected) => event.target.checked
                    ? [...selected, option.id]
                    : selected.filter((id) => id !== option.id))}
                  data-testid={`reset-group-${option.id}`}
                />
                <span>{option.label} <span className="text-xs text-neutral-500">({option.count})</span></span>
              </label>
            ))}
          </div>
        )}
        {resetMode === "all" && (
          <p className="text-xs text-neutral-500">
            {resetOptions.reduce((count, option) => count + option.count, 0)} registros estimados em {resetOptions.length} grupos operacionais.
          </p>
        )}
        <button
          className="px-4 py-2 rounded-sm bg-red-800 text-white disabled:opacity-50"
          onClick={resetSystemData}
          disabled={!resetOptions.length || (resetMode === "partial" && !selectedResetGroups.length) || isPending("reset-data")}
          data-testid="execute-data-reset"
        >
          APAGAR DADOS SELECIONADOS
        </button>
      </section>}

      {isAdmin && <section className="lokal-panel p-4 space-y-3" data-testid="day-backups-settings">
        <div>
          <h2 className="lokal-stencil text-sm mb-1">Backups dos fechamentos</h2>
          <p className="text-xs text-neutral-500">Um arquivo ZIP com os dados do sistema é criado ao finalizar cada dia. Os backups são preservados mesmo ao limpar dados operacionais.</p>
        </div>
        {dayBackups.length ? (
          <div className="space-y-2">
            {dayBackups.map((backup) => (
              <div key={backup.id} className="flex flex-wrap items-center justify-between gap-2 border rounded p-2">
                <span className="text-sm">{backup.day.split("-").reverse().join("/")} · {new Date(backup.created_at).toLocaleString("pt-BR")} · {(Number(backup.size_bytes || 0) / 1024 / 1024).toFixed(2)} MB</span>
                <button className="lm-btn lm-btn-dark" onClick={() => downloadBackup(backup)} data-testid={`download-backup-${backup.id}`}>
                  <Download size={14} />Baixar ZIP
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-neutral-500">Nenhum backup de fechamento registrado.</p>
        )}
        <div className="border-t pt-3 space-y-2" data-testid="restore-backup-section">
          <h3 className="font-head text-sm">Restaurar a partir de um backup</h3>
          <p className="text-xs text-red-800">Esta ação substitui produtos, pedidos, usuários, configurações e os demais dados pelos dados do arquivo ZIP. Faça a restauração apenas com um backup deste sistema; os backups já salvos serão preservados e uma cópia preventiva será criada antes da alteração.</p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="file"
              accept=".zip,application/zip"
              onChange={(event) => setBackupFile(event.target.files?.[0] || null)}
              aria-label="Arquivo ZIP de backup"
              data-testid="restore-backup-file"
            />
            <button
              className="lm-btn lm-btn-dark"
              onClick={restoreBackup}
              disabled={!backupFile || restoringBackup || isPending("restore-backup")}
              data-testid="restore-backup-submit"
            >
              <Upload size={14} />{restoringBackup ? "Restaurando..." : "Restaurar backup"}
            </button>
          </div>
        </div>
      </section>}

      <section className="lokal-panel p-4">
        <h2 className="lokal-stencil text-sm mb-3">Dados da empresa (impressão)</h2>
        <div className="grid md:grid-cols-2 gap-3">
          {STORE_FIELDS.map(([k, l]) => (
            <label key={k}><div className="text-[11px] font-mono text-neutral-500 mb-1">{l}</div>
              <input className="w-full border px-2 py-1.5 text-sm rounded-sm" value={s[k] || ""} onChange={(e) => setS({ ...s, [k]: e.target.value })} data-testid={`set-${k}`} />
            </label>
          ))}
        </div>
        <button className="lokal-btn-primary mt-3" onClick={saveStore} disabled={isPending("save-store")} data-testid="save-settings">
          {isPending("save-store") ? "SALVANDO..." : "SALVAR"}
        </button>
      </section>

      <section className="lokal-panel p-4">
        <h2 className="lokal-stencil text-sm mb-3">Usuários e vendedores</h2>
        <div className="overflow-x-auto">
        <table className="w-full text-sm table-mono mb-3">
          <thead className="bg-neutral-100 text-[11px]"><tr><th className="p-2 text-left">NOME</th><th className="text-left">LOGIN / E-MAIL</th><th className="text-left">PERFIL</th>{isAdmin && <><th className="text-left">VENDEDOR VINCULADO</th><th className="text-left">NOVA SENHA</th></>}<th></th></tr></thead>
          <tbody>{users.map((u) => (
            <tr key={u.id} className="border-t">
              <td className="p-2">{u.name}{u.pending && <span className="block text-[10px] text-amber-700">Aguardando privilégios</span>}</td>
              <td>{isAdmin ? <input className="border px-2 py-1 text-sm min-w-48" type="email" value={userEdits[u.id]?.email || ""}
                onChange={(e) => setUserEdits({ ...userEdits, [u.id]: { ...userEdits[u.id], email: e.target.value } })} aria-label={`Login de ${u.name}`} /> : u.email}</td>
              <td>{isAdmin ? <select className="border px-2 py-1 text-sm" value={userEdits[u.id]?.role || u.role}
                onChange={(e) => setUserEdits({ ...userEdits, [u.id]: { ...userEdits[u.id], role: e.target.value } })} aria-label={`Privilégios de ${u.name}`}>
                <option value="visualizador">Somente visualização</option><option value="vendedor">Vendedor</option><option value="admin">Administrador</option>
              </select> : u.role}</td>
              {isAdmin && <td><select
                className="border px-2 py-1 text-sm min-w-40"
                value={userEdits[u.id]?.vendor_id || ""}
                disabled={(userEdits[u.id]?.role || u.role) !== "vendedor"}
                onChange={(e) => setUserEdits({ ...userEdits, [u.id]: { ...userEdits[u.id], vendor_id: e.target.value } })}
                aria-label={`Vendedor vinculado a ${u.name}`}
                data-testid={`user-vendor-${u.id}`}
              >
                <option value="">— Nenhum —</option>
                {vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
              </select></td>}
              {isAdmin && <td><input className="border px-2 py-1 text-sm min-w-40" type="password" placeholder="Opcional · mínimo 8"
                value={userEdits[u.id]?.password || ""} onChange={(e) => setUserEdits({ ...userEdits, [u.id]: { ...userEdits[u.id], password: e.target.value } })} aria-label={`Nova senha de ${u.name}`} /></td>}
              <td className="whitespace-nowrap">{isAdmin && <>
                <button className="text-green-800 p-1" onClick={() => updateUser(u.id)} disabled={isPending(`update-user:${u.id}`)} title="Salvar login e privilégios" data-testid={`save-user-${u.id}`}>
                  {isPending(`update-user:${u.id}`) ? "Salvando..." : "Salvar"}
                </button>
                {u.id !== user.id && <button className="text-red-700 p-1" onClick={() => delUser(u.id)} data-testid={`del-user-${u.email}`}><Trash2 size={13} /></button>}
              </>}</td></tr>
          ))}</tbody>
        </table>
        </div>
        {isAdmin ? (
          <div className="grid md:grid-cols-6 gap-2">
            <input className="border px-2 py-1.5 text-sm" placeholder="Nome" value={nu.name} onChange={(e) => setNu({ ...nu, name: e.target.value })} data-testid="nu-name" />
            <input className="border px-2 py-1.5 text-sm" placeholder="E-mail" value={nu.email} onChange={(e) => setNu({ ...nu, email: e.target.value })} data-testid="nu-email" />
            <input className="border px-2 py-1.5 text-sm" type="password" placeholder="Senha" value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} data-testid="nu-password" />
            <select className="border px-2 py-1.5 text-sm" value={nu.role} onChange={(e) => setNu({ ...nu, role: e.target.value })} data-testid="nu-role">
              <option value="visualizador">Somente visualização</option><option value="vendedor">Vendedor</option><option value="admin">Admin</option>
            </select>
            {nu.role === "vendedor" && <select className="border px-2 py-1.5 text-sm" value={nu.vendor_id} onChange={(e) => setNu({ ...nu, vendor_id: e.target.value })} aria-label="Vendedor vinculado ao novo usuário" data-testid="nu-vendor">
              <option value="">— Vincular vendedor —</option>
              {vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
            </select>}
            <button className="lokal-btn-primary" onClick={addUser} disabled={isPending("add-user")} data-testid="nu-save">
              {isPending("add-user") ? "ADICIONANDO..." : "ADICIONAR"}
            </button>
          </div>
        ) : <div className="text-xs font-mono text-neutral-500">Apenas administradores podem gerenciar usuários.</div>}
      </section>

      {isAdmin && <section className="lokal-panel p-4 space-y-3" data-testid="registration-invitations">
        <div>
          <h2 className="lokal-stencil text-sm mb-1">Convites para cadastro</h2>
          <p className="text-xs text-neutral-500">Cada convite pode ser usado uma única vez. A nova conta começa somente com acesso de visualização.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs font-mono">Validade</label>
          <select className="border px-2 py-1.5 text-sm" value={inviteDays} onChange={(e) => setInviteDays(Number(e.target.value))} data-testid="invite-expiration">
            {[1, 3, 7, 14, 30].map((days) => <option key={days} value={days}>{days} {days === 1 ? "dia" : "dias"}</option>)}
          </select>
          <button className="lokal-btn-primary" onClick={createInvite} disabled={isPending("create-invite")} data-testid="create-invite">
            {isPending("create-invite") ? "GERANDO..." : "GERAR CONVITE"}
          </button>
        </div>
        {createdInviteLink && <div className="flex flex-col sm:flex-row gap-2">
          <input className="border px-2 py-1.5 text-sm flex-1 min-w-0" value={createdInviteLink} readOnly onFocus={(e) => e.target.select()} aria-label="Link do convite" data-testid="invite-link" />
          <button className="lokal-btn-primary" onClick={copyInviteLink} data-testid="copy-invite">COPIAR LINK</button>
        </div>}
        <div className="overflow-x-auto">
          <table className="w-full text-sm table-mono">
            <thead className="bg-neutral-100 text-[11px]"><tr><th className="p-2 text-left">CRIADO</th><th className="text-left">VALIDADE</th><th className="text-left">STATUS</th><th></th></tr></thead>
            <tbody>{invitations.map((invite) => {
              const expired = new Date(invite.expires_at) <= new Date();
              const status = invite.revoked_at ? "Revogado" : invite.used_at ? "Utilizado" : expired ? "Expirado" : invite.claimed_at ? "Cadastro em andamento" : "Ativo";
              return <tr key={invite.id} className="border-t">
                <td className="p-2">{new Date(invite.created_at).toLocaleString("pt-BR")}</td>
                <td>{new Date(invite.expires_at).toLocaleString("pt-BR")}</td>
                <td>{status}</td>
                <td className="text-right">{!invite.used_at && !invite.revoked_at && !expired && <button className="text-red-700 p-1" onClick={() => revokeInvite(invite.id)} data-testid={`revoke-invite-${invite.id}`}>Revogar</button>}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      </section>}

      <section className="lokal-panel p-4">
        <h2 className="lokal-stencil text-sm mb-3">Alterar minha senha</h2>
        <div className="grid md:grid-cols-3 gap-2">
          <input className="border px-2 py-1.5 text-sm" type="password" placeholder="Senha atual" value={passwordChange.current_password}
            onChange={(e) => setPasswordChange({ ...passwordChange, current_password: e.target.value })} data-testid="current-password" />
          <input className="border px-2 py-1.5 text-sm" type="password" placeholder="Nova senha · mínimo 8 caracteres" minLength={8} value={passwordChange.new_password}
            onChange={(e) => setPasswordChange({ ...passwordChange, new_password: e.target.value })} data-testid="new-password" />
          <button className="lokal-btn-primary" onClick={changeOwnPassword} disabled={!passwordChange.current_password || passwordChange.new_password.length < 8 || isPending("change-password")} data-testid="change-password">
            {isPending("change-password") ? "ALTERANDO..." : "ALTERAR SENHA"}
          </button>
        </div>
      </section>
    </div>
  );
}
