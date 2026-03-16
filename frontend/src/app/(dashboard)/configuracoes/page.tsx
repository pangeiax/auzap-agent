import { useState, useEffect, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import {
  Crown,
  Settings as SettingsIcon,
  Loader2,
  X,
  Smartphone,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Plus,
  Edit2,
  Trash2,
  Clock,
} from "lucide-react";
import { DashboardLayout } from "@/components/templates/DashboardLayout";
import {
  SettingsTabs,
  type SettingsTabId,
} from "@/components/molecules/SettingsTabs";
import { Input } from "@/components/atoms/Input";
import { TextArea } from "@/components/atoms/TextArea";
import { Button } from "@/components/atoms/Button";
import { Modal } from "@/components/molecules/Modal";
import { getImage } from "@/assets/images";
import {
  maskPhone,
  maskCardNumber,
  maskCardExpiry,
  maskCvv,
  maskCurrency,
  unmaskCurrency,
} from "@/lib/masks";
import { useAddressByCep, useToast } from "@/hooks";
import {
  petshopService,
  serviceService,
  whatsappService,
  paymentService,
} from "@/services";
import { useAuthContext } from "@/contexts/AuthContext";
import type { Petshop } from "@/types";
import type { Service } from "@/types";

function SettingsProfileSidebar({
  petshop,
  loading,
  error,
  onNovoServico,
  showNovoServico,
  onLogout,
}: {
  petshop: Petshop | null;
  loading?: boolean;
  error?: string | null;
  onNovoServico?: () => void;
  showNovoServico: boolean;
  onLogout: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-center gap-4 rounded-lg sm:flex-row sm:items-start">
        <img
          width={200}
          height={200}
          alt="Estabelecimento avatar"
          className="size-24 object-cover rounded-full"
          src={getImage("cleber_santos").src}
        />
        <div>
          {loading ? (
            <div className="mt-3 h-5 w-32 animate-pulse rounded bg-[#727B8E]/20" />
          ) : error ? (
            <p className="mt-3 text-sm text-amber-600 dark:text-amber-400">
              {error}
            </p>
          ) : (
            <>
              <p className="mt-3 text-base font-semibold text-[#434A57] dark:text-[#f5f9fc]">
                {petshop?.company?.name ??
                  petshop?.assistantName ??
                  "Estabelecimento"}
              </p>
              <p className="text-sm text-[#727B8E] dark:text-[#8a94a6]">
                {petshop?.phone || petshop?.ownerPhone || "—"}
              </p>
            </>
          )}
        </div>
      </div>

      {showNovoServico && onNovoServico && (
        <Button
          size="sm"
          className="flex w-full items-center gap-2 bg-[#0e1629] text-white hover:opacity-90"
          onClick={onNovoServico}
        >
          <Crown className="h-4 w-4" />
          Novo serviço
        </Button>
      )}

      <button
        type="button"
        onClick={onLogout}
        className="flex w-full items-center gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-100 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-400 dark:hover:bg-red-950/40"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.67"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0"
        >
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <polyline points="16 17 21 12 16 7" />
          <line x1="21" y1="12" x2="9" y2="12" />
        </svg>
        Sair da conta
      </button>
    </div>
  );
}

function ServicosContent({
  services,
  loading,
  petshopId,
  onEditService,
  onRefresh,
}: {
  services: Service[];
  loading?: boolean;
  petshopId: number;
  onEditService: (service: Service) => void;
  onRefresh: () => void;
}) {
  const toast = useToast();
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [serviceToDelete, setServiceToDelete] = useState<Service | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [togglingId, setTogglingId] = useState<number | null>(null);

  const handleConfirmDelete = async () => {
    if (!serviceToDelete) return;
    setDeleting(true);
    try {
      await serviceService.deleteService(serviceToDelete.id);
      toast.success(
        "Serviço deletado!",
        `"${serviceToDelete.name}" foi removido.`,
      );
      setDeleteModalOpen(false);
      setServiceToDelete(null);
      onRefresh();
    } catch {
      toast.error("Erro", "Não foi possível deletar o serviço.");
    } finally {
      setDeleting(false);
    }
  };

  const handleToggle = async (s: Service) => {
    setTogglingId(s.id);
    try {
      await serviceService.updateService(s.id, { is_active: !s.isActive });
      toast.success(
        "Status atualizado!",
        s.isActive ? "Serviço desativado." : "Serviço ativado.",
      );
      onRefresh();
    } catch {
      toast.error("Erro", "Não foi possível alterar o status.");
    } finally {
      setTogglingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-[#727B8E] dark:text-[#8a94a6]">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando serviços...
      </div>
    );
  }
  if (!services.length) {
    return (
      <p className="text-sm text-[#727B8E] dark:text-[#8a94a6]">
        Nenhum serviço cadastrado. Use o botão &quot;Novo serviço&quot; para
        adicionar.
      </p>
    );
  }
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {services.map((s) => (
          <div
            key={s.id}
            className="flex flex-col gap-2 rounded-lg border border-[#727B8E]/10 bg-white dark:border-[#40485A] dark:bg-[#1A1B1D] p-4 relative"
          >
            <h3 className="text-base font-semibold text-[#434A57] dark:text-[#f5f9fc] pr-14">
              {s.name}
            </h3>
            <p className="text-sm text-[#727B8E] dark:text-[#8a94a6]">
              {s.description || "Sem descrição"}
            </p>
            <p className="text-sm text-[#727B8E] dark:text-[#8a94a6]">
              {s.durationMin} min
              {s.price ? ` • R$ ${Number(s.price).toFixed(2)}` : ""}
              {s.priceBySize
                ? ` • P: R$${s.priceBySize.small ?? "-"} M: R$${s.priceBySize.medium ?? "-"} G: R$${s.priceBySize.large ?? "-"}`
                : ""}
            </p>
            <span
              className={`absolute top-3 right-3 inline-flex px-2 py-1 rounded-full text-[8px] font-medium border ${
                s.isActive
                  ? "border-[#3CD057]/36 bg-[#D4F3D6] text-[#3CD057]"
                  : "border-gray-200 bg-gray-100 text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400"
              }`}
            >
              {s.isActive ? "ATIVO" : "INATIVO"}
            </span>

            <div className="mt-2 flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex items-center gap-1"
                onClick={() => onEditService(s)}
              >
                <Edit2 className="h-3 w-3" />
                Editar
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="flex items-center gap-1"
                disabled={togglingId === s.id}
                onClick={() => handleToggle(s)}
              >
                {togglingId === s.id ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Clock className="h-3 w-3" />
                )}
                {s.isActive ? "Desativar" : "Ativar"}
              </Button>
              <button
                type="button"
                onClick={() => {
                  setServiceToDelete(s);
                  setDeleteModalOpen(true);
                }}
                className="rounded p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors"
                aria-label="Deletar"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <Modal
        isOpen={deleteModalOpen}
        onClose={() => {
          setDeleteModalOpen(false);
          setServiceToDelete(null);
        }}
        title="Confirmar exclusão"
        className="max-w-[400px]"
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-[#727B8E] dark:text-[#8a94a6]">
            Tem certeza que deseja deletar o serviço{" "}
            <span className="font-semibold text-[#434A57] dark:text-[#f5f9fc]">
              &quot;{serviceToDelete?.name}&quot;
            </span>
            ? Esta ação não pode ser desfeita.
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setDeleteModalOpen(false);
                setServiceToDelete(null);
              }}
              disabled={deleting}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleConfirmDelete}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {deleting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Deletando...
                </>
              ) : (
                "Sim, deletar"
              )}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

function EmpresaContent({
  petshop,
  loading,
  onSave,
}: {
  petshop: Petshop | null;
  loading?: boolean;
  onSave: (data: {
    name?: string;
    phone?: string;
    address?: string;
    cep?: string;
    owner_phone?: string;
    emergency_contact?: string;
  }) => Promise<void>;
}) {
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [ownerPhone, setOwnerPhone] = useState("");
  const [emergencyContact, setEmergencyContact] = useState("");
  const [saving, setSaving] = useState(false);
  const {
    address,
    setField,
    handleCepChange,
    cepLoading,
    cepError,
    isFieldDisabled,
    setAddress,
  } = useAddressByCep();

  useEffect(() => {
    if (!petshop) return;
    setNome(petshop.company?.name || "");
    setTelefone(petshop.phone || "");
    // Unmask stored phone to local display format: "5511963482461" → "(11) 96348-2461"
    const normalizePhone = (raw: string) => {
      const digits = raw.replace(/\D/g, "");
      const local =
        digits.length === 13 && digits.startsWith("55")
          ? digits.slice(2)
          : digits;
      return maskPhone(local);
    };
    setOwnerPhone(normalizePhone(petshop.ownerPhone || ""));
    setEmergencyContact(normalizePhone(petshop.emergencyContact || ""));
    setAddress({
      cep: petshop.cep || "",
      rua: petshop.address || "",
      numero: "",
      complemento: "",
      bairro: "",
      cidade: "",
      uf: "",
    });
  }, [petshop]);

  const handleSubmit = async () => {
    setSaving(true);
    // Unmask phone to "5511963482461" format before saving
    const toE164 = (masked: string) => {
      const digits = masked.replace(/\D/g, "");
      if (!digits) return undefined;
      return digits.startsWith("55") ? digits : "55" + digits;
    };
    try {
      await onSave({
        name: nome || undefined,
        phone: telefone,
        address: address.rua || undefined,
        cep: address.cep || undefined,
        owner_phone: toE164(ownerPhone),
        emergency_contact: toE164(emergencyContact),
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-[#727B8E] dark:text-[#8a94a6]">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando...
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 pb-8">
      <section>
        <h3 className="mb-4 text-base font-semibold text-[#434A57] dark:text-[#f5f9fc]">
          Informações da empresa
        </h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Nome da empresa"
            placeholder="Nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
          />
          <Input
            label="Telefone"
            placeholder="(11) 99999-9999"
            value={telefone}
            onChange={(e) => setTelefone(maskPhone(e.target.value))}
          />
          <Input
            label="Telefone do responsável"
            placeholder="(11) 99999-9999"
            value={ownerPhone}
            onChange={(e) => setOwnerPhone(maskPhone(e.target.value))}
          />
          <Input
            label="Contato de emergência"
            placeholder="(11) 99999-9999"
            value={emergencyContact}
            onChange={(e) => setEmergencyContact(maskPhone(e.target.value))}
          />
        </div>
      </section>
      <section>
        <h3 className="mb-4 text-base font-semibold text-[#434A57] dark:text-[#f5f9fc]">
          Endereço
        </h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="relative sm:col-span-2">
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
            label="Endereço (Rua)"
            placeholder="Logradouro"
            value={address.rua}
            onChange={(e) => setField("rua", e.target.value)}
            disabled={isFieldDisabled("rua")}
          />
          <Input
            label="Cidade"
            placeholder="Cidade"
            value={address.cidade}
            onChange={(e) => setField("cidade", e.target.value)}
            disabled={isFieldDisabled("cidade")}
          />
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
          <Input
            label="Bairro"
            placeholder="Bairro"
            value={address.bairro}
            onChange={(e) => setField("bairro", e.target.value)}
            disabled={isFieldDisabled("bairro")}
          />
          <Input
            label="Estado (UF)"
            placeholder="UF"
            value={address.uf}
            onChange={(e) =>
              setField("uf", e.target.value.toUpperCase().slice(0, 2))
            }
            disabled={isFieldDisabled("uf")}
          />
        </div>
      </section>

      <div className="flex justify-end gap-3">
        <Button type="button" variant="outline" disabled={saving}>
          Cancelar
        </Button>
        <Button type="button" onClick={handleSubmit} disabled={saving}>
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Salvando...
            </>
          ) : (
            "Salvar"
          )}
        </Button>
      </div>
    </div>
  );
}

function WhatsAppContent({
  status,
  loading,
}: {
  status: { status: string; phone?: string; last_connected?: string; error_message?: string } | null;
  loading?: boolean;
}) {
  const toast = useToast();
  const [connectionStatus, setConnectionStatus] = useState<
    "disconnected" | "qr" | "connecting" | "connected"
  >("disconnected");
  const [qrCode, setQrCode] = useState("");
  const [connectedPhone, setConnectedPhone] = useState("");
  const [lastConnected, setLastConnected] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const statusCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Verificar status inicial e polling
  useEffect(() => {
    checkConnectionStatus();

    // Poll status a cada 2 segundos quando em modo QR ou connecting
    if (connectionStatus === "qr" || connectionStatus === "connecting") {
      statusCheckIntervalRef.current = setInterval(checkConnectionStatus, 2000);
    }

    return () => {
      if (statusCheckIntervalRef.current) {
        clearInterval(statusCheckIntervalRef.current);
      }
    };
  }, [connectionStatus]);

  const checkConnectionStatus = async () => {
    try {
      const data = await whatsappService.getStatus();

      if (data.status === "connected") {
        setConnectionStatus("connected");
        setConnectedPhone(data.phone || "WhatsApp Conectado");
        setLastConnected((data as any).last_connected ?? null);
        setQrCode("");
        if (statusCheckIntervalRef.current) {
          clearInterval(statusCheckIntervalRef.current);
        }
      } else {
        setLastConnected((data as any).last_connected ?? null);
      }
    } catch (error) {
      console.error("Erro ao verificar status:", error);
    }
  };

  const handleGenerateQR = async () => {
    setIsGenerating(true);
    setConnectionStatus("connecting");

    try {
      const data = await whatsappService.getQRCode();

      if (data.qr) {
        setQrCode(data.qr);
        setConnectionStatus("qr");
        toast.success(
          "QR Code gerado!",
          "Escaneie com seu WhatsApp para conectar.",
        );
      } else {
        throw new Error("QR Code não disponível");
      }
    } catch (error) {
      toast.error("Erro ao gerar QR Code", "Tente novamente.");
      setConnectionStatus("disconnected");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await whatsappService.logout();
      setConnectionStatus("disconnected");
      setQrCode("");
      setConnectedPhone("");
      toast.info(
        "WhatsApp desconectado",
        "Você pode reconectar a qualquer momento.",
      );
    } catch (error) {
      toast.error("Erro ao desconectar", "Tente novamente.");
    }
  };

  const handleRefreshQR = () => {
    handleGenerateQR();
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-[#727B8E] dark:text-[#8a94a6]">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando...
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 pb-8">
      <section>
        <h3 className="mb-4 text-base font-semibold text-[#434A57] dark:text-[#f5f9fc]">
          Conexão com WhatsApp
        </h3>
        <p className="mb-6 text-sm text-[#727B8E] dark:text-[#8a94a6]">
          Conecte seu WhatsApp para receber notificações e enviar mensagens
          automaticamente para seus clientes.
        </p>

        {/* Status da Conexão */}
        <div className="mb-6 rounded-lg border border-[#727B8E]/10 bg-white dark:border-[#40485A] dark:bg-[#1A1B1D] p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {connectionStatus === "connected" ? (
                <>
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-950/30">
                    <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[#434A57] dark:text-[#f5f9fc]">
                      WhatsApp Conectado
                    </p>
                    <p className="text-xs text-[#727B8E] dark:text-[#8a94a6]">
                      {connectedPhone}
                    </p>
                  </div>
                </>
              ) : connectionStatus === "connecting" ? (
                <>
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-950/30">
                    <Loader2 className="h-6 w-6 animate-spin text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[#434A57] dark:text-[#f5f9fc]">
                      Conectando...
                    </p>
                    <p className="text-xs text-[#727B8E] dark:text-[#8a94a6]">
                      Aguarde enquanto estabelecemos a conexão
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-950/30">
                    <AlertCircle className="h-6 w-6 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[#434A57] dark:text-[#f5f9fc]">
                      WhatsApp Desconectado
                    </p>
                    <p className="text-xs text-[#727B8E] dark:text-[#8a94a6]">
                      {lastConnected
                        ? `Última conexão: ${new Date(lastConnected).toLocaleString("pt-BR")}`
                        : "Conecte seu WhatsApp para começar"}
                    </p>
                  </div>
                </>
              )}
            </div>

            {connectionStatus === "connected" && (
              <Button variant="outline" size="sm" onClick={handleDisconnect}>
                Desconectar
              </Button>
            )}
          </div>
        </div>

        {/* QR Code ou Botão de Conectar */}
        {connectionStatus === "disconnected" && (
          <div className="flex flex-col items-center justify-center rounded-lg border border-[#727B8E]/10 bg-[#F4F6F9] dark:border-[#40485A] dark:bg-[#212225] p-8">
            <Smartphone className="mb-4 h-16 w-16 text-[#727B8E] dark:text-[#8a94a6]" />
            <h4 className="mb-2 text-base font-semibold text-[#434A57] dark:text-[#f5f9fc]">
              Conecte seu WhatsApp
            </h4>
            <p className="mb-6 text-center text-sm text-[#727B8E] dark:text-[#8a94a6]">
              Gere um QR Code para conectar sua conta do WhatsApp Business ou
              pessoal
            </p>
            <Button onClick={handleGenerateQR} disabled={isGenerating}>
              {isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Gerando QR Code...
                </>
              ) : (
                "Gerar QR Code"
              )}
            </Button>
          </div>
        )}

        {connectionStatus === "qr" && qrCode && (
          <div className="flex flex-col items-center justify-center rounded-lg border border-[#1E62EC]/20 bg-white dark:border-[#1E62EC]/30 dark:bg-[#1A1B1D] p-8">
            <h4 className="mb-4 text-base font-semibold text-[#434A57] dark:text-[#f5f9fc]">
              Escaneie o QR Code
            </h4>

            <div className="mb-6 rounded-lg bg-white p-4 shadow-lg">
              <img src={qrCode} alt="QR Code WhatsApp" className="h-64 w-64" />
            </div>

            <div className="mb-6 max-w-md space-y-3 text-sm text-[#727B8E] dark:text-[#8a94a6]">
              <div className="flex items-start gap-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#1E62EC]/10 text-xs font-semibold text-[#1E62EC]">
                  1
                </span>
                <p>Abra o WhatsApp no seu celular</p>
              </div>
              <div className="flex items-start gap-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#1E62EC]/10 text-xs font-semibold text-[#1E62EC]">
                  2
                </span>
                <p>
                  Toque em <strong>Mais opções</strong> (⋮) &gt;{" "}
                  <strong>Aparelhos conectados</strong>
                </p>
              </div>
              <div className="flex items-start gap-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#1E62EC]/10 text-xs font-semibold text-[#1E62EC]">
                  3
                </span>
                <p>
                  Toque em <strong>Conectar um aparelho</strong> e aponte seu
                  celular para esta tela para escanear o código
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => setConnectionStatus("disconnected")}
              >
                Cancelar
              </Button>
              <Button variant="outline" onClick={handleRefreshQR}>
                <RefreshCw className="h-4 w-4" />
                Atualizar QR Code
              </Button>
            </div>
          </div>
        )}

        {connectionStatus === "connecting" && (
          <div className="flex flex-col items-center justify-center rounded-lg border border-[#1E62EC]/20 bg-white dark:border-[#1E62EC]/30 dark:bg-[#1A1B1D] p-8">
            <Loader2 className="mb-4 h-16 w-16 animate-spin text-[#1E62EC]" />
            <h4 className="mb-2 text-base font-semibold text-[#434A57] dark:text-[#f5f9fc]">
              Conectando...
            </h4>
            <p className="text-center text-sm text-[#727B8E] dark:text-[#8a94a6]">
              Estamos estabelecendo a conexão com seu WhatsApp
            </p>
          </div>
        )}
      </section>

      {/* Informações Adicionais */}
      {connectionStatus === "connected" && (
        <section>
          <h3 className="mb-4 text-base font-semibold text-[#434A57] dark:text-[#f5f9fc]">
            Configurações de Mensagens
          </h3>
          <div className="space-y-4">
            <div className="rounded-lg border border-[#727B8E]/10 bg-white dark:border-[#40485A] dark:bg-[#1A1B1D] p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-[#434A57] dark:text-[#f5f9fc]">
                    Notificações de Novos Agendamentos
                  </p>
                  <p className="mt-1 text-xs text-[#727B8E] dark:text-[#8a94a6]">
                    Receba uma mensagem quando um novo agendamento for feito
                  </p>
                </div>
                <input
                  type="checkbox"
                  defaultChecked
                  className="h-5 w-5 rounded border-[#727B8E]/30 text-[#1E62EC] focus:ring-2 focus:ring-[#1E62EC]/20"
                />
              </div>
            </div>

            <div className="rounded-lg border border-[#727B8E]/10 bg-white dark:border-[#40485A] dark:bg-[#1A1B1D] p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-[#434A57] dark:text-[#f5f9fc]">
                    Lembrete para Clientes
                  </p>
                  <p className="mt-1 text-xs text-[#727B8E] dark:text-[#8a94a6]">
                    Enviar lembrete automático 1 dia antes do agendamento
                  </p>
                </div>
                <input
                  type="checkbox"
                  defaultChecked
                  className="h-5 w-5 rounded border-[#727B8E]/30 text-[#1E62EC] focus:ring-2 focus:ring-[#1E62EC]/20"
                />
              </div>
            </div>

            <div className="rounded-lg border border-[#727B8E]/10 bg-white dark:border-[#40485A] dark:bg-[#1A1B1D] p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-[#434A57] dark:text-[#f5f9fc]">
                    Confirmação de Agendamento
                  </p>
                  <p className="mt-1 text-xs text-[#727B8E] dark:text-[#8a94a6]">
                    Enviar confirmação imediata após agendamento
                  </p>
                </div>
                <input
                  type="checkbox"
                  defaultChecked
                  className="h-5 w-5 rounded border-[#727B8E]/30 text-[#1E62EC] focus:ring-2 focus:ring-[#1E62EC]/20"
                />
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function PagamentoContent({
  stats,
  loading,
}: {
  stats: {
    total_revenue?: number;
    total_payments?: number;
    average_ticket?: number;
  } | null;
  loading?: boolean;
}) {
  const [cardNumber, setCardNumber] = useState("");
  const [cardName, setCardName] = useState("");
  const [cardExpiry, setCardExpiry] = useState("");
  const [cardCvv, setCardCvv] = useState("");
  return (
    <div className="flex flex-col gap-6">
      <h3 className="text-base font-semibold text-[#434A57] dark:text-[#f5f9fc]">
        Assinatura & Pagamento
      </h3>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-[#727B8E] dark:text-[#8a94a6]">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando...
        </div>
      ) : stats ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 justify-between rounded-lg border border-[#727b8e19] bg-[#1e62ec38] p-4 text-[#1E62EC]">
            <div>
              <p className="flex items-center gap-2 text-sm">
                <span className="font-medium">Resumo</span>
              </p>
              <p className="mt-1 text-sm">
                Receita total: R$ {Number(stats.total_revenue ?? 0).toFixed(2)}{" "}
                • {stats.total_payments ?? 0} pagamentos
              </p>
            </div>
            <p className="text-lg font-semibold">
              Ticket médio: R$ {Number(stats.average_ticket ?? 0).toFixed(2)}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 justify-between rounded-lg border border-[#727b8e19] bg-[#1e62ec38] p-4 text-[#1E62EC]">
          <div>
            <p className="font-medium text-sm">Plano Profissional: Ativo</p>
            <p className="mt-1 text-sm">
              Próxima cobrança: 15 de Fevereiro de 2026
            </p>
          </div>
          <p className="text-lg font-semibold">R$ 99</p>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="Número do Cartão"
          placeholder="0000 0000 0000 0000"
          value={cardNumber}
          onChange={(e) => setCardNumber(maskCardNumber(e.target.value))}
          maxLength={19}
        />
        <Input
          label="Nome do Cartão"
          placeholder="Nome no cartão"
          value={cardName}
          onChange={(e) => setCardName(e.target.value)}
        />
        <Input
          label="Validade"
          placeholder="MM/AA"
          value={cardExpiry}
          onChange={(e) => setCardExpiry(maskCardExpiry(e.target.value))}
          maxLength={5}
        />
        <Input
          label="CVV"
          placeholder="***"
          type="password"
          value={cardCvv}
          onChange={(e) => setCardCvv(maskCvv(e.target.value))}
          maxLength={4}
          inputMode="numeric"
        />
      </div>
      <p className="text-xs text-[#000]/50 dark:text-[#8a94a6]/70">
        Seus dados estão protegidos com criptografia de ponta a ponta
      </p>
      <div className="flex justify-end gap-3">
        <Button variant="outline">Cancelar</Button>
        <Button>Salvar</Button>
      </div>
    </div>
  );
}

function HorariosContent({
  petshop,
  loading,
  onSave,
}: {
  petshop: Petshop | null;
  loading?: boolean;
  onSave: (data: {
    business_hours: Record<
      string,
      { open: string; close: string } | { closed: boolean }
    >;
    default_capacity_per_hour?: number;
    custom_capacity_hours?: any;
  }) => Promise<void>;
}) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);

  const DIAS: { key: string; label: string }[] = [
    { key: "monday", label: "Segunda-feira" },
    { key: "tuesday", label: "Terça-feira" },
    { key: "wednesday", label: "Quarta-feira" },
    { key: "thursday", label: "Quinta-feira" },
    { key: "friday", label: "Sexta-feira" },
    { key: "saturday", label: "Sábado" },
    { key: "sunday", label: "Domingo" },
  ];

  const [hours, setHours] = useState<
    Record<string, { enabled: boolean; open: string; close: string }>
  >(() => {
    const defaults = Object.fromEntries(
      DIAS.map(({ key }) => [
        key,
        {
          enabled: [
            "monday",
            "tuesday",
            "wednesday",
            "thursday",
            "friday",
          ].includes(key),
          open: "09:00",
          close: "18:00",
        },
      ]),
    );
    if (petshop?.businessHours) {
      Object.entries(petshop.businessHours).forEach(([key, val]) => {
        if (val?.open && val?.close) {
          defaults[key] = { enabled: true, open: val.open, close: val.close };
        } else if (val?.closed) {
          defaults[key] = { ...defaults[key], enabled: false };
        }
      });
    }
    return defaults;
  });

  const [defaultCapacity, setDefaultCapacity] = useState(
    petshop?.defaultCapacityPerHour ?? 8,
  );

  // Custom capacity hours state
  const [customCapacities, setCustomCapacities] = useState<
    { date: string; capacity: number }[]
  >([]);
  const [hourlyCapacities, setHourlyCapacities] = useState<
    { day: string; hour: string; capacity: number }[]
  >([]);
  const [customModalOpen, setCustomModalOpen] = useState(false);
  const [customDate, setCustomDate] = useState("");
  const [customCap, setCustomCap] = useState("");
  const [hourlyModalOpen, setHourlyModalOpen] = useState(false);
  const [hourlyDay, setHourlyDay] = useState("monday");
  const [hourlyHour, setHourlyHour] = useState("");
  const [hourlyCap, setHourlyCap] = useState("");

  useEffect(() => {
    if (!petshop) return;
    const initial = Object.fromEntries(
      DIAS.map(({ key }) => [
        key,
        {
          enabled: [
            "monday",
            "tuesday",
            "wednesday",
            "thursday",
            "friday",
          ].includes(key),
          open: "09:00",
          close: "18:00",
        },
      ]),
    );
    if (petshop.businessHours) {
      Object.entries(petshop.businessHours).forEach(([key, val]) => {
        if (val?.open && val?.close) {
          initial[key] = { enabled: true, open: val.open, close: val.close };
        } else if (val?.closed) {
          initial[key] = { ...initial[key], enabled: false };
        }
      });
    }
    setHours(initial);
    setDefaultCapacity(petshop.defaultCapacityPerHour ?? 8);

    // Load custom capacity hours
    const custom = petshop.customCapacityHours as {
      dates?: Record<string, number>;
      hourly?: Record<string, Record<string, number>>;
    } | null;
    if (custom?.dates) {
      setCustomCapacities(
        Object.entries(custom.dates).map(([date, capacity]) => ({
          date,
          capacity: capacity as number,
        })),
      );
    } else {
      setCustomCapacities([]);
    }
    if (custom?.hourly) {
      const hourly: { day: string; hour: string; capacity: number }[] = [];
      for (const [day, hours] of Object.entries(custom.hourly)) {
        for (const [hour, capacity] of Object.entries(
          hours as Record<string, number>,
        )) {
          hourly.push({ day, hour, capacity });
        }
      }
      setHourlyCapacities(hourly);
    } else {
      setHourlyCapacities([]);
    }
  }, [petshop]);

  const handleToggle = (key: string) => {
    setHours((prev) => ({
      ...prev,
      [key]: { ...prev[key], enabled: !prev[key].enabled },
    }));
  };

  const handleTimeChange = (
    key: string,
    field: "open" | "close",
    value: string,
  ) => {
    setHours((prev) => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
  };

  const handleAddCustomCapacity = () => {
    if (!customDate || !customCap) return;
    const cap = parseInt(customCap);
    if (cap < 1) return;
    setCustomCapacities((prev) => {
      const without = prev.filter((c) => c.date !== customDate);
      return [...without, { date: customDate, capacity: cap }];
    });
    setCustomModalOpen(false);
    setCustomDate("");
    setCustomCap("");
  };

  const handleAddHourlyCapacity = () => {
    if (!hourlyHour || !hourlyCap) return;
    const cap = parseInt(hourlyCap);
    if (cap < 1) return;
    setHourlyCapacities((prev) => {
      const without = prev.filter(
        (h) => !(h.day === hourlyDay && h.hour === hourlyHour),
      );
      return [...without, { day: hourlyDay, hour: hourlyHour, capacity: cap }];
    });
    setHourlyModalOpen(false);
    setHourlyDay("monday");
    setHourlyHour("");
    setHourlyCap("");
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const business_hours: Record<
        string,
        { open: string; close: string } | { closed: boolean }
      > = {};
      Object.entries(hours).forEach(([key, val]) => {
        if (val.enabled) {
          business_hours[key] = { open: val.open, close: val.close };
        } else {
          business_hours[key] = { closed: true };
        }
      });
      const custom_capacity_hours = {
        dates: Object.fromEntries(
          customCapacities.map((c) => [c.date, c.capacity]),
        ),
        hourly: hourlyCapacities.reduce<Record<string, Record<string, number>>>(
          (acc, h) => {
            if (!acc[h.day]) acc[h.day] = {};
            acc[h.day][h.hour] = h.capacity;
            return acc;
          },
          {},
        ),
      };
      await onSave({
        business_hours,
        default_capacity_per_hour: defaultCapacity,
        custom_capacity_hours,
      });
      toast.success("Horários salvos!", "As configurações foram atualizadas.");
    } catch {
      toast.error("Erro ao salvar", "Não foi possível salvar os horários.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-[#727B8E] dark:text-[#8a94a6]">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando...
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 pb-8">
      <section>
        <h3 className="mb-4 text-base font-semibold text-[#434A57] dark:text-[#f5f9fc]">
          Horário de Funcionamento
        </h3>
        <div className="space-y-3">
          {DIAS.map(({ key, label }) => (
            <div
              key={key}
              className="flex flex-col gap-3 rounded-lg border border-[#727B8E]/10 bg-white dark:border-[#40485A] dark:bg-[#1A1B1D] p-4"
            >
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={hours[key]?.enabled ?? false}
                  onChange={() => handleToggle(key)}
                  className="h-4 w-4 rounded border-[#727B8E]/30 text-[#1E62EC] focus:ring-2 focus:ring-[#1E62EC]/20"
                />
                <span className="flex-1 text-sm font-medium text-[#434A57] dark:text-[#f5f9fc]">
                  {label}
                </span>
                {!hours[key]?.enabled && (
                  <span className="text-xs text-[#727B8E] dark:text-[#8a94a6]">
                    Fechado
                  </span>
                )}
              </div>
              {hours[key]?.enabled && (
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label="Abertura"
                    type="time"
                    value={hours[key].open}
                    onChange={(e) =>
                      handleTimeChange(key, "open", e.target.value)
                    }
                  />
                  <Input
                    label="Fechamento"
                    type="time"
                    value={hours[key].close}
                    onChange={(e) =>
                      handleTimeChange(key, "close", e.target.value)
                    }
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="mb-4 text-base font-semibold text-[#434A57] dark:text-[#f5f9fc]">
          Capacidade Padrão por Hora
        </h3>
        <div className="max-w-xs">
          <Input
            type="number"
            label="Atendimentos simultâneos"
            placeholder="8"
            value={defaultCapacity}
            onChange={(e) => setDefaultCapacity(parseInt(e.target.value) || 1)}
            min="1"
          />
          <p className="mt-2 text-xs text-[#727B8E] dark:text-[#8a94a6]">
            Número máximo de agendamentos por hora
          </p>
        </div>
      </section>

      <section>
        <h3 className="mb-4 text-base font-semibold text-[#434A57] dark:text-[#f5f9fc]">
          Capacidades Customizadas (Opcional)
        </h3>
        <p className="mb-4 text-sm text-[#727B8E] dark:text-[#8a94a6]">
          Configure capacidades específicas para dias especiais ou horários
          específicos dos dias da semana
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => {
              setCustomDate("");
              setCustomCap("");
              setCustomModalOpen(true);
            }}
            className="flex items-center gap-2 rounded-lg border border-[#727B8E]/10 bg-white dark:border-[#40485A] dark:bg-[#1A1B1D] px-4 py-2 text-sm text-[#727B8E] dark:text-[#8a94a6] hover:bg-[#F4F6F9] dark:hover:bg-[#212225] transition-colors"
          >
            + Adicionar Dia Específico
          </button>
          <button
            type="button"
            onClick={() => {
              setHourlyDay("monday");
              setHourlyHour("");
              setHourlyCap("");
              setHourlyModalOpen(true);
            }}
            className="flex items-center gap-2 rounded-lg border border-[#1E62EC]/20 bg-[#1E62EC]/10 dark:bg-[#1E62EC]/20 px-4 py-2 text-sm text-[#1E62EC] hover:bg-[#1E62EC]/20 dark:hover:bg-[#1E62EC]/30 transition-colors"
          >
            + Adicionar Hora do Dia da Semana
          </button>
        </div>
        {customCapacities.length > 0 && (
          <div className="mt-4 space-y-2">
            {customCapacities.map((cap) => (
              <div
                key={cap.date}
                className="flex items-center justify-between rounded-lg border border-[#727B8E]/10 bg-[#F4F6F9] dark:border-[#40485A] dark:bg-[#212225] px-4 py-3"
              >
                <div>
                  <span className="text-sm font-medium text-[#434A57] dark:text-[#f5f9fc]">
                    {cap.date}
                  </span>
                  <p className="text-xs text-[#727B8E] dark:text-[#8a94a6]">
                    {cap.capacity} serviços por hora
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setCustomCapacities((prev) =>
                      prev.filter((c) => c.date !== cap.date),
                    )
                  }
                  className="text-red-500 hover:text-red-700 transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
        {hourlyCapacities.length > 0 && (
          <div className="mt-4 space-y-2">
            <p className="text-xs font-medium text-[#434A57] dark:text-[#f5f9fc]">
              Capacidades por hora:
            </p>
            <div className="flex flex-wrap gap-2">
              {hourlyCapacities.map((h) => (
                <div
                  key={`${h.day}-${h.hour}`}
                  className="inline-flex items-center gap-2 rounded-lg border border-[#1E62EC]/20 bg-[#1E62EC]/10 px-2 py-1"
                >
                  <span className="text-xs font-medium text-[#1E62EC]">
                    {h.day} {h.hour} • {h.capacity} serviços
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setHourlyCapacities((prev) =>
                        prev.filter(
                          (x) => !(x.day === h.day && x.hour === h.hour),
                        ),
                      )
                    }
                    className="text-[#1E62EC] hover:text-red-600 transition-colors"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <div className="flex justify-end gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={saving}
          onClick={() => {
            if (!petshop) return;
            const initial = Object.fromEntries(
              DIAS.map(({ key }) => [
                key,
                {
                  enabled: [
                    "monday",
                    "tuesday",
                    "wednesday",
                    "thursday",
                    "friday",
                  ].includes(key),
                  open: "09:00",
                  close: "18:00",
                },
              ]),
            );
            if (petshop.businessHours) {
              Object.entries(petshop.businessHours).forEach(([key, val]) => {
                if (val?.open && val?.close)
                  initial[key] = {
                    enabled: true,
                    open: val.open,
                    close: val.close,
                  };
                else if (val?.closed)
                  initial[key] = { ...initial[key], enabled: false };
              });
            }
            setHours(initial);
          }}
        >
          Cancelar
        </Button>
        <Button type="button" onClick={handleSave} disabled={saving}>
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Salvando...
            </>
          ) : (
            "Salvar"
          )}
        </Button>
      </div>

      {/* Modal - Adicionar Dia Específico */}
      <Modal
        isOpen={customModalOpen}
        onClose={() => setCustomModalOpen(false)}
        title="Adicionar Dia Específico"
        className="max-w-[400px]"
      >
        <div className="flex flex-col gap-4">
          <Input
            label="Data"
            type="date"
            value={customDate}
            onChange={(e) => setCustomDate(e.target.value)}
            min={new Date().toISOString().split("T")[0]}
          />
          <Input
            label="Capacidade (serviços/hora)"
            type="number"
            placeholder="10"
            value={customCap}
            onChange={(e) => setCustomCap(e.target.value)}
            min="1"
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setCustomModalOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleAddCustomCapacity}>Adicionar</Button>
          </div>
        </div>
      </Modal>

      {/* Modal - Adicionar Capacidade por Hora */}
      <Modal
        isOpen={hourlyModalOpen}
        onClose={() => setHourlyModalOpen(false)}
        title="Adicionar Capacidade por Hora"
        className="max-w-[400px]"
      >
        <div className="flex flex-col gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-[#434A57] dark:text-[#f5f9fc]">
              Dia da semana
            </label>
            <select
              value={hourlyDay}
              onChange={(e) => setHourlyDay(e.target.value)}
              className="w-full rounded-lg border border-[#727B8E]/20 bg-white dark:bg-[#1A1B1D] dark:border-[#40485A] px-3 py-2 text-sm text-[#434A57] dark:text-[#f5f9fc]"
            >
              {DIAS.map(({ key, label }) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <Input
            label="Hora"
            type="time"
            value={hourlyHour}
            onChange={(e) => setHourlyHour(e.target.value)}
          />
          <Input
            label="Capacidade (serviços/hora)"
            type="number"
            placeholder="10"
            value={hourlyCap}
            onChange={(e) => setHourlyCap(e.target.value)}
            min="1"
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setHourlyModalOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleAddHourlyCapacity}>Adicionar</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

function IAPlaygroundContent() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "1",
      role: "assistant",
      content:
        "Olá! Sou a IA do seu petshop. Como posso ajudar você hoje? Você pode me perguntar sobre agendamentos, serviços, preços ou qualquer dúvida que seus clientes possam ter.",
      timestamp: new Date(),
    },
  ]);
  const [inputMessage, setInputMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const isFirstRender = useRef(true);

  const scrollToBottom = (instant?: boolean) => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTo({
        top: messagesContainerRef.current.scrollHeight,
        behavior: instant ? "instant" : "smooth",
      });
    }
  };

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    scrollToBottom();
  }, [messages]);

  const handleSendMessage = async () => {
    if (!inputMessage.trim() || isLoading) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: "user",
      content: inputMessage.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputMessage("");
    setIsLoading(true);

    setTimeout(
      () => {
        const responses = [
          "Entendi! Posso ajudar você com isso. Para agendar um serviço, basta informar o nome do pet, o tipo de serviço desejado e a data/horário de preferência.",
          "Nosso petshop oferece diversos serviços como banho, tosa, consultas veterinárias e hospedagem. Qual serviço você gostaria de conhecer melhor?",
          "Claro! Os preços variam de acordo com o porte do animal e o tipo de serviço. Posso te passar uma tabela detalhada se quiser.",
          "Para remarcar um agendamento, preciso do nome do pet e da data atual do agendamento. Com essas informações, consigo verificar a disponibilidade de novos horários.",
          "Temos horários disponíveis durante toda a semana, das 8h às 18h. Qual dia seria melhor para você?",
        ];

        const aiMessage: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: responses[Math.floor(Math.random() * responses.length)],
          timestamp: new Date(),
        };

        setMessages((prev) => [...prev, aiMessage]);
        setIsLoading(false);
      },
      1000 + Math.random() * 1000,
    );
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleClearChat = () => {
    setMessages([
      {
        id: "1",
        role: "assistant",
        content:
          "Olá! Sou a IA do seu petshop. Como posso ajudar você hoje? Você pode me perguntar sobre agendamentos, serviços, preços ou qualquer dúvida que seus clientes possam ter.",
        timestamp: new Date(),
      },
    ]);
  };

  return (
    <div className="flex h-full flex-col rounded-xl border border-[#727B8E]/10 bg-[#F4F6F9] dark:border-[#40485A] dark:bg-[#212225]">
      {}
      <div className="flex items-center justify-between border-b border-[#727B8E]/10 px-4 py-3 dark:border-[#40485A]">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#1E62EC] text-white">
            <Crown className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[#434A57] dark:text-[#f5f9fc]">
              IA Playground
            </h3>
            <p className="text-xs text-[#727B8E] dark:text-[#8a94a6]">
              Teste as respostas da sua IA
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={handleClearChat}>
          Limpar chat
        </Button>
      </div>

      {}
      <div
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto p-4 space-y-4"
      >
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-2.5 ${
                message.role === "user"
                  ? "bg-[#1E62EC] text-white rounded-br-md"
                  : "bg-white dark:bg-[#1A1B1D] text-[#434A57] dark:text-[#f5f9fc] rounded-bl-md shadow-sm"
              }`}
            >
              <p className="text-sm whitespace-pre-wrap">{message.content}</p>
              <p
                className={`mt-1 text-[10px] ${
                  message.role === "user"
                    ? "text-white/70"
                    : "text-[#727B8E] dark:text-[#8a94a6]"
                }`}
              >
                {message.timestamp.toLocaleTimeString("pt-BR", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="max-w-[80%] rounded-2xl rounded-bl-md bg-white dark:bg-[#1A1B1D] px-4 py-3 shadow-sm">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-[#1E62EC]" />
                <span className="text-sm text-[#727B8E] dark:text-[#8a94a6]">
                  Digitando...
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {}
      <div className="border-t border-[#727B8E]/10 p-4 dark:border-[#40485A]">
        <div className="flex gap-2">
          <Input
            placeholder="Digite sua mensagem..."
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            onKeyDown={handleKeyPress}
            className="flex-1"
          />
          <Button
            onClick={handleSendMessage}
            disabled={!inputMessage.trim() || isLoading}
            className="shrink-0"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Enviar"
            )}
          </Button>
        </div>
        <p className="mt-2 text-xs text-[#727B8E] dark:text-[#8a94a6]">
          Este é um ambiente de teste. As respostas simulam como a IA responderá
          aos seus clientes.
        </p>
      </div>
    </div>
  );
}

export default function ConfiguracoesPage() {
  const { user, logout } = useAuthContext();
  const petshopId = user?.petshop_id ?? 0;
  const toast = useToast();

  const [activeTab, setActiveTab] = useState<SettingsTabId>("servicos");
  const contentScrollRef = useRef<HTMLDivElement>(null);
  const [petshop, setPetshop] = useState<Petshop | null>(null);
  const [petshopError, setPetshopError] = useState<string | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [whatsappStatus, setWhatsappStatus] = useState<{
    status: string;
    phone?: string;
    last_connected?: string;
    error_message?: string;
  } | null>(null);
  const [paymentStats, setPaymentStats] = useState<{
    total_revenue?: number;
    total_payments?: number;
    average_ticket?: number;
  } | null>(null);
  const [loadingPetshop, setLoadingPetshop] = useState(true);
  const [loadingServices, setLoadingServices] = useState(true);
  const [loadingWhatsapp, setLoadingWhatsapp] = useState(true);
  const [loadingPayment, setLoadingPayment] = useState(true);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [editingData, setEditingData] = useState({
    name: "",
    duration_minutes: 30,
    price: "",
    description: "",
    price_varies_by_size: false,
    price_small: "",
    price_medium: "",
    price_large: "",
  });

  const [newServiceModalOpen, setNewServiceModalOpen] = useState(false);
  const [newServiceData, setNewServiceData] = useState({
    specialty: "",
    service_type: "",
    duration_minutes: 30,
    price: 0,
    description: "",
    price_varies_by_size: false,
    price_small: 0,
    price_medium: 0,
    price_large: 0,
  });
  const [priceDisplay, setPriceDisplay] = useState({
    price: "",
    price_small: "",
    price_medium: "",
    price_large: "",
  });
  const [creatingService, setCreatingService] = useState(false);

  const fetchPetshop = useCallback(async () => {
    if (!petshopId) {
      setLoadingPetshop(false);
      setPetshopError(null);
      return;
    }
    setPetshopError(null);
    try {
      const data = await petshopService.getPetshop(petshopId);
      setPetshop(data);
    } catch (err: unknown) {
      console.error("Erro ao carregar estabelecimento:", err);
      const message =
        err &&
        typeof err === "object" &&
        "response" in err &&
        err.response &&
        typeof (err.response as { data?: { detail?: string } }).data?.detail ===
          "string"
          ? (err.response as { data: { detail: string } }).data.detail
          : "Não foi possível carregar os dados do estabelecimento.";
      setPetshopError(message);
    } finally {
      setLoadingPetshop(false);
    }
  }, [petshopId]);

  const fetchServices = useCallback(async () => {
    try {
      setLoadingServices(true);
      const list = await serviceService.listServices(undefined);
      setServices(list);
    } catch (error) {
      console.error("Erro ao carregar serviços:", error);
      setServices([]);
    } finally {
      setLoadingServices(false);
    }
  }, [petshopId]);

  useEffect(() => {
    fetchPetshop();
  }, [fetchPetshop]);

  useEffect(() => {
    fetchServices();
  }, [fetchServices]);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await whatsappService.getStatus();
        setWhatsappStatus({
          status: data.status,
          phone: data.phone,
          last_connected: (data as any).last_connected,
          error_message: (data as any).error_message,
        });
      } catch {
        setWhatsappStatus(null);
      } finally {
        setLoadingWhatsapp(false);
      }
    };
    load();
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await paymentService.getStats();
        setPaymentStats({
          total_revenue: data.total_revenue,
          total_payments: data.total_payments,
          average_ticket: data.average_ticket,
        });
      } catch {
        setPaymentStats(null);
      } finally {
        setLoadingPayment(false);
      }
    };
    load();
  }, []);

  const handleSaveEmpresa = useCallback(
    async (data: {
      name?: string;
      phone?: string;
      address?: string;
      cep?: string;
      owner_phone?: string;
      emergency_contact?: string;
    }) => {
      if (!petshopId) return;
      try {
        const { name: company_name, ...petshopData } = data;
        await petshopService.updatePetshop(petshopId, {
          ...petshopData,
          ...(company_name ? { company_name } : {}),
        } as Parameters<typeof petshopService.updatePetshop>[1]);
        await fetchPetshop();
        toast.success(
          "Configurações salvas!",
          "As informações da empresa foram atualizadas com sucesso.",
        );
      } catch (error) {
        console.error("Erro ao salvar configurações:", error);
        toast.error(
          "Erro ao salvar",
          "Não foi possível salvar as configurações. Tente novamente.",
        );
      }
    },
    [petshopId, fetchPetshop, toast],
  );

  const handleSaveHorarios = useCallback(
    async (data: {
      business_hours: Record<
        string,
        { open: string; close: string } | { closed: boolean }
      >;
      default_capacity_per_hour?: number;
      custom_capacity_hours?: any;
    }) => {
      if (!petshopId) return;
      try {
        await petshopService.updatePetshop(petshopId, data);
        await fetchPetshop();
        toast.success(
          "Horários salvos!",
          "As configurações foram atualizadas.",
        );
      } catch (error) {
        console.error("Erro ao salvar horários:", error);
        toast.error("Erro ao salvar", "Não foi possível salvar os horários.");
      }
    },
    [petshopId, fetchPetshop, toast],
  );

  const handleEditService = (service: Service) => {
    setSelectedService(service);
    setEditModalOpen(true);
  };

  const handleCloseEditModal = () => {
    setEditModalOpen(false);
    setSelectedService(null);
    setEditingData({
      name: "",
      duration_minutes: 30,
      price: "",
      description: "",
      price_varies_by_size: false,
      price_small: "",
      price_medium: "",
      price_large: "",
    });
  };

  useEffect(() => {
    if (selectedService) {
      const hasSize = !!(
        selectedService.priceBySize &&
        (selectedService.priceBySize.small ||
          selectedService.priceBySize.medium ||
          selectedService.priceBySize.large)
      );
      setEditingData({
        name: selectedService.name,
        duration_minutes: selectedService.durationMin || 30,
        price: selectedService.price?.toString() || "",
        description: selectedService.description || "",
        price_varies_by_size: hasSize,
        price_small: selectedService.priceBySize?.small?.toString() || "",
        price_medium: selectedService.priceBySize?.medium?.toString() || "",
        price_large: selectedService.priceBySize?.large?.toString() || "",
      });
    }
  }, [selectedService]);

  const handleEditingDataChange = (
    field: string,
    value: string | number | boolean,
  ) => {
    setEditingData((prev) => ({ ...prev, [field]: value }));
  };

  const handleUpdateService = async () => {
    if (!selectedService || !editingData.name.trim()) {
      toast.warning("Erro", "Nome do serviço é obrigatório.");
      return;
    }

    try {
      await serviceService.updateService(selectedService.id, {
        name: editingData.name,
        duration_min: editingData.duration_minutes,
        price: editingData.price_varies_by_size
          ? null
          : editingData.price
            ? parseFloat(editingData.price)
            : undefined,
        description: editingData.description || undefined,
        price_by_size: editingData.price_varies_by_size
          ? {
              small: editingData.price_small
                ? parseFloat(editingData.price_small)
                : undefined,
              medium: editingData.price_medium
                ? parseFloat(editingData.price_medium)
                : undefined,
              large: editingData.price_large
                ? parseFloat(editingData.price_large)
                : undefined,
            }
          : null,
      });
      toast.success("Sucesso!", "Serviço atualizado com sucesso.");
      handleCloseEditModal();
      await fetchServices();
    } catch (error) {
      console.error("Erro ao atualizar:", error);
      toast.error("Erro", "Não foi possível atualizar o serviço.");
    }
  };

  const handleOpenNewServiceModal = () => {
    setNewServiceModalOpen(true);
  };

  const handleCloseNewServiceModal = () => {
    setNewServiceModalOpen(false);
    setNewServiceData({
      specialty: "",
      service_type: "",
      duration_minutes: 30,
      price: 0,
      description: "",
      price_varies_by_size: false,
      price_small: 0,
      price_medium: 0,
      price_large: 0,
    });
    setPriceDisplay({
      price: "",
      price_small: "",
      price_medium: "",
      price_large: "",
    });
  };

  const handleNewServiceChange = (
    field: string,
    value: string | number | boolean,
  ) => {
    setNewServiceData((prev) => ({ ...prev, [field]: value }));
  };

  const handlePriceChange = (
    field: "price" | "price_small" | "price_medium" | "price_large",
    value: string,
  ) => {
    const masked = maskCurrency(value);
    setPriceDisplay((prev) => ({ ...prev, [field]: masked }));
    const numericValue = unmaskCurrency(masked);
    setNewServiceData((prev) => ({ ...prev, [field]: numericValue }));
  };

  useEffect(() => {
    if (activeTab !== "ia-playground") return;
    const run = () => {
      if (contentScrollRef.current) {
        contentScrollRef.current.scrollTop = 0;
        let el: HTMLElement | null = contentScrollRef.current.parentElement;
        while (el) {
          const { overflowY } = getComputedStyle(el);
          if (
            overflowY === "auto" ||
            overflowY === "scroll" ||
            overflowY === "overlay"
          ) {
            el.scrollTop = 0;
            break;
          }
          el = el.parentElement;
        }
      }
    };
    requestAnimationFrame(() => requestAnimationFrame(run));
  }, [activeTab]);

  const handleCreateService = async () => {
    if (!newServiceData.specialty) {
      toast.warning(
        "Preencha os campos obrigatórios",
        "O nome do serviço é obrigatório.",
      );
      return;
    }

    setCreatingService(true);
    try {
      await serviceService.createService({
        name: newServiceData.specialty,
        duration_min: newServiceData.duration_minutes,
        price: newServiceData.price_varies_by_size
          ? undefined
          : newServiceData.price || undefined,
        description: newServiceData.description || undefined,
        price_by_size: newServiceData.price_varies_by_size
          ? {
              small: newServiceData.price_small || undefined,
              medium: newServiceData.price_medium || undefined,
              large: newServiceData.price_large || undefined,
            }
          : undefined,
      });
      handleCloseNewServiceModal();
      await fetchServices();
      toast.success(
        "Serviço criado!",
        `O serviço "${newServiceData.specialty}" foi adicionado com sucesso.`,
      );
    } catch (error) {
      console.error("Erro ao criar serviço:", error);
      toast.error(
        "Erro ao criar serviço",
        "Não foi possível criar o serviço. Tente novamente.",
      );
    } finally {
      setCreatingService(false);
    }
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case "servicos":
        return (
          <ServicosContent
            services={services}
            loading={loadingServices}
            petshopId={petshopId}
            onEditService={handleEditService}
            onRefresh={fetchServices}
          />
        );
      case "empresa":
        return (
          <EmpresaContent
            petshop={petshop}
            loading={loadingPetshop}
            onSave={handleSaveEmpresa}
          />
        );
      case "horarios":
        return (
          <HorariosContent
            petshop={petshop}
            loading={loadingPetshop}
            onSave={handleSaveHorarios}
          />
        );
      case "whatsapp":
        return (
          <WhatsAppContent status={whatsappStatus} loading={loadingWhatsapp} />
        );
      case "pagamento":
        return (
          <PagamentoContent stats={paymentStats} loading={loadingPayment} />
        );
      case "ia-playground":
        return <IAPlaygroundContent />;
      default:
        return null;
    }
  };

  return (
    <DashboardLayout>
      <div className="flex min-h-0 flex-1 flex-col px-4 pb-24 pt-6 sm:px-6 sm:pb-10 sm:pt-8 lg:px-10 lg:pb-10 lg:pt-6">
        <div className="relative flex min-h-0 flex-1 flex-col overflow-visible rounded-2xl border border-[#727B8E]/10 bg-white shadow-lg dark:border-[#40485A] dark:bg-[#1A1B1D] sm:rounded-3xl">
          <div className="flex shrink-0 justify-center sm:px-0">
            <div className="absolute left-1/2 -top-7 flex w-full mx-auto shrink-0 max-w-[600px]! -translate-x-1/2 overflow-x-auto overflow-visible rounded-t-[10px] p-2 sm:relative sm:left-auto sm:-top-5 sm:max-w-none sm:translate-x-0 sm:rounded-none sm:pt-0">
              <SettingsTabs activeTab={activeTab} onTabChange={setActiveTab} />
            </div>
          </div>

          <div
            ref={contentScrollRef}
            className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto px-4 pt-14 pb-8 sm:gap-11 sm:px-6 sm:pt-12 sm:pb-12 lg:flex-row lg:px-10 lg:py-16"
          >
            <div className="shrink-0">
              <SettingsProfileSidebar
                petshop={petshop}
                loading={loadingPetshop}
                error={petshopError}
                showNovoServico={activeTab === "servicos"}
                onNovoServico={handleOpenNewServiceModal}
                onLogout={logout}
              />
            </div>

            <div className="flex-1 min-w-0 overflow-hidden" key={activeTab}>
              <motion.div
                className="h-full overflow-y-auto"
                animate={{ opacity: 1, y: 0 }}
                initial={{ opacity: 0, y: 10 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
              >
                {renderTabContent()}
              </motion.div>
            </div>
          </div>
        </div>
      </div>

      <Modal
        isOpen={editModalOpen}
        onClose={handleCloseEditModal}
        title="Editar serviço"
        onSubmit={handleUpdateService}
        submitText="Salvar"
        cancelText="Cancelar"
        className="max-w-[480px]"
      >
        <div className="flex flex-col gap-4">
          <Input
            label="Nome do serviço"
            placeholder="Ex: Banho, Tosa, etc."
            value={editingData.name}
            onChange={(e) => handleEditingDataChange("name", e.target.value)}
          />
          <Input
            label="Duração (minutos)"
            type="number"
            value={editingData.duration_minutes}
            onChange={(e) =>
              handleEditingDataChange(
                "duration_minutes",
                parseInt(e.target.value) || 0,
              )
            }
            min="15"
            step="15"
          />

          <div className="flex items-center justify-between rounded-lg border border-[#727B8E]/10 bg-[#F4F6F9] dark:border-[#40485A] dark:bg-[#212225] px-4 py-3">
            <div className="flex-1">
              <label
                htmlFor="edit_price_varies_by_size"
                className="cursor-pointer text-sm font-medium text-[#434A57] dark:text-[#f5f9fc]"
              >
                Preço varia por porte?
              </label>
              <p className="text-xs font-normal text-[#727B8E]">
                Defina preços diferentes para P, M e G
              </p>
            </div>
            <label
              htmlFor="edit_price_varies_by_size"
              className="relative inline-flex cursor-pointer items-center"
            >
              <input
                type="checkbox"
                id="edit_price_varies_by_size"
                checked={editingData.price_varies_by_size}
                onChange={(e) =>
                  handleEditingDataChange(
                    "price_varies_by_size",
                    e.target.checked,
                  )
                }
                className="peer sr-only"
              />
              <div className="peer h-6 w-11 rounded-full bg-[#727B8E]/30 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:bg-[#1E62EC] peer-checked:after:translate-x-full peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-[#1E62EC]/20"></div>
            </label>
          </div>

          {!editingData.price_varies_by_size && (
            <Input
              label="Preço (R$)"
              type="number"
              value={editingData.price}
              onChange={(e) => handleEditingDataChange("price", e.target.value)}
              placeholder="0.00"
              step="0.01"
              min="0"
            />
          )}

          {editingData.price_varies_by_size && (
            <div className="grid grid-cols-3 gap-3">
              <Input
                label="Pequeno (P)"
                type="number"
                placeholder="0.00"
                value={editingData.price_small}
                onChange={(e) =>
                  handleEditingDataChange("price_small", e.target.value)
                }
                step="0.01"
                min="0"
              />
              <Input
                label="Médio (M)"
                type="number"
                placeholder="0.00"
                value={editingData.price_medium}
                onChange={(e) =>
                  handleEditingDataChange("price_medium", e.target.value)
                }
                step="0.01"
                min="0"
              />
              <Input
                label="Grande (G)"
                type="number"
                placeholder="0.00"
                value={editingData.price_large}
                onChange={(e) =>
                  handleEditingDataChange("price_large", e.target.value)
                }
                step="0.01"
                min="0"
              />
            </div>
          )}

          <div>
            <label className="mb-2 block text-base font-semibold text-[#434A57] dark:text-[#f5f9fc]">
              Descrição
            </label>
            <TextArea
              placeholder="Descrição do serviço..."
              value={editingData.description}
              onChange={(e) =>
                handleEditingDataChange("description", e.target.value)
              }
              rows={4}
            />
          </div>
        </div>
      </Modal>

      {}
      <Modal
        isOpen={newServiceModalOpen}
        onClose={handleCloseNewServiceModal}
        title="Novo serviço"
        onSubmit={handleCreateService}
        submitText={creatingService ? "Criando..." : "Criar serviço"}
        cancelText="Cancelar"
        className="max-w-[480px]"
      >
        <div className="flex flex-col gap-4">
          <Input
            label="Nome do serviço"
            placeholder="Ex: Banho e Tosa"
            value={newServiceData.specialty}
            onChange={(e) =>
              handleNewServiceChange("specialty", e.target.value)
            }
          />
          <Input
            label="Tipo de serviço"
            placeholder="Ex: Estética"
            value={newServiceData.service_type}
            onChange={(e) =>
              handleNewServiceChange("service_type", e.target.value)
            }
          />

          <Input
            label="Duração (minutos)"
            type="number"
            placeholder="30"
            value={newServiceData.duration_minutes}
            onChange={(e) =>
              handleNewServiceChange(
                "duration_minutes",
                parseInt(e.target.value) || 0,
              )
            }
          />

          <div>
            <label className="mb-2 block text-base font-semibold text-[#434A57] dark:text-[#f5f9fc]">
              Descrição
            </label>
            <TextArea
              rows={4}
              placeholder="Descreva o serviço..."
              value={newServiceData.description}
              onChange={(e) =>
                handleNewServiceChange("description", e.target.value)
              }
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-[#727B8E]/10 bg-[#F4F6F9] dark:border-[#40485A] dark:bg-[#212225] px-4 py-3">
            <div className="flex-1">
              <label
                htmlFor="price_varies_by_size"
                className="cursor-pointer text-sm font-medium text-white"
              >
                Preço varia por porte?
              </label>
              <p className="text-xs font-normal text-[#727B8E]">
                Defina preços diferentes para P, M e G
              </p>
            </div>
            <label
              htmlFor="price_varies_by_size"
              className="relative inline-flex cursor-pointer items-center"
            >
              <input
                type="checkbox"
                id="price_varies_by_size"
                checked={newServiceData.price_varies_by_size}
                onChange={(e) =>
                  handleNewServiceChange(
                    "price_varies_by_size",
                    e.target.checked,
                  )
                }
                className="peer sr-only"
              />
              <div className="peer h-6 w-11 rounded-full bg-[#1A1B1D] after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:bg-[#1E62EC] peer-checked:after:translate-x-full peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-[#1E62EC]/20"></div>
            </label>
          </div>

          {!newServiceData.price_varies_by_size && (
            <Input
              label="Preço (R$)"
              placeholder="0,00"
              value={priceDisplay.price}
              onChange={(e) => handlePriceChange("price", e.target.value)}
            />
          )}

          {newServiceData.price_varies_by_size && (
            <div className="grid grid-cols-3 gap-3">
              <Input
                label="Pequeno (P)"
                placeholder="0,00"
                value={priceDisplay.price_small}
                onChange={(e) =>
                  handlePriceChange("price_small", e.target.value)
                }
              />
              <Input
                label="Médio (M)"
                placeholder="0,00"
                value={priceDisplay.price_medium}
                onChange={(e) =>
                  handlePriceChange("price_medium", e.target.value)
                }
              />
              <Input
                label="Grande (G)"
                placeholder="0,00"
                value={priceDisplay.price_large}
                onChange={(e) =>
                  handlePriceChange("price_large", e.target.value)
                }
              />
            </div>
          )}
        </div>
      </Modal>
    </DashboardLayout>
  );
}
