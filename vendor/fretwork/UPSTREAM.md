# Embedded Fretwork

Source: https://github.com/bubiche/fretwork
Revision: e72878a19ab4ff82bc3d29a936a498add95bdf3b (MIT; see LICENSE).

LoopStudio vendors the editor commands, selection, keyboard routing and selected UI components.
The upstream repository is not required at runtime or to build this checkout.
`embed.tsx` is the LoopStudio entry point. No upstream library, IndexedDB autosave, sample scores,
microphone capture, Basic Pitch or TensorFlow code is included. Native analysis remains in LoopStudio.
Only the Sonivox sound bank is shipped (Apache-2.0 notice in public/soundfont/LICENSE).
Bravura's SIL Open Font License and notices are in public/font.

The embedded page and all assets are built locally into public/fretwork before the main build.
Host messages are restricted to the parent window, same origin and an editor-session token.
GP7 snapshots cross the boundary; no filesystem access is exposed to the frame.
The host owns persistence and acknowledges completion. Failed writes leave the editor open.

Local changes: embed.tsx and embed.css added; soundfont selector limited to bundled Sonivox.
Both applications resolve the same pinned AlphaTab installation. Upstream UI is not a public API;
updates require command/GP7 round-trip tests and a review of editor lifecycle and save behavior.

Further local adapters: piano pitch editing; keyboard guards for unstringed staves; GP7 export through src/gp7Export.ts to retain piano pitches and avoid AlphaTab 1.9 automatic guitar fingering on export.
