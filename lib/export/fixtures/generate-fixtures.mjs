import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { strToU8, zipSync } from "fflate";

const dir = dirname(fileURLToPath(import.meta.url));
const write = (name, data) => writeFileSync(join(dir, name), data);

const fountain = [
  "\uFEFFTitle: Café 東京",
  "Author: Élodie O’Connor",
  "",
  "INT. CAFÉ 東京 - DAY #12#",
  "",
  "Le café attend — שקט.",
  "",
  "ÉLODIE",
  "(très calme)",
  "مرحبا 你好 👩‍🚀 e\u0301.",
  "",
  "MÅRTEN ^",
  "Ja, déjà.",
  "",
  "[[private note]]",
  "/* discarded scene */",
  "# Act Two",
  "= The pursuit resumes",
  ">CENTERED BEAT<",
  "===",
  "",
].join("\r\n").replace("Le café attend — שקט.\r\n", "Le café attend — שקט.\r");
write("unicode-hostile.fountain", new TextEncoder().encode(fountain));

const deepOpen = Array.from({ length: 256 }, (_, i) => `<Wrapper Level="${i}">`).join("");
const deepClose = "</Wrapper>".repeat(256);
write(
  "unicode-hostile.fdx",
  `<?xml version="1.0" encoding="UTF-8"?>\n<FinalDraft DocumentType="Script">\n  <Content>${deepOpen}\n    <Paragraph Type="Scene Heading" Number="A12"><Text>INT. CAFÉ 東京 - DAY</Text></Paragraph>\n    <Paragraph Type="Action"><Text>Le café attend — שקט.</Text></Paragraph>\n    <Paragraph><DualDialogue>\n      <Paragraph Type="Character"><Text>ÉLODIE</Text></Paragraph>\n      <Paragraph Type="Dialogue"><Text>مرحبا 你好 👩‍🚀 é.</Text></Paragraph>\n      <Paragraph Type="Character"><Text>MÅRTEN</Text></Paragraph>\n      <Paragraph Type="Dialogue"><Text>Ja, déjà.</Text></Paragraph>\n    </DualDialogue></Paragraph>\n  ${deepClose}</Content>\n</FinalDraft>\n`
);
write("malformed.fdx", "<FinalDraft><Content><Paragraph>");
write("mismatched.fdx", "<FinalDraft><Content></FinalDraft></Content>");

const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const docxDocument = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="${w}"><w:body>
  <w:p><w:pPr><w:pStyle w:val="SceneHeading"/></w:pPr><w:r><w:t>INT. CAFÉ 東京 - DAY</w:t></w:r></w:p>
  <w:p><w:pPr><w:pStyle w:val="Action"/></w:pPr><w:r><w:t>Le café attend — שקט.</w:t></w:r></w:p>
  <w:p><w:pPr><w:pStyle w:val="Character"/></w:pPr><w:r><w:t>ÉLODIE</w:t></w:r></w:p>
  <w:p><w:pPr><w:pStyle w:val="Parenthetical"/></w:pPr><w:r><w:t>(très calme)</w:t></w:r></w:p>
  <w:p><w:pPr><w:pStyle w:val="Dialogue"/></w:pPr><w:r><w:t>مرحبا 你好 👩‍🚀 é.</w:t></w:r></w:p>
  <w:p><w:pPr><w:pStyle w:val="Transition"/></w:pPr><w:r><w:t>CUT TO:</w:t></w:r></w:p>
</w:body></w:document>`;
write(
  "no-styles.docx",
  zipSync({ "word/document.xml": strToU8(docxDocument) })
);
const invalidDocxXml = new Uint8Array([
  ...strToU8(`<w:document xmlns:w="${w}"><w:body><w:p><w:r><w:t>`),
  0xc3,
  0x28,
  ...strToU8("</w:t></w:r></w:p></w:body></w:document>"),
]);
write("invalid-utf8.docx", zipSync({ "word/document.xml": invalidDocxXml }));

const office = "urn:oasis:names:tc:opendocument:xmlns:office:1.0";
const text = "urn:oasis:names:tc:opendocument:xmlns:text:1.0";
const style = "urn:oasis:names:tc:opendocument:xmlns:style:1.0";
const odtContent = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="${office}" xmlns:text="${text}" xmlns:style="${style}">
  <office:automatic-styles>
    <style:style style:name="P1" style:parent-style-name="Scene Heading"/>
    <style:style style:name="P2" style:parent-style-name="Action"/>
    <style:style style:name="P3" style:parent-style-name="Character"/>
    <style:style style:name="P4" style:parent-style-name="Parenthetical"/>
    <style:style style:name="P5" style:parent-style-name="Dialogue"/>
    <style:style style:name="P6" style:parent-style-name="Transition"/>
  </office:automatic-styles>
  <office:body><office:text>
    <text:p text:style-name="P1">INT. CAFÉ 東京 - DAY</text:p>
    <text:p text:style-name="P2">Le café attend — שקט.</text:p>
    <text:p text:style-name="P3">ÉLODIE</text:p>
    <text:p text:style-name="P4">(très calme)</text:p>
    <text:p text:style-name="P5">مرحبا 你好 👩‍🚀 é.</text:p>
    <text:p text:style-name="P6">CUT TO:</text:p>
  </office:text></office:body>
</office:document-content>`;
write("unicode.odt", zipSync({ "content.xml": strToU8(odtContent) }));

function rtfText(value) {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0x20 && code <= 0x7e && !"\\{}".includes(value[i])) out += value[i];
    else if ("\\{}".includes(value[i])) out += `\\${value[i]}`;
    else out += `\\u${code > 32767 ? code - 65536 : code}?`;
  }
  return out;
}

const rtfLines = [
  ["ql", "INT. CAFÉ 東京 - DAY"],
  ["ql", "Le café attend — שקט."],
  ["qc", "ÉLODIE"],
  ["ql", "(très calme)"],
  ["ql", "مرحبا 你好 👩‍🚀 é."],
  ["qr", "CUT TO:"],
];
write(
  "unicode.rtf",
  `{\\rtf1\\ansi\\uc1${rtfLines
    .map(([align, value]) => `\\pard\\${align} ${rtfText(value)}\\par`)
    .join("")}}`
);
write("unbalanced.rtf", "{\\rtf1\\ansi A complete paragraph\\par {missing close");
write("invalid-utf8.fountain", new Uint8Array([0x49, 0x4e, 0x54, 0x2e, 0x20, 0xc3, 0x28]));
write("nul-byte.fountain", new Uint8Array([0x49, 0x4e, 0x54, 0x2e, 0x20, 0x00, 0x58]));
