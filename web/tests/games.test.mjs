import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { createGame, finishGameWatch, gameCompletionCount, gameContent, gameDeck, gamePicture, gameSourcePicture, gameRounds, gameStatus, recordGameWatch } from '../src/games.js';
import { createGameSpeechPlayer } from '../src/game-speech.js';

test('whole-series unlock uses the least watched current file, with isolated series and configurable thresholds', () => {
  const paths = ['/show/01.mp4', '/show/nested/02.mp4'];
  const items = { [paths[0]]: { completions: 12 }, [paths[1]]: { completions: 1 }, '/other/01.mp4': { completions: 100 } };
  assert.deepEqual(gameStatus(paths, items, 2), { requiredRounds: 2, completedRounds: 1, total: 2, readyItems: 1, unlocked: false });
  assert.equal(gameStatus(paths, items, 1).unlocked, true);
  items[paths[1]].gameCompletions = 2;
  assert.equal(gameStatus(paths, items, 2).unlocked, true);
  assert.equal(gameStatus([...paths, '/show/new.mp4'], items, 2).unlocked, false);
  assert.equal(gameStatus([], items, 1).unlocked, false);
  assert.equal(gameStatus([paths[0], paths[0]], items).total, 1);
  assert.equal(gameRounds(0), 0); assert.equal(gameRounds(100), 0); assert.equal(gameRounds('3'), 3);
});

test('testing defaults unlock supported games at zero views, even without playable media; parent thresholds still apply', () => {
  assert.equal(gameStatus(['/series/new.mp4'], {}).requiredRounds, 0);
  assert.equal(gameStatus(['/series/new.mp4'], {}).unlocked, true);
  assert.equal(gameStatus([], {}, 0).unlocked, true);
  assert.equal(gameStatus(['/series/new.mp4'], {}, 2).unlocked, false);
  assert.equal(gameStatus([], {}, 2).unlocked, false);
});

test('a seek to the end does not unlock a full viewing; paused/resumed watch time survives storage', () => {
  let item = { completions: 0, durationMs: 60000 };
  recordGameWatch(item, 1500); finishGameWatch(item);
  assert.equal(gameCompletionCount(item), 0);
  for (let i = 0; i < 6; i++) recordGameWatch(item, 5000);
  item = JSON.parse(JSON.stringify(item));
  for (let i = 0; i < 6; i++) recordGameWatch(item, 5000);
  finishGameWatch(item); assert.equal(gameCompletionCount(item), 1);
  finishGameWatch(item); assert.equal(gameCompletionCount(item), 1);
  assert.equal(gameCompletionCount({ completions: 2 }), 2, 'retain legacy completed-play history');
  const empty = { durationMs: 0, completions: 0 }; recordGameWatch(empty, 5000); finishGameWatch(empty);
  assert.equal(gameCompletionCount(empty), 0);
});

test('series questions use the appropriate pack, unique rounds, three distinct pictures and one correct answer', () => {
  const entries = [{ title: 'WOW English' }, { title: '古力小超人' }, { title: 'Animals' }, { title: 'Colors' }, { title: 'Songs' }];
  for (const entry of entries) {
    assert.ok(gameDeck(entry));
    for (let seed = 0; seed < 15; seed++) {
      let value = seed + 1;
      const random = () => ((value = (value * 16807) % 2147483647) - 1) / 2147483646;
      const questions = createGame(entry, random);
      assert.equal(questions.length, ['guli','wow'].includes(gameDeck(entry)) ? 20 : gameContent.decks[gameDeck(entry)].questions.length);
      assert.equal(new Set(questions.map(q => q.id)).size, questions.length);
      for (const question of questions) { assert.equal(new Set(question.options).size, 3); assert.equal(question.options.filter(v => v === question.answer).length, 1); }
    }
  }
  assert.deepEqual(createGame({ title: 'An unrelated new series' }), []);
  assert.equal(gameDeck({ title: 'WOW English', source: 'baidu' }), null, 'a matching cloud title alone does not verify the question pack');
});

test('all game questions, feedback, artwork and English audio are available offline', () => {
  const captions = JSON.parse(readFileSync(new URL('../../public/game-audio/captions.json', import.meta.url)));
  for (const [id, question] of Object.entries(gameContent.questions)) {
    assert.doesNotMatch(question.prompt + question.feedback, /[\u3400-\u9fff]/);
    assert.equal(captions[id], question.prompt);
    assert.equal(captions[`yes-${question.answer}`], question.feedback);
    assert.match(question.feedback, /^Well done!/);
    for (const option of question.options) {
      assert.ok(gameContent.pictures[option]);
      assert.ok(statSync(new URL(`../../public/${gamePicture(option, question.series)}`, import.meta.url)).size > 100);
      assert.equal(captions[`wrong-${option}`], gameContent.wrongFeedback[option]);
      assert.match(captions[`wrong-${option}`], /^You are wrong\. This /);
      assert.doesNotMatch(captions[`wrong-${option}`], /[\u3400-\u9fff]/);
    }
  }
  for (const id of Object.keys(captions)) assert.ok(statSync(new URL(`../../public/game-audio/${id}.m4a`, import.meta.url)).size > 1000);
});

