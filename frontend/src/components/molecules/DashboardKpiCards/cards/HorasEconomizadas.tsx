import { Card } from "@/components/ui/card";

interface Props {
  hours: number;
  afterHoursPct: number;
  weekendPct: number;
  totalConversations: number;
}

const HorasEconomizadas = ({ hours, afterHoursPct, weekendPct, totalConversations }: Props) => {
  if (totalConversations === 0) {
    return (
      <Card className="p-5">
        <p className="text-xs font-semibold tracking-wider uppercase text-[#434A57] dark:text-[#f5f9fc]">Horas Economizadas</p>
        <p className="text-2xl font-bold mt-3 text-[#727B8E] dark:text-[#8a94a6]">—</p>
        <p className="text-xs mt-1 text-[#0F172A] dark:text-white">Sem conversas este mês</p>
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <p className="text-xs font-semibold tracking-wider uppercase text-[#434A57] dark:text-[#f5f9fc]">Horas Economizadas</p>
      <p className="text-4xl font-bold mt-3 text-[#0F172A] dark:text-white">{hours}</p>
      <div className="flex items-center gap-2 mt-2">
        <span className="text-sm text-[#727B8E] dark:text-[#8a94a6]">este mês</span>
        <span className="text-xs bg-[#4254f0]/10 text-[#4254f0] px-2 py-0.5 rounded-full font-medium">automático</span>
      </div>
      <div className="mt-4 space-y-1 text-sm text-[#727B8E] dark:text-[#8a94a6]">
        <div className="flex justify-between">
          <span>Fora do horário</span>
          <span className="font-semibold text-[#0F172A] dark:text-white">{afterHoursPct}%</span>
        </div>
        <div className="flex justify-between">
          <span>Fins de semana</span>
          <span className="font-semibold text-[#0F172A] dark:text-white">{weekendPct}%</span>
        </div>
      </div>
    </Card>
  );
};

export default HorasEconomizadas;
