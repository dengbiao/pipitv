import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Clock, LockKey, SpeakerHigh, FolderSimple, FileVideo, FileAudio, FileImage, FilePdf,
  Plus, X, PencilSimple, Eye, EyeSlash, Check, ArrowLeft, ArrowRight, House, ShieldCheck, Usb,
  HardDrive, Backspace, ArrowCounterClockwise, GameController, SquaresFour, Cloud, Trash } from '@phosphor-icons/react';
import { call, importFiles, isNative } from './bridge.js';
import { clockText, episodeQueue } from './logic.js';
import { entrySummary, mediaSummary } from './content-labels.js';
import { useRemoteBack, useRemoteNavigation } from './remoteNavigation.js';
import { FocusButton, ParentGate, RemoteSelect, RemoteTextField } from './RemoteControls.jsx';
import { MediaViewer } from './MediaViewer.jsx';
import { PLAYBACK_MODES, MODE_LABELS, DEFAULT_PLAYBACK_MODE } from './playback.js';
import { playbackTimeText } from './playback-stats.js';
import { SeriesGame } from './SeriesGame.jsx';
import { DEFAULT_GAME_ROUNDS, GAME_ROUNDS, gameDeck, gameWords } from './games.js';
import './playback.css';
import './parent.css';
import { dailyRestReminder } from './rest-reminders.js';
import { visibleEntries } from './content-catalog.js';
import { createSettingsAutosave } from './settings-autosave.js';
import { TvAppSettings, TvAppShelf } from './TvApps.jsx';
import { BaiduSettings } from './BaiduSettings.jsx';
import { CatalogCleanup } from './CatalogCleanup.jsx';
import '@fontsource/nunito/600.css';
import '@fontsource/nunito/800.css';
import '@fontsource/nunito/900.css';

const artwork = value => {
  if (isNative && value?.mediaCover && value.id) return `covers/${encodeURIComponent(value.id)}.jpg?v=${value.lastPlayedAt || 0}`;
  const key = typeof value === 'string' ? value : value?.cover;
  return `art/${['animals', 'colors', 'songs'].includes(key) ? key : 'animals'}-wide.png`;
};
function CoverImage({ entry, src, ...props }) {
  const requested = src || artwork(entry), [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [requested]);
  return <img {...props} src={failed ? artwork(entry?.cover) : requested} onError={() => setFailed(true)} />;
}
const kindNames = { folder: '文件夹', video: '视频', audio: '音频', image: '图片', pdf: '绘本 PDF' };
const KindIcon = ({ kind, ...props }) => {
  const Component = { folder: FolderSimple, video: FileVideo, audio: FileAudio, image: FileImage, pdf: FilePdf }[kind] || FolderSimple;
  return <Component weight="duotone" {...props} />;
};

