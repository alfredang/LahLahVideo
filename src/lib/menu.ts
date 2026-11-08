// File menu entries, shared by the in-app File button and the native menu bar (desktop).
import { exportSrt, importDialog, importSrt, newProjectAction, openDialog, saveProject } from "../actions";
import { openClaudePanel, setUI } from "./store";
import { isDesktop, isMac } from "./platform";

export interface MenuEntry {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

export const FILE_MENU: (MenuEntry | "-")[] = [
  { id: "new", label: "New project", run: () => newProjectAction() },
  { id: "open", label: "Open project…", hint: "Ctrl/Cmd+O", run: () => void openDialog() },
  { id: "open-edit", label: "Open edit… (lahlah-edit.json)", hint: "Claude's Higgsfield hand-off", run: () => void openDialog() },
  "-",
  { id: "save", label: "Save project", hint: "Ctrl/Cmd+S", run: () => void saveProject() },
  { id: "save-as", label: "Save project as…", run: () => void saveProject(true) },
  "-",
  { id: "import", label: "Import media…", run: () => void importDialog(undefined, { toTimeline: true }) },
  { id: "import-srt", label: "Import captions (SRT)…", run: () => void importSrt() },
  { id: "export-srt", label: "Export captions (SRT)…", run: () => void exportSrt() },
  "-",
  { id: "export", label: "Export video…", hint: "Ctrl/Cmd+E", run: () => setUI({ exportOpen: true }) },
  { id: "capcut", label: "Open in CapCut instead…", run: openClaudePanel },
  "-",
  { id: "settings", label: "Settings and API key…", run: () => setUI({ settingsOpen: true }) },
];

/** Native menu bar. Accelerators are left to the in-app keyboard handler so nothing fires twice. */
export async function installNativeMenu() {
  if (!isDesktop) return;
  try {
    const { Menu, Submenu, MenuItem, PredefinedMenuItem } = await import("@tauri-apps/api/menu");
    const sep = () => PredefinedMenuItem.new({ item: "Separator" });
    const fileItems = [];
    for (const e of FILE_MENU) {
      if (e === "-") fileItems.push(await sep());
      else fileItems.push(await MenuItem.new({ id: e.id, text: e.label, action: () => e.run() }));
    }
    if (!isMac) fileItems.push(await sep(), await PredefinedMenuItem.new({ item: "Quit", text: "Exit" }));
    const items = [];
    if (isMac) {
      items.push(
        await Submenu.new({
          text: "LahLah Video",
          items: [
            await PredefinedMenuItem.new({ item: { About: { name: "LahLah Video", copyright: "From the makers of LahLah Voice. Tertiary Infotech Academy." } } }),
            await sep(),
            await PredefinedMenuItem.new({ item: "Hide" }),
            await PredefinedMenuItem.new({ item: "HideOthers" }),
            await PredefinedMenuItem.new({ item: "ShowAll" }),
            await sep(),
            await PredefinedMenuItem.new({ item: "Quit" }),
          ],
        }),
      );
    }
    items.push(await Submenu.new({ text: "File", items: fileItems }));
    items.push(
      await Submenu.new({
        text: "Edit",
        items: [
          await PredefinedMenuItem.new({ item: "Cut" }),
          await PredefinedMenuItem.new({ item: "Copy" }),
          await PredefinedMenuItem.new({ item: "Paste" }),
          await PredefinedMenuItem.new({ item: "SelectAll" }),
          await sep(),
          await MenuItem.new({ id: "cmd", text: "Command bar… (Ctrl/Cmd+K)", action: () => setUI({ commandOpen: true }) }),
        ],
      }),
    );
    items.push(
      await Submenu.new({
        text: "Help",
        items: [
          await MenuItem.new({ id: "help", text: "Voice commands and shortcuts", action: () => setUI({ helpOpen: true }) }),
          await MenuItem.new({ id: "voice", text: "LahLah Voice (dictation for Mac)", action: () => void import("@tauri-apps/plugin-opener").then((o) => o.openUrl("https://alfredang.github.io/lahlahvoiceapp/")) }),
        ],
      }),
    );
    const menu = await Menu.new({ items });
    await menu.setAsAppMenu();
  } catch (e) {
    console.warn("Native menu unavailable", e);
  }
}
