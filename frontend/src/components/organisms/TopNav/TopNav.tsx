import { Link, useLocation } from "react-router-dom";
import {
  Home,
  MessageSquare,
  Users,
  Calendar,
  Settings,
  Moon,
  Sun,
  Bed,
  Menu,
} from "lucide-react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { cn } from "@/lib/cn";
import { useTheme } from "@/contexts/ThemeContext";
import { useWhatsAppStatus } from "@/contexts/WhatsAppStatusContext";

function WhatsAppStatusDot() {
  const { status, lastConnected } = useWhatsAppStatus();

  const isConnected = status === "connected";
  const isLoading = status === "loading";

  const label = isLoading
    ? "Verificando conexão..."
    : isConnected
      ? "WhatsApp conectado"
      : lastConnected
        ? `WhatsApp desconectado\nÚltima conexão: ${new Date(lastConnected).toLocaleString("pt-BR")}`
        : "WhatsApp desconectado";

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <div className="flex items-center justify-center cursor-default">
          <div
            className={cn(
              "h-2.5 w-2.5 rounded-full transition-colors duration-300",
              isLoading
                ? "bg-[#727B8E]/40"
                : isConnected
                  ? "bg-[#3CD057] shadow-[0_0_6px_1px_#3CD057]"
                  : "bg-[#727B8E]",
            )}
          />
        </div>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="bottom"
          sideOffset={10}
          className="z-50 max-w-[220px] whitespace-pre-line rounded-lg bg-[#0F172A] px-3 py-2 text-xs text-white shadow-lg animate-in fade-in-0 zoom-in-95"
        >
          {label}
          <Tooltip.Arrow className="fill-[#0F172A]" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

const NAV_ICONS = [
  { icon: Home, label: "Home", href: "/home" },
  { icon: MessageSquare, label: "Chat", href: "/chat" },
  { icon: Users, label: "Clientes", href: "/clientes" },
  { icon: Calendar, label: "Agenda", href: "/calendario" },
  { icon: Bed, label: "Hotel/Creche", href: "/hotel-creche" },
  { icon: Settings, label: "Configurações", href: "/configuracoes" },
];

interface TopNavProps {
  linked?: boolean;
  onMenuClick?: () => void;
}

export function TopNav({ linked = true, onMenuClick }: TopNavProps) {
  const { pathname } = useLocation();
  const { theme, toggleTheme } = useTheme();

  return (
    <Tooltip.Provider delayDuration={200}>
      <div className="flex w-full items-center justify-between gap-2 px-1">

        <WhatsAppStatusDot />
        <div
          className={cn(
            "flex shrink-0 items-center justify-center rounded-full",
            "gap-0.5 px-1 sm:gap-2 sm:px-2",
            "border border-[#727B8E]/10 bg-white backdrop-blur-[6px] dark:border-[#40485A] dark:bg-[#1A1B1D]/90",
          )}
          style={{ height: "auto", padding: "4px" }}
        >
          {NAV_ICONS.map(({ icon: Icon, label, href }) => {
            if (!linked) {
              return (
                <Tooltip.Root key={label}>
                  <Tooltip.Trigger asChild>
                    <button
                      type="button"
                      className="flex h-11 w-11 sm:h-8 sm:w-8 items-center justify-center rounded-full transition-colors duration-300 ease-in-out hover:bg-gray-100 dark:hover:bg-[#212225]"
                      aria-label={label}
                    >
                      <Icon
                        className="h-5 w-5 sm:h-[17px] sm:w-[17px] stroke-[#8A96A8] dark:stroke-[#8a94a6]"
                        strokeWidth={1.33}
                      />
                    </button>
                  </Tooltip.Trigger>
                  <Tooltip.Portal>
                    <Tooltip.Content
                      side="bottom"
                      sideOffset={8}
                      className="z-50 rounded-lg bg-[#0F172A] px-3 py-2 text-xs text-white shadow-lg animate-in fade-in-0 zoom-in-95"
                    >
                      {label}
                      <Tooltip.Arrow className="fill-[#0F172A]" />
                    </Tooltip.Content>
                  </Tooltip.Portal>
                </Tooltip.Root>
              );
            }

            const isActive =
              pathname === href ||
              pathname?.startsWith(`${href}/`) ||
              (href === "/chat" &&
                (pathname === "/pipeline" ||
                  pathname?.startsWith("/pipeline/")));

            return (
              <Tooltip.Root key={label}>
                <Tooltip.Trigger asChild>
                  <Link
                    to={href}
                    className={cn(
                      "flex h-11 w-11 sm:h-8 sm:w-8 items-center justify-center rounded-full transition-colors duration-300 ease-in-out",
                      isActive
                        ? "bg-[#1E62EC] dark:bg-[#2172e5]"
                        : "hover:bg-gray-100 dark:hover:bg-[#212225]",
                    )}
                    aria-label={label}
                  >
                    <Icon
                      className={cn(
                        "h-5 w-5 sm:h-[17px] sm:w-[17px]",
                        isActive
                          ? "stroke-white"
                          : "stroke-[#8A96A8] dark:stroke-[#8a94a6]",
                      )}
                      strokeWidth={1.33}
                    />
                  </Link>
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content
                    side="bottom"
                    sideOffset={8}
                    className="z-50 rounded-lg bg-[#0F172A] px-3 py-2 text-xs text-white shadow-lg animate-in fade-in-0 zoom-in-95"
                  >
                    {label}
                    <Tooltip.Arrow className="fill-[#0F172A]" />
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>
            );
          })}
        </div>

        <button
          type="button"
          onClick={toggleTheme}
          className={cn(
            "flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full transition-colors",
            "border border-[#727B8E]/10 bg-white backdrop-blur-[6px] dark:border-[#40485A] dark:bg-[#1A1B1D]/90",
          )}
          aria-label={
            theme === "dark"
              ? "Alternar para modo claro"
              : "Alternar para modo escuro"
          }
        >
          {theme === "dark" ? (
            <Sun
              className="h-4 w-4 stroke-[#8A96A8] dark:stroke-[#8a94a6]"
              strokeWidth={1.67}
            />
          ) : (
            <Moon className="h-4 w-4 stroke-[#8A96A8]" strokeWidth={1.67} />
          )}
        </button>
      </div>
    </Tooltip.Provider>
  );
}
