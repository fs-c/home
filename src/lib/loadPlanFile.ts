/** Turn an uploaded image or PDF into an image blob + its pixel size. */
export async function loadPlanFile(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  const blob = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    ? await renderPdfPlanPage(file)
    : file
  const bmp = await createImageBitmap(blob)
  const size = { width: bmp.width, height: bmp.height }
  bmp.close()
  return { blob, ...size }
}

async function renderPdfPlanPage(file: File): Promise<Blob> {
  const pdfjs = await import('pdfjs-dist')
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise

  const render = async (pageNo: number, longSide: number) => {
    const page = await pdf.getPage(pageNo)
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: longSide / Math.max(base.width, base.height) })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvas, canvasContext: ctx, viewport }).promise
    return { canvas, ctx }
  }

  // Use the first page that has some ink on it (skips blank/cover-less pages).
  let pageNo = 1
  for (let i = 1; i <= Math.min(pdf.numPages, 10); i++) {
    const { canvas, ctx } = await render(i, 300)
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    let dark = 0
    for (let j = 0; j < d.length; j += 4) if (d[j] + d[j + 1] + d[j + 2] < 384) dark++
    if (dark > (d.length / 4) * 0.002) {
      pageNo = i
      break
    }
  }

  // ~3000px on the long side: sharp enough to trace, small enough to store.
  const { canvas } = await render(pageNo, 3000)
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PDF render failed'))), 'image/png'),
  )
}
