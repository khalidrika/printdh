"use client";

import { useRef, useState } from "react";
import { coverGeometry, type CoverProject, type CoverLayer } from "@/lib/cover/model";
import { loadCoverImage, renderCover } from "@/lib/cover/render";
import { deleteCoverLibraryEntry, listCoverLibrary, saveCoverLibraryEntry, type CoverLibraryEntry } from "@/lib/cover/storage";

export function ReferenceTools({ project, onChange }: { project: CoverProject; onChange: (patch: Partial<CoverProject>) => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = project.reference, g = coverGeometry(project);
  const update = (patch: Partial<NonNullable<CoverProject["reference"]>>) => { if (ref) onChange({ reference: { ...ref, ...patch } }); };
  async function upload(file?: File) {
    if (!file) return;
    setBusy(true); setError("");
    try {
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 30 * 1024 * 1024) throw new Error("Choose a PNG, JPG or WEBP template under 30 MB. Use the PNG from your KDP template download.");
      const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("Could not read template.")); reader.readAsDataURL(file); });
      const image = await loadCoverImage(dataUrl, new Map());
      if (image.naturalWidth * image.naturalHeight > 40_000_000) throw new Error("Use a template under 40 megapixels.");
      onChange({ reference: { name: file.name.slice(0, 150), dataUrl, x: 0, y: 0, width: g.width, height: g.height, opacity: 0.4, hidden: false, locked: true } });
      if (Math.abs(image.naturalWidth / image.naturalHeight - g.width / g.height) > 0.03) setError("Template proportions differ from this cover. Check the book size and page count, or unlock and adjust its alignment.");
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <details className="cover-extra-panel"><summary>KDP reference template</summary>
    <p className="cover-hint">Import the PNG from your KDP template download. This overlay is saved with your project and never exported.</p>
    <label>{busy ? "Loading template…" : ref ? "Replace template" : "Upload template (PNG / JPG / WEBP)"}<input aria-label="Upload KDP reference" disabled={busy} type="file" accept="image/png,image/jpeg,image/webp" onChange={e => { void upload(e.target.files?.[0]); e.target.value = ""; }} /></label>
    {error && <p role="status" className="cover-hint">{error}</p>}
    {ref && <><p className="cover-hint">{ref.name}</p><label>Template opacity · {Math.round(ref.opacity * 100)}%<input aria-label="Template opacity" type="range" min={0} max={100} value={ref.opacity * 100} onChange={e => update({ opacity: Number(e.target.value) / 100 })} /></label>
      <label className="cover-inline"><input type="checkbox" checked={!ref.hidden} onChange={e => update({ hidden: !e.target.checked })} />Show template</label>
      <label className="cover-inline"><input type="checkbox" checked={ref.locked} onChange={e => update({ locked: e.target.checked })} />Lock template position</label>
      <fieldset disabled={ref.locked} className="cover-properties-fields"><div className="cover-field-grid">
        {(["x", "y", "width", "height"] as const).map(key => <label key={key}>{key.toUpperCase()} (in)<input aria-label={`Template ${key}`} type="number" step={0.01} min={key === "x" || key === "y" ? -69 : 0.02} max={69} value={Number((ref[key] / 72).toFixed(3))} onChange={e => { const n = Number(e.target.value) * 72; if (e.target.value && Number.isFinite(n) && n <= 4968 && n >= (key === "x" || key === "y" ? -4968 : 1)) update({ [key]: n }); }} /></label>)}
      </div><button onClick={() => update({ x: 0, y: 0, width: g.width, height: g.height })}>Align to full cover</button></fieldset>
      <button onClick={() => onChange({ reference: undefined })}>Remove template</button>
    </>}
  </details>;
}

