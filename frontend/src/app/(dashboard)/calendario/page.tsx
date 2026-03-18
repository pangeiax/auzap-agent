import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { DashboardLayout } from "@/components/templates/DashboardLayout";
import { CalendarHeader } from "@/components/molecules/CalendarHeader";
import {
  CalendarGrid,
  type CalendarEvent,
} from "@/components/molecules/CalendarGrid";
import { CalendarSidebar } from "@/components/molecules/CalendarSidebar";
import { CalendarDayView } from "@/components/molecules/CalendarDayView";
import {
  CalendarWeekView,
  type WeekDay,
} from "@/components/molecules/CalendarWeekView";
import { Modal } from "@/components/molecules/Modal";
import { Input } from "@/components/atoms/Input";
import { Select } from "@/components/atoms/Select";
import { TextArea } from "@/components/atoms/TextArea";
import { useAvailableScheduleSlots, useToast } from "@/hooks";
import { MONTHS, WEEK_LABELS, STATUS_OPTIONS } from "@/data/calendar";
import {
  appointmentService,
  clientService,
  petService,
  serviceService,
} from "@/services";
import { useAuthContext } from "@/contexts/AuthContext";
import { maskPhone, maskDate, dateToISO, dateFromISO } from "@/lib/masks";
import { normalizePetSize, PET_SIZE_OPTIONS_WITH_PLACEHOLDER } from "@/lib/petSize";
import { UserPlus, PawPrint, Plus, Loader2 } from "lucide-react";
import type { Appointment, Client, Pet, Service } from "@/types";
import {
  appointmentStatusFromApi,
  appointmentStatusToApi,
  type UiAppointmentStatus,
} from "@/lib/appointmentStatus";

type CalendarStatus = UiAppointmentStatus;

function normalizeStatus(status: string): CalendarStatus {
  return appointmentStatusFromApi(status);
}

function appointmentToCalendarEvent(a: Appointment): CalendarEvent {
  // When scheduled_at has an explicit BRT offset (e.g. "...T14:00:00-03:00") we parse
  // the date/time from the string directly to avoid local-timezone shifts that could
  // move an appointment to a different day in non-BRT browsers.
  let dateStr: string;
  let timeStr: string;
  if (a.scheduled_at) {
    // Extract date and time from the ISO string before any timezone conversion
    const raw = a.scheduled_at;
    // Handle both "YYYY-MM-DDTHH:mm:ssZ" and "YYYY-MM-DDTHH:mm:ss±HH:mm"
    const match = raw.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
    if (match) {
      dateStr = match[1]!;
      timeStr = match[2]!;
      // If the offset is -03:00, the date/time already represent BRT — use directly.
      // If offset is Z (UTC), convert to BRT by subtracting 3 hours.
      if (raw.endsWith("Z") || raw.endsWith("+00:00")) {
        const d = new Date(raw);
        d.setUTCHours(d.getUTCHours() - 3);
        dateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
        timeStr = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
      }
    } else {
      const d = new Date(raw);
      dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      timeStr = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    }
  } else {
    const d = new Date();
    dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    timeStr = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  const petName = a.pet_name || a.client_name || "Agendamento";
  return {
    id: a.id,
    petName,
    petInitials: getInitials(petName),
    type: a.specialty || "Consulta",
    time: timeStr,
    date: dateStr,
    status: normalizeStatus(a.status),
  };
}

const initialEventsFallback: CalendarEvent[] = [];

interface NewAppointmentForm {
  clientId: string;
  petId: string;
  date: string;
  time: string;
  slotId: string;
  serviceId: string;
  status: string;
  notes: string;
}

const initialFormState: NewAppointmentForm = {
  clientId: "",
  petId: "",
  date: "",
  time: "",
  slotId: "",
  serviceId: "",
  status: "pendente",
  notes: "",
};

interface FormErrors {
  clientId?: string;
  petId?: string;
  date?: string;
  serviceId?: string;
  slotId?: string;
  newClientName?: string;
  newClientPhone?: string;
  newPetName?: string;
  newPetSpecies?: string;
  newPetSize?: string;
}


function formatDateKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDateBR(d: Date) {
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

function getWeekDays(
  year: number,
  month: number,
  dayInWeek: number,
): WeekDay[] {
  const date = new Date(year, month, dayInWeek);
  const dayOfWeek = date.getDay();
  const startOfWeek = new Date(date);
  startOfWeek.setDate(date.getDate() - dayOfWeek);

  const today = new Date();

  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(startOfWeek);
    d.setDate(startOfWeek.getDate() + i);
    return {
      label: WEEK_LABELS[i],
      date: d.getDate(),
      month: d.getMonth(),
      year: d.getFullYear(),
      fullDate: formatDateBR(d),
      isToday:
        d.getDate() === today.getDate() &&
        d.getMonth() === today.getMonth() &&
        d.getFullYear() === today.getFullYear(),
    };
  });
}

