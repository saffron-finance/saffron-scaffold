"""Adversarial ZIP contracts against the production verifier, not an imitation."""
import hashlib
import importlib.util
import json
from pathlib import Path
import stat
import tempfile
import unittest
import warnings
import zipfile

spec = importlib.util.spec_from_file_location('verifier', Path(__file__).resolve().parents[1] / 'scripts/verify_source.py')
v = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v)


class ArchiveContracts(unittest.TestCase):
    def setUp(self):
        self.owner = tempfile.TemporaryDirectory(prefix='saffron-archive-test-')
        self.addCleanup(self.owner.cleanup)
        self.root = Path(self.owner.name)
        self.archive = self.root / 'input.zip'

    def build(self, extra=None, manifest_mutation=None, duplicate=False, content=None):
        """Build a self-consistent tiny release independently of the exporter."""
        data = {'package.json': b'{"version":"1.0.0"}', 'source-files.json': b'{"textExtensions":[".json"],"textNames":[]}'}
        data.update(content or {})
        hashes = {n: hashlib.sha256(c).hexdigest() for n, c in data.items()}
        digest = hashlib.sha256(''.join(n + '\0' + hashes[n] + '\n' for n in sorted(data)).encode()).hexdigest()
        manifest = {'format': 1, 'files': hashes, 'release': {'version': '1.0.0', 'sourceDigest': digest}}
        if manifest_mutation:
            manifest_mutation(manifest)
        with warnings.catch_warnings(), zipfile.ZipFile(self.archive, 'w', compression=zipfile.ZIP_DEFLATED) as z:
            warnings.simplefilter('ignore', UserWarning)
            for n, c in data.items():
                z.writestr(v.PREFIX + n, c)
            z.writestr(v.PREFIX + 'source-manifest.json', json.dumps(manifest))
            if duplicate:
                z.writestr(v.PREFIX + 'package.json', b'changed')
            if extra:
                z.writestr(*extra)

    def denied(self, message):
        target = self.root / 'extracted'
        with self.assertRaisesRegex((ValueError, KeyError), message):
            v.verify(self.root, self.archive, target)
        self.assertFalse(target.exists(), 'Failure must precede extraction')

    def test_good_archive_and_external_digest(self):
        self.build()
        digest = hashlib.sha256(self.archive.read_bytes()).hexdigest()
        self.assertEqual(v.verify(self.root, self.archive, self.root / 'out', digest)['trust'], 'external-digest')
        self.assertTrue((self.root / 'out/live-apr-merge/package.json').is_file())

    def test_SEC_SUPPLY_007_parent_traversal(self):
        self.build(extra=(v.PREFIX + '../escape', b'x')); self.denied('Unsafe archive path')

    def test_absolute_path(self):
        self.build(extra=('/etc/escape', b'x')); self.denied('Unsafe archive path')

    def test_windows_backslash(self):
        self.build(extra=(v.PREFIX + 'dir\\escape', b'x')); self.denied('Unsafe archive path')

    def test_windows_alternate_data_stream(self):
        self.build(extra=(v.PREFIX + 'file:payload', b'x')); self.denied('Unsafe archive path')

    def test_windows_device(self):
        self.build(extra=(v.PREFIX + 'CON.txt', b'x')); self.denied('Unsafe archive path')

    def test_noncanonical_alias(self):
        self.build(extra=(v.PREFIX + 'a/./b', b'x')); self.denied('Unsafe archive path')

    def test_SEC_SUPPLY_008_symlink_even_without_extraction(self):
        link = zipfile.ZipInfo(v.PREFIX + 'link'); link.create_system = 3; link.external_attr = (stat.S_IFLNK | 0o777) << 16
        self.build(extra=(link, b'../../outside'))
        with self.assertRaisesRegex(ValueError, 'links'):
            v.verify(self.root, self.archive)

    def test_special_file(self):
        info = zipfile.ZipInfo(v.PREFIX + 'pipe'); info.external_attr = (stat.S_IFIFO | 0o600) << 16
        self.build(extra=(info, b'')); self.denied('special files')

    def test_SEC_SUPPLY_009_duplicate_member(self):
        self.build(duplicate=True); self.denied('Duplicate archive member')

    def test_case_collision(self):
        self.build(extra=(v.PREFIX + 'PACKAGE.json', b'x')); self.denied('case collision')

    def test_SEC_SUPPLY_010_self_consistency_does_not_prove_authenticity(self):
        self.build()
        trusted = hashlib.sha256(self.archive.read_bytes()).hexdigest()
        self.build(content={'malicious.js': b'fetch("https://example.invalid")'})
        self.assertEqual(v.verify(self.root, self.archive)['trust'], 'integrity-only')
        with self.assertRaisesRegex(ValueError, 'Trusted archive digest mismatch'):
            v.verify(self.root, self.archive, expected=trusted)

    def test_SEC_SUPPLY_011_member_budget(self):
        self.build(content={'large.txt': b'x' * (v.MAX_MEMBER + 1)}); self.denied('member size limit')

    def test_compression_ratio_budget(self):
        self.build(content={'dense.txt': b'x' * (4 * 1024 * 1024)}); self.denied('compression ratio')

    def test_member_count_budget(self):
        self.build(content={f'f{i}': b'x' for i in range(v.MAX_FILES)}); self.denied('member limit')

    def test_runtime_secret_exclusion(self):
        self.build(content={'.env.local': b'test-secret-canary'}); self.denied('Runtime settings')

    def test_manifest_member_hash(self):
        self.build(manifest_mutation=lambda m: m['files'].update({'package.json': '0' * 64})); self.denied('Source hash mismatch')

    def test_release_identity(self):
        self.build(manifest_mutation=lambda m: m['release'].update(sourceDigest='0' * 64)); self.denied('identity mismatch')

    def test_release_version(self):
        self.build(manifest_mutation=lambda m: m['release'].update(version='2.0.0')); self.denied('version mismatch')

    def test_existing_destination_is_not_modified(self):
        self.build(); dest = self.root / 'extracted'; dest.mkdir(); (dest / 'keep').write_text('original')
        with self.assertRaisesRegex(ValueError, 'new directory'):
            v.verify(self.root, self.archive, dest)
        self.assertEqual((dest / 'keep').read_text(), 'original')

    def test_duplicate_manifest_keys(self):
        with self.assertRaisesRegex(ValueError, 'Duplicate manifest key'):
            v.unique_json('{"files":{},"files":{"a":"b"}}')


if __name__ == '__main__':
    unittest.main(verbosity=2)
