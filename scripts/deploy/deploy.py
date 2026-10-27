#!/usr/bin/env python3
"""Restricted N0C deploy command. Python 3.6+, standard library only.

Installed outside the web root; its SSH key can only stream one BUDG release.
It never imports a budget, changes an account, or replaces private configuration.
"""
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import signal
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request

APP = Path('/home/ghmhtrcg/budg-app')
PRIVATE = Path('/home/ghmhtrcg/budg-private')
NODE = Path('/opt/alt/alt-nodejs22/root/usr/bin/node')
NPM = Path('/opt/alt/alt-nodejs22/root/usr/lib/node_modules/npm/bin/npm-cli.js')
ORIGIN = 'https://budg.prjski.com'
MAX_ARCHIVE = 50 * 1024 * 1024
MAX_EXPANDED = 200 * 1024 * 1024
CODE_FILES = {'app.cjs', 'package.json', 'package-lock.json'}
CODE_DIRS = {'dist', 'server-dist'}
BOOTSTRAP = """// Stable N0C entrypoint. Only current is switched during deployment.
const fs = require('node:fs');
const path = require('node:path');
const release = fs.realpathSync(path.join(__dirname, 'current'));
process.env.BUDG_RELEASE = JSON.parse(fs.readFileSync(path.join(release, 'release.json'), 'utf8')).commit;
process.env.BUDG_DIST_DIR = path.join(release, 'dist');
require(path.join(release, 'app.cjs'));
"""


class DeployError(Exception):
    pass


def command_parts(command):
    match = re.fullmatch(r'deploy ([0-9a-f]{40}) ([0-9a-f]{64})', command)
    if not match:
        raise DeployError('Only a BUDG deployment command is allowed.')
    return match.groups()


def atomic_text(path, text):
    descriptor, name = tempfile.mkstemp(prefix='.' + path.name + '-', dir=str(path.parent))
    try:
        with os.fdopen(descriptor, 'w') as stream:
            stream.write(text)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, str(path))
    finally:
        if os.path.exists(name):
            os.unlink(name)


