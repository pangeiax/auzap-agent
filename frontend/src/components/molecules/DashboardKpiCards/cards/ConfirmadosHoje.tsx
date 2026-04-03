import { Card } from "@/components/ui/card";

interface Props {
  confirmed: number;
  total: number;
  pending: number;
}

const ConfirmadosHoje = ({ confirmed, total, pending }: Props) => {
  if (total === 0) {
    return (
      <Card className="relative overflow-hidden bg-[#4254f0] text-[#ffffff] p-5">
        <p className="text-xs font-semibold tracking-wider uppercase opacity-90">Confirmados Hoje</p>
        <div className="mt-3">
          <span className="text-2xl font-bold opacity-70">—</span>
        </div>
        <p className="text-xs mt-1 opacity-70">Sem agendamentos hoje</p>
      </Card>
    );
  }

  return (
    <Card className="relative overflow-hidden bg-[#4254f0] text-[#ffffff] p-5">
      <p className="text-xs font-semibold tracking-wider uppercase opacity-90">Confirmados Hoje</p>
      <div className="mt-3 flex items-baseline gap-1">
        <span className="text-5xl font-bold">{confirmed}</span>
        <span className="text-xl opacity-70">/{total}</span>
      </div>
      <p className="text-xs uppercase tracking-wide mt-1 opacity-80">Agendamentos Confirmados</p>
      {pending > 0 ? (
        <p className="text-xs mt-1 opacity-70">{pending} aguardando confirmação</p>
      ) : (
        <p className="text-xs mt-1 opacity-70">Todos confirmados ✓</p>
      )}
    </Card>
  );
};

export default ConfirmadosHoje;
