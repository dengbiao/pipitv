// Resolve only when a recording actually ends; replacing/stopping it cancels the
// pending response so an old answer cannot advance a newer question.
export function createGameSpeechPlayer(createAudio = source => new Audio(source)) {
  let current = null;
  const stop = () => { current?.finish('cancelled'); };
  const play = source => {
    stop();
    return new Promise(resolve => {
      const audio = createAudio(source); let settled = false;
      const finish = status => {
        if (settled) return;
        settled = true; audio.onended = null; audio.onerror = null;
        audio.pause(); audio.removeAttribute('src'); audio.load();
        if (current?.audio === audio) current = null;
        resolve(status);
      };
      current = { audio, finish };
      audio.onended = () => finish('completed');
      audio.onerror = () => finish('error');
      try { Promise.resolve(audio.play()).catch(() => finish('error')); }
      catch { finish('error'); }
    });
  };
  return { play, stop };
}
