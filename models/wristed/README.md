# Video-referenced rigid instrument

`instrument.blend` is an editable approximation made with local Blender 5.2 from
`assets/video_20260907_162126.mp4` (especially the view around 49 seconds).
The reference video stays local. This is a visual model, not dimensioned CAD.

Includes a gray/ivory proximal housing, black exit collar, silver sleeve with
128 through-holes, two wrist hinges, and two tapered, serrated jaws.
The deformable continuum is omitted from the Blender asset. The viewer sweeps
closed, opaque black sleeves along its kinematic frames in model mode, and
retains the original continuum drawing in line mode.

Regenerate from the repository root:

```sh
blender --background --python tools/build_wristed_model.py
```

On this WSL workstation:

```sh
'/mnt/c/Program Files/Blender Foundation/Blender 5.2/blender.exe' --background \
  --python "$(wslpath -w "$PWD/tools/build_wristed_model.py")"
```

The script writes this `.blend` and
`apps/browser/src/wristed/models/instrument.glb`. The GLB is bundled by Vite,
including in the browser distribution copied to the VS Code extension.
No Blender installation is needed to run the UI.

The Blender source shows an assembled reference pose with a gap for the omitted
continuum. Exported part groups have identity transforms, use **Z-up, mm**, and
origins at the relevant articulation pivots. Do not enable glTF Y-up conversion
without also updating the loader.

| Part | Runtime frame | Nominal dimensions |
| --- | --- | --- |
| housing | Fixed origin | Approximate 27 mm diameter |
| shaft | Continuum tip, with wrist roll | 39.4 mm sleeve assembly, 8 mm diameter |
| mount | `link1` | X-axis pitch clevis |
| wrist | `wrist1` | 8.89 mm between pivots |
| jawLeft / jawRight | `jawLeft` / `jawRight` | 9 mm from pivot to tip |

The viewer scales the sleeve, inter-pivot link, and jaws with the existing
instrument dimensions. The model is intended for normal instrument proportions;
extreme independent dimensions or joint angles can make cosmetic shells intersect.
The underlying kinematics are unchanged. The panel's **线条 / 模型** button persists
with its configuration; old configurations still open in line mode.
