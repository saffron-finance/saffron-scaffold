#!/usr/bin/env python3
"""Export the complete standalone source with an allowlisted, hashed manifest.

Usage: python3 scripts/package_source.py /path/to/live-apr-merge-source.zip
No installed packages, test output, .env.local or backend configuration is read.
"""
import hashlib
import json
from pathlib import Path
import sys
import subprocess
import zipfile

root = Path(__file__).resolve().parent.parent
config = json.loads((root / 'source-files.json').read_text(encoding='utf-8'))
paths = []
def visit(path):
    if (path.name in config['excludedNames'] or path.suffix in config['excludedSuffixes']
            or (path.name.startswith('.env') and path.name != '.env.example')):
        return
    assert not path.is_symlink() and path.resolve().is_relative_to(root), 'Source export cannot follow links'
    if path.is_dir():
        for child in path.iterdir():
            visit(child)
    elif path.is_file():
        paths.append(path)
    else:
        raise ValueError('Missing source input: ' + path.name)
for name in config['singles'] + config['trees']:
    visit(root / name)
paths = sorted(set(paths), key=lambda p: p.relative_to(root).as_posix())
files = {p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
# Use the same source identity as the Vite release marker, without a second
# implementation of source normalization or provenance rules.
release = json.loads(subprocess.check_output(['node', '--input-type=module', '-e',
    "import {sourceIdentity} from './scripts/release-source.mjs';console.log(JSON.stringify(sourceIdentity(process.cwd())))"], cwd=root, text=True))
manifest = {'format': 1, 'release': release, 'files': files}
output = Path(sys.argv[1]).resolve()
assert output.suffix == '.zip', 'Use a ZIP output file'
output.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for p in paths:
        archive.write(p, 'live-apr-merge/' + p.relative_to(root).as_posix())
    archive.writestr('live-apr-merge/source-manifest.json', json.dumps(manifest, indent=2) + '\n')
print(json.dumps({'files': len(paths), 'bytes': output.stat().st_size, 'release': release,
                  'sha256': hashlib.sha256(output.read_bytes()).hexdigest()}))
