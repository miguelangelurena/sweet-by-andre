/** Locale-aware natural ordering for size labels (4", 6", 10"; 2 pieces, 12 pieces). */
export const compareOptionLabels = (a, b) => String(a).localeCompare(String(b), "en", { numeric: true, sensitivity: "base" });
