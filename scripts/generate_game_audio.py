#!/usr/bin/env python3
"""Regenerate the bundled, offline English game prompts on macOS."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import json
import os
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
PROFILE = {'version': 2, 'voice': 'Samantha', 'synthesisWordsPerMinute': 145, 'playbackSpeed': 0.85,
           'wrongFeedbackPauseMs': 350, 'sampleRate': 44100, 'bitrate': 64000, 'channels': 1}


def find_ffmpeg():
    tools = Path(os.environ.get('PIPITV_TOOLS_DIR', str(Path.home() / '.cache/pipitv-tools')))
    candidates = [os.environ.get('PIPITV_FFMPEG'), shutil.which('ffmpeg'), tools / 'whisper-venv/bin/ffmpeg',
        *tools.glob('qa-venv/lib/python*/site-packages/imageio_ffmpeg/binaries/ffmpeg-*')]
    for candidate in candidates:
        if candidate and Path(candidate).is_file() and os.access(candidate, os.X_OK):
            return str(candidate)
    raise SystemExit('FFmpeg is required to preserve pitch while slowing game audio. Set PIPITV_FFMPEG to its executable.')


def save_json(path, value):
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, indent=2) + '\n')
    os.replace(temporary, path)

def main():
    ffmpeg = find_ffmpeg()
    content = json.loads((ROOT / 'public/game-content.json').read_text())
    captions = {key: question['prompt'] for key, question in content['questions'].items()}
    captions.update({'yes-' + question['answer']: question['feedback'] for question in content['questions'].values()})
    captions.update({'wrong-' + key: text for key, text in content['wrongFeedback'].items()})
    captions.update({'try-again': "Let's try again. Listen carefully.",
                     'all-done': 'Lovely listening! You found all the pictures. Well done!'})
    output = ROOT / 'public/game-audio'
    output.mkdir(exist_ok=True)
    try:
        previous = json.loads((output / 'captions.json').read_text())
    except (OSError, ValueError):
        previous = {}
    try:
        previous_profile = json.loads((output / 'generation.json').read_text())
    except (OSError, ValueError):
        previous_profile = {}
    def generate(pair):
        clip, caption = pair
        target = output / (clip + '.m4a')
        if previous_profile == PROFILE and previous.get(clip) == caption and target.exists() and target.stat().st_size > 1000:
            return False
        spoken = caption
        if clip.startswith('wrong-'):
            assert caption.startswith('You are wrong. '), caption
            # macOS speech commands affect the recording only, never captions.
            source_pause = round(PROFILE['wrongFeedbackPauseMs'] * PROFILE['playbackSpeed'])
            spoken = caption.replace('You are wrong. ', f'You are wrong. [[slnc {source_pause}]] ', 1)
        # Stage outside public/ on the same filesystem; each finished clip is
        # replaced atomically so preview/native builds cannot read partial AAC.
        (ROOT / 'outputs').mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='.game-audio-', dir=ROOT / 'outputs') as folder:
            source = Path(folder) / 'voice.aiff'
            slowed = Path(folder) / 'slowed.aiff'
            encoded = Path(folder) / 'voice.m4a'
            subprocess.run(['say', '-v', PROFILE['voice'], '-r', str(PROFILE['synthesisWordsPerMinute']), '-o', str(source), spoken], check=True)
            # The installed voice quantizes nearby synthesis-rate settings.
            # Apply a real 0.85x tempo change so every platform gets the slower
            # recording, at its original pitch, with actual end-event timing.
            subprocess.run([ffmpeg, '-v', 'error', '-i', str(source), '-af', f"atempo={PROFILE['playbackSpeed']}",
                            '-ar', '44100', '-ac', '1', '-c:a', 'pcm_s16be', str(slowed)], check=True)
            subprocess.run(['afconvert', '-f', 'm4af', '-d', 'aac@44100', '-b', '64000', '-c', '1',
                            str(slowed), str(encoded)], check=True)
            os.replace(encoded, target)
        return True
    with ThreadPoolExecutor(max_workers=3) as pool:
        regenerated = sum(pool.map(generate, captions.items()))
    save_json(output / 'captions.json', captions)
    save_json(output / 'generation.json', PROFILE)
    print(f"Bundled English clips: {len(captions)}; regenerated: {regenerated}; speed: {PROFILE['playbackSpeed']}x")

if __name__ == '__main__':
    main()
