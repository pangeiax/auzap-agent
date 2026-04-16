import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Wrench } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/atoms/Button";
import { AuthLink } from "@/components/atoms/AuthLink";
import { FormField } from "@/components/molecules/FormField";
import { AuthHeader } from "@/components/molecules/AuthHeader";
import { ForgotPasswordModal } from "@/components/molecules/ForgotPasswordModal";
import { useAuthContext } from "@/contexts";

const loginSchema = z.object({
  email: z.string().email("Email inválido"),
  senha: z.string().min(1, "Senha é obrigatória"),
});

type LoginForm = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const navigate = useNavigate();
  const {
    login,
    loading: authLoading,
    error: authError,
    clearError,
  } = useAuthContext();
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
    setError,
  } = useForm<LoginForm>();

  const onSubmit = async (data: LoginForm) => {
    const result = loginSchema.safeParse(data);
    if (!result.success) {
      for (const issue of result.error.issues) {
        const field = issue.path[0] as keyof LoginForm;
        setError(field, { message: issue.message });
      }
      return;
    }

    setLoginError(null);
    clearError();

    try {
      await login({
        email: result.data.email,
        password: result.data.senha,
      });
      navigate("/home");
    } catch (err: any) {
      setLoginError(
        err.response?.data?.detail ||
          "Email ou senha inválidos. Tente novamente.",
      );
    }
  };

  return (
    <>
      <div className="animate-fade-in flex w-full max-w-[426px] flex-col items-center gap-10">
        <AuthHeader
          title="Acesse sua conta"
          subtitle="Insira suas credenciais para continuar"
        />

        <form
          onSubmit={handleSubmit(onSubmit)}
          className="flex w-full flex-col gap-5"
          noValidate
        >
          {(loginError || authError) && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
              {loginError || authError}
            </div>
          )}

          <FormField
            id="email"
            label="Email"
            required
            type="email"
            placeholder="exemple@gmail.com"
            error={errors.email?.message}
            {...register("email")}
          />

          <div className="flex flex-col gap-1.5">
            <FormField
              id="senha"
              label="Senha"
              required
              type="password"
              placeholder="••••••••••••••"
              error={errors.senha?.message}
              {...register("senha")}
            />
            {/* <button
              type="button"
              onClick={() => setShowForgotPassword(true)}
              className="self-end font-be-vietnam-pro text-sm font-semibold text-[#1E62EC] hover:underline"
            >
              Esqueceu a senha?
            </button> */}
          </div>

          <Button type="submit" className="w-full" loading={authLoading}>
            Entrar
          </Button>
        </form>

        {/* <AuthLink
          text="Não tem uma conta?"
          linkText="Criar conta"
          href="/criar-conta"
        /> */}
      </div>

      <ForgotPasswordModal
        open={showForgotPassword}
        onClose={() => setShowForgotPassword(false)}
      />

      {/* Dev Tools — só aparece se localStorage "dev-tool" estiver setado */}
      {typeof window !== "undefined" && !!localStorage.getItem("dev-tool") && (
        <button
          type="button"
          onClick={() => navigate("/dev-tools")}
          className="fixed bottom-4 right-4 flex h-10 w-10 items-center justify-center rounded-full border border-[#727B8E]/20 bg-white/80 text-[#727B8E] shadow-sm backdrop-blur-sm transition-colors hover:bg-[#1E62EC] hover:text-white dark:border-[#40485A] dark:bg-[#1A1B1D]/80"
          title="Dev Tools"
        >
          <Wrench size={18} />
        </button>
      )}
    </>
  );
}
