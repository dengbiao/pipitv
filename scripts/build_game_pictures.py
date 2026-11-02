#!/usr/bin/env python3
"""Build reviewed, series-specific crops of original video frames. Requires Pillow.

Raw frames and read-only extraction evidence are kept in outputs/qa/game-video-pictures.
Selections name a source video, exact requested frame time and normalized crop;
no generated objects, compositing or modifications to the USB video are involved.
"""
from pathlib import Path
import json
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / 'outputs/qa/game-video-pictures'


def main():
    catalog = json.loads((ROOT / 'outputs/qa/game-resource-repair/catalog.json').read_text())
    sources = {file['id']: file for file in catalog['files'] if file['kind'] == 'video'}
    selections = json.loads((ROOT / 'scripts/game-picture-selections.json').read_text())
    frames = {frame['key']: frame for filename in ['requests.json', 'extra-requests.json', 'local-frames.json', 'final-requests.json']
        for frame in json.loads((EVIDENCE / filename).read_text())}
    result = {'guli': {}, 'wow': {}}
    for selection in selections:
        series, identifier = selection['series'], selection['id']
        source = sources[selection['videoId']]
        requested = frames[selection['frameKey']]
        assert (requested['videoId'], requested['seconds']) == (selection['videoId'], selection['seconds']), 'Frame provenance mismatch'
        assert ('古力' in source['name']) == (series == 'guli'), 'Pictures must stay in their own series'
        assert identifier not in result[series], 'Duplicate picture'
        crop = selection['crop']
        assert len(crop) == 4 and 0 <= crop[0] < crop[2] <= 1 and 0 <= crop[1] < crop[3] <= 1
        frame = Image.open(EVIDENCE / 'frames' / (selection['frameKey'] + '.jpg')).convert('RGB')
        box = tuple(round(value * frame.size[i % 2]) for i, value in enumerate(crop))
        picture = frame.crop(box)
        assert min(picture.size) >= 80, 'Use a clear source subject, not a tiny thumbnail'
        picture.thumbnail((960, 720), Image.Resampling.LANCZOS)
        relative = f'game-stills/{series}/{identifier}.jpg'
        target = ROOT / 'public' / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        picture.save(target, quality=93, optimize=True, subsampling=0)
        result[series][identifier] = {'src': relative, 'kind': 'video-frame', 'width': picture.width, 'height': picture.height,
            'source': {'videoId': source['id'], 'video': source['name'], 'bytes': source['size'], 'seconds': selection['seconds'],
                'frameKey': selection['frameKey'], 'crop': crop}, 'description': selection['description']}
    (ROOT / 'public/game-pictures.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print('Reviewed original-video pictures:', ', '.join(f'{series}={len(pictures)}' for series, pictures in result.items()))


if __name__ == '__main__':
    main()
