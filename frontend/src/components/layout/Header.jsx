import { useEffect, useState } from "react";

const CART_UPDATED_EVENT = "sweetbyandre:cart-updated";

export default function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [cartCount, setCartCount] = useState(0);

  const links = [
    { label: "Home", href: "/#home" },
    { label: "Menu", href: "/#menu" },
    { label: "Seasonal", href: "/#seasonal" },
    { label: "Our Story", href: "/#about" },
    { label: "Contact", href: "/#contact" },
  ];

  useEffect(() => {
    let active = true;
    let requestNumber = 0;

    async function refreshCartCount() {
      const thisRequest = ++requestNumber;

      try {
        // Consultamos el carrito existente sin crear uno al visitar la tienda.
        const response = await fetch("/api/guest/cart", {
          method: "GET",
          credentials: "include",
          headers: { Accept: "application/json" },
        });

        if (response.status === 401 || response.status === 404) {
          if (active && thisRequest === requestNumber) setCartCount(0);
          return;
        }

        if (!response.ok) {
          throw new Error(`Could not load cart (${response.status})`);
        }

        const data = await response.json();
        const count = (data.cart?.items ?? []).reduce(
          (total, item) => total + Number(item.quantity || 0),
          0,
        );

        if (active && thisRequest === requestNumber) {
          setCartCount(count);
        }
      } catch (error) {
        // Conservamos el contador anterior ante fallos temporales de red.
        console.error("Could not refresh cart count:", error);
      }
    }

    refreshCartCount();
    window.addEventListener(CART_UPDATED_EVENT, refreshCartCount);
    window.addEventListener("focus", refreshCartCount);

    return () => {
      active = false;
      window.removeEventListener(CART_UPDATED_EVENT, refreshCartCount);
      window.removeEventListener("focus", refreshCartCount);
    };
  }, []);

  return (
    <header className="border-b border-[#EADBD4] bg-[#FBF5F0]">
      <div className="mx-auto flex max-w-[1228px] items-center justify-between gap-3 px-4 py-6 sm:px-6">
        <a href="/#home" className="flex items-center gap-2 sm:gap-3" aria-label="Sweet by Andre home">
          <img src="/favicon.svg" width="48" height="48" alt="" className="h-9 w-9 rounded-xl sm:h-12 sm:w-12 sm:rounded-2xl" />
          <span>
            <span className="block font-serif text-lg leading-tight font-medium text-[#49332F] sm:text-3xl">Sweet by Andre</span>
            <span className="mt-1 block text-[8px] font-medium tracking-[0.16em] text-[#936B66] sm:text-[10px]">HANDCRAFTED WITH LOVE</span>
          </span>
        </a>

        <nav aria-label="Main navigation" className="hidden items-center gap-7 lg:flex">
          {links.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className="text-sm text-[#49332F] transition hover:text-[#9F5362]"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-3 sm:gap-5">
          <a
            href="/#cart"
            aria-label={`Shopping cart, ${cartCount} items`}
            className="relative grid h-10 w-10 place-items-center rounded-full border border-[#EADBD4] bg-[#FFF9F6] text-[#976E69] transition hover:bg-[#F1E1DF]"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8h12l1 12H5L6 8Z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></svg>
            <span
              aria-hidden="true"
              className="absolute -right-2 -top-2 min-w-4 rounded-full bg-[#D47783] px-1.5 text-center text-[10px] leading-4 text-white"
            >
              {cartCount > 99 ? "99+" : cartCount}
            </span>
          </a>

          <button
            type="button"
            aria-label="Toggle menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
            className="text-2xl text-[#49332F] lg:hidden"
          >
            ☰
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav aria-label="Mobile navigation" className="flex flex-col gap-4 border-t border-[#EADBD4] px-6 py-5 lg:hidden">
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
          <a
            href="/#cart"
            onClick={() => setMenuOpen(false)}
            className="text-sm text-[#282323]"
          >
            Cart ({cartCount})
          </a>
        </nav>
      )}
    </header>
  );
}
