#!/usr/bin/env python3
"""Transcribe extracted original TV audio locally and keep timestamped evidence."""
from pathlib import Path
import collections
import json
import os
import re
import time

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / 'outputs/qa/series-vocabulary'
TOOLS = Path.home() / '.cache/pipitv-tools'
os.environ['PATH'] = str(TOOLS / 'whisper-venv/bin') + os.pathsep + os.environ.get('PATH', '')

def main():
    import mlx_whisper
    output = WORK / 'transcripts'
    output.mkdir(exist_ok=True)
    manifest = json.loads((WORK / 'audio/manifest.json').read_text())
    model = TOOLS / 'whisper-base.en-mlx'
    for index, source in enumerate(manifest):
        if source.get('error'):
            print('EXTRACTION ERROR', source, flush=True)
            continue
        target = output / (source['id'] + '.json')
        if target.exists():
            continue
        started = time.time()
        result = mlx_whisper.transcribe(str(WORK / 'audio' / source['audioFile']), path_or_hf_repo=str(model), language='en',
            temperature=0, condition_on_previous_text=False, verbose=False)
        result = {**source, 'model': json.loads((model / 'source.json').read_text()), 'text': result['text'],
            'segments': [{key: segment.get(key) for key in ['start', 'end', 'text', 'avg_logprob', 'no_speech_prob']} for segment in result['segments']]}
        target.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
        print(json.dumps({'completed': index + 1, 'of': len(manifest), 'name': source['name'], 'seconds': round(time.time() - started, 1), 'words': len(result['text'].split())}, ensure_ascii=False), flush=True)
    summarize(output)

def summarize(output):
    grouped = {'guli': [], 'wow': []}
    for path in output.glob('*.json'):
        item = json.loads(path.read_text())
        grouped['guli' if '古力' in item['name'] else 'wow'].append(item)
    reports = {}
    stop = set('a an the is are was were it this that these those i you we he she they me my your our its to of in on at for and or but do does did be am have has with as so not what where who how can yes no oh ah huh hmm uh okay ok ooh la ha mmm um'.split())
    for series, videos in grouped.items():
        words = collections.Counter(); documents = collections.Counter(); phrases = collections.Counter(); questions = []
        for video in videos:
            clean = ' '.join(s['text'] for s in video['segments'] if (s.get('avg_logprob') or 0) >= -1.0 and (s.get('no_speech_prob') or 0) < .65)
            tokens = re.findall(r"[a-z]+(?:'[a-z]+)?", clean.lower())
            filtered = [word for word in tokens if word not in stop and len(word) > 1]
            words.update(filtered); documents.update(set(filtered))
            for length in [2, 3, 4]:
                phrases.update(' '.join(tokens[i:i + length]) for i in range(len(tokens) - length + 1)
                    if any(t not in stop for t in tokens[i:i + length]))
            for segment in video['segments']:
                if '?' in segment['text']:
                    questions.append({'video': video['name'], 'start': segment['start'], 'text': segment['text'].strip()})
        reports[series] = {'videoCount': len(videos), 'topWords': [{'word': w, 'count': n, 'videos': documents[w]} for w, n in words.most_common(80)],
            'repeatedPhrases': [{'phrase': p, 'count': n} for p, n in phrases.most_common(100) if n >= 3], 'questions': questions}
    (WORK / 'analysis.json').write_text(json.dumps(reports, ensure_ascii=False, indent=2) + '\n')
    print('Timestamped transcripts and corpus summary saved.', flush=True)

if __name__ == '__main__':
    main()
