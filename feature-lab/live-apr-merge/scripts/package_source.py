#!/usr/bin/env python3
"""Export the complete standalone source with an allowlisted, hashed manifest.

Usage: python3 scripts/package_source.py /path/to/live-apr-merge-source.zip
No installed packages, test output, .env.local or backend configuration is read.
"""
import hashlib
import json
from pathlib import Path
import sys
import zipfile

root = Path(__file__).resolve().parent.parent
trees = ['src', 'vendor', 'shared', 'public', 'tests', 'docs', 'scripts']
singles = ['package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts',
           'vitest.config.ts', 'index.html', '.gitignore', '.env.example',
           'README.md', 'source-provenance.json']
paths = [root / name for name in singles]
for name in trees:
    paths.extend(p for p in (root / name).rglob('*') if p.is_file())
paths = sorted(p for p in paths if p.suffix not in ['.zip', '.pyc'] and '__pycache__' not in p.parts)
assert all(not p.is_symlink() for p in paths), 'Source exports must not depend on symlinks'
manifest = {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
output = Path(sys.argv[1]).resolve()
output.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for p in paths:
        archive.write(p, 'live-apr-merge/' + str(p.relative_to(root)))
    archive.writestr('live-apr-merge/source-manifest.json', json.dumps(manifest, indent=2) + '\n')
print(json.dumps({'files': len(paths), 'bytes': output.stat().st_size,
                  'sha256': hashlib.sha256(output.read_bytes()).hexdigest()}))
