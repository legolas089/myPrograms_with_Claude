const { PDFDocument } = PDFLib;

export async function mergePDFs(fileDataArray) {
  const merged = await PDFDocument.create();

  for (const { data, name } of fileDataArray) {
    try {
      const src = await PDFDocument.load(data);
      const pages = await merged.copyPages(src, src.getPageIndices());
      for (const page of pages) {
        merged.addPage(page);
      }
    } catch (err) {
      throw new Error(`"${name}" 로드 실패: ${err.message}`);
    }
  }

  const bytes = await merged.save();
  return bytes;
}

export async function getPDFPageCount(data) {
  const doc = await PDFDocument.load(data);
  return doc.getPageCount();
}
