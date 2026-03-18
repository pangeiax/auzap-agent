import { Routes, Route, Navigate, Outlet } from "react-router-dom";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { AuthProvider } from "@/contexts/AuthContext";
import { ToastProvider } from "@/contexts/ToastContext";
import { useAuthContext } from "@/contexts";
import { AuthLayout } from "@/components/templates/AuthLayout";

// Pages
import LandingPage from "@/app/(public)/page";
import LoginPage from "@/app/(auth)/login/page";
import CriarContaPage from "@/app/(auth)/criar-conta/page";
import OnboardingPage from "@/app/(auth)/onboarding/page";
import HomePage from "@/app/(dashboard)/home/page";
import ChatPage from "@/app/(dashboard)/chat/page";
import ClientesPage from "@/app/(dashboard)/clientes/page";
import ConfiguracoesPage from "@/app/(dashboard)/configuracoes/page";
import CalendarioPage from "@/app/(dashboard)/calendario/page";
import PipelinePage from "@/app/(dashboard)/pipeline/page";
import AnalyticsPage from "@/app/(dashboard)/_analytics/page";
import HotelCrechePage from "@/app/(dashboard)/hotel-creche/page";
import NotFoundPage from "@/app/not-found";

function AuthRoutesLayout() {
  return (
    <AuthLayout>
      <Outlet />
    </AuthLayout>
  );
}

function ProtectedRoutes() {
  const { isAuthenticated, loading } = useAuthContext();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#FAFAFA] dark:bg-[#272A34]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#1E62EC] border-t-transparent" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}

function AppRoutes() {
  return (
    <Routes>
      <Route element={<AuthRoutesLayout />}>
        <Route path="/" element={<LoginPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/criar-conta" element={<CriarContaPage />} />
        <Route path="/onboarding" element={<OnboardingPage />} />
      </Route>
      <Route element={<ProtectedRoutes />}>
        <Route path="/home" element={<HomePage />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/clientes" element={<ClientesPage />} />
        <Route path="/configuracoes" element={<ConfiguracoesPage />} />
        <Route path="/calendario" element={<CalendarioPage />} />
        <Route path="/hotel-creche" element={<HotelCrechePage />} />
        <Route path="/pipeline" element={<PipelinePage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
