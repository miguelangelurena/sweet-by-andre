import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";

export function createRecoveryTerminal({ input = process.stdin, output = process.stdout } = {}) {
  if (!input.isTTY || !output.isTTY) throw new Error("Recovery requires an interactive terminal");
  let muted = false;
  const sink = new Writable({ write(chunk, _encoding, done) {
    if (!muted) output.write(chunk);
    done();
  } });
  sink.isTTY = true;
  sink.columns = output.columns;
  const terminal = createInterface({ input, output: sink, terminal: true, historySize: 0 });
  const controller = new AbortController();
  terminal.on("SIGINT", () => { controller.abort(); terminal.close(); });
  const ask = prompt => terminal.question(prompt, { signal: controller.signal });
  return {
    ask,
    async hidden(prompt) {
      output.write(prompt);
      muted = true;
      try { return await ask(""); }
      finally { muted = false; output.write("\n"); }
    },
    close() { controller.abort(); terminal.close(); },
  };
}
