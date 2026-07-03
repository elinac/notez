/** Extract PlantUML source from AI response text. */
export function extractPlantUmlFromResponse(text: string): string | null {
  const fence = text.match(/```(?:plantuml|puml)?\r?\n([\s\S]*?)```/i);
  if (fence) return fence[1].trim();
  const trimmed = text.trim();
  if (/@start\w+/i.test(trimmed)) return trimmed;
  return null;
}

const PLANTUML_BLOCK_RE = /```plantuml\r?\n([\s\S]*?)```/g;

/** Replace the first ```plantuml block whose trimmed body equals oldSource. */
export function replacePlantUmlBlock(
  content: string,
  oldSource: string,
  newSource: string
): string {
  const oldTrim = oldSource.trim();
  const newTrim = newSource.trim();
  let replaced = false;

  return content.replace(PLANTUML_BLOCK_RE, (match, code: string) => {
    if (!replaced && code.trim() === oldTrim) {
      replaced = true;
      return `\`\`\`plantuml\n${newTrim}\n\`\`\``;
    }
    return match;
  });
}

/** Find trimmed body of the first matching plantuml block, or undefined. */
export function findPlantUmlBlockSource(
  content: string,
  sourceToMatch: string
): string | undefined {
  const target = sourceToMatch.trim();
  let found: string | undefined;

  content.replace(PLANTUML_BLOCK_RE, (_match, code: string) => {
    if (found === undefined && code.trim() === target) {
      found = code.trim();
    }
    return _match;
  });

  return found;
}
