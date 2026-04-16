import { Suspense, useState, useRef, useEffect, useCallback } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Search, ArrowLeftRight, Plus } from "lucide-react";

import { DashboardLayout } from "@/components/templates/DashboardLayout";
import { ConversationItem } from "@/components/molecules/ConversationItem";
import { ConversationsPipelineHeader } from "@/components/molecules/ConversationsPipelineHeader";
import { EmptyState } from "@/components/molecules/EmptyState";
import { ChatBubble } from "@/components/molecules/ChatBubble";
import { ChatInput } from "@/components/molecules/ChatInput";
import { ChatHeader } from "@/components/molecules/ChatHeader";
import { Button } from "@/components/atoms/Button";
import { useConversations } from "@/hooks";
import { conversationService, whatsappService } from "@/services";
import type { Conversation } from "@/types";

import {
  type ChatMessage as MockMessage,
  type ChatConversation as MockConversation,
  AI_RESPONSES,
} from "@/data/chat";

function getCurrentTime(): string {
  return new Date().toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function mapApiConversation(conv: Conversation): MockConversation {
  const conversationId = conv.id || conv.conversation_id || "";

  const manual = conv.client_manual_phone ?? null;
  const shouldFallback =
    !manual ||
    manual.includes("@") ||
    /[a-z]/i.test(manual.toString());
  const displayPhone = shouldFallback ? "Numero nao identificado" : manual!;

  return {
    id: conversationId,
    name: conv.client_name || "Cliente",
    phone: displayPhone,
    whatsappPhone: conv.client_phone || "",
    pets: "",
    lastMessage: `${conv.message_count ?? 0} mensagens`,
    time: conv.last_message_at
      ? (() => {
        const d = new Date(conv.last_message_at);
        if (isNaN(d.getTime())) return "";
        const date = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
        const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
        return `${date}\n${time}`;
      })()
      : "",
    unreadCount: 0,
    isAiPaused: conv.ai_paused ?? conv.is_ai_paused ?? false,
    isOnline: false,
    clientId: conv.client_id || undefined,
  };
}

function formatMessageTime(raw: string | null | undefined): string {
  if (!raw) return "";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function formatMessageDate(raw: string | null | undefined): string {
  if (!raw) return "";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function mapApiMessage(msg: any): MockMessage {
  const isIncoming = msg.role === "user";
  const rawTs = msg.createdAt ?? msg.created_at;
  return {
    id: msg.id,
    variant: isIncoming ? "received" : "sent",
    message: msg.content || "",
    time: formatMessageTime(rawTs),
    rawDate: formatMessageDate(rawTs),
    isRead: true,
  };
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((word) => word[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function ConversationsSidebar({
  conversations,
  selectedId,
  onSelect,
  searchQuery,
  onSearchChange,
  loading,
}: {
  conversations: MockConversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  loading?: boolean;
}) {
  const filteredConversations = conversations.filter(
    (conv) =>
      conv.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      conv.pets.toLowerCase().includes(searchQuery.toLowerCase()) ||
      conv.lastMessage.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const renderMobileView = () => (
    <div className="lg:hidden h-full w-full relative overflow-hidden">
      <div className="relative z-10 h-full flex flex-col">
        <div className="flex-1 flex lg:gap-2.5 overflow-hidden">
          <div className="w-[88.73px] bg-white border-l border-t border-b border-[#727B8E]/10 rounded-l-2xl flex flex-col justify-between py-[10px] px-2">
            <div className="pb-1 border-b border-[#727B8E]/10">
              <div className="flex items-center justify-between text-[10px] font-medium text-[#434A57] leading-7">
                <span>Conversas</span>

                <Link
                  to="/pipeline"
                  className="flex h-10 w-10 items-center justify-center rounded-full"

                >
                  <ArrowLeftRight className="h-2.5 w-2.5" />
                </Link>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto py-4 space-y-0">
              {filteredConversations.slice(0, 8).map((conversation) => (
                <button
                  key={conversation.id}
                  type="button"
                  onClick={() => onSelect(conversation.id)}
                  className={`w-full p-3 border-b border-[#727B8E]/10 ${selectedId === conversation.id ? "bg-[#F4F6F9]" : "bg-white"
                    }`}
                >
                  <div className="relative w-[49px] h-[49px] mx-auto">
                    <div className="w-full h-full rounded-full bg-[#FAFAFA] border border-[#727B8E]/10 flex items-center justify-center">
                      <span className="text-base font-medium text-[#434A57]">
                        {getInitials(conversation.name)}
                      </span>
                    </div>
                    {conversation.isOnline && (
                      <div className="absolute bottom-0 right-0 w-2 h-2 bg-[#3DCA21] rounded-full border-2 border-white/10" />
                    )}
                    {conversation.unreadCount > 0 && (
                      <div className="absolute -top-1 -right-1 w-4 h-4 bg-black rounded-full flex items-center justify-center">
                        <span className="text-[8px] font-medium text-white">{conversation.unreadCount}</span>
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>

            <div className="pt-2">
              <button className="w-16 h-[46px] mx-auto bg-[#1E62EC] rounded-lg flex items-center justify-center hover:bg-[#1E62EC]/90 transition-colors">
                <Plus className="h-6 w-6 text-white" />
              </button>
            </div>
          </div>

          <div className="flex-1 bg-[#F4F6F9] border border-[#727B8E]/10 rounded-r-[24px] flex flex-col items-center justify-center p-4">
            {loading ? (
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#1E62EC] border-t-transparent" />
            ) : filteredConversations.length === 0 ? (
              <div className="text-center pb-[90px]">
                <div className="w-[155.21px] h-[112.55px] mx-auto mb-[35px]">
                  <EmptyState
                    image="bored"
                    description=""
                    buttonText=""
                    onButtonClick={() => { }}
                  />
                </div>
                <p className="text-sm font-medium text-[#727B8E] mb-4">
                  Você ainda não tem conversas
                </p>
                <Button
                  onClick={() => { }}
                  className="h-[37px] px-5 bg-[#1E62EC] text-white text-xs font-medium rounded-lg hover:bg-[#1E62EC]/90"
                >
                  Cadastrar cliente
                </Button>
              </div>
            ) : (
              <div className="text-center">
                <p className="text-sm font-medium text-[#727B8E]">
                  Selecione uma conversa para iniciar
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  const renderDesktopView = () => (
    <div className="hidden lg:flex h-full flex-col">
      <ConversationsPipelineHeader title="Conversas" activeTab="chat" />
      <div className="flex flex-col gap-4 p-4">
        <div className="flex items-center gap-2 rounded-full border border-[#727B8E]/10 bg-[#F4F6F9] dark:border-[#40485A] dark:bg-[#1A1B1D] px-4 py-2">
          <Search className="h-4 w-4 text-[#727B8E] dark:text-[#8a94a6]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Buscar conversa..."
            className="flex-1 bg-transparent text-sm text-[#434A57] placeholder:text-[#727B8E] focus:outline-none dark:text-[#f5f9fc] dark:placeholder:text-[#8a94a6]"
          />
        </div>
      </div>

      <div className="h-px w-full bg-[#727B8E]/10 dark:bg-[#212225]" />

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex h-full items-center justify-center p-4">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#1E62EC] border-t-transparent" />
          </div>
        ) : filteredConversations.length === 0 ? (
          <div className="flex h-full items-center justify-center p-4">
            <EmptyState
              image="bored"
              description={
                searchQuery
                  ? "Nenhuma conversa encontrada"
                  : "Você ainda não tem conversas"
              }
              buttonText={searchQuery ? undefined : "Cadastrar cliente"}
              onButtonClick={searchQuery ? undefined : () => { }}
            />
          </div>
        ) : (
          filteredConversations.map((conversation) => (
            <ConversationItem
              key={conversation.id}
              {...conversation}
              isSelected={selectedId === conversation.id}
              onClick={() => onSelect(conversation.id)}
            />
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

function ChatArea({
  conversation,
  messages,
  isAiActive,
  onToggleAi,
  onSendMessage,
  isRecording,
  onStartRecording,
  onStopRecording,
  recordingTime,
  loading,
}: {
  conversation: MockConversation | null;
  messages: MockMessage[];
  isAiActive: boolean;
  onToggleAi: () => void;
  onSendMessage: (message: string) => void;
  isRecording: boolean;
  onStartRecording: () => void;
  onStopRecording: () => void;
  recordingTime: number;
  loading?: boolean;
}) {
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const scrollDateRef = useRef<HTMLDivElement>(null);
  const scrollDateTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isAutoScrolling = useRef(false);

  useEffect(() => {
    if (messagesContainerRef.current) {
      isAutoScrolling.current = true;
      messagesContainerRef.current.scrollTop =
        messagesContainerRef.current.scrollHeight;
      setTimeout(() => { isAutoScrolling.current = false; }, 100);
    }
  }, [messages]);

  useEffect(() => {
    const handleResize = () => {
      if (messagesContainerRef.current) {
        isAutoScrolling.current = true;
        messagesContainerRef.current.scrollTop =
          messagesContainerRef.current.scrollHeight;
        setTimeout(() => { isAutoScrolling.current = false; }, 100);
      }
    };

    window.visualViewport?.addEventListener("resize", handleResize);
    return () =>
      window.visualViewport?.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    const container = messagesContainerRef.current;
    const label = scrollDateRef.current;
    if (!container || !label) return;

    const showLabel = (text: string) => {
      const span = label.querySelector("span");
      if (span) span.textContent = text;
      label.style.opacity = "1";
    };

    const hideLabel = () => {
      label.style.opacity = "0";
    };

    const handleScroll = () => {
      if (isAutoScrolling.current) return;

      const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 50;
      if (isAtBottom) {
        hideLabel();
        return;
      }

      const bubbles = container.querySelectorAll("[data-msg-date]");
      let visibleDate: string | null = null;

      for (const bubble of bubbles) {
        const rect = bubble.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        if (rect.top >= containerRect.top - 20) {
          visibleDate = bubble.getAttribute("data-msg-date");
          break;
        }
      }

      if (visibleDate) {
        showLabel(visibleDate);
        if (scrollDateTimeout.current) clearTimeout(scrollDateTimeout.current);
        scrollDateTimeout.current = setTimeout(hideLabel, 1500);
      }
    };

    container.addEventListener("scroll", handleScroll);
    return () => {
      container.removeEventListener("scroll", handleScroll);
      if (scrollDateTimeout.current) clearTimeout(scrollDateTimeout.current);
    };
  }, [messages]);

  const formatRecordingTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  if (!conversation) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3 }}
        className="flex h-full items-center justify-center"
      >
        <EmptyState
          image="video_call"
          title="Nenhuma conversa selecionada"
          description="Selecione uma conversa para iniciar"
          imageSize={280}
        />
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className="flex h-full max-h-[100dvh] flex-col"
    >
      <ChatHeader
        name={conversation.name}
        phone={conversation.phone}
        pets={conversation.pets}
        isAiActive={isAiActive}
        onToggleAi={onToggleAi}
        clientId={conversation.clientId}
        conversationId={conversation.id}
      />

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div
          ref={scrollDateRef}
          style={{ opacity: 0 }}
          className="absolute top-2 left-0 right-0 z-10 flex justify-center pointer-events-none transition-opacity duration-300"
        >
          <span className="px-3 py-1 rounded-lg bg-[#0F172A]/70 dark:bg-[#2A2B2F]/90 text-xs text-white/90 backdrop-blur-sm shadow-sm">
          </span>
        </div>
        <div
          ref={messagesContainerRef}
          className="flex h-full flex-col gap-4 overflow-y-auto p-4 sm:p-6"
        >
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#1E62EC] border-t-transparent" />
          </div>
        ) : (
          <AnimatePresence mode="popLayout">
            {messages.map((msg) => (
              <motion.div
                key={msg.id}
                data-msg-date={msg.rawDate || ""}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
              >
                <ChatBubble
                  message={msg.message}
                  time={msg.time}
                  variant={msg.variant}
                  isRead={msg.isRead}
                  isAudio={msg.isAudio}
                  audioDuration={msg.audioDuration}
                  audioUrl={msg.audioUrl}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        )}
        </div>
      </div>

      {isRecording && (
        <div className="flex items-center justify-center gap-3 border-t border-[#727B8E]/10 dark:border-[#40485A] bg-red-50 dark:bg-red-900/20 px-4 py-3">
          <div className="h-3 w-3 animate-pulse rounded-full bg-red-500" />
          <span className="text-sm font-medium text-red-600">
            Gravando... {formatRecordingTime(recordingTime)}
          </span>
          <button
            onClick={onStopRecording}
            className="rounded-full bg-red-500 px-4 py-1 text-sm text-white transition-colors hover:bg-red-600"
          >
            Parar
          </button>
        </div>
      )}

      {!isRecording && (
        <div className="border-t border-[#727B8E]/10 dark:border-[#40485A] bg-white dark:bg-[#1A1B1D] p-3 sm:p-4">
          <ChatInput onSend={onSendMessage} onVoice={onStartRecording} />
        </div>
      )}
    </motion.div>
  );
}

function ChatPageContent() {
  const [searchParams] = useSearchParams();
  const idFromUrl = searchParams.get("id");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [conversations, setConversations] = useState<MockConversation[]>([]);
  const [messagesMap, setMessagesMap] = useState<Record<string, MockMessage[]>>(
    {},
  );
  const [isAiActive, setIsAiActive] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [loadingConversations, setLoadingConversations] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [useRealApi, setUseRealApi] = useState(false);
  const recordingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const { fetchConversations, getConversation, sendMessage, toggleAI } =
    useConversations();

  const selectedConversation =
    conversations.find((c) => c.id === selectedId) ?? null;
  const currentMessages = selectedId ? (messagesMap[selectedId] ?? []) : [];

  useEffect(() => {
    if (!idFromUrl || loadingConversations) return;
    setConversations((prev) => {
      if (prev.some((c) => c.id === idFromUrl)) return prev;
      const stub: MockConversation = {
        id: idFromUrl,
        name: "Conversa",
        pets: "",
        lastMessage: "",
        time: "",
        unreadCount: 0,
        isOnline: false,
        phone: "",
        whatsappPhone: "",
      };
      return [...prev, stub];
    });
    setSelectedId(idFromUrl);
  }, [idFromUrl, loadingConversations]);

  const loadConversations = useCallback(async () => {
    try {
      setLoadingConversations(true);
      const apiConversations = await fetchConversations();
      setConversations(apiConversations.map(mapApiConversation));
      setUseRealApi(true);
    } catch {
      setConversations([]);
    } finally {
      setLoadingConversations(false);
    }
  }, [fetchConversations]);

  const loadMessages = useCallback(async (conversationId: string) => {
    try {
      setLoadingMessages(true);
      const messages = await conversationService.getMessages(conversationId);
      setMessagesMap((prev) => ({
        ...prev,
        [conversationId]: messages
          .filter((m: any) => m.content)
          .map(mapApiMessage),
      }));
    } catch {
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    setIsAiActive(!(selectedConversation?.isAiPaused ?? false));
  }, [selectedConversation?.id, selectedConversation?.isAiPaused]);

  useEffect(() => {
    if (selectedId && messagesMap[selectedId] === undefined) {
      loadMessages(selectedId);
    }
  }, [selectedId, loadMessages, messagesMap]);

  const handleSendMessage = async (message: string) => {
    if (!selectedId || !selectedConversation) {
      return;
    }

    const newMessage: MockMessage = {
      id: Date.now().toString(),
      variant: "sent",
      message,
      time: getCurrentTime(),
      isRead: false,
    };

    setMessagesMap((prev) => ({
      ...prev,
      [selectedId]: [...(prev[selectedId] ?? []), newMessage],
    }));

    setConversations((prev) =>
      prev.map((conv) =>
        conv.id === selectedId
          ? {
            ...conv,
            lastMessage: message,
            time: getCurrentTime(),
            unreadCount: 0,
          }
          : conv,
      ),
    );

    if (selectedConversation.whatsappPhone) {
      try {
        await whatsappService.sendMessage({
          to: selectedConversation.whatsappPhone,
          message,
        });
      } catch (err) {
        console.error("[Chat] Failed to send via WhatsApp:", err);
      }
    }

    if (isAiActive && !useRealApi) {
      setTimeout(
        () => {
          const aiResponse: MockMessage = {
            id: (Date.now() + 1).toString(),
            variant: "received",
            message:
              AI_RESPONSES[Math.floor(Math.random() * AI_RESPONSES.length)],
            time: getCurrentTime(),
          };

          setMessagesMap((prev) => ({
            ...prev,
            [selectedId]: [...(prev[selectedId] ?? []), aiResponse],
          }));

          setConversations((prev) =>
            prev.map((conv) =>
              conv.id === selectedId
                ? {
                  ...conv,
                  lastMessage: aiResponse.message,
                  time: getCurrentTime(),
                }
                : conv,
            ),
          );
        },
        1000 + Math.random() * 1000,
      );
    }
  };

  const handleToggleAi = async () => {
    const newState = !isAiActive;
    setIsAiActive(newState);

    if (useRealApi && selectedConversation) {
      try {
        await toggleAI(
          selectedId!,
          !newState,
          newState ? undefined : "Paused by user",
        );
        setConversations((prev) =>
          prev.map((c) =>
            c.id === selectedId ? { ...c, isAiPaused: !newState } : c,
          ),
        );
      } catch {
        setIsAiActive(!newState);
      }
    }
  };

  const handleStartRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];

      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorderRef.current.start();
      setIsRecording(true);
      setRecordingTime(0);
      recordingIntervalRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    } catch {
      alert("Não foi possível acessar o microfone. Verifique as permissões.");
    }
  };

  const handleStopRecording = () => {
    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
    }

    if (!mediaRecorderRef.current || !selectedId) {
      setIsRecording(false);
      return;
    }

    const currentRecordingTime = recordingTime;

    mediaRecorderRef.current.onstop = () => {
      const audioBlob = new Blob(audioChunksRef.current, {
        type: "audio/webm",
      });
      const audioUrl = URL.createObjectURL(audioBlob);

      const mins = Math.floor(currentRecordingTime / 60);
      const secs = currentRecordingTime % 60;
      const duration = `${mins}:${secs.toString().padStart(2, "0")}`;

      const audioMessage: MockMessage = {
        id: Date.now().toString(),
        variant: "sent",
        message: `🎤 Mensagem de voz (${duration})`,
        time: getCurrentTime(),
        isRead: false,
        isAudio: true,
        audioDuration: duration,
        audioUrl,
      };

      setMessagesMap((prev) => ({
        ...prev,
        [selectedId]: [...(prev[selectedId] ?? []), audioMessage],
      }));

      setConversations((prev) =>
        prev.map((conv) =>
          conv.id === selectedId
            ? {
              ...conv,
              lastMessage: "🎤 Mensagem de voz",
              time: getCurrentTime(),
              unreadCount: 0,
            }
            : conv,
        ),
      );

      if (isAiActive && !useRealApi) {
        setTimeout(() => {
          const aiResponse: MockMessage = {
            id: (Date.now() + 1).toString(),
            variant: "received",
            message: "Recebi seu áudio! Vou ouvir e já respondo. 🎧",
            time: getCurrentTime(),
          };

          setMessagesMap((prev) => ({
            ...prev,
            [selectedId]: [...(prev[selectedId] ?? []), aiResponse],
          }));

          setConversations((prev) =>
            prev.map((conv) =>
              conv.id === selectedId
                ? {
                  ...conv,
                  lastMessage: aiResponse.message,
                  time: getCurrentTime(),
                }
                : conv,
            ),
          );
        }, 1500);
      }

      mediaRecorderRef.current?.stream
        .getTracks()
        .forEach((track) => track.stop());
    };

    mediaRecorderRef.current.stop();
    setIsRecording(false);
    setRecordingTime(0);
  };

  useEffect(() => {
    return () => {
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
      }
    };
  }, []);

  return (
    <DashboardLayout
      sidebar={
        <ConversationsSidebar
          conversations={conversations}
          selectedId={selectedId}
          onSelect={setSelectedId}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          loading={loadingConversations}
        />
      }
    >
      <ChatArea
        conversation={selectedConversation}
        messages={currentMessages}
        isAiActive={isAiActive}
        onToggleAi={handleToggleAi}
        onSendMessage={handleSendMessage}
        isRecording={isRecording}
        onStartRecording={handleStartRecording}
        onStopRecording={handleStopRecording}
        recordingTime={recordingTime}
        loading={loadingMessages}
      />
    </DashboardLayout>
  );
}

export default function ChatPage() {
  return (
    <Suspense
      fallback={
        <DashboardLayout sidebar={null}>
          <div className="flex h-full items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#1E62EC] border-t-transparent" />
          </div>
        </DashboardLayout>
      }
    >
      <ChatPageContent />
    </Suspense>
  );
}
