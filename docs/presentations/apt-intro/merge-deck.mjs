import { existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join, basename } from "path";
import PptxGenJS from "pptxgenjs";
import { PDFDocument } from "pdf-lib";

const dirArg = process.argv[2] || import.meta.dirname;
const outDir = dirArg === "." ? process.cwd() : dirArg;
const slidePattern = /^(\d+)-slide-.*\.(png|jpg|jpeg)$/i;

function findSlides(folder) {
  return readdirSync(folder)
    .filter((f) => slidePattern.test(f))
    .map((f) => {
      const m = f.match(slidePattern);
      return { filename: f, path: join(folder, f), index: parseInt(m[1], 10) };
    })
    .sort((a, b) => a.index - b.index);
}

async function createPptx(slides, outputPath) {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";
  pptx.author = "APT / baoyu-slide-deck";
  pptx.title = "Agent-Protocol-Toolkit";

  for (const slide of slides) {
    const s = pptx.addSlide();
    const imageData = readFileSync(slide.path);
    const base64 = imageData.toString("base64");
    const ext = slide.filename.toLowerCase().endsWith(".png") ? "png" : "jpeg";
    s.addImage({
      data: `image/${ext};base64,${base64}`,
      x: 0,
      y: 0,
      w: "100%",
      h: "100%",
    });
    const promptPath = join(outDir, "prompts", slide.filename.replace(/\.(png|jpg|jpeg)$/i, ".md"));
    if (existsSync(promptPath)) {
      s.addNotes(readFileSync(promptPath, "utf-8"));
    }
  }

  await pptx.writeFile({ fileName: outputPath });
  console.log(`Created: ${outputPath} (${slides.length} slides)`);
}

async function createPdf(slides, outputPath) {
  const pdf = await PDFDocument.create();
  for (const slide of slides) {
    const imageBytes = readFileSync(slide.path);
    const isPng = slide.filename.toLowerCase().endsWith(".png");
    const image = isPng ? await pdf.embedPng(imageBytes) : await pdf.embedJpg(imageBytes);
    const page = pdf.addPage([1920, 1080]);
    page.drawImage(image, { x: 0, y: 0, width: 1920, height: 1080 });
  }
  writeFileSync(outputPath, await pdf.save());
  console.log(`Created: ${outputPath} (${slides.length} slides)`);
}

const slides = findSlides(outDir);
if (slides.length === 0) {
  console.error(`No slides in ${outDir}`);
  process.exit(1);
}

const base = basename(outDir);
const name = base === "slide-deck" ? basename(join(outDir, "..")) : base;
await createPptx(slides, join(outDir, `${name}.pptx`));
await createPdf(slides, join(outDir, `${name}.pdf`));
