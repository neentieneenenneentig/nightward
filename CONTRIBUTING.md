# Contributing to NIGHTWARD

NIGHTWARD is released as-is under the [MIT license](LICENSE). The original author has stopped
working on it. Fork it, finish it, strip it for parts or host your own version.

## AI contributions are welcome

Most of this game was written by AI coding agents (Claude), so AI-written pull requests are
welcome too. Use whatever tools you like. Every pull request, however it was written, should:

- pass `npm run typecheck` and `npm run build`, and the browser QA suite (`npm run qa`) if you
  changed gameplay or rendering
- say what changed and how you checked it
- name the model or tool you used in the description or a `Co-Authored-By:` trailer, so
  readers know what produced it
- keep the game's one rule: every visual and sound is generated in code. No image, audio or
  font files, and nothing copied from other games
- include only work you are allowed to share under the MIT license

## Where to start

- [README.md](README.md): what the game is and how to run it.
- [docs/GDD.md](docs/GDD.md): the design reference.
- [docs/plans/ROADMAP.md](docs/plans/ROADMAP.md) and [docs/plans/WORKFLOW.md](docs/plans/WORKFLOW.md):
  build history, what was next, and how the agents worked.
- [.claude/agents/playtest.md](.claude/agents/playtest.md): the playtest agent used during development.

Nobody is watching this repository closely, so a pull request may wait a long time. If you
want something to move faster, fork it.
