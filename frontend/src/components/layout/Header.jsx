import { useEffect, useState } from "react";

const CART_UPDATED_EVENT = "sweetbyandre:cart-updated";

export default function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [cartCount, setCartCount] = useState(0);

  const links = [
    { label: "Home", href: "#home" },
    { label: "Menu", href: "#menu" },
    { label: "Gallery", href: "#gallery" },
    { label: "About Us", href: "#about" },
    { label: "Contact", href: "#contact" },
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
          <a
            href="#cart"
            aria-label={`Shopping cart, ${cartCount} items`}
            className="relative text-xl text-[#282323] transition hover:text-[#B76473]"
          >
            <span aria-hidden="true">🛒</span>
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
          <a
            href="#cart"
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
