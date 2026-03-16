import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { PipelineCard } from "@/components/molecules/PipelineCard";
import { ConversationsPipelineHeader } from "@/components/molecules/ConversationsPipelineHeader";
import { EmptyState } from "@/components/molecules/EmptyState";
import { useConversations } from "@/hooks";
import { conversationService } from "@/services";
import type { Conversation } from "@/types";
import {
  type PipelineCard as PipelineCardType,
  type PipelineStage,
  PIPELINE_COLUMNS,
} from "@/data/pipeline";

const VALID_STAGES = new Set<string>([
  "welcome",
  "situation",
  "problem",
  "implication",
  "scheduling",
  "completed",
]);

// Maps DB conversationStage values to pipeline columns
const DB_STAGE_MAP: Record<string, PipelineStage> = {
  initial: "welcome",
  WELCOME: "welcome",
  onboarding: "situation",
  PET_REGISTRATION: "situation",
  pet_registered: "problem",
  SERVICE_SELECTION: "problem",
  booking: "scheduling",
  SCHEDULING: "scheduling",
  AWAITING_CONFIRMATION: "scheduling",
  completed: "completed",
  COMPLETED: "completed",
};

function toInitials(name: string): string {
  const parts = name.trim().split(" ").filter(Boolean);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function resolveStage(conv: Conversation): PipelineStage {
  // Prefer explicit kanban_column set by drag-and-drop
  if (conv.kanban_column && VALID_STAGES.has(conv.kanban_column)) {
    return conv.kanban_column as PipelineStage;
  }
  // Fall back to mapping from DB conversationStage
  if (conv.stage) {
    const mapped = DB_STAGE_MAP[conv.stage];
    if (mapped) return mapped;
    if (VALID_STAGES.has(conv.stage)) return conv.stage as PipelineStage;
  }
  return "welcome";
}

function mapConversationToCard(conv: Conversation): PipelineCardType {
  const id = conv.id ?? conv.conversation_id ?? conv.client_id;
  const name = conv.client_name ?? "Cliente";
  const stage = resolveStage(conv);
  const time = new Date(conv.last_message_at).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return {
    id,
    name,
    initials: toInitials(name),
    pets: "",
    description: `${conv.message_count} mensagem${conv.message_count !== 1 ? "s" : ""}`,
    time,
    stage,
  };
}

function AddCardPlaceholder({
  columnId,
  columnColor,
  onAdd,
}: {
  columnId: PipelineStage;
  columnColor: string;
  onAdd: (stage: PipelineStage) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onAdd(columnId)}
      className="flex min-h-[100px] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[#727B8E]/30 bg-transparent p-4 transition-all duration-200 hover:border-[#1E62EC]/50 hover:bg-[#1E62EC]/5 dark:border-[#8a94a6]/30 dark:hover:border-[#2172e5]/50 dark:hover:bg-[#2172e5]/10"
    >
      <div
        className="flex h-9 w-9 items-center justify-center rounded-full"
        style={{ backgroundColor: `${columnColor}20` }}
      >
        <Plus
          className="h-5 w-5"
          style={{ color: columnColor }}
          strokeWidth={2}
        />
      </div>
      <span className="text-sm font-medium text-[#727B8E] dark:text-[#8a94a6]">
        Adicionar card
      </span>
    </button>
  );
}

