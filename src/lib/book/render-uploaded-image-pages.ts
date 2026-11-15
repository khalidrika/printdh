import { LineCapStyle, PDFFont, PDFDocument, PDFImage, PDFPage, rgb, StandardFonts } from "pdf-lib";
import { savePdfWithGenericMetadata } from "../pdf-metadata";
import { PAGE_HEIGHT, PAGE_WIDTH, POINTS_PER_INCH, TOTAL_PAGES } from "./constants";
import type { ImageAsset } from "./types";
import { hexToRgb } from "./colors";
import {
  DEFAULT_IMAGE_FRAME_COLOR,
  DEFAULT_IMAGE_FRAME_STYLE,
  getImageFrameColorOption,
  type ImageFrameColor,
  type ImageFrameStyle,
} from "./image-frame";

import {
  getUploadedPageSequence,
  getImagePlacement,
  getImageFrameBounds,
  getPageNumberCenter,
  PAGE_NUMBER_RADIUS,
  type ImageBounds,
} from "./uploaded-image-layout";

const DEFAULT_CONTENT_PADDING = 0.32 * POINTS_PER_INCH;
const PAGE_NUMBER_TEXT_COLOR = rgb(1, 1, 1);
type PageNumberPosition = "alternating" | "center";

export interface RenderUploadedImagePagesOptions {
  backgroundImageAssets?: ImageAsset[];
  contentImageAssets?: ImageAsset[];
  pageWidth?: number;
  pageHeight?: number;
  totalPages?: number;
  contentPadding?: number;
  sequentialBackgroundImages?: boolean;
  fineTuneBackgrounds?: boolean;
  backgroundlessContentImageIndexes?: number[];
  stretchContentImages?: boolean;
  cropBackgroundlessContentImages?: boolean;
  imageFrameEnabled?: boolean;
  imageFrameThickness?: number;
  imageFrameStyle?: ImageFrameStyle;
  imageFrameColor?: ImageFrameColor;
  imageFrameRoundedCorners?: boolean;
  showPageNumbers?: boolean;
  pageNumberPosition?: PageNumberPosition;
  pageNumberFill?: ReturnType<typeof rgb>;
}

export async function renderUploadedImagePages(options: RenderUploadedImagePagesOptions): Promise<Uint8Array> {
  const {
    backgroundImageAssets = [],
    contentImageAssets = [],
    pageWidth = PAGE_WIDTH,
    pageHeight = PAGE_HEIGHT,
    totalPages = TOTAL_PAGES,
    contentPadding = DEFAULT_CONTENT_PADDING,
    sequentialBackgroundImages = false,
    fineTuneBackgrounds = false,
    backgroundlessContentImageIndexes = [],
    stretchContentImages = false,
    cropBackgroundlessContentImages = false,
    imageFrameEnabled = false,
    imageFrameThickness = 0,
    imageFrameStyle = DEFAULT_IMAGE_FRAME_STYLE,
    imageFrameColor = DEFAULT_IMAGE_FRAME_COLOR,
    imageFrameRoundedCorners = false,
    showPageNumbers = false,
    pageNumberPosition = "alternating",
    pageNumberFill = rgb(0, 0, 0),
  } = options;

  if (!contentImageAssets.length) {
    throw new Error("Upload at least one content image.");
  }

  const pageCount = Math.max(1, Math.floor(totalPages));
  const pdf = await PDFDocument.create();
  const backgroundImages = await embedImages(pdf, backgroundImageAssets);
  const contentImages = await embedImages(pdf, contentImageAssets);
  const resolvedContentPadding = Math.max(0, contentPadding);
  const resolvedImageFrameThickness = imageFrameEnabled
    ? Math.min(Math.max(0, imageFrameThickness), pageWidth / 2, pageHeight / 2)
    : 0;
  const frameColor = hexToRgb(getImageFrameColorOption(imageFrameColor).hex);
  const pageNumberFont = showPageNumbers ? await pdf.embedFont(StandardFonts.HelveticaBold) : null;
  const sequence = getUploadedPageSequence(
    pageCount, contentImages.length, backgroundImages.length, sequentialBackgroundImages,
    fineTuneBackgrounds ? backgroundlessContentImageIndexes : [],
  );

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
    const page = pdf.addPage([pageWidth, pageHeight]);
    const { contentIndex, isBackgroundless: isBackgroundlessContent, backgroundIndex } = sequence[pageIndex];
    if (backgroundIndex !== null) {
      drawStretchedImage(page, backgroundImages[backgroundIndex], pageWidth, pageHeight);
    } else {
      drawWhiteBackground(page, pageWidth, pageHeight);
    }

    let contentBounds: ImageBounds;
    if (isBackgroundlessContent && cropBackgroundlessContentImages) {
      contentBounds = drawCroppedImage(
        page,
        contentImages[contentIndex],
        contentImageAssets[contentIndex],
        pageWidth,
        pageHeight
      );
    } else if (stretchContentImages || isBackgroundlessContent) {
      contentBounds = drawStretchedImage(page, contentImages[contentIndex], pageWidth, pageHeight);
    } else {
      contentBounds = drawContainedImage(
        page,
        contentImages[contentIndex],
        contentImageAssets[contentIndex],
        pageWidth,
        pageHeight,
        resolvedContentPadding + resolvedImageFrameThickness
      );
    }

    if (resolvedImageFrameThickness > 0) {
      drawImageFrame(
        page,
        contentBounds,
        pageWidth,
        pageHeight,
        resolvedImageFrameThickness,
        imageFrameStyle,
        frameColor,
        imageFrameRoundedCorners
      );
    }

    if (pageNumberFont && pageIndex > 0 && pageIndex < pageCount - 1) {
      drawPageNumber(page, pageIndex + 1, pageNumberFont, pageNumberFill, pageWidth, pageNumberPosition);
    }
  }

  return savePdfWithGenericMetadata(pdf);
}