export function SpineTools({ project, onChange, pickColor }: { project: CoverProject; onChange: (patch: Partial<CoverProject>) => void; pickColor: (callback: (color: string) => void) => void }) {
  const [color, setColor] = useState("#0f766e"), [textColor, setTextColor] = useState("#ffffff");
  const [title, setTitle] = useState(""), [author, setAuthor] = useState("");
  const g = coverGeometry(project);
  const oldBackground = project.layers.find(l => l.spineRole === "background"), oldText = project.layers.find(l => l.spineRole === "text");
  function apply(withText: boolean) {
    const roles = withText ? ["text"] : ["background"];
    const keep = project.layers.filter(l => !roles.includes(l.spineRole ?? ""));
    if (keep.length >= 200) return;
    const base = { id: crypto.randomUUID(), opacity: 1, locked: false, hidden: false, rotation: 0 };
    let layer: CoverLayer;
    if (!withText) layer = { ...base, id: oldBackground?.id ?? base.id, name: "Spine background", spineRole: "background", type: "rect", x: g.spineX, y: 0, width: g.spine, height: g.height, color, radius: 0 };
    else {
      const width = g.height - 72, height = g.spine - 9;
      layer = { ...base, id: oldText?.id ?? base.id, name: "Spine title & author", spineRole: "text", type: "text", text: [title.trim(), author.trim()].filter(Boolean).join(" · "),
        x: g.spineX + g.spine / 2 - width / 2, y: g.height / 2 - height / 2, width, height, rotation: project.readingDirection === "rtl" ? -90 : 90,
        font: "Arial", fontSize: Math.min(20, Math.floor(height / 1.3)), bold: true, italic: false, color: textColor, align: "center", direction: project.readingDirection, lineHeight: 1.2 };
    }
    // Background goes above the cover images but below existing spine lettering.
    if (!withText && oldText) { const i = keep.findIndex(l => l.id === oldText.id); keep.splice(i, 0, layer); }
    else keep.push(layer);
    onChange({ layers: keep });
  }
  return <details className="cover-extra-panel"><summary>Spine designer</summary>
    <label>Spine color<input aria-label="Spine color" type="color" value={color} onChange={e => setColor(e.target.value)} /></label>
    <button onClick={() => pickColor(setColor)}>Pick color from cover</button><button disabled={!!oldBackground?.locked || (project.layers.length >= 200 && !oldBackground)} onClick={() => apply(false)}>Apply spine color</button>
    <label>Spine title<input value={title} maxLength={300} onChange={e => setTitle(e.target.value)} /></label>
    <label>Author<input value={author} maxLength={200} onChange={e => setAuthor(e.target.value)} /></label>
    <label>Spine text color<input aria-label="Spine text color" type="color" value={textColor} onChange={e => setTextColor(e.target.value)} /></label>
    <button disabled={(!title.trim() && !author.trim()) || g.spine < 19 || project.pageCount < 80 || !!oldText?.locked || (project.layers.length >= 200 && !oldText)} onClick={() => apply(true)}>Add / replace centered spine text</button>
    <p className="cover-hint">Text is centered and rotated along the spine. Select the resulting layer to edit its font or size. {g.spine < 19 || project.pageCount < 80 ? "This spine is too narrow for this text tool." : ""}</p>
  </details>;
}

export function ProjectLibrary({ project, onOpen }: { project: CoverProject; onOpen: (project: CoverProject) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [entries, setEntries] = useState<CoverLibraryEntry[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [template, setTemplate] = useState(false), [filter, setFilter] = useState(""), [removing, setRemoving] = useState<string | null>(null);
  async function refresh() { setEntries(await listCoverLibrary()); }
  async function action(fn: () => Promise<void>) {
    setBusy(true); setError("");
    try { await fn(); await refresh(); } catch (e) { setError((e as Error).message || "The library could not be saved."); } finally { setBusy(false); }
  }
  async function save() {
    const { canvas } = await renderCover(project, 0.3, new Map());
    const thumbnail = canvas.toDataURL("image/jpeg", 0.7); canvas.width = 1;
    await saveCoverLibraryEntry({ id: crypto.randomUUID(), project, template, thumbnail, updatedAt: Date.now() });
  }
  return <><button onClick={() => { dialog.current?.showModal(); void action(async () => {}); }}>Project library</button>
    <dialog ref={dialog} className="cover-library" aria-labelledby="cover-library-title">
      <div className="cover-library-heading"><h2 id="cover-library-title">Projects & templates</h2><button aria-label="Close project library" onClick={() => dialog.current?.close()}>Close</button></div>
      <p className="cover-hint">Stored in this browser. Save project files separately to keep a portable backup. Opening a saved cover keeps your current design in Undo.</p>
      <div className="cover-library-save"><label className="cover-inline"><input type="checkbox" checked={template} onChange={e => setTemplate(e.target.checked)} />Save as reusable template</label><button disabled={busy} onClick={() => void action(save)}>{busy ? "Working…" : "Save current cover to library"}</button></div>
      <label>Search projects<input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Book name" /></label>
      {error && <p role="alert" className="cover-error">{error}</p>}
      <div className="cover-library-grid">{entries.filter(e => e.project.title.toLowerCase().includes(filter.toLowerCase())).map(entry => <article key={entry.id}>
        {/* Thumbnails are local canvas snapshots, not remote optimized images. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={entry.thumbnail} alt={`Cover of ${entry.project.title}`} />
        <h3>{entry.project.title || "Untitled cover"}</h3><p className="cover-hint">{entry.template ? "Template" : "Project"} · {new Date(entry.updatedAt).toLocaleDateString()}</p>
        <div className="cover-button-row"><button disabled={busy} onClick={() => { onOpen(entry.template ? { ...entry.project, title: `${entry.project.title.slice(0, 140)} copy` } : entry.project); dialog.current?.close(); }}>{entry.template ? "Use template" : "Open"}</button>
          <button disabled={busy} onClick={() => void action(() => saveCoverLibraryEntry({ ...entry, id: crypto.randomUUID(), updatedAt: Date.now(), project: { ...entry.project, title: `${entry.project.title.slice(0, 140)} copy` } }))}>Duplicate</button>
          <button disabled={busy} onClick={() => setRemoving(entry.id)}>Delete</button></div>
        {removing === entry.id && <div className="cover-button-row"><button disabled={busy} onClick={() => void action(async () => { await deleteCoverLibraryEntry(entry.id); setRemoving(null); })}>Confirm delete</button><button onClick={() => setRemoving(null)}>Cancel</button></div>}
      </article>)}</div>
      {!entries.length && !busy && <p className="cover-hint">Your saved covers will appear here. Save the current cover to get started.</p>}
    </dialog>
  </>;
}
