# PIPI KIDS visual and interaction QA

## 2026-11-01 Two-line library titles without keyword tags

final result: passed

The user's latest list feedback removes the topic-keyword row beneath each file and assigns that space to the filename. Titles keep their full underlying text, wrap naturally into two reserved lines at the existing font size, and use a second-line ellipsis only for longer text. The small cover type icon and fixed header remain. Homepage descriptions are unchanged.

Browser checks at 960 × 540 and 1280 × 720 found zero keyword rows and a two-line clamp. The titles from the user's screenshot (files 13–15) fit in two lines. The longer file 27 needs three natural lines and visibly truncates at the end of the second. Browser console warnings/errors: none. The existing JavaScript checks passed (51); the isolated APK build passed native checks, including 136 playback-planner assertions and signature verification.

Both cases were captured and visually checked on the actual Hisense Chromium 83 WebView: `tv-after.png` shows complete titles 13–15 and `tv-ellipsis.png` shows file 27 ending in an ellipsis on line two. Remote navigation reached both rows and restored file 13. Post-install readback, measured before the normal playback entry used to reach the list, preserved entries, parent settings, playback/review history, statistics, games, usage and default HOME. PIN data was not read or changed.

Concurrent work updated the installed APK during device QA. The final device APK was downloaded and hash-checked; its bundled CSS contains the two-line title rule and its JavaScript contains no keyword-row markup. The accepted TV screenshots therefore verify the final installed build. The independently built artifact and final installed artifact are both retained.

Evidence directory: `outputs/qa/library-two-line-titles/`. Key files: `tv-after.png`, `tv-ellipsis.png`, `browser-960-scrolled.png`, `browser-960-ellipsis.png`, `browser-1280.png`, `browser-960.json`, `browser-1280.json`, `browser-ellipsis.json`, `verification.json`, `tv-navigation.json`, `tests.log`, `build.log`, `PIPI-KIDS-two-line-titles.apk` and `PIPI-KIDS-installed-verified.apk`.

## 2026-11-01 Persistent library header during file scrolling

final result: passed

The user's latest marked screenshot requires Back, the library title, playback mode, remaining time and parent access to stay in place while files scroll. The media page now fills the viewport and scrolls only its content container below the header. Padding preserves the selected card's focus border. Vertical remote navigation prioritizes preceding/following file rows over the fixed toolbar; Up reaches the toolbar only from the first row, and Down stays on the last row.

Browser checks at 960 × 540 and 1280 × 720 confirmed identical header bounds before and after scrolling, zero document scrolling/overflow, and a fully visible selected file. Up traversed files 13 → 10 → 7 → 4 → 1 before reaching Back. Exiting and reopening the directory restored the selected file and its internal scroll position. Browser warnings/errors: none. The existing checks plus the new remote-navigation regression passed: 50 JavaScript tests. The isolated APK build passed Android checks, including 75 playback-planner assertions and signature verification.

The same flow passed on the actual Hisense Chromium 83 WebView. Nineteen device checks cover scrolling to file 13, unchanged header bounds, reverse navigation, reaching Back, and reopening on the selected file. The final TV screenshot was opened and visually checked. Readback preserved entries, parent settings, playback/review history, cumulative statistics, game state, usage and default HOME. The installed APK hash matches the reviewed build; no PIN was read or reset. The build also retains the latest three playback modes and homepage changes already present in the shared workspace.

Evidence: `outputs/qa/library-fixed-header/tv-list-top.png`, `tv-list-scrolled.png`, `tv-after.png`, their XML snapshots, `tv-navigation.json`, `browser-960-scroll.json`, `browser-1280-scroll.json`, `browser-navigation.json`, `verification.json`, `tests.log` and `build.log`. The previous APK and source are under `before/`; the reviewed artifact is `PIPI-KIDS-fixed-header.apk` in the same evidence directory.

## 2026-11-01 Library header spacing and compact file-type badges

final result: passed

The user's marked WOW list screenshot requested a clear gap beside Back, smaller cover icons, and removal of the duplicate media-type text beneath each card. The header now uses explicit flex-item margins compatible with the Hisense Chromium 83. Each cover has one 30 px badge with an 18 px type icon and an accessible type name; the separate type text row is removed. Titles and filename-grounded keywords remain below the cover. Explicit cover width also keeps the browser preview consistent with the existing TV cover layout.

