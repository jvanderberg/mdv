import "./styles.css";

const root = requireRoot();

function requireRoot(): Element {
  const element = document.querySelector("#app");
  if (!element) throw new Error("#app not found");
  return element;
}

function showStartupError(reason: unknown) {
  const message = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
  root.replaceChildren();

  const panel = document.createElement("main");
  panel.style.cssText =
    "box-sizing:border-box;max-width:720px;margin:64px auto;padding:24px;font:15px/1.5 -apple-system,BlinkMacSystemFont,sans-serif;color:#242424";
  const title = document.createElement("h1");
  title.style.cssText = "font-size:20px;margin:0 0 12px";
  title.textContent = "mdv could not start";
  const detail = document.createElement("pre");
  detail.style.cssText =
    "margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 ui-monospace,SFMono-Regular,monospace";
  detail.textContent = message;
  panel.append(title, detail);
  root.append(panel);
}

void import("./bootstrap")
  .then(({ startApplication }) => startApplication(root))
  .catch(showStartupError);
