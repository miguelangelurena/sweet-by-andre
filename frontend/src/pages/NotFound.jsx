export default function NotFound() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-20 text-center">
      <h1 className="font-serif text-4xl text-[#49332F]">Page not found</h1>
      <p className="mt-5 text-[#786962]">
        This page is unavailable. There's still something sweet waiting for you.
      </p>
      <a href="/catalog" className="brand-button mt-8">
        Explore our dessert menu
      </a>
    </main>
  );
}
