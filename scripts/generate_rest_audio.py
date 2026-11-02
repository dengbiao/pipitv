#!/usr/bin/env python3
"""Resume Dreamina CLI generation and publish offline reminder recordings.

The job owns stable canvas/node/submission IDs. A server-required credit
approval stops before generation. Never replace this voice using macOS say.
"""
from pathlib import Path
import argparse
import array
import hashlib
import json
import os
import shutil
import subprocess
import uuid

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_JOB = ROOT / 'outputs/dreamina-rest-audio/job.json'


def cli(*args):
    process = subprocess.run(['dreamina-canvas', *map(str, args)], capture_output=True, text=True, timeout=65)
    try:
        result = json.loads(process.stdout.strip() or process.stderr.strip())
    except ValueError:
        raise RuntimeError('Dreamina CLI returned no JSON: ' + process.stderr[:500])
    if not result.get('ok'):
        raise RuntimeError(json.dumps(result, ensure_ascii=False))
    return result['data']


def save(path, data):
    temporary = path.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    os.replace(temporary, path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--job', type=Path, default=DEFAULT_JOB)
    parser.add_argument('--phase', choices=['all', 'prepare', 'run', 'collect', 'publish'], default='all')
    parser.add_argument('--ids', nargs='+', help='Process only these caption IDs; publishing always requires all 31.')
    parser.add_argument('--reprocess', action='store_true', help='Re-encode already downloaded audio without generating or spending credits.')
    args = parser.parse_args()
    job = json.loads(args.job.read_text())
    directory = args.job.parent
    reminders = json.loads((ROOT / 'public/rest-reminders.json').read_text())
    chosen = [reminder for reminder in reminders if not args.ids or reminder['id'] in args.ids]
    assert chosen and (not args.ids or len(chosen) == len(set(args.ids))), 'Unknown caption ID'
    assert all(0 < len(reminder['text']) <= 15 for reminder in reminders)
    if args.phase == 'collect' and args.reprocess:
        assert all((directory / 'raw' / (reminder['id'] + '.audio')).is_file() and job['items'][reminder['id']].get('selectedResourceId') for reminder in chosen), 'Download originals before offline reprocessing'
    if args.phase in ['all', 'prepare', 'run'] or (args.phase == 'collect' and not args.reprocess):
        status = cli('auth', 'status')
        assert status['loggedIn'] and status['region'] == 'cn', 'Use the authenticated CN profile for this job'
        context = cli('space', 'current')
        assert context['kind'] == 'personal', 'Restore the original personal space before resuming this job'
        models = cli('model', 'list', '--type', 'audio')['items']
        model = next(model for model in models if model['model'] == job['model'])
        assert any(mode.get('scenario') == job['scenario'] for mode in model['modes'])
        offset = 0
        while True:
            page = cli('voice', 'list', '--model', job['model'], '--offset', offset, '--count', 100)['models'][job['model']]
            if any(voice.get('voiceId') == job['voiceId'] and voice['voiceName'] == job['voiceName'] for voice in page['items']):
                break
            assert page['hasMore'], 'The selected voice is no longer available'
            offset = page['nextOffset']

    if args.phase in ['all', 'prepare']:
        for reminder in chosen:
            item = job['items'].setdefault(reminder['id'], {**reminder, 'updateId': str(uuid.uuid4()), 'submitId': str(uuid.uuid4())})
            assert item['text'] == reminder['text'], 'Caption changed; review the recording before continuing'
            save(args.job, job)
            if item.get('nodeId'):
                if item.get('generationVoiceId') != job['voiceId']:
                    found = cli('node', 'show', '--project-id', job['canvasId'], '--node-id', item['nodeId'])['nodes'][0]
                    assert found['result'] == 'FOUND'
                    generation = found['node']['generation']
                    assert generation['writebackSupported'] and generation['prompt'] == reminder['text'] and not generation['references']
                    item.setdefault('voiceUpdateId', str(uuid.uuid4()))
                    save(args.job, job)
                    result = cli('node', 'edit', 'audio', '--project-id', job['canvasId'], '--node-id', item['nodeId'],
                                 '--title', reminder['id'] + '｜' + reminder['text'], '--mode', 'tts', '--model', job['model'],
                                 '--scenario', job['scenario'], '--voice-id', job['voiceId'], '--prompt', reminder['text'], '--update-id', item['voiceUpdateId'])
                    assert result['node']['generation']['voiceId'] == job['voiceId']
                    item['generationVoiceId'] = job['voiceId']
                    save(args.job, job)
                    print('VOICE UPDATED', reminder['id'], job['voiceName'], flush=True)
                continue
            result = cli('node', 'create', 'audio', '--project-id', job['canvasId'], '--title', reminder['id'] + '｜' + reminder['text'],
                         '--mode', 'tts', '--model', job['model'], '--scenario', job['scenario'], '--voice-id', job['voiceId'],
                         '--prompt', reminder['text'], '--update-id', item['updateId'])
            item['nodeId'] = result['node']['nodeId']
            item['generationVoiceId'] = job['voiceId']
            save(args.job, job)
            print('SAVED', reminder['id'], item['nodeId'], flush=True)

    if args.phase in ['all', 'run']:
        pending = [job['items'][reminder['id']] for reminder in chosen if not job['items'][reminder['id']].get('operationRef')]
        if pending:
            assert all(not item.get('runAttempted') for item in pending), 'Resolve the original submit IDs before retrying an uncertain run'
            assert all(item.get('generationVoiceId') == job['voiceId'] for item in pending), 'Prepare every draft with the selected voice first'
            # This release rejects a 30-node quote with service.2. Two-node
            # requests are verified to work; quote the WHOLE plan before running
            # any group so approval and the total scope are never bypassed.
            groups = [pending[index:index + 2] for index in range(0, len(pending), 2)]
            quotes = []
            for group in groups:
                nodes = [argument for item in group for argument in ['--node-id', item['nodeId']]]
                quote = cli('node', 'quote', '--project-id', job['canvasId'], *nodes)
                assert quote['consumptionSubject']['kind'] == 'personal' and quote['consumptionSubject']['userId'] == context['userId']
                quotes.append(quote)
            complete_quote = {'items': [item for quote in quotes for item in quote['items']],
                              'totalMaxCredits': sum(quote['totalMaxCredits'] for quote in quotes),
                              'confirmationRequired': any(quote.get('confirmationRequired') is not False for quote in quotes), 'batches': quotes}
            save(directory / 'pending-quote.json', complete_quote)
            print('QUOTE', complete_quote['totalMaxCredits'], 'credits ceiling for', len(pending), 'recordings;',
                  'approval required:', complete_quote['confirmationRequired'], flush=True)
            if complete_quote['confirmationRequired']:
                raise SystemExit('Credit approval is required. Keep these exact node and submit IDs; do not regenerate duplicates.')
            for group in groups:
                nodes = [argument for item in group for argument in ['--node-id', item['nodeId']]]
                submissions = [argument for item in group for argument in ['--submit-id', item['submitId']]]
                for item in group:
                    item['runAttempted'] = True
                save(args.job, job)
                result = cli('node', 'run', '--project-id', job['canvasId'], *nodes, *submissions)
                for returned in result['items']:
                    item = next(item for item in group if item['nodeId'] == returned['nodeId'])
                    if returned.get('state') == 'accepted':
                        item['operationRef'] = returned['submitId']
                    item['submissionState'] = returned.get('state')
                    save(args.job, job)
                print('ACCEPTED', ','.join(item['id'] for item in group), flush=True)
            assert all(item.get('operationRef') for item in pending), 'Not every item was accepted; inspect the original submissions'

    if args.phase in ['all', 'collect']:
        raw = directory / 'raw'
        converted = directory / 'converted'
        raw.mkdir(exist_ok=True)
        converted.mkdir(exist_ok=True)
        ffmpeg = shutil.which('ffmpeg') or str(Path.home() / '.cache/pipitv-tools/whisper-venv/bin/ffmpeg')
        for reminder in chosen:
            item = job['items'][reminder['id']]
            if not item.get('selectedResourceId'):
                result = cli('operation', 'wait', item['operationRef'], '--project-id', job['canvasId'], '--timeout', '45s', '--interval', '3s')
                assert result['state'] == 'succeeded', 'Keep waiting on the original operation; do not resubmit'
                resource = next(resource for resource in result['resources'] if resource['state'] == 'succeeded')
                item['selectedResourceId'] = resource['resourceId']
                save(args.job, job)
            source = raw / (item['id'] + '.audio')
            if not source.exists():
                result = cli('resource', 'download', item['selectedResourceId'], '--project-id', job['canvasId'], '--output', source)
                item['download'] = {key: value for key, value in result.items() if key in ['size', 'sha256', 'path', 'resourceId']}
                save(args.job, job)
            assert source.stat().st_size > 1000, 'Empty or truncated Dreamina recording'
            assert hashlib.sha256(source.read_bytes()).hexdigest() == item['download']['sha256'], 'Downloaded audio checksum differs'
            if 'size' in item['download']:
                assert source.stat().st_size == item['download']['size'], 'Downloaded audio byte count differs'
            target = converted / (item['id'] + '.m4a')
            if not target.exists() or args.reprocess:
                processing = job.get('processing', {})
                filters = []
                if processing.get('trimSilence'):
                    # Preserve quiet initial consonants. -45 dB removed the
                    # softly spoken “屏幕” in several phrases during QA.
                    trim = 'silenceremove=start_periods=1:start_duration=0.005:start_threshold=-55dB:start_silence=0.06'
                    filters.extend([trim, 'areverse', trim, 'areverse'])
                filters.extend(['atempo=' + str(item.get('tempo', processing.get('tempo', 1))), 'loudnorm=I=-18:TP=-2:LRA=7',
                                'aresample=44100', 'alimiter=limit=0.7:level=false:attack=5:release=50:latency=true', 'apad=pad_dur=0.08'])
                staging = target.with_name('.' + target.stem + '.new.m4a')
                subprocess.run([ffmpeg, '-hide_banner', '-loglevel', 'error', '-i', str(source), '-vn', '-af', ','.join(filters),
                                '-ar', '44100', '-ac', '1', '-c:a', 'aac', '-b:a', '96000', '-y', str(staging)], check=True)
                os.replace(staging, target)
            # AAC can overshoot its input peaks. Check the actual decoded file,
            # rather than assuming the pre-encode limiter guarantees headroom.
            for attempt in range(3):
                decoded = subprocess.check_output([ffmpeg, '-hide_banner', '-loglevel', 'error', '-i', str(target),
                                                   '-ar', '44100', '-ac', '1', '-f', 'f32le', '-'])
                samples = array.array('f'); samples.frombytes(decoded)
                peak = max(abs(sample) for sample in samples)
                if peak <= .9:
                    break
                staging = target.with_name('.' + target.stem + '.headroom.m4a')
                subprocess.run([ffmpeg, '-hide_banner', '-loglevel', 'error', '-i', str(target), '-af', 'volume=' + str(.8 / peak),
                                '-ar', '44100', '-ac', '1', '-c:a', 'aac', '-b:a', '96000', '-y', str(staging)], check=True)
                os.replace(staging, target)
            assert .01 < peak <= .9, 'Decoded audio is silent or clipping'
            item['decodedPeak'] = round(peak, 5)
            item['sha256'] = hashlib.sha256(target.read_bytes()).hexdigest()
            save(args.job, job)
            print('READY', item['id'], target.stat().st_size, flush=True)

    if args.phase in ['all', 'publish']:
        targets = [(directory / 'converted' / (reminder['id'] + '.m4a'), ROOT / 'public/rest-audio' / (reminder['id'] + '.m4a')) for reminder in reminders]
        assert len(targets) == 31 and all(source.is_file() and source.stat().st_size > 1000 for source, _ in targets), 'Collect the complete set before replacing the bundled voice'
        assert all(item.get('generationVoiceId') == job['voiceId'] for item in job['items'].values()), 'Every recording must use the selected voice'
        assert all(hashlib.sha256(source.read_bytes()).hexdigest() == job['items'][source.stem]['sha256'] for source, _ in targets)
        previous = directory / 'previous-audio'
        if not previous.exists():
            shutil.copytree(ROOT / 'public/rest-audio', previous)
        for source, target in targets:
            temporary = target.with_suffix('.m4a.tmp')
            shutil.copy2(source, temporary)
            os.replace(temporary, target)
        print('PUBLISHED 31 Dreamina recordings; original audio retained in', previous, flush=True)


if __name__ == '__main__':
    main()
