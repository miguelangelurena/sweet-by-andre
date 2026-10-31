import quesillo from "../../assets/home/flan-closeup.jpg";

export default function OurStory() {
  return (
    <section id="about" aria-labelledby="story-title" lang="en" className="scroll-mt-8 border-t border-[#EADBD4] bg-[#FFFDFA] px-6 py-20 sm:py-28">
      <div className="mx-auto max-w-[1180px]">
        <div className="mx-auto max-w-2xl text-center">
          <p className="brand-eyebrow">Our story <span aria-hidden="true">♡</span></p>
          <h2 id="story-title" className="mt-5 font-serif text-4xl leading-tight tracking-tight text-[#49332F] sm:text-5xl">A little piece of Venezuela,<span className="block italic text-[#BB6C76]">made with love.</span></h2>
        </div>
        <div className="mt-14 grid items-start gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:gap-20">
          <div>
            <figure className="mx-auto max-w-lg">
              <img src={quesillo} alt="A close-up of Sweet by Andre’s caramel quesillo" loading="lazy" className="brand-photo aspect-[4/5] w-full rounded-t-[40%] rounded-b-3xl object-cover" />
              <figcaption className="mt-5 text-center text-xs tracking-wide text-[#786962]">Venezuelan roots. Sweet memories. Made in Katy, Texas.</figcaption>
            </figure>
            <blockquote className="mx-auto mt-9 max-w-md text-center font-serif text-2xl leading-relaxed italic text-[#9F5362]">“Every dessert tells a story, and mine always begins with my roots.”</blockquote>
            <div aria-hidden="true" className="mt-5 text-center text-2xl text-[#BB6C76]">♡</div>
          </div>
          <div className="max-w-2xl text-base leading-8 text-[#786962]">
            <div className="space-y-5">
              <p className="font-serif text-2xl leading-relaxed text-[#49332F]">Behind Sweet by Andre is more than a love of baking. There is a story of love, tradition, and memories that began in the most special place: my grandmother’s kitchen.</p>
              <p>She taught me the authentic flavors of Venezuela, the kind that can take you home with a single bite. Through her, I learned that baking is about more than mixing ingredients. It is about creating moments, sharing love, and keeping our roots alive.</p>
              <p>Inspired by her, I created Sweet by Andre, a small business born from the heart. Every dessert carries a little piece of my story and the traditions that made me fall in love with baking.</p>
              <p>Today, from Katy, Texas, my dream is to share the flavors of my childhood, bringing the heart of Venezuelan baking to new creations, always caring for every detail and putting love into everything I make.</p>
              <p>From traditional Venezuelan quesillo to tres leches, cheesecakes, brownies, and other sweet creations, every dessert is made to bring a little happiness to your table.</p>
              <p>Because to me, every dessert tells a story, and mine always begins with my roots.</p>
              <p>Thank you for supporting this dream and letting me share a little piece of my roots with you.</p>
            </div>
            <div className="mt-8 border-t border-[#EADBD4] pt-6">
              <p className="font-serif text-3xl italic text-[#9F5362]">With love, Andrea <span aria-hidden="true">♡</span></p>
              <p className="mt-3 text-sm">Rooted in tradition, baked with love.</p>
              <a href="#contact" className="mt-6 inline-block text-sm font-semibold text-[#9F5362] underline decoration-[#BB6C76]/40 underline-offset-4">Let’s make something sweet together <span aria-hidden="true">→</span></a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
