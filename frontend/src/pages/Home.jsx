import SeasonalCollections from "../components/products/SeasonalCollections";
import OurStory from "../components/home/OurStory";
import heroDessert from "../assets/home/reference-dessert.jpg";
import heroDessertCutout from "../assets/home/hero-dessert-cutout.png";
import miniCheesecakes from "../assets/home/mini-cheesecakes-strawberry.jpg";
import miniFlans from "../assets/home/mini-flans.jpg";
import creamDessert from "../assets/home/cream-dessert.jpg";

// Design previews: "layered", "transparent", or "photo" (original arched photo).
const HERO_STYLE = "layered";
const USE_CUTOUT = HERO_STYLE !== "photo";

const categories = [
  { title: "Cheesecakes", description: "Little bites of sweetness, made to share.", image: miniCheesecakes },
  { title: "Venezuelan Quesillo", description: "A creamy caramel classic. A little taste of home.", image: miniFlans },
  { title: "Sweet Creations", description: "Something special for every sweet moment.", image: creamDessert },
];
const values = [
  { glyph: "♡", title: "Made with love", description: "Thoughtfully handcrafted treats" },
  { glyph: "✦", title: "Venezuelan roots", description: "Inspired by cherished traditions" },
  { glyph: "✧", title: "Sweet moments", description: "For celebrations big and small" },
];

export default function Home() {
  return (
    <main className="storefront">
      <section id="home" aria-labelledby="home-title" className="mx-auto grid max-w-[1228px] items-center gap-10 px-6 pt-10 pb-14 md:pt-14 md:pb-16 lg:grid-cols-[1.08fr_0.92fr] lg:gap-16">
        <div className="max-w-xl">
          <span className="brand-eyebrow">A little sweetness, a little piece of home</span>
          <h1 id="home-title" className="mt-6 font-serif text-5xl leading-[1.12] font-medium tracking-[-0.045em] text-[#49332F] sm:text-6xl lg:text-[79px]">Rooted in tradition.<span className="mt-1 block italic text-[#BB6C76]">Baked with love.</span></h1>
          <p className="mt-7 max-w-lg text-lg leading-8 text-[#786962]">Handcrafted desserts inspired by the flavors and traditions of Venezuela, made to turn every moment into something special.</p>
          <div className="mt-8 flex flex-wrap items-center gap-5">
            <a href="#catalog" className="brand-button w-full sm:w-auto">Explore our menu <span aria-hidden="true">→</span></a>
            <a href="#about" className="border-b border-[#BB6C76]/50 pb-1 text-sm font-medium text-[#49332F] transition hover:text-[#9F5362]">Meet the heart behind the sweets</a>
          </div>
          <p className="mt-6 text-xs leading-6 text-[#786962]">Pickup &amp; delivery in Katy / Houston · Please order 48 hours ahead</p>
        </div>
        <figure className={USE_CUTOUT
          ? "relative isolate mx-auto w-full max-w-[540px]"
          : "brand-photo relative mx-auto w-full max-w-[540px] overflow-hidden rounded-t-[40%] rounded-b-3xl bg-[#EEE0D9]"}>
          {HERO_STYLE === "layered" && (
            <div aria-hidden="true" className="brand-photo absolute inset-x-[9%] top-[12%] bottom-[10%] -z-10 rounded-t-[40%] rounded-b-3xl border border-[#E5CFC6] bg-gradient-to-br from-[#F4E7DF] via-[#EEDBD3] to-[#DFBAB7]">
              <div className="absolute inset-2 rounded-t-[40%] rounded-b-2xl border border-white/60" />
            </div>
          )}
          <img src={USE_CUTOUT ? heroDessertCutout : heroDessert}
            alt="A cream cake topped with strawberries, blueberries and delicate white flowers"
            fetchPriority="high"
            className={USE_CUTOUT
              ? "aspect-[0.85] w-full object-contain p-3 drop-shadow-[0_18px_20px_rgba(107,71,60,0.12)]"
              : "aspect-[0.85] w-full object-cover object-[center_45%]"} />
          <figcaption className={HERO_STYLE === "transparent"
            ? "mt-2 text-center font-serif text-base italic text-[#936B66]"
            : "absolute bottom-5 left-5 rounded-2xl bg-[#FFFAF4]/90 px-5 py-3 font-serif text-base text-[#49332F] backdrop-blur-sm"}>Made with love <span aria-hidden="true">♡</span></figcaption>
        </figure>
      </section>
      <section aria-label="What makes our desserts special" className="mx-auto max-w-[1180px] border-y border-[#EADBD4]">
        <div className="grid divide-y divide-[#EADBD4] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {values.map(({ glyph, title, description }) => (
            <div key={title} className="px-6 py-7 text-center">
              <span aria-hidden="true" className="mb-1 block text-2xl text-[#BB6C76]">{glyph}</span>
              <h2 className="font-serif text-xl text-[#49332F]">{title}</h2>
              <p className="mt-1 text-sm text-[#786962]">{description}</p>
            </div>
          ))}
        </div>
      </section>
      <section id="menu" aria-labelledby="menu-title" className="px-6 py-20 sm:py-24">
        <div className="mx-auto max-w-[1180px]">
          <div className="mx-auto max-w-xl text-center">
            <span className="brand-eyebrow">Something for your sweet tooth</span>
            <h2 id="menu-title" className="mt-5 font-serif text-4xl leading-tight text-[#49332F] sm:text-5xl">Little joys. <span className="italic text-[#BB6C76]">Sweet memories.</span></h2>
            <p className="mt-5 leading-7 text-[#786962]">From a traditional Venezuelan quesillo to cheesecakes and other sweet creations, there’s a little happiness waiting for your table.</p>
          </div>
          <div className="mt-12 grid gap-7 md:grid-cols-3">
            {categories.map((category) => (
              <a key={category.title} href="#catalog" className="group overflow-hidden rounded-t-[3.5rem] rounded-b-3xl border border-[#EADBD4] bg-[#FFFDFA] transition-shadow hover:shadow-lg hover:shadow-[#6B473C]/5">
                <div className="aspect-[4/3] overflow-hidden bg-[#EEE0D9]">
                  <img src={category.image} alt={category.title} loading="lazy" className="h-full w-full object-cover transition duration-500 motion-safe:group-hover:scale-105" />
                </div>
                <div className="p-7 text-center">
                  <h3 className="font-serif text-2xl text-[#49332F]">{category.title}</h3>
                  <p className="mt-3 text-sm leading-6 text-[#786962]">{category.description}</p>
                  <span className="mt-5 inline-block text-sm font-semibold text-[#9F5362]">Explore the menu <span aria-hidden="true">→</span></span>
                </div>
              </a>
            ))}
          </div>
        </div>
      </section>
      <SeasonalCollections compact />
      <OurStory />
    </main>
  );
}
