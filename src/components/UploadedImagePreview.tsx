"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useId, useState } from "react";
import { resolvePageSettings, type PageSizePreset } from "@/lib/book/constants";
import { getPrintGuides } from "@/lib/book/print-guides";
import { getImageFrameColorOption } from "@/lib/book/image-frame";
import {
  getUploadedPageSequence, getImagePlacement, getImageFrameBounds,
  getPageNumberCenter, PAGE_NUMBER_RADIUS,
} from "@/lib/book/uploaded-image-layout";
import type { RenderUploadedImagePagesOptions } from "@/lib/book/render-uploaded-image-pages";

type PreviewOptions = Omit<RenderUploadedImagePagesOptions, "backgroundImageAssets" | "contentImageAssets" | "pageNumberFill"> & {
  pageNumberColor: string;
};
interface Props {
  contentFiles: File[];
  backgroundFiles: File[];
  pageSize: PageSizePreset;
  options: PreviewOptions;
}
type FilePreview = { file: File; url: string };

function useFileUrls(files: File[]) {
  const [previews, setPreviews] = useState<FilePreview[]>([]);
  useEffect(() => {
    const next = files.map((file) => ({ file, url: URL.createObjectURL(file) }));
    setPreviews(next);
    return () => next.forEach(({ url }) => URL.revokeObjectURL(url));
  }, [files]);
  // Never show the previous file after a removal or reorder while the effect catches up.
  return files.map((file) => previews.find((preview) => preview.file === file));
}

function useImageSize(url?: string) {
  const [result, setResult] = useState<{ url: string; width: number; height: number; error?: boolean }>();
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    const image = new window.Image();
    image.onload = () => {
      if (!cancelled) setResult({ url, width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      if (!cancelled) setResult({ url, width: 0, height: 0, error: true });
    };
    image.src = url;
    return () => { cancelled = true; };
  }, [url]);
  return result?.url === url ? result : undefined;
}

