import { Card } from "@/components/ui/card";

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
        <div className="mt-3">
          <span className="text-2xl font-bold text-[#727B8E] dark:text-[#8a94a6]">—</span>
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
            <p className={`text-xs mt-1 ${todayVsYesterdayPct >= 0 ? 'text-success' : 'text-destructive'}`}>
              {todayVsYesterdayPct >= 0 ? '↑' : '↓'} {Math.abs(todayVsYesterdayPct)}% vs ontem
            </p>
          ) : (
            <p className="text-xs mt-1 text-[#0F172A] dark:text-white">sem dado anterior</p>
          )}
        </div>
        <div>
          <p className="text-xs text-[#0F172A] dark:text-white">Esta Semana</p>
          <p className="text-2xl font-bold text-[#0F172A] dark:text-white">{formatCurrency(thisWeek)}</p>
          {thisWeekVsLastPct !== null ? (
            <p className={`text-xs mt-1 ${thisWeekVsLastPct >= 0 ? 'text-success' : 'text-destructive'}`}>
              {thisWeekVsLastPct >= 0 ? '↑' : '↓'} {Math.abs(thisWeekVsLastPct)}% vs ant.
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
