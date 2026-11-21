// A page that plays Eva for the tests: it shows the widget in a frame, answers "hello" with the
// allowed asks, and answers each other ask with ok after recording it (round 3 plan, section 3.1).
// The frame has no sandbox here: the static test server sends no CORS header for the module script.
window.received = [];

window.startFrame = ({ asks, size, width, height }) => {
  const frame = document.createElement("iframe");
  frame.src = `../index.html?size=${size}`;
  frame.width = String(width);
  frame.height = String(height);
  frame.style.border = "0";
  document.body.append(frame);
  window.addEventListener("message", (message) => {
    const data = message.data;
    if (message.source !== frame.contentWindow || data?.eva !== "widget") return;
    if (data.ask === "hello") {
      frame.contentWindow.postMessage({ eva: "widget", id: data.id, ok: true, asks }, "*");
      return;
    }
    window.received.push(data);
    const allowed = asks.includes(data.ask);
    frame.contentWindow.postMessage(
      allowed
        ? { eva: "widget", id: data.id, ok: true }
        : { eva: "widget", id: data.id, ok: false, reason: "not-allowed" },
      "*",
    );
  });
};
