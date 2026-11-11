import React, { useEffect, useRef, useState } from "react";
import { Outlet, NavLink, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import BrandMark from "@/components/BrandMark";
import { api } from "@/lib/api";
import { enablePushNotifications, isInstalledApp, isIosDevice, isMobileDevice } from "@/lib/pushNotifications";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  LayoutDashboard, Package, Boxes, ShoppingCart, Repeat, Users, Tag, Truck,
  Wrench, Fuel, DollarSign, Settings, LogOut, Menu, X, Car, Bell, BellRing, Check
} from "lucide-react";

const items = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/produtos", label: "Produtos", icon: Package },
  { to: "/estoque", label: "Estoque", icon: Boxes },
  { to: "/pedidos", label: "Pedidos & PDV", icon: ShoppingCart },
  { to: "/trocas", label: "Trocas/Devoluções", icon: Repeat },
  { to: "/clientes", label: "Clientes", icon: Users },
  { to: "/categorias", label: "Categorias", icon: Tag },
  { to: "/fornecedores", label: "Fornecedores", icon: Truck },
  { to: "/veiculos", label: "Veículos", icon: Car },
  { to: "/comissoes", label: "Comissões", icon: DollarSign },
  { to: "/insumos", label: "Insumos", icon: Package },
  { to: "/viagens", label: "Viagens & Rotas", icon: Fuel },
  { to: "/manutencao", label: "Manutenção Veículo", icon: Wrench },
  { to: "/configuracoes", label: "Configurações", icon: Settings },
];

