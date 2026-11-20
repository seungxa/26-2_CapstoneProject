# Practice·Track UI notes for the team

Things we noticed while moving Practice·Track to the team look. They are in team-owned files, so we did not change them.

1. **Dashboard emoji render as a box (□) in some environments.** The dashboard cards use emoji, and fonts without emoji glyphs show a box. Suggest replacing them with SVG icons.
2. **Dark mode: introduce it together with the shell.** Practice·Track now follows the shell's light colors only. If the team adds dark mode, add it to the shell and the feature variables in one change, so the two never disagree.
3. **Profile screen text is still Korean.** Make it English like the rest of the UI (Korean stays only for interview content marked `lang="ko"`).
