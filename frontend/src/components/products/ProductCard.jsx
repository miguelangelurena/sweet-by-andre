const formatPrice = (price) => {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(price));
};

export default function ProductCard({ product }) {
  const inStock =
    product.has_available_variants && (product.inventory_mode === "made_to_order" || Number(product.total_stock) > 0);

  return (
    <a
      href={`#product/${product.id}`}
      className="group relative grid grid-cols-[5.5rem_minmax(0,1fr)] items-start gap-3 overflow-hidden rounded-2xl border border-[#E7DCD9] bg-white p-3 transition-shadow duration-300 hover:shadow-lg sm:block sm:p-0"
    >
      <div className="aspect-square overflow-hidden rounded-xl bg-[#F1E5E2] sm:aspect-[4/3] sm:rounded-none">
        {product.image_url ? (
          <img
            src={product.image_url}
            alt={product.name}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 motion-safe:group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="px-2 text-center font-serif text-sm italic text-[#B76473]/70 sm:text-3xl">
              Sweet by Andre
            </span>
          </div>
        )}
      </div>

      <div className="min-w-0 sm:p-7">
        <p className="hidden text-xs uppercase tracking-[0.2em] text-[#B76473] sm:block">
          {product.category_name}
        </p>

        <h2 className="break-words font-serif text-lg leading-snug text-[#282323] sm:mt-3 sm:text-2xl sm:leading-8">
          {product.name}
        </h2>

        <p className="mt-1 line-clamp-2 text-[13px] leading-5 text-[#796D6A] sm:mt-3 sm:min-h-12 sm:line-clamp-none sm:text-sm sm:leading-6">
          {product.description}
        </p>

        <div className="mt-2 flex flex-col items-start gap-0.5 pr-5 sm:mt-6 sm:flex-row sm:items-center sm:justify-between sm:border-t sm:border-[#F0E7E4] sm:pt-5 sm:pr-0">
          <span className="text-sm font-semibold text-[#282323] sm:text-lg">
            {inStock
              ? `From ${formatPrice(product.min_price)}`
              : "Currently unavailable"}
          </span>

          <span
            className={`text-xs font-medium sm:text-sm ${
              inStock ? "text-[#B76473]" : "text-[#A29A97]"
            }`}
          >
            {inStock ? product.inventory_mode === "made_to_order" ? "Made to order" : "Available" : "Unavailable"}
          </span>
        </div>
      </div>
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="absolute right-3 bottom-3 h-4 w-4 text-[#B76473] sm:hidden">
        <path d="m9 5 7 7-7 7" />
      </svg>
    </a>
  );
}
