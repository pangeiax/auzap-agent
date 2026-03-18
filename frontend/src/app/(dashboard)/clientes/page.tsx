import { useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Plus,
  Phone,
  Mail,
  MoreVertical,
  MessageCircle,
  Trash2,
  Edit,
  PawPrint,
  Calendar,
  ArrowLeft,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { normalizePetSize, petSizeAbbrev, PET_SIZE_OPTIONS_WITH_PLACEHOLDER } from "@/lib/petSize";
import { formatPhoneForDisplay, maskPhone, maskDate } from "@/lib/masks";
import { useAddressByCep, useAvailableScheduleSlots, useToast } from "@/hooks";
import { useAuthContext } from "@/contexts";
import { appointmentService, clientService, petService } from "@/services";
import { appointmentStatusFromApi } from "@/lib/appointmentStatus";
import type {
  Appointment as ApiAppointment,
  Client,
  Pet as PetType,
} from "@/types";

import { DashboardLayout } from "@/components/templates/DashboardLayout";
import { EmptyState } from "@/components/molecules/EmptyState";
import { Modal } from "@/components/molecules/Modal";
import { Input } from "@/components/atoms/Input";
import { TextArea } from "@/components/atoms/TextArea";
import { TextAreaField } from "@/components/molecules/TextAreaField";
import { Button } from "@/components/atoms/Button";
import { Select } from "@/components/atoms/Select";

interface Pet {
  id: string;
  customerId: string;
  name: string;
  species: "cachorro" | "gato" | "ave" | "roedor" | "outro";
  breed: string;
  age: string;
  weight: string;
  size: string;
  color: string;
  notes: string;
}

interface Appointment {
  id: string;
  customerId: string;
  petId: string;
  scheduleId?: string;
  petName: string;
  date: string;
  time: string;
  service: string;
  status: "confirmado" | "pendente" | "cancelado" | "concluido";
  notes: string;
}

interface ConversationHistory {
  id: string;
  date: string;
  preview: string;
  messageCount: number;
  channel: "whatsapp" | "email" | "telefone";
}

interface Customer {
  id: string;
  name: string;
  email: string;
  phone: string;
  status: "ativo" | "inativo";
  address?: string;
  notes?: string;
  petsCount: number;
  totalAppointments: number;
  lastVisit: string;
  pets: Pet[];
  appointments: Appointment[];
  conversations: ConversationHistory[];
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((word) => word[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function getSpeciesEmoji(species: Pet["species"]) {
  switch (species) {
    case "cachorro":
      return "🐕";
    case "gato":
      return "🐱";
    case "ave":
      return "🐦";
    case "roedor":
      return "🐹";
    default:
      return "🐾";
  }
}

function getStatusBadgeStyle(status: Appointment["status"]) {
  const styles = {
    confirmado: "bg-[#1E62EC]/20 text-[#1E62EC] border-[#1E62EC]/30",
    pendente: "bg-[#F59E0B]/20 text-[#F59E0B] border-[#F59E0B]/30",
    cancelado: "bg-red-500/20 text-red-500 border-red-500/30",
    concluido: "bg-[#3DCA21]/20 text-[#3DCA21] border-[#3DCA21]/30",
  };
  return styles[status];
}

function getChannelIcon(channel: ConversationHistory["channel"]) {
  switch (channel) {
    case "whatsapp":
      return <MessageCircle className="h-4 w-4 text-[#25D366]" />;
    case "email":
      return <Mail className="h-4 w-4 text-[#1E62EC]" />;
    case "telefone":
      return <Phone className="h-4 w-4 text-[#9333EA]" />;
  }
}

function ClientsSidebar({
  customers,
  selectedId,
  onSelect,
  searchQuery,
  onSearchChange,
  onNewCustomer,
  loading,
  error,
}: {
  customers: Customer[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onNewCustomer: () => void;
  loading?: boolean;
  error?: string | null;
}) {
  const filteredCustomers = customers.filter(
    (customer) =>
      customer.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      customer.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      customer.phone.includes(searchQuery),
  );

  return (
    <div className="flex h-full flex-col">
      <div className="p-4 border-b border-[#727B8E]/10 dark:border-[#40485A]">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-[#434A57] dark:text-[#f5f9fc]">
            Clientes
          </h2>
          <button
            type="button"
            onClick={onNewCustomer}
            className="flex h-8 w-8 items-center justify-center rounded-full text-[#727B8E] transition-colors hover:bg-[#F4F6F9] dark:text-[#8a94a6] dark:hover:bg-[#212225]"
          >
            <Plus className="h-5 w-5" />
          </button>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#727B8E] dark:text-[#8a94a6]" />
          <input
            type="text"
            placeholder="Buscar clientes..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full rounded-lg bg-[#F4F6F9] dark:bg-[#212225] border-none pl-10 pr-4 py-2.5 text-sm text-[#434A57] dark:text-[#f5f9fc] placeholder:text-[#727B8E] dark:placeholder:text-[#8a94a6] outline-none focus:ring-2 focus:ring-[#1E62EC]/20"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex h-32 items-center justify-center p-4">
            <Loader2 className="h-8 w-8 animate-spin text-[#1E62EC]" />
          </div>
        ) : error ? (
          <div className="flex flex-col h-full items-center justify-center gap-3 p-4 text-center">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            <Button size="sm" variant="outline" onClick={onNewCustomer}>
              Novo Cliente
            </Button>
          </div>
        ) : filteredCustomers.length === 0 ? (
          <div className="flex h-full items-center justify-center p-4">
            <EmptyState
              image="not_found_clientes_ativos"
              description="Nenhum cliente encontrado."
              buttonText="Novo Cliente"
              buttonIcon={<Plus className="h-4 w-4" />}
              onButtonClick={onNewCustomer}
            />
          </div>
        ) : (
          filteredCustomers.map((customer) => (
            <motion.button
              key={customer.id}
              type="button"
              onClick={() => onSelect(customer.id)}
              whileHover={{ backgroundColor: "rgba(244, 246, 249, 0.5)" }}
              className={`w-full p-4 text-left border-b border-[#727B8E]/5 dark:border-[#40485A]/50 transition-colors ${
                selectedId === customer.id
                  ? "bg-[#F4F6F9] dark:bg-[#212225]"
                  : ""
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#1E62EC]/20">
                  <span className="text-sm font-medium text-[#1E62EC]">
                    {getInitials(customer.name)}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-[#434A57] dark:text-[#f5f9fc]">
                      {customer.name}
                    </span>
                    <span
                      className={`shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full border ${
                        customer.status === "ativo"
                          ? "bg-[#3DCA21]/20 text-[#3DCA21] border-[#3DCA21]/30"
                          : "bg-[#727B8E]/20 text-[#727B8E] border-[#727B8E]/30"
                      }`}
                    >
                      {customer.status}
                    </span>
                  </div>
                  <p className="text-xs text-[#727B8E] dark:text-[#8a94a6] mt-1">
                    {customer.petsCount} pet
                    {customer.petsCount !== 1 ? "s" : ""} • {customer.phone}
                  </p>
                  <p className="text-xs text-[#727B8E] dark:text-[#8a94a6] mt-0.5">
                    {customer.totalAppointments} agendamentos
                  </p>
                </div>
              </div>
            </motion.button>
          ))
        )}
      </div>
    </div>
  );
}

interface PetFormData {
  name: string;
  species: string;
  breed: string;
  age: string;
  weight: string;
  size: string;
  color: string;
  notes: string;
}

const emptyPetForm: PetFormData = {
  name: "",
  species: "",
  breed: "",
  age: "",
  weight: "",
  size: "",
  color: "",
  notes: "",
};

function CustomerDetails({
  customer,
  onBack,
  onEditCustomer,
  onDeleteCustomer,
  onDeletePet,
  onDeleteAppointment,
  onSavePet,
  onSaveAppointment,
  onOpenConversation,
  activeTab,
  onTabChange,
  loadingPets,
  loadingAppointments,
  loadingConversations,
}: {
  customer: Customer | null;
  onBack: () => void;
  onEditCustomer: () => void;
  onDeleteCustomer: (id: string) => void;
  onDeletePet: (petId: string) => void;
  onDeleteAppointment: (appointmentId: string) => void;
  onSavePet: (
    pet: Omit<Pet, "id" | "customerId">,
    petId?: string,
  ) => Promise<void>;
  onSaveAppointment: (
    appointment: Omit<Appointment, "id" | "customerId">,
    appointmentId?: string,
  ) => void;
  onOpenConversation: (conversationId: string) => void;
  activeTab: "pets" | "agendamentos" | "conversas";
  onTabChange: (tab: "pets" | "agendamentos" | "conversas") => void;
  loadingPets?: boolean;
  loadingAppointments?: boolean;
  loadingConversations?: boolean;
}) {
  const [petModalOpen, setPetModalOpen] = useState(false);
  const [editingPet, setEditingPet] = useState<Pet | null>(null);
  const [petForm, setPetForm] = useState<PetFormData>(emptyPetForm);
  const [petFormErrors, setPetFormErrors] = useState<{
    name?: string;
    species?: string;
    size?: string;
  }>({});
  const [savingPet, setSavingPet] = useState(false);
  const [appointmentModalOpen, setAppointmentModalOpen] = useState(false);
  const [editingAppointment, setEditingAppointment] =
    useState<Appointment | null>(null);
  const [appointmentForm, setAppointmentForm] = useState({
    petId: "",
    scheduleId: "",
    petName: "",
    date: "",
    time: "",
    service: "",
    status: "pendente" as Appointment["status"],
    notes: "",
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const {
    slots: appointmentSlots,
    loading: appointmentSlotsLoading,
    error: appointmentSlotsError,
  } = useAvailableScheduleSlots(
    appointmentForm.date,
    appointmentModalOpen && Boolean(customer),
  );

  const hasCustomSelectedTime =
    Boolean(appointmentForm.time) &&
    !appointmentSlots.some((slot) => slot.time === appointmentForm.time);
  const appointmentTimeOptions = [
    ...(hasCustomSelectedTime
      ? [
          {
            value: appointmentForm.time,
            label: `${appointmentForm.time} • horário atual`,
          },
        ]
      : []),
    ...appointmentSlots.map((slot) => ({
      value: String(slot.schedule_id),
      label:
        slot.remaining_capacity === 1
          ? `${slot.time} • 1 vaga`
          : `${slot.time} • ${slot.remaining_capacity} vagas`,
    })),
  ];
  const appointmentTimeValue = hasCustomSelectedTime
    ? appointmentForm.time
    : appointmentForm.scheduleId;

  if (!customer) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="hidden lg:flex flex-1 items-center justify-center"
      >
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#1E62EC]/10">
            <PawPrint className="h-8 w-8 text-[#1E62EC]" />
          </div>
          <h2 className="text-xl font-medium text-[#434A57] dark:text-[#f5f9fc] mb-2">
            Gestão de Clientes
          </h2>
          <p className="text-[#727B8E] dark:text-[#8a94a6] mb-4">
            Selecione um cliente para ver detalhes
          </p>
        </div>
      </motion.div>
    );
  }

  const handleOpenPetModal = (pet?: Pet) => {
    setEditingPet(pet || null);
    if (pet) {
      setPetForm({
        name: pet.name,
        species: pet.species,
        breed: pet.breed,
        age: pet.age,
        weight: pet.weight,
        size: normalizePetSize(pet.size) ?? "",
        color: pet.color,
        notes: pet.notes,
      });
    } else {
      setPetForm(emptyPetForm);
    }
    setPetModalOpen(true);
  };

  const handleSavePet = async () => {
    const errs: { name?: string; species?: string; size?: string } = {};
    if (!petForm.name.trim()) errs.name = "Nome é obrigatório";
    if (!petForm.species) errs.species = "Espécie é obrigatória";
    if (!petForm.size) errs.size = "Porte é obrigatório";
    if (Object.keys(errs).length > 0) {
      setPetFormErrors(errs);
      return;
    }
    setPetFormErrors({});

    setSavingPet(true);
    try {
      await onSavePet(petForm as Omit<Pet, "id" | "customerId">, editingPet?.id);
      setPetModalOpen(false);
      setPetForm(emptyPetForm);
      setEditingPet(null);
    } catch {
      // The parent already handles user-facing feedback.
    } finally {
      setSavingPet(false);
    }
  };

  const handleOpenAppointmentModal = (appointment?: Appointment) => {
    setEditingAppointment(appointment || null);
    if (appointment) {
      setAppointmentForm({
        petId: appointment.petId,
        scheduleId: appointment.scheduleId || "",
        petName: appointment.petName,
        date: appointment.date,
        time: appointment.time,
        service: appointment.service,
        status: appointment.status,
        notes: appointment.notes,
      });
    } else {
      setAppointmentForm({
        petId: customer?.pets[0]?.id || "",
        scheduleId: "",
        petName: customer?.pets[0]?.name || "",
        date: "",
        time: "",
        service: "",
        status: "pendente",
        notes: "",
      });
    }
    setAppointmentModalOpen(true);
  };

  const handleSaveAppointment = () => {
    if (
      !appointmentForm.service.trim() ||
      !appointmentForm.petId ||
      !appointmentForm.date ||
      !appointmentForm.time
    ) {
      return;
    }

    onSaveAppointment(appointmentForm, editingAppointment?.id);
    setAppointmentModalOpen(false);
    setEditingAppointment(null);
  };

  return (
    <motion.div
      key={customer.id}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex flex-1 flex-col min-h-0"
    >
      <div className="p-4 border-b border-[#727B8E]/10 dark:border-[#40485A]">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="lg:hidden flex h-10 w-10 items-center justify-center rounded-full text-[#727B8E] hover:bg-[#F4F6F9] dark:hover:bg-[#212225]"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#1E62EC]/20">
            <span className="text-sm font-medium text-[#1E62EC]">
              {getInitials(customer.name)}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-medium text-[#434A57] dark:text-[#f5f9fc]">
              {customer.name}
            </h2>
            <div className="flex items-center gap-3 text-sm text-[#727B8E] dark:text-[#8a94a6]">
              <span className="flex items-center gap-1">
                <Phone className="h-3 w-3" />
                {customer.phone}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onEditCustomer}
              className="flex h-10 w-10 items-center justify-center rounded-full text-[#727B8E] hover:bg-[#F4F6F9] dark:hover:bg-[#212225]"
            >
              <Edit className="h-5 w-5" />
            </button>
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen(!menuOpen)}
                className="flex h-10 w-10 items-center justify-center rounded-full text-[#727B8E] hover:bg-[#F4F6F9] dark:hover:bg-[#212225]"
              >
                <MoreVertical className="h-5 w-5" />
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-full mt-1 w-48 rounded-lg border border-[#727B8E]/10 dark:border-[#40485A] bg-white dark:bg-[#1A1B1D] shadow-lg z-10">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-[#434A57] dark:text-[#f5f9fc] hover:bg-[#F4F6F9] dark:hover:bg-[#212225]"
                    onClick={() => {
                      setMenuOpen(false);
                      if (customer.conversations[0]?.id) {
                        onOpenConversation(customer.conversations[0].id);
                        return;
                      }

                      onTabChange("conversas");
                    }}
                  >
                    <MessageCircle className="h-4 w-4" />
                    Abrir conversa
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-red-500 hover:bg-[#F4F6F9] dark:hover:bg-[#212225]"
                    onClick={() => {
                      void onDeleteCustomer(customer.id);
                      setMenuOpen(false);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                    Excluir cliente
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex gap-1 mx-4 mt-4 p-1 bg-[#F4F6F9] dark:bg-[#212225] rounded-lg">
          <button
            type="button"
            onClick={() => onTabChange("pets")}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === "pets"
                ? "bg-white dark:bg-[#1A1B1D] text-[#434A57] dark:text-[#f5f9fc] shadow-sm"
                : "text-[#727B8E] dark:text-[#8a94a6]"
            }`}
          >
            <PawPrint className="h-4 w-4" />
            Pets ({customer.petsCount})
          </button>
          <button
            type="button"
            onClick={() => onTabChange("agendamentos")}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === "agendamentos"
                ? "bg-white dark:bg-[#1A1B1D] text-[#434A57] dark:text-[#f5f9fc] shadow-sm"
                : "text-[#727B8E] dark:text-[#8a94a6]"
            }`}
          >
            <Calendar className="h-4 w-4" />
            Agendamentos
          </button>
          <button
            type="button"
            onClick={() => onTabChange("conversas")}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === "conversas"
                ? "bg-white dark:bg-[#1A1B1D] text-[#434A57] dark:text-[#f5f9fc] shadow-sm"
                : "text-[#727B8E] dark:text-[#8a94a6]"
            }`}
          >
            <MessageCircle className="h-4 w-4" />
            Conversas
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === "pets" && (
            <div>
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-sm font-medium text-[#727B8E] dark:text-[#8a94a6]">
                  Pets cadastrados
                </h3>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleOpenPetModal()}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Novo Pet
                </Button>
              </div>
              {loadingPets ? (
                <div className="flex h-32 items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-[#1E62EC]" />
                </div>
              ) : (
                <div className="space-y-3">
                  {customer.pets.map((pet) => (
                    <motion.div
                      key={pet.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="p-4 bg-[#F4F6F9]/50 dark:bg-[#212225]/50 rounded-xl border border-[#727B8E]/10 dark:border-[#40485A]"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-12 h-12 rounded-full bg-[#1E62EC]/20 flex items-center justify-center text-2xl">
                            {getSpeciesEmoji(pet.species)}
                          </div>
                          <div>
                            <p className="font-medium text-[#434A57] dark:text-[#f5f9fc]">
                              {pet.name}
                            </p>
                            <p className="text-sm text-[#727B8E] dark:text-[#8a94a6]">
                              {pet.breed} • {pet.age} • {pet.weight} • Porte{" "}
                              {petSizeAbbrev(pet.size)}
                            </p>
                            {pet.notes && (
                              <p className="text-xs text-[#727B8E] dark:text-[#8a94a6] mt-1">
                                {pet.notes}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleOpenPetModal(pet)}
                            className="flex h-8 w-8 items-center justify-center rounded-full text-[#727B8E] hover:bg-[#F4F6F9] dark:hover:bg-[#212225]"
                          >
                            <Edit className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void onDeletePet(pet.id)}
                            className="flex h-8 w-8 items-center justify-center rounded-full text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                  {customer.pets.length === 0 && (
                    <div className="text-center py-8 text-[#727B8E] dark:text-[#8a94a6]">
                      <PawPrint className="w-12 h-12 mx-auto mb-2 opacity-50" />
                      <p>Nenhum pet cadastrado</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {activeTab === "agendamentos" && (
            <div>
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-sm font-medium text-[#727B8E] dark:text-[#8a94a6]">
                  Histórico de agendamentos
                </h3>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleOpenAppointmentModal()}
                  disabled={customer.pets.length === 0}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Novo Agendamento
                </Button>
              </div>
              {loadingAppointments ? (
                <div className="flex h-32 items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-[#1E62EC]" />
                </div>
              ) : (
                <div className="space-y-3">
                  {customer.appointments.map((apt) => (
                    <motion.div
                      key={apt.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="p-4 bg-[#F4F6F9]/50 dark:bg-[#212225]/50 rounded-xl border border-[#727B8E]/10 dark:border-[#40485A]"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-[#1E62EC]/20 flex items-center justify-center">
                            <Calendar className="w-5 h-5 text-[#1E62EC]" />
                          </div>
                          <div>
                            <p className="font-medium text-[#434A57] dark:text-[#f5f9fc]">
                              {apt.service}
                            </p>
                            <p className="text-sm text-[#727B8E] dark:text-[#8a94a6]">
                              {apt.petName} • {apt.date} às {apt.time}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-xs font-medium px-2 py-1 rounded-full border ${getStatusBadgeStyle(apt.status)}`}
                          >
                            {apt.status}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleOpenAppointmentModal(apt)}
                            className="flex h-8 w-8 items-center justify-center rounded-full text-[#727B8E] hover:bg-[#F4F6F9] dark:hover:bg-[#212225]"
                          >
                            <Edit className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void onDeleteAppointment(apt.id)}
                            className="flex h-8 w-8 items-center justify-center rounded-full text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                  {customer.appointments.length === 0 && (
                    <div className="text-center py-8 text-[#727B8E] dark:text-[#8a94a6]">
                      <Calendar className="w-12 h-12 mx-auto mb-2 opacity-50" />
                      <p>Nenhum agendamento registrado</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {activeTab === "conversas" &&
            (loadingConversations ? (
              <div className="flex h-32 items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-[#1E62EC]" />
              </div>
            ) : (
              <div className="space-y-3">
                {customer.conversations.map((conv) => (
                  <motion.button
                    key={conv.id}
                    type="button"
                    onClick={() => onOpenConversation(conv.id)}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.99 }}
                    className="w-full p-4 bg-[#F4F6F9]/50 dark:bg-[#212225]/50 rounded-xl border border-[#727B8E]/10 dark:border-[#40485A] cursor-pointer hover:bg-[#F4F6F9] dark:hover:bg-[#212225] transition-colors text-left"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-[#F4F6F9] dark:bg-[#212225] flex items-center justify-center">
                        {getChannelIcon(conv.channel)}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium text-[#434A57] dark:text-[#f5f9fc] capitalize">
                            {conv.channel}
                          </p>
                          <div className="flex items-center gap-2">
                            <span className="rounded-full bg-[#1E62EC]/10 px-2 py-0.5 text-[11px] font-medium text-[#1E62EC] dark:bg-[#2172e5]/20 dark:text-[#7fb0ff]">
                              {conv.messageCount} mensagem
                              {conv.messageCount !== 1 ? "ens" : ""}
                            </span>
                            <span className="text-xs text-[#727B8E] dark:text-[#8a94a6]">
                              {conv.date}
                            </span>
                          </div>
                        </div>
                        <p className="text-sm text-[#727B8E] dark:text-[#8a94a6] truncate mt-1">
                          {conv.preview}
                        </p>
                      </div>
                    </div>
                  </motion.button>
                ))}
                {customer.conversations.length === 0 && (
                  <div className="text-center py-8 text-[#727B8E] dark:text-[#8a94a6]">
                    <MessageCircle className="w-12 h-12 mx-auto mb-2 opacity-50" />
                    <p>Nenhuma conversa registrada</p>
                  </div>
                )}
              </div>
            ))}
        </div>
      </div>

      <Modal
        isOpen={petModalOpen}
        onClose={() => {
          setPetModalOpen(false);
          setPetForm(emptyPetForm);
          setPetFormErrors({});
          setEditingPet(null);
        }}
        title={editingPet ? "Editar pet" : "Novo pet"}
        onSubmit={() => void handleSavePet()}
        submitText="Salvar"
        isLoading={savingPet}
        className="max-w-[400px] max-h-[85vh] flex flex-col overflow-hidden"
      >
        <div className="flex flex-col gap-4 overflow-y-auto max-h-[320px]">
          <div>
            <Input
              label="Nome do pet *"
              placeholder="Nome"
              value={petForm.name}
              onChange={(e) => {
                setPetForm((prev) => ({ ...prev, name: e.target.value }));
                if (e.target.value) setPetFormErrors((prev) => ({ ...prev, name: undefined }));
              }}
            />
            {petFormErrors.name && (
              <p className="mt-1 text-xs text-red-500">{petFormErrors.name}</p>
            )}
          </div>
          <div>
            <Select
              label="Espécie *"
              placeholder="Selecione a espécie"
              value={petForm.species}
              onChange={(e) => {
                setPetForm((prev) => ({ ...prev, species: e.target.value }));
                if (e.target.value) setPetFormErrors((prev) => ({ ...prev, species: undefined }));
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
            {petFormErrors.species && (
              <p className="mt-1 text-xs text-red-500">{petFormErrors.species}</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Raça"
              placeholder="Raça"
              value={petForm.breed}
              onChange={(e) =>
                setPetForm((prev) => ({ ...prev, breed: e.target.value }))
              }
            />
            <Input
              label="Idade"
              placeholder="Idade"
              value={petForm.age}
              onChange={(e) =>
                setPetForm((prev) => ({ ...prev, age: e.target.value }))
              }
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Peso"
              placeholder="Peso"
              value={petForm.weight}
              onChange={(e) =>
                setPetForm((prev) => ({ ...prev, weight: e.target.value }))
              }
            />
            <div>
              <Select
                label="Porte *"
                placeholder="Selecione o porte"
                value={petForm.size}
                onChange={(e) => {
                  setPetForm((prev) => ({ ...prev, size: e.target.value }));
                  if (e.target.value) setPetFormErrors((prev) => ({ ...prev, size: undefined }));
                }}
                options={[...PET_SIZE_OPTIONS_WITH_PLACEHOLDER]}
              />
              {petFormErrors.size && (
                <p className="mt-1 text-xs text-red-500">{petFormErrors.size}</p>
              )}
            </div>
          </div>
          <Input
            label="Cor/Pelagem"
            placeholder="Cor"
            value={petForm.color}
            onChange={(e) =>
              setPetForm((prev) => ({ ...prev, color: e.target.value }))
            }
          />
          <TextAreaField
            id="pet-notes"
            label="Observações"
            placeholder="Observações"
            value={petForm.notes}
            onChange={(e) =>
              setPetForm((prev) => ({ ...prev, notes: e.target.value }))
            }
            rows={3}
          />
        </div>
      </Modal>

      <Modal
        isOpen={appointmentModalOpen}
        onClose={() => {
          setAppointmentModalOpen(false);
          setEditingAppointment(null);
        }}
        title={editingAppointment ? "Editar agendamento" : "Novo agendamento"}
        onSubmit={handleSaveAppointment}
        submitText="Salvar"
        className="max-w-[400px] max-h-[85vh] flex flex-col overflow-hidden"
      >
        <div className="flex flex-col gap-4 overflow-y-auto max-h-[320px]">
          <Select
            label="Pet"
            placeholder="Selecione o pet"
            value={appointmentForm.petId}
            onChange={(e) => {
              const pet = customer.pets.find((p) => p.id === e.target.value);
              setAppointmentForm((prev) => ({
                ...prev,
                petId: e.target.value,
                petName: pet?.name || "",
              }));
            }}
            options={customer.pets.map((pet) => ({
              value: pet.id,
              label: pet.name,
            }))}
          />
          <Input
            label="Serviço"
            placeholder="Serviço"
            value={appointmentForm.service}
            onChange={(e) =>
              setAppointmentForm((prev) => ({
                ...prev,
                service: e.target.value,
              }))
            }
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Data"
              placeholder="DD/MM/AAAA"
              value={appointmentForm.date}
              onChange={(e) =>
                setAppointmentForm((prev) => ({
                  ...prev,
                  date: maskDate(e.target.value),
                  scheduleId: "",
                  time: "",
                }))
              }
              maxLength={10}
            />
            <Select
              label="Horário"
              placeholder={
                !appointmentForm.date
                  ? "Informe a data primeiro"
                  : appointmentSlotsLoading
                    ? "Carregando horários..."
                    : appointmentTimeOptions.length === 0
                      ? "Nenhum horário disponível"
                      : "Selecione o horário"
              }
              value={appointmentTimeValue}
              onChange={(e) =>
                setAppointmentForm((prev) => {
                  const selectedSlot = appointmentSlots.find(
                    (slot) => String(slot.schedule_id) === e.target.value,
                  );

                  if (!selectedSlot) {
                    return {
                      ...prev,
                      scheduleId: "",
                      time: e.target.value,
                    };
                  }

                  return {
                    ...prev,
                    scheduleId: String(selectedSlot.schedule_id),
                    time: selectedSlot.time,
                  };
                })
              }
              options={appointmentTimeOptions}
              disabled={
                !appointmentForm.date ||
                appointmentSlotsLoading ||
                appointmentTimeOptions.length === 0
              }
            />
          </div>
          {appointmentSlotsError && (
            <p className="text-xs text-red-500 dark:text-red-400">
              {appointmentSlotsError}
            </p>
          )}
          <Select
            label="Status"
            placeholder="Selecione"
            value={appointmentForm.status}
            onChange={(e) =>
              setAppointmentForm((prev) => ({
                ...prev,
                status: e.target.value as Appointment["status"],
              }))
            }
            options={[
              { value: "pendente", label: "Pendente" },
              { value: "confirmado", label: "Confirmado" },
              { value: "concluido", label: "Concluído" },
              { value: "cancelado", label: "Cancelado" },
            ]}
          />
          <TextAreaField
            id="appointment-notes"
            label="Observações"
            placeholder="Observações"
            value={appointmentForm.notes}
            onChange={(e) =>
              setAppointmentForm((prev) => ({ ...prev, notes: e.target.value }))
            }
            rows={3}
          />
        </div>
      </Modal>
    </motion.div>
  );
}

const emptyCustomerForm = {
  name: "",
  email: "",
  phone: "",
  status: "ativo" as "ativo" | "inativo",
  address: "",
  notes: "",
};

type ApiClient = Client & {
  isActive?: boolean;
  totalAppointments?: number | null;
  totalPets?: number | null;
  totalConversations?: number | null;
};

type ApiPet = PetType & {
  birthDate?: string | null;
  birth_date?: string | null;
  weightKg?: number | string | null;
  weight_kg?: number | string | null;
  notes?: string | null;
  isActive?: boolean | null;
  is_active?: boolean | null;
};

type ApiPetAppointment = ApiAppointment & {
  pet_id?: string | null;
};


function formatPetAge(pet: ApiPet): string {
  if (pet.age !== undefined && pet.age !== null) {
    return String(pet.age);
  }

  const birthDate = pet.birthDate ?? pet.birth_date;
  if (!birthDate) return "";

  const birthday = new Date(birthDate);
  if (Number.isNaN(birthday.getTime())) return "";

  const today = new Date();
  let age = today.getFullYear() - birthday.getFullYear();
  const monthDelta = today.getMonth() - birthday.getMonth();
  if (
    monthDelta < 0 ||
    (monthDelta === 0 && today.getDate() < birthday.getDate())
  ) {
    age -= 1;
  }

  return age >= 0 ? String(age) : "";
}

function formatPetWeight(pet: ApiPet): string {
  const value = pet.weight ?? pet.weightKg ?? pet.weight_kg;
  if (value === undefined || value === null || value === "") {
    return "";
  }

  return String(value);
}

function getPetNotes(pet: ApiPet): string {
  if (typeof pet.notes === "string" && pet.notes.trim()) {
    return pet.notes.trim();
  }

  if (typeof pet.medical_info === "string" && pet.medical_info.trim()) {
    return pet.medical_info.trim();
  }

  if (pet.medical_info && typeof pet.medical_info === "object") {
    const medicalInfo = pet.medical_info as {
      conditions?: string[];
      medications?: string[];
      allergies?: string[];
      notes?: string;
    };

    if (typeof medicalInfo.notes === "string" && medicalInfo.notes.trim()) {
      return medicalInfo.notes.trim();
    }

    const values = [
      ...(medicalInfo.conditions ?? []),
      ...(medicalInfo.medications ?? []),
      ...(medicalInfo.allergies ?? []),
    ]
      .map((value) => value.trim())
      .filter(Boolean);

    if (values.length > 0) {
      return values.join(", ");
    }
  }

  return "";
}

function mapPetFromApi(pet: ApiPet, customerId: string): Pet {
  return {
    id: pet.id,
    customerId,
    name: pet.name,
    species: (pet.species as Pet["species"]) || "outro",
    breed: pet.breed || "",
    age: formatPetAge(pet),
    weight: formatPetWeight(pet),
    size: normalizePetSize(pet.size) ?? pet.size ?? "",
    color: pet.color || "",
    notes: getPetNotes(pet),
  };
}

function normalizeAppointmentStatus(
  status?: string | null,
): Appointment["status"] {
  return appointmentStatusFromApi(status);
}

function mapAppointmentFromApi(
  appointment: ApiPetAppointment,
  customerId: string,
): Appointment {
  const scheduledDate = new Date(appointment.scheduled_at);
  const dateStr = scheduledDate.toLocaleDateString("pt-BR");
  const timeStr = scheduledDate.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return {
    id: appointment.id,
    customerId,
    petId: appointment.pet_id || "",
    scheduleId:
      appointment.schedule_id !== undefined && appointment.schedule_id !== null
        ? String(appointment.schedule_id)
        : undefined,
    petName: appointment.pet_name || "",
    date: dateStr,
    time: timeStr,
    service: appointment.specialty || "",
    status: normalizeAppointmentStatus(appointment.status),
    notes: appointment.notes || "",
  };
}

function ageToBirthDate(ageValue: string): string | undefined {
  const age = parseInt(ageValue, 10);
  if (!Number.isFinite(age) || age < 0) {
    return undefined;
  }

  const today = new Date();
  return new Date(
    today.getFullYear() - age,
    today.getMonth(),
    today.getDate(),
  ).toISOString();
}

function parseWeightKg(weightValue: string): number | undefined {
  const normalized = weightValue.replace(",", ".").trim();
  if (!normalized) return undefined;

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function clientToCustomer(c: ApiClient): Customer {
  const phoneDisplay = formatPhoneForDisplay(c.phone ?? "");
  const isActive = c.is_active ?? c.isActive ?? true;
  const petsCount = c.total_pets ?? c.totalPets ?? 0;

  return {
    id: c.id,
    name: c.name ?? "",
    email: c.email ?? "",
    phone: phoneDisplay,
    status: isActive ? "ativo" : "inativo",
    address: undefined,
    notes: c.notes ?? undefined,
    petsCount,
    totalAppointments: c.total_appointments ?? c.totalAppointments ?? 0,
    lastVisit: "",
    pets: [],
    appointments: [],
    conversations: [],
  };
}

function buildNotes(addressStr: string, notes: string): string {
  const parts: string[] = [];
  if (addressStr.trim()) parts.push("Endereço: " + addressStr.trim());
  if (notes.trim()) parts.push(notes.trim());
  return parts.join("\n");
}

function parseNotesForEdit(notes?: string | null): {
  address: string;
  notes: string;
} {
  if (!notes?.trim()) return { address: "", notes: "" };
  const firstLine = notes.split("\n")[0]?.trim() ?? "";
  if (firstLine.startsWith("Endereço:")) {
    const address = firstLine.replace(/^Endereço:\s*/i, "").trim();
    const rest = notes.split("\n").slice(1).join("\n").trim();
    return { address, notes: rest };
  }
  return { address: "", notes: notes.trim() };
}

export default function ClientesPage() {
  const navigate = useNavigate();
  const { user } = useAuthContext();
  const toast = useToast();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customersLoading, setCustomersLoading] = useState(true);
  const [customersError, setCustomersError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [customerForm, setCustomerForm] = useState(emptyCustomerForm);
  const [customerStep, setCustomerStep] = useState<1 | 2>(1);
  const {
    address,
    setField,
    handleCepChange,
    cepLoading,
    cepError,
    isFieldDisabled,
    reset: resetAddress,
  } = useAddressByCep();

  const [loadingPets, setLoadingPets] = useState(false);
  const [loadingAppointments, setLoadingAppointments] = useState(false);
  const [loadingConversations, setLoadingConversations] = useState(false);
  const [activeTab, setActiveTab] = useState<
    "pets" | "agendamentos" | "conversas"
  >("pets");
  const [loadedTabs, setLoadedTabs] = useState<Record<string, Set<string>>>({});

  const selectedCustomer = customers.find((c) => c.id === selectedId) ?? null;

  useEffect(() => {
    let cancelled = false;
    setCustomersLoading(true);
    setCustomersError(null);
    clientService
      .listClients({ limit: 500 })
      .then((list) => {
        if (!cancelled) setCustomers(list.map(clientToCustomer));
      })
      .catch((err: any) => {
        if (!cancelled)
          setCustomersError(
            err.response?.data?.detail ?? "Erro ao carregar clientes.",
          );
      })
      .finally(() => {
        if (!cancelled) setCustomersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (customerModalOpen) {
      setSaveError(null);
      setCustomerStep(1);
      if (editingCustomer) {
        const { address: addrLine, notes: notesOnly } = parseNotesForEdit(
          editingCustomer.notes,
        );
        setCustomerForm({
          name: editingCustomer.name,
          email: editingCustomer.email,
          phone: editingCustomer.phone,
          status: editingCustomer.status,
          address: addrLine,
          notes: notesOnly,
        });
        resetAddress({ rua: addrLine });
      } else {
        setCustomerForm(emptyCustomerForm);
        resetAddress();
      }
    }
  }, [customerModalOpen, editingCustomer, resetAddress]);

  const loadPets = useCallback(
    async (customerId: string) => {
      const alreadyLoaded = loadedTabs[customerId]?.has("pets");
      if (alreadyLoaded) return;

      setLoadingPets(true);
      try {
        const pets = await clientService.getClientPets(
          customerId,
          user?.petshop_id,
        );
        const mappedPets = pets.map((pet) =>
          mapPetFromApi(pet as ApiPet, customerId),
        );
        setCustomers((prev) =>
          prev.map((c) =>
            c.id === customerId
              ? { ...c, pets: mappedPets, petsCount: mappedPets.length }
              : c,
          ),
        );
        setLoadedTabs((prev) => ({
          ...prev,
          [customerId]: new Set([...(prev[customerId] || []), "pets"]),
        }));
      } catch (error) {
        console.error("Erro ao carregar pets:", error);
      } finally {
        setLoadingPets(false);
      }
    },
    [user?.petshop_id, loadedTabs],
  );

  const loadConversations = useCallback(
    async (customerId: string) => {
      const alreadyLoaded = loadedTabs[customerId]?.has("conversas");
      if (alreadyLoaded) return;

      setLoadingConversations(true);
      try {
        const result = await clientService.getClientConversations(customerId);
        const mappedConversations: ConversationHistory[] =
          result.conversations.map((conv) => ({
            id: conv.conversation_id,
            date: new Date(conv.last_message_at).toLocaleDateString("pt-BR"),
            preview:
              conv.message_count > 0
                ? `${conv.message_count} mensagens registradas`
                : "Sem mensagens registradas",
            messageCount: conv.message_count,
            channel: "whatsapp" as const,
          }));
        setCustomers((prev) =>
          prev.map((c) =>
            c.id === customerId
              ? { ...c, conversations: mappedConversations }
              : c,
          ),
        );
        setLoadedTabs((prev) => ({
          ...prev,
          [customerId]: new Set([...(prev[customerId] || []), "conversas"]),
        }));
      } catch (error) {
        console.error("Erro ao carregar conversas:", error);
      } finally {
        setLoadingConversations(false);
      }
    },
    [loadedTabs],
  );

  const loadAppointments = useCallback(
    async (customerId: string) => {
      const alreadyLoaded = loadedTabs[customerId]?.has("agendamentos");
      if (alreadyLoaded) return;

      setLoadingAppointments(true);
      try {
        const appointments = await appointmentService.listAppointments({
          client_id: customerId,
        });
        const mappedAppointments = appointments.map((appointment) =>
          mapAppointmentFromApi(appointment as ApiPetAppointment, customerId),
        );
        setCustomers((prev) =>
          prev.map((c) =>
            c.id === customerId
              ? { ...c, appointments: mappedAppointments }
              : c,
          ),
        );
        setLoadedTabs((prev) => ({
          ...prev,
          [customerId]: new Set([...(prev[customerId] || []), "agendamentos"]),
        }));
      } catch (error) {
        console.error("Erro ao carregar agendamentos:", error);
      } finally {
        setLoadingAppointments(false);
      }
    },
    [loadedTabs],
  );

  const handleTabChange = useCallback(
    (tab: "pets" | "agendamentos" | "conversas") => {
      setActiveTab(tab);
      if (!selectedId) return;

      const customer = customers.find((c) => c.id === selectedId);
      if (!customer) return;

      if (tab === "pets") {
        loadPets(selectedId);
      } else if (tab === "agendamentos") {
        loadAppointments(selectedId);
      } else if (tab === "conversas") {
        loadConversations(selectedId);
      }
    },
    [selectedId, customers, loadPets, loadAppointments, loadConversations],
  );

  useEffect(() => {
    if (!selectedId) return;

    if (activeTab === "pets") {
      loadPets(selectedId);
      return;
    }

    if (activeTab === "agendamentos") {
      loadAppointments(selectedId);
      return;
    }

    loadConversations(selectedId);
  }, [selectedId, activeTab, loadPets, loadAppointments, loadConversations]);

  const handleDeleteCustomer = async (customerId: string) => {
    const customer = customers.find((item) => item.id === customerId);

    try {
      await clientService.deleteClient(customerId);
      setCustomers((prev) => prev.filter((c) => c.id !== customerId));
      if (selectedId === customerId) {
        setSelectedId(null);
      }
      toast.success(
        "Cliente removido",
        customer?.name
          ? `${customer.name} foi excluído com sucesso.`
          : "O cliente foi excluído com sucesso.",
      );
    } catch (error: any) {
      console.error("Erro ao excluir cliente:", error);
      toast.error(
        "Erro ao excluir cliente",
        error.response?.data?.detail ||
          error.response?.data?.error ||
          "Não foi possível excluir o cliente.",
      );
    }
  };

  const handleDeletePet = async (petId: string) => {
    if (!selectedCustomer) return;

    const pet = selectedCustomer.pets.find((item) => item.id === petId);

    try {
      await petService.deletePet(petId);
      setCustomers((prev) =>
        prev.map((c) =>
          c.id === selectedCustomer.id
            ? {
                ...c,
                pets: c.pets.filter((p) => p.id !== petId),
                petsCount: Math.max(c.petsCount - 1, 0),
              }
            : c,
        ),
      );
      toast.success(
        "Pet removido",
        pet?.name
          ? `${pet.name} foi removido com sucesso.`
          : "O pet foi removido com sucesso.",
      );
    } catch (error: any) {
      console.error("Erro ao excluir pet:", error);
      toast.error(
        "Erro ao excluir pet",
        error.response?.data?.detail ||
          error.response?.data?.error ||
          "Não foi possível excluir o pet.",
      );
    }
  };

  const handleDeleteAppointment = async (appointmentId: string) => {
    if (!selectedCustomer) return;

    const appointment = selectedCustomer.appointments.find(
      (item) => item.id === appointmentId,
    );

    if (!appointment) return;

    if (appointmentId.startsWith("apt-")) {
      setCustomers((prev) =>
        prev.map((c) =>
          c.id === selectedCustomer.id
            ? {
                ...c,
                appointments: c.appointments.filter(
                  (a) => a.id !== appointmentId,
                ),
                totalAppointments: Math.max(c.totalAppointments - 1, 0),
              }
            : c,
        ),
      );
      toast.info(
        "Agendamento removido",
        "O registro local foi removido da visualização do cliente.",
      );
      return;
    }

    try {
      await appointmentService.cancelAppointment(appointmentId);
      setCustomers((prev) =>
        prev.map((c) =>
          c.id === selectedCustomer.id
            ? {
                ...c,
                appointments: c.appointments.filter(
                  (a) => a.id !== appointmentId,
                ),
                totalAppointments: Math.max(c.totalAppointments - 1, 0),
              }
            : c,
        ),
      );
      toast.success(
        "Agendamento cancelado",
        appointment.service
          ? `${appointment.service} foi cancelado com sucesso.`
          : "O agendamento foi cancelado com sucesso.",
      );
    } catch (error: any) {
      console.error("Erro ao cancelar agendamento:", error);
      toast.error(
        "Erro ao cancelar agendamento",
        error.response?.data?.detail ||
          error.response?.data?.error ||
          "Não foi possível cancelar o agendamento.",
      );
    }
  };

  const updateCustomerAppointmentState = (
    appointmentData: Omit<Appointment, "id" | "customerId">,
    appointmentId?: string,
  ) => {
    setCustomers((prev) =>
      prev.map((c) =>
        c.id === selectedCustomer.id
          ? {
              ...c,
              totalAppointments: appointmentId
                ? c.totalAppointments
                : c.totalAppointments + 1,
              appointments: appointmentId
                ? c.appointments.map((a) =>
                    a.id === appointmentId ? { ...a, ...appointmentData } : a,
                  )
                : [
                    ...c.appointments,
                    {
                      id: `apt-${Date.now()}`,
                      customerId: selectedCustomer.id,
                      ...appointmentData,
                    },
                  ],
            }
          : c,
      ),
    );
  };

  const handleSavePet = useCallback(
    async (petData: Omit<Pet, "id" | "customerId">, petId?: string) => {
      if (!selectedCustomer) return;

      try {
        if (petId) {
          const updated = await petService.updatePet(petId, {
            name: petData.name,
            species: petData.species,
            breed: petData.breed || undefined,
            birthDate: ageToBirthDate(petData.age),
            weightKg: parseWeightKg(petData.weight),
            size: normalizePetSize(petData.size),
            color: petData.color || undefined,
            notes: petData.notes || undefined,
          });
          setCustomers((prev) =>
            prev.map((c) => {
              if (c.id !== selectedCustomer.id) return c;
              return {
                ...c,
                pets: c.pets.map((p) =>
                  p.id === petId
                    ? mapPetFromApi(updated as ApiPet, selectedCustomer.id)
                    : p,
                ),
              };
            }),
          );
          toast.success(
            "Pet atualizado",
            petData.name
              ? `${petData.name} foi atualizado com sucesso.`
              : "O pet foi atualizado com sucesso.",
          );
        } else {
          const created = await petService.createPet({
            petshop_id: user?.petshop_id || 1,
            client_id: selectedCustomer.id,
            name: petData.name,
            species: petData.species,
            breed: petData.breed || undefined,
            birthDate: ageToBirthDate(petData.age),
            weightKg: parseWeightKg(petData.weight),
            size: normalizePetSize(petData.size),
            color: petData.color || undefined,
            notes: petData.notes || undefined,
          });
          const newPet = mapPetFromApi(created as ApiPet, selectedCustomer.id);
          setCustomers((prev) =>
            prev.map((c) => {
              if (c.id !== selectedCustomer.id) return c;
              return {
                ...c,
                petsCount: c.petsCount + 1,
                pets: [...c.pets, newPet],
              };
            }),
          );
          toast.success(
            "Pet cadastrado",
            petData.name
              ? `${petData.name} foi cadastrado com sucesso.`
              : "O pet foi cadastrado com sucesso.",
          );
        }
      } catch (error: any) {
        console.error("Erro ao salvar pet:", error);
        toast.error(
          "Erro ao salvar pet",
          error.response?.data?.detail ||
            error.response?.data?.error ||
            "Não foi possível salvar o pet.",
        );
        throw error;
      }
    },
    [selectedCustomer, toast, user],
  );

  const handleSaveAppointment = useCallback(
    (
      appointmentData: Omit<Appointment, "id" | "customerId">,
      appointmentId?: string,
    ) => {
      if (!selectedCustomer) return;

      updateCustomerAppointmentState(appointmentData, appointmentId);
      toast.warning(
        appointmentId
          ? "Agendamento atualizado localmente"
          : "Agendamento criado localmente",
        "Este atalho da aba Clientes ainda não sincroniza criação ou edição com o backend.",
      );
    },
    [selectedCustomer, toast],
  );

  const handleOpenConversation = useCallback(
    (conversationId: string) => {
      navigate(`/chat?id=${encodeURIComponent(conversationId)}`);
    },
    [navigate],
  );

  const handleSaveCustomer = useCallback(async () => {
    const { name, email, phone, status, notes } = customerForm;
    const phoneValue = phone.trim();
    if (!name.trim() || !phoneValue) return;

    const addr = address;
    const addressStr = [
      addr.rua,
      addr.numero,
      addr.complemento,
      addr.bairro,
      addr.cidade,
      addr.uf,
    ]
      .filter(Boolean)
      .join(", ")
      .trim();
    const notesValue = buildNotes(addressStr, notes);

    setSaveError(null);
    setIsSaving(true);
    try {
      if (editingCustomer) {
        const updated = await clientService.updateClient(editingCustomer.id, {
          phone: phoneValue,
          name: name.trim(),
          email: email.trim() || undefined,
          is_active: status === "ativo",
          notes: notesValue || undefined,
        });
        setCustomers((prev) =>
          prev.map((c) =>
            c.id === editingCustomer.id ? clientToCustomer(updated) : c,
          ),
        );
        setCustomerModalOpen(false);
        toast.success(
          "Cliente atualizado",
          `${name.trim()} foi atualizado com sucesso.`,
        );
      } else {
        const newClient = await clientService.createClient({
          phone: phoneValue,
          name: name.trim(),
          email: email.trim() || undefined,
          source: "manual",
        });
        if (notesValue) {
          await clientService.updateClient(newClient.id, { notes: notesValue });
        }
        const withNotes = notesValue
          ? { ...newClient, notes: notesValue }
          : newClient;
        setCustomers((prev) => [clientToCustomer(withNotes), ...prev]);
        setSelectedId(newClient.id);
        setCustomerModalOpen(false);
        toast.success(
          "Cliente cadastrado",
          `${name.trim()} foi cadastrado com sucesso.`,
        );
      }
    } catch (err: any) {
      const message =
        err.response?.data?.detail ||
        err.response?.data?.error ||
        "Erro ao salvar cliente.";
      setSaveError(message);
      toast.error("Erro ao salvar cliente", message);
    } finally {
      setIsSaving(false);
    }
  }, [customerForm, editingCustomer, address, toast]);

  return (
    <DashboardLayout
      sidebar={
        <ClientsSidebar
          customers={customers}
          selectedId={selectedId}
          onSelect={setSelectedId}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onNewCustomer={() => {
            setEditingCustomer(null);
            setCustomerModalOpen(true);
          }}
          loading={customersLoading}
          error={customersError}
        />
      }
    >
      <AnimatePresence mode="wait">
        <CustomerDetails
          customer={selectedCustomer}
          onBack={() => setSelectedId(null)}
          onEditCustomer={() => {
            setEditingCustomer(selectedCustomer);
            setCustomerModalOpen(true);
          }}
          onDeleteCustomer={handleDeleteCustomer}
          onDeletePet={handleDeletePet}
          onDeleteAppointment={handleDeleteAppointment}
          onSavePet={handleSavePet}
          onSaveAppointment={handleSaveAppointment}
          onOpenConversation={handleOpenConversation}
          activeTab={activeTab}
          onTabChange={handleTabChange}
          loadingPets={loadingPets}
          loadingAppointments={loadingAppointments}
          loadingConversations={loadingConversations}
        />
      </AnimatePresence>

      <Modal
        isOpen={customerModalOpen}
        onClose={() =>
          customerStep === 2 ? setCustomerStep(1) : setCustomerModalOpen(false)
        }
        title={editingCustomer ? "Editar cliente" : "Novo cliente"}
        onSubmit={
          customerStep === 1
            ? () => setCustomerStep(2)
            : () => void handleSaveCustomer()
        }
        submitText={
          customerStep === 1
            ? "Próximo"
            : editingCustomer
              ? "Salvar"
              : "Cadastrar"
        }
        cancelText={customerStep === 2 ? "Voltar" : "Cancelar"}
        isLoading={isSaving && customerStep === 2}
        className="max-w-[400px] max-h-[85vh] flex flex-col overflow-hidden"
      >
        <div className="flex flex-col gap-4 overflow-y-auto max-h-[320px]">
          {saveError && (
            <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
              {saveError}
            </p>
          )}
          <div className="flex gap-1" aria-label={`Etapa ${customerStep} de 2`}>
            {[1, 2].map((step) => (
              <div
                key={step}
                className={cn(
                  "h-1 flex-1 rounded-full transition-colors",
                  step <= customerStep
                    ? "bg-[#1E62EC] dark:bg-[#2172e5]"
                    : "bg-[#727B8E]/25 dark:bg-[#40485A]",
                )}
              />
            ))}
          </div>

          {customerStep === 1 && (
            <>
              <Input
                label="Nome"
                placeholder="Nome do tutor"
                value={customerForm.name}
                onChange={(e) =>
                  setCustomerForm((f) => ({ ...f, name: e.target.value }))
                }
                required
              />
              <Input
                label="Telefone"
                placeholder="(11) 99999-9999"
                value={customerForm.phone}
                onChange={(e) =>
                  setCustomerForm((f) => ({
                    ...f,
                    phone: maskPhone(e.target.value),
                  }))
                }
                required
              />
              <Input
                label="E-mail"
                type="email"
                placeholder="email@exemplo.com (opcional)"
                value={customerForm.email}
                onChange={(e) =>
                  setCustomerForm((f) => ({ ...f, email: e.target.value }))
                }
              />
            </>
          )}

          {customerStep === 2 && (
            <div className="flex flex-col gap-4">
              <div className="relative">
                <Input
                  label="CEP"
                  placeholder="00000-000"
                  value={address.cep}
                  onChange={handleCepChange}
                />
                {cepLoading && (
                  <div className="absolute right-3 top-9">
                    <Loader2 className="h-4 w-4 animate-spin text-[#1E62EC]" />
                  </div>
                )}
                {cepError && (
                  <p className="mt-1 text-xs text-red-500">{cepError}</p>
                )}
              </div>
              <Input
                label="Rua"
                placeholder="Logradouro"
                value={address.rua}
                onChange={(e) => setField("rua", e.target.value)}
                disabled={isFieldDisabled("rua")}
              />
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="Número"
                  placeholder="Nº"
                  value={address.numero}
                  onChange={(e) => setField("numero", e.target.value)}
                />
                <Input
                  label="Complemento"
                  placeholder="Apto, sala..."
                  value={address.complemento}
                  onChange={(e) => setField("complemento", e.target.value)}
                  disabled={isFieldDisabled("complemento")}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="Bairro"
                  placeholder="Bairro"
                  value={address.bairro}
                  onChange={(e) => setField("bairro", e.target.value)}
                  disabled={isFieldDisabled("bairro")}
                />
                <Input
                  label="Cidade"
                  placeholder="Cidade"
                  value={address.cidade}
                  onChange={(e) => setField("cidade", e.target.value)}
                  disabled={isFieldDisabled("cidade")}
                />
              </div>
              <Input
                label="UF"
                placeholder="UF"
                value={address.uf}
                onChange={(e) =>
                  setField("uf", e.target.value.toUpperCase().slice(0, 2))
                }
                disabled={isFieldDisabled("uf")}
              />
              <Select
                label="Status"
                placeholder="Selecione"
                value={customerForm.status}
                onChange={(e) =>
                  setCustomerForm((f) => ({
                    ...f,
                    status: e.target.value as "ativo" | "inativo",
                  }))
                }
                options={[
                  { value: "ativo", label: "Ativo" },
                  { value: "inativo", label: "Inativo" },
                ]}
              />
              <div className="flex flex-col gap-2">
                <label className="font-be-vietnam-pro text-sm font-semibold text-[#434A57] dark:text-[#f5f9fc]">
                  Observações
                </label>
                <TextArea
                  placeholder="Observações sobre o cliente"
                  value={customerForm.notes}
                  onChange={(e) =>
                    setCustomerForm((f) => ({ ...f, notes: e.target.value }))
                  }
                  rows={2}
                />
              </div>
            </div>
          )}
        </div>
      </Modal>
    </DashboardLayout>
  );
}
