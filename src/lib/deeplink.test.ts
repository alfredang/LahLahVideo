import { describe, expect, it } from "vitest";
import { parseDeepLink } from "./deeplink";

describe("lahlahvideo:// links", () => {
  it("opens absolute paths, encoded or not, with spaces and plus signs", () => {
    const path = "/Users/ah/Kopi & Coins/ep 1+2/lahlah-edit.json";
    expect(parseDeepLink(`lahlahvideo://open?file=${encodeURIComponent(path)}`)).toEqual({ kind: "open", file: path });
    expect(parseDeepLink(`lahlahvideo://open/?file=${encodeURIComponent(path)}`)).toEqual({ kind: "open", file: path });
    expect(parseDeepLink(`lahlahvideo:open?path=${encodeURIComponent(path)}`)).toEqual({ kind: "open", file: path });
    expect(parseDeepLink("lahlahvideo://open?file=/tmp/a.lahlah")).toEqual({ kind: "open", file: "/tmp/a.lahlah" });
    expect(parseDeepLink("LAHLAHVIDEO://Open?File=%2Ftmp%2Fx.json")).toEqual({ kind: "open", file: "/tmp/x.json" });
  });

  it("accepts file:// URLs and Windows paths", () => {
    expect(parseDeepLink(`lahlahvideo://open?file=${encodeURIComponent("file:///Users/ah/My%20Edit/lahlah-edit.json")}`)).toEqual({ kind: "open", file: "/Users/ah/My Edit/lahlah-edit.json" });
    expect(parseDeepLink(`lahlahvideo://open?file=${encodeURIComponent("C:\\Users\\ah\\edit.json")}`)).toEqual({ kind: "open", file: "C:\\Users\\ah\\edit.json" });
    expect(parseDeepLink(`lahlahvideo://open?file=${encodeURIComponent("file:///C:/Users/ah/edit.json")}`)).toEqual({ kind: "open", file: "C:/Users/ah/edit.json" });
  });

  it("runs commands", () => {
    expect(parseDeepLink("lahlahvideo://command?text=split%20at%203%20seconds")).toEqual({ kind: "command", text: "split at 3 seconds" });
    expect(parseDeepLink("lahlahvideo://command?text=add+crossfade")).toEqual({ kind: "command", text: "add crossfade" });
    expect(parseDeepLink("lahlahvideo://command/?text=export%20for%20TikTok")).toEqual({ kind: "command", text: "export for TikTok" });
  });

  it("ignores anything else", () => {
    expect(parseDeepLink("https://example.com").kind).toBe("unknown");
    expect(parseDeepLink("lahlahvideo://open").kind).toBe("unknown");
    expect(parseDeepLink("lahlahvideo://launch?x=1").kind).toBe("unknown");
  });
});
