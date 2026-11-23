/**
 * A Word document (.docx) from paragraphs: real text, so it can be searched, copied and
 * edited, with Arabic, Persian and Urdu set right to left in a fitting typeface.
 */
import { strToU8, zipSync } from 'fflate';
import { hasArabicScript } from './arabic';

export interface DocPara {
  text: string;
  /** A heading (1 the largest), a small grey line (a citation), or ordinary text. */
  kind?: 'title' | 'h1' | 'h2' | 'small' | 'note' | 'p';
  lang?: string;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function para(p: DocPara): string {
  const rtl = hasArabicScript(p.text);
  const urdu = p.lang === 'ur';
  const size = { title: 40, h1: 32, h2: 26, small: 18, note: 21, p: 23 }[p.kind ?? 'p'];
  const csSize = rtl ? Math.round(size * (urdu ? 1.25 : 1.3)) : size;
  const bold = p.kind === 'title' || p.kind === 'h1' || p.kind === 'h2';
  const color = p.kind === 'small' ? '6D6960' : p.kind === 'h1' || p.kind === 'title' ? 'A3302A' : '1D1C1A';
  const italic = p.kind === 'note';
  const font = rtl ? (urdu ? 'Noto Nastaliq Urdu' : 'Amiri') : 'Georgia';
  const runs = p.text.split('\n').map((line, i) => `${i ? '<w:r><w:br/></w:r>' : ''}<w:r><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}"/>${bold ? '<w:b/><w:bCs/>' : ''}${italic ? '<w:i/><w:iCs/>' : ''}<w:color w:val="${color}"/><w:sz w:val="${size}"/><w:szCs w:val="${csSize}"/>${rtl ? '<w:rtl/>' : ''}</w:rPr><w:t xml:space="preserve">${esc(line)}</w:t></w:r>`).join('');
  const space = p.kind === 'small' ? '<w:spacing w:before="240" w:after="40"/>' : p.kind === 'title' ? '<w:spacing w:after="120"/>' : '<w:spacing w:after="120" w:line="320" w:lineRule="auto"/>';
  return `<w:p><w:pPr>${rtl ? '<w:bidi/><w:jc w:val="right"/>' : p.kind === 'title' ? '<w:jc w:val="center"/>' : ''}${space}</w:pPr>${runs}</w:p>`;
}

export function docx(paragraphs: DocPara[]): Blob {
  const body = paragraphs.map(para).join('');
  const files = {
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/document.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1300" w:right="1300" w:bottom="1300" w:left="1300" w:header="700" w:footer="700" w:gutter="0"/></w:sectPr></w:body></w:document>`),
  };
  return new Blob([zipSync(files)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}
