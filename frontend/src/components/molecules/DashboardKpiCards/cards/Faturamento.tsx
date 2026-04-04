import { Card } from "@/components/ui/card";
import { ChevronDown, ChevronUp, Wallet } from "lucide-react";

interface Props {
  today: number;
  todayVsYesterdayPct: number | null;
  thisWeek: number;
  thisWeekVsLastPct: number | null;
}

function formatCurrency(value: number) {
  return value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

const Faturamento = ({ today, todayVsYesterdayPct, thisWeek, thisWeekVsLastPct }: Props) => {
  const hasNoData = today === 0 && thisWeek === 0;

  if (hasNoData) {
    return (
      <Card className="p-5">
        <p className="text-xs font-semibold tracking-wider uppercase text-[#434A57] dark:text-[#f5f9fc]">Faturamento</p>
        <div className="mt-3 flex items-center text-[#727B8E] dark:text-[#8a94a6]" aria-hidden>
          <Wallet className="h-8 w-8 stroke-[1.25]" />
        </div>
        <p className="text-xs mt-1 text-[#0F172A] dark:text-white">Sem dados de faturamento</p>
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <p className="text-xs font-semibold tracking-wider uppercase text-[#434A57] dark:text-[#f5f9fc]">Faturamento</p>
      <div className="grid grid-cols-2 gap-4 mt-3">
        <div>
          <p className="text-xs text-[#727B8E] dark:text-[#8a94a6]">Hoje</p>
          <p className="text-2xl font-bold text-[#0F172A] dark:text-white">{formatCurrency(today)}</p>
          {todayVsYesterdayPct !== null ? (
            <p className={`text-xs mt-1 flex items-center gap-0.5 ${todayVsYesterdayPct >= 0 ? 'text-success' : 'text-destructive'}`}>
              {todayVsYesterdayPct >= 0 ? (
                <ChevronUp className="h-3.5 w-3.5 shrink-0" aria-hidden />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
              )}
              {Math.abs(todayVsYesterdayPct)}% vs ontem
            </p>
          ) : (
            <p className="text-xs mt-1 text-[#0F172A] dark:text-white">sem dado anterior</p>
          )}
        </div>
        <div>
          <p className="text-xs text-[#0F172A] dark:text-white">Esta Semana</p>
          <p className="text-2xl font-bold text-[#0F172A] dark:text-white">{formatCurrency(thisWeek)}</p>
          {thisWeekVsLastPct !== null ? (
            <p className={`text-xs mt-1 flex items-center gap-0.5 ${thisWeekVsLastPct >= 0 ? 'text-success' : 'text-destructive'}`}>
              {thisWeekVsLastPct >= 0 ? (
                <ChevronUp className="h-3.5 w-3.5 shrink-0" aria-hidden />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
              )}
              {Math.abs(thisWeekVsLastPct)}% vs ant.
            </p>
          ) : (
            <p className="text-xs mt-1 text-[#0F172A] dark:text-white">sem dado anterior</p>
          )}
        </div>
      </div>
    </Card>
  );
};

export default Faturamento;
