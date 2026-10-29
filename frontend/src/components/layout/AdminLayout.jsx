export default function AdminLayout({ children }) {
  return (
    <div className="min-h-screen bg-[#FAF7F5] md:flex">
      <aside className="border-b border-[#E7DCD9] bg-white md:min-h-screen md:w-64 md:border-b-0 md:border-r">
        <div className="border-b border-[#E7DCD9] px-6 py-7">
          <a href="#admin/products" className="block">
            <span className="block font-serif text-3xl text-[#282323]">
              Sweet
            </span>
            <span className="text-xs font-semibold tracking-[0.3em] text-[#B76473]">
              BY ANDRE
            </span>
          </a>
          <p className="mt-3 text-xs text-[#756B69]">Administration</p>
        </div>

        <nav className="flex gap-2 p-4 md:flex-col">
          <a
            href="#admin/products"
            className="rounded-lg bg-[#FAF0F1] px-4 py-3 text-sm font-semibold text-[#B76473]"
          >
            Products
          </a>

          <a href="#admin/orders" className="rounded-lg px-4 py-3 text-sm font-semibold text-[#756B69] hover:bg-[#FAF0F1] hover:text-[#B76473]">Orders</a>

          <span className="cursor-not-allowed rounded-lg px-4 py-3 text-sm text-[#A69B98]">
            Dashboard · Coming soon
          </span>
        </nav>

        <div className="p-4">
          <a
            href="#home"
            className="text-sm text-[#756B69] hover:text-[#B76473]"
          >
            ← View website
          </a>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="flex items-center justify-between border-b border-[#E7DCD9] bg-white px-6 py-5">
          <p className="text-sm font-medium text-[#282323]">Admin Panel</p>

          <span className="rounded-full bg-[#FAF0F1] px-3 py-1 text-xs font-semibold text-[#B76473]">
            Administrator
          </span>
        </header>

        {children}
      </div>
    </div>
  );
}
