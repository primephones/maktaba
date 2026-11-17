"""Writes a small, valid MOBI 6 book (uncompressed, UTF-8, with an EXTH title and author)
for testing the Kindle importer. Usage: python3 e2e/make-mobi.py OUT.mobi"""
import struct, sys, time

title = 'كتاب الطهارة'.encode('utf-8')
author = 'مؤلف تجريبي'.encode('utf-8')
paras = [
    'الحمد لله رب العالمين، والصلاة والسلام على أشرف الأنبياء والمرسلين.',
    'باب الطهارة: الطهارة في اللغة النظافة، وفي الشرع رفع الحدث وإزالة النجس.',
    'والماء الطهور هو الباقي على أصل خلقته، وهو الذي يرفع الحدث ويزيل الخبث.',
]
html = '<html><head></head><body>'
html += '<h1>كتاب الطهارة</h1>' + ''.join(f'<p>{p}</p>' for p in paras)
html += '<mbp:pagebreak/><h1>باب المياه</h1>' + ''.join(f'<p>{p} فقرة {i + 1}.</p>' for i, p in enumerate(paras * 3))
html += '<p>كلمة مميزة: فيروزج.</p></body></html>'
text = html.encode('utf-8')

REC = 4096
records_text = [text[i:i + REC] for i in range(0, len(text), REC)]

def exth(items):
    body = b''.join(struct.pack('>II', t, len(v) + 8) + v for t, v in items)
    pad = (4 - len(body) % 4) % 4
    return b'EXTH' + struct.pack('>II', 12 + len(body) + pad, len(items)) + body + b'\0' * pad

ex = exth([(100, author), (503, title)])
MOBI_LEN = 232
palmdoc = struct.pack('>HHIHHHH', 1, 0, len(text), len(records_text), REC, 0, 0)
mobi = bytearray(MOBI_LEN)
mobi[0:4] = b'MOBI'
struct.pack_into('>I', mobi, 4, MOBI_LEN)       # header length
struct.pack_into('>I', mobi, 8, 2)              # type: book
struct.pack_into('>I', mobi, 12, 65001)         # UTF-8
struct.pack_into('>I', mobi, 16, 12345)         # uid
struct.pack_into('>I', mobi, 20, 6)             # version
first_non_book = len(records_text) + 1
struct.pack_into('>I', mobi, 64, first_non_book)
title_offset = 16 + MOBI_LEN + len(ex)
struct.pack_into('>I', mobi, 68, title_offset)
struct.pack_into('>I', mobi, 72, len(title))
struct.pack_into('>I', mobi, 76, 1)             # locale (ar)
struct.pack_into('>I', mobi, 92, first_non_book)  # first image / resource
struct.pack_into('>I', mobi, 96, 0)             # huffcdic
struct.pack_into('>I', mobi, 112, 0x40)         # has EXTH
struct.pack_into('>I', mobi, 224, 0)            # trailing flags (offset 240 in record 0)
struct.pack_into('>I', mobi, 228, 0xFFFFFFFF)   # indx
record0 = palmdoc + bytes(mobi) + ex + title + b'\0\0'
record0 += b'\0' * ((4 - len(record0) % 4) % 4)

records = [record0] + records_text + [b'\xe9\x8e\r\n']  # end-of-text marker record
header = bytearray(78)
header[0:len(b'maktaba-test')] = b'maktaba-test'
now = int(time.time()) + 2082844800
struct.pack_into('>III', header, 36, now, now, 0)
header[60:68] = b'BOOKMOBI'
struct.pack_into('>H', header, 76, len(records))
offset = 78 + 8 * len(records) + 2
entries = b''
for i, r in enumerate(records):
    entries += struct.pack('>II', offset, (2 * i) & 0xFFFFFF)
    offset += len(r)
with open(sys.argv[1], 'wb') as f:
    f.write(bytes(header) + entries + b'\0\0' + b''.join(records))
print('wrote', sys.argv[1])
