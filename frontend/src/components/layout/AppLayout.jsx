import React, { useEffect, useState } from "react";
import { Outlet, NavLink, Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import BrandMark from "@/components/BrandMark";
import { api } from "@/lib/api";
import { toast } from "sonner";
import {
  LayoutDashboard, Package, Boxes, ShoppingCart, Repeat, Users, Tag, Truck,
  Wrench, Fuel, DollarSign, Settings, LogOut, Menu, X, Car, Bell
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
  const [open, setOpen] = useState(false);

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
