import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ArrowUpRight, Menu, X } from "lucide-react";
import { AuzapLogo } from "@/components/atoms/AuzapLogo";

const NAV_ITEMS = [
  { label: "Como funciona", hasDropdown: true },
  { label: "Diferenciais", hasDropdown: true },
  { label: "Preços", hasDropdown: true },
];

const NAV_ITEM_STYLE = { letterSpacing: "-0.32px" };

function NavItems() {
  return (
    <>
      {NAV_ITEMS.map((item) => (
        <button
          key={item.label}
          type="button"
          className="flex items-center gap-2 text-base text-[#434A57] transition-colors hover:text-[#1E62EC]"
          style={NAV_ITEM_STYLE}
        >
          {item.label}
          {item.hasDropdown && (
            <ChevronDown className="h-3 w-3 text-[#1A1A20]" />
          )}
        </button>
      ))}
    </>
  );
}

function AuthButtons({ layout }: { layout: "row" | "col" }) {
  const containerClass =
    layout === "row" ? "flex items-center gap-1" : "flex flex-col gap-2";
  return (
    <div className={containerClass}>
      <Link
        to="/criar-conta"
        className="rounded-lg font-sans border border-[#727B8E]/10 bg-white px-5 py-3 text-base text-[#202026] transition-colors hover:bg-[#F5F5F5] text-center"
        style={NAV_ITEM_STYLE}
      >
        Criar conta
      </Link>
      <Link
        to="/login"
        className="flex font-sans items-center justify-center gap-2 rounded-lg border border-[#727B8E]/10 bg-[#1E62EC] px-5 py-3 text-base text-white transition-colors hover:bg-[#1A56D4]"
        style={NAV_ITEM_STYLE}
      >
        Login
        <ArrowUpRight className="h-4 w-4" />
      </Link>
    </div>
  );
}

export function LandingHeader() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 w-full border-b border-[#727B8E]/10 bg-white">
      <div className="mx-auto flex max-w-[1440px] items-center justify-between px-6 py-4 lg:px-10">
        <AuzapLogo />

        <nav
          className="hidden items-center gap-6 md:flex"
          aria-label="Navegação principal"
        >
          <NavItems />
        </nav>

        <div className="hidden md:block">
          <AuthButtons layout="row" />
        </div>

        {/* <button
          type="button"
          className="md:hidden"
          onClick={() => setMobileMenuOpen((open) => !open)}
          aria-label={mobileMenuOpen ? "Fechar menu" : "Abrir menu"}
          aria-expanded={mobileMenuOpen}
          aria-controls="mobile-menu"
        >
          {mobileMenuOpen ? (
            <X className="h-6 w-6 text-[#434A57]" />
          ) : (
            <Menu className="h-6 w-6 text-[#434A57]" />
          )}
        </button> */}
      </div>

      {mobileMenuOpen && (
        <div
          id="mobile-menu"
          className="border-t border-[#727B8E]/10 bg-white px-6 pb-6 md:hidden"
        >
          <nav
            className="flex flex-col gap-4 pt-4"
            aria-label="Navegação mobile"
          >
            <NavItems />
          </nav>
          <div className="mt-4">
            <AuthButtons layout="col" />
          </div>
        </div>
      )}
    </header>
  );
}
