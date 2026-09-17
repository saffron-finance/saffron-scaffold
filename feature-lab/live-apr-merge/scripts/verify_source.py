#!/usr/bin/env python3
"""Bounded source integrity verification; --expected-sha256 also binds an archive
 to a separately trusted release. A self-consistent manifest is NOT authenticity.
 No archive member is extracted until all checks have passed.
"""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import stat
import zipfile

MAX_FILES = 5000
MAX_MEMBER = 16 * 1024 * 1024
MAX_TOTAL = 128 * 1024 * 1024
MAX_MANIFEST = 1024 * 1024
PREFIX = 'live-apr-merge/'


def require(condition, message):
    """Security checks must remain enabled under python -O."""
    if not condition:
        raise ValueError(message)


def safe_name(name):
    """Require canonical POSIX names, including Windows-safe extraction paths."""
    require(isinstance(name, str) and bool(name), 'Unsafe archive path')
    parts = name.split('/')
    require(not name.startswith('/') and '\\' not in name and '\0' not in name
            and all(p not in ('', '.', '..') and ':' not in p and p == p.rstrip(' .')
                    and not re.match(r'^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)', p, re.I)
                    for p in parts), 'Unsafe archive path')
    return name


def unique_json(data):
    """Reject duplicate object keys rather than silently picking the last value."""
    def pairs(items):
        output = {}
        for key, value in items:
            require(key not in output, 'Duplicate manifest key')
            output[key] = value
        return output
    return json.loads(data, object_pairs_hook=pairs)


def verify(root, archive_path=None, extract=None, expected=None):
    """Verify bounded source bytes and optionally extract into a fresh directory.
    Returns release identity; expected is a digest supplied outside the archive.
    """
    archive = None
    try:
        if archive_path:
            require(archive_path.stat().st_size <= MAX_TOTAL, 'Archive size limit')
            if expected:
                require(re.fullmatch('[0-9a-fA-F]{64}', expected), 'Invalid trusted digest')
                with archive_path.open('rb') as source:
                    require(hashlib.file_digest(source, 'sha256').hexdigest() == expected.lower(), 'Trusted archive digest mismatch')
            archive = zipfile.ZipFile(archive_path)
            infos = archive.infolist()
            require(len(infos) <= MAX_FILES, 'Archive member limit')
            names = [i.filename for i in infos]
            require(len(names) == len(set(names)), 'Duplicate archive member')
            # Also deny case collisions for Windows/macOS portable installations.
            require(len(names) == len({n.casefold() for n in names}), 'Archive case collision')
            require(sum(i.file_size for i in infos) <= MAX_TOTAL, 'Archive expanded size limit')
            for info in infos:
                safe_name(info.filename)
                require(info.filename.startswith(PREFIX), 'Unsafe archive path')
                require(info.file_size <= MAX_MEMBER, 'Archive member size limit')
                require(info.file_size <= max(1024 * 1024, info.compress_size * 1000), 'Archive compression ratio limit')
                kind = stat.S_IFMT(info.external_attr >> 16)
                require(kind in (0, stat.S_IFREG), 'Archive links and special files are unsupported')
                require(not info.flag_bits & 1, 'Encrypted archive unsupported')
            manifest_info = archive.getinfo(PREFIX + 'source-manifest.json')
            require(manifest_info.file_size <= MAX_MANIFEST, 'Manifest size limit')
            manifest = unique_json(archive.read(manifest_info))
        else:
            require(not extract and not expected, 'Archive required for extraction/trust digest')
            manifest_path = root / 'source-manifest.json'
            require(not manifest_path.is_symlink() and manifest_path.stat().st_size <= MAX_MANIFEST, 'Unsafe manifest')
            manifest = unique_json(manifest_path.read_bytes())
        require(manifest.get('format') == 1 and isinstance(manifest.get('files'), dict), 'Invalid manifest')
        files = manifest['files']
        require(0 < len(files) < MAX_FILES, 'Manifest member limit')
        for name, digest in files.items():
            safe_name(name)
            require(re.fullmatch('[0-9a-f]{64}', digest or ''), 'Invalid source hash')
            require(not any(part == 'node_modules' or (part.startswith('.env') and part != '.env.example') for part in PurePosixPath(name).parts), 'Runtime settings in archive')
        if archive:
            require(set(names) == {PREFIX + n for n in files} | {PREFIX + 'source-manifest.json'}, 'Unexpected archive member')
        data = {}
        total = 0
        for name, digest in files.items():
            if archive:
                content = archive.read(PREFIX + name)
            else:
                path = root / name
                require(path.resolve().is_relative_to(root) and not any(p.is_symlink() for p in [path, *path.parents] if p != root), 'Unsafe source path')
                require(path.stat().st_size <= MAX_MEMBER, 'Source member size limit')
                content = path.read_bytes()
            total += len(content)
            require(total <= MAX_TOTAL, 'Source size limit')
            require(hashlib.sha256(content).hexdigest() == digest, 'Source hash mismatch: ' + name)
            data[name] = content
        config = unique_json(data['source-files.json'])
        lines = []
        for name in sorted(data):
            content = data[name]
            path = PurePosixPath(name)
            if path.suffix in config['textExtensions'] or path.name in config['textNames']:
                content = content.replace(b'\r\n', b'\n')
            lines.append(name + '\0' + hashlib.sha256(content).hexdigest() + '\n')
        require(hashlib.sha256(''.join(lines).encode()).hexdigest() == manifest['release']['sourceDigest'], 'Release source identity mismatch')
        require(unique_json(data['package.json'])['version'] == manifest['release']['version'], 'Package version mismatch')
        if extract:
            target = Path(extract).resolve()
            require(not target.exists(), 'Extract only to a new directory')
            target.mkdir(parents=True)
            archive.extractall(target)
        return {'ok': True, 'files': len(data), 'trust': 'external-digest' if expected else 'integrity-only', 'release': manifest['release']}
    finally:
        if archive:
            archive.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', nargs='?', type=Path)
    parser.add_argument('--extract')
    parser.add_argument('--expected-sha256', help='Digest obtained separately from a trusted release channel')
    args = parser.parse_args()
    print(json.dumps(verify(Path(__file__).resolve().parent.parent, args.archive, args.extract, args.expected_sha256)))


if __name__ == '__main__':
    main()
