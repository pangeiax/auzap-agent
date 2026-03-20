import { useEffect, useMemo, useState } from "react";
import { appointmentService } from "@/services";
import { dateToISO } from "@/lib/masks";
import type { AvailableSlot } from "@/types";

function isValidIsoDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

const inFlightSlots = new Map<string, Promise<AvailableSlot[]>>();

/**
 * Fetches available schedule slots for a given date.
 * Sem cache em memória: cada execução do efeito chama a API de novo (data/serviço/pet/modal),
 * para refletir vagas após agendamentos ou mudanças em outra aba.
 *
 * @param dateInput - Date in DD/MM/YYYY or YYYY-MM-DD format
 * @param serviceId - Optional service ID to filter slots by specialty
 * @param enabled - Whether fetching is enabled (default: true)
 * @param petId - Optional pet UUID; com multiplier e porte G/GG, filtra pares de slots
 */
export function useAvailableScheduleSlots(
  dateInput: string,
  serviceId?: string,
  enabled = true,
  petId?: string,
) {
  const [slots, setSlots] = useState<AvailableSlot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dateIso = useMemo(() => {
    const parsed = dateToISO(dateInput);
    return isValidIsoDate(parsed) ? parsed : "";
  }, [dateInput]);

  useEffect(() => {
    if (!enabled || !dateIso) {
      setSlots([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    const cacheKey = `${dateIso}|${serviceId ?? ""}|${petId ?? ""}`;

    const fetchSlots = async () => {
      try {
        setLoading(true);
        setError(null);

        let request = inFlightSlots.get(cacheKey);
        if (!request) {
          request = appointmentService
            .getAvailableSlots({
              date: dateIso,
              ...(serviceId ? { service_id: serviceId } : {}),
              ...(petId ? { pet_id: petId } : {}),
            })
            .then((response) => response.available_slots)
            .finally(() => {
              inFlightSlots.delete(cacheKey);
            });
          inFlightSlots.set(cacheKey, request);
        }
        const nextSlots = await request;

        if (!cancelled) {
          setSlots(nextSlots);
        }
      } catch (err: any) {
        if (!cancelled) {
          setSlots([]);
          setError(
            err.response?.data?.error ||
              err.response?.data?.detail ||
              "Erro ao carregar horários disponíveis.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void fetchSlots();

    return () => {
      cancelled = true;
    };
  }, [dateIso, serviceId, petId, enabled]);

  return {
    dateIso,
    slots,
    loading,
    error,
  };
}
