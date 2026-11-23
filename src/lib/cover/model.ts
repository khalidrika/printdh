import { z } from "zod";

export const PAPER_TYPES = {
  white: { label: "Black ink · white paper", thickness: 0.002252 },
  cream: { label: "Black ink · cream paper", thickness: 0.0025 },
  standard: { label: "Standard color · white paper", thickness: 0.002252 },
  premium: { label: "Premium color · white paper", thickness: 0.002347 },
} as const;
export const COVER_FONTS = ["Arial", "Georgia", "Verdana", "Times New Roman", "Courier New"] as const;
const color = z.string().regex(/^#[0-9a-f]{6}$/i);
const position = z.number().finite().min(-5000).max(5000);
const size = z.number().finite().min(1).max(5000);
const imageData = z.string().max(45_000_000).regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/);
const layerBase = z.object({
  id: z.string().min(1).max(100), name: z.string().max(150),
  x: position, y: position, width: size, height: size,
  rotation: z.number().finite().min(-360).max(360), opacity: z.number().min(0).max(1),
  locked: z.boolean(), hidden: z.boolean(),
  groupId: z.string().min(1).max(100).optional(),
  spineRole: z.enum(["background", "text"]).optional(),
});
export const coverLayerSchema = z.discriminatedUnion("type", [
  layerBase.extend({ type: z.literal("text"), text: z.string().max(10000),
    font: z.enum(COVER_FONTS), fontSize: z.number().min(7).max(250), bold: z.boolean(), italic: z.boolean(),
    color, align: z.enum(["left", "center", "right"]), direction: z.enum(["ltr", "rtl"]), lineHeight: z.number().min(0.8).max(3),
  }),
  layerBase.extend({ type: z.literal("image"), dataUrl: imageData,
    pixelWidth: z.number().positive().max(30000), pixelHeight: z.number().positive().max(30000), fit: z.enum(["contain", "cover", "stretch"]),
    cropZoom: z.number().min(1).max(8).optional(), cropX: z.number().min(-1).max(1).optional(), cropY: z.number().min(-1).max(1).optional(),
  }),
  layerBase.extend({ type: z.literal("rect"), color, radius: z.number().min(0).max(500) }),
  layerBase.extend({ type: z.literal("ellipse"), color }),
]);
export const coverProjectSchema = z.object({
  version: z.literal(1), title: z.string().max(150), background: color,
  trimWidth: z.number().min(4).max(8.5), trimHeight: z.number().min(6).max(11.69),
  pageCount: z.number().int().min(24).max(828), paper: z.enum(["white", "cream", "standard", "premium"]),
  customSpine: z.number().min(0.01).max(3).nullable(), readingDirection: z.enum(["ltr", "rtl"]),
  layers: z.array(coverLayerSchema).max(200),
  reference: z.object({ name: z.string().max(150), dataUrl: imageData, x: position, y: position, width: size, height: size,
    opacity: z.number().min(0).max(1), hidden: z.boolean(), locked: z.boolean() }).optional(),
}).refine((p) => new Set(p.layers.map((l) => l.id)).size === p.layers.length, "Layer IDs must be unique.");
export type CoverProject = z.infer<typeof coverProjectSchema>;
export type CoverLayer = z.infer<typeof coverLayerSchema>;
export type TextLayer = Extract<CoverLayer, { type: "text" }>;

export function createCover(): CoverProject {
  return { version: 1, title: "Untitled cover", background: "#ffffff", trimWidth: 6, trimHeight: 9,
    pageCount: 120, paper: "white", customSpine: null, readingDirection: "ltr", layers: [] };
}

// KDP paperback cover formula, in points. Interior PDF sizes already containing
// bleed must not be used here: these inputs are the finished book's trim size.
// https://kdp.amazon.com/en_US/help/topic/G201953020
export function coverGeometry(project: CoverProject) {
  const bleed = 9;
  const trimWidth = project.trimWidth * 72;
  const trimHeight = project.trimHeight * 72;
  const spine = (project.customSpine ?? project.pageCount * PAPER_TYPES[project.paper].thickness) * 72;
  const width = trimWidth * 2 + spine + bleed * 2;
  const height = trimHeight + bleed * 2;
  const left = { x: bleed, y: bleed, width: trimWidth, height: trimHeight };
  const right = { ...left, x: bleed + trimWidth + spine };
  return { width, height, bleed, spine, spineX: bleed + trimWidth,
    front: project.readingDirection === "ltr" ? right : left,
    back: project.readingDirection === "ltr" ? left : right,
  };
}

export function layerBounds(layer: CoverLayer) {
  const angle = layer.rotation * Math.PI / 180;
  const width = Math.abs(layer.width * Math.cos(angle)) + Math.abs(layer.height * Math.sin(angle));
  const height = Math.abs(layer.width * Math.sin(angle)) + Math.abs(layer.height * Math.cos(angle));
  return { x: layer.x + (layer.width - width) / 2, y: layer.y + (layer.height - height) / 2, width, height };
}

export function coverWarnings(project: CoverProject) {
  const g = coverGeometry(project);
  const warnings: string[] = [];
  for (const layer of project.layers.filter((l) => !l.hidden)) {
    const b = layerBounds(layer);
    if (b.x + b.width <= 0 || b.y + b.height <= 0 || b.x >= g.width || b.y >= g.height) warnings.push(`${layer.name}: outside the cover.`);
    if (layer.type === "image") {
      const sx = layer.width / layer.pixelWidth, sy = layer.height / layer.pixelHeight;
      const scale = (layer.fit === "contain" ? Math.min(sx, sy) : Math.max(sx, sy)) * (layer.fit === "cover" ? layer.cropZoom ?? 1 : 1);
      const dpi = Math.round(72 / scale);
      if (dpi < 300) warnings.push(`${layer.name}: about ${dpi} DPI at this size.`);
    }
    if (layer.type === "text") {
      const inside = (r: typeof g.front, inset: number) => b.x >= r.x + inset && b.y >= r.y + inset && b.x + b.width <= r.x + r.width - inset && b.y + b.height <= r.y + r.height - inset;
      const spineSafe = { x: g.spineX, y: g.bleed, width: g.spine, height: g.height - g.bleed * 2 };
      if (!inside(g.front, 9) && !inside(g.back, 9) && !(project.pageCount >= 80 && inside(spineSafe, 4.5))) warnings.push(`${layer.name}: check its text box against the safe guides.`);
    }
  }
  if (project.pageCount % 2) warnings.push("Use the final even page count from your manuscript for an accurate spine.");
  return warnings;
}
