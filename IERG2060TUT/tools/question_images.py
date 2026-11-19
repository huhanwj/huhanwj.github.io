#!/usr/bin/env python3
"""Cut a tutorial question PDF into one PNG per question for the draw page.

Usage: python3 tools/question_images.py Tutorial_7_Questions.pdf questions/tutorial7 "Tutorial 7"

Each question starts below its left-margin "Question N" heading (and an
optional "About N min" line) and ends at the next heading or the page
footer. Use the student (question-only) PDF, never the TA version. Needs poppler (pdftotext, pdftoppm) and Pillow. The script
writes q<N>.png files and updates questions/index.json.
"""
import json
import re
import subprocess
import sys
import tempfile
from html import unescape
from pathlib import Path

from PIL import Image, ImageChops

DPI = 200
WORD = re.compile(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)</word>')


def pages(pdf):
    html = subprocess.run(['pdftotext', '-bbox', str(pdf), '-'], check=True, capture_output=True, text=True).stdout
    for body in html.split('<page ')[1:]:
        size = re.match(r'width="([\d.]+)" height="([\d.]+)"', body)
        words = [(float(a), float(b), float(c), float(d), unescape(t)) for a, b, c, d, t in WORD.findall(body)]
        yield float(size.group(1)), float(size.group(2)), words


def regions(pdf):
    """Yield (question number, page index, top, bottom) in PDF points."""
    for index, (width, height, words) in enumerate(pages(pdf)):
        left = min((w[0] for w in words), default=0)
        headings = [(int(nxt[4]), word[1]) for word, nxt in zip(words, words[1:])
                    if word[4] == 'Question' and nxt[4].isdigit() and abs(word[0] - left) < 2 and abs(word[1] - nxt[1]) < 1]
        footer = max((w[1] for w in words if w[1] > height * 0.9), default=height) - 6
        for (number, top), following in zip(headings, headings[1:] + [(None, footer)]):
            # Start below the heading and an optional "About N min" line; the
            # page shows the question number itself.
            below = [w for w in words if top + 1 < w[1] < following[1] and abs(w[0] - left) < 2]
            start = top + 12
            if below and below[0][4] == 'About' and below[0][1] - top < 30:
                start = below[0][3]
            yield number, index, start + 2, following[1] - 6, width


def crop(pdf, index, top, bottom, width, out):
    scale = DPI / 72
    with tempfile.TemporaryDirectory() as tmp:
        prefix = Path(tmp) / 'page'
        subprocess.run(['pdftoppm', '-png', '-r', str(DPI), '-f', str(index + 1), '-l', str(index + 1),
                        '-x', '0', '-y', str(int(top * scale)), '-W', str(int(width * scale)),
                        '-H', str(int((bottom - top) * scale)), '-singlefile', str(pdf), str(prefix)], check=True)
        image = Image.open(f'{prefix}.png').convert('RGB')
    # Trim the surrounding white space, keeping a small margin.
    box = ImageChops.difference(image, Image.new('RGB', image.size, 'white')).getbbox()
    if box:
        pad = int(8 * scale)
        image = image.crop((max(0, box[0] - pad), max(0, box[1] - pad), min(image.width, box[2] + pad), min(image.height, box[3] + pad)))
    image.save(out, optimize=True)


def main():
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    pdf, folder, title = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
    folder.mkdir(parents=True, exist_ok=True)
    questions = []
    for number, index, top, bottom, width in regions(pdf):
        crop(pdf, index, top, bottom, width, folder / f'q{number}.png')
        questions.append({'number': number, 'image': f'{folder.name}/q{number}.png'})
    if not questions:
        sys.exit('No "Question N" headings found.')
    index_path = folder.parent / 'index.json'
    sets = json.loads(index_path.read_text()) if index_path.exists() else []
    sets = [s for s in sets if s['id'] != folder.name] + [{'id': folder.name, 'title': title, 'questions': questions}]
    index_path.write_text(json.dumps(sorted(sets, key=lambda s: s['id']), ensure_ascii=False, indent=2) + '\n')
    print(f'{len(questions)} questions written to {folder}')


if __name__ == '__main__':
    main()
