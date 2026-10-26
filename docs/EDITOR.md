# Layout editor

Layouts with the command dock (`command-57`, `command-1080`) can be rearranged on the screen itself. Press **E** or the pencil next to the night and privacy buttons to enter edit mode, and **E**, **Esc** or **DONE** to leave it. Data keeps refreshing while you edit.

| To | Do |
| --- | --- |
| Change column widths | Drag a cyan line between OPS / BUSINESS / MARKETS. The widths go into the preset that is active in the dock: BALANCED, or the OPS / BUSINESS / MARKETS focus. Each preset keeps its own widths. |
| Resize rows or columns inside a column | Drag the amber lines inside it. |
| Move a panel | Drag its **⠿ MOVE** grip onto another panel (it follows the pointer), or **click** MOVE and then click the panel to swap with (Esc cancels). They swap contents, and each spot keeps its size, so the shape of the wall doesn't change. Works across columns. On the Lively wallpaper, click-to-swap is the easy way: Windows draws its desktop selection box during a drag, which is harmless but distracting. |
| Make a panel bigger or smaller | Drag its bottom-right corner. It snaps to whole grid cells, and the label shows columns × rows. |
| Add a panel | **+ PANEL** in a column head, then pick a module. |
| Remove a panel | **×** on the panel. |
| Undo | **UNDO** or Ctrl+Z (the last 50 changes). |
| Start over | **RESET**, pressed twice. UNDO still brings your edits back. |

Every change is saved as soon as it is made. A change that would make the layout invalid is not applied, and the bar says why.

## Where edits live

Edits are kept in the browser they were made in, per layout. **Lively's browser and Chrome on the same PC are separate.** To edit the wall that Lively shows, edit it in Lively itself, with the desktop showing and wallpaper mouse input on. Alternatively, edit in Chrome, **EXPORT**, then press E on the wall and **IMPORT** the file.

**EXPORT** downloads the layout as `<layout>.json`. Send it over to make it the built-in layout for every screen.

When a release changes the built-in layout, your edited copy stays in use and the editor bar says the default changed. **RESET** picks up the new default. If a release changes which regions a layout has, edits for it are dropped.
