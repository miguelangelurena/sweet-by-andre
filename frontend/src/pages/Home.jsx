import miniCheesecakes from "../assets/home/mini-cheesecakes-strawberry.jpg";
import flanWhole from "../assets/home/flan-whole.png";
import miniFlans from "../assets/home/mini-flans.jpg";
import creamDessert from "../assets/home/cream-dessert.jpg";

const categories = [
  {
    title: "Cheesecakes",
    description: "Little bites of sweetness.",
    image: miniCheesecakes,
  },
  {
    title: "Flans",
    description: "Smooth, creamy & delicious.",
    image: miniFlans,
  },
  {
    title: "Sweet Creations",
    description: "Handcrafted for special moments.",
    image: creamDessert,
  },
];

export default function Home() {
  return (
    <main className="bg-[#FAF7F5]">
      {/* Hero */}
      <section
        id="home"
        className="mx-auto grid max-w-7xl items-center gap-12 px-6 py-16 md:py-24 lg:grid-cols-2"
      >
        <div className="max-w-xl">
          <span className="text-xs font-semibold uppercase tracking-[0.35em] text-[#B76473]">
            Handcrafted with love
          </span>

          <h1 className="mt-6 font-serif text-5xl leading-[1.12] text-[#282323] sm:text-6xl lg:text-7xl">
            A little sweetness
            <span className="block italic text-[#B76473]">in every bite.</span>
          </h1>

          <p className="mt-7 max-w-md text-base leading-8 text-[#796D6A]">
            Discover thoughtfully handcrafted desserts, made to turn ordinary
            moments into unforgettable memories.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-4">
            <a
              href="#menu"
              className="rounded-full bg-[#B76473] px-8 py-4 text-sm font-semibold text-white transition hover:bg-[#9E4F60]"
            >
              Explore Our Menu
            </a>

            <a
              href="#about"
              className="border-b border-[#B76473] pb-1 text-sm font-medium text-[#282323] transition hover:text-[#B76473]"
            >
              Our Story →
            </a>
          </div>
        </div>
        <div className="relative">
          <div className="absolute -left-5 -top-5 h-28 w-28 rounded-full border border-[#E7DCD9]" />

          <div className="relative flex aspect-[4/5] items-center justify-center overflow-hidden rounded-t-full rounded-b-[2rem] bg-gradient-to-br from-[#EEDDDC] via-[#F4E8E5] to-[#D9BDBA]">
            <div className="px-8 text-center">
              <div className="font-serif text-7xl text-[#B76473]/50">✧</div>
              <p className="mt-5 font-serif text-2xl italic text-[#8F6470]">
                Made with love
              </p>
              <div className="relative overflow-hidden rounded-t-full rounded-b-[2rem]">
                <img
                  src={flanWhole}
                  alt="Flan artesanal de Sweet by Andre"
                  className="h-full w-full object-cover"
                />
              </div>
            </div>
          </div>

          <div className="absolute -bottom-6 -left-4 rounded-2xl border border-[#E7DCD9] bg-white/95 px-6 py-5 shadow-sm sm:-left-8">
            <p className="font-serif text-xl italic text-[#282323]">
              Sweet moments
            </p>
            <p className="mt-1 text-xs tracking-wide text-[#796D6A]">
              Crafted with care
            </p>
          </div>
        </div>
      </section>

      {/* Categorías */}
      <section id="menu" className="px-6 py-24">
        <div className="mx-auto max-w-7xl">
          <div className="text-center">
            <span className="text-xs font-semibold uppercase tracking-[0.3em] text-[#B76473]">
              Discover our creations
            </span>

            <h2 className="mt-4 font-serif text-4xl text-[#282323] md:text-5xl">
              Made to satisfy your cravings
            </h2>

            <p className="mx-auto mt-4 max-w-lg leading-7 text-[#796D6A]">
              Something special for every celebration, gathering, or sweet
              little moment.
            </p>
          </div>

          <div className="mt-14 grid gap-6 md:grid-cols-3">
            {categories.map((category) => (
              <article
                key={category.title}
                className="group overflow-hidden rounded-2xl border border-[#E7DCD9] bg-white"
              >
                <div className="aspect-[4/3] overflow-hidden bg-[#F1E5E2]">
                  <img
                    src={category.image}
                    alt={category.title}
                    loading="lazy"
                    className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                  />
                </div>

                <div className="p-7 text-center">
                  <h3 className="font-serif text-2xl text-[#282323]">
                    {category.title}
                  </h3>

                  <p className="mt-2 text-sm text-[#796D6A]">
                    {category.description}
                  </p>

                  <a
                    href="#menu"
                    className="mt-5 inline-block text-sm font-semibold text-[#B76473]"
                  >
                    Explore Collection →
                  </a>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Presentación */}
      <section id="about" className="bg-[#F1E5E2] px-6 py-20 text-center">
        <div className="mx-auto max-w-2xl">
          <span className="text-xs uppercase tracking-[0.3em] text-[#B76473]">
            The Sweet by Andre experience
          </span>

          <h2 className="mt-5 font-serif text-4xl text-[#282323]">
            Baked with passion, shared with love.
          </h2>

          <p className="mt-6 leading-8 text-[#796D6A]">
            Thoughtfully made desserts for life's sweetest moments.
          </p>
        </div>
      </section>
    </main>
  );
}
