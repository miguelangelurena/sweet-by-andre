import { useState } from "react";

export default function Header() {
  const [menuOpen, setMenuOpen] = useState(false);

  const links = [
    { label: "Home", href: "#home" },
    { label: "Menu", href: "#menu" },
    { label: "Gallery", href: "#gallery" },
    { label: "About Us", href: "#about" },
    { label: "Contact", href: "#contact" },
  ];

  return (
    <header className="border-b border-[#E7DCD9] bg-[#FAF7F5]">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
        <a href="#home" className="flex flex-col">
          <span className="font-serif text-3xl leading-none text-[#282323]">
            Sweet
          </span>
          <span className="mt-1 text-[10px] font-semibold tracking-[0.35em] text-[#B76473]">
            BY ANDRE
          </span>
        </a>

        <nav className="hidden items-center gap-9 md:flex">
          {links.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className="text-sm text-[#282323] transition hover:text-[#B76473]"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-5">
          <button
            type="button"
            aria-label="Shopping cart"
            className="relative text-xl text-[#282323]"
          >
            🛒
            <span className="absolute -right-2 -top-2 rounded-full bg-[#D47783] px-1.5 text-[10px] text-white">
              0
            </span>
          </button>

          <button
            type="button"
            aria-label="Toggle menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(!menuOpen)}
            className="text-2xl text-[#282323] md:hidden"
          >
            ☰
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav className="flex flex-col gap-4 border-t border-[#E7DCD9] px-6 py-5 md:hidden">
          {links.map((link) => (
            <a
              key={link.label}
              href={link.href}
              onClick={() => setMenuOpen(false)}
              className="text-sm text-[#282323]"
            >
              {link.label}
            </a>
          ))}
        </nav>
      )}
    </header>
  );
}
