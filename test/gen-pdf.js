/* Emit a sheet PDF for the round-trip test. */
const fs = require('fs');
const { PS } = require('./harness');
const [, , outPath, paper = 'A4', ori = 'P', template = 'lined'] = process.argv;

(async () => {
  const spec = {
    paper, orientation: ori, template, ink: 'blue',
    spacing: PS.templates.byId(template).spacing?.def ?? 8,
    marginRule: true
  };
  const blob = await PS.generator.toPDF(spec, 1);
  fs.writeFileSync(outPath, Buffer.from(await blob.arrayBuffer()));
  const s = PS.sheetSize(paper, ori);
  console.log(JSON.stringify({ bytes: fs.statSync(outPath).size, sheet: s }));
})();
