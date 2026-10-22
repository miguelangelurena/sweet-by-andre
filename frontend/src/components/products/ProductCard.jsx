const formatPrice = (price) => {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(price));
};

export default function ProductCard({ product }) {
  const inStock = product.stock > 0;

  return (
    <article className="group overflow-hidden rounded-2xl border border-[#E7DCD9] bg-white transition-shadow duration-300 hover:shadow-lg">
      <div className="aspect-[4/3] overflow-hidden bg-[#F1E5E2]">
        {product.image_url ? (
          <img
            src={product.image_url}
            alt={product.name}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="font-serif text-3xl italic text-[#B76473]/70">
              Sweet by Andre
            </span>
          </div>
        )}
      </div>

      <div className="p-7">
        <p className="text-xs uppercase tracking-[0.2em] text-[#B76473]">
          {product.category_name}
        </p>

        <h2 className="mt-3 font-serif text-2xl text-[#282323]">
          {product.name}
        </h2>

        <p className="mt-3 min-h-12 text-sm leading-6 text-[#796D6A]">
          {product.description}
        </p>

        <div className="mt-6 flex items-center justify-between border-t border-[#F0E7E4] pt-5">
          <span className="text-lg font-semibold text-[#282323]">
            {formatPrice(product.price)}
          </span>

          <span
            className={`text-sm font-medium ${
              inStock ? "text-[#B76473]" : "text-[#A29A97]"
            }`}
          >
            {inStock ? "Available" : "Out of stock"}
          </span>
        </div>
      </div>
    </article>
  );
}