Browser checks at 960 × 540 (the television's logical viewport) and 1280 × 720 confirmed 18 / 23 px Back-to-title separation, zero duplicate type rows, full card-width covers and no horizontal overflow. D-pad Up reaches Back, Right reaches the playback selector, OK opens the selector, and Back dismisses it without changing the mode. Browser console errors/warnings: none. Existing JavaScript checks: 44 passed. The APK build passed its Android behavior checks and signature verification.

The reviewed APK was installed on the actual Hisense. Direction keys reached the WOW browse action and opened the real USB list; Up selected Back. The final TV screenshot was opened and visually checked: title separation is clear and the type icon is smaller with no duplicate tag. Readback confirmed identical entries, parental settings, playback/review records, cumulative statistics, game status and default HOME. Daily/session usage was retained and the installed APK hash matches the build. PIN data was neither inspected nor changed. The cover image differs from the original screenshot because it follows the latest played file, as required by the existing automatic-cover behavior.

Evidence: `outputs/qa/library-header/tv-before.png`, `tv-after.png`, `tv-file-selected.png`, `browser-960.png`, `browser-1280.png`, `browser-960.json`, `browser-1280.json`, `verification.json` and `build.log`. The prior installed APK and modified source files are saved under `outputs/qa/library-header/before/`.

## 2026-11-01 Homepage background and original compact entrances

The user's latest decision is a soft sage homepage background (`#e2e8d9`) with the FIRST version of the browse and game entrances restored as-is. Their original font sizes, weights, padding, spacing, colors and locked-state opacity are restored exactly; the proposed larger filled controls and progress badges were rejected. The approved cover-only focus border is retained.

The final browser has no overflow at 1280 × 720. The final APK was built in an isolated source snapshot, passed Android policy/signature checks, and was installed and visually checked on the Hisense. The real TV screenshot shows both compact actions on one row and the remote hint fully visible. Existing entries, parent settings and the default HOME were read back and preserved. Current game functionality from concurrent work was retained.

Final evidence: `outputs/qa/home-comfort/tv-home.png`, `browser-final.jpg`, `original-button-layout.json`, `final-build.log`, `final-build-source-hashes.json` and `tv-verification.json`. Intermediate proposals are kept under that directory's `superseded/` folder and are not the final design. The final installable artifact is `outputs/qa/home-comfort/PIPI-KIDS-home-comfort-20261101.apk`.

## 2026-11-01 Hisense device update

The current reference is the user's attached home-screen feedback, captured locally as `outputs/qa/layout-before-user.png`. The user asked for more space between media and text. The older generated mock below remains historical context; its dense card anatomy no longer overrides this feedback.

1. **Before / needs correction:** cover images met the oversized titles without a gap, tall crops cut off video content, and the two-line welcome heading dominated the screen.
2. **After / visually checked:** three 16:9 image containers, explicit separation before the left-aligned title, smaller title/subtitle hierarchy, and a one-line welcome. The 1280 × 720 browser check measured 16.63 px of image-to-title space and no page overflow. On the TV this scales to approximately 25 px. The after screenshot was read back from the Hisense itself, not from a browser mock.
3. **Interaction / device checked:** Android key events opened USB content; a second 古力 episode updated only that entry's recent-playback source. The history, all three paths, and parent settings survived the visual update. The final acceptance report records the restart and installed-APK hash checks.

Video thumbnails now skip dark transition frames, including black frames with a small recording toolbar. A four-case regression test covers this. The physical remote, all media codecs, and full accessibility compliance are not implied by these checks.

Files: `outputs/qa/tv-layout-after.png`, `outputs/qa/tv-layout-final.png`, `outputs/tv-state-before-layout-update.json`, `outputs/tv-state-after-layout-update.json`, and `outputs/tv-acceptance.json`.

## Earlier browser-only review

final result: passed

This result applies to the browser implementation and selected visual. Android installation and playback on the user's television remain unverified because ADB is closed.

## Evidence

- Source visual truth: `outputs/design/selected.png`, 1672 × 941 pixels.
- Implementation: `outputs/qa/home-final.png`, 1672 × 941 pixels, browser-rendered through Codex's in-app browser at 1672 × 941 CSS pixels, devicePixelRatio 1. No density normalization needed.
- State: fresh child homepage, first card focused, three bundled sample folders, 15-minute session allowance.
- Full-view comparison, opened together in one input: `outputs/qa/comparison-final.png`.
- Focused comparisons, also opened together: `outputs/qa/comparison-typography.png` and `outputs/qa/comparison-card.png`.
- Breakpoints checked: 1280 × 720 and 1920 × 1080, both with scroll dimensions equal to viewport dimensions. Screenshots: `outputs/qa/home-720p.png`, `outputs/qa/home-1080p.png`.
- Browser console checked on final clean preview: no error or warning entries.

## Findings and comparison history

1. Initial comparison (`comparison-before.png`, `home-before.png`) found [P1] clipped kitten paws/songbird feet; [P2] overly large wordmark and low card placement. These were corrected with independently generated 4:3 artwork, measured artwork containers, smaller wordmark, and corrected vertical spacing. Final artwork retains complete subjects.
2. An intermediate focused typography comparison found [P2] the Chinese greeting sitting too low, compressing the greeting-to-card gap. Its top margin was removed and the lower section margin increased, preserving card placement. `comparison-typography.png` and `comparison-final.png` show the corrected result.
3. A 720p check found [P2] the helper line extending the page below the viewport. It was placed in the bottom safe area; both final 720p and 1080p checks have no overflow.
4. No actionable P0/P1/P2 visual issues remain.

## Required fidelity surfaces

- Fonts/typography: bundled static Nunito 600/800/900 for offline English display, system CJK fallback for Chinese. Headline wrapping, weights and editable labels match the intended hierarchy. Static font files also avoid reliance on variable-font support in older TV WebViews.
- Spacing/layout: safe-area margins, three-column card rhythm, header alignment, rounded corners and selected-card ring compared at the same viewport. The first card retains a visible focus ring without clipped artwork.
- Colors/tokens: warm cream surface, sage text, powder-blue and butter-yellow artwork retained. Parent controls share the same palette.
- Image quality: real built-in ImageGen artwork and transparent logo are present. Full subjects and actual image proportions are preserved; standard pictograms use Phosphor. Image slots were recomposed rather than replaced with code-drawn illustrations.
- Copy/content: all entries point to local folders/files as requested. Concept counts were intentionally replaced by truthful “示例内容”; the bundle contains real illustrative sample files, not invented videos or an online course.

## Primary interactions tested

- Homepage folder opens its real bundled file listing.
- Confirm opens an image; Escape/Back returns to the previous level.
- Parent PIN creation with confirmation, subsequent unlock, entry editing and saving.
- File chooser imports a project-owned image, stores it in IndexedDB, and a new shortcut directly opens the imported file.
- Four-entry homepage navigates right with keyboard D-pad actions and scrolls to the fourth item.
- Parent session/rest selectors save, extra five-minute allowance resets the session/rest.
- A project-owned 65-second MP4 was imported and observed playing (`currentTime` 12.34s, duration 65s, paused false). With a one-minute session configured, the app removed the video and displayed the rest screen; DOM check reported zero video elements. Evidence: `video-timer-running.png`, `timer-stopped.png`.
- A page reload retained the test shortcut and selected one-minute settings.
- Six JavaScript policy tests pass. Native Java policy has nine behavior checks; APK build compiles all native sources and verifies its signature.

## Follow-up polish and device limits

- [P3] The independently generated kitten pose and studio-background transitions differ slightly from the concept. The required subjects, palette, focus and hierarchy are preserved.
- Actual television storage permission flow, USB volume enumeration, remote key delivery, PDF rendering, codecs and OEM HOME behavior need device testing. These are not claimed as passed by browser QA.
- The clean user-facing preview is at `http://localhost:4173/`; test PIN/media remain isolated to the separate `127.0.0.1` test origin. The TV package starts with no PIN configured.

## Implementation checklist

- [x] Selected visual and focused comparisons opened and reviewed.
- [x] Major visual findings fixed and recaptured.
- [x] Core browser flow tested through UI.
- [x] Actual browser timeout behavior observed.
- [x] Final preview kept open; temporary viewport override reset.
- [ ] Install and verify on the user's Hisense after a supported installation path is available.

## 2026-11-01 Parent-space layout

The user's current request covers the close image/text spacing in content entries and consistent spacing throughout parent space. Screenshots from this run are under `outputs/qa/parent-layout-20261101/`; the five accepted final TV screenshots are in `tv-final/`.

1. **Content entries — passed.** Replaced unsupported flex gaps with explicit margins, kept complete 16:9 cover areas, separated title/description/path spacing and aligned the edit/remove actions. The browser measured a 24 px cover-to-copy margin at 960 × 540 CSS pixels. Verified on the Hisense Chromium 83.
2. **Entry editor — passed.** Cover and copy are separate; fields and action spacing match the list. Existing-entry editing starts on the entry name, without scrolling it away. New-entry content selection remains the initial action. D-pad scrolling keeps the page header in place.
3. **Time management — passed.** Consistent field groups, label/hint spacing and explicit separation for selectors, units and time ranges. Existing time policies remain intact.
4. **Playback statistics — passed.** Shared cover/text spacing, aligned totals and reset controls. First entry to this category focuses its tab, leaving the full English-video total visible; subsequent action focus can still be restored.
5. **Series games — passed.** Vocabulary occupies its own full-width line below the title and settings/preview actions, without squeezing either column.

All five surfaces were opened and captured in the browser and in a separate test package on the actual TV. The TV captures use disposable test content, independently of the real app's PIN/data. The temporary package was removed. The production package was updated with the verified build and its SHA-256 was read back; see `installation.json`.

Validation: 66 existing JavaScript tests passed; production/legacy Vite bundles, all native build checks and APK signature verification passed. Concurrent activity in the shared build directory required the final APK to be built from the recorded source snapshot in `verified-source/`. The reviewed application sources still match that snapshot (`source-consistency.json`).

Readback retained the actual USB entry configuration, parent time settings, usage, existing history, cumulative totals and game settings. Playback advanced during the work, so updated episode positions and increased totals were preserved rather than restored to the earlier snapshot (`preservation-checks.json`). Debugging limits remain suspended as previously requested. No real PIN was read, submitted or changed.

Screenshots and D-pad checks verify the requested layout and focus behavior; they do not establish full accessibility compliance or retest every media codec. Earlier iteration screenshots outside `tv-final/` are not the final TV design.


## 2026-11-01 Silent time-settings autosave and compact rows

The user requested automatic saving after confirming each time choice, then asked to remove the bottom “已自动保存” line and place each selector to the right of its label/description when space permits. The final time screen has no Save button or saving/success/instruction footer. Failed writes restore their persisted value and show an error. Writes run in order, retain other queued choices, and finish before parent exit revokes its token.

The four setting cards now use wrapping flex rows with explicit margins compatible with Chromium 83. Copy stays left and controls stay right; only insufficient width moves controls below the copy. At 1280 × 720 and the TV's 960 × 540 logical viewport, all four fields remain inline and measure about 91/90 CSS pixels tall. At 850 pixels the fields wrap without horizontal overflow. The available-hours hint is shortened to “时段外自动停止播放”. Remote targets remain at least 54 CSS pixels tall. The bottom status text is absent at all checked sizes.

Browser verification confirms all six settings persist, canceling a selector does not change the saved choice, and a D-pad/OK choice survives immediate Back and a page reload. Browser warnings/errors: none. Seventy JavaScript tests and four Sites packaging tests pass. The full native build and its policy, navigation, playback, PIN and signature checks passed in the isolated source snapshot.

On the actual Hisense, isolated-package checks confirmed immediate saving for daily/session/rest minutes and both allowed-hour endpoints, plus canceling a browsed choice. Further UI checks ended after the shared TV foreground moved to the separate catalog QA package. The final compact layout was visually reviewed in the browser; a final TV screenshot and the remaining native restart/toggle checks are not claimed. The test package was removed.

The final production APK was installed in the background and its SHA-256 was read back. The TV's other QA package kept the foreground. Native code and all non-web APK entries are byte-identical to the previously installed app, retaining existing behavior while other native/catalog work continues in the shared workspace. No actual parent PIN or time setting was read through private storage or changed for testing. The existing debug-limit flag was not changed.

Evidence: `outputs/qa/time-autosave-20261101/`. Main files: `browser-final.png`, `browser-compact-960.png`, `browser-1280.json`, `browser-850.json`, `final-tests.log`, `sites-test.log`, `isolated-build.log`, `final-web-build.log`, `tv-checks.json`, `tv-qa.log`, `artifact-checks.json`, `verification.json`, `installation.json`, and `PIPI-KIDS-time-autosave-20261101.apk`. The served QA preview and delivered assets use the scoped source in `build-source/`; combined work remains in the shared `web/src/`.


## 2026-11-01 Short time-management copy

The annotated four cards now read “每日上限 / 当天累计时长”, “单次上限 / 到时自动休息”, “休息间隔 / 休息后再继续”, and “可用时段 / 时段外暂停”. Only these titles and hints changed. All four labels and hints render on a single line at 960 × 540 with no horizontal overflow; the 1280 × 720 screenshot was visually reviewed. Silent automatic saving, option values and responsive wrapping are unchanged. The production/legacy web build passed. The installed native APK code and other assets were preserved, and the updated TV APK hash was read back after background installation. Evidence: `outputs/qa/time-copy-20261101/`, including `browser-after.png`, `browser-960.json`, `build.log`, `assembly.json`, and `installation.json`.


## 2026-11-01 Automatic content catalog and system text input

Content entries now come from parent-selected scan folders. The default is the currently connected USB root; internal storage and newly attached unselected drives are excluded. Multiple paths normalize aliases and collapse parent/child relationships in either order. Existing series boundaries retain their IDs, names, descriptions, visibility, playback modes/history, totals and game progress. Entry editing only changes metadata; hiding replaces deletion. Removing a scan scope keeps its catalog records. Child playback rejects hidden, unavailable and out-of-scope entries. The local catalog remains independent of the concurrent cloud-source work.

Title/description editing on TV uses the native EditText and installed Sogou TV IME. Remote OK explicitly opens it without changing global keyboard settings. Directions/OK remain with the native input method; Back hides the keyboard, then cancels the edit without reopening it. The browser uses a normal composition-aware text field with Cancel/Done. PIN input stays on the existing numeric keypad. The content list/editor retain the shared 24 CSS-pixel cover-to-copy margin and complete 16:9 cover, with aligned actions and readable path/status spacing.

Validation: 81 JavaScript checks passed; the production/legacy web build, complete native compilation, native policy/playback checks and APK signature verification passed. The pure discovery suite has 14 checks. A disposable native package ran 17 catalog checks on the Hisense: path collapse, grouping/filtering, metadata-only saves, hidden child access rejection, scope removal, simulated disconnect/reconnect, and history/stat retention. System IME UI checks passed on that package. Browser UI checks covered independent roots, adding an ancestor, Chinese descriptions and hidden entries disappearing from home. Later integration captures include the concurrently added cloud-source panel; a repeat IME run stopped when another QA package took foreground, and is not counted as a second completed IME run. Physical USB unplugging was not performed.

The reviewed build was installed as an update. SHA-256 readback matched `outputs/PIPI-KIDS-auto-catalog-20261101.apk`. The actual scan root is `/storage/4A21-0000`; the two original IDs remain `demo-animals` and `demo-colors`, with 12 Guli videos and 31 WOW items (26 videos and 5 PDFs). Configuration, usage, review/game state and cumulative totals were retained. Concurrent playback advanced two resume positions/timestamps and increased totals; that newer progress was kept. No real PIN was read, submitted, reset or changed; debugging limits remain suspended. Only this task's disposable catalog QA package was uninstalled.

Evidence is in `outputs/qa/auto-catalog-20261101/`: `verification.json`, `installation.json`, before/after readbacks, `tv-native-checks.log`, `tv-ime-checks.json`, `tv-system-ime-final.png`, `tv-scan-paths-final.png`, `tv-installed-investigation.png`, browser JSON/screenshots and build/test logs. The build used `verified-source/` to avoid concurrent writes to shared build outputs. `source-hashes.json` records the built files; `source-consistency.json` separately lists subsequent edits from other ongoing work, without overwriting them.


## 2026-11-01 Baidu selected-folder row

Moved the selected-folder path directly below Choose Folder and placed Disconnect on its right in the same flex row. Choose/Update remain above. The path stays on one line, truncates when needed, and retains its complete text/title. Browser verification at 960 × 540 confirmed alignment, no overflow, long-path truncation and D-pad Down from Choose reaching Disconnect. The packaged CSS was also rendered on an owned virtual display using the actual Hisense Chromium 83; the same-row/alignment checks passed and the temporary renderer was removed. This layout change does not need new policy tests; the production/legacy web build and APK signature verification passed.

Installed a web-only update, with all native code and non-web assets byte-identical to the previous installed APK. Readback confirmed identical entries, scan paths, settings, usage, playback, statistics, games and TV-app selections. Real PIN/cloud authorization was not read or changed. Evidence: `outputs/qa/baidu-folder-inline-20261101/verification.json`, browser/native screenshots and `installation.json`. The updated APK is `outputs/PIPI-KIDS-baidu-folder-inline-20261101.apk` and the standard development APK was updated atomically.


## 2026-11-01 Smaller Baidu selected-folder text

Reduced the selected-folder path from 14 to 12 CSS pixels at the TV's 960-pixel logical width. Choose Folder and Update Directory keep their original size on one row; connected controls reserve 320 CSS pixels, while the path and Disconnect remain in the second row. The browser and actual Hisense Chromium 83 rendered 12px path text, same-row top buttons and no horizontal overflow. Native Choose/Disconnect geometry matches the prior layout exactly. The APK updates only the Baidu CSS rules and stylesheet reference; all JavaScript, native code and media are byte-identical to the prior installed package. Build/signature checks and installed hash/state readback passed. Evidence: `outputs/qa/baidu-folder-font-20261101/verification.json` and its screenshots. No new behavior tests were needed for the CSS change.
