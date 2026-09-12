#!/usr/bin/env python3
"""Refresh guide sections from JSON while preserving the published HTML style.

No network or reusable skill files are accessed. The existing self-contained
CSS, accessibility controls and script remain unchanged.
"""
from pathlib import Path
import html
import json
import re
root = Path(__file__).resolve().parent.parent
model = json.loads((root / 'docs/install-guide.json').read_text(encoding='utf-8'))
path = root / 'public/install.html'
source = path.read_text(encoding='utf-8')
sections = []
for index, section in enumerate(model['sections']):
    key, title = html.escape(section['id'], quote=True), html.escape(section['title'])
    opened = ' open' if index == 0 else ''
    sections.append(f'<details class="section" id="{key}"{opened}><summary><h2 id="h-{key}">{title}</h2></summary>\n{section["body_html"]}\n</details>')
source, count = re.subn(r'<main id="main">[\s\S]*?</main>', lambda _: '<main id="main">\n' + '\n'.join(sections) + '\n</main>', source)
assert count == 1, 'Expected one guide main element'
header = '<header>\n<div class="eyebrow">' + html.escape(model['eyebrow']) + '</div>\n<h1>' + html.escape(model['title']).replace('\n','<br>') + '</h1>\n<p>' + html.escape(model['description']) + '</p>\n<p class="meta">' + html.escape(model['meta']) + '</p>\n</header>'
source, count = re.subn(r'<header>[\s\S]*?</header>', lambda _: header, source)
assert count == 1, 'Expected one guide header'
source, count = re.subn(r'<title>[\s\S]*?</title>', lambda _: '<title>' + html.escape(model['title'].replace('\n',' ')) + '</title>', source)
assert count == 1
links = '\n'.join('<a href="#' + html.escape(s['id'], quote=True) + '">' + html.escape(s['title']) + '</a>' for s in model['sections'])
source, count = re.subn(r'(<nav aria-label="Contents">[\s\S]*?</div>)[\s\S]*?</nav>', lambda match: match[1] + '\n' + links + '</nav>', source)
assert count == 1, 'Expected guide contents navigation'
source, count = re.subn(r'<footer>[\s\S]*?</footer>', lambda _: '<footer>' + html.escape(model['footer']) + '</footer>', source)
assert count == 1
path.write_text(source, encoding='utf-8')
print('Updated installation guide sections from docs/install-guide.json')
