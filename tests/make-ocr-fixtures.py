# Copyright (c) 2026 Davide Di Filippo. Tutti i diritti riservati. Vedi LICENSE.
"""
Crea le pagine "scansionate" per i test dell'OCR e il loro testo riconosciuto dal vero Tesseract.
  tests/fixtures/scan-1.png, scan-2.png   due pagine scritte a 150 dpi, come uscite da uno scanner
  tests/fixtures/scan-1.tsv, scan-2.tsv   uscita TSV di "tesseract <png> - -l eng tsv"
  tests/fixtures/scan.pdf                 PDF di sole immagini (senza testo), con le due pagine
Uso: python3 tests/make-ocr-fixtures.py   (servono Pillow, img2pdf e il programma tesseract)
"""
import os, subprocess, random
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
FIX = os.path.join(HERE, 'fixtures')
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf'
BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf'

PAGES = [
    ('The Cold War in Europe', [
        'The Cold War was a period of political and military tension between the United States and the Soviet Union, from the end of the Second World War until 1991.',
        'After 1945 Europe was divided into two blocs. The Iron Curtain is the imaginary line that separated the two blocs: Winston Churchill made the expression famous in a speech on 5 March 1946.',
        'In 1949 NATO was founded. NATO is a military alliance between the United States, Canada and the countries of Western Europe.',
    ]),
    ('The Berlin Wall', [
        'The Berlin Wall was built in 1961 and divided the city for almost thirty years. The wall stopped the citizens of East Germany from escaping to the West.',
        'The fall of the Berlin Wall, on 9 November 1989, marked the beginning of the end of the Cold War. In 1990 Germany was reunified and in 1991 the Soviet Union dissolved.',
    ]),
]

def wrap(draw, text, font, width):
    words, lines, cur = text.split(), [], ''
    for w in words:
        t = (cur + ' ' + w).strip()
        if draw.textlength(t, font=font) > width and cur:
            lines.append(cur); cur = w
        else:
            cur = t
    if cur: lines.append(cur)
    return lines

random.seed(7)
paths = []
for n, (title, paras) in enumerate(PAGES, 1):
    W, H = 1240, 1754 if n == 1 else 1200
    img = Image.new('L', (W, H), 246)
    d = ImageDraw.Draw(img)
    f, fb = ImageFont.truetype(FONT, 30), ImageFont.truetype(BOLD, 44)
    y = 150
    d.text((140, y), title, font=fb, fill=20); y += 90
    for p in paras:
        for line in wrap(d, p, f, W - 280):
            d.text((140, y), line, font=f, fill=25); y += 46
        y += 30
    # un po' di rumore e una leggera rotazione, come una vera scansione
    px = img.load()
    for _ in range(4000):
        x, yy = random.randrange(W), random.randrange(H)
        px[x, yy] = random.randrange(150, 240)
    img = img.rotate(0.4, fillcolor=246).filter(ImageFilter.GaussianBlur(0.4))
    out = os.path.join(FIX, 'scan-%d.png' % n)
    img.save(out, dpi=(150, 150))
    paths.append(out)
    tsv = subprocess.run(['tesseract', out, '-', '-l', 'eng', 'tsv'], capture_output=True, text=True, check=True).stdout
    open(os.path.join(FIX, 'scan-%d.tsv' % n), 'w', encoding='utf-8').write(tsv)
    print(out, len(tsv.splitlines()), 'righe TSV')
subprocess.run(['img2pdf', '--output', os.path.join(FIX, 'scan.pdf')] + paths, check=True)
print(os.path.join(FIX, 'scan.pdf'))
