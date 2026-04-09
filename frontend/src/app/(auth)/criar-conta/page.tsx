import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm, Controller } from "react-hook-form";
import { z } from "zod";
import { ChevronUp } from "lucide-react";

import { Button } from "@/components/atoms/Button";
import { AuthLink } from "@/components/atoms/AuthLink";
import { Checkbox } from "@/components/atoms/Checkbox";
import { FormField } from "@/components/molecules/FormField";
import { AuthHeader } from "@/components/molecules/AuthHeader";
import { useAuthContext } from "@/contexts";
import { petshopService } from "@/services";
import {
  isValidCpfDigits,
  maskCpfInput,
  normalizeCpfDigits,
} from "@/lib/cpf";

function maskWhatsApp(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 2) {
    return digits ? `(${digits}` : "";
  }
  if (digits.length <= 7) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  }
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function whatsAppToDigits(masked: string): string {
  return masked.replace(/\D/g, "").slice(0, 11);
}

const criarContaSchema = z
  .object({
    nome: z.string().min(3, "Nome deve ter pelo menos 3 caracteres"),
    cpf: z
      .string()
      .min(1, "CPF é obrigatório")
      .refine(
        (v) => isValidCpfDigits(normalizeCpfDigits(v)),
        "CPF inválido",
      ),
    whatsapp: z
      .string()
      .regex(
        /^\(\d{2}\) \d{5}-\d{4}$/,
        "Informe um número válido: (XX) XXXXX-XXXX",
      ),
    email: z.string().email("Email inválido"),
    senha: z.string().min(6, "Senha deve ter pelo menos 6 caracteres"),
    confirmarSenha: z.string(),
    termos: z.literal(true, { message: "Você deve aceitar os termos" }),
  })
  .refine((data) => data.senha === data.confirmarSenha, {
    message: "As senhas não coincidem",
    path: ["confirmarSenha"],
  });

type CriarContaForm = z.infer<typeof criarContaSchema>;