export function App() {
  const [snapshot, setSnapshot] = useState(null);
  const [view, setView] = useState('home');
  const [parentTab, setParentTab] = useState('entries');
  const [entrySource, setEntrySource] = useState('local');
  const [removingEntry, setRemovingEntry] = useState(null);
  const [gate, setGate] = useState(false);
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [entry, setEntry] = useState(null);
  const [stack, setStack] = useState([]);
  const [listing, setListing] = useState(null);
  const [listedPath, setListedPath] = useState(null);
  const [mediaTarget, setMediaTarget] = useState('');
  const [mediaVisit, setMediaVisit] = useState(0);
  const openingEntry = useRef(false);
  const pendingLibraryPlayback = useRef(null);
  const cancelLibraryPlayback = useCallback(() => {
    const pending = pendingLibraryPlayback.current;
    pendingLibraryPlayback.current = null;
    pending?.resolve(false);
  }, []);
  const [loading, setLoading] = useState(false);
  const [player, setPlayer] = useState(null);
  const [game, setGame] = useState(null);
  const openingGame = useRef(false);
  const playVersion = useRef(0);
  const [restVisible, setRestVisible] = useState(false);
  const restReminder = dailyRestReminder();
  const [editing, setEditing] = useState(null);
  const [picker, setPicker] = useState(false);
  const [draftSettings, setDraftSettings] = useState(null);
  const settingsAutosave = useRef(null);
  const appWrite = useRef(null), openingTvApp = useRef(false);
  const [launchingApp, setLaunchingApp] = useState(false);
  const gateVersion = useRef(0);
  const showGate = useCallback(() => { gateVersion.current++; setGate(true); }, []);
  const closeGate = useCallback(() => { gateVersion.current++; setGate(false); }, []);
  const toastTimer = useRef(null);
  const refreshing = useRef(null);
  const notify = useCallback(message => {
    setError(message); clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setError(''), 6500);
  }, []);
  const refresh = useCallback(() => {
    if (refreshing.current) return refreshing.current;
    refreshing.current = (async () => {
      try { const data = await call('getState'); setSnapshot(data); return data; }
      catch (e) { notify(e.message); return null; }
      finally { refreshing.current = null; }
    })();
    return refreshing.current;
  }, [notify]);
  useEffect(() => {
    const resume = () => { if (!document.hidden && !openingEntry.current) refresh(); };
    resume(); const id = setInterval(resume, 1000);
    const restDue = async () => { const data = await refresh(); if (data?.access.reason) setRestVisible(true); };
    window.addEventListener('focus', resume); window.addEventListener('pipi-resume', resume);
    window.addEventListener('pipi-rest-due', restDue);
    return () => { clearInterval(id); clearTimeout(toastTimer.current); window.removeEventListener('focus', resume); window.removeEventListener('pipi-resume', resume); window.removeEventListener('pipi-rest-due', restDue); };
  }, [refresh]);
  useEffect(() => {
    if (snapshot?.access.reason && (view === 'media' || player || (game && !game.preview))) {
      playVersion.current++;
      setPlayer(null); setGame(null); call('endGame').catch(() => {}); setRestVisible(true); call('setLearning', { active: false }).catch(() => {});
    }
  }, [snapshot?.access.reason, view, player, game]);
  useEffect(() => {
    if (snapshot?.externalRestDue && snapshot?.access.reason) {
      cancelLibraryPlayback(); playVersion.current++;
      setPlayer(null); setGame(null); setEditing(null); setPicker(false); setToken('');
      setView('home'); setStack([]); setRestVisible(true);
      call('endGame').catch(() => {}); call('setLearning', { active: false }).catch(() => {});
    }
  }, [snapshot?.externalRestDue, snapshot?.access.reason, cancelLibraryPlayback]);
  useEffect(() => {
    if (!restVisible) return;
    const stop = () => { call('stopRestReminder').catch(() => {}); };
    const timer = setTimeout(() => {
      if (!document.hidden) call('announceRest', { id: restReminder.id }).catch(() => {});
    }, 0);
    const visibility = () => { if (document.hidden) { clearTimeout(timer); stop(); } };
    document.addEventListener('visibilitychange', visibility);
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', visibility); stop(); };
  }, [restVisible, restReminder.id]);
  useEffect(() => { if (gate) call('stopRestReminder').catch(() => {}); }, [gate]);
  useEffect(() => () => { if (player?.src?.startsWith('blob:')) URL.revokeObjectURL(player.src); }, [player]);
  const mediaPath = stack[stack.length - 1]?.path;
  useEffect(() => {
    if (view !== 'media' || !mediaPath) return;
    let cancelled = false; setLoading(true); setListing(null);
    call('list', { path: mediaPath }).then(data => { if (!cancelled) { setListing(data); setListedPath(mediaPath); } })
      .catch(e => { if (!cancelled) { setListedPath(mediaPath); notify(e.message); } }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [view, mediaPath, notify]);
  useEffect(() => {
    const pending = pendingLibraryPlayback.current;
    if (!pending || view !== 'media' || mediaPath !== pending.path || loading || listedPath !== mediaPath) return;
    if (!listing) { cancelLibraryPlayback(); return; }
    // Native playback pauses WebView rendering. Paint the return destination and
    // its selected file first so Back cannot expose the previous home frame.
    let paintedFrame;
    const firstFrame = requestAnimationFrame(() => {
      paintedFrame = requestAnimationFrame(() => {
        if (pendingLibraryPlayback.current !== pending) return;
        pendingLibraryPlayback.current = null;
        pending.resolve(true);
      });
    });
    return () => { cancelAnimationFrame(firstFrame); cancelAnimationFrame(paintedFrame); };
  }, [view, mediaPath, mediaVisit, loading, listedPath, listing, cancelLibraryPlayback]);
  useEffect(() => cancelLibraryPlayback, [cancelLibraryPlayback]);
  const goHome = useCallback(() => {
    cancelLibraryPlayback();
    playVersion.current++;
    setPlayer(null); setGame(null); call('endGame').catch(() => {}); setView('home'); setStack([]); setRestVisible(false);
    call('setLearning', { active: false }).then(refresh).catch(e => notify(e.message));
  }, [refresh, notify, cancelLibraryPlayback]);
  const leaveParent = useCallback(async () => {
    await settingsAutosave.current?.flush();
    while (appWrite.current) await appWrite.current.catch(() => {});
    setEditing(null); setPicker(false); setView('home'); setToken('');
    call('leaveParent').then(refresh).catch(e => notify(e.message));
  }, [refresh, notify]);
  const closeGame = useCallback(() => {
    setGame(null); call('endGame').then(refresh).catch(e => notify(e.message));
  }, [refresh, notify]);
  const back = useCallback(() => {
    cancelLibraryPlayback();
    if (gate) closeGate();
    else if (picker) setPicker(false);
    else if (editing) setEditing(null);
    else if (game) closeGame();
    else if (player) { playVersion.current++; setPlayer(null); if (view === 'home') call('setLearning', { active: false }).catch(e => notify(e.message)); }
    else if (view === 'parent') leaveParent();
    else if (restVisible) goHome();
    else if (view === 'media' && stack.length > 1) setStack(items => items.slice(0, -1));
    else if (view === 'media') goHome();
  }, [gate, picker, editing, game, closeGame, player, view, restVisible, stack.length, leaveParent, goHome, notify, closeGate, cancelLibraryPlayback]);
  useRemoteNavigation(back);
  const openFile = async (file, sourceEntry = entry, episodes = null, reset = false) => {
    const version = ++playVersion.current;
    let resolved;
    try {
      if (isNative) { await call('play', { path: file.path, title: file.name || sourceEntry.title, entryId: sourceEntry.id, preparationMs: Math.round(file.preparationMs || 0) }); return true; }
      resolved = await call('resolveMedia', { path: file.path, entryId: sourceEntry.id });
      if (!episodes && ['video', 'audio'].includes(resolved.kind)) episodes = (await call('planPlayback', { entryId: sourceEntry.id })).episodes;
      const data = await call('getState');
      if (version !== playVersion.current) { if (resolved.src?.startsWith('blob:')) URL.revokeObjectURL(resolved.src); return false; }
      setSnapshot(data);
      if (data.access.reason) {
        if (resolved.src?.startsWith('blob:')) URL.revokeObjectURL(resolved.src);
        setPlayer(null); setRestVisible(true); await call('setLearning', { active: false }); return false;
      }
      setPlayer({ ...resolved, positionMs: reset ? 0 : resolved.positionMs, reset, mode: data.playback?.[sourceEntry.id]?.mode || DEFAULT_PLAYBACK_MODE, cover: sourceEntry.cover, entry: sourceEntry,
        episodes: episodes || episodeQueue(sourceEntry.kind === 'folder' ? listing?.items : [], resolved) });
      return true;
    } catch (e) {
      if (resolved?.src?.startsWith('blob:')) URL.revokeObjectURL(resolved.src);
      if (version === playVersion.current) notify(e.message);
      return false;
    }
  };
  const completeEpisode = async () => {
    const version = playVersion.current;
    try {
      const plan = await call('planPlayback', { entryId: player.entry.id, restart: false });
      if (version !== playVersion.current || !plan.path) return false;
      return await openFile(plan, player.entry, plan.episodes || player.episodes, plan.reason !== 'resume');
    } catch (error) { if (version === playVersion.current) notify(error.message); return false; }
  };
  const showLibrary = (item, target = '', waitForPaint = false) => {
    cancelLibraryPlayback();
    setEntry(item); setLoading(true); setListing(null); setListedPath(null); setMediaTarget(target);
    const parts = [{ path: item.path, name: item.title }];
    if (target.startsWith(item.path + '/')) {
      const folders = target.slice(item.path.length + 1).split('/').slice(0, -1);
      for (const name of folders) parts.push({ path: parts[parts.length - 1].path + '/' + name, name });
    }
    if (target) setMediaVisit(value => value + 1);
    setStack(parts); setView('media');
    if (waitForPaint) return new Promise(resolve => { pendingLibraryPlayback.current = { path: parts.at(-1).path, resolve }; });
  };
  const browseEntry = async item => {
    if (snapshot?.access.reason) { setRestVisible(true); return; }
    try { await call('setLearning', { active: true }); showLibrary(item); }
    catch (error) { notify(error.message); }
  };
  const openEntry = async item => {
    if (openingEntry.current) return;
    if (snapshot?.access.reason) { setRestVisible(true); return; }
    openingEntry.current = true;
    const requestedAt = performance.now();
    try {
      if (!['folder', 'video', 'audio'].includes(item.kind)) { await call('setLearning', { active: true }); await openFile({ path: item.path, name: item.title }, item); return; }
      const plan = await call('planPlayback', { entryId: item.id });
      if (!plan.path) {
        if (item.kind === 'folder') await browseEntry(item);
        else notify(plan.reason === 'empty' ? '暂时找不到内容，请家长检查资源。' : '这个内容已播放完成。');
        return;
      }
      await call('setLearning', { active: true }); setEntry(item);
      if (item.kind === 'folder' && !await showLibrary(item, plan.path, true)) return;
      await openFile({ ...plan, preparationMs: performance.now() - requestedAt }, item, plan.episodes);
    } catch (e) { notify(e.message); }
    finally { openingEntry.current = false; }
  };
  const changeMode = async (item, mode) => {
    try { await call('setPlaybackMode', { entryId: item.id, mode }); await refresh(); }
    catch (error) { notify(error.message); }
  };
  const openGame = async (item, preview = false) => {
    if (openingGame.current || !gameDeck(item)) return;
    openingGame.current = true;
    try {
      const data = await refresh();
      if (!preview && data?.access.reason) { setRestVisible(true); return; }
      await call('startGame', { entryId: item.id, preview, token: preview ? token : undefined });
      setGame({ entry: item, preview });
    } catch (e) { notify(e.message); }
    finally { openingGame.current = false; }
  };
  const unlock = async result => {
    setToken(result.token); setGate(false); setRestVisible(false);
    setDraftSettings(null); settingsAutosave.current = null;
    setView('parent'); const data = await refresh();
    if (data) {
      setDraftSettings(data.settings);
      settingsAutosave.current = createSettingsAutosave({ settings: data.settings,
        save: async settings => { await call('saveSettings', { token: result.token, settings }); refresh(); },
        onChange: ({ settings }) => setDraftSettings(settings),
        onError: error => notify(`时间安排未保存，请重新选择。${error.message}`),
      });
    }
  };
  const changeSettings = patch => settingsAutosave.current?.update(patch);
  const changeTvApp = (packageName, value, field = 'selected') => {
    const previous = appWrite.current;
    const write = (async () => {
      await previous?.catch(() => {});
      const catalog = await call(field === 'managed' ? 'setTvAppManaged' : 'setTvAppVisibility',
        { token, packageName, ...(field === 'managed' ? { managed: value } : { visible: value }) });
      await refresh(); return catalog;
    })();
    appWrite.current = write;
    write.finally(() => { if (appWrite.current === write) appWrite.current = null; }).catch(() => {});
    return write;
  };
  const openTvApp = async app => {
    if (openingTvApp.current) return;
    if (app.managed && snapshot?.access.reason) { setRestVisible(true); return; }
    openingTvApp.current = true; setLaunchingApp(true);
    try { await call('launchTvApp', { packageName: app.packageName }); }
    catch (error) { notify(error.message); await refresh(); }
    finally { openingTvApp.current = false; setLaunchingApp(false); }
  };
  const saveEntry = async event => {
    event.preventDefault();
    try { await call('saveEntry', { token, entry: editing }); setEditing(null); await refresh(); notify('入口已保存。'); }
    catch (e) { notify(e.message); }
  };
  const homeEntries = visibleEntries(snapshot?.entries);
  const parentEntries = (snapshot?.entries || []).filter(item => !item.removed &&
    (item.source === 'baidu' || item.path?.startsWith('/baidu/')) === (entrySource === 'baidu'));
  const homeApps = (snapshot?.tvApps || []).filter(app => app.available !== false);
  const requestTextEdit = snapshot?.systemTextInput ? args => call('editText', { token, ...args }) : undefined;
  const remain = snapshot?.access.remainingMs || 0;
  const limitsSuspended = snapshot?.access.limitsSuspended === true;
  const header = <header className="topbar">
    <FocusButton className="brand-button" aria-label="PIPI KIDS 首页" onClick={goHome} tabIndex={-1}>
      <img className="brand" src="art/logo.png" alt="PIPI KIDS" />
    </FocusButton>
    <div className="header-actions">
      <div className={`time-pill ${!limitsSuspended && remain < 60000 && !snapshot?.access.reason ? 'time-low' : ''}`} aria-live="off">
        <Clock size={30} weight="bold" />
        <span>{limitsSuspended ? '调试中 · 不限时' : snapshot?.access.reason ? '休息时间' : <>今日可学 <strong>{Math.ceil(remain / 60000)}</strong> 分钟</>}</span>
      </div>
      <FocusButton className="parent-button" onClick={showGate} disabled={!snapshot} aria-label="进入家长管理">
        <LockKey size={27} weight="fill" /><span>家长</span>
      </FocusButton>
    </div>
  </header>;
  return <main className={`app view-${view}${view === 'parent' ? ' parent-theme' : ''}`}>
    {view === 'home' && <section className={`home ${homeApps.length ? 'has-tv-apps' : ''}`} data-focus-scope="active" data-focus-key="home">
      {header}
      <div className="home-intro"><h1>Hello, little explorer.</h1>
        {snapshot?.settings.chinese !== false && <p>今天，发现一点新世界。</p>}</div>
      <div className={`entrances ${homeEntries.length > 3 ? 'many' : homeEntries.length === 2 ? 'paired' : ''}`} aria-label="我的内容" data-focus-row>
        {homeEntries.map((item, index) => {
          const totalTime = playbackTimeText(snapshot.statistics?.series[item.id]?.totalMs);
          const summary = snapshot.settings.chinese && entrySummary(item);
          const hasGame = !!gameDeck(item), gameUnlocked = snapshot.games?.[item.id]?.unlocked;
          return <div className="series-slot" key={item.id} data-focus-column><FocusButton focusId={`entry:${item.id}`}
          data-focus-id={`entry:${item.id}`} className={`entrance cover-${item.cover} ${item.mediaCover ? 'cover-from-media' : ''}`} data-autofocus={index === 0 ? 'true' : undefined}
          onClick={() => openEntry(item)} aria-label={`${item.title} ${entrySummary(item)} ${kindNames[item.kind]}`}>
          <div className="entrance-art-wrap"><CoverImage entry={item} className="entrance-art" alt="" />
            <span className="series-cover-time" aria-label={`累计播放 ${totalTime}`} title={`累计播放 ${totalTime}`}>
              <Clock aria-hidden="true" /><span>{totalTime.replace(/\s/g, '')}</span>
            </span>
          </div>
        </FocusButton>
          <div className="series-details"><div className="series-title-row"><h2>{item.title}</h2>
              {item.kind === 'folder' && <FocusButton className="series-enter" focusId={`browse:${item.id}`}
                aria-label={`进入 ${item.title} 系列列表`} onClick={() => browseEntry(item)}>进入<ArrowRight aria-hidden="true" /></FocusButton>}
            </div>
            {(summary || hasGame) && <div className="series-summary-row">
              {summary && <p title={summary}>{summary}</p>}
              {hasGame && <FocusButton className="series-game-entry" focusId={`game:${item.id}`} disabled={!gameUnlocked}
                aria-label={`${item.title} · ${gameUnlocked ? 'Play Games' : 'Game locked'}`}
                onClick={() => openGame(item)}>{gameUnlocked ? <GameController aria-hidden="true" /> : <LockKey aria-hidden="true" />}
                {gameUnlocked ? 'Play Games' : 'Game locked'}</FocusButton>}
            </div>}
            {(item.demo || item.kind !== 'folder') && <span className="entry-kind">{item.demo ? '示例内容' : <><KindIcon kind={item.kind} size={19} />{kindNames[item.kind] || '本地内容'}</>}</span>}
          </div>
        </div>; })}
        {snapshot && homeEntries.length === 0 && homeApps.length === 0 && <div className="empty-home"><FolderSimple size={90} weight="duotone" />
          <h2>连接存储，发现新的内容。</h2><p>请连接已设置的存储，或请家长选择扫描文件夹。</p>
          <FocusButton className="primary" data-autofocus onClick={showGate}><FolderSimple />设置扫描路径</FocusButton></div>}
      </div>
      <TvAppShelf apps={homeApps} onOpen={openTvApp} autoFocus={!homeEntries.length} busy={launchingApp} />
      <div className="remote-hint"><span className="remote-key">↑</span><span className="remote-key">↓</span>
        <span className="remote-key">←</span><span className="remote-key">→</span><span>选择</span><span className="ok-key">OK</span><span>打开内容</span></div>
    </section>}

    {view === 'media' && <section className="media-center page" data-focus-scope="active" data-focus-key={`media:${mediaPath}:${mediaVisit}`} data-focus-loading={loading || listedPath !== mediaPath ? 'true' : 'false'}>
      <header className="page-header"><div className="page-heading">
        <FocusButton className="icon-button" onClick={back} aria-label="返回上一层"><ArrowLeft /></FocusButton>
        <div><span className="eyebrow">MY LITTLE LIBRARY</span><h1>{listing?.name || (entry?.source === 'baidu' ? entry.title : stack.at(-1)?.name) || entry?.title}</h1></div></div>
        <div className="header-actions">
          {entry && <div className="library-mode-picker"><RemoteSelect label={`${entry.title} · 播放模式`}
            value={snapshot?.playback?.[entry.id]?.mode || DEFAULT_PLAYBACK_MODE} options={PLAYBACK_MODES}
            format={mode => MODE_LABELS[mode]} onChange={mode => changeMode(entry, mode)} /></div>}
          <div className="time-pill"><Clock size={28} /><strong>{limitsSuspended ? '调试不限时' : clockText(remain)}</strong></div>
          <FocusButton className="icon-button" onClick={showGate} aria-label="进入家长管理"><LockKey /></FocusButton></div>
      </header>
      <div className="media-scroll">
      {stack.length > 1 && <div className="breadcrumbs">{(listing?.breadcrumbs?.filter(part => part.path === entry?.path || part.path.startsWith(entry?.path + '/')) || stack).map((part, i) => <React.Fragment key={part.path}>
        {i > 0 && <ArrowRight size={18} />}<span>{part.name}</span></React.Fragment>)}</div>}
      {loading || listedPath !== mediaPath ? <p className="quiet-message" role="status">正在打开内容…</p> : !listing ? <div className="empty-panel"><Usb size={70} weight="duotone" /><h2>暂时找不到内容</h2>
        <p>{entry?.source === 'baidu' ? '请确认网络连接，或请家长重新连接网盘。' : '确认 U 盘已经接好，再试一次。'}</p><FocusButton className="primary" onClick={back}>返回上一层</FocusButton></div>
        : listing.items.length === 0 ? <div className="empty-panel"><FolderSimple size={70} weight="duotone" /><h2>这里还是空的</h2><p>放入视频、儿歌、图片或 PDF 绘本后，再回来看看。</p></div>
        : <div className="media-grid" data-focus-grid>{listing.items.map((file, i) => {
          const topics = file.kind === 'video' ? mediaSummary(file) : '';
          return <FocusButton key={file.path} focusId={`file:${file.path}`} className="media-card" aria-label={`${file.name} · ${kindNames[file.kind] || '本地内容'}${topics ? ` · ${topics}` : ''}`} data-autofocus={(listing.items.some(item => item.path === mediaTarget) ? file.path === mediaTarget : i === 0) ? 'true' : undefined}
          onClick={() => file.kind === 'folder' ? setStack(items => [...items, { path: file.path, name: file.name }]) : openFile(file)}>
          <div className={`media-cover cover-${entry?.cover}`}><CoverImage entry={entry} src={file.src} alt="" /></div>
          <h2>{file.name.replace(/\.[^.]+$/, '')}</h2>
          {topics && <p className="media-topics" title={topics}>{topics}</p>}
        </FocusButton>; })}</div>}
      {listing?.truncated && <p className="quiet-message">这个文件夹内容很多，目前显示前 1000 项，请按子文件夹整理。</p>}
      </div>
    </section>}

    {view === 'parent' && <section className="parent-page page" data-focus-scope="active" data-focus-key={`parent:${editing ? `edit:${editing.id || 'new'}` : parentTab}`}>
      <header className="page-header"><div className="page-heading"><FocusButton className="icon-button" onClick={editing ? () => setEditing(null) : leaveParent} aria-label="返回"><ArrowLeft /></FocusButton>
        <div><span className="eyebrow">A LITTLE HELP FROM GROWN-UPS</span><h1>{editing ? '编辑内容信息' : '家长空间'}</h1></div></div>
        <FocusButton className="secondary" onClick={leaveParent}><House size={24} />回到孩子的首页</FocusButton></header>
      {!editing && <nav className="parent-tabs" aria-label="家长管理分类">
        <FocusButton className={parentTab === 'entries' ? 'selected' : ''} aria-pressed={parentTab === 'entries'} onClick={() => setParentTab('entries')}><FolderSimple />内容入口</FocusButton>
        <FocusButton className={parentTab === 'apps' ? 'selected' : ''} aria-pressed={parentTab === 'apps'} onClick={() => setParentTab('apps')}><SquaresFour />电视应用</FocusButton>
        <FocusButton className={parentTab === 'time' ? 'selected' : ''} aria-pressed={parentTab === 'time'} onClick={() => setParentTab('time')}><Clock />时间管理</FocusButton>
        <FocusButton className={parentTab === 'statistics' ? 'selected' : ''} aria-pressed={parentTab === 'statistics'} data-autofocus={parentTab === 'statistics' ? 'true' : undefined} onClick={() => setParentTab('statistics')}><Clock />播放统计</FocusButton>
        <FocusButton className={parentTab === 'games' ? 'selected' : ''} aria-pressed={parentTab === 'games'} onClick={() => setParentTab('games')}><GameController />系列游戏</FocusButton>
      </nav>}
      <div className="parent-content" key={editing ? `edit:${editing.id || 'new'}` : parentTab}>
      {editing ? <form className="entry-editor" onSubmit={saveEntry}>
        <div className={`entry-preview cover-${editing.cover}`}><div className="entry-preview-art"><CoverImage entry={editing} alt="入口封面预览" /></div><h2>{editing.title || 'My little world'}</h2><p>{entrySummary(editing) || '新的小世界'}</p></div>
        <div className="editor-fields"><label>入口名称<RemoteTextField label="入口名称" autoFocus focusId="entry-title" onRequestEdit={requestTextEdit} placeholder="按 OK 输入名称" value={editing.title} onChange={value => setEditing({ ...editing, title: value })} /></label>
          <label>中文说明 <span>选填</span><RemoteTextField label="中文说明" maxLength={80} onRequestEdit={requestTextEdit} placeholder="选填，按 OK 编辑" value={editing.subtitle} onChange={value => setEditing({ ...editing, subtitle: value })} /></label>
          <div className="entry-language-field"><div className="field-label">内容语言</div><RemoteSelect label="内容语言" value={editing.language || 'en'} options={['en', 'other']}
            format={language => language === 'en' ? '英语' : '其他语言'} onChange={language => setEditing({ ...editing, language })} /></div>
          <div className="entry-source"><span className="field-label">内容来源</span><p>{editing.displayPath || editing.path}</p><small>由扫描自动整理，封面跟随内容更新。</small></div>
          <div className="editor-actions"><FocusButton type="submit" className="primary" disabled={!editing.path || !editing.title.trim()}><Check />保存入口</FocusButton>
            <FocusButton type="button" className="secondary" onClick={() => setEditing(null)}>取消</FocusButton></div>
        </div>
      </form> : parentTab === 'entries' ? <>
        <div className="content-source-bar" data-focus-row>
          <div className="content-source-switch" role="group" aria-label="内容来源">
            <FocusButton className={`source-button ${entrySource === 'local' ? 'selected' : ''}`} focusId="source:local" aria-pressed={entrySource === 'local'} onClick={() => setEntrySource('local')}><HardDrive />本地内容</FocusButton>
            <FocusButton className={`source-button ${entrySource === 'baidu' ? 'selected' : ''}`} focusId="source:baidu" aria-pressed={entrySource === 'baidu'} onClick={() => setEntrySource('baidu')}><Cloud />百度网盘</FocusButton>
          </div>
          {entrySource === 'local' ? <CatalogControls snapshot={snapshot} token={token} refresh={refresh} notify={notify} onChoosePath={() => setPicker(true)} />
            : <BaiduSettings token={token} refresh={refresh} />}
          <CatalogCleanup key={entrySource} entries={snapshot?.entries} source={entrySource} token={token} refresh={refresh} notify={notify} removeTarget={removingEntry} onRemoveClose={() => setRemovingEntry(null)} />
        </div>
        <div className="entry-list" aria-label={entrySource === 'local' ? '本地内容列表' : '网盘内容列表'}>{parentEntries.map(item => <div className={`entry-row ${item.hidden ? 'entry-is-hidden' : ''}`} key={item.id}><CoverImage entry={item} alt="" />
          <div className="entry-row-name"><strong>{item.title}</strong><small title={item.displayPath || item.path}>{item.displayPath || item.path}</small>
            {item.mediaCount != null && <small className="entry-content-count">{item.mediaCount} 项内容</small>}</div>
          <div className="entry-row-actions" role="group" aria-label={`${item.title}的入口操作`}>
          <FocusButton className="secondary" data-focus-id={`edit:${item.id}`} onClick={() => setEditing({ ...item, subtitle: entrySummary(item) })}><PencilSimple />编辑</FocusButton>
          <FocusButton className="secondary visibility-toggle" focusId={`visibility:${item.id}`} aria-label={`${item.hidden ? '显示' : '屏蔽'} ${item.title}`} onClick={async () => {
            try { await call('setEntryVisibility', { token, id: item.id, hidden: !item.hidden }); await refresh(); notify(item.hidden ? '已恢复首页显示。' : '已从首页屏蔽。'); } catch (e) { notify(e.message); }
          }}>{item.hidden ? <Eye /> : <EyeSlash />}{item.hidden ? '显示' : '屏蔽'}</FocusButton>
          <FocusButton className="secondary entry-delete" focusId={`delete:${item.id}`} aria-label={`删除 ${item.title}`} onClick={() => setRemovingEntry(item)}><Trash />删除</FocusButton></div></div>)}</div>
        {parentEntries.length === 0 && <p className="quiet-message">{entrySource === 'local' ? '还没有本地内容。' : '还没有网盘内容。'}</p>}
        {isNative && <div className="device-links"><span>{snapshot?.device}</span><FocusButton className="text-button" onClick={() => call('openSettings', { token }).catch(e => notify(e.message))}>电视系统设置<ArrowRight /></FocusButton></div>}
      </> : parentTab === 'apps' ? <TvAppSettings token={token} control={snapshot?.tvAppControl} onChange={changeTvApp} notify={notify} /> : parentTab === 'games' ? <GameSettings snapshot={snapshot} token={token} refresh={refresh} notify={notify} onPreview={item => openGame(item, true)} /> : parentTab === 'statistics' ? <PlaybackStatistics snapshot={snapshot} token={token} refresh={refresh} notify={notify} /> : draftSettings && <div className="timer-settings">
        <div className="section-heading"><div><h2>留一点时间，给屏幕之外。</h2><p>规则用于本应用内的内容浏览和播放，回到首页不会重置已用时间。</p></div><ShieldCheck size={56} weight="duotone" /></div>
        <div className="settings-grid">
          <NumberSetting label="每日上限" autoFocus hint="当天累计时长" value={draftSettings.dailyMinutes} options={[5, 10, 15, 20, 30, 45, 60, 90, 120, 180]} onChange={dailyMinutes => changeSettings({ dailyMinutes })} />
          <NumberSetting label="单次上限" hint="到时自动休息" value={draftSettings.sessionMinutes} options={[1, 5, 10, 15, 20, 25, 30, 45, 60]} onChange={sessionMinutes => changeSettings({ sessionMinutes })} />
          <NumberSetting label="休息间隔" hint="休息后再继续" value={draftSettings.restMinutes} options={[1, 5, 10, 15, 20, 30, 45, 60]} onChange={restMinutes => changeSettings({ restMinutes })} />
          <div className="setting-field setting-hours"><div className="setting-copy"><label>可用时段</label><span>时段外暂停</span></div><div className="hour-range">
            <RemoteSelect label="开始时间" value={draftSettings.startHour} options={Array.from({ length: 24 }, (_, i) => i)} format={hour => `${String(hour).padStart(2, '0')}:00`} onChange={startHour => changeSettings({ startHour })} /><span>至</span>
            <RemoteSelect label="结束时间" value={draftSettings.endHour} options={Array.from({ length: 25 }, (_, i) => i)} format={hour => `${String(hour).padStart(2, '0')}:00`} onChange={endHour => changeSettings({ endHour })} /></div></div>
        </div>
        <div className="setting-toggle"><div><strong>显示中文辅助说明</strong><p>关闭后，首页只保留入口名称。</p></div><FocusButton type="button" role="switch" aria-label="显示中文辅助说明" aria-checked={draftSettings.chinese}
          className={`switch ${draftSettings.chinese ? 'on' : ''}`} onClick={() => changeSettings({ chinese: !draftSettings.chinese })}><span /></FocusButton></div>
        <div className="timer-summary"><span>今天已用 <strong>{Math.floor((snapshot?.usage.usedMs || 0) / 60000)} 分钟</strong></span><span>今日剩余 <strong>{Math.ceil((snapshot?.access.dailyRemainingMs || 0) / 60000)} 分钟</strong></span>
          <FocusButton type="button" className="text-button" onClick={async () => { try { await call('bonus', { token }); await refresh(); notify('今天额外增加 5 分钟，已结束本次休息。'); } catch (e) { notify(e.message); } }}><Plus />今天加 5 分钟</FocusButton></div>
      </div>}
      </div>
    </section>}

    {player && <MediaViewer player={player} remain={remain} cover={artwork(player.cover)} onBack={back}
      onSelect={file => openFile(file, player.entry, player.episodes, true)} onComplete={completeEpisode} onLimit={refresh} />}
    {game && <SeriesGame key={game.entry.id} entry={game.entry} preview={game.preview} onClose={closeGame} />}
    {restVisible && <section className="rest-overlay" data-focus-scope="active" data-focus-key="rest" aria-label="休息时间"><img src="art/songs.png" alt="" />
      <span className="eyebrow">SEE YOU IN A LITTLE WHILE</span><h1 data-rest-reminder={restReminder.id}>{restReminder.text}</h1><p>{snapshot?.access.reason === 'schedule' ? '现在不在学习时段，晚一点再来吧。'
        : snapshot?.access.reason === 'daily' ? '今天的小小探索已经完成，明天见。'
        : snapshot?.access.restUntil > Date.now() ? `再休息 ${Math.max(1, Math.ceil((snapshot.access.restUntil - Date.now()) / 60000))} 分钟，然后继续新的发现。` : '去看看窗外，或者和家人一起玩一会儿吧。'}</p>
      <div><FocusButton className="primary" data-autofocus onClick={goHome}><House />回到首页</FocusButton>
        <FocusButton className="secondary" onClick={showGate}><LockKey />家长管理</FocusButton></div>
    </section>}
    {gate && <ParentGate pinSet={snapshot?.pinSet} pinLength={snapshot?.pinLength || 0} onClose={closeGate} onUnlock={unlock}
      onAuthenticate={pin => call('unlock', { pin })}
      onChangePin={(parentToken, pin) => call('changePin', { token: parentToken, pin })}
      onDiscardToken={parentToken => call('discardParent', { token: parentToken }).catch(() => {})} />}
    {picker && <ContentPicker token={token} foldersOnly onClose={() => setPicker(false)} notify={notify} onSelect={async file => {
      setPicker(false);
      try { await call('saveScanRoots', { token, paths: [...(snapshot?.catalog?.roots || []).map(root => root.path), file.path] }); await refresh(); notify('扫描路径已更新，重复范围已自动合并。'); }
      catch (error) { notify(error.message); }
    }} />}
    {error && <div className="toast" role="status"><span>{error}</span></div>}
    {!snapshot && <div className="loading-screen" role="status" data-focus-scope="active" data-focus-key="loading" tabIndex={-1} data-autofocus><img src="art/logo.png" alt="PIPI KIDS" /><p>给好奇心，留一点时间。</p></div>}
  </main>;
}

function CatalogControls({ snapshot, token, refresh, notify, onChoosePath }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), dialog = useRef(null);
  useRemoteBack(dialog, () => { if (!busy) setOpen(false); });
  const roots = snapshot?.catalog?.roots || [];
  const scan = async () => {
    if (busy) return;
    setBusy(true);
    try { await call('scanContent', { token }); await refresh(); notify('内容扫描完成。'); }
    catch (error) { notify(error.message); }
    finally { setBusy(false); }
  };
  const remove = async path => {
    if (busy) return;
    setBusy(true);
    try { await call('saveScanRoots', { token, paths: roots.filter(root => root.path !== path).map(root => root.path) }); await refresh(); notify('已取消扫描这个路径，名称和观看记录已保留。'); }
    catch (error) { notify(error.message); }
    finally { setBusy(false); }
  };
  return <div className="catalog-controls">
    <div className="catalog-actions"><FocusButton className="secondary" focusId="rescan-local" disabled={busy} onClick={scan}><ArrowCounterClockwise />{busy ? '扫描中…' : '重新扫描'}</FocusButton>
      <FocusButton className="primary" focusId="scan-paths" data-autofocus onClick={() => setOpen(true)}><FolderSimple />扫描路径</FocusButton></div>
    {snapshot?.catalog?.complete === false && <p className="source-status" role="status">部分目录未扫描完成，请重试或调整扫描范围。</p>}
    {open && <div className="modal-scrim"><section ref={dialog} className="scan-paths-dialog" role="dialog" aria-modal="true" aria-labelledby="scan-paths-title" data-focus-scope="active" data-focus-key="scan-paths">
      <header><h2 id="scan-paths-title">扫描路径</h2><FocusButton className="icon-button" disabled={busy} aria-label="关闭扫描路径" onClick={() => setOpen(false)}><X /></FocusButton></header>
      <p>可以选择多个文件夹，父子路径会自动合并。系统、缓存、隐藏和空目录会跳过。</p>
      <div className="scan-roots">{roots.map(root => <div className="scan-root" key={root.path}><div><strong>{root.name || root.path}</strong><span>{root.path}</span><small>{root.available === false ? '存储未连接，连接后自动恢复' : '正在参与扫描'}</small></div>
        <FocusButton className="secondary" disabled={busy} aria-label={`取消扫描 ${root.path}`} onClick={() => remove(root.path)}>取消扫描</FocusButton></div>)}</div>
      {!roots.length && <p className="quiet-message">还没有扫描路径，先选择一个内容文件夹。</p>}
      <footer><FocusButton className="primary" data-autofocus disabled={busy} onClick={onChoosePath}><Plus />添加扫描路径</FocusButton>
        <FocusButton className="secondary" disabled={busy} onClick={() => setOpen(false)}>完成</FocusButton></footer>
    </section></div>}
  </div>;
}

