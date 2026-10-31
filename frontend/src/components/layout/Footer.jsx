const contactLink = "underline decoration-[#B76473]/40 underline-offset-4 transition hover:text-[#9E4F60]";

export default function Footer() {
  return (
    <footer id="contact" aria-labelledby="contact-title" className="scroll-mt-8 border-t border-[#EADBD4] bg-[#F5E8E1] px-6 pt-16 pb-7 text-[#49332F]">
      <div className="mx-auto max-w-[1180px]">
        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-[1.2fr_1fr_1fr]">
          <div className="max-w-sm">
            <a href="/#home" className="font-serif text-3xl">Sweet by Andre</a>
            <p className="mt-4 font-serif text-xl italic text-[#9E4F60]">Rooted in tradition, baked with love.</p>
            <p className="mt-4 text-sm leading-7 text-[#796D6A]">A little piece of Venezuela, lovingly made in Katy, Texas.</p>
          </div>
          <div>
            <h2 id="contact-title" className="font-serif text-2xl">Let’s make something sweet.</h2>
            <address className="mt-5 space-y-3 text-sm not-italic">
              <p><a href="mailto:sweetbyandre@gmail.com" className={`${contactLink} break-all`}>sweetbyandre@gmail.com</a></p>
              <p><a href="tel:+17867647895" className={contactLink}>(786) 764-7895</a></p>
              <p className="text-[#796D6A]">Katy, Texas · Serving Katy &amp; Houston</p>
            </address>
            <a href="https://wa.me/17867647895" target="_blank" rel="noopener noreferrer" className="brand-button mt-6">Chat on WhatsApp <span aria-hidden="true">→</span></a>
          </div>
          <div className="max-w-sm">
            <h3 className="font-serif text-2xl">Pickup &amp; delivery</h3>
            <p className="mt-5 text-sm leading-7 text-[#796D6A]">Please order at least 48 hours in advance. Contact us to arrange pickup or confirm delivery availability and the fee for your area.</p>
            <a href="/#catalog" className="mt-5 inline-block text-sm font-semibold text-[#9E4F60] hover:underline">Explore our menu <span aria-hidden="true">→</span></a>
          </div>
        </div>
        <div className="mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-[#DCCBC6] pt-6 text-xs text-[#796D6A]">
          <p>© {new Date().getFullYear()} Sweet by Andre. Made with love.</p>
          <a href="/#about" className="hover:text-[#9E4F60] hover:underline">Our story <span aria-hidden="true">♡</span></a>
        </div>
      </div>
    </footer>
  );
}
