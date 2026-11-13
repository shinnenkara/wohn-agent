import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, degrees, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { PdfCompiler } from "../../application/ports/pdf-compiler.js";

export class PdfLibCompiler implements PdfCompiler {
  constructor(private readonly fontBytes: Uint8Array) {}

  async mergeAndWatermark(files: readonly Uint8Array[], watermark: string): Promise<Uint8Array> {
    const out = await PDFDocument.create();
    out.registerFontkit(fontkit);
    const font = await out.embedFont(this.fontBytes, { subset: true });
    for (const bytes of files) {
      const source = await PDFDocument.load(bytes);
      const copied = await out.copyPages(source, source.getPageIndices());
      for (const page of copied) {
        out.addPage(page);
        drawWatermark(page, font, watermark);
      }
    }
    return out.save();
  }
}

function drawWatermark(page: PDFPage, font: PDFFont, text: string): void {
  const { width } = page.getSize();
  const diagonal = Math.hypot(width, page.getSize().height);
  let size = 18;
  while (size > 8 && font.widthOfTextAtSize(text, size) > diagonal * 0.8) {
    size -= 1;
  }
  page.drawText(text, {
    x: 36,
    y: 48,
    size,
    font,
    color: rgb(0.55, 0.12, 0.12),
    opacity: 0.45,
    rotate: degrees(32),
  });
}