def receive(stream, path, expected_digest):
    digest = hashlib.sha256()
    total = 0
    with path.open('xb') as target:
        os.chmod(str(path), 0o600)
        while True:
            chunk = stream.read(1024 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > MAX_ARCHIVE:
                raise DeployError('Release archive exceeds the size limit.')
            digest.update(chunk)
            target.write(chunk)
    if digest.hexdigest() != expected_digest:
        raise DeployError('Release checksum mismatch.')


def extract(archive_path, destination):
    """Extract only regular code files; never use tar.extractall on an upload."""
    with tarfile.open(str(archive_path), 'r:gz') as archive:
        members, seen, total = [], set(), 0
        for member in archive:
            members.append(member)
            if len(members) > 10000:
                raise DeployError('Too many release files.')
            name = member.name
            path = PurePosixPath(name)
            if (not name or path.is_absolute() or '..' in path.parts or
                    '\\' in name or any(ord(char) < 32 for char in name)):
                raise DeployError('Unsafe archive path.')
            normalized = str(path)
            if normalized in seen:
                raise DeployError('Duplicate release path.')
            seen.add(normalized)
            if not path.parts or not (path.parts[0] in CODE_DIRS or normalized in CODE_FILES):
                raise DeployError('Release contains a file outside the code allowlist.')
            if not (member.isdir() or member.isfile()):
                raise DeployError('Links and special files are forbidden in a release.')
            if member.isdir() and normalized in CODE_FILES:
                raise DeployError('Expected a code file, not a directory.')
            total += member.size
            if total > MAX_EXPANDED:
                raise DeployError('Expanded release exceeds the size limit.')
        for member in members:
            target = destination.joinpath(*PurePosixPath(member.name).parts)
            if member.isdir():
                target.mkdir(mode=0o700, parents=True, exist_ok=True)
            else:
                target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                with archive.extractfile(member) as source, target.open('xb') as output:
                    shutil.copyfileobj(source, output)
                os.chmod(str(target), 0o600)
    required = list(CODE_FILES) + ['dist/index.html', 'dist/budg-runtime.json',
                                 'server-dist/index.cjs', 'server-dist/cli.cjs']
    if not all(destination.joinpath(name).is_file() for name in required):
        raise DeployError('Incomplete online release.')
    if json.loads((destination / 'dist/budg-runtime.json').read_text()).get('storage') != 'server':
        raise DeployError('Refusing a frontend built for browser storage.')


def run(command, cwd, log):
    environment = dict(os.environ)
    # Use the actual dedicated Node binary, bypassing the selector npm wrapper
    # which otherwise installs into the running application's shared environment.
    environment['PATH'] = str(NODE.parent) + ':/usr/bin:/bin'
    for key in ('NODE_OPTIONS', 'NODE_PATH', 'NPM_CONFIG_PREFIX', 'npm_config_prefix'):
        environment.pop(key, None)
    try:
        result = subprocess.run([str(value) for value in command], cwd=str(cwd),
                                env=environment, stdout=log, stderr=log, timeout=600)
    except subprocess.TimeoutExpired:
        raise DeployError('A deployment step timed out; inspect the private deployment log.')
    if result.returncode:
        raise DeployError('A deployment step failed; inspect the private deployment log.')


def point_current(release):
    releases = (APP / 'releases').resolve()
    if release.parent.resolve() != releases or not release.is_dir():
        raise DeployError('Invalid release directory.')
    temporary = APP / ('.current-' + str(os.getpid()))
    try:
        temporary.symlink_to(str(release.relative_to(APP)))
        os.replace(str(temporary), str(APP / 'current'))
    finally:
        if temporary.is_symlink():
            temporary.unlink()


def prepare_baseline():
    """One-time conversion preserving existing startup, assets and cron paths."""
    if (APP / 'current').is_symlink():
        baseline = (APP / 'current').resolve()
        if baseline.parent != (APP / 'releases').resolve():
            raise DeployError('Current release is outside BUDG releases.')
    else:
        baseline = APP / 'releases' / ('initial-' + time.strftime('%Y%m%d%H%M%S'))
        baseline.mkdir(mode=0o700)
        for name in CODE_FILES:
            shutil.copy2(str(APP / name), str(baseline / name))
        for name in CODE_DIRS:
            shutil.copytree(str(APP / name), str(baseline / name))
        (baseline / 'node_modules').symlink_to(str((APP / 'node_modules').resolve()))
        atomic_text(baseline / 'release.json', json.dumps({'commit': '4b51d4b84815010d09db71aba17a542f8209e6b4', 'health': False}))
        point_current(baseline)
    # Finish these steps on every attempt. An interrupted first conversion is
    # repairable: current already contains a complete, working baseline copy.
    for name in CODE_DIRS:
        original = APP / name
        saved = APP / (name + '.before-ci')
        if original.is_symlink():
            if os.readlink(str(original)) != 'current/' + name:
                raise DeployError('Unexpected BUDG code symlink; inspect hosting paths.')
        else:
            if original.exists():
                if saved.exists():
                    raise DeployError('Ambiguous interrupted conversion; original code kept.')
                original.rename(saved)
            try:
                original.symlink_to('current/' + name)
            except Exception:
                if saved.exists() and not original.exists():
                    saved.rename(original)
                raise
    atomic_text(APP / 'app.cjs', BOOTSTRAP)
    # The cached LiteSpeed startup filename must remain a relay to app.cjs.
    atomic_text(APP / 'maintenance.cjs', "// Compatibility relay for LiteSpeed.\nrequire('./app.cjs');\n")
    for name in CODE_DIRS:
        saved = APP / (name + '.before-ci')
        if saved.is_dir():
            shutil.rmtree(str(saved))
    return baseline


def restart():
    (APP / 'tmp').mkdir(mode=0o700, exist_ok=True)
    (APP / 'tmp/restart.txt').touch()
    # N0C/LiteSpeed can retain the old startup process despite restart.txt.
    # Only signal workers with our exact title, uid AND application cwd.
    expected = 'Passenger NodeApp: ' + str(APP)
    for entry in Path('/proc').iterdir():
        if not entry.name.isdigit():
            continue
        try:
            if entry.stat().st_uid != os.getuid():
                continue
            title = (entry / 'cmdline').read_bytes().replace(b'\x00', b' ').decode().strip()
            if title == expected and (entry / 'cwd').resolve() == APP.resolve():
                os.kill(int(entry.name), signal.SIGTERM)
        except (FileNotFoundError, ProcessLookupError, PermissionError):
            pass


def healthy(release, timeout=75):
    metadata = json.loads((release / 'release.json').read_text())
    path = '/api/health' if metadata.get('health', True) else '/api/session'
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            request = urllib.request.Request(ORIGIN + path,
                                             headers={'Cache-Control': 'no-cache', 'User-Agent': 'BUDG-deploy'})
            with urllib.request.urlopen(request, timeout=5) as response:
                body = json.load(response)
                if (path == '/api/session' and 'user' in body) or (
                        body.get('status') == 'ok' and body.get('release') == metadata['commit']):
                    return True
        except Exception:
            pass
        time.sleep(2)
    return False


def activate(release):
    previous = prepare_baseline()
    point_current(release)
    try:
        restart()
        if not healthy(release):
            raise DeployError('The new release did not become healthy.')
    except Exception:
        point_current(previous)
        restart()
        if not healthy(previous):
            raise DeployError('Deployment failed and the previous code needs a hosting check. Database was not restored.')
        raise DeployError('Deployment failed; previous code restored. Database and backups were not restored or replaced.')
    return previous


def cleanup_releases(keep):
    for path in (APP / 'releases').iterdir():
        owned = re.fullmatch(r'(?:[0-9a-f]{40}-[0-9a-f]{12}|initial-[0-9]{14})', path.name)
        if owned and path not in keep and path.is_dir() and not path.is_symlink():
            shutil.rmtree(str(path))


def deploy(commit, digest, stream):
    os.umask(0o077)
    state = PRIVATE / 'deploy'
    state.mkdir(mode=0o700, exist_ok=True)
    (APP / 'releases').mkdir(mode=0o700, exist_ok=True)
    with (state / 'deploy.lock').open('a') as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        incoming = Path(tempfile.mkdtemp(prefix='incoming-', dir=str(state)))
        release = APP / 'releases' / (commit + '-' + digest[:12])
        try:
            archive = incoming / 'release.tar.gz'
            receive(stream, archive, digest)
            if release.exists():
                if (APP / 'current').resolve() == release and healthy(release):
                    print('BUDG release already deployed: ' + commit)
                    return
                raise DeployError('This release directory already exists; do not replace active code.')
            stage = incoming / 'code'
            stage.mkdir(mode=0o700)
            extract(archive, stage)
            with (state / 'last-deploy.log').open('w') as log:
                os.chmod(str(state / 'last-deploy.log'), 0o600)
                run([NODE, NPM, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], stage, log)
                atomic_text(stage / 'release.json', json.dumps({'commit': commit, 'archiveSha256': digest, 'health': True}))
                stage.rename(release)
                # Additive transactional migrations only. Never restore, recreate
                # users, reset state, or overwrite the midnight backup on deploy.
                run([NODE, '--env-file=' + str(PRIVATE / '.env.production'),
                     release / 'server-dist/cli.cjs', 'migrate'], release, log)
            previous = activate(release)
            atomic_text(state / 'last-success.json', json.dumps({
                'commit': commit, 'archiveSha256': digest,
                'previous': previous.name, 'release': release.name,
                'deployedAtUtc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}, indent=2) + '\n')
            cleanup_releases({release, previous})
            print('BUDG deployed and healthy: ' + commit)
        except Exception:
            # Never remove the currently running code, even if bookkeeping failed.
            if release.is_dir() and (APP / 'current').resolve() != release:
                shutil.rmtree(str(release))
            raise
        finally:
            shutil.rmtree(str(incoming))


def main():
    try:
        commit, digest = command_parts(os.environ.get('SSH_ORIGINAL_COMMAND', ''))
        deploy(commit, digest, sys.stdin.buffer)
    except DeployError as error:
        print('BUDG: ' + str(error), file=sys.stderr)
        return 1
    except Exception:
        # Subprocess output and exception details stay private, never in Actions.
        print('BUDG: deployment interrupted; inspect the private server logs.', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
