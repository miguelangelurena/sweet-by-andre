export function Skeleton({ className = "" }) {
  return <div aria-hidden="true" className={`sba-skeleton rounded-xl ${className}`} />;
}

export function ProductCardSkeleton() {
  return (
    <div aria-hidden="true" className="overflow-hidden rounded-3xl border border-[#E7DCD9] bg-white">
      <Skeleton className="aspect-[4/3] w-full rounded-none" />
      <div className="space-y-3 p-5">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-7 w-3/4" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="mt-5 h-6 w-24" />
      </div>
    </div>
  );
}

export function ProductGridSkeleton({ count = 6, className = "" }) {
  return (
    <div role="status" aria-label="Loading products" aria-busy="true" className={className}>
      <span className="sr-only">Loading products...</span>
      {Array.from({ length: count }, (_, index) => (
        <ProductCardSkeleton key={index} />
      ))}
    </div>
  );
}

export function ProductDetailSkeleton() {
  return (
    <main role="status" aria-label="Loading product details" aria-busy="true" className="min-h-screen bg-[#FAF7F5] px-4 py-10 sm:px-6 lg:py-16">
      <span className="sr-only">Loading product details...</span>
      <div className="mx-auto max-w-7xl">
        <Skeleton className="mb-8 h-5 w-36" />
        <div className="grid gap-12 lg:grid-cols-2">
          <Skeleton className="aspect-square w-full rounded-3xl" />
          <div className="space-y-6 py-3">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-12 w-4/5" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-8 w-28" />
            <Skeleton className="h-12 w-full rounded-full" />
            <Skeleton className="h-12 w-2/3 rounded-full" />
          </div>
        </div>
      </div>
    </main>
  );
}