export function UploadedImagePreview({ contentFiles, backgroundFiles, pageSize, options }: Props) {
  const [selectedPage, setSelectedPage] = useState(1);
  const [view, setView] = useState<"page" | "spread">("page");
  const [showGuides, setShowGuides] = useState(true);
  const [zoom, setZoom] = useState(1);
  const content = useFileUrls(contentFiles);
  const backgrounds = useFileUrls(backgroundFiles);
  const { width, height } = resolvePageSettings(pageSize);
  const totalPages = Math.max(1, Math.min(200, Math.floor(Number.isFinite(options.totalPages) ? options.totalPages! : 59)));
  const page = Math.min(selectedPage, totalPages);
  const sequence = getUploadedPageSequence(
    totalPages, contentFiles.length, backgroundFiles.length, options.sequentialBackgroundImages ?? false,
    options.fineTuneBackgrounds ? options.backgroundlessContentImageIndexes ?? [] : [],
  );
  const spreadStart = page % 2 === 0 ? page : page - 1;
  const visiblePages = view === "spread" ? [spreadStart, spreadStart + 1] : [page];
  const guides = getPrintGuides(width, height, page, totalPages);
  const buttonClass = "rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 hover:border-zinc-500 disabled:opacity-40";

  function navigate(direction: -1 | 1) {
    setSelectedPage(Math.max(1, Math.min(totalPages, view === "spread" ? spreadStart + direction * 2 : page + direction)));
  }

  return (
    <aside aria-label="Live book preview" className="min-w-0 self-start rounded-2xl border border-zinc-200 bg-white shadow-sm lg:sticky lg:top-4">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-200 p-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-700">Live preview</p>
          <h3 className="mt-1 text-lg font-semibold text-zinc-900">Your book, before export</h3>
          <p className="mt-1 text-xs text-zinc-500">Images, backgrounds and layout update as you edit.</p>
        </div>
        <div className="flex gap-1 rounded-xl bg-zinc-100 p-1" aria-label="Preview view">
          {(["page", "spread"] as const).map((value) => (
            <button key={value} type="button" aria-pressed={view === value} onClick={() => { setView(value); setZoom(1); }}
              className={`rounded-lg px-3 py-2 text-xs font-semibold ${view === value ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500"}`}>
              {value === "page" ? "Single page" : "Book spread"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
        <label className="flex items-center gap-2 text-sm font-medium text-zinc-700">
          <input type="checkbox" checked={showGuides} onChange={(event) => setShowGuides(event.target.checked)} className="h-4 w-4 accent-emerald-700" />
          KDP margin guides
        </label>
        <label className="flex items-center gap-2 text-xs text-zinc-600">
          Zoom
          <select aria-label="Preview zoom" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} className="rounded-lg border border-zinc-300 bg-white p-2">
            <option value={1}>Fit</option><option value={1.5}>150%</option><option value={2}>200%</option>
          </select>
        </label>
      </div>

      {contentFiles.length ? (
        <>
          <div className="max-h-[65vh] overflow-auto border-y border-zinc-200 bg-stone-100 p-4 sm:p-6" data-testid="book-preview-canvas">
            <div className="mx-auto" style={{ width: `${zoom * 100}%`, maxWidth: zoom === 1 ? (view === "page" ? 520 : 960) : undefined }}>
              <div className={`grid items-start ${view === "spread" ? "grid-cols-2" : "grid-cols-1"}`}>
                {visiblePages.map((pageNumber) => {
                  if (pageNumber < 1 || pageNumber > totalPages) {
                    return <div key={pageNumber} style={{ aspectRatio: `${width} / ${height}` }} className="flex items-center justify-center border border-dashed border-stone-300 bg-stone-200/50 p-4 text-center text-xs text-stone-500">Outside the manuscript</div>;
                  }
                  const entry = sequence[pageNumber - 1];
                  return <PreviewPage key={pageNumber} pageNumber={pageNumber} totalPages={totalPages} width={width} height={height}
                    content={content[entry.contentIndex]} background={entry.backgroundIndex === null ? undefined : backgrounds[entry.backgroundIndex]}
                    isBackgroundless={entry.isBackgroundless} options={options} showGuides={showGuides} />;
                })}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
            <button type="button" className={buttonClass} disabled={view === "spread" ? spreadStart === 0 : page === 1} onClick={() => navigate(-1)} aria-label="Previous preview page">← Previous</button>
            <label className="flex items-center gap-2 text-xs text-zinc-600">
              Page
              <select aria-label="Preview page" value={page} onChange={(event) => setSelectedPage(Number(event.target.value))} className="rounded-lg border border-zinc-300 bg-white p-2">
                {sequence.map((_, index) => <option key={index} value={index + 1}>{index + 1}</option>)}
              </select>
              of {totalPages}
            </label>
            <button type="button" className={buttonClass} disabled={view === "spread" ? spreadStart + 1 >= totalPages : page === totalPages} onClick={() => navigate(1)} aria-label="Next preview page">Next →</button>
          </div>
          <div className="flex gap-2 overflow-x-auto border-t border-zinc-100 px-5 py-3" aria-label="Page thumbnails">
            {sequence.map((entry, index) => (
              <button key={index} type="button" aria-label={`Preview page ${index + 1}`} aria-pressed={page === index + 1} onClick={() => setSelectedPage(index + 1)}
                className={`w-14 shrink-0 rounded-lg border p-1 text-xs ${page === index + 1 ? "border-emerald-700 bg-emerald-50 text-emerald-800" : "border-zinc-200 text-zinc-500"}`}>
                {content[entry.contentIndex] && <img src={content[entry.contentIndex]!.url} alt="" loading="lazy" className="h-12 w-full rounded object-contain" />}
                <span>{index + 1}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="m-5 flex min-h-72 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-zinc-300 bg-stone-50 p-8 text-center">
          <div className="flex h-16 w-12 items-center justify-center rounded border-2 border-dashed border-emerald-600 text-2xl text-emerald-700">+</div>
          <p className="font-semibold text-zinc-800">Add content images to preview your book</p>
          <p className="max-w-xs text-sm text-zinc-500">Your page will appear here with its background, frame and text-safe area.</p>
        </div>
      )}

      <div className="space-y-3 rounded-b-2xl border-t border-zinc-200 bg-zinc-50 p-5 text-xs text-zinc-600">
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <span className="flex items-center gap-2"><span className="w-5 border-t-2 border-dashed border-emerald-600" />Text-safe boundary</span>
          <span className="flex items-center gap-2"><span className="w-5 border-t-2 border-amber-500" />Trim line</span>
          <span className="flex items-center gap-2"><span className="h-3 w-4 bg-rose-200" />Bleed / cut off</span>
        </div>
        <p>Keep all text inside the green dashed frame. Background artwork can extend beyond it. Check text inside images visually; it is not detected automatically.</p>
        <dl className="grid grid-cols-2 gap-2 text-zinc-700">
          <div><dt className="text-zinc-500">PDF page (with bleed)</dt><dd>{inches(width)} × {inches(height)} in</dd></div>
          <div><dt className="text-zinc-500">Trim after cutting</dt><dd>{inches(guides.trim.width)} × {inches(guides.trim.height)} in</dd></div>
          <div><dt className="text-zinc-500">Inside / gutter</dt><dd>{inches(guides.gutter)} in · {totalPages} pages</dd></div>
          <div><dt className="text-zinc-500">Top, bottom, outside</dt><dd>{inches(guides.outside)} in from PDF edge</dd></div>
        </dl>
        <p>Guides assume 0.125 in bleed on the top, bottom and outside edge, with page 1 on the right. Guides appear only in this preview. <a href="https://kdp.amazon.com/en_US/help/topic/GVBQ3CMEQW3W2VL6" target="_blank" rel="noreferrer" className="font-medium text-emerald-800 underline">KDP margin reference ↗</a></p>
      </div>
    </aside>
  );
}

function inches(points: number) {
  return Number((points / 72).toFixed(3)).toString();
}

function PreviewPage({ pageNumber, totalPages, width, height, content, background, isBackgroundless, options, showGuides }: {
  pageNumber: number; totalPages: number; width: number; height: number;
  content?: FilePreview; background?: FilePreview; isBackgroundless: boolean;
  options: PreviewOptions; showGuides: boolean;
}) {
  const clipId = useId();
  const size = useImageSize(content?.url);
  const backgroundSize = useImageSize(background?.url);
  const guides = getPrintGuides(width, height, pageNumber, totalPages);
  const thickness = options.imageFrameEnabled ? Math.min(Math.max(0, options.imageFrameThickness ?? 0), width / 2, height / 2) : 0;
  const fit = isBackgroundless && options.cropBackgroundlessContentImages ? "cover" : options.stretchContentImages || isBackgroundless ? "stretch" : "contain";
  const bounds = size && !size.error ? getImagePlacement(size, width, height, Math.max(0, options.contentPadding ?? 0.32 * 72) + thickness, fit) : null;
  const frame = bounds ? getImageFrameBounds(fit === "cover" ? { x: 0, y: 0, width, height } : bounds, width, height, thickness) : null;
  const numberCenter = getPageNumberCenter(width, pageNumber, options.pageNumberPosition ?? "alternating");
  const outsideSafe = bounds && (bounds.x < guides.safe.x - 0.01 || bounds.y < guides.safe.y - 0.01 || bounds.x + bounds.width > guides.safe.x + guides.safe.width + 0.01 || bounds.y + bounds.height > guides.safe.y + guides.safe.height + 0.01);

  return (
    <figure className="min-w-0" aria-label={`Page ${pageNumber} preview`}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Page ${pageNumber}, ${guides.isLeftPage ? "left" : "right"} page${showGuides ? ", with KDP margin guides" : ""}`} className="block w-full bg-white shadow-md">
        <defs><clipPath id={clipId}><rect width={width} height={height} /></clipPath></defs>
        <g clipPath={`url(#${clipId})`}>
          <rect width={width} height={height} fill="white" />
          {background && <image href={background.url} width={width} height={height} preserveAspectRatio="none" />}
          {content && bounds && <image href={content.url} {...bounds} preserveAspectRatio="none" />}
          {frame && thickness > 0 && <rect x={frame.x} y={frame.y} width={frame.width} height={frame.height}
            rx={options.imageFrameRoundedCorners ? frame.radius : 0} fill="none" stroke={getImageFrameColorOption(options.imageFrameColor).hex}
            strokeWidth={thickness} strokeDasharray={options.imageFrameStyle === "dotted" ? `0 ${thickness * 2.5}` : options.imageFrameStyle === "dashed" ? `${thickness * 3} ${thickness * 2}` : undefined}
            strokeLinecap={options.imageFrameStyle === "dotted" ? "round" : "butt"} />}
          {options.showPageNumbers && pageNumber > 1 && pageNumber < totalPages && <g>
            <circle cx={numberCenter.x} cy={height - numberCenter.y} r={PAGE_NUMBER_RADIUS} fill={options.pageNumberColor} />
            <text x={numberCenter.x} y={height - numberCenter.y} textAnchor="middle" dominantBaseline="central" fill="white" fontFamily="Helvetica, Arial, sans-serif" fontSize={pageNumber >= 100 ? 11 : 13} fontWeight="bold">{pageNumber}</text>
          </g>}
          {showGuides && <g pointerEvents="none" data-testid="kdp-guides">
            <path d={`M0 0H${width}V${height}H0Z M${guides.trim.x} ${guides.trim.y}h${guides.trim.width}v${guides.trim.height}h-${guides.trim.width}Z`} fill="#e11d48" fillOpacity={0.22} fillRule="evenodd" />
            <path d={`M${guides.trim.x} ${guides.trim.y}h${guides.trim.width}v${guides.trim.height}h-${guides.trim.width}Z M${guides.safe.x} ${guides.safe.y}h${guides.safe.width}v${guides.safe.height}h-${guides.safe.width}Z`} fill="#f59e0b" fillOpacity={0.09} fillRule="evenodd" />
            <rect {...guides.trim} fill="none" stroke="#f59e0b" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
            <rect {...guides.safe} fill="none" stroke="white" strokeWidth={3.5} vectorEffect="non-scaling-stroke" />
            <rect {...guides.safe} fill="none" stroke="#047857" strokeWidth={1.8} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
            <line x1={guides.isLeftPage ? width : 0} x2={guides.isLeftPage ? width : 0} y1={0} y2={height} stroke="#44403c" strokeWidth={4} vectorEffect="non-scaling-stroke" />
          </g>}
          {!bounds && <text x={width / 2} y={height / 2} textAnchor="middle" fill="#52525b" fontSize={18}>{size?.error ? "Image could not be previewed" : "Loading image…"}</text>}
        </g>
      </svg>
      <figcaption className="space-y-1 px-2 py-3 text-center text-[11px] text-zinc-600">
        <p className="font-semibold text-zinc-800">Page {pageNumber} · {guides.isLeftPage ? "Left · gutter on right" : "Right · gutter on left"}</p>
        <p className="truncate" title={content?.file.name}>{content?.file.name}</p>
        {backgroundSize?.error && <p className="text-red-700">Background could not be previewed.</p>}
        {showGuides && bounds && <p className={outsideSafe ? "text-amber-800" : "text-emerald-800"}>{outsideSafe ? "Image crosses the text-safe boundary. Check its text." : "Image fits inside the text-safe boundary."}</p>}
      </figcaption>
    </figure>
  );
}
