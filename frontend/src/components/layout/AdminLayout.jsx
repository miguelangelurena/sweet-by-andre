import { useEffect, useState } from "react";
import PreviewBanner from "./PreviewBanner";
import { logout } from "../../services/api";

const NAV = [
  { href: "#admin/dashboard", label: "Dashboard" },
  { href: "#admin/products", label: "Products" },
  { href: "#admin/orders", label: "Orders" },
  { href: "#admin/seasonal", label: "Seasonal" },
  { href: "#admin/delivery", label: "Delivery & pickup" },
  { href: "#admin/production", label: "Preparation & capacity" },
];

export default function AdminLayout({ children }) {
  const [hash, setHash] = useState(window.location.hash);
  const [signingOut, setSigningOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    setLogoutError("");
    try {
      await logout();
      window.location.hash = "#admin/login";
    } catch (error) {
      if (error.status === 401) window.location.hash = "#admin/login";
      else setLogoutError("Could not sign out. Please try again.");
    } finally { setSigningOut(false); }
  }
  useEffect(() => {
    const update = () => setHash(window.location.hash);
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);

  return (
    <div className="min-h-screen bg-[#FAF7F5] md:flex">
      <aside className="border-b border-[#E7DCD9] bg-white md:min-h-screen md:w-64 md:shrink-0 md:border-b-0 md:border-r">
        <div className="border-b border-[#E7DCD9] px-6 py-7">
          <a href="#admin/dashboard" className="block" aria-label="Sweet by Andre admin dashboard">
            <span className="block font-serif text-3xl text-[#282323]">Sweet</span>
            <span className="text-xs font-semibold tracking-[0.3em] text-[#B76473]">BY ANDRE</span>
          </a>
          <p className="mt-3 text-xs text-[#756B69]">Administration</p>
        </div>
        <nav aria-label="Admin navigation" className="flex flex-wrap gap-2 p-4 md:flex-col">
          {NAV.map(({ href, label }) => {
            const active = hash === href;
            return (
              <a key={href} href={href} aria-current={active ? "page" : undefined}
                className={`rounded-lg px-4 py-3 text-sm font-semibold transition-colors focus-visible:outline-[#B76473] ${active ? "bg-[#FAF0F1] text-[#B76473]" : "text-[#756B69] hover:bg-[#FAF0F1] hover:text-[#B76473]"}`}>
                {label}
              </a>
            );
          })}
        </nav>
        <div className="space-y-3 p-4">
          <a href="/" className="block text-sm text-[#756B69] hover:text-[#B76473]">View website</a>
          <button type="button" onClick={signOut} disabled={signingOut}
            className="min-h-11 w-full rounded-lg border border-[#E7DCD9] px-4 py-2 text-left text-sm font-semibold text-[#756B69] hover:bg-[#FAF0F1] disabled:opacity-50">
            {signingOut ? "Signing out..." : "Sign out"}
          </button>
          {logoutError && <p role="alert" className="text-sm text-red-700">{logoutError}</p>}
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <PreviewBanner />
        <header className="flex items-center justify-between border-b border-[#E7DCD9] bg-white px-6 py-5">
          <p className="text-sm font-medium text-[#282323]">Admin Panel</p>
          <span className="rounded-full bg-[#FAF0F1] px-3 py-1 text-xs font-semibold text-[#B76473]">Administrator</span>
        </header>
        {children}
      </div>
    </div>
  );
}
