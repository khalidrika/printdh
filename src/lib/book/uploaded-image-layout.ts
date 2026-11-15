// Shared by the PDF renderer and the live preview. All dimensions are PDF points.
export interface ImageBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function getUploadedPageSequence(
  totalPages: number,
  contentCount: number,
  backgroundCount: number,
  sequential: boolean,
  backgroundlessIndexes: number[],
) {
  const backgroundless = new Set(backgroundlessIndexes);
  let backgroundPageIndex = 0;
  return Array.from({ length: totalPages }, (_, pageIndex) => {
    const contentIndex = pageIndex % Math.max(1, contentCount);
    // Without a background, content fills the page instead of exposing a white inset.
    const isBackgroundless = backgroundCount === 0 || backgroundless.has(contentIndex);
    let backgroundIndex: number | null = null;
    if (!isBackgroundless && backgroundCount > 0) {
      backgroundIndex = sequential
        ? backgroundPageIndex % backgroundCount
        : backgroundPageIndex === 0
          ? 0
          : (Math.floor((backgroundPageIndex - 1) / 2) + 1) % backgroundCount;
      backgroundPageIndex++;
    }
    return { contentIndex, backgroundIndex, isBackgroundless };
  });
}

export function getImagePlacement(
  image: { width: number; height: number },
  pageWidth: number,
  pageHeight: number,
  padding: number,
  fit: "contain" | "cover" | "stretch",
): ImageBounds {
  if (fit === "stretch") return { x: 0, y: 0, width: pageWidth, height: pageHeight };
  const availableWidth = Math.max(1, pageWidth - (fit === "contain" ? padding * 2 : 0));
  const availableHeight = Math.max(1, pageHeight - (fit === "contain" ? padding * 2 : 0));
  const scale = (fit === "cover" ? Math.max : Math.min)(availableWidth / image.width, availableHeight / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  return { x: (pageWidth - width) / 2, y: (pageHeight - height) / 2, width, height };
}

export function getImageFrameBounds(bounds: ImageBounds, pageWidth: number, pageHeight: number, thickness: number) {
  const x = Math.max(thickness / 2, bounds.x - thickness / 2);
  const y = Math.max(thickness / 2, bounds.y - thickness / 2);
  const right = Math.min(pageWidth - thickness / 2, bounds.x + bounds.width + thickness / 2);
  const top = Math.min(pageHeight - thickness / 2, bounds.y + bounds.height + thickness / 2);
  const width = Math.max(0, right - x);
  const height = Math.max(0, top - y);
  const radius = Math.min(Math.max(12, thickness * 2), width / 4, height / 4);
  return { x, y, width, height, top, radius };
}

export const PAGE_NUMBER_PADDING = 0.35 * 72;
export const PAGE_NUMBER_RADIUS = 0.24 * 72;

export function getPageNumberCenter(pageWidth: number, pageNumber: number, position: "alternating" | "center") {
  return {
    x: position === "center"
      ? pageWidth / 2
      : pageNumber % 2 === 0
        ? PAGE_NUMBER_PADDING + PAGE_NUMBER_RADIUS
        : pageWidth - PAGE_NUMBER_PADDING - PAGE_NUMBER_RADIUS,
    y: PAGE_NUMBER_PADDING + PAGE_NUMBER_RADIUS,
  };
}
