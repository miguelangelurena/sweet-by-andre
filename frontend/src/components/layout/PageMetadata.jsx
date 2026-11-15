import { useEffect } from "react";

// Public document metadata comes from Express before JavaScript runs. Hash
// views are private; never let their title/content inherit indexable metadata.
export default function usePageMetadata(hash, pathname) {
  useEffect(() => {
    const privateView =
      /^#(?:admin(?:\/|$)|cart$|checkout$)/.test(hash) ||
      /^\/(?:admin|cart|checkout|payment-success|payment-cancelled)(?:\/|$)/.test(
        pathname,
      );
    if (!privateView) return;
    const originalTitle = document.title;
    const originalRobots = document
      .querySelector('meta[name="robots"]')
      ?.cloneNode(true);
    const originalTags = [
      ...document.querySelectorAll(
        'link[rel="canonical"], script[type="application/ld+json"], meta[property^="og:"], meta[name^="twitter:"]',
      ),
    ].map((element) => element.cloneNode(true));
    document.title =
      hash.startsWith("#admin") || pathname.startsWith("/admin")
        ? "Administration | Sweet by Andre"
        : "Your Order | Sweet by Andre";
    let robots = document.querySelector('meta[name="robots"]');
    if (!robots) {
      robots = document.createElement("meta");
      robots.name = "robots";
      document.head.append(robots);
    }
    robots.content = "noindex, nofollow";
    document
      .querySelectorAll(
        'link[rel="canonical"], script[type="application/ld+json"], meta[property^="og:"], meta[name^="twitter:"]',
      )
      .forEach((element) => element.remove());
    return () => {
      document.title = originalTitle;
      document.querySelector('meta[name="robots"]')?.remove();
      if (originalRobots) document.head.append(originalRobots);
      document.head.append(...originalTags);
    };
  }, [hash, pathname]);
}
