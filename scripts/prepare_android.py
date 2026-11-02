#!/usr/bin/env python3
"""Download official Mac ARM JDK/Android tools into a private build cache."""
from pathlib import Path
import hashlib
import os
import tarfile
import urllib.request
import zipfile

TOOLS = Path(os.environ.get('PIPITV_TOOLS_DIR', str(Path.home() / '.cache/pipitv-tools')))
def download(url, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    if not destination.exists():
        print('Downloading ' + destination.name, flush=True)
        with urllib.request.urlopen(url, timeout=60) as response, destination.open('wb') as output:
            while True:
                chunk = response.read(1048576)
                if not chunk: break
                output.write(chunk)

def main():
    TOOLS.mkdir(parents=True, exist_ok=True)
    if not (TOOLS / 'amazon-corretto-17.jdk/Contents/Home/bin/java').exists():
        name = 'amazon-corretto-17-aarch64-macos-jdk.tar.gz'; archive = TOOLS / 'corretto17.tar.gz'
        download('https://corretto.aws/downloads/latest/' + name, archive)
        expected = urllib.request.urlopen('https://corretto.aws/downloads/latest_sha256/' + name, timeout=30).read().decode().split()[0]
        if hashlib.sha256(archive.read_bytes()).hexdigest() != expected: raise RuntimeError('Corretto SHA256 mismatch')
        with tarfile.open(archive) as tar:
            for member in tar.getmembers():
                if Path(member.name).is_absolute() or '..' in Path(member.name).parts: raise RuntimeError('Invalid archive path')
            tar.extractall(TOOLS)
    packages = [('platform-35_r02.zip', '0bb560a90a7a2cbd0dd8348224d518b638fe7949'),
                ('build-tools_r35_macosx.zip', '93ab8ce91230e067b5add4bfa79919c52b27f072')]
    for name, expected in packages:
        archive = TOOLS / 'sdk' / name; download('https://dl.google.com/android/repository/' + name, archive)
        if hashlib.sha1(archive.read_bytes()).hexdigest() != expected: raise RuntimeError('Android SDK checksum mismatch')
        with zipfile.ZipFile(archive) as source:
            for member in source.infolist():
                if Path(member.filename).is_absolute() or '..' in Path(member.filename).parts: raise RuntimeError('Invalid archive path')
                source.extract(member, TOOLS / 'sdk')
                mode = member.external_attr >> 16
                if mode & 0o111: (TOOLS / 'sdk' / member.filename).chmod(mode & 0o777)
    print('Build tools ready: ' + str(TOOLS))

if __name__ == '__main__': main()
