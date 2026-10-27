"""Exercise release validation and rollback without SSH, PostgreSQL, or N0C."""
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest import mock


SPEC = importlib.util.spec_from_file_location('budg_deploy', str(Path(__file__).with_name('deploy.py')))
deploy = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(deploy)

COMMIT = 'a' * 40
DIGEST = 'b' * 64


def archive_bytes(extra=(), storage='server', omit=()):
    files = {
        'app.cjs': b'require("./server-dist/index.cjs");',
        'package.json': b'{"name":"budg","private":true}',
        'package-lock.json': b'{"lockfileVersion":3}',
        'dist/index.html': b'<!doctype html><title>BUDG</title>',
        'dist/budg-runtime.json': json.dumps({'storage': storage}).encode(),
        'server-dist/index.cjs': b'exports.startServer = () => {};',
        'server-dist/cli.cjs': b'// compiled migration CLI',
    }
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode='w:gz') as archive:
        for name, contents in files.items():
            if name in omit:
                continue
            member = tarfile.TarInfo(name)
            member.size = len(contents)
            archive.addfile(member, io.BytesIO(contents))
        for name, contents, kind in extra:
            member = tarfile.TarInfo(name)
            member.type = kind
            if kind in (tarfile.SYMTYPE, tarfile.LNKTYPE):
                member.linkname = '/outside/private/.env.production'
                archive.addfile(member)
            else:
                member.size = len(contents)
                archive.addfile(member, io.BytesIO(contents))
    return stream.getvalue()


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='budg-deploy-test-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.app = self.root / 'budg-app'
        self.private = self.root / 'budg-private'
        (self.app / 'releases').mkdir(parents=True)
        (self.private / 'backups').mkdir(parents=True)
        self.old = self.app / 'releases' / 'old'
        self.new = self.app / 'releases' / 'new'
        self.old.mkdir()
        self.new.mkdir()
        (self.app / 'current').symlink_to('releases/old')
        self.preserved = []
        for relative in ('.env.production', 'backups/current-month.json', 'backups/monthly-final.json'):
            path = self.private / relative
            path.write_bytes(('private sentinel: ' + relative).encode())
            os.utime(str(path), (1600000000, 1600000000))
            self.preserved.append((path, hashlib.sha256(path.read_bytes()).hexdigest(), path.stat().st_mtime_ns))
        for name, value in (('APP', self.app), ('PRIVATE', self.private)):
            patch = mock.patch.object(deploy, name, value)
            patch.start()
            self.addCleanup(patch.stop)
        previous_umask = os.umask(0o077)
        self.addCleanup(os.umask, previous_umask)

    def tearDown(self):
        for path, digest, mtime in self.preserved:
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), digest)
            self.assertEqual(path.stat().st_mtime_ns, mtime)

    def stage_archive(self, contents):
        archive = self.root / 'release.tar.gz'
        archive.write_bytes(contents)
        stage = self.root / 'stage'
        stage.mkdir()
        return archive, stage

    def legacy_installation(self):
        """Create the existing non-release layout, including external modules."""
        (self.app / 'current').unlink()
        files = {
            'app.cjs': b'// original Passenger entrypoint\nrequire("./server-dist/index.cjs");\n',
            'package.json': b'{"name":"budg","private":true}',
            'package-lock.json': b'{"lockfileVersion":3}',
            'dist/index.html': b'<!doctype html><title>Existing BUDG</title>',
            'dist/assets/old-version.js': b'console.log("existing frontend");',
            'dist/budg-runtime.json': b'{"storage":"server"}',
            'server-dist/index.cjs': b'// existing server code',
            'server-dist/cli.cjs': b'// existing cron and administration code',
        }
        for relative, contents in files.items():
            path = self.app / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(contents)
        modules = self.root / 'nodevenv' / 'modules'
        modules.mkdir(parents=True)
        (modules / 'existing-module.js').write_bytes(b'// existing dependency')
        (self.app / 'node_modules').symlink_to(str(modules))
        return files, modules

    def assert_baseline_repaired(self, baseline, files, modules):
        self.assertEqual((self.app / 'current').resolve(), baseline)
        metadata = json.loads((baseline / 'release.json').read_text())
        self.assertFalse(metadata['health'])
        self.assertRegex(metadata['commit'], r'^[0-9a-f]{40}$')
        for name in ('dist', 'server-dist'):
            self.assertTrue((self.app / name).is_symlink())
            self.assertEqual(os.readlink(str(self.app / name)), 'current/' + name)
        self.assertEqual((self.app / 'app.cjs').read_text(), deploy.BOOTSTRAP)
        self.assertIn("require('./app.cjs')", (self.app / 'maintenance.cjs').read_text())
        for relative, contents in files.items():
            self.assertEqual((baseline / relative).read_bytes(), contents)
            if relative.startswith(('dist/', 'server-dist/')):
                self.assertEqual((self.app / relative).read_bytes(), contents)
        self.assertEqual((baseline / 'node_modules').resolve(), modules)
        self.assertEqual((self.app / 'node_modules').resolve(), modules)
        self.assertEqual((modules / 'existing-module.js').read_bytes(), b'// existing dependency')

    def test_accepts_only_exact_deployment_command(self):
        self.assertEqual(deploy.command_parts('deploy ' + COMMIT + ' ' + DIGEST), (COMMIT, DIGEST))
        for command in ('', 'bash', 'deploy ' + COMMIT, 'deploy ' + COMMIT + ' ' + DIGEST + '; id',
                        'deploy ' + 'A' * 40 + ' ' + DIGEST, ' deploy ' + COMMIT + ' ' + DIGEST,
                        'deploy ' + COMMIT + ' ' + DIGEST + '\n', 'deploy ' + 'a' * 39 + ' ' + DIGEST):
            with self.subTest(command=command), self.assertRaises(deploy.DeployError):
                deploy.command_parts(command)

    def test_receives_verified_archive_with_private_permissions(self):
        contents = archive_bytes()
        target = self.root / 'upload.tar.gz'
        deploy.receive(io.BytesIO(contents), target, hashlib.sha256(contents).hexdigest())
        self.assertEqual(target.read_bytes(), contents)
        self.assertEqual(target.stat().st_mode & 0o777, 0o600)
        self.assertEqual((self.app / 'current').resolve(), self.old)

    def test_rejects_checksum_mismatch_before_deployment(self):
        with self.assertRaisesRegex(deploy.DeployError, 'checksum'):
            deploy.receive(io.BytesIO(b'invalid release'), self.root / 'upload.tar.gz', DIGEST)
        self.assertEqual((self.app / 'current').resolve(), self.old)

    def test_rejects_oversized_upload(self):
        with mock.patch.object(deploy, 'MAX_ARCHIVE', 8), self.assertRaisesRegex(deploy.DeployError, 'size limit'):
            deploy.receive(io.BytesIO(b'123456789'), self.root / 'upload.tar.gz', DIGEST)
        self.assertEqual((self.app / 'current').resolve(), self.old)

    def test_extracts_complete_online_code_only(self):
        archive, stage = self.stage_archive(archive_bytes())
        deploy.extract(archive, stage)
        self.assertTrue((stage / 'dist/index.html').is_file())
        self.assertTrue((stage / 'server-dist/cli.cjs').is_file())
        self.assertEqual(json.loads((stage / 'dist/budg-runtime.json').read_text()), {'storage': 'server'})
        self.assertFalse((stage / '.env.production').exists())
        self.assertEqual((self.app / 'current').resolve(), self.old)

    def test_rejects_unsafe_archives_before_writing_any_member(self):
        attacks = (
            ('../budg-private/.env.production', b'overwrite', tarfile.REGTYPE),
            ('/absolute/file', b'overwrite', tarfile.REGTYPE),
            ('dist/../../outside', b'overwrite', tarfile.REGTYPE),
            ('dist\\..\\outside', b'overwrite', tarfile.REGTYPE),
            ('.env.production', b'overwrite', tarfile.REGTYPE),
            ('backups/current-month.json', b'overwrite', tarfile.REGTYPE),
            ('dist/assets/link', b'', tarfile.SYMTYPE),
            ('server-dist/link', b'', tarfile.LNKTYPE),
            ('dist/assets/fifo', b'', tarfile.FIFOTYPE),
            ('app.cjs', b'duplicate entry', tarfile.REGTYPE),
        )
        for index, attack in enumerate(attacks):
            with self.subTest(path=attack[0], kind=attack[2]):
                directory = self.root / ('case-' + str(index))
                directory.mkdir()
                archive = directory / 'release.tar.gz'
                archive.write_bytes(archive_bytes(extra=[attack]))
                stage = directory / 'stage'
                stage.mkdir()
                with self.assertRaises(deploy.DeployError):
                    deploy.extract(archive, stage)
                self.assertEqual(list(stage.iterdir()), [])
                self.assertEqual((self.app / 'current').resolve(), self.old)

    def test_rejects_browser_storage_build(self):
        archive, stage = self.stage_archive(archive_bytes(storage='local'))
        with self.assertRaisesRegex(deploy.DeployError, 'browser storage'):
            deploy.extract(archive, stage)
        self.assertEqual((self.app / 'current').resolve(), self.old)

    def test_rejects_incomplete_build(self):
        archive, stage = self.stage_archive(archive_bytes(omit=['server-dist/cli.cjs']))
        with self.assertRaisesRegex(deploy.DeployError, 'Incomplete'):
            deploy.extract(archive, stage)
        self.assertEqual((self.app / 'current').resolve(), self.old)

    def test_rejects_expanded_size_limit(self):
        archive, stage = self.stage_archive(archive_bytes())
        with mock.patch.object(deploy, 'MAX_EXPANDED', 5), self.assertRaisesRegex(deploy.DeployError, 'size limit'):
            deploy.extract(archive, stage)
        self.assertEqual(list(stage.iterdir()), [])

    def test_successful_activation_switches_code_and_checks_new_release(self):
        with mock.patch.object(deploy, 'prepare_baseline', return_value=self.old), \
                mock.patch.object(deploy, 'restart') as restart, \
                mock.patch.object(deploy, 'healthy', return_value=True) as healthy:
            previous = deploy.activate(self.new)
        self.assertEqual(previous, self.old)
        self.assertEqual((self.app / 'current').resolve(), self.new)
        restart.assert_called_once_with()
        healthy.assert_called_once_with(self.new)

    def test_unhealthy_new_release_restores_previous_code(self):
        with mock.patch.object(deploy, 'prepare_baseline', return_value=self.old), \
                mock.patch.object(deploy, 'restart') as restart, \
                mock.patch.object(deploy, 'healthy', side_effect=[False, True]) as healthy:
            with self.assertRaisesRegex(deploy.DeployError, 'previous code restored'):
                deploy.activate(self.new)
        self.assertEqual((self.app / 'current').resolve(), self.old)
        self.assertEqual(restart.call_count, 2)
        self.assertEqual(healthy.call_args_list, [mock.call(self.new), mock.call(self.old)])

    def test_restart_failure_rolls_back_before_retrying_previous_code(self):
        with mock.patch.object(deploy, 'prepare_baseline', return_value=self.old), \
                mock.patch.object(deploy, 'restart', side_effect=[OSError('simulated restart failure'), None]) as restart, \
                mock.patch.object(deploy, 'healthy', return_value=True) as healthy:
            with self.assertRaisesRegex(deploy.DeployError, 'previous code restored'):
                deploy.activate(self.new)
        self.assertEqual((self.app / 'current').resolve(), self.old)
        self.assertEqual(restart.call_count, 2)
        healthy.assert_called_once_with(self.old)

    def test_install_failure_leaves_running_code_and_private_files_untouched(self):
        contents = archive_bytes()
        digest = hashlib.sha256(contents).hexdigest()
        with mock.patch.object(deploy, 'run', side_effect=deploy.DeployError('simulated npm failure')), \
                mock.patch.object(deploy, 'activate') as activate:
            with self.assertRaisesRegex(deploy.DeployError, 'simulated npm failure'):
                deploy.deploy(COMMIT, digest, io.BytesIO(contents))
        self.assertEqual((self.app / 'current').resolve(), self.old)
        self.assertEqual(set(path.name for path in (self.app / 'releases').iterdir()), {'old', 'new'})
        self.assertFalse(any((self.private / 'deploy').glob('incoming-*')))
        activate.assert_not_called()

    def test_refuses_pointer_outside_release_directory(self):
        outside = self.root / 'other-application'
        outside.mkdir()
        with self.assertRaises(deploy.DeployError):
            deploy.point_current(outside)
        self.assertEqual((self.app / 'current').resolve(), self.old)

    def test_baseline_recovers_after_second_directory_link_creation_fails(self):
        files, modules = self.legacy_installation()
        original_symlink = Path.symlink_to
        root_links = []

        def fail_second_root_link(path, target, target_is_directory=False):
            if path.parent == self.app and str(target) in ('current/dist', 'current/server-dist'):
                root_links.append(str(target))
                if len(root_links) == 2:
                    raise OSError('simulated interrupted directory conversion')
            return original_symlink(path, target, target_is_directory=target_is_directory)

        with mock.patch.object(Path, 'symlink_to', autospec=True, side_effect=fail_second_root_link):
            with self.assertRaisesRegex(OSError, 'interrupted directory conversion'):
                deploy.prepare_baseline()
        self.assertEqual(len(root_links), 2)
        previous_pointer = (self.app / 'current').resolve()
        repaired = deploy.prepare_baseline()
        self.assertEqual(repaired, previous_pointer)
        self.assert_baseline_repaired(repaired, files, modules)

    def test_baseline_recovers_after_bootstrap_write_fails(self):
        files, modules = self.legacy_installation()
        original_atomic_text = deploy.atomic_text

        def fail_bootstrap_write(path, contents):
            if path == self.app / 'app.cjs':
                raise OSError('simulated interrupted bootstrap installation')
            return original_atomic_text(path, contents)

        with mock.patch.object(deploy, 'atomic_text', side_effect=fail_bootstrap_write):
            with self.assertRaisesRegex(OSError, 'interrupted bootstrap installation'):
                deploy.prepare_baseline()
        previous_pointer = (self.app / 'current').resolve()
        repaired = deploy.prepare_baseline()
        self.assertEqual(repaired, previous_pointer)
        self.assert_baseline_repaired(repaired, files, modules)


if __name__ == '__main__':
    unittest.main()
