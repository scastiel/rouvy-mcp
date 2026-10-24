/** The CLI's only view of the terminal, so commands can be driven from tests. */
export interface Terminal {
  ask(question: string): Promise<string>;
  /** Like `ask`, without echoing what the rider types. */
  askHidden(question: string): Promise<string>;
  print(line: string): void;
  printError(line: string): void;
}