function drawWhiteBackground(page: PDFPage, pageWidth: number, pageHeight: number) {
  page.drawRectangle({
    x: 0,
    y: 0,
    width: pageWidth,
    height: pageHeight,
    color: rgb(1, 1, 1),
  });
}

async function embedImages(pdf: PDFDocument, assets: ImageAsset[]) {
  const images: PDFImage[] = [];
  for (const asset of assets) {
    const image = asset.mimeType === "image/png" ? await pdf.embedPng(asset.bytes) : await pdf.embedJpg(asset.bytes);
    images.push(image);
  }
  return images;
}

function drawStretchedImage(page: PDFPage, image: PDFImage, pageWidth: number, pageHeight: number): ImageBounds {
  page.drawImage(image, {
    x: 0,
    y: 0,
    width: pageWidth,
    height: pageHeight,
  });
  return { x: 0, y: 0, width: pageWidth, height: pageHeight };
}

function drawCroppedImage(
  page: PDFPage,
  image: PDFImage,
  assetMeta: { width: number; height: number },
  pageWidth: number,
  pageHeight: number
): ImageBounds {
  const { x, y, width, height } = getImagePlacement(assetMeta, pageWidth, pageHeight, 0, "cover");
  page.drawImage(image, { x, y, width, height });
  return { x: 0, y: 0, width: pageWidth, height: pageHeight };
}

function drawContainedImage(
  page: PDFPage,
  image: PDFImage,
  assetMeta: { width: number; height: number },
  pageWidth: number,
  pageHeight: number,
  padding: number
): ImageBounds {
  const { x, y, width, height } = getImagePlacement(assetMeta, pageWidth, pageHeight, padding, "contain");

  page.drawImage(image, { x, y, width, height });
  return { x, y, width, height };
}

function drawImageFrame(
  page: PDFPage,
  bounds: ImageBounds,
  pageWidth: number,
  pageHeight: number,
  thickness: number,
  style: ImageFrameStyle,
  color: ReturnType<typeof rgb>,
  roundedCorners: boolean
) {
  const { x, y, width, height, top, radius } = getImageFrameBounds(bounds, pageWidth, pageHeight, thickness);
  const borderOptions = {
    borderColor: color,
    borderWidth: thickness,
    // Zero-length dashes with round caps produce circular dots at any thickness.
    borderDashArray: style === "dotted" ? [0, thickness * 2.5] : style === "dashed" ? [thickness * 3, thickness * 2] : [],
    borderLineCap: style === "dotted" ? LineCapStyle.Round : LineCapStyle.Butt,
  };

  if (roundedCorners && width > 0 && height > 0) {
    // Keep straight sides even on narrow images, and scale the corners for thick frames.
    const path = [
      `M ${radius} 0`,
      `H ${width - radius}`,
      `A ${radius} ${radius} 0 0 1 ${width} ${radius}`,
      `V ${height - radius}`,
      `A ${radius} ${radius} 0 0 1 ${width - radius} ${height}`,
      `H ${radius}`,
      `A ${radius} ${radius} 0 0 1 0 ${height - radius}`,
      `V ${radius}`,
      `A ${radius} ${radius} 0 0 1 ${radius} 0`,
      "Z",
    ].join(" ");
    // SVG coordinates run down from the top edge; PDF coordinates run up from the bottom.
    page.drawSvgPath(path, { x, y: top, ...borderOptions });
  } else {
    page.drawRectangle({ x, y, width, height, ...borderOptions });
  }
}

function drawPageNumber(
  page: PDFPage,
  pageNumber: number,
  font: PDFFont,
  fill: ReturnType<typeof rgb>,
  pageWidth: number,
  position: PageNumberPosition
) {
  const { x: centerX, y: centerY } = getPageNumberCenter(pageWidth, pageNumber, position);
  page.drawCircle({
    x: centerX,
    y: centerY,
    size: PAGE_NUMBER_RADIUS,
    color: fill,
  });

  const text = String(pageNumber);
  const fontSize = pageNumber >= 100 ? 11 : 13;
  const textWidth = font.widthOfTextAtSize(text, fontSize);
  const textHeight = font.heightAtSize(fontSize, { descender: false });
  page.drawText(text, {
    x: centerX - textWidth / 2,
    y: centerY - textHeight / 2,
    size: fontSize,
    font,
    color: PAGE_NUMBER_TEXT_COLOR,
  });
}
