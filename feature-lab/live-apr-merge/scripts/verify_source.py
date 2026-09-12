#!/usr/bin/env python3
"""Verify an archive, optionally extracting to a new directory, or verify the
current extracted installation when no archive argument is supplied."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument('archive', nargs='?')
parser.add_argument('--extract')
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
if args.archive:
    archive = zipfile.ZipFile(args.archive)
    names = archive.namelist()
    assert len(names) == len(set(names)), 'Duplicate archive member'
    assert all(n.startswith('live-apr-merge/') and '\\' not in n and '..' not in PurePosixPath(n).parts for n in names), 'Unsafe archive path'
    manifest = json.loads(archive.read('live-apr-merge/source-manifest.json'))
    assert set(names) == {'live-apr-merge/' + n for n in manifest['files']} | {'live-apr-merge/source-manifest.json'}, 'Unexpected archive member'
    data = {n: archive.read('live-apr-merge/' + n) for n in manifest['files']}
else:
    assert not args.extract, '--extract requires an archive'
    manifest = json.loads((root / 'source-manifest.json').read_text(encoding='utf-8'))
    data = {}
    for name in manifest['files']:
        path = root / name
        assert path.resolve().is_relative_to(root) and not path.is_symlink(), 'Unsafe source path'
        data[name] = path.read_bytes()
assert manifest['format'] == 1
for name, content in data.items():
    assert hashlib.sha256(content).hexdigest() == manifest['files'][name], 'Source hash mismatch: ' + name
    assert not any(part == 'node_modules' or (part.startswith('.env') and part != '.env.example') for part in PurePosixPath(name).parts), 'Runtime settings in archive'
config = json.loads(data['source-files.json'])
lines = []
for name in sorted(data):
    content = data[name]
    path = PurePosixPath(name)
    if path.suffix in config['textExtensions'] or path.name in config['textNames']:
        content = content.replace(b'\r\n', b'\n')
    lines.append(name + '\0' + hashlib.sha256(content).hexdigest() + '\n')
assert hashlib.sha256(''.join(lines).encode()).hexdigest() == manifest['release']['sourceDigest'], 'Release source identity mismatch'
assert json.loads(data['package.json'])['version'] == manifest['release']['version'], 'Package version mismatch'
if args.extract:
    target = Path(args.extract).resolve()
    assert not target.exists(), 'Extract only to a new directory'
    for info in archive.infolist():
        assert ((info.external_attr >> 16) & 0o170000) != 0o120000, 'Archive links are unsupported'
    target.mkdir(parents=True)
    archive.extractall(target)
print(json.dumps({'ok': True, 'files': len(data), 'release': manifest['release']}))
