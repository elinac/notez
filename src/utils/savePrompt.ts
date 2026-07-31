export type SavePromptChoice = 'save' | 'discard' | 'cancel';

type Handler = (message: string) => Promise<SavePromptChoice>;

let handler: Handler | null = null;
let running = false;
const queue: Array<{
  message: string;
  resolve: (choice: SavePromptChoice) => void;
}> = [];

function processQueue(): void {
  if (running || queue.length === 0) return;
  running = true;

  const { message, resolve } = queue.shift()!;
  const current = handler;

  const run = async (): Promise<SavePromptChoice> => {
    if (!current) return 'cancel';
    try {
      return await current(message);
    } catch {
      return 'cancel';
    }
  };

  run().then(
    (choice) => {
      resolve(choice);
      running = false;
      processQueue();
    },
    () => {
      resolve('cancel');
      running = false;
      processQueue();
    },
  );
}

export function registerSavePromptHandler(next: Handler | null): void {
  handler = next;
}

export function promptSaveChanges(message: string): Promise<SavePromptChoice> {
  return new Promise((resolve) => {
    queue.push({ message, resolve });
    processQueue();
  });
}
