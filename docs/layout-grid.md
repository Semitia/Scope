# Shared panel grid

Desktop panel geometry uses a single origin at the workspace's top-left corner.
The existing 12-column / 84px-row coordinate system is subdivided into quarters:
48 cells across the workspace, and 21px per vertical cell. Horizontal cells scale
with the workspace width, so viewport changes preserve shared edges and full-width
panels. The old 25px increment per gesture is no longer used.

Pointer movement remains continuous. Nearby panel edges can attract a dragged or
resized panel; on release, final edges are rounded to the shared grid. Moving
preserves size; resizing rounds the final right and bottom coordinates. Minimum
sizes and workspace bounds also lie on the grid. Card gutters are insets inside
these layout cells, rather than additional spacing between grid rows.

Saved and imported legacy layouts are rounded by their edges, including their
starting positions. If enforcing minimum sizes produces an overlap, later panels
are moved below blockers on the same grid. All layout updates are normalized before
saving. Collapsed panels reserve whole cells (42px vertically, including any card
gutter), so reflow and expansion cannot leave fractional offsets. The narrow-screen
stacked layout retains its compact header height and does not support manual dragging.
