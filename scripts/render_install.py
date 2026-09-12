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
model = json.loads((root / 'docs/install-guide.json').read_text())
path = root / 'public/install.html'
source = path.read_text()
sections = []
for index, section in enumerate(model['sections']):
    key, title = html.escape(section['id'], quote=True), html.escape(section['title'])
    opened = ' open' if index == 0 else ''
    sections.append(f'<details class="section" id="{key}"{opened}><summary><h2 id="h-{key}">{title}</h2></summary>\n{section["body_html"]}\n</details>')
source, count = re.subn(r'<main id="main">[\s\S]*?</main>', lambda _: '<main id="main">\n' + '\n'.join(sections) + '\n</main>', source)
assert count == 1, 'Expected one guide main element'
path.write_text(source)
print('Updated installation guide sections from docs/install-guide.json')
