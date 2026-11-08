// Grouped voice/typed commands shown in the Help dialog and the README.
export const VOICE_GROUPS: { title: string; items: string[] }[] = [
  { title: "Play and move", items: ["play", "pause", "go to 10 seconds", "go to the start", "skip forward 5 seconds", "next clip", "previous clip"] },
  { title: "Cut and trim", items: ["split here", "split at 3 seconds", "delete clip", "ripple delete", "duplicate", "trim start to 1.5 seconds", "trim end to 4 seconds", "cut the first 2 seconds"] },
  { title: "Speed and sound", items: ["speed up 2x", "slow down", "half speed", "normal speed", "mute", "unmute", "volume 50%", "add music", "record voice-over"] },
  { title: "Look and feel", items: ["add crossfade", "add slide transition", "dip to black", "fade in", "fade out", "add filter kopi warm", "make it black and white", "make it bigger", "rotate 90 degrees", "flip"] },
  { title: "Text and stickers", items: ["add text 'Save first' at 2 seconds", "add title “Kopi & Coins” for 3 seconds", "add sticker fire", "auto captions"] },
  { title: "Canvas, files, export", items: ["make it vertical", "make it 9:16", "make it YouTube", "make it square", "zoom in", "undo", "redo", "save project", "export for TikTok", "export for YouTube in 4K"] },
];