test('twenty-question rounds balance correct answers across all three positions without three consecutive repeats', () => {
  const observedOrders = new Set();
  for (const title of ['古力小超人', 'WOW English']) {
    for (let seed = 1; seed <= 100; seed++) {
      let value = seed;
      const random = () => ((value = (value * 16807) % 2147483647) - 1) / 2147483646;
      const questions = createGame({ title }, random);
      const positions = questions.map(question => question.options.indexOf(question.answer));
      const counts = [0, 1, 2].map(slot => positions.filter(position => position === slot).length);
      assert.deepEqual([...counts].sort(), [6, 7, 7]);
      for (let i = 2; i < positions.length; i++) assert.ok(positions[i] !== positions[i - 1] || positions[i] !== positions[i - 2]);
      observedOrders.add(positions.join(''));
    }
  }
  assert.ok(observedOrders.size > 50, 'positions change between rounds');
});

test('every real-series choice uses its own reviewed video screenshot, including distractors and quantities', () => {
  const catalog = JSON.parse(readFileSync(new URL('../../outputs/qa/game-resource-repair/catalog.json', import.meta.url)));
  for (const series of ['guli', 'wow']) {
    for (const id of gameContent.decks[series].questions) {
      const question = gameContent.questions[id];
      for (const option of question.options) {
        const picture = gameSourcePicture(option, series);
        assert.ok(picture, `${id}: missing series screenshot for ${option}`);
        assert.equal(picture.kind, 'video-frame');
        assert.match(gamePicture(option, series), new RegExp(`^game-stills/${series}/[a-z0-9-]+\\.jpg$`));
        assert.ok(statSync(new URL(`../../public/${picture.src}`, import.meta.url)).size > 2000);
        const source = catalog.files.find(file => file.id === picture.source.videoId);
        assert.equal(source?.kind, 'video'); assert.equal(source.name, picture.source.video);
        assert.equal(source.size, picture.source.bytes);
        assert.equal(source.name.includes('古力'), series === 'guli');
        assert.ok(picture.source.seconds >= 0); assert.ok(picture.width >= 80 && picture.height >= 80);
        const [left, top, right, bottom] = picture.source.crop;
        assert.ok(left >= 0 && top >= 0 && right <= 1 && bottom <= 1 && left < right && top < bottom);
      }
    }
  }
  assert.notEqual(gamePicture('apple', 'guli'), gamePicture('apple', 'wow'), 'shared words keep each series artwork');
  assert.match(gamePicture('cat'), /^game-art\/cat\.svg$/, 'retain introductory-pack artwork');
});

test('each real-series question has original video/time evidence and a clear original-or-adapted question form', () => {
  const catalog = JSON.parse(readFileSync(new URL('../../outputs/qa/game-resource-repair/catalog.json', import.meta.url)));
  for (const deckId of ['guli','wow']) {
    const deck = gameContent.decks[deckId]; assert.equal(deck.roundSize, 20); assert.equal(deck.words.length, 20);
    assert.equal(deck.sourceVideoCount, deckId === 'guli' ? 12 : 26);
    const forms = new Set();
    for (const id of deck.questions) {
      const question = gameContent.questions[id]; assert.equal(question.series, deckId); assert.ok(question.prompt.includes('?'));
      forms.add(question.prompt.split('?')[0].split(' ').slice(0, 2).join(' '));
      for (const source of [question.source.target, question.source.phrase]) {
        assert.ok(catalog.files.some(file => file.id === source.videoId && file.name === source.video));
        assert.ok(source.start >= 0 && source.end > source.start); assert.ok(source.quote.length > 0);
      }
      assert.ok(['original-question','adapted-question'].includes(question.source.questionKind));
    }
    assert.ok(forms.size >= 6, 'mix the series question forms and short phrases');
  }
  assert.equal(gameContent.pictureGroups['four-balloons'].count, 4);
});

test('speech completion waits for the actual end, and cancellation/errors never count as spoken feedback', async () => {
  const clips = [];
  const player = createGameSpeechPlayer(source => {
    const audio = { source, play: () => Promise.resolve(), pause() {}, removeAttribute() {}, load() {} };
    clips.push(audio); return audio;
  });
  let finished = false;
  const first = player.play('well-done.m4a').then(status => { finished = true; return status; });
  await Promise.resolve(); await Promise.resolve(); assert.equal(finished, false, 'starting audio is not completion');
  clips[0].onended(); assert.equal(await first, 'completed');
  const interrupted = player.play('wrong-banana.m4a'), lateEnd = clips[1].onended;
  const replacement = player.play('question.m4a'); assert.equal(await interrupted, 'cancelled');
  lateEnd(); player.stop(); assert.equal(await replacement, 'cancelled');
  const failed = player.play('missing.m4a'); clips[3].onerror(); assert.equal(await failed, 'error');
});
