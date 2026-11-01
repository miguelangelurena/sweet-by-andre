const formatPrice = (price) => {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(price));
};

export default function ProductCard({ product, compactOnMobile = true }) {
  const inStock =
    product.has_available_variants && (product.inventory_mode === "made_to_order" || Number(product.total_stock) > 0);

  return (
    <a
      href={`#product/${product.id}`}
      className={`group relative overflow-hidden rounded-2xl border border-[#E7DCD9] bg-white transition-shadow duration-300 hover:shadow-lg ${compactOnMobile ? "grid grid-cols-[5.5rem_minmax(0,1fr)] items-start gap-3 p-3 sm:block sm:p-0" : "block"}`}
    >
      <div className={`overflow-hidden bg-[#F1E5E2] ${compactOnMobile ? "aspect-square rounded-xl sm:aspect-[4/3] sm:rounded-none" : "aspect-[4/3]"}`}>
        {product.image_url ? (
          <img
            src={product.image_url}
            alt={product.name}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 motion-safe:group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className={`text-center font-serif italic text-[#B76473]/70 ${compactOnMobile ? "px-2 text-sm sm:text-3xl" : "text-3xl"}`}>
              Sweet by Andre
            </span>
          </div>
        )}
      </div>

      <div className={compactOnMobile ? "min-w-0 sm:p-7" : "p-7"}>
        <p className={`text-xs uppercase tracking-[0.2em] text-[#B76473] ${compactOnMobile ? "hidden sm:block" : ""}`}>
          {product.category_name}
        </p>

        <h2 className={`font-serif text-[#282323] ${compactOnMobile ? "break-words text-lg leading-snug sm:mt-3 sm:text-2xl sm:leading-8" : "mt-3 text-2xl"}`}>
          {product.name}
        </h2>

        <p className={`text-[#796D6A] ${compactOnMobile ? "mt-1 line-clamp-2 text-[13px] leading-5 sm:mt-3 sm:min-h-12 sm:line-clamp-none sm:text-sm sm:leading-6" : "mt-3 min-h-12 text-sm leading-6"}`}>
          {product.description}
        </p>

        <div className={compactOnMobile ? "mt-2 flex flex-col items-start gap-0.5 pr-5 sm:mt-6 sm:flex-row sm:items-center sm:justify-between sm:border-t sm:border-[#F0E7E4] sm:pt-5 sm:pr-0" : "mt-6 flex items-center justify-between border-t border-[#F0E7E4] pt-5"}>
          <span className={`font-semibold text-[#282323] ${compactOnMobile ? "text-sm sm:text-lg" : "text-lg"}`}>
            {inStock
              ? `From ${formatPrice(product.min_price)}`
              : "Currently unavailable"}
          </span>

          <span
            className={`font-medium ${compactOnMobile ? "text-xs sm:text-sm" : "text-sm"} ${
              inStock ? "text-[#B76473]" : "text-[#A29A97]"
            }`}
          >
            {inStock ? product.inventory_mode === "made_to_order" ? "Made to order" : "Available" : "Unavailable"}
          </span>
        </div>
      </div>
      {compactOnMobile && <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="absolute right-3 bottom-3 h-4 w-4 text-[#B76473] sm:hidden">
        <path d="m9 5 7 7-7 7" />
      </svg>}
    </a>
  );
}
