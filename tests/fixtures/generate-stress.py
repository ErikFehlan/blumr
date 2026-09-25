"""Generate fictional, disposable upload fixtures for blumr reliability tests.

Usage: python tests/fixtures/generate-stress.py /tmp/blumr-stress-fixtures
No real candidate data is used. Generated files are intentionally not committed.
"""
import sys
from pathlib import Path

from docx import Document
from pypdf import PdfReader, PdfWriter
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

out = Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp/blumr-stress-fixtures')
out.mkdir(parents=True, exist_ok=True)
profile = ('Morgan Vale | Senior Software Engineer\n'
           'Owned manual regression testing for billing systems and documented defects.\n'
           'Built C# services, reviewed SQL queries, and collaborated with engineers.\n')

def pdf(name, pages, lines):
    target = out / name
    c = canvas.Canvas(str(target), pagesize=letter)
    for page in range(pages):
        y = 760
        for line in lines:
            c.drawString(35, y, line[:115])
            y -= 15
            if y < 35:
                break
        c.showPage()
    c.save()
    return target

long_pdf = pdf('100-page-over-limit.pdf', 100, [profile.strip().replace('\n', ' ')] * 18)
pdf('100-page-sparse.pdf', 100, [profile.strip().replace('\n', ' ')])
plain = pdf('readable.pdf', 1, [profile.strip().replace('\n', ' ')])
writer = PdfWriter()
for page in PdfReader(str(plain)).pages:
    writer.add_page(page)
writer.encrypt('fixture-password')
with (out / 'password-protected.pdf').open('wb') as stream:
    writer.write(stream)

(out / 'tiny.txt').write_text('Hi.\n')
(out / 'duplicate-a.txt').write_text(profile)
(out / 'duplicate-b.txt').write_text(profile)
(out / 'Morgan Vale.txt').write_text(profile + 'Project: invoicing.\n')
(out / 'Morgan Vále.txt').write_text(profile + 'Project: observability.\n')
(out / 'quotes & brackets [test] üñîçødé.txt').write_text(profile + 'Unicode filename test.\n')
(out / '<svg onload=alert(1)>.txt').write_text(profile + 'Markup filename test.\n')
(out / 'malformed.docx').write_bytes(b'PK\x03\x04not a valid Office package')

document = Document()
document.add_heading('Morgan Vale | Senior Software Engineer', 0)
table = document.add_table(rows=3, cols=2)
for row, cells in enumerate([('Experience', 'Owned manual regression testing for billing systems.'),
                              ('Tools', 'C#, SQL, Azure, React'),
                              ('Impact', 'Documented defects and validated fixes.')]):
    table.cell(row, 0).text, table.cell(row, 1).text = cells
document.save(out / 'tables.docx')

pdf('two-columns.pdf', 1, ['Morgan Vale | Senior Software Engineer',
                           'Owned manual regression testing for billing systems.',
                           'Built C# services and reviewed SQL queries.'])
for n in range(50):
    (out / f'batch-{n+1:02d}.txt').write_text(profile + f'Unique synthetic project reference {n+1:02d}.\n')

(out / 'short-job-description.txt').write_text('Software engineer')
(out / 'long-job-description.txt').write_text(('Senior software engineer. C#, SQL, Azure, React. ' * 3000).strip())
print(f'Generated {len(list(out.iterdir()))} fixtures in {out}')
