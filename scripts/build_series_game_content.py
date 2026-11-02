#!/usr/bin/env python3
"""Curated questions checked against timestamped transcripts of the actual USB videos."""
from pathlib import Path
import json
import re
import shutil

ROOT = Path(__file__).resolve().parents[1]
TRANSCRIPTS = ROOT / 'outputs/qa/series-vocabulary/transcripts'

# answer, prompt, distractor set, source episode/unit file, target spelling, original phrase
GULI = [
 ('hello', 'Can you say hello?', 'hello cook bunny', 1, r'hello', 'Hello'),
 ('frog', "What's that noise? Can you find the frog?", 'frog bunny owl', 2, r'frogs?', "What's that noise"),
 ('ears', 'Where are your ears?', 'ears nose feet', 3, r'ears', 'Where are your ears'),
 ('nose', "Where's your nose?", 'nose ears feet', 3, r'nose', "Where's your nose"),
 ('feet', 'Where are your feet?', 'feet ears nose', 3, r'feet', 'Where are your feet'),
 ('playground', 'Can we play hide and seek in the playground?', 'playground umbrella bucket', 4, r'playground', 'hide and seek'),
 ('bucket', 'Can you fill the bucket?', 'bucket playground cake', 5, r'bucket', 'Fill a bucket'),
 ('scooter', 'Can you ride the scooter?', 'scooter bike car', 6, r'scooter', 'ride my scooter'),
 ('bike', 'Can you ride the bike?', 'bike scooter car', 6, r'bike', 'ride our bike'),
 ('car', 'Can you drive the car?', 'car bike scooter', 6, r'car', 'drive my car'),
 ('four-balloons', 'How many balloons? Can you find four?', 'four-balloons two-balloons one-balloon', 7, r'four', 'How many'),
 ('cake', 'Can we bake a cake?', 'cake apple carrot', 7, r'cake', 'bake a cake'),
 ('apple', 'Can you pick an apple?', 'apple carrot nuts', 8, r'apples?', 'pick apples'),
 ('carrot', 'Can you pick the carrot?', 'carrot apple nuts', 8, r'carrots?', 'pick carrots'),
 ('nuts', 'Can you put the nuts in the basket?', 'nuts apple carrot', 8, r'nuts', 'Put them in the basket'),
 ('star', 'Can you see the twinkling star?', 'star owl umbrella', 9, r'stars?', 'Twinkle twinkle'),
 ('owl', 'Can you hear the owl?', 'owl frog bunny', 9, r'owl', 'Listen to the owl'),
 ('bunny', 'Can you follow the bunny?', 'bunny frog owl', 10, r'bunny', 'Follow me'),
 ('umbrella', 'Do you have an umbrella?', 'umbrella bucket one-balloon', 11, r'umbrella', 'I have a green umbrella'),
 ('cook', 'Who are you? Are you a cook?', 'cook bunny hello', 12, r'cook', "I'm a cook"),
]
WOW = [
 ('hello', 'Can you say hello?', 'hello run walk', 6, r'hello', 'can you say hello'),
 ('run', 'Can you show me how to run?', 'run walk hello', 1, r'run', 'Show me how to run'),
 ('red', 'What colour is it? Can you find red?', 'red green yellow', 4, r'red', 'What colour is it'),
 ('green', 'Can you show me green?', 'green yellow red', 4, r'green', 'Show us the green part'),
 ('yellow', 'Which one is yellow?', 'yellow red green', 4, r'yellow', 'What color is it'),
 ('house', 'What is it? Can you find the house?', 'house car tree', 6, r'house', 'What is it'),
 ('door', 'Can you open the door?', 'door tree apple', 6, r'door', 'open the door'),
 ('tree', 'What can you see? Is it a tree?', 'tree house flower', 8, r'tree', 'What is it'),
 ('sun', 'What is big and yellow?', 'sun tree flower', 8, r'sun', 'big and yellow'),
 ('car', 'Can you drive a car?', 'car bike train', 11, r'car', 'drive a car'),
 ('bike', 'Can you ride a bike?', 'bike car train', 11, r'bike', 'ride a bike'),
 ('train', 'What goes choo-choo?', 'train bike car', 10, r'train', 'Choo choo'),
 ('arms', 'Where are my arms?', 'arms legs face', 14, r'arms', 'Where are my arms'),
 ('legs', 'Where are my legs?', 'legs arms face', 14, r'legs', 'Where are my legs'),
 ('apple', 'Yummy! Can you find an apple?', 'apple banana orange', 18, r'apples?', "it's an apple"),
 ('banana', 'Can I have the banana, please?', 'banana orange apple', 18, r'bananas?', 'can I have the banana, please'),
 ('orange', 'Is it an orange? Can you find it?', 'orange apple banana', 18, r'oranges?', 'Is it an orange'),
 ('butterfly', 'What can you see? Can you find the butterfly?', 'butterfly bee ladybird', 24, r'butterfly', 'What can you see'),
 ('bee', 'Can you see the bee?', 'bee butterfly ladybird', 22, r'bee', 'Can you see it'),
 ('happy', 'Are you happy? Which face is happy?', 'happy sad okay', 27, r'happy', 'Are you happy'),
]

