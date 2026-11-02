import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, SpeakerHigh, Star, Check, X, ArrowCounterClockwise } from '@phosphor-icons/react';
import { FocusButton } from './RemoteControls.jsx';
import { call } from './bridge.js';
import { createGame, gameAnswer, gameName, gamePicture, gamePictureGroup, gameSourcePicture, gameSets, wrongGameFeedback } from './games.js';
import { checkpointGameProgress, openGameProgress, progressQuestions } from './game-sessions.js';
import './games.css';

export function SeriesGame({ entry, preview, onClose }) {
  const multipleSets = gameSets(entry).length > 0;
  const [questions, setQuestions] = useState(() => multipleSets ? [] : createGame(entry));
  const [loading, setLoading] = useState(multipleSets), [loadError, setLoadError] = useState(''), [saveError, setSaveError] = useState('');
  const [roundLabel, setRoundLabel] = useState('');
  const [index, setIndex] = useState(0), [phase, setPhase] = useState('question');
  const [misses, setMisses] = useState([]), [message, setMessage] = useState('Listen. Look. Choose!');
  const [attempt, setAttempt] = useState(0), [selectedOption, setSelectedOption] = useState(null);
  const [audioFailed, setAudioFailed] = useState(false);
  const selected = useRef(false), audioVersion = useRef(0), feedback = useRef(null), mounted = useRef(true), loadVersion = useRef(0);
  const savedRound = useRef(null), question = questions[index], finished = !loading && questions.length > 0 && index >= questions.length;
  const saveProgress = async progress => {
    const result = preview ? { revision: 0, progress } : await call('saveGameProgress', { entryId: entry.id, expectedRevision: savedRound.current.revision, progress });
    savedRound.current = result;
    return result.progress;
  };
  const loadProgress = async () => {
    const version = ++loadVersion.current;
    feedback.current = null; selected.current = true; audioVersion.current++;
    call('stopGameAudio').catch(() => {}); setLoading(true); setLoadError(''); setSaveError('');
    try {
      let accepted;
      // StrictMode or a second view may finish the first save between get/save.
      // Re-read rather than overwrite the already persisted question order.
      for (let attempt = 0; attempt < 3; attempt++) {
        const record = preview ? savedRound.current || { revision: 0, progress: null } : await call('getGameProgress', { entryId: entry.id });
        if (!mounted.current || version !== loadVersion.current) return;
        savedRound.current = record;
        const progress = openGameProgress(entry, record.progress);
        try { accepted = await saveProgress(progress); break; }
        catch (error) { if (attempt === 2) throw error; }
      }
      if (!mounted.current || version !== loadVersion.current) return;
      const setNumber = gameSets(entry).findIndex(set => set.id === accepted.current.setId);
      setRoundLabel(`Set ${setNumber + 1} of ${gameSets(entry).length} · ${gameSets(entry)[setNumber].title}`);
      setQuestions(progressQuestions(accepted)); setIndex(accepted.current.index); setMisses(accepted.current.misses);
      setMessage(accepted.current.misses.length ? wrongGameFeedback(accepted.current.misses[accepted.current.misses.length - 1]) : 'Listen. Look. Choose!');
      setSelectedOption(null); setAttempt(0); setPhase('question'); setAudioFailed(false); setLoading(false);
    } catch {
      if (mounted.current && version === loadVersion.current) { setLoadError('Your saved game could not be opened. Please try again.'); setLoading(false); }
    }
  };
  const speak = async id => {
    const version = ++audioVersion.current;
    setAudioFailed(false);
    let status;
    try { status = await call('speakGame', { id }); } catch { status = 'error'; }
    if (version !== audioVersion.current) return 'cancelled';
    if (status === 'error') setAudioFailed(true);
    return status;
  };
  useEffect(() => {
    mounted.current = true;
    const hidden = () => { if (document.hidden) call('stopGameAudio').catch(() => {}); };
    document.addEventListener('visibilitychange', hidden);
    return () => { mounted.current = false; loadVersion.current++; audioVersion.current++; feedback.current = null; document.removeEventListener('visibilitychange', hidden); call('stopGameAudio').catch(() => {}); };
  }, []);
  useEffect(() => {
    if (multipleSets) loadProgress();
    return () => { loadVersion.current++; };
  }, [entry.id, preview]);
  useEffect(() => {
    if (loading || loadError || (!question && !finished)) return;
    selected.current = false;
    speak(finished ? 'all-done' : question.id);
  }, [index, questions, loading, loadError]);
  const finishFeedback = async response => {
    if (!response || response.saving) return;
    const status = response.spoken ? 'completed' : await speak(response.clip);
    if (feedback.current !== response) return;
    if (status !== 'completed') { setAudioFailed(true); return; }
    response.spoken = true;
    if (multipleSets) {
      response.saving = true; setSaveError('');
      try { await saveProgress(checkpointGameProgress(savedRound.current.progress, response.correct, response.option)); }
      catch { setSaveError('Your game could not be saved. Please try again.'); return; }
      finally { response.saving = false; }
      if (!mounted.current || feedback.current !== response) return;
    }
    feedback.current = null; selected.current = false; setSelectedOption(null);
    setPhase('question');
    if (response.correct) { setMessage('Listen. Look. Choose!'); setIndex(value => value + 1); setMisses([]); setAttempt(0); }
    else {
      setMisses(previous => [...previous, response.option]); setAttempt(value => value + 1);
      speak(response.questionId);
    }
  };
  const choose = option => {
    if (selected.current || phase !== 'question' || misses.includes(option)) return;
    selected.current = true; setSelectedOption(option);
    const correct = option === question.answer;
    setPhase(correct ? 'correct' : 'wrong'); setMessage(correct ? question.feedback : wrongGameFeedback(option));
    const response = { option, correct, questionId: question.id, clip: correct ? `yes-${option}` : `wrong-${option}` };
    feedback.current = response; finishFeedback(response);
  };
  const restart = () => { if (multipleSets) { loadProgress(); return; } feedback.current = null; setQuestions(createGame(entry)); setIndex(0); setPhase('question'); setMisses([]); setSelectedOption(null); setAttempt(0); setMessage('Listen. Look. Choose!'); };
  const firstAvailable = question?.options.findIndex(option => !misses.includes(option));
  const wrongResponse = phase === 'wrong' || (phase === 'question' && misses.length > 0);
  return <section className="series-game child-theme" lang="en" data-focus-scope="active" data-focus-key={`game:${entry.id}:${roundLabel}:${loading}:${index}:${phase}:${attempt}`} aria-label="Listen and Find" aria-busy={loading}>
    <header className="game-header">
      <FocusButton className="game-back" onClick={onClose} aria-label="Back to series"><ArrowLeft />Back</FocusButton>
      <div className="game-series-label">{gameName(entry)}{preview && <span>Preview</span>}{roundLabel && <small className="game-set-label">{roundLabel}</small>}</div>
      <span className="game-header-mark"><Star weight="duotone" />LISTEN & FIND</span>
    </header>
    {loading || loadError ? <div className="game-loading" role="status"><p>{loadError || 'Getting your game ready…'}</p>{loadError && <FocusButton className="secondary" data-autofocus onClick={loadProgress}>Try again</FocusButton>}</div> : finished ? <div className="game-finished" data-game-complete="true">
      <div className="game-celebration">{[0,1,2].map(i => <Star key={i} weight="fill" />)}</div>
      <span className="game-eyebrow">ALL DONE</span><h1>Lovely listening!</h1><p>You found {questions.length} pictures. Well done!</p>
      <div className="game-finish-actions"><FocusButton className="primary" data-autofocus onClick={restart}><ArrowCounterClockwise />Play again</FocusButton>
        <FocusButton className="secondary" onClick={onClose}>Back to series<ArrowRight /></FocusButton></div>
    </div> : <>
      <div className="game-progress" aria-label={`Question ${index + 1} of ${questions.length}`}>
        {questions.map((q,i) => <span key={q.id} className={i < index || (i === index && phase === 'correct') ? 'done' : i === index ? 'current' : ''}>{i < index || (i === index && phase === 'correct') ? <Check weight="bold" /> : i + 1}</span>)}
      </div>
      <div className="game-question"><span className="game-eyebrow">LITTLE LISTENING ADVENTURE</span>
        <h1>{question.prompt}</h1><FocusButton className="game-listen" disabled={phase !== 'question'} onClick={() => speak(question.id)} aria-label="Listen again"><SpeakerHigh weight="fill" />Listen again</FocusButton>
      </div>
      <div className="game-answers" role="group" aria-label="Choose a picture">{question.options.map((option,i) => <FocusButton
        key={`${question.id}:${option}`} focusId={`answer:${i}`} data-autofocus={(phase === 'question' ? i === firstAvailable : option === selectedOption) ? 'true' : undefined}
        aria-disabled={phase !== 'question' || misses.includes(option)} onClick={() => choose(option)} aria-label={`Picture ${i + 1}: ${gameAnswer(option)}`}
        className={`game-answer tone-${i} ${misses.includes(option) ? 'try-another' : ''} ${phase !== 'question' && option !== selectedOption ? 'is-muted' : ''} ${phase === 'correct' && option === selectedOption ? 'is-correct' : ''} ${misses.includes(option) || (phase === 'wrong' && option === selectedOption) ? 'is-wrong' : ''}`}>
        {(misses.includes(option) || (phase === 'wrong' && option === selectedOption)) && <span className="game-wrong-mark" role="img" aria-label="Wrong answer"><X weight="bold" aria-hidden="true" /></span>}
        {gamePictureGroup(option) && !gameSourcePicture(option, question.series, question.pictureVariants?.[option]) ? <div className={`game-picture-group count-${gamePictureGroup(option).count}`} role="img" aria-label={gameAnswer(option)}>
          {Array.from({ length: gamePictureGroup(option).count }, (_, n) => <img key={n} src={gamePicture(option)} alt="" draggable="false" />)}
        </div> : <img className={gameSourcePicture(option, question.series, question.pictureVariants?.[option]) ? 'game-source-picture' : undefined} src={gamePicture(option, question.series, question.pictureVariants?.[option])} alt={gameAnswer(option)} draggable="false" />}
        <span className="game-card-caption">{phase !== 'question' && option === selectedOption || misses.includes(option) ? <>{phase === 'correct' && option === selectedOption && <Check weight="bold" />}{gameAnswer(option)}</> : <span className="game-card-dot" />}</span>
      </FocusButton>)}</div>
      <div className={`game-response ${wrongResponse ? 'wrong' : phase}`} aria-live={wrongResponse ? 'assertive' : 'polite'} aria-atomic="true"><p>{wrongResponse
        ? <><strong className="game-response-status">You are wrong.</strong>{' '}<span className="game-response-detail">{message.replace(/^You are wrong\.\s*/, '')}</span></>
        : message}</p>
      </div>
      <footer className="game-remote-hint">Use <span>←</span><span>→</span> to choose · Press <strong>OK</strong> to pick</footer>
    </>}
    {audioFailed && <div className="game-audio-error" role="status">{feedback.current ? <><p>Sound was interrupted. Let's hear it again.</p><FocusButton className="secondary" data-autofocus onClick={() => finishFeedback(feedback.current)}><SpeakerHigh />Replay feedback</FocusButton></> : <p>Sound is unavailable. Please try “Listen again”.</p>}</div>}
    {saveError && <div className="game-audio-error" role="alert"><p>{saveError}</p><FocusButton className="secondary" data-autofocus onClick={() => finishFeedback(feedback.current)}>Try saving again</FocusButton></div>}
  </section>;
}