function formatDateLabel(year: number, month: number, day: number) {
  const d = new Date(year, month, day);
  const weekDayNames = [
    "Domingo",
    "Segunda-feira",
    "Terça-feira",
    "Quarta-feira",
    "Quinta-feira",
    "Sexta-feira",
    "Sábado",
  ];
  const weekDay = weekDayNames[d.getDay()];
  return `${weekDay}, ${String(day).padStart(2, "0")} de ${MONTHS[month]}`;
}

function getInitials(name: string): string {
  const words = name.trim().split(" ");
  if (words.length >= 2) {
    return (words[0][0]! + words[1][0]!).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

export default function CalendarioPage() {
  const { user } = useAuthContext();
  const toast = useToast();
  const petshopId = user?.petshop_id ?? 0;

  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(new Date());
  const [activeView, setActiveView] = useState<"month" | "week" | "day">(
    "month",
  );
  const [events, setEvents] = useState<CalendarEvent[]>(initialEventsFallback);
  const [eventsLoading, setEventsLoading] = useState(true);

  const [clients, setClients] = useState<Client[]>([]);
  const [clientPets, setClientPets] = useState<Pet[]>([]);
  const [services, setServices] = useState<Service[]>([]);

  const [showNewClientForm, setShowNewClientForm] = useState(false);
  const [newClientName, setNewClientName] = useState("");
  const [newClientPhone, setNewClientPhone] = useState("");
  const [isCreatingClient, setIsCreatingClient] = useState(false);
  const [showNewPetForm, setShowNewPetForm] = useState(false);
  const [newPetName, setNewPetName] = useState("");
  const [newPetSpecies, setNewPetSpecies] = useState("");
  const [newPetBreed, setNewPetBreed] = useState("");
  const [newPetSize, setNewPetSize] = useState("");
  const [isCreatingPet, setIsCreatingPet] = useState(false);

  useEffect(() => {
    const fetchAppointments = async () => {
      try {
        setEventsLoading(true);
        const list = await appointmentService.listAppointments();
        setEvents(list.map(appointmentToCalendarEvent));
      } catch (error) {
        console.error("Erro ao buscar agendamentos:", error);
        setEvents(initialEventsFallback);
        toast.error(
          "Erro ao carregar agenda",
          "Não foi possível carregar os agendamentos do calendário.",
        );
      } finally {
        setEventsLoading(false);
      }
    };
    fetchAppointments();
  }, [toast]);

  useEffect(() => {
    const fetchClients = async () => {
      try {
        const list = await clientService.listClients();
        setClients(list);
      } catch (error) {
        console.error("Erro ao buscar clientes:", error);
        toast.error(
          "Erro ao carregar clientes",
          "Não foi possível carregar a lista de clientes.",
        );
      }
    };
    fetchClients();
  }, [toast]);

  useEffect(() => {
    const fetchServices = async () => {
      try {
        const list = await serviceService.listServices();
        setServices(list);
      } catch (error) {
        console.error("Erro ao buscar serviços:", error);
        toast.error(
          "Erro ao carregar serviços",
          "Não foi possível carregar os serviços disponíveis.",
        );
      }
    };
    fetchServices();
  }, [toast]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] =
    useState<NewAppointmentForm>(initialFormState);
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(
    null,
  );
  const [availableDates, setAvailableDates] = useState<Set<string>>(
    new Set(),
  );
  const [availableDatesLoading, setAvailableDatesLoading] = useState(false);
  // Cache de datas disponíveis por mês — evita re-fetch ao navegar para meses já visitados
  const availableDatesCache = useRef<Map<string, Set<string>>>(new Map());

  // Only fetch slots when both date AND service are selected
  const {
    slots: availableSlots,
    loading: slotsLoading,
    error: slotsError,
  } = useAvailableScheduleSlots(
    formData.serviceId ? formData.date : "",
    formData.serviceId || undefined,
    isModalOpen,
  );

  const visibleEvents = useMemo(
    () => events.filter((event) => event.status !== "cancelado"),
    [events],
  );

  useEffect(() => {
    const fetchClientPets = async () => {
      if (!formData.clientId) {
        setClientPets([]);
        return;
      }
      try {
        const pets = await clientService.getClientPets(
          formData.clientId,
          petshopId || undefined,
        );
        setClientPets(pets);
      } catch (error) {
        console.error("Erro ao buscar pets do cliente:", error);
        setClientPets([]);
        toast.error(
          "Erro ao carregar pets",
          "Não foi possível carregar os pets do cliente selecionado.",
        );
      }
    };
    fetchClientPets();
  }, [formData.clientId, petshopId, toast]);

  useEffect(() => {
    setFormData((prev) => {
      if (!prev.slotId && !prev.time) return prev;
      const selectedSlot = availableSlots.find(
        (slot) => slot.slot_id === prev.slotId,
      );
      if (!selectedSlot) return { ...prev, slotId: "", time: "" };
      if (prev.time === selectedSlot.time) return prev;
      return { ...prev, time: selectedSlot.time };
    });
  }, [availableSlots]);

  useEffect(() => {
    const yr = currentDate.getFullYear();
    const mo = currentDate.getMonth() + 1;
    const cacheKey = `${yr}-${String(mo).padStart(2, "0")}`;

    const cached = availableDatesCache.current.get(cacheKey);
    if (cached) {
      setAvailableDates(cached);
      return;
    }

    const fetchAvailableDates = async () => {
      setAvailableDatesLoading(true);
      try {
        const result = await appointmentService.getAvailableDates({ year: yr, month: mo });
        const dateSet = new Set(result.dates);
        availableDatesCache.current.set(cacheKey, dateSet);
        setAvailableDates(dateSet);
      } catch {
        setAvailableDates(new Set());
      } finally {
        setAvailableDatesLoading(false);
      }
    };
    fetchAvailableDates();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDate.getFullYear(), currentDate.getMonth()]);

  const month = currentDate.getMonth();
  const year = currentDate.getFullYear();
  const selectedDay = selectedDate?.getDate() ?? 1;

  const weekDays = useMemo(
    () => getWeekDays(year, month, selectedDay),
    [year, month, selectedDay],
  );

  const handlePrev = useCallback(() => {
    if (activeView === "month") {
      setCurrentDate(new Date(year, month - 1, 1));
      setSelectedDate(new Date(year, month - 1, 1));
    } else if (activeView === "week") {
      const newDate = new Date(year, month, selectedDay - 7);
      setCurrentDate(new Date(newDate.getFullYear(), newDate.getMonth(), 1));
      setSelectedDate(newDate);
    } else {
      const newDate = new Date(year, month, selectedDay - 1);
      setCurrentDate(new Date(newDate.getFullYear(), newDate.getMonth(), 1));
      setSelectedDate(newDate);
    }
  }, [activeView, year, month, selectedDay]);

  const handleNext = useCallback(() => {
    if (activeView === "month") {
      setCurrentDate(new Date(year, month + 1, 1));
      setSelectedDate(new Date(year, month + 1, 1));
    } else if (activeView === "week") {
      const newDate = new Date(year, month, selectedDay + 7);
      setCurrentDate(new Date(newDate.getFullYear(), newDate.getMonth(), 1));
      setSelectedDate(newDate);
    } else {
      const newDate = new Date(year, month, selectedDay + 1);
      setCurrentDate(new Date(newDate.getFullYear(), newDate.getMonth(), 1));
      setSelectedDate(newDate);
    }
  }, [activeView, year, month, selectedDay]);

  const handleToday = () => {
    const today = new Date();
    setCurrentDate(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelectedDate(today);
  };

  const handleSelectDate = (date: Date) => {
    setSelectedDate(date);
  };

  const handleDayClick = useCallback((day: number) => {
    setSelectedDate((prev) => {
      const baseDate = prev ?? new Date();
      return new Date(baseDate.getFullYear(), baseDate.getMonth(), day);
    });
  }, []);

  const handleOpenModal = () => {
    if (selectedDate) {
      const isoDate = formatDateKey(selectedDate);
      setFormData({
        ...initialFormState,
        date: dateFromISO(isoDate),
      });
    } else {
      setFormData(initialFormState);
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setFormData(initialFormState);
    setFormErrors({});
    setShowNewClientForm(false);
    setNewClientName("");
    setNewClientPhone("");
    setIsCreatingClient(false);
    setShowNewPetForm(false);
    setNewPetName("");
    setNewPetSpecies("");
    setNewPetBreed("");
    setNewPetSize("");
    setIsCreatingPet(false);
    setClientPets([]);
  };

  const handleCreateClient = async () => {
    const errs: FormErrors = {};
    if (!newClientName.trim()) errs.newClientName = "Nome é obrigatório";
    if (!newClientPhone.trim()) errs.newClientPhone = "Telefone é obrigatório";
    if (Object.keys(errs).length > 0) {
      setFormErrors((prev) => ({ ...prev, ...errs }));
      return;
    }
    if (isCreatingClient) return;
    setIsCreatingClient(true);
    try {
      const newClient = await clientService.createClient({
        name: newClientName,
        phone: newClientPhone,
      });
      setClients((prev) => [...prev, newClient]);
      setFormData((prev) => ({ ...prev, clientId: newClient.id }));
      setShowNewClientForm(false);
      setNewClientName("");
      setNewClientPhone("");
      toast.success(
        "Cliente criado",
        `${newClient.name ?? newClientName} foi cadastrado e selecionado.`,
      );
    } catch (error) {
      console.error("Erro ao criar cliente:", error);
      toast.error(
        "Erro ao criar cliente",
        (error as any)?.response?.data?.detail ||
          (error as any)?.response?.data?.error ||
          "Não foi possível criar o cliente.",
      );
    } finally {
      setIsCreatingClient(false);
    }
  };

  const handleCreatePet = async () => {
    const errs: FormErrors = {};
    if (!newPetName.trim()) errs.newPetName = "Nome do pet é obrigatório";
    if (!newPetSpecies) errs.newPetSpecies = "Espécie é obrigatória";
    if (!newPetSize) errs.newPetSize = "Porte é obrigatório";
    if (Object.keys(errs).length > 0) {
      setFormErrors((prev) => ({ ...prev, ...errs }));
      return;
    }
    if (!formData.clientId || isCreatingPet) return;

    setIsCreatingPet(true);
    try {
      const newPet = await petService.createPet({
        petshop_id: petshopId,
        client_id: formData.clientId,
        name: newPetName,
        species: newPetSpecies,
        breed: newPetBreed || undefined,
        size: normalizePetSize(newPetSize),
      });
      setClientPets((prev) => [...prev, newPet]);
      setFormData((prev) => ({ ...prev, petId: newPet.id }));
      setShowNewPetForm(false);
      setNewPetName("");
      setNewPetSpecies("cachorro");
      setNewPetBreed("");
      setNewPetSize("medio");
      toast.success(
        "Pet criado",
        `${newPet.name ?? newPetName} foi cadastrado e selecionado.`,
      );
    } catch (error) {
      console.error("Erro ao criar pet:", error);
      toast.error(
        "Erro ao criar pet",
        (error as any)?.response?.data?.detail ||
          (error as any)?.response?.data?.error ||
          "Não foi possível criar o pet.",
      );
    } finally {
      setIsCreatingPet(false);
    }
  };

  const handleFormChange = (field: keyof NewAppointmentForm, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleEventClick = (event: CalendarEvent) => {
    setSelectedEvent(event);
    setIsPreviewOpen(true);
  };

  const handleClosePreview = () => {
    setIsPreviewOpen(false);
    setSelectedEvent(null);
  };

  const handleStatusChange = async (
    eventId: string,
    newStatus: "pendente" | "confirmado" | "concluido",
  ) => {
    try {
      if (newStatus === "confirmado") {
        const updated = await appointmentService.confirmAppointment(
          eventId,
          {},
        );
        const nextStatus = normalizeStatus(updated.status);
        setEvents((prev) =>
          prev.map((event) =>
            event.id === eventId ? { ...event, status: nextStatus } : event,
          ),
        );
        toast.success("Status atualizado", "O agendamento foi confirmado.");
      } else {
        const updated = await appointmentService.updateAppointment(eventId, {
          status: appointmentStatusToApi(newStatus),
        });
        const nextStatus = normalizeStatus(updated.status);
        setEvents((prev) =>
          prev.map((event) =>
            event.id === eventId ? { ...event, status: nextStatus } : event,
          ),
        );
        toast.success(
          "Status atualizado",
          "O status do agendamento foi alterado.",
        );
      }
    } catch (error) {
      console.error("Erro ao atualizar status:", error);
      toast.error(
        "Erro ao atualizar status",
        (error as any)?.response?.data?.detail ||
          (error as any)?.response?.data?.error ||
          "Não foi possível atualizar o status do agendamento.",
      );
    }
  };

  const handleSubmit = async () => {
    const errs: FormErrors = {};
    if (!formData.clientId) errs.clientId = "Selecione um cliente";
    if (!formData.petId) errs.petId = "Selecione um pet";
    if (!formData.date) errs.date = "Informe a data";
    if (!formData.serviceId) errs.serviceId = "Selecione um serviço";
    if (!formData.slotId) errs.slotId = "Selecione um horário";

    if (Object.keys(errs).length > 0) {
      setFormErrors(errs);
      return;
    }

    const dateISO = dateToISO(formData.date);
    if (!dateISO) {
      setFormErrors((prev) => ({ ...prev, date: "Data inválida" }));
      return;
    }

    const selectedSlot = availableSlots.find(
      (slot) => slot.slot_id === formData.slotId,
    );
    if (!selectedSlot) {
      setFormErrors((prev) => ({
        ...prev,
        slotId: "Horário indisponível, selecione outro",
      }));
      return;
    }

    setIsSubmitting(true);

    try {
      const selectedService = services.find((s) => String(s.id) === formData.serviceId);
      const selectedPet = clientPets.find((p) => p.id === formData.petId);
      const scheduledAt = `${dateISO}T${selectedSlot.time}:00`;

      const appointment = await appointmentService.scheduleAppointment({
        client_id: formData.clientId,
        pet_id: formData.petId,
        service_id: formData.serviceId,
        slot_id: selectedSlot.slot_id,
        scheduled_at: scheduledAt,
        status: appointmentStatusToApi(normalizeStatus(formData.status)),
        notes: formData.notes || undefined,
        payment_method: "manual",
        origin_channel: "dashboard",
        pet_name: selectedPet?.name ?? undefined,
        pet_species: selectedPet?.species ?? undefined,
        pet_breed: selectedPet?.breed ?? undefined,
        pet_size: selectedPet?.size ?? undefined,
        pet_age: selectedPet?.age?.toString() ?? undefined,
      });

      const newEvent: CalendarEvent = {
        id: appointment.id,
        petName: selectedPet?.name || "Pet",
        petInitials: getInitials(selectedPet?.name || "Pet"),
        type: selectedService?.name || "Serviço",
        time: selectedSlot.time,
        date: dateISO,
        status: normalizeStatus(formData.status),
      };

      setEvents((prev) => [...prev, newEvent]);
      handleCloseModal();

      const [y, m, d] = dateISO.split("-").map(Number);
      // Invalida cache do mês para forçar re-fetch das datas disponíveis
      const cacheKey = `${y}-${String(m).padStart(2, "0")}`;
      availableDatesCache.current.delete(cacheKey);
      setCurrentDate(new Date(y, m - 1, 1));
      setSelectedDate(new Date(y, m - 1, d));
      toast.success(
        "Agendamento criado",
        `${selectedPet?.name ?? "O pet"} foi agendado para ${selectedSlot.time}.`,
      );
    } catch (error) {
      console.error("Erro ao criar agendamento:", error);
      toast.error(
        "Erro ao criar agendamento",
        (error as any)?.response?.data?.detail ||
          (error as any)?.response?.data?.error ||
          "Não foi possível criar o agendamento.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const stats = useMemo(
    () => ({
      concluidos: visibleEvents.filter((e) => e.status === "concluido").length,
      confirmados: visibleEvents.filter((e) => e.status === "confirmado")
        .length,
      pendentes: visibleEvents.filter((e) => e.status === "pendente").length,
    }),
    [visibleEvents],
  );

  const dayAppointments = useMemo(() => {
    if (!selectedDate) return [];
    const dateKey = formatDateKey(selectedDate);
    return visibleEvents
      .filter((e) => e.date === dateKey)
      .map((e) => ({
        id: e.id,
        initials: e.petInitials,
        name: e.petName,
        service: e.type,
        time: e.time,
        status: e.status,
      }));
  }, [selectedDate, visibleEvents]);

  const weekAppointments = useMemo(() => {
    const weekFullDates = weekDays.map((d) => d.fullDate);
    return visibleEvents
      .filter((e) => {
        const eventDate = new Date(e.date);
        const formatted = formatDateBR(eventDate);
        return weekFullDates.includes(formatted);
      })
      .map((e) => {
        const eventDate = new Date(e.date);
        return {
          id: e.id,
          initials: e.petInitials,
          name: e.petName,
          service: e.type,
          date: formatDateBR(eventDate),
          time: e.time,
          status: e.status,
        };
      });
  }, [weekDays, visibleEvents]);

  return (
    <DashboardLayout>
      <div className="flex min-h-0 flex-1 flex-col">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-2xl border border-[#727B8E]/10 bg-white p-4 shadow-lg dark:border-[#40485A] dark:bg-[#1A1B1D] sm:p-6"
        >
          <CalendarHeader
            currentDate={currentDate}
            onPrevMonth={handlePrev}
            onNextMonth={handleNext}
            onToday={handleToday}
            activeView={activeView}
            onViewChange={setActiveView}
            stats={stats}
          />

          <div className="mt-4 flex min-h-0 flex-1 flex-col gap-4 lg:flex-row lg:gap-0">
            {eventsLoading ? (
              <div className="flex min-h-0 flex-1 items-center justify-center rounded-xl border border-[rgba(114,123,142,0.1)] bg-white dark:border-[#40485A] dark:bg-[#1A1B1D]">
                <div className="flex flex-col items-center gap-3 text-sm text-[#727B8E] dark:text-[#8a94a6]">
                  <Loader2 className="h-8 w-8 animate-spin text-[#1E62EC] dark:text-[#2172e5]" />
                  <span>Carregando agendamentos...</span>
                </div>
              </div>
            ) : (
              <>
                <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-auto overflow-y-hidden rounded-xl border border-[rgba(114,123,142,0.1)] bg-white dark:border-[#40485A] dark:bg-[#1A1B1D] lg:rounded-bl-xl lg:rounded-br-none">
                  {activeView === "month" && (
                    <CalendarGrid
                      currentDate={currentDate}
                      events={visibleEvents}
                      selectedDate={selectedDate}
                      onSelectDate={handleSelectDate}
                      availableDates={
                        availableDatesLoading ? undefined : availableDates
                      }
                    />
                  )}
                  {activeView === "week" && (
                    <CalendarWeekView
                      weekDays={weekDays}
                      appointments={weekAppointments}
                      onDayClick={handleDayClick}
                      selectedDay={selectedDay}
                    />
                  )}
                  {activeView === "day" && (
                    <CalendarDayView
                      appointments={dayAppointments}
                      selectedDate={formatDateLabel(year, month, selectedDay)}
                    />
                  )}
                </div>

                <CalendarSidebar
                  selectedDate={selectedDate}
                  events={events}
                  onNewClick={handleOpenModal}
                  onEventClick={handleEventClick}
                  onStatusChange={handleStatusChange}
                />
              </>
            )}
          </div>
        </motion.div>
      </div>

      <Modal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        title="Novo agendamento"
        onSubmit={handleSubmit}
        submitText="Agendar"
        cancelText="Cancelar"
        isLoading={isSubmitting}
        className="max-w-[480px]"
      >
        <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto pr-1">
          {/* Cliente */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold text-[#434A57] dark:text-[#f5f9fc]">
                Cliente <span className="text-red-500">*</span>
              </p>
              <button
                type="button"
                disabled={isCreatingClient}
                onClick={() => {
                  setShowNewClientForm(!showNewClientForm);
                  setFormErrors((prev) => ({ ...prev, newClientName: undefined, newClientPhone: undefined }));
                }}
                className="flex items-center gap-1 text-xs font-medium text-[#1E62EC] hover:underline dark:text-[#2172e5]"
              >
                <UserPlus className="h-3.5 w-3.5" />
                {showNewClientForm ? "Cancelar" : "Novo Cliente"}
              </button>
            </div>
            {showNewClientForm ? (
              <div className="space-y-3 rounded-lg border border-[#727B8E]/20 bg-[#F4F6F9] p-3 dark:border-[#40485A] dark:bg-[#212225]">
                <div>
                  <Input
                    label="Nome do Cliente *"
                    placeholder="Nome completo"
                    value={newClientName}
                    onChange={(e) => {
                      setNewClientName(e.target.value);
                      if (e.target.value) setFormErrors((prev) => ({ ...prev, newClientName: undefined }));
                    }}
                  />
                  {formErrors.newClientName && (
                    <p className="mt-1 text-xs text-red-500">{formErrors.newClientName}</p>
                  )}
                </div>
                <div>
                  <Input
                    label="Telefone *"
                    placeholder="(11) 99999-9999"
                    value={newClientPhone}
                    onChange={(e) => {
                      setNewClientPhone(maskPhone(e.target.value));
                      if (e.target.value) setFormErrors((prev) => ({ ...prev, newClientPhone: undefined }));
                    }}
                  />
                  {formErrors.newClientPhone && (
                    <p className="mt-1 text-xs text-red-500">{formErrors.newClientPhone}</p>
                  )}
                </div>
                <button
                  type="button"
                  disabled={isCreatingClient}
                  onClick={handleCreateClient}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#0e1629] py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-[#2172e5]"
                >
                  {isCreatingClient ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Criando Cliente...
                    </>
                  ) : (
                    <>
                      <Plus className="h-4 w-4" />
                      Criar Cliente
                    </>
                  )}
                </button>
              </div>
            ) : (
              <div>
                <Select
                  placeholder="Selecione o cliente"
                  value={formData.clientId}
                  onChange={(e) => {
                    setFormErrors((prev) => ({ ...prev, clientId: undefined }));
                    handleFormChange("clientId", e.target.value);
                    handleFormChange("petId", "");
                  }}
                  options={clients.map((c) => ({
                    value: c.id,
                    label: c.name ?? "",
                  }))}
                />
                {formErrors.clientId && (
                  <p className="mt-1 text-xs text-red-500">{formErrors.clientId}</p>
                )}
              </div>
            )}
          </div>

          {/* Pet */}
          {formData.clientId && !showNewClientForm && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-semibold text-[#434A57] dark:text-[#f5f9fc]">
                  Pet <span className="text-red-500">*</span>
                </p>
                <button
                  type="button"
                  disabled={isCreatingPet}
                  onClick={() => {
                    setShowNewPetForm(!showNewPetForm);
                    setFormErrors((prev) => ({ ...prev, newPetName: undefined, newPetSpecies: undefined, newPetSize: undefined }));
                  }}
                  className="flex items-center gap-1 text-xs font-medium text-[#1E62EC] hover:underline dark:text-[#2172e5]"
                >
                  <PawPrint className="h-3.5 w-3.5" />
                  {showNewPetForm ? "Cancelar" : "Novo Pet"}
                </button>
              </div>
              {showNewPetForm ? (
                <div className="space-y-3 rounded-lg border border-[#727B8E]/20 bg-[#F4F6F9] p-3 dark:border-[#40485A] dark:bg-[#212225]">
                  <div>
                    <Input
                      label="Nome do Pet *"
                      placeholder="Nome do pet"
                      value={newPetName}
                      onChange={(e) => {
                        setNewPetName(e.target.value);
                        if (e.target.value) setFormErrors((prev) => ({ ...prev, newPetName: undefined }));
                      }}
                    />
                    {formErrors.newPetName && (
                      <p className="mt-1 text-xs text-red-500">{formErrors.newPetName}</p>
                    )}
                  </div>
                  <div>
                    <Select
                      label="Espécie *"
                      placeholder="Selecione a espécie"
                      value={newPetSpecies}
                      onChange={(e) => {
                        setNewPetSpecies(e.target.value);
                        if (e.target.value) setFormErrors((prev) => ({ ...prev, newPetSpecies: undefined }));
                      }}
                      options={[
                        { value: "", label: "Selecione a espécie" },
                        { value: "cachorro", label: "Cachorro" },
                        { value: "gato", label: "Gato" },
                        { value: "ave", label: "Ave" },
                        { value: "roedor", label: "Roedor" },
                        { value: "outro", label: "Outro" },
                      ]}
                    />
                    {formErrors.newPetSpecies && (
                      <p className="mt-1 text-xs text-red-500">{formErrors.newPetSpecies}</p>
                    )}
                  </div>
                  <Input
                    label="Raça"
                    placeholder="Raça do pet"
                    value={newPetBreed}
                    onChange={(e) => setNewPetBreed(e.target.value)}
                  />
                  <div>
                    <Select
                      label="Porte *"
                      placeholder="Selecione o porte"
                      value={newPetSize}
                      onChange={(e) => {
                        setNewPetSize(e.target.value);
                        if (e.target.value) setFormErrors((prev) => ({ ...prev, newPetSize: undefined }));
                      }}
                      options={[...PET_SIZE_OPTIONS_WITH_PLACEHOLDER]}
                    />
                    {formErrors.newPetSize && (
                      <p className="mt-1 text-xs text-red-500">{formErrors.newPetSize}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={isCreatingPet}
                    onClick={handleCreatePet}
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#0e1629] py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-[#2172e5]"
                  >
                    {isCreatingPet ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Criando Pet...
                      </>
                    ) : (
                      <>
                        <Plus className="h-4 w-4" />
                        Criar Pet
                      </>
                    )}
                  </button>
                </div>
              ) : (
                <div>
                  <Select
                    placeholder="Selecione o pet"
                    value={formData.petId}
                    onChange={(e) => {
                      setFormErrors((prev) => ({ ...prev, petId: undefined }));
                      handleFormChange("petId", e.target.value);
                    }}
                    options={clientPets.map((p) => ({
                      value: p.id,
                      label: `${p.name ?? "Pet"} (${p.species ?? "Pet"})`,
                    }))}
                  />
                  {formErrors.petId && (
                    <p className="mt-1 text-xs text-red-500">{formErrors.petId}</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Data e Serviço */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Input
                label="Data *"
                placeholder="DD/MM/AAAA"
                value={formData.date}
                onChange={(e) => {
                  const nextDate = maskDate(e.target.value);
                  setFormErrors((prev) => ({ ...prev, date: undefined, slotId: undefined }));
                  setFormData((prev) => ({
                    ...prev,
                    date: nextDate,
                    time: "",
                    slotId: "",
                  }));
                }}
                maxLength={10}
              />
              {formErrors.date && (
                <p className="mt-1 text-xs text-red-500">{formErrors.date}</p>
              )}
            </div>
            <div>
              <Select
                label="Serviço *"
                placeholder="Selecione o serviço"
                options={services.map((s) => ({
                  value: String(s.id),
                  label: s.name ?? "",
                }))}
                value={formData.serviceId}
                onChange={(e) => {
                  setFormErrors((prev) => ({ ...prev, serviceId: undefined, slotId: undefined }));
                  setFormData((prev) => ({
                    ...prev,
                    serviceId: e.target.value,
                    slotId: "",
                    time: "",
                  }));
                }}
              />
              {formErrors.serviceId && (
                <p className="mt-1 text-xs text-red-500">{formErrors.serviceId}</p>
              )}
            </div>
          </div>

          {/* Horários — só aparecem quando data E serviço estão preenchidos */}
          {formData.date && formData.serviceId && (
            <div>
              {slotsLoading ? (
                <div className="flex items-center gap-2 rounded-lg border border-[#727B8E]/20 bg-[#F4F6F9] p-3 dark:border-[#40485A] dark:bg-[#212225]">
                  <Loader2 className="h-4 w-4 animate-spin text-[#1E62EC]" />
                  <span className="text-sm text-[#727B8E]">Buscando horários disponíveis...</span>
                </div>
              ) : availableSlots.length === 0 ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800/40 dark:bg-amber-900/20">
                  <p className="text-sm text-amber-700 dark:text-amber-400">
                    Nenhum horário disponível para esta data e serviço.
                  </p>
                </div>
              ) : (
                <div>
                  <p className="mb-2 text-sm font-semibold text-[#434A57] dark:text-[#f5f9fc]">
                    Horário disponível <span className="text-red-500">*</span>
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {availableSlots.map((slot) => (
                      <button
                        key={slot.slot_id}
                        type="button"
                        onClick={() => {
                          setFormErrors((prev) => ({ ...prev, slotId: undefined }));
                          setFormData((prev) => ({
                            ...prev,
                            slotId: slot.slot_id ?? "",
                            time: slot.time,
                          }));
                        }}
                        className={`flex flex-col items-center rounded-lg border px-2 py-2 text-sm transition-all ${
                          formData.slotId === slot.slot_id
                            ? "border-[#1E62EC] bg-[#1E62EC]/10 text-[#1E62EC] dark:border-[#2172e5] dark:bg-[#2172e5]/20 dark:text-[#2172e5]"
                            : "border-[#727B8E]/20 bg-white text-[#434A57] hover:border-[#1E62EC]/40 hover:bg-[#1E62EC]/5 dark:border-[#40485A] dark:bg-[#212225] dark:text-[#f5f9fc]"
                        }`}
                      >
                        <span className="font-semibold">{slot.time}</span>
                        <span className="text-[10px] opacity-70">
                          {slot.remaining_capacity === 1
                            ? "1 vaga"
                            : `${slot.remaining_capacity} vagas`}
                        </span>
                      </button>
                    ))}
                  </div>
                  {formErrors.slotId && (
                    <p className="mt-1 text-xs text-red-500">{formErrors.slotId}</p>
                  )}
                </div>
              )}
              {slotsError && (
                <p className="mt-1 text-xs text-red-500 dark:text-red-400">{slotsError}</p>
              )}
            </div>
          )}

          {/* Status */}
          <Select
            label="Status"
            placeholder="Status"
            options={STATUS_OPTIONS}
            value={formData.status}
            onChange={(e) => handleFormChange("status", e.target.value)}
          />

          {/* Observações */}
          <div className="flex flex-col gap-3">
            <label className="font-be-vietnam-pro text-base font-semibold leading-[23px] text-[#434A57] dark:text-[#f5f9fc]">
              Observações
            </label>
            <TextArea
              placeholder="Observações sobre o agendamento..."
              rows={3}
              value={formData.notes}
              onChange={(e) => handleFormChange("notes", e.target.value)}
            />
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={isPreviewOpen}
        onClose={handleClosePreview}
        title="Detalhes do agendamento"
        className="max-w-[400px]"
      >
        {selectedEvent && (
          <div className="flex flex-col gap-5">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full bg-[#F4F6F9] dark:bg-[#212225] text-base font-bold text-[#727B8E] dark:text-[#8a94a6]">
                {selectedEvent.petInitials}
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-[#434A57] dark:text-[#f5f9fc]">
                  {selectedEvent.petName}
                </h3>
                <span
                  className={`inline-flex items-center justify-center rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.09em] ${
                    selectedEvent.status === "concluido"
                      ? "border-[rgba(60,208,87,0.36)] bg-[#D4F3D6] text-[#3CD057]"
                      : selectedEvent.status === "cancelado"
                        ? "border-[rgba(239,68,68,0.36)] bg-[#FEE2E2] text-[#EF4444]"
                        : selectedEvent.status === "confirmado"
                          ? "border-[rgba(60,107,208,0.36)] bg-[#D4E2F3] text-[#3C6BD0]"
                          : "border-[rgba(208,179,60,0.36)] bg-[#F3F2D4] text-[#D0B33C]"
                  }`}
                >
                  {selectedEvent.status === "concluido"
                    ? "Concluído"
                    : selectedEvent.status === "cancelado"
                      ? "Cancelado"
                      : selectedEvent.status === "confirmado"
                        ? "Confirmado"
                        : "Pendente"}
                </span>
              </div>
            </div>

            <div className="space-y-3 rounded-lg bg-[#F4F6F9] dark:bg-[#212225] p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-[#727B8E] dark:text-[#8a94a6]">
                  Serviço
                </span>
                <span className="text-sm font-medium text-[#434A57] dark:text-[#f5f9fc]">
                  {selectedEvent.type}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-[#727B8E] dark:text-[#8a94a6]">
                  Data
                </span>
                <span className="text-sm font-medium text-[#434A57] dark:text-[#f5f9fc]">
                  {(() => {
                    const [y, m, d] = selectedEvent.date.split("-").map(Number);
                    return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
                  })()}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-[#727B8E] dark:text-[#8a94a6]">
                  Horário
                </span>
                <span className="text-sm font-medium text-[#434A57] dark:text-[#f5f9fc]">
                  {selectedEvent.time}
                </span>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </DashboardLayout>
  );
}
