import { createInterface } from "node:readline/promises";
import type { Terminal } from "./terminal.js";

/** The real terminal: prompts on stdin/stderr, results on stdout. */
export function createNodeTerminal(): Terminal {
  return {
    async ask(question) {
      const rl = createInterface({ input: process.stdin, output: process.stderr });
      try {
        return await rl.question(question);
      } finally {
        rl.close();
      }
    },
    async askHidden(question) {
      process.stderr.write(question);
      if (!process.stdin.isTTY) return readLine();
      return readHiddenLine();
    },
    print(line) {
      process.stdout.write(line + "\n");
    },
    printError(line) {
      process.stderr.write(line + "\n");
    },
  };
}

async function readLine(): Promise<string> {
  const rl = createInterface({ input: process.stdin, terminal: false });
  try {
    return await rl.question("");
  } finally {
    rl.close();
  }
}

/** Reads keystrokes in raw mode so nothing typed is ever echoed. */
function readHiddenLine(): Promise<string> {
  const stdin = process.stdin;
  return new Promise((resolve) => {
    let typed = "";
    const finish = () => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stderr.write("\n");
    };
    const onData = (chunk: Buffer) => {
      for (const char of chunk.toString("utf8")) {
        if (char === "\r" || char === "\n" || char === "\u0004") {
          finish();
          return resolve(typed);
        }
        if (char === "\u0003") {
          finish();
          process.exit(130);
        }
        if (char === "\u007f" || char === "\b") typed = typed.slice(0, -1);
        else typed += char;
      }
    };
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}
