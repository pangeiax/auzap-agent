import React, {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { petshopService, serviceService } from "@/services";
import type { Petshop, Service } from "@/types";

interface SettingsContextType {
  // Data
  petshop: Petshop | null;
  services: Service[];
  businessHours: Petshop["businessHours"] | null;

  // Loading states
  loadingPetshop: boolean;
  loadingServices: boolean;

  // Error states
  petshopError: string | null;
  servicesError: string | null;

  // Mutations
  updatePetshop: (data: any) => Promise<void>;
  createService: (data: any) => Promise<Service>;
  updateService: (id: number, data: any) => Promise<Service>;
  deleteService: (id: number) => Promise<void>;

  // Refresh
  refetchPetshop: () => Promise<void>;
  refetchServices: () => Promise<void>;
}

export const SettingsContext = createContext<SettingsContextType | undefined>(
  undefined,
);

export function SettingsProvider({
  children,
  petshopId,
}: {
  children: React.ReactNode;
  petshopId: number;
}) {
  // State
  const [petshop, setPetshop] = useState<Petshop | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [loadingPetshop, setLoadingPetshop] = useState(true);
  const [loadingServices, setLoadingServices] = useState(true);
  const [petshopError, setPetshopError] = useState<string | null>(null);
  const [servicesError, setServicesError] = useState<string | null>(null);

  // Fetch petshop (com cache)
  const refetchPetshop = useCallback(async () => {
    if (!petshopId) {
      setLoadingPetshop(false);
      return;
    }

    try {
      setPetshopError(null);
      const data = await petshopService.getPetshop(petshopId);
      setPetshop(data);
    } catch (error: any) {
      console.error("Erro ao carregar petshop:", error);
      setPetshopError(error?.message || "Erro ao carregar dados do petshop");
    } finally {
      setLoadingPetshop(false);
    }
  }, [petshopId]);

  // Fetch services (com cache)
  const refetchServices = useCallback(async () => {
    if (!petshopId) {
      setLoadingServices(false);
      return;
    }

    try {
      setServicesError(null);
      const list = await serviceService.listServices();
      setServices(list);
    } catch (error: any) {
      console.error("Erro ao carregar serviços:", error);
      setServicesError(error?.message || "Erro ao carregar serviços");
    } finally {
      setLoadingServices(false);
    }
  }, [petshopId]);

  // Load data on mount
  useEffect(() => {
    refetchPetshop();
  }, [refetchPetshop]);

  useEffect(() => {
    refetchServices();
  }, [refetchServices]);

  // Mutations
  const updatePetshop = useCallback(
    async (data: any) => {
      if (!petshopId) throw new Error("Petshop ID not found");

      try {
        await petshopService.updatePetshop(petshopId, data);
        await refetchPetshop();
      } catch (error) {
        throw error;
      }
    },
    [petshopId, refetchPetshop],
  );

  const createService = useCallback(async (data: any) => {
    try {
      const service = await serviceService.createService(data);
      setServices((prev) => [...prev, service]);
      return service;
    } catch (error) {
      throw error;
    }
  }, []);

  const updateService = useCallback(async (id: number, data: any) => {
    try {
      const updated = await serviceService.updateService(id, data);
      setServices((prev) => prev.map((s) => (s.id === id ? updated : s)));
      return updated;
    } catch (error) {
      throw error;
    }
  }, []);

  const deleteService = useCallback(async (id: number) => {
    try {
      await serviceService.deleteService(id);
      setServices((prev) => prev.filter((s) => s.id !== id));
    } catch (error) {
      throw error;
    }
  }, []);

  const value = useMemo<SettingsContextType>(
    () => ({
      petshop,
      services,
      businessHours: petshop?.businessHours || null,
      loadingPetshop,
      loadingServices,
      petshopError,
      servicesError,
      updatePetshop,
      createService,
      updateService,
      deleteService,
      refetchPetshop,
      refetchServices,
    }),
    [
      petshop,
      services,
      loadingPetshop,
      loadingServices,
      petshopError,
      servicesError,
      updatePetshop,
      createService,
      updateService,
      deleteService,
      refetchPetshop,
      refetchServices,
    ],
  );

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}