function GameSettings({ snapshot, token, refresh, notify, onPreview }) {
  const change = async (item, rounds) => {
    try { await call('setGameRounds', { token, entryId: item.id, rounds }); await refresh(); notify('游戏解锁次数已保存。'); }
    catch (error) { notify(error.message); }
  };
  return <div className="game-settings"><div className="section-heading"><div><h2>看过，再玩一小局。</h2>
    <p>听英文、找图片。每局 10–20 题，用方向键和 OK 即可完成。</p></div><GameController size={56} weight="duotone" /></div>
    <p className="game-parent-intro">测试阶段默认 0 遍，游戏直接开放。也可逐系列设置观看门槛：每条视频或音频都完整播完一次算 1 遍，图片和 PDF 不计入。</p>
    {snapshot?.entries.filter(item => !item.removed).map(item => { const status = snapshot.games?.[item.id]; return <div className="game-setting-row" key={item.id}>
      <div className="game-setting-name"><strong>{item.title}</strong><p>{status?.requiredRounds === 0 ? '测试直接开放 · 无需先播放' : status?.total ? `已完整播放 ${status.completedRounds} 遍 · ${status.readyItems} / ${status.total} 条已达到要求` : '尚无可统计的视频或音频'}{status?.unlocked && status?.requiredRounds !== 0 ? ' · 已解锁' : ''}</p></div>
      <div className="game-setting-actions">
      <RemoteSelect label={`${item.title} · 游戏解锁次数`} value={status?.requiredRounds ?? DEFAULT_GAME_ROUNDS} options={GAME_ROUNDS} format={value => value === 0 ? '0 遍 · 直接开放（测试）' : `${value} 遍后解锁`} onChange={value => change(item, value)} />
      <FocusButton className="secondary" disabled={!gameDeck(item)} onClick={() => onPreview(item)}><GameController />预览游戏</FocusButton></div>
      {gameWords(item).length > 0 && <p className="game-vocabulary">本系列词表：{gameWords(item).join(' · ')}</p>}
    </div>; })}
    <p className="game-parent-footnote">预览不改变观看遍数。游戏同样遵守每日时长和休息安排；调整次数不会清除播放记录。当前首版题库支持古力、WOW、Animals、Colors 和 Songs；新系列需要配置对应题库。</p>
  </div>;
}

