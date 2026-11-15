// KDP interior margins, measured from the uploaded PDF page edge:
// https://kdp.amazon.com/en_US/help/topic/GVBQ3CMEQW3W2VL6
// The existing page presets include bleed. Page 1 is on the right (LTR books).
export function getPrintGuides(width: number, height: number, pageNumber: number, totalPages: number) {
  const bleed = 0.125 * 72;
  const outside = 0.375 * 72;
  const gutter = (totalPages <= 150 ? 0.375 : totalPages <= 300 ? 0.5 : totalPages <= 500 ? 0.625 : totalPages <= 700 ? 0.75 : 0.875) * 72;
  const isLeftPage = pageNumber % 2 === 0;
  return {
    bleed,
    gutter,
    outside,
    isLeftPage,
    trim: { x: isLeftPage ? bleed : 0, y: bleed, width: width - bleed, height: height - bleed * 2 },
    safe: { x: isLeftPage ? outside : gutter, y: outside, width: width - outside - gutter, height: height - outside * 2 },
  };
}
