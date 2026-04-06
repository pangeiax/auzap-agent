import { useState, useCallback, useEffect, useMemo } from "react";
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
  Eye,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { normalizePetSize, petSizeAbbrev, PET_SIZE_OPTIONS, PET_SIZE_OPTIONS_WITH_PLACEHOLDER } from "@/lib/petSize";
import { formatPhoneForDisplay, maskPhone, dateFromISO, dateToISO } from "@/lib/masks";
import { useAddressByCep, useToast } from "@/hooks";
import { useAuthContext } from "@/contexts";
import { appointmentService, clientService, petService } from "@/services";
import { appointmentStatusFromApi } from "@/lib/appointmentStatus";
import {
  extractPairedAppointmentId,
  idsForMergedDisplayRow,
  mergePairedByTime,
  notesForDisplay,
} from "@/lib/appointmentPair";
import type {
  Appointment as ApiAppointment,
  Client,
  Pet as PetType,
  Service,
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
  /** Fim exibido quando o serviço usa dois slots (par). */
  timeEnd?: string;
  service: string;
  status: "confirmado" | "pendente" | "cancelado" | "concluido";
  notes: string;
  pairedAppointmentId?: string;
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
  // Apenas para visualizacao no frontend (nao usada para envio/recebimento).
  manualPhone?: string;
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

function getTodayYmd(): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function brDateToYmdSafe(br: string): string {
  if (!br) return "";
  const iso = dateToISO(br);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : "";
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

function formatClientPhoneForSidebar(phone: string): string {
  // Quando o sistema envia um identificador tipo "@lid" (ou qualquer valor com letras),
  // mostramos uma mensagem neutra apenas na UI.
  if (!phone) return "—";
  if (phone.includes("@") || /[a-z]/i.test(phone)) return "Numero nao identificado";
  return phone;
}

function getClientPhoneDisplay(customer: Customer): string {
  const manual = customer.manualPhone?.trim();
  if (!manual) return "Numero nao identificado";
  if (manual.includes("@") || /[a-z]/i.test(manual)) {
    return "Numero nao identificado";
  }
  return manual;
}

function ClientsSidebar({
  customers,
  selectedId,
  onSelect,
  searchQuery,
  onSearchChange,
  onNewCustomer,
  onSearchClick,
  loading,
  error,
  deletingCustomerId,
}: {
  customers: Customer[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onNewCustomer: () => void;
  onSearchClick: () => void;
  loading?: boolean;
  error?: string | null;
  deletingCustomerId?: string | null;
}) {
  const filteredCustomers = customers.filter(
    (customer) =>
      customer.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      customer.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      customer.phone.includes(searchQuery) ||
      getClientPhoneDisplay(customer).includes(searchQuery),
  );

  const renderMobileView = () => (
    <div className="lg:hidden h-full w-full relative overflow-hidden">
      <div className="relative z-10 h-full flex flex-col">
        <div className="flex-1 flex lg:gap-2.5 overflow-hidden">
          <div className="w-[88.73px] bg-white border-l border-t border-b border-[#727B8E]/10 rounded-l-2xl flex flex-col justify-between py-[10px] px-2">
            <div className="pb-1 border-b border-[#727B8E]/10">
              <div className="flex items-center justify-between text-[10px] font-medium text-[#434A57] leading-7">
                <h2 className="text-sm font-semibold text-[#434A57] dark:text-[#f5f9fc]">
                  Clientes
                </h2>
                <button
                  type="button"
                  onClick={onSearchClick}
                  className="flex h-3 w-3 items-center justify-center rounded-full text-[#727B8E] transition-colors hover:bg-[#F4F6F9] dark:text-[#8a94a6] dark:hover:bg-[#212225]"
                >
                  <Search className="h-3 w-3" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto py-4 space-y-0">
              {filteredCustomers.slice(0, 8).map((customer) => (
                <button
                  key={customer.id}
                  type="button"
                  disabled={deletingCustomerId === customer.id}
                  onClick={() => onSelect(customer.id)}
                  className={`w-full p-3 border-b border-[#727B8E]/10 ${selectedId === customer.id ? "bg-[#F4F6F9]" : "bg-white"
                    } disabled:pointer-events-none disabled:opacity-70`}
                >
                  <div className="relative w-[49px] h-[49px] mx-auto">
                    <div className="w-full h-full rounded-full bg-[#FAFAFA] border border-[#727B8E]/10 flex items-center justify-center">
                      {deletingCustomerId === customer.id ? (
                        <Loader2 className="h-5 w-5 animate-spin text-[#1E62EC]" />
                      ) : (
                        <span className="text-base font-medium text-[#434A57]">
                          {getInitials(customer.name)}
                        </span>
                      )}
                    </div>
                    {customer.status === "ativo" && deletingCustomerId !== customer.id && (
                      <div className="absolute bottom-0 right-0 w-2 h-2 bg-[#3DCA21] rounded-full border-2 border-white/10" />
                    )}
                  </div>
                </button>
              ))}
            </div>

            <div className="pt-2">

              <Button
                onClick={onNewCustomer}
                className="h-[37px] px-5 bg-[#1E62EC] text-white text-xs font-medium rounded-lg hover:bg-[#1E62EC]/90"
              >
                <Plus className="h-6 w-6 text-white" />
              </Button>
            </div>
          </div>

          <div className="hidden flex-1 bg-[#F4F6F9] border border-[#727B8E]/10 rounded-r-[24px] lg:flex flex-col items-center justify-center p-4">
            {loading ? (
              <Loader2 className="h-8 w-8 animate-spin text-[#1E62EC]" />
            ) : filteredCustomers.length === 0 ? (
              <div className="text-center pb-[90px]">
                <div className="w-[155.21px] h-[81.95px] mx-auto mb-[35px]">
                  <EmptyState
                    image="not_found_clientes_ativos"
                    description=""
                    buttonText=""
                    onButtonClick={() => { }}
                  />
                </div>
                <p className="text-sm font-medium text-[#727B8E] mb-4">
                  Você ainda não tem conversas
                </p>
                <Button
                  onClick={onNewCustomer}
                  className="h-[37px] px-5 bg-[#1E62EC] text-white text-xs font-medium rounded-lg hover:bg-[#1E62EC]/90"
                >
                  Cadastrar cliente
                </Button>
              </div>
            ) : (
              <div className="text-center">
                <p className="text-sm font-medium text-[#727B8E]">
                  Selecione um cliente para ver detalhes
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  // Desktop view (>= lg) - Original design
  const renderDesktopView = () => (
    <div className="hidden lg:flex h-full flex-col">
      <div className="p-2 lg:p-4 border-b border-[#727B8E]/10 dark:border-[#40485A]">
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
              disabled={deletingCustomerId === customer.id}
              onClick={() => onSelect(customer.id)}
              whileHover={{ backgroundColor: "rgba(244, 246, 249, 0.5)" }}
              className={`w-full p-4 text-left border-b border-[#727B8E]/5 dark:border-[#40485A]/50 transition-colors disabled:pointer-events-none disabled:opacity-70 ${selectedId === customer.id
                ? "bg-[#F4F6F9] dark:bg-[#212225]"
                : ""
                }`}
            >
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#1E62EC]/20">
                  {deletingCustomerId === customer.id ? (
                    <Loader2 className="h-5 w-5 animate-spin text-[#1E62EC]" />
                  ) : (
                    <span className="text-sm font-medium text-[#1E62EC]">
                      {getInitials(customer.name)}
                    </span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-[#434A57] dark:text-[#f5f9fc]">
                      {customer.name}
                    </span>
                    <span
                      className={`shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full border ${customer.status === "ativo"
                        ? "bg-[#3DCA21]/20 text-[#3DCA21] border-[#3DCA21]/30"
                        : "bg-[#727B8E]/20 text-[#727B8E] border-[#727B8E]/30"
                        }`}
                    >
                      {customer.status}
                    </span>
                  </div>
                  <p className="text-xs text-[#727B8E] dark:text-[#8a94a6] mt-1">
                    {customer.petsCount} pet
                    {customer.petsCount !== 1 ? "s" : ""} •{" "}
                    {formatClientPhoneForSidebar(getClientPhoneDisplay(customer))}
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

  return (
    <>
      {renderMobileView()}
      {renderDesktopView()}
    </>
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
  deletingAppointmentId,
  deletingCustomerId,
  deletingPetId,
  onOpenAppointmentDetail,
  onSavePet,
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
  deletingAppointmentId?: string | null;
  deletingCustomerId?: string | null;
  deletingPetId?: string | null;
  onOpenAppointmentDetail?: (a: Appointment) => void;
  onSavePet: (
    pet: Omit<Pet, "id" | "customerId">,
    petId?: string,
  ) => Promise<void>;
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
  const [menuOpen, setMenuOpen] = useState(false);

  if (!customer) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex flex-1 items-center justify-center"
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

  const isDeletingCustomer = deletingCustomerId === customer.id;

  return (
    <motion.div
      key={customer.id}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="relative flex flex-1 flex-col min-h-0"
    >
      {isDeletingCustomer && (
        <div
          className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 rounded-[inherit] bg-white/75 dark:bg-[#1A1B1D]/85 backdrop-blur-[2px]"
          aria-live="polite"
          aria-busy="true"
        >
          <Loader2 className="h-9 w-9 animate-spin text-[#1E62EC]" />
          <p className="text-sm font-medium text-[#434A57] dark:text-[#f5f9fc]">
            Excluindo cliente…
          </p>
        </div>
      )}
      <div className="p-2 lg:p-4 border-b border-[#727B8E]/10 dark:border-[#40485A]">
        <div className="flex items-center gap-1 lg:gap-3">
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
                <Phone className="hidden lg:flex h-3 w-3" />
                {formatClientPhoneForSidebar(getClientPhoneDisplay(customer))}
              </span>
            </div>
          </div>
          <div className="flex items-center lg:gap-2">
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
                    disabled={deletingCustomerId === customer.id}
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-red-500 hover:bg-[#F4F6F9] dark:hover:bg-[#212225] disabled:pointer-events-none disabled:opacity-60"
                    onClick={() => {
                      void onDeleteCustomer(customer.id);
                    }}
                  >
                    {deletingCustomerId === customer.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                    Excluir cliente
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex gap-1 mx-2 lg:mx-4 mt-2 lg:mt-4 p-1 bg-[#F4F6F9] overflow-x-auto w-auto dark:bg-[#212225] rounded-lg ">
          <button
            type="button"
            onClick={() => onTabChange("pets")}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors min-w-fit ${activeTab === "pets"
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
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === "agendamentos"
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
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === "conversas"
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
                            disabled={deletingPetId === pet.id}
                            className="flex h-8 w-8 items-center justify-center rounded-full text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:pointer-events-none disabled:opacity-60"
                          >
                            {deletingPetId === pet.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
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
                              {apt.petName} • {apt.date} às{" "}
                              {apt.timeEnd
                                ? `${apt.time} – ${apt.timeEnd}`
                                : apt.time}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-xs font-medium px-2 py-1 rounded-full border ${getStatusBadgeStyle(apt.status)}`}
                          >
                            {apt.status}
                          </span>
                          {onOpenAppointmentDetail && (
                            <button
                              type="button"
                              onClick={() => onOpenAppointmentDetail(apt)}
                              className="flex h-8 w-8 items-center justify-center rounded-full text-[#1E62EC] hover:bg-[#1E62EC]/10 dark:hover:bg-[#1E62EC]/20"
                              title="Ver detalhes"
                            >
                              <Eye className="h-4 w-4" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => void onDeleteAppointment(apt.id)}
                            disabled={deletingAppointmentId === apt.id}
                            className="flex h-8 w-8 items-center justify-center rounded-full text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:pointer-events-none disabled:opacity-60"
                          >
                            {deletingAppointmentId === apt.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
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
              placeholder="Selecione uma opção"
              value={petForm.species}
              onChange={(e) => {
                setPetForm((prev) => ({ ...prev, species: e.target.value }));
                if (e.target.value) setPetFormErrors((prev) => ({ ...prev, species: undefined }));
              }}
              options={[
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                value={petForm.size}
                onChange={(e) => {
                  setPetForm((prev) => ({ ...prev, size: e.target.value }));
                  if (e.target.value) setPetFormErrors((prev) => ({ ...prev, size: undefined }));
                }}
                options={[...PET_SIZE_OPTIONS]}
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
  if (value === undefined || value === null) {
    return "";
  }
  if (String(value).trim() === "") {
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
    notes: notesForDisplay(appointment.notes) || "",
    pairedAppointmentId:
      extractPairedAppointmentId(appointment.notes) ?? undefined,
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
    manualPhone: c.manualPhone ?? undefined,
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
  const [deletingAppointmentId, setDeletingAppointmentId] = useState<
    string | null
  >(null);
  const [deletingCustomerId, setDeletingCustomerId] = useState<string | null>(
    null,
  );
  const [deletingPetId, setDeletingPetId] = useState<string | null>(null);
  const [appointmentDetail, setAppointmentDetail] = useState<Appointment | null>(
    null,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [customerForm, setCustomerForm] = useState(emptyCustomerForm);
  const [customerStep, setCustomerStep] = useState<1 | 2>(1);
  const {
    address,
    setField,
    handleCepChange,
    cepLoading,
    cepError,
    reset: resetAddress,
  } = useAddressByCep();

  const [customerStep1Errors, setCustomerStep1Errors] = useState<{
    name?: string;
    phone?: string;
  }>({});

  const goToCustomerAddressStep = useCallback(() => {
    const nameTrim = customerForm.name.trim();
    const digits = customerForm.phone.replace(/\D/g, "");
    const localDigits =
      digits.startsWith("55") && digits.length > 11 ? digits.slice(2) : digits;
    const editing = Boolean(editingCustomer);
    const next: { name?: string; phone?: string } = {};
    if (!nameTrim) next.name = "Informe o nome do tutor.";
    if (!editing && localDigits.length < 10) {
      next.phone = "Informe DDD + número (mín. 10 dígitos).";
    }
    setCustomerStep1Errors(next);
    if (Object.keys(next).length > 0) return;
    setCustomerStep(2);
  }, [customerForm.name, customerForm.phone, editingCustomer]);

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
      setCustomerStep1Errors({});
      setCustomerStep(1);
      if (editingCustomer) {
        const { address: addrLine, notes: notesOnly } = parseNotesForEdit(
          editingCustomer.notes,
        );
        setCustomerForm({
          name: editingCustomer.name,
          email: editingCustomer.email,
          // Campo "manual" para visualizacao. O `phone` (mensagens) permanece intacto no backend.
          phone: editingCustomer.manualPhone ?? "",
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
        const mergedAppointments = mergePairedByTime(
          mappedAppointments,
          (first, second) => ({
            ...first,
            pairedAppointmentId: second.id,
            timeEnd: second.time,
            notes: [first.notes, second.notes].filter(Boolean).join("\n\n") || first.notes,
          }),
        );
        setCustomers((prev) =>
          prev.map((c) =>
            c.id === customerId
              ? { ...c, appointments: mergedAppointments }
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
    if (deletingCustomerId) return;
    const customer = customers.find((item) => item.id === customerId);

    setDeletingCustomerId(customerId);
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
    } finally {
      setDeletingCustomerId(null);
    }
  };

  const handleDeletePet = async (petId: string) => {
    if (!selectedCustomer || deletingPetId) return;

    const pet = selectedCustomer.pets.find((item) => item.id === petId);

    setDeletingPetId(petId);
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
    } finally {
      setDeletingPetId(null);
    }
  };

  const handleDeleteAppointment = async (appointmentId: string) => {
    if (!selectedCustomer) return;

    const appointment = selectedCustomer.appointments.find(
      (item) => item.id === appointmentId,
    );

    if (!appointment) return;

    if (deletingAppointmentId === appointmentId) return;
    setDeletingAppointmentId(appointmentId);

    const removeIds = idsForMergedDisplayRow(appointment);

    if (appointmentId.startsWith("apt-")) {
      try {
        setCustomers((prev) =>
          prev.map((c) =>
            c.id === selectedCustomer.id
              ? {
                ...c,
                appointments: c.appointments.filter(
                  (a) => !removeIds.includes(a.id),
                ),
                totalAppointments: Math.max(
                  c.totalAppointments - removeIds.length,
                  0,
                ),
              }
              : c,
          ),
        );
        toast.info(
          "Agendamento removido",
          "O registro local foi removido da visualização do cliente.",
        );
      } finally {
        setDeletingAppointmentId(null);
      }
      return;
    }

    try {
      await appointmentService.deleteAppointment(appointmentId);
      setCustomers((prev) =>
        prev.map((c) =>
          c.id === selectedCustomer.id
            ? {
              ...c,
              appointments: c.appointments.filter(
                (a) => !removeIds.includes(a.id),
              ),
              totalAppointments: Math.max(
                c.totalAppointments - removeIds.length,
                0,
              ),
            }
            : c,
        ),
      );
      toast.success(
        "Agendamento removido",
        appointment.service
          ? `${appointment.service} foi removido com sucesso.`
          : "O agendamento foi removido com sucesso.",
      );
    } catch (error: any) {
      console.error("Erro ao cancelar agendamento:", error);
      toast.error(
        "Erro ao remover agendamento",
        error.response?.data?.detail ||
        error.response?.data?.error ||
        "Não foi possível remover o agendamento.",
      );
    } finally {
      setDeletingAppointmentId(null);
    }
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

  const handleOpenConversation = useCallback(
    (conversationId: string) => {
      navigate(`/chat?id=${encodeURIComponent(conversationId)}`);
    },
    [navigate],
  );

  const handleSaveCustomer = useCallback(async () => {
    const { name, email, phone, status, notes } = customerForm;
    const phoneValue = phone.trim();
    const editing = Boolean(editingCustomer);

    if (!name.trim()) return;
    // Na criacao, `phone` continua obrigatorio (backend exige).
    if (!editing && !phoneValue) return;

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
        // Atualiza somente o numero "manual" de visualizacao.
        // O campo `phone` (usado pela logica de envio/recepcao) permanece intacto.
        const updated = await clientService.updateClient(editingCustomer.id, {
          ...(phoneValue ? { manualPhone: phoneValue } : {}),
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
          manualPhone: phoneValue,
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
          onSearchClick={() => {
            console.log('click search');
            setSearchModalOpen(true)
          }}
          loading={customersLoading}
          error={customersError}
          deletingCustomerId={deletingCustomerId}
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
          deletingAppointmentId={deletingAppointmentId}
          deletingCustomerId={deletingCustomerId}
          deletingPetId={deletingPetId}
          onOpenAppointmentDetail={setAppointmentDetail}
          onSavePet={handleSavePet}
          onOpenConversation={handleOpenConversation}
          activeTab={activeTab}
          onTabChange={handleTabChange}
          loadingPets={loadingPets}
          loadingAppointments={loadingAppointments}
          loadingConversations={loadingConversations}
        />
      </AnimatePresence>

      <Modal
        isOpen={appointmentDetail !== null}
        onClose={() => setAppointmentDetail(null)}
        title="Detalhes do agendamento"
        className="max-w-[440px]"
      >
        {appointmentDetail && (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`text-xs font-medium px-2 py-1 rounded-full border ${getStatusBadgeStyle(appointmentDetail.status)}`}
              >
                {appointmentDetail.status}
              </span>
            </div>
            <div className="rounded-lg bg-[#F4F6F9] dark:bg-[#212225] p-4 space-y-2.5 text-[#434A57] dark:text-[#f5f9fc]">
              <div className="flex justify-between gap-3">
                <span className="text-[#727B8E] dark:text-[#8a94a6]">Serviço</span>
                <span className="text-right font-medium">{appointmentDetail.service}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-[#727B8E] dark:text-[#8a94a6]">Pet</span>
                <span className="text-right font-medium">{appointmentDetail.petName}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-[#727B8E] dark:text-[#8a94a6]">Data e horário</span>
                <span className="text-right font-medium">
                  {appointmentDetail.date} às{" "}
                  {appointmentDetail.timeEnd
                    ? `${appointmentDetail.time} – ${appointmentDetail.timeEnd}`
                    : appointmentDetail.time}
                </span>
              </div>
              <div className="border-t border-[#727B8E]/15 pt-3 dark:border-[#40485A]">
                <p className="text-xs font-semibold uppercase tracking-wide text-[#727B8E] dark:text-[#8a94a6] mb-1.5">
                  Descrição
                </p>
                {appointmentDetail.notes ? (
                  <p className="whitespace-pre-wrap text-[#434A57] dark:text-[#f5f9fc]">
                    {appointmentDetail.notes}
                  </p>
                ) : (
                  <p className="text-xs text-[#727B8E] dark:text-[#8a94a6]">
                    Nenhuma descrição registrada.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={searchModalOpen}
        onClose={() => setSearchModalOpen(false)}
        title="Buscar clientes"
        className="max-w-[500px] max-h-[85vh] flex flex-col overflow-hidden"
      >
        <div className="flex flex-col gap-4 overflow-y-auto max-h-[520px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#727B8E] dark:text-[#8a94a6]" />
            <input
              type="text"
              placeholder="Buscar clientes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg  bg-[#F4F6F9] dark:bg-[#212225] border-none pl-10 pr-4 py-2.5 text-sm text-[#434A57] dark:text-[#f5f9fc] placeholder:text-[#727B8E] dark:placeholder:text-[#8a94a6] outline-none"
            />
          </div>

          <div className="flex flex-col gap-2">
            {customers
              .filter(
                (customer) =>
                  customer.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                  customer.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
                  customer.phone.includes(searchQuery) ||
                  getClientPhoneDisplay(customer).includes(searchQuery)
              )
              .map((customer) => (
                <button
                  key={customer.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(customer.id);
                    setSearchModalOpen(false);
                  }}
                  className="w-full p-4 text-left border border-[#727B8E]/10 dark:border-[#40485A] rounded-xl hover:bg-[#F4F6F9] dark:hover:bg-[#212225] transition-colors"
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
                        {customer.petsCount} pet{customer.petsCount !== 1 ? "s" : ""} •{" "}
                        {formatClientPhoneForSidebar(getClientPhoneDisplay(customer))}
                      </p>
                      <p className="text-xs text-[#727B8E] dark:text-[#8a94a6] mt-0.5">
                        {customer.totalAppointments} agendamentos
                      </p>
                    </div>
                  </div>
                </button>
              ))}
            {customers.filter(
              (customer) =>
                customer.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                customer.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
                customer.phone.includes(searchQuery) ||
                getClientPhoneDisplay(customer).includes(searchQuery)
            ).length === 0 && (
              <div className="text-center py-8 text-[#727B8E] dark:text-[#8a94a6]">
                <Search className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>Nenhum cliente encontrado</p>
              </div>
            )}
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={customerModalOpen}
        onClose={() =>
          customerStep === 2 ? setCustomerStep(1) : setCustomerModalOpen(false)
        }
        title={editingCustomer ? "Editar cliente" : "Novo cliente"}
        onSubmit={
          customerStep === 1
            ? () => goToCustomerAddressStep()
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
              <div>
                <Input
                  label="Nome"
                  placeholder="Nome do tutor"
                  value={customerForm.name}
                  onChange={(e) => {
                    setCustomerForm((f) => ({ ...f, name: e.target.value }));
                    if (e.target.value.trim())
                      setCustomerStep1Errors((prev) => ({
                        ...prev,
                        name: undefined,
                      }));
                  }}
                  required
                />
                {customerStep1Errors.name && (
                  <p className="mt-1 text-xs text-red-500">
                    {customerStep1Errors.name}
                  </p>
                )}
              </div>
              <div>
                <Input
                  label="Telefone"
                  placeholder="(11) 99999-9999"
                  value={customerForm.phone}
                  onChange={(e) => {
                    setCustomerForm((f) => ({
                      ...f,
                      // Evita letras (ex.: colar texto) no valor do telefone.
                      // Mantemos '@' caso venha um identificador especial.
                      phone: maskPhone(e.target.value.replace(/[a-z]/gi, "")),
                    }));
                    setCustomerStep1Errors((prev) => ({
                      ...prev,
                      phone: undefined,
                    }));
                  }}
                  required={!editingCustomer}
                />
                {customerStep1Errors.phone && (
                  <p className="mt-1 text-xs text-red-500">
                    {customerStep1Errors.phone}
                  </p>
                )}
              </div>
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
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  label="Bairro"
                  placeholder="Bairro"
                  value={address.bairro}
                  onChange={(e) => setField("bairro", e.target.value)}
                />
                <Input
                  label="Cidade"
                  placeholder="Cidade"
                  value={address.cidade}
                  onChange={(e) => setField("cidade", e.target.value)}
                />
              </div>
              <Input
                label="UF"
                placeholder="UF"
                value={address.uf}
                onChange={(e) =>
                  setField("uf", e.target.value.toUpperCase().slice(0, 2))
                }
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