function PlaybackStatistics({ snapshot, token, refresh, notify }) {
  const [resetting, setResetting] = useState(null), [busy, setBusy] = useState(false);
  const dialog = useRef(null), submitting = useRef(false);
  useRemoteBack(dialog, () => { if (!submitting.current) setResetting(null); });
  const reset = async () => {
    if (submitting.current) return;
    submitting.current = true; setBusy(true);
    try {
      await call('resetPlaybackTime', { token, entryId: resetting.id });
      setResetting(null); await refresh(); notify(`${resetting.title}的累计播放时长已清零。`);
    } catch (error) { notify(error.message); }
    finally { submitting.current = false; setBusy(false); }
  };
  return <div className="playback-statistics">
    <div className="statistics-overview"><div><span>所有英语视频累计播放</span><strong>{playbackTimeText(snapshot?.statistics?.englishVideoMs)}</strong></div><Clock weight="duotone" /></div>
    <p className="statistics-explanation">按实际播放时间累计，重复播放会继续计时。英语总计汇总英语系列中的视频，不含音频、图片和绘本。</p>
    <div className="section-heading"><div><h2>每个系列的播放时长</h2><p>包含视频和音频；从启用统计或最近清零起累计。</p></div></div>
    <div className="statistics-list">{snapshot?.entries.map((item, index) => {
      const stats = snapshot.statistics?.series[item.id];
      return <div className="statistics-row" key={item.id}>
        <CoverImage entry={item} alt="" /><div className="statistics-name"><strong>{item.title}</strong>
          <span>{item.language === 'other' ? '其他语言' : '英语'}{stats?.resetAt ? ` · 上次清零 ${new Date(stats.resetAt).toLocaleDateString('zh-CN')}` : ''}</span></div>
        <strong className="statistics-duration">{playbackTimeText(stats?.totalMs)}</strong>
        <FocusButton className="secondary" focusId={`reset-time:${item.id}`} data-autofocus={index === 0 ? 'true' : undefined}
          aria-label={`清零${item.title}的播放时长`} onClick={() => setResetting(item)}><ArrowCounterClockwise />清零</FocusButton>
      </div>;
    })}</div>
    {!snapshot?.entries.length && <p className="quiet-message">添加内容入口后，可在这里查看播放统计。</p>}
    <p className="statistics-footnote">暂停、缓冲、后台和浏览目录不累计。清零后，英语总计会同步更新；续播位置、复习记录和每日额度保留。内容语言可在“内容入口 → 编辑”中设置。</p>
    {resetting && <div className="modal-scrim"><section ref={dialog} className="reset-stats-dialog" data-focus-scope="active" data-focus-key={`reset-time:${resetting.id}`}
      role="dialog" aria-modal="true" aria-labelledby="reset-stats-title">
      <h2 id="reset-stats-title">清零{resetting.title}的播放时长？</h2>
      <p>当前累计 {playbackTimeText(snapshot?.statistics?.series[resetting.id]?.totalMs)}。清零后无法恢复，英语总计会同步更新。</p>
      <div><FocusButton className="secondary" data-autofocus disabled={busy} onClick={() => setResetting(null)}>取消</FocusButton>
        <FocusButton className="primary" disabled={busy} onClick={reset}>{busy ? '正在清零…' : '确认清零'}</FocusButton></div>
    </section></div>}
  </div>;
}