export default function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [pushPromptOpen, setPushPromptOpen] = useState(false);
  const [pushConfigured, setPushConfigured] = useState(false);
  const [pushActivating, setPushActivating] = useState(false);
  const [pendingDialogOpen, setPendingDialogOpen] = useState(false);
  const [pendingItems, setPendingItems] = useState([]);
  const [archivingPendingId, setArchivingPendingId] = useState("");
  const pendingPopupUser = useRef("");

  useEffect(() => {
    if (!user?.id || user.id === "public-access") {
      pendingPopupUser.current = "";
      return undefined;
    }
    if (pendingPopupUser.current === user.id) return undefined;
    pendingPopupUser.current = user.id;
    const token = localStorage.getItem("lokal_token") || sessionStorage.getItem("lokal_token") || "";
    const shownKey = `lokal-pending-popup:${user.id}:${token.slice(-16) || "session"}`;
    if (sessionStorage.getItem(shownKey)) return undefined;
    let cancelled = false;
    api.get("/dashboard/pending")
      .then(({ data }) => {
        if (cancelled) return;
        const items = Array.isArray(data.items) ? data.items : [];
        sessionStorage.setItem(shownKey, "shown");
        if (items.length) {
          setPendingItems(items);
          setPendingDialogOpen(true);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.error("Não foi possível carregar as pendências da sessão.", error);
          toast.error(error.response?.data?.detail || "Não foi possível carregar as pendências");
        }
      });
    return () => { cancelled = true; };
  }, [user?.id]);

  const archivePendingItem = async (item) => {
    if (!window.confirm(`Confirmar que "${item.title}" foi realizado e arquivar esta pendência na sua conta?`)) return;
    setArchivingPendingId(item.id);
    try {
      await api.post(`/dashboard/pending/${encodeURIComponent(item.id)}/archive`);
      setPendingItems((current) => current.filter((pending) => pending.id !== item.id));
      toast.success("Pendência confirmada e arquivada");
      if (pendingItems.length === 1) setPendingDialogOpen(false);
    } catch (archiveError) {
      console.error("Não foi possível arquivar a pendência.", archiveError);
      toast.error(archiveError.response?.data?.detail || "Não foi possível arquivar a pendência");
    } finally {
      setArchivingPendingId("");
    }
  };

  const enableCloseNotifications = async () => {
    if (!("Notification" in window)) {
      toast.error("Este navegador não oferece notificações.");
      return;
    }
    try {
      const permission = await Notification.requestPermission();
      if (permission === "granted") {
        toast.success("Avisos do fechamento ativados neste navegador.");
      } else {
        toast.error("Permita as notificações do navegador para receber o aviso.");
      }
    } catch (notificationError) {
      console.error("Não foi possível solicitar permissão para notificações.", notificationError);
      toast.error("Não foi possível ativar as notificações do navegador.");
    }
  };

  useEffect(() => {
    if (!user?.id || user.id === "public-access" || !isMobileDevice()) return undefined;
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) return undefined;

    const dismissedKey = `lokal-push-prompt-dismissed:${user.id}`;
    if (localStorage.getItem(dismissedKey)) return undefined;
    let cancelled = false;
    const checkPushStatus = async () => {
      try {
        const registration = await navigator.serviceWorker.getRegistration("/push-service-worker.js");
        const subscription = await registration?.pushManager.getSubscription();
        const { data } = await api.get("/notifications/push/status", {
          params: subscription?.endpoint ? { endpoint: subscription.endpoint } : {},
        });
        if (cancelled || !data.configured || data.subscribed) return;
        setPushConfigured(true);
        setPushPromptOpen(true);
      } catch (error) {
        console.error("Não foi possível verificar as notificações deste dispositivo.", error);
      }
    };

    checkPushStatus();
    return () => { cancelled = true; };
  }, [user?.id]);

  const dismissPushPrompt = () => {
    if (user?.id) localStorage.setItem(`lokal-push-prompt-dismissed:${user.id}`, "dismissed");
    setPushPromptOpen(false);
  };

  const activatePushOnDevice = async () => {
    setPushActivating(true);
    try {
      await enablePushNotifications();
      localStorage.setItem(`lokal-push-prompt-dismissed:${user.id}`, "enabled");
      setPushPromptOpen(false);
      toast.success("Notificações ativadas neste dispositivo");
    } catch (error) {
      console.error("Não foi possível ativar as notificações neste dispositivo.", error);
      toast.error(error.response?.data?.detail || error.message || "Não foi possível ativar as notificações");
    } finally {
      setPushActivating(false);
    }
  };

  useEffect(() => {
    if (user?.role !== "admin") return undefined;
    const checkDailySchedule = async () => {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Sao_Paulo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).formatToParts(new Date()).reduce((values, part) => {
        values[part.type] = part.value;
        return values;
      }, {});
      const date = `${parts.year}-${parts.month}-${parts.day}`;
      const minutes = Number(parts.hour) * 60 + Number(parts.minute);

      if (minutes >= 18 * 60 + 50 && minutes < 19 * 60) {
        const warningKey = `lokal-close-warning:${date}`;
        if (!localStorage.getItem(warningKey)) {
          localStorage.setItem(warningKey, "shown");
          const message = "O fechamento automático do dia será realizado às 19h.";
          toast.warning(message);
          if ("Notification" in window && Notification.permission === "granted") {
            try {
              new Notification("LOKAL MILITAR", { body: message });
            } catch (notificationError) {
              console.error("Não foi possível exibir a notificação do fechamento.", notificationError);
            }
          }
        }
      }

      if (minutes < 19 * 60) return;
      const closedKey = `lokal-auto-closed:${date}`;
      if (localStorage.getItem(closedKey) === "done") return;
      const lockKey = `lokal-auto-close-lock:${date}`;
      const lastAttempt = Number(localStorage.getItem(lockKey) || 0);
      if (Date.now() - lastAttempt < 120_000) return;

      localStorage.setItem(lockKey, String(Date.now()));
      try {
        await api.post("/dashboard/close-day");
        await api.post("/dashboard/close-day/confirm");
        localStorage.setItem(closedKey, "done");
        localStorage.removeItem(lockKey);
        toast.success("Fechamento automático das 19h concluído. As sessões serão encerradas.");
        window.setTimeout(logout, 1000);
      } catch (closeError) {
        localStorage.removeItem(lockKey);
        console.error("Não foi possível fechar automaticamente o dia.", closeError);
        toast.error(closeError.response?.data?.detail || "Falha no fechamento automático. Tente novamente.");
      }
    };

    checkDailySchedule();
    const timer = window.setInterval(checkDailySchedule, 15_000);
    return () => window.clearInterval(timer);
  }, [user?.id, user?.role, logout]);

  if (user === undefined) return <div className="p-8 font-mono">Carregando...</div>;
  if (user === null) return <Navigate to="/login" replace />;

  return (
    <div className="App flex" style={{ minHeight: "100vh" }}>
      <Dialog open={pendingDialogOpen} onOpenChange={setPendingDialogOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto" data-testid="pending-items-dialog">
          <DialogHeader>
            <DialogTitle className="font-head">Pendências do sistema</DialogTitle>
            <DialogDescription>
              Confira anotações, pedidos em aberto, manutenções programadas e produtos que podem ser montados.
              Ao confirmar e arquivar, a pendência deixa de aparecer na sua conta; o registro original não é alterado.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {pendingItems.map((item) => (
              <div key={item.id} className="border p-3">
                <button
                  type="button"
                  className="w-full text-left hover:bg-neutral-100"
                  onClick={() => {
                    setPendingDialogOpen(false);
                    navigate(item.url || "/");
                  }}
                  data-testid={`pending-item-${item.type}`}
                >
                  <span className="block text-xs uppercase text-neutral-500">
                    {item.type === "anotacao"
                      ? "Anotação"
                      : item.type === "pedido"
                        ? "Pedido"
                        : item.type === "montagem"
                          ? "Montagem disponível"
                          : "Manutenção"}
                    {item.date ? ` · ${new Date(`${item.date}T00:00:00`).toLocaleDateString("pt-BR")}` : ""}
                  </span>
                  <span className="block font-semibold">{item.title}</span>
                  {item.body && <span className="block text-sm text-neutral-600">{item.body}</span>}
                </button>
                <div className="mt-2 flex justify-end">
                  <button
                    type="button"
                    className="lm-btn lm-btn-olive"
                    onClick={() => archivePendingItem(item)}
                    disabled={Boolean(archivingPendingId)}
                    data-testid={`archive-pending-${item.type}`}
                  >
                    <Check size={14} />
                    {archivingPendingId === item.id ? "Arquivando..." : "Confirmar e arquivar"}
                  </button>
                </div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <button type="button" className="lm-btn lm-btn-dark" onClick={() => setPendingDialogOpen(false)}>Fechar</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={pushPromptOpen} onOpenChange={setPushPromptOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><BellRing size={20} /> Ative as notificações neste celular</DialogTitle>
            <DialogDescription>
              Receba avisos de pedidos e lembretes mesmo quando o sistema não estiver aberto. A permissão só será solicitada ao tocar no botão abaixo.
            </DialogDescription>
          </DialogHeader>
          {isIosDevice() && !isInstalledApp() && (
            <p className="text-sm text-amber-700">
              No iPhone, primeiro adicione o Lokal Militar à Tela de Início pelo menu Compartilhar do Safari e abra o aplicativo pelo ícone criado.
            </p>
          )}
          {("Notification" in window) && Notification.permission === "denied" && (
            <p className="text-sm text-amber-700">
              As notificações estão bloqueadas nas permissões do navegador. Libere-as nas configurações do dispositivo e tente novamente.
            </p>
          )}
          <DialogFooter>
            <button type="button" className="lm-btn lm-btn-dark" onClick={dismissPushPrompt}>Agora não</button>
            <button
              type="button"
              className="lm-btn lm-btn-olive"
              onClick={() => {
                if (Notification.permission === "denied") {
                  setPushPromptOpen(false);
                  navigate("/configuracoes");
                  return;
                }
                activatePushOnDevice();
              }}
              disabled={pushActivating || !pushConfigured || (isIosDevice() && !isInstalledApp())}
              data-testid="activate-mobile-push"
            >
              {pushActivating ? "ATIVANDO..." : Notification.permission === "denied" ? "IR PARA CONFIGURAÇÕES" : "ATIVAR NOTIFICAÇÕES"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 bg-[#111] text-white flex items-center justify-between px-3 h-12 no-print">
        <button onClick={()=>setOpen(!open)} data-testid="mobile-menu-toggle">
          {open ? <X size={20}/> : <Menu size={20}/>}
        </button>
        <div className="lokal-stencil text-sm">LOKAL MILITAR</div>
        {user?.role === "admin" && (
          <button onClick={enableCloseNotifications} aria-label="Ativar notificações do fechamento">
            <Bell size={18}/>
          </button>
        )}
        <button onClick={logout} aria-label="Sair"><LogOut size={18}/></button>
      </div>

      <aside className={`lokal-sidebar no-print ${open ? "block" : "hidden"} md:block fixed md:static z-30 top-12 md:top-0 left-0 w-64 md:min-h-screen`}>
        <div className="hidden md:block px-4 py-4 border-b border-neutral-800" data-testid="sidebar-logo">
          <div className="flex items-center justify-center">
            <BrandMark align="center" compact />
          </div>
        </div>
        <nav className="py-2">
          {items.map((it) => (
            <NavLink key={it.to} to={it.to} end={it.end}
              onClick={()=>setOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-2.5 text-[13px] font-medium ${isActive ? "active" : "text-neutral-300"}`
              }
              data-testid={`nav-${it.to.replace("/", "") || "dashboard"}`}>
              <it.icon size={16} />
              <span>{it.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="px-4 py-4 border-t border-neutral-800 mt-4">
          <div className="text-[11px] font-mono text-neutral-400">{user?.name}</div>
          <div className="text-[10px] text-neutral-600 uppercase">{user?.role}</div>
          {user?.role === "admin" && (
            <button onClick={enableCloseNotifications} className="mt-3 text-xs font-mono text-neutral-400 hover:text-white flex items-center gap-1" data-testid="enable-close-notifications">
              <Bell size={12}/> ATIVAR AVISO 18H50
            </button>
          )}
          <button onClick={logout} className="mt-3 text-xs font-mono text-neutral-400 hover:text-white flex items-center gap-1" data-testid="btn-logout">
            <LogOut size={12}/> SAIR
          </button>
        </div>
      </aside>

      <main className="flex-1 p-4 md:p-6 pt-16 md:pt-6" style={{ background: "var(--system-bg-color)" }}>
        <Outlet />
      </main>
    </div>
  );
}
