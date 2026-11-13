export interface PdfCompiler {
  mergeAndWatermark(files: readonly Uint8Array[], watermark: string): Promise<Uint8Array>;
}