def clean(text):
    return re.sub(r'\s+', ' ', text.replace('\u2019', "'").replace('-', ' ')).strip().lower()

def locate(video, expression, literal=False):
    pattern = re.escape(clean(expression)) if literal else expression
    regex = re.compile(r'\b(?:' + pattern + r')\b', re.I)
    candidates = [s for s in video['segments'] if regex.search(clean(s['text']))]
    if not candidates:
        raise ValueError(f"No source evidence for {expression!r} in {video['name']}")
    segment = min(candidates, key=lambda s: len(s['text']))
    quote = segment['text'].strip()
    if len(quote) > 180:
        match = regex.search(clean(quote)); start = max(0, match.start() - 45); quote = quote[start:match.end() + 70].strip()
    return {'videoId': video['id'], 'video': video['name'], 'start': segment['start'], 'end': segment['end'], 'quote': quote}

def main():
    content_file = ROOT / 'public/game-content.json'
    content = json.loads(content_file.read_text())
    content['schemaVersion'] = 3
    content['pictures'].update({key: label for key, label in [
        ('frog','Frog'),('ears','Ears'),('nose','Nose'),('feet','Feet'),('playground','Playground'),('bucket','Bucket'),
        ('scooter','Scooter'),('bike','Bike'),('balloon','Balloon'),('four-balloons','Four balloons'),('two-balloons','Two balloons'),('one-balloon','One balloon'),
        ('carrot','Carrot'),('nuts','Nuts'),('star','Star'),('owl','Owl'),('bunny','Bunny'),('umbrella','Umbrella'),('cook','Cook'),
        ('walk','Walk'),('house','House'),('door','Door'),('window','Window'),('tree','Tree'),('train','Train'),
        ('arms','Arms'),('legs','Legs'),('ladybird','Ladybird'),('face','Face'),('okay','Okay') ]})
    pictures_file = ROOT / 'public/game-pictures.json'
    if pictures_file.exists():
        content['seriesPictures'] = json.loads(pictures_file.read_text())
    content['pictureGroups'] = {'ears': {'picture':'ear','count':2}, 'feet': {'picture':'foot','count':2},
        'arms': {'picture':'arm','count':2}, 'legs': {'picture':'leg','count':2},
        'four-balloons': {'picture':'balloon','count':4}, 'two-balloons': {'picture':'balloon','count':2}, 'one-balloon': {'picture':'balloon','count':1}}
    shutil.copy2(ROOT / 'public/game-art/rabbit.svg', ROOT / 'public/game-art/bunny.svg')
    videos = [json.loads(path.read_text()) for path in TRANSCRIPTS.glob('*.json')]
    document = ['# 系列视频核心词与游戏题库', '', '本版根据 U 盘中的 **12 个古力视频、26 个 WOW 视频**整理。先提取原音轨并完成本地英文转写，再按具体台词片段选择词和短句。原视频没有改动。', '',
        '下表保留来源文件与约略时间点。`原问句`表示沿用视频里的问法；`问句改写`表示把原片中的动作、陈述或常见短句改成找图问题，并不冒充原片逐字台词。音乐和连读会影响自动转写，因此不把识别次数当作精确词频。', '',
        '每个系列一局 **20 题**，题序打乱；正确答案在左、中、右各出现 6–7 次，顺序随机，同一位置不连续出现三次。测试阶段 **0 遍即可进入**。答对说完反馈自动切题；答错说 **You are wrong. This is …**，说明所选图片后重播本题。', '',
        '古力和 WOW 的正确、干扰选项均优先使用该系列原视频截图，按主体裁切并离线保存。截图与台词时间分别保留，避免把“说到这个词”误当成“画面清楚展示了这个物品”。截图清单见 `public/game-pictures.json`。', '']
    series_reports = {}
    for series, specifications, title in [('guli',GULI,'古力小超人'),('wow',WOW,'WOW English')]:
        source_videos = [v for v in videos if ('古力' in v['name']) == (series == 'guli')]
        questions = []; vocabulary = []
        document += ['## ' + title, '', '### 本版测试词', '', ' · '.join(content['pictures'][spec[0]] for spec in specifications), '',
            '### 常见短句与问法', '', ' · '.join(dict.fromkeys(spec[5] for spec in specifications)), '',
            '| 测试内容 | 英文提问 | 依据原片短句 | 来源与时间 | 类型 |', '| --- | --- | --- | --- | --- |']
        for answer, prompt, options, number, target, phrase in specifications:
            prefix = f'古力小超人 {number:02}' if series == 'guli' else f'{number:03}.'
            video = next(v for v in source_videos if v['name'].startswith(prefix))
            target_source = locate(video, target)
            phrase_source = locate(video, phrase, literal=True)
            # Visually checked against the original subtitle/frame. The ASR
            # transcript drifted into the preceding repeated "scrub" refrain.
            if series == 'guli' and answer == 'feet':
                target_source = {**target_source, 'start':69.6, 'end':72.3, 'quote':'Where are your feet?'}
                phrase_source = dict(target_source)
            kind = 'original-question' if any(clean(prompt).strip('?!') in clean(s['text']) for s in video['segments']) else 'adapted-question'
            identifier = f'{series}-{answer}'
            label = content['pictures'][answer]
            if answer in ['red','green','yellow','blue']:
                feedback = f"Well done! It's {answer}."
            elif answer in ['hello','run','happy','four-balloons']:
                feedback = f"Well done! {label.rstrip('!')}!"
            elif answer in ['ears','feet','arms','legs','nuts']:
                feedback = f'Well done! These are {label.lower()}.'
            elif answer == 'sun':
                feedback = "Well done! It's the sun."
            else:
                word = label.lower(); feedback = f"Well done! It's {'an' if word[0] in 'aeiou' else 'a'} {word}."
            content['questions'][identifier] = {'answer':answer,'options':options.split(),'prompt':prompt,'feedback':feedback,
                'series':series,'source':{'target':target_source,'phrase':phrase_source,'originalPhrase':phrase,'questionKind':kind}}
            questions.append(identifier)
            vocabulary.append({'word': label, 'question': prompt, 'targetSource': target_source, 'phraseSource': phrase_source, 'questionKind':kind})
            seconds = int(target_source['start']); time = f'{seconds//60:02}:{seconds%60:02}'
            document.append(f"| {label} | {prompt} | {phrase} | {video['name']} · {time} | {'原问句' if kind == 'original-question' else '问句改写'} |")
        content['decks'][series] = {'label':'Little Superhero' if series == 'guli' else 'WOW English','roundSize':20,'questions':questions,
            'sourceVideoCount':len(source_videos),'sourceVideos':[{'id':v['id'],'name':v['name']} for v in sorted(source_videos,key=lambda v:v['name'])],
            'words':[v['word'] for v in vocabulary]}
        document.append('')
        series_reports[series] = {'title':title,'videos':len(source_videos),'questions':len(questions),'vocabulary':vocabulary}
    # One feedback recording per picture; all decks use the same caption for it.
    for question in content['questions'].values():
        assert all(option in content['pictures'] for option in question['options']), question
        if question.get('series') in ['guli', 'wow'] and pictures_file.exists():
            assert all(option in content['seriesPictures'][question['series']] for option in question['options']), 'Missing same-series screenshot'
    canonical = {q['answer']: q['feedback'] for q in content['questions'].values()}
    for question in content['questions'].values():
        question['feedback'] = canonical[question['answer']]
    # All response clips are explicit English labels of the selected picture.
    for key, label in content['pictures'].items():
        if key in ['red','green','yellow','blue']: description = 'This is ' + key + '.'
        elif key in ['ears','feet','arms','legs']: description = 'This is a pair of ' + label.lower() + '.'
        elif key in ['nuts','four-balloons','two-balloons','one-balloon']: description = 'This is a picture of ' + label.lower() + '.'
        elif key in ['hello','sleep','run','clap','bath','walk']:
            description = 'This is ' + {'hello':'waving hello','sleep':'going to bed','run':'running','clap':'clapping hands','bath':'washing','walk':'walking'}[key] + '.'
        elif key in ['happy','sad','okay']: description = 'This is ' + ('an' if key == 'okay' else 'a') + ' ' + key + ' face.'
        elif key == 'rain': description = 'This is rain.'
        elif key == 'sun': description = 'This is the sun.'
        else:
            word = label.lower(); description = f"This is {'an' if word[0] in 'aeiou' else 'a'} {word}."
        content['wrongFeedback'][key] = 'You are wrong. ' + description
    content_file.write_text(json.dumps(content,ensure_ascii=False,indent=2) + '\n')
    (ROOT/'docs/series-vocabulary.md').write_text('\n'.join(document) + '\n')
    (ROOT/'outputs/qa/series-vocabulary/curated-content.json').write_text(json.dumps(series_reports,ensure_ascii=False,indent=2) + '\n')
    print('20 source-linked questions per series; source file/time evidence retained.')

if __name__ == '__main__':
    main()
