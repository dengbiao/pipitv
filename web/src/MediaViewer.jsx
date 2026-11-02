import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Clock, ListBullets, Pause, Play, X, FilmStrip } from '@phosphor-icons/react';
import { clockText } from './logic.js';
import { call } from './bridge.js';
import { DEFAULT_PLAYBACK_MODE, MODE_LABELS } from './playback.js';
import { PlaybackClock } from './playback-stats.js';
import recordingCrops from '../../public/recording-crops.json';
import { mediaSummary } from './content-labels.js';
import { episodePreview } from './episode-previews.js';
import { focusRemote, remoteKey } from './remoteNavigation.js';

const mediaTime = seconds => {
  const total = Math.max(0, Math.floor(seconds || 0));
  const minutes = Math.floor(total / 60), remainder = String(total % 60).padStart(2, '0');
  return minutes >= 60 ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${remainder}`
    : `${String(minutes).padStart(2, '0')}:${remainder}`;
};

function EpisodeCard({ file, index, current, entryId, cover, disabled, onSelect }) {
  const row = useRef(null), [preview, setPreview] = useState(null);
  useEffect(() => {
    let alive = true, loading = false;
    const load = () => {
      if (loading) return; loading = true;
      episodePreview(file, entryId).then(value => { if (alive) setPreview(value); });
    };
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { load(); observer.disconnect(); }
    }, { root: row.current.closest('.episode-list'), rootMargin: '100px' });
    observer.observe(row.current);
    return () => { alive = false; observer.disconnect(); };
  }, [entryId, file.path]);
  return <button ref={row} className={`episode-card ${current ? 'is-playing' : ''}`} data-focusable="true"
    data-focus-id={`episode:${file.path}`} data-autofocus={current || undefined} aria-current={current ? 'true' : undefined}
    aria-label={`第${index + 1}集 ${file.name}${current ? '，正在播放' : ''}`} disabled={disabled} onClick={onSelect}>
    <span className="episode-art">
      {preview?.image ? <img src={preview.image} alt="" /> : file.kind === 'audio' ? <img src={cover} alt="" />
        : <span className="episode-art-fallback"><FilmStrip /><small>{preview ? '暂无预览' : '读取预览…'}</small></span>}
      {!!preview?.duration && <small className="episode-duration">{mediaTime(preview.duration)}</small>}
    </span>
    <span className="episode-copy"><span className="episode-number">第 {index + 1} 集{current && <em>正在播放</em>}</span>
      <strong>{file.name.replace(/\.[^.]+$/, '')}</strong><small>{mediaSummary(file) || (file.kind === 'audio' ? '音频' : '')}</small></span>
  </button>;
}

export function MediaViewer({ player, remain, cover, onBack, onSelect, onComplete, onLimit }) {
  const surface = useRef(null), media = useRef(null), progress = useRef(null), firstAction = useRef(null);
  const hideTimer = useRef(null), menuOpen = useRef('hidden'), dragging = useRef(false);
  const [panel, setPanel] = useState('hidden'), [paused, setPaused] = useState(false);
  const [position, setPosition] = useState(0), [duration, setDuration] = useState(0), [error, setError] = useState('');
  const changing = useRef(false);
  const started = useRef(false), finished = useRef(false), lastSaved = useRef(0);
  const flushPlaybackTime = useRef(() => {});
  const [switching, setSwitching] = useState(false), [ended, setEnded] = useState(false);
  const [completionMessage, setCompletionMessage] = useState('');
  const episodes = player.episodes || [player], episodeIndex = episodes.findIndex(item => item.path === player.path);
  const recording = recordingCrops.recordings.find(source => source.name === player.name && source.bytes === player.size);
  const cropTop = Math.max(0, Math.min(.15, recording?.cropTop || 0));
  const timed = player.kind === 'video' || player.kind === 'audio';
  useEffect(() => {
    const element = media.current;
    if (!timed || !element) return;
    const clock = new PlaybackClock(); let pending = 0;
    const active = () => !document.hidden && !element.paused && !element.ended && !element.seeking && element.readyState >= 3;
    const reset = () => clock.reset(performance.now(), element.currentTime * 1000, active());
    const flush = (force = false, stop = false) => {
      pending += clock.sample(performance.now(), element.currentTime * 1000, !stop && active());
      if (pending >= 2000 || (force && pending > 0)) {
        while (pending > 0) {
          const elapsedMs = Math.min(5000, pending); pending -= elapsedMs;
          call('recordPlaybackTime', { entryId: player.entry.id, path: player.path, elapsedMs }).catch(() => {});
        }
      }
    };
    const boundary = () => flush(true), seek = () => { reset(); clock.active = false; };
    const stop = () => flush(true, true);
    const start = () => { flush(true); reset(); };
    flushPlaybackTime.current = boundary; reset();
    const timer = setInterval(flush, 500);
    element.addEventListener('playing', start); element.addEventListener('pause', boundary);
    element.addEventListener('waiting', stop); element.addEventListener('ended', boundary);
    element.addEventListener('seeking', seek); element.addEventListener('seeked', reset);
    element.addEventListener('error', stop); document.addEventListener('visibilitychange', boundary);
    window.addEventListener('pagehide', stop);
    return () => {
      stop(); clearInterval(timer); flushPlaybackTime.current = () => {};
      element.removeEventListener('playing', start); element.removeEventListener('pause', boundary);
      element.removeEventListener('waiting', stop); element.removeEventListener('ended', boundary);
      element.removeEventListener('seeking', seek); element.removeEventListener('seeked', reset);
      element.removeEventListener('error', stop); document.removeEventListener('visibilitychange', boundary);
      window.removeEventListener('pagehide', stop);
    };
  }, [player.entry.id, player.path, player.kind, timed]);
  const saveProgress = useCallback((element, force = false) => {
    if (!element || !started.current || finished.current || !Number.isFinite(element.duration)) return;
    if (!force && Date.now() - lastSaved.current < 2000) return;
    lastSaved.current = Date.now();
    call('savePlayback', { entryId: player.entry.id, path: player.path,
      positionMs: Math.round(element.currentTime * 1000), durationMs: Math.round(element.duration * 1000) }).catch(() => {});
  }, [player.entry.id, player.path]);
  const hideMenu = useCallback(() => {
    clearTimeout(hideTimer.current); menuOpen.current = 'hidden'; setPanel('hidden'); focusRemote(surface.current);
  }, []);
  const scheduleHide = useCallback(() => {
    clearTimeout(hideTimer.current);
    if (dragging.current || finished.current || ['episodes', 'hidden'].includes(menuOpen.current)) return;
    if (menuOpen.current === 'hud' && media.current?.paused) return;
    hideTimer.current = setTimeout(() => {
      if (finished.current) return;
      if (media.current?.paused) { menuOpen.current = 'hud'; setPanel('hud'); focusRemote(surface.current); }
      else hideMenu();
    }, 5000);
  }, [hideMenu]);
  const showMenu = useCallback(() => {
    menuOpen.current = 'menu'; setPanel('menu'); scheduleHide();
  }, [scheduleHide]);
  const toggleMenu = useCallback(() => { if (['menu', 'episodes'].includes(menuOpen.current)) hideMenu(); else showMenu(); }, [hideMenu, showMenu]);
  const showHud = useCallback(() => {
    menuOpen.current = 'hud'; setPanel('hud'); focusRemote(surface.current); scheduleHide();
  }, [scheduleHide]);
  const showEpisodes = () => { clearTimeout(hideTimer.current); menuOpen.current = 'episodes'; setPanel('episodes'); };
  const togglePlayback = useCallback(() => {
    const element = media.current;
    if (element && !error && !changing.current && remain > 0) {
      if (element.paused) {
        if (element.ended) element.currentTime = 0;
        setCompletionMessage(''); setEnded(false); element.play().catch(() => setError('暂时无法播放，请返回列表后重试。'));
      }
      else element.pause();
    }
    if (menuOpen.current !== 'episodes') showHud();
  }, [showHud, error, remain]);
  const selectEpisode = async file => {
    if (file.path === player.path) { hideMenu(); return true; }
    if (changing.current || remain <= 0) return false;
    changing.current = true; setSwitching(true); media.current?.pause();
    saveProgress(media.current, true);
    try { return await onSelect(file); }
    finally { changing.current = false; setSwitching(false); }
  };
  const completeEpisode = async () => {
    if (finished.current) return;
    flushPlaybackTime.current();
    finished.current = true;
    setPaused(true); setEnded(true);
    try {
      await call('completePlayback', { entryId: player.entry.id, path: player.path });
      const advanced = remain > 0 && await onComplete();
      if (!advanced) { setCompletionMessage(player.mode === 'spaced' ? '今天的复习完成啦' : '这个系列播完啦'); showMenu(); }
    } catch (error) { setError(error.message); showMenu(); }
  };
  const seekTo = useCallback(value => {
    const element = media.current;
    if (!element || !Number.isFinite(element.duration)) return;
    flushPlaybackTime.current();
    element.currentTime = Math.max(0, Math.min(element.duration - 0.1, value));
    setPosition(element.currentTime); scheduleHide();
  }, [scheduleHide]);
  useEffect(() => {
    const viewer = surface.current;
    viewer.focus({ preventScroll: true });
    // Browsers may decline fullscreen without a recent user gesture; the canvas still fills the viewport.
    viewer.requestFullscreen?.().catch(() => {});
    return () => {
      clearTimeout(hideTimer.current);
      if (document.fullscreenElement === viewer) document.exitFullscreen?.().catch(() => {});
    };
  }, []);
  useEffect(() => {
    if (panel === 'menu') focusRemote(firstAction.current);
  }, [panel]);
  useEffect(() => {
    hideMenu(); dragging.current = false;
    started.current = false; finished.current = false; lastSaved.current = 0;
    setPosition(0); setDuration(0); setError(''); setPaused(false); setEnded(false); setCompletionMessage('');
  }, [player.path]);
  useEffect(() => { const element = media.current; return () => saveProgress(element, true); }, [player.path, saveProgress]);
  useEffect(() => {
    const expiry = setTimeout(() => { media.current?.pause(); onLimit(); }, Math.max(0, remain));
    return () => clearTimeout(expiry);
  }, [remain, onLimit, player.path]);
  useEffect(() => {
    const handleKey = event => {
      if (event.altKey || event.metaKey || event.ctrlKey) return;
      const key = remoteKey(event);
      const consume = () => { event.preventDefault(); event.stopImmediatePropagation(); };
      if (key === 'ContextMenu' || key === 'Menu' || key === 'F10' || event.keyCode === 82) {
        consume(); if (!event.repeat) toggleMenu(); return;
      }
      if (['Escape', 'BrowserBack', 'GoBack'].includes(key)) {
        consume(); if (!event.repeat) {
          if (menuOpen.current === 'episodes') showMenu();
          else if (menuOpen.current !== 'hidden') hideMenu();
          else onBack();
        } return;
      }
      if (key === 'MediaPlayPause' || key === ' ') {
        consume(); if (!event.repeat && timed) togglePlayback(); return;
      }
      if (menuOpen.current === 'episodes') {
        if (key === 'ArrowLeft') { consume(); if (!event.repeat) showMenu(); }
        return;
      }
      if (menuOpen.current === 'menu') { scheduleHide(); return; }
      if (key === 'Enter') { consume(); if (!event.repeat) { if (timed) togglePlayback(); else showMenu(); } return; }
      if (key === 'ArrowDown') { consume(); if (!event.repeat) showMenu(); return; }
      if (key === 'ArrowUp') { consume(); if (!event.repeat && timed) showHud(); return; }
      if (timed && ['ArrowLeft', 'ArrowRight'].includes(key)) {
        consume(); seekTo((media.current?.currentTime || 0) + (key === 'ArrowRight' ? 10 : -10)); showHud();
      }
    };
    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [hideMenu, onBack, scheduleHide, seekTo, showMenu, showHud, timed, toggleMenu, togglePlayback]);
  const mediaEvents = {
    ref: media, src: player.src, autoPlay: true,
    onLoadedMetadata: event => {
      const element = event.currentTarget, saved = (player.positionMs || 0) / 1000;
      if (saved > 0 && saved < element.duration - .5) element.currentTime = saved;
      setDuration(element.duration); setPosition(element.currentTime);
    },
    onTimeUpdate: event => { setPosition(event.currentTarget.currentTime); saveProgress(event.currentTarget); },
    onPlay: () => {
      if (!started.current || finished.current) {
        const reset = finished.current || !!player.reset; started.current = true; finished.current = false;
        call('startPlayback', { entryId: player.entry.id, path: player.path, reset }).catch(error => setError(error.message));
      }
      setPaused(false); setEnded(false);
      if (menuOpen.current !== 'hidden') scheduleHide();
    }, onPause: event => { setPaused(true); saveProgress(event.currentTarget, true); }, onEnded: completeEpisode,
    onError: () => setError('当前设备暂时无法播放这个格式，请返回列表选择其他内容。'),
  };
  return <section ref={surface} className={`player-overlay immersive-player child-theme kind-${player.kind}`} data-focus-scope="active" data-focus-key={`player:${player.path}:${panel === 'menu' ? 'menu' : 'canvas'}`}
    data-autofocus={panel !== 'menu' || undefined} tabIndex={-1} role="dialog" aria-modal="true" aria-label="全屏内容播放器"
    onContextMenu={event => { event.preventDefault(); toggleMenu(); }}>
    <div className="immersive-content" onClick={timed ? togglePlayback : toggleMenu}>
      {error ? <p className="playback-error" role="alert">{error}<br /><span>按返回键回到列表</span></p>
        : player.kind === 'image' ? <img className="full-picture" src={player.src} alt={player.name} onError={() => setError('这张图片暂时无法打开。')} />
        : player.kind === 'pdf' ? <object data={`${player.src}#toolbar=0&navpanes=0`} type="application/pdf" className="pdf-view"><p>当前浏览器无法预览此 PDF。</p></object>
        : player.kind === 'audio' ? <div className="audio-player"><img src={cover} alt="" /><audio key={player.path} {...mediaEvents} /></div>
        : <video key={player.path} {...mediaEvents} playsInline style={cropTop ? { position: 'absolute', left: 0,
          top: `${-100 * cropTop / (1 - cropTop)}%`, width: '100%', height: `${100 / (1 - cropTop)}%`,
          objectFit: 'cover', objectPosition: 'center bottom' } : undefined} />}
    </div>
    {completionMessage && ended && !error && <div className="playback-completion" role="status" aria-label="播放完成">
      <h2>{completionMessage}</h2><p>可以重新播放或选集，按返回键逐层退出。</p>
    </div>}
    {['hud', 'menu'].includes(panel) && <div className={`playback-menu ${panel === 'hud' ? 'playback-hud' : ''}`} aria-label={panel === 'menu' ? '播放菜单' : '播放进度'} onPointerDownCapture={scheduleHide}>
      <div className="playback-info"><div><h2>{player.name.replace(/\.[^.]+$/, '')}</h2>
        {timed && <small>第 {episodeIndex + 1} / {episodes.length} 集 · {MODE_LABELS[player.mode] || MODE_LABELS[DEFAULT_PLAYBACK_MODE]}</small>}</div>
        <span><Clock size={22} />剩余可用 {clockText(remain)}</span></div>
      {timed && !error && <div className="playback-timeline">
        <span className="playback-state" role="status">{paused ? <Pause weight="fill" /> : <Play weight="fill" />}<span>{ended ? '已播完' : paused ? '已暂停' : '播放中'}</span></span>
        <span>{mediaTime(position)}</span><input ref={progress} type="range" aria-label="播放进度" tabIndex={panel === 'menu' ? 0 : -1} min="0" max={Number.isFinite(duration) ? duration : 0} step="0.1"
          value={position} onChange={event => seekTo(Number(event.target.value))}
          onKeyDown={event => {
            if (!['ArrowLeft', 'ArrowRight'].includes(remoteKey(event))) return;
            event.preventDefault(); event.stopPropagation();
            seekTo((media.current?.currentTime || 0) + (remoteKey(event) === 'ArrowRight' ? 10 : -10));
          }}
          onPointerDown={() => { dragging.current = true; clearTimeout(hideTimer.current); }}
          onPointerUp={() => { dragging.current = false; scheduleHide(); }} onPointerCancel={() => { dragging.current = false; scheduleHide(); }} />
        <span>{mediaTime(duration)}</span>
      </div>}
      {panel === 'menu' ? <div className="playback-actions">
        {timed && <button ref={firstAction} data-autofocus data-focusable="true" className="playback-action" onClick={showEpisodes}><ListBullets />选集<span className="action-detail">{episodeIndex + 1} / {episodes.length}</span></button>}
        {ended && !error && <button data-focusable="true" className="playback-action" onClick={togglePlayback}><Play weight="fill" />重新播放</button>}
        {!timed && <button ref={firstAction} data-autofocus data-focusable="true" className="playback-action" onClick={hideMenu}><X />收起</button>}
        <p>OK 确认<span>返回 收起菜单</span></p>
      </div> : <p className="playback-key-hint">OK {paused ? '继续播放' : '暂停'}<span>← → 快退 / 快进</span><span>菜单 / ↓ 更多</span></p>}
    </div>}
    {panel === 'episodes' && <aside className="episode-drawer" data-focus-scope="active" data-focus-key={`episodes:${player.path}`}
      role="dialog" aria-modal="true" aria-label="选集">
      <header><div><h2>选集 <small>共 {episodes.length} 集</small></h2><p>{player.entry.title}</p></div>
        <button className="episode-close" data-focusable="true" aria-label="收起选集" onClick={showMenu}><X /></button></header>
      <div className="episode-list" data-focus-grid="true">{episodes.map((file, index) => <EpisodeCard key={file.path} file={file} index={index}
        entryId={player.entry.id} current={file.path === player.path} cover={cover} disabled={switching}
        onSelect={() => selectEpisode(file)} />)}</div>
      <p className="episode-drawer-hint">{switching ? '正在切换…' : '↑ ↓ 选择　OK 播放　返回 收起'}</p>
    </aside>}
  </section>;
}
