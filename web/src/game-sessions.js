import { createGame, gameContent, gameDeck, gameSets } from './games.js';

// Persist IDs and option order, rather than a copy of the question/artwork data.
export function validGameProgress(entry, progress) {
  const deck = gameContent.decks[gameDeck(entry)], sets = gameSets(entry);
  if (!deck || !sets.length || progress?.version !== deck.version || !Number.isSafeInteger(progress.cycle) || progress.cycle < 0) return false;
  if (!Array.isArray(progress.completedSets) || new Set(progress.completedSets).size !== progress.completedSets.length || progress.completedSets.some(id => !sets.some(set => set.id === id))) return false;
  const round = progress.current, set = sets.find(item => item.id === round?.setId);
  if (!set || !Array.isArray(round.questions) || round.questions.length !== set.questions.length || new Set(round.questions).size !== round.questions.length || round.questions.some(id => !set.questions.includes(id))) return false;
  if (!Number.isInteger(round.index) || round.index < 0 || round.index > round.questions.length) return false;
  if (progress.completedSets.includes(set.id) !== (round.index === round.questions.length)) return false;
  if (!round.options || Object.keys(round.options).length !== round.questions.length) return false;
  for (const id of round.questions) {
    const options = round.options[id], expected = gameContent.questions[id]?.options;
    if (!expected || !Array.isArray(options) || options.length !== expected.length || new Set(options).size !== options.length || options.some(option => !expected.includes(option))) return false;
  }
  const options = round.options[round.questions[round.index]] || [], answer = gameContent.questions[round.questions[round.index]]?.answer;
  return Array.isArray(round.misses) && round.misses.length <= 2 && new Set(round.misses).size === round.misses.length && round.misses.every(id => options.includes(id) && id !== answer);
}

export function openGameProgress(entry, stored, random = Math.random) {
  const deck = gameContent.decks[gameDeck(entry)], sets = gameSets(entry);
  if (!sets.length) throw new Error('This series has no question sets.');
  if (stored && !validGameProgress(entry, stored)) throw new Error('Your saved question set could not be read.');
  const progress = validGameProgress(entry, stored) ? structuredCopy(stored) : { version: deck.version, cycle: 0, completedSets: [], current: null };
  if (progress.current && progress.current.index < progress.current.questions.length) return progress;
  let remaining = sets.filter(set => !progress.completedSets.includes(set.id));
  if (!remaining.length) { progress.completedSets = []; progress.cycle++; remaining = sets; }
  const chosen = remaining[Math.min(remaining.length - 1, Math.floor(random() * remaining.length))];
  const questions = createGame(entry, random, chosen.id);
  progress.current = { setId: chosen.id, questions: questions.map(q => q.id), options: Object.fromEntries(questions.map(q => [q.id, q.options])), index: 0, misses: [] };
  return progress;
}

export function progressQuestions(progress) {
  return progress.current.questions.map(id => ({ ...gameContent.questions[id], id, setId: progress.current.setId, options: [...progress.current.options[id]] }));
}

export function checkpointGameProgress(progress, correct, option) {
  const next = structuredCopy(progress), round = next.current;
  if (round.index >= round.questions.length) return next;
  const question = gameContent.questions[round.questions[round.index]];
  if (correct) {
    if (option !== question.answer) throw new Error('The selected picture is not correct.');
    round.index++; round.misses = [];
    if (round.index === round.questions.length && !next.completedSets.includes(round.setId)) next.completedSets.push(round.setId);
  } else {
    if (!round.options[round.questions[round.index]]?.includes(option) || option === question.answer) throw new Error('Invalid picture choice.');
    if (!round.misses.includes(option)) round.misses.push(option);
  }
  return next;
}

export function validGameTransition(entry, previous, next) {
  if (!validGameProgress(entry, next)) return false;
  const round = next.current;
  if (!previous) return next.cycle === 0 && !next.completedSets.length && round.index === 0 && !round.misses.length;
  if (!validGameProgress(entry, previous)) return false;
  const old = previous.current, same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  if (old.index < old.questions.length) {
    if (round.setId !== old.setId || next.cycle !== previous.cycle || !same(round.questions, old.questions) || old.questions.some(id => !same(round.options[id], old.options[id]))) return false;
    if (round.index === old.index) return same(next.completedSets, previous.completedSets) && round.misses.length <= old.misses.length + 1 && old.misses.every(id => round.misses.includes(id));
    if (round.index !== old.index + 1 || round.misses.length) return false;
    return same(next.completedSets, round.index === round.questions.length ? [...previous.completedSets, round.setId] : previous.completedSets);
  }
  if (round.index !== 0 || round.misses.length) return false;
  if (previous.completedSets.length === gameSets(entry).length) return next.cycle === previous.cycle + 1 && !next.completedSets.length;
  return next.cycle === previous.cycle && same(next.completedSets, previous.completedSets) && !previous.completedSets.includes(round.setId);
}

// Hisense Chromium 83 has no structuredClone.
const structuredCopy = value => JSON.parse(JSON.stringify(value));
