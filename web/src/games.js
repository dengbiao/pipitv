import content from '../../public/game-content.json' with { type: 'json' };

export const DEFAULT_GAME_ROUNDS = 0; // Testing phase: games are available immediately.
export const GAME_ROUNDS = [0, 1, 2, 3, 4, 5];
export const gameRounds = value => GAME_ROUNDS.includes(Number(value)) ? Number(value) : DEFAULT_GAME_ROUNDS;
export const gameCompletionCount = item => Math.max(0, Math.floor(Number(item?.gameCompletions ?? item?.completions) || 0));
export function recordGameWatch(item, elapsedMs) {
  item.gameCompletions = gameCompletionCount(item);
  item.gameWatchedMs = Math.max(0, Number(item.gameWatchedMs) || 0) + Math.max(0, Math.min(5000, Number(elapsedMs) || 0));
}
export function finishGameWatch(item) {
  item.gameCompletions = gameCompletionCount(item);
  const duration = Number(item.durationMs) || 0;
  if (duration > 0 && (item.gameWatchedMs || 0) >= Math.max(duration * .95, duration - 1500)) item.gameCompletions++;
  item.gameWatchedMs = 0;
}
export function gameStatus(paths, items = {}, required = DEFAULT_GAME_ROUNDS) {
  const unique = [...new Set(paths)], requiredRounds = gameRounds(required);
  const completedRounds = unique.length ? Math.min(...unique.map(path => gameCompletionCount(items[path]))) : 0;
  return { requiredRounds, completedRounds, total: unique.length,
    readyItems: unique.filter(path => gameCompletionCount(items[path]) >= requiredRounds).length,
    unlocked: requiredRounds === 0 || (unique.length > 0 && completedRounds >= requiredRounds) };
}
export function gameDeck(entry) {
  if (entry?.gamePack === 'muzzy') return 'muzzy'; // Native catalog verification matches all 28 original file signatures.
  if (entry?.source === 'baidu') return null; // A matching title alone does not verify a cloud series' question pack.
  const name = `${entry?.title || ''} ${entry?.path || ''}`.toLowerCase();
  if (/wow/.test(name)) return 'wow';
  if (/古力|guli|superhero/.test(name)) return 'guli';
  if (/animal/.test(name)) return 'animals';
  if (/colo[u]?r/.test(name)) return 'colors';
  if (/song|action/.test(name)) return 'actions';
  return null;
}
function shuffle(values, random) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
}
export function createGame(entry, random = Math.random, setId) {
  const deck = content.decks[gameDeck(entry)];
  if (!deck) return [];
  const set = deck.sets?.find(item => item.id === setId) || (deck.sets?.length ? deck.sets[Math.floor(random() * deck.sets.length)] : null);
  const ids = shuffle(set?.questions || deck.questions, random).slice(0, Math.min(20, Math.max(1, deck.roundSize || 5)));
  // Random blocks balance left/middle/right across a round and prevent three
  // consecutive answers in one position. Retrying keeps the same picture order.
  const positions = Array.from({ length: Math.ceil(ids.length / 3) }, () => shuffle([0, 1, 2], random)).flat();
  return ids.map((id, index) => {
    const question = content.questions[id];
    const options = shuffle(question.options.filter(option => option !== question.answer), random);
    options.splice(positions[index], 0, question.answer);
    return { ...question, id, options, ...(set ? { setId: set.id } : {}) };
  });
}
export const gameName = entry => content.decks[gameDeck(entry)]?.label || 'Listen & Find';
export const gameWords = entry => content.decks[gameDeck(entry)]?.wordSummary || content.decks[gameDeck(entry)]?.words || [];
export const gameSourcePicture = (id, series, variant = 0) => {
  const picture = content.seriesPictures?.[series]?.[id];
  return (variant > 0 && picture?.variants?.[variant - 1]) || picture;
};
export const gamePicture = (id, series, variant = 0) => gameSourcePicture(id, series, variant)?.src || `game-art/${content.pictureGroups?.[id]?.picture || id}.svg`;
export const gamePictureGroup = id => content.pictureGroups?.[id];
export const gameAudio = id => `game-audio/${id}.m4a`;
export const gameAnswer = id => content.pictures[id];
export const wrongGameFeedback = id => content.wrongFeedback[id];
export const gameContent = content;
export const gameSets = entry => content.decks[gameDeck(entry)]?.sets || [];
