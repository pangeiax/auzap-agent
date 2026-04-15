import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { whatsappService } from "@/services";

type ConnectionStatus = "connected" | "disconnected" | "loading";

interface WhatsAppStatusContextValue {
  status: ConnectionStatus;
  lastConnected: string | null;
}

const WhatsAppStatusContext = createContext<WhatsAppStatusContextValue>({
  status: "loading",
  lastConnected: null,
});

export function WhatsAppStatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ConnectionStatus>("loading");
  const [lastConnected, setLastConnected] = useState<string | null>(null);

  const check = useCallback(async () => {
    try {
      const data = await whatsappService.getStatus();
      setStatus(data.status === "connected" ? "connected" : "disconnected");
      setLastConnected((data as any).last_connected ?? null);
    } catch {
      setStatus("disconnected");
    }
  }, []);

  useEffect(() => {
    check();
    const interval = setInterval(check, 30_000);
    return () => clearInterval(interval);
  }, [check]);

  return (
    <WhatsAppStatusContext.Provider value={{ status, lastConnected }}>
      {children}
    </WhatsAppStatusContext.Provider>
  );
}

export function useWhatsAppStatus() {
  return useContext(WhatsAppStatusContext);
}