function NumberSetting({ label, hint, value, options, onChange, autoFocus }) {
  return <div className="setting-field"><div className="setting-copy"><label>{label}</label><span>{hint}</span></div><div className="number-setting"><RemoteSelect label={label} value={value} options={options} onChange={onChange} autoFocus={autoFocus} /><span>分钟</span></div></div>;
}

function ContentPicker({ token, onClose, onSelect, notify, foldersOnly = false }) {
  const [stack, setStack] = useState([]), [items, setItems] = useState([]), [loading, setLoading] = useState(true), [message, setMessage] = useState('');
  const [loadedPath, setLoadedPath] = useState(null);
  const folderInput = useRef(null), fileInput = useRef(null), dialog = useRef(null), loadVersion = useRef(0);
  useRemoteBack(dialog, () => stack.length ? setStack(current => current.slice(0, -1)) : onClose());
  const path = stack.at(-1)?.path;
  const load = useCallback(async () => {
    const version = ++loadVersion.current; setLoading(true); setMessage(''); setItems([]);
    try { const result = path ? await call('list', { token, path }) : await call('getRoots', { token }); if (version === loadVersion.current) setItems(path ? result.items : result); }
    catch (e) { if (version === loadVersion.current) { setItems([]); setMessage(e.message); } } finally { if (version === loadVersion.current) { setLoadedPath(path || 'roots'); setLoading(false); } }
  }, [path, token]);
  useEffect(() => { load(); return () => { loadVersion.current++; }; }, [load]);
  const imported = async e => {
    try { const result = await importFiles(e.target.files, token); onSelect(result); }
    catch (err) { notify(err.message); } finally { e.target.value = ''; }
  };
  return <div className="modal-scrim"><section ref={dialog} className="file-picker" data-focus-key={`picker:${path || 'roots'}`} data-focus-loading={loading || loadedPath !== (path || 'roots') ? 'true' : 'false'} role="dialog" aria-modal="true" aria-labelledby="picker-title" data-focus-scope="active">
    <header><div><span className="eyebrow">LOCAL MEDIA</span><h2 id="picker-title">{foldersOnly ? '选择扫描文件夹' : '选择本地内容'}</h2></div><FocusButton className="icon-button" aria-label="关闭文件选择" onClick={onClose}><X /></FocusButton></header>
    <p className="picker-intro">{foldersOnly ? '进入一个文件夹，选择“使用此文件夹”。' : '选一个文件夹，或直接选中一个视频、音频、图片或 PDF。'}</p>
    <div className="picker-toolbar"><FocusButton className="secondary" onClick={() => stack.length ? setStack(s => s.slice(0, -1)) : load()}>{stack.length ? <ArrowLeft /> : <ArrowCounterClockwise />}{stack.length ? '上一级' : '刷新设备'}</FocusButton>
      {isNative ? <FocusButton className="secondary" onClick={async () => { try { await call('requestStorage', { token }); setTimeout(load, 300); } catch (e) { setMessage(e.message); } }}><HardDrive />读取存储授权</FocusButton>
        : <><FocusButton className="secondary" onClick={() => folderInput.current.click()}><FolderSimple />导入文件夹</FocusButton>{!foldersOnly && <FocusButton className="secondary" onClick={() => fileInput.current.click()}><Plus />导入文件</FocusButton>}</>}
      {path && <FocusButton className="primary" onClick={() => onSelect({ ...stack.at(-1), kind: 'folder' })}><Check />使用此文件夹</FocusButton>}
    </div>
    <input ref={folderInput} type="file" webkitdirectory="" multiple hidden onChange={imported} />
    <input ref={fileInput} type="file" accept="video/*,audio/*,image/*,application/pdf" hidden onChange={imported} />
    <div className="picker-path">{stack.length ? stack.map(x => x.name).join(' / ') : '电视 / U 盘 / 示例内容'}</div>
    <div className="picker-files">{loading ? <p className="quiet-message">正在读取…</p> : message ? <p className="quiet-message" role="status">{message}</p>
      : items.filter(file => !foldersOnly || file.kind === 'folder').length === 0 ? <p className="quiet-message">{foldersOnly ? '这里没有子文件夹，可以使用当前文件夹。' : '这个位置还没有可用的内容。'}</p> : items.filter(file => !foldersOnly || file.kind === 'folder').map((file, index) => <FocusButton key={file.path} data-focus-id={file.path} data-autofocus={index === 0 ? 'true' : undefined} className="file-row" onClick={() => file.kind === 'folder' ? setStack(s => [...s, file]) : onSelect(file)}>
        <KindIcon kind={file.kind} size={36} /><span><strong>{file.name}</strong><small>{kindNames[file.kind]}</small></span>{file.kind === 'folder' ? <ArrowRight /> : <Check />}</FocusButton>)}</div>
    {!isNative && <p className="picker-note">浏览器导入的文件只保存在这台电脑的浏览器中；电视安装版直接读取电视和 U 盘。</p>}
  </section></div>;
}
