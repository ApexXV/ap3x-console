# Writing a module

1. Create `src/modules/<id>/index.ts` exporting a `ModuleManifest`, plus an optional `<id>.css` imported from it.
2. Declare `sources` with the contract's URL and `schema`; set `stampField` and `maxAgeMs` if the feed has a timestamp and a cadence; mark feeds that may not exist yet `optional: true`.
3. Write `model(ctx)` as a pure parser: read `ctx.sources[id].data` through `asDict`/`rows`/`num`/`text` from `src/core/format.ts`, check the schema marker, and return a typed view model with an explicit "no feed" state. Never throw on bad input.
4. Write `render(body, model, ctx)`: replace `body`'s children each time. Size everything in `em`.
5. Optional: `chip`, `detail` (use `sec`, `stats`, `dlist`, `paged`, `place` from `src/core/detail.ts`; keep interactive state in `hooks.state` and call `hooks.rebuild()`), `changes`, `priority` (pick a `rank`), and `demo(now)` returning a realistic payload per source id.
6. Register it in `src/modules/index.ts` and place it in a layout.
7. `npm test` runs every registered module against its demo data, an empty payload set, and garbage, at two stage widths, so a new module is covered as soon as it is registered. Add contract-specific tests to `test/modules.test.ts`.

Privacy: wrap names and amounts in `privateText(...)` so `?privacy=on` blurs them. Never put credentials, addresses, or raw device or service messages in a contract or a module.