export function PipelineBoard() {
  const navigate = useNavigate();
  const { fetchConversations } = useConversations();
  const [cards, setCards] = useState<PipelineCardType[]>([]);
  const [loading, setLoading] = useState(true);
  const [draggedCard, setDraggedCard] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<PipelineStage | null>(
    null,
  );

  useEffect(() => {
    fetchConversations()
      .then((convs) => setCards(convs.map(mapConversationToCard)))
      .catch(() => setCards([]))
      .finally(() => setLoading(false));
  }, [fetchConversations]);

  const handleCardClick = (cardId: string) => {
    navigate(`/chat?id=${encodeURIComponent(cardId)}`);
  };

  const handleDragStart = (e: React.DragEvent, cardId: string) => {
    setDraggedCard(cardId);
    e.dataTransfer.setData("text/plain", cardId);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragEnd = () => {
    setDraggedCard(null);
    setDragOverColumn(null);
  };

  const handleDragOver = (e: React.DragEvent, stage: PipelineStage) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverColumn(stage);
  };

  const handleDragLeave = () => {
    setDragOverColumn(null);
  };

  const handleDrop = (e: React.DragEvent, targetStage: PipelineStage) => {
    e.preventDefault();
    const cardId = e.dataTransfer.getData("text/plain");
    if (!cardId) return;
    setCards((prev) =>
      prev.map((c) => (c.id === cardId ? { ...c, stage: targetStage } : c)),
    );
    setDraggedCard(null);
    setDragOverColumn(null);
    // Persist the stage change
    conversationService.updateStage(cardId, targetStage).catch((err) =>
      console.error("[Pipeline] Failed to persist stage:", err),
    );
  };

  const handleAddCard = (stage: PipelineStage) => {
    const newId = `new-${Date.now()}`;
    const newCard: PipelineCardType = {
      id: newId,
      name: "Novo contato",
      initials: "??",
      pets: "—",
      description: "Clique para editar",
      time: "Agora",
      stage,
    };
    setCards((prev) => [...prev, newCard]);
  };

  if (loading) {
    return (
      <div className="flex h-full flex-col">
        <div className="animate-fade-in">
          <ConversationsPipelineHeader title="Pipeline" activeTab="pipeline" />
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#1E62EC] border-t-transparent" />
        </div>
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <div className="animate-fade-in">
          <ConversationsPipelineHeader title="Pipeline" activeTab="pipeline" />
        </div>
        <div className="flex flex-1 items-center justify-center p-8">
          <EmptyState
            image="bored"
            title="Nenhuma conversa no pipeline"
            description="Quando houver conversas ativas, elas aparecer&#xE3;o aqui organizadas por etapa."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="animate-fade-in">
        <ConversationsPipelineHeader title="Pipeline" activeTab="pipeline" />
      </div>

      <div className="flex flex-1 gap-4 overflow-x-auto p-4 sm:p-6 scrollbar-hide dark:bg-[#212225]">
        {PIPELINE_COLUMNS.map((column, colIndex) => {
          const columnCards = cards.filter((c) => c.stage === column.id);
          const isDragOver = dragOverColumn === column.id;
          return (
            <div
              key={column.id}
              onDragOver={(e) => handleDragOver(e, column.id)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, column.id)}
              style={{ animationDelay: `${colIndex * 75}ms` }}
              className={`
                animate-fade-in-up flex min-w-[280px] max-w-[280px] flex-col rounded-xl border-2 border-dashed p-4 transition-all duration-200
                ${isDragOver ? "border-[#1E62EC] bg-[#1E62EC]/5 scale-[1.02] dark:border-[#2172e5] dark:bg-[#2172e5]/20" : "border-[#727B8E]/10 bg-[#F4F6F9]/50 dark:border-[#40485A] dark:bg-[#212225]"}
              `}
            >
              <div className="mb-4 flex items-center gap-2">
                <div
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: column.color }}
                />
                <span className="text-sm font-bold text-[#434A57] dark:text-[#f5f9fc]">
                  {column.label}
                </span>
                <span className="rounded-full bg-white dark:bg-[#3A4150] px-2 py-0.5 text-xs font-medium text-[#727B8E] dark:text-[#e8ecf1]">
                  {columnCards.length}
                </span>
              </div>
              <div className="flex flex-1 flex-col gap-3 overflow-y-auto">
                {columnCards.map((card, cardIndex) => (
                  <PipelineCard
                    key={card.id}
                    card={card}
                    animationDelay={cardIndex * 50}
                    isDragging={draggedCard === card.id}
                    onDragStart={(e) => handleDragStart(e, card.id)}
                    onDragEnd={handleDragEnd}
                    onCardClick={handleCardClick}
                  />
                ))}
                {/* <AddCardPlaceholder
                  columnId={column.id}
                  columnColor={column.color}
                  onAdd={handleAddCard}
                /> */}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
