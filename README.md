Use makefile to run:

```bash
make build && make start
```

## Cover Studio

Open `/cover-studio` or use the Cover Studio link on the home page to design a
full paperback cover. Set the finished trim size (without interior bleed), final
page count, paper and reading direction; the editor calculates the full cover and
spine. A manual spine override is available for measurements from KDP's calculator.
Add PNG/JPG/WEBP images, text, rectangles and ellipses. Move, resize, rotate, reorder,
hide or lock layers, and undo changes. Drafts including images are saved in this
browser's IndexedDB. Save/Open project downloads and restores an editable JSON backup.

Drag any of the eight edge/corner handles to resize. Images use Free stretch by
default; choose Keep proportions or Crop frame, or hold Shift for proportional
resizing. Extend each of two cover images to the spine center to close the gap,
or use Cover whole spine on one image. These shortcuts require zero rotation.
Zoom with the mouse wheel over the canvas or the zoom controls (up to 800%).
Use Hand, Space + drag, or the middle mouse button to pan; Fit shows the full
cover and View spine centers a close-up of the spine. View controls do not affect
the exported PDF or add entries to Undo.

PDF exports are a single full-cover page flattened at 300 DPI in RGB, with no
editor guides. Source images may have lower effective resolution; the editor shows
resolution notes and blocks export when a text box clips its text. Text and layers
remain editable in the project, rather than in the flattened PDF. This editor uses
paperback dimensions; hardcover wraps and hinges are not calculated.

Run the cover geometry, resize, viewport and text-layout checks with `npm run test:cover`.

Put your API keys in an `.env` file:

```md
GOOGLE_CSE_KEY=your_google_key
GOOGLE_CSE_CX=your_google_cx
PIXABAY_API_KEY=your_pixabay_key
PEXELS_API_KEY=your_pexels_key
```

## PDF compression

The compressor defaults to **High res 300dpi** in both the UI and API (including
missing or invalid quality values). This preset preserves source image resolution
by disabling color, grayscale, and monochrome downsampling. It uses Prepress's
automatic image compression (including lossy JPEG when appropriate), rather than
forcing lossless encoding, and allows existing JPEG/JPX images to pass through.
Preserving resolution does not guarantee lossless image quality or the same file
size as lower-resolution presets.

This preserves 300 DPI or higher images; it does not upscale lower-resolution
images or restore missing detail. Effective print DPI depends on the original
image dimensions and their physical size on the PDF page. The existing Printer,
Prepress, eBook, and Screen presets remain available. If Ghostscript is unavailable,
the qpdf fallback recompresses streams without downsampling images.

## PDF metadata

Every PDF output (book generation, uploaded image/PDF pages, browser merging,
ebook conversion, compression, resizing, and metadata removal) uses `PDF Creator`
for both Creator and Producer. CreationDate and ModDate are set to the export
time; original document info fields (including Title, Author, Subject, Keywords,
and custom fields), XMP metadata streams, and trailer document IDs are removed.

This standardizes document metadata, not the complete file: page content, fonts,
images, annotations, and attachments can still contain identifying information.
It does not make files byte-identical or guarantee anonymity. The metadata-removal
tool additionally rebuilds PDFs and strips annotations, attachments, and forms.