export default function CriarContaPage() {
  const navigate = useNavigate();
  const { register: registerUser, login, clearError } = useAuthContext();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
    setError,
    control,
  } = useForm<CriarContaForm>({
    defaultValues: {
      cpf: "",
    },
  });

  const onSubmit = async (data: CriarContaForm) => {
    const result = criarContaSchema.safeParse(data);
    if (!result.success) {
      for (const issue of result.error.issues) {
        const field = issue.path[0] as keyof CriarContaForm;
        setError(field, { message: issue.message });
      }
      return;
    }

    setSubmitError(null);
    clearError();
    setIsSubmitting(true);

    try {
      const { nome, cpf, whatsapp, email, senha } = result.data;
      const phone = whatsAppToDigits(whatsapp) || "5500000000000";
      const cpfDigits = normalizeCpfDigits(cpf);

      const petshop = await petshopService.createPetshop({
        name: `Petshop de ${nome}`,
        address: "A definir",
        cep: "00000-000",
        phone: `+55${phone}`,
        owner_phone: `+55${phone}`,
        emergency_contact: `+55${phone}`,
      });

      await registerUser({
        email,
        name: nome,
        password: senha,
        petshop_id: petshop.id,
        cpf: cpfDigits,
      });

      await login({ email, password: senha });

      navigate("/home");
    } catch (err: any) {
      const message =
        err.response?.data?.error ||
        err.response?.data?.detail ||
        (Array.isArray(err.response?.data?.detail)
          ? err.response?.data?.detail
              .map((e: any) => e.msg || e.message)
              .join(", ")
          : "Erro ao criar conta. Tente novamente.");
      setSubmitError(
        typeof message === "string" ? message : "Erro ao criar conta.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="animate-fade-in flex w-full max-w-[426px] flex-col items-center gap-10">
      <AuthHeader
        title="Crie sua conta"
        subtitle="Preencha os dados abaixo para começar"
      />

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="flex w-full flex-col gap-5"
        noValidate
      >
        {submitError && (
          <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
            {submitError}
          </div>
        )}

        <FormField
          required
          id="nome"
          label="Nome"
          placeholder="Nome completo"
          error={errors.nome?.message}
          {...register("nome")}
        />

        <div className="flex w-full flex-col gap-3">
          <label
            htmlFor="cpf"
            className="flex items-center gap-1.5 font-be-vietnam-pro text-base font-semibold leading-[23px] text-[#434A57] dark:text-[#f5f9fc]"
          >
            CPF<span className="text-[#1E62EC]">*</span>
          </label>
          <Controller
            name="cpf"
            control={control}
            render={({ field }) => (
              <input
                {...field}
                id="cpf"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                placeholder="000.000.000-00"
                maxLength={14}
                className="flex h-[47px] w-full rounded-[4px] border border-[#727B8E]/10 bg-[#FAFAFA] dark:border-[#40485A] dark:bg-[#212225] px-[19px] py-[13px] font-be-vietnam-pro text-sm font-normal leading-5 text-[#434A57] dark:text-[#f5f9fc] placeholder:text-[#727B8E]/50 dark:placeholder:text-[#8a94a6]/70 outline-none transition-colors focus:border-[#1E62EC] focus:ring-1 focus:ring-[#1E62EC]/30"
                value={field.value ?? ""}
                onChange={(e) => field.onChange(maskCpfInput(e.target.value))}
              />
            )}
          />
          {errors.cpf?.message && (
            <p className="font-be-vietnam-pro text-xs text-red-500">
              {errors.cpf.message}
            </p>
          )}
        </div>

        <div className="flex w-full flex-col gap-3">
          <label
            htmlFor="whatsapp"
            className="flex items-center gap-1.5 font-be-vietnam-pro text-base font-semibold leading-[23px] text-[#434A57] dark:text-[#f5f9fc]"
          >
            WhatsApp<span className="text-[#1E62EC]">*</span>
            <ChevronUp className="h-3.5 w-3.5 text-[#434A57] dark:text-[#8a94a6]" />
          </label>
          <Controller
            name="whatsapp"
            control={control}
            render={({ field }) => (
              <input
                {...field}
                id="whatsapp"
                type="tel"
                placeholder="(00) 00000-0000"
                maxLength={16}
                className="flex h-[47px] w-full rounded-[4px] border border-[#727B8E]/10 bg-[#FAFAFA] dark:border-[#40485A] dark:bg-[#212225] px-[19px] py-[13px] font-be-vietnam-pro text-sm font-normal leading-5 text-[#434A57] dark:text-[#f5f9fc] placeholder:text-[#727B8E]/50 dark:placeholder:text-[#8a94a6]/70 outline-none transition-colors focus:border-[#1E62EC] focus:ring-1 focus:ring-[#1E62EC]/30"
                value={field.value ?? ""}
                onChange={(e) => field.onChange(maskWhatsApp(e.target.value))}
              />
            )}
          />
          {errors.whatsapp?.message && (
            <p className="font-be-vietnam-pro text-xs text-red-500">
              {errors.whatsapp.message}
            </p>
          )}
        </div>

        <FormField
          id="email"
          label="Email"
          required
          type="email"
          placeholder="exemple@gmail.com"
          error={errors.email?.message}
          {...register("email")}
        />

        <FormField
          id="senha"
          label="Senha"
          required
          type="password"
          placeholder="••••••••••••••"
          error={errors.senha?.message}
          {...register("senha")}
        />

        <FormField
          id="confirmarSenha"
          label="Confirmar senha"
          required
          type="password"
          placeholder="••••••••••••••"
          error={errors.confirmarSenha?.message}
          {...register("confirmarSenha")}
        />

        <Checkbox
          id="termos"
          label="Aceito os termos de uso e políticas de privacidade"
          error={errors.termos?.message}
          {...register("termos")}
        />

        <Button type="submit" className="w-full" loading={isSubmitting}>
          Criar conta
        </Button>
      </form>

      <AuthLink text="Já tem uma conta?" linkText="Fazer login" href="/login" />
    </div>
  );
}
