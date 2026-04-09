export function normalizeCpfDigits(input: string): string {
  return input.replace(/\D/g, "").slice(0, 11);
}

export function maskCpfInput(raw: string): string {
  const d = normalizeCpfDigits(raw);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9)
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

export function isValidCpfDigits(cpf: string): boolean {
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  const calc = (base: string, factor: number) => {
    let sum = 0;
    for (let i = 0; i < base.length; i++) {
      sum += parseInt(base[i]!, 10) * (factor - i);
    }
    const mod = (sum * 10) % 11;
    return mod === 10 ? 0 : mod;
  };

  const d1 = calc(cpf.slice(0, 9), 10);
  if (d1 !== parseInt(cpf[9]!, 10)) return false;
  const d2 = calc(cpf.slice(0, 10), 11);
  if (d2 !== parseInt(cpf[10]!, 10)) return false;
  return true;
}
