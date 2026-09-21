"""Build a synthetic, image-only, two-page OCR fixture (Pillow + ReportLab).

The generated PDF is committed so live checks do not need Python dependencies.
No text layer, real person, email, or telephone number is included.
"""
from io import BytesIO
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader

ROOT = Path(__file__).resolve().parent
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
PAGES = [
    [
        ('Morgan Sample', 43, True),
        ('QA Analyst | Synthetic test resume', 28, False),
        ('EXPERIENCE', 27, True),
        ('Example Billing Systems | QA Analyst | 2021 - 2026', 25, True),
        ('Owned manual regression testing for billing releases.', 26, False),
        ('Created test plans and documented defects in Jira.', 26, False),
        ('Validated fixes with developers before each release.', 26, False),
        ('Used SQL queries to verify billing data and balances.', 26, False),
        ('Collaborated with product managers on acceptance criteria.', 26, False),
        ('TOOLS', 27, True),
        ('SQL, Jira, manual testing, test plans, defect tracking.', 26, False),
        ('Synthetic document for automated OCR testing only.', 22, False),
    ],
    [
        ('Morgan Sample | Continued', 37, True),
        ('PROJECT DETAILS', 27, True),
        ('Release checklist and defect remediation', 28, True),
        ('Built a release checklist covering billing adjustments.', 26, False),
        ('Tested payment failures and invoice correction workflows.', 26, False),
        ('Retested resolved defects and recorded the results.', 26, False),
        ('Prepared clear reproduction steps for engineering teams.', 26, False),
        ('Tracked regression coverage across monthly releases.', 26, False),
        ('EDUCATION', 27, True),
        ('Bachelor of Science in Information Systems, 2021.', 26, False),
        ('Synthetic second page verifies multipage OCR coverage.', 22, False),
    ],
]

pdf = canvas.Canvas(str(ROOT / 'scanned-resume.pdf'), pagesize=(612, 792), invariant=1)
pdf.setTitle('Synthetic scanned resume - two image-only pages')
for number, lines in enumerate(PAGES):
    page = Image.new('L', (1275, 1650), 255)
    draw = ImageDraw.Draw(page)
    y = 100
    for text, size, bold in lines:
        font = ImageFont.truetype(BOLD if bold else FONT, size)
        draw.text((100, y), text, font=font, fill=25)
        y += 95 if bold else 75
    # A mild scan tilt and JPEG compression exercise real raster recognition.
    page = page.rotate(0.45 if number == 0 else -0.35, resample=Image.Resampling.BICUBIC, fillcolor=255)
    page = page.filter(ImageFilter.GaussianBlur(0.25))
    image = BytesIO()
    page.save(image, format='JPEG', quality=85)
    image.seek(0)
    pdf.drawImage(ImageReader(image), 0, 0, width=612, height=792)
    pdf.showPage()
pdf.save()
print(ROOT / 'scanned-resume.pdf')
