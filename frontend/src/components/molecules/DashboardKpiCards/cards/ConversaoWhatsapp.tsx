import { Card } from "@/components/ui/card";
import { MessagesSquare } from "lucide-react";

interface Props {
  conversionRate: number;
  totalAppointments: number;
  revenueGenerated: number;
  totalConversations: number;
}

const ConversaoWhatsapp = ({ conversionRate, totalAppointments, revenueGenerated, totalConversations }: Props) => {
  if (totalConversations === 0) {
    return (
      <Card className="p-5">
        <p className="text-xs font-semibold tracking-wider uppercase text-[#434A57] dark:text-[#f5f9fc]">Conversão WhatsApp</p>
        <div className="mt-3 flex text-[#727B8E] dark:text-[#8a94a6]" aria-hidden>
          <MessagesSquare className="h-8 w-8" strokeWidth={1.25} />
        </div>
        <p className="text-xs mt-1 text-[#727B8E] dark:text-[#8a94a6]">Sem conversas registradas</p>
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold tracking-wider uppercase text-[#434A57] dark:text-[#f5f9fc]">Conversão WhatsApp</p>
      </div>
      <p className="text-4xl font-bold mt-3 text-[#0F172A] dark:text-white">{Math.round(conversionRate)}%</p>
      <div className="grid grid-cols-2 gap-4 mt-4">
        <div>
          <p className="text-2xl font-bold text-[#0F172A] dark:text-white">{totalAppointments}</p>
          <p className="text-xs text-[#727B8E] dark:text-[#8a94a6] uppercase">Agendamentos</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-[#0F172A] dark:text-white">
            {revenueGenerated.toLocaleString('pt-BR', {
              style: 'currency',
              currency: 'BRL',
              minimumFractionDigits: 0,
            })}
          </p>
          <p className="text-xs text-[#727B8E] dark:text-[#8a94a6] uppercase">Valor Gerado</p>
        </div>
      </div>
      <p className="text-xs text-[#727B8E] dark:text-[#8a94a6] mt-3">{totalConversations} conversas recebidas</p>
    </Card>
  );
};

export default ConversaoWhatsapp;
