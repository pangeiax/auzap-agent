import { Link } from "react-router-dom";
import { ChevronLeft, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/cn";
import { useTheme } from "@/contexts/ThemeContext";
import { AuthBackProvider, useAuthBack } from "./AuthBackContext";

interface AuthLayoutProps {
  children: React.ReactNode;
}

function BackButton() {
  const { onBack } = useAuthBack();

  const buttonClasses = cn(
    "flex h-[42px] w-[42px] items-center justify-center rounded-full",
    "border border-[#727B8E]/10 bg-white dark:border-[#40485A] dark:bg-[#212225] transition-colors hover:bg-gray-50 dark:hover:bg-[#40485A]",
  );

  if (onBack) {
    return (
      <button
        type="button"
        onClick={onBack}
        className={buttonClasses}
        aria-label="Voltar"
      >
        <ChevronLeft
          className="h-[10px] w-[10px] stroke-[#727B8E] dark:stroke-[#8a94a6]"
          strokeWidth={2}
        />
      </button>
    );
  }

  return (
    <Link to="/" className={buttonClasses} aria-label="Voltar">
      <ChevronLeft
        className="h-[10px] w-[10px] stroke-[#727B8E] dark:stroke-[#8a94a6]"
        strokeWidth={2}
      />
    </Link>
  );
}

export function AuthLayout({ children }: AuthLayoutProps) {
  const { theme, toggleTheme } = useTheme();

  return (
    <AuthBackProvider>
      <div className="relative min-h-screen w-full overflow-x-hidden dark:bg-gradient-to-b dark:from-[#1B5FE9] dark:to-[#1A1B1D]">
        <div className="absolute right-4 top-4 z-20 sm:right-6 sm:top-6">
          <button
            type="button"
            onClick={toggleTheme}
            className={cn(
              "flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full transition-colors",
              "border border-white/20 bg-white/10 backdrop-blur-sm dark:border-[#40485A] dark:bg-[#1A1B1D]/80 hover:bg-white/20 dark:hover:bg-[#212225]",
            )}
            aria-label={
              theme === "dark"
                ? "Alternar para modo claro"
                : "Alternar para modo escuro"
            }
          >
            {theme === "dark" ? (
              <Sun
                className="h-4 w-4 stroke-white/90 dark:stroke-[#8a94a6]"
                strokeWidth={1.67}
              />
            ) : (
              <Moon className="h-4 w-4 stroke-white/90" strokeWidth={1.67} />
            )}
          </button>
        </div>



        <div className="relative z-10 mx-auto mt-4 flex w-full max-w-[1209px] px-4 pb-6 sm:mt-6 sm:pb-8 lg:mt-[54px] lg:px-0 lg:pb-10">
          <div
            className={cn(
              "relative flex w-full overflow-hidden rounded-2xl bg-white dark:bg-[#1A1B1D] sm:rounded-3xl",
              "border border-[#727B8E]/10 dark:border-[#40485A]",
            )}
            style={{ minHeight: "min(974px, calc(100vh - 180px))" }}
          >
            <div className="hidden w-[356px] absolute shrink-0 flex-col lg:flex">
              <div className="flex items-center p-[15px]">
                <BackButton />
              </div>
              <div className="h-px w-full bg-[#727B8E]/10 dark:bg-[#40485A]" />
            </div>

            <div className="flex flex-1 flex-col items-center justify-center px-4 py-8 sm:px-6 sm:py-10 lg:px-[80px] lg:py-12">
              {children}
            </div>
          </div>
        </div>
      </div>
    </AuthBackProvider>
  );
}
