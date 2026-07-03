import { describe, it, expect } from 'vitest';
import {
  replacePlantUmlBlock,
  findPlantUmlBlockSource,
  extractPlantUmlFromResponse,
} from '../replacePlantUmlBlock';

describe('replacePlantUmlBlock', () => {
  const md = `# Title

\`\`\`plantuml
@startuml
a -> b
@enduml
\`\`\`

text
`;

  it('replaces first matching block by trimmed content', () => {
    const oldSrc = '@startuml\na -> b\n@enduml';
    const newSrc = '@startuml\na -> b : ok\n@enduml';
    const result = replacePlantUmlBlock(md, oldSrc, newSrc);
    expect(result).toContain('a -> b : ok');
    expect(result).not.toContain('a -> b\n@enduml');
  });

  it('only replaces first match when duplicates exist', () => {
    const dup = `\`\`\`plantuml\nsame\n\`\`\`\n\n\`\`\`plantuml\nsame\n\`\`\``;
    const result = replacePlantUmlBlock(dup, 'same', 'fixed');
    expect(result.match(/fixed/g)?.length).toBe(1);
    expect(result).toContain('```plantuml\nsame\n```');
  });

  it('returns unchanged when no match', () => {
    expect(replacePlantUmlBlock(md, 'missing', 'x')).toBe(md);
  });
});

describe('findPlantUmlBlockSource', () => {
  it('finds existing block', () => {
    const md = '```plantuml\n@startuml\nx\n@enduml\n```';
    expect(findPlantUmlBlockSource(md, '@startuml\nx\n@enduml')).toBe('@startuml\nx\n@enduml');
  });

  it('returns undefined when not found', () => {
    expect(findPlantUmlBlockSource('```plantuml\na\n```', 'b')).toBeUndefined();
  });
});

describe('extractPlantUmlFromResponse', () => {
  it('extracts fenced plantuml block', () => {
    const text = '说明如下：\n```plantuml\n@startuml\na->b\n@enduml\n```';
    expect(extractPlantUmlFromResponse(text)).toBe('@startuml\na->b\n@enduml');
  });

  it('extracts bare @startuml text', () => {
    expect(extractPlantUmlFromResponse('@startuml\na\n@enduml')).toBe('@startuml\na\n@enduml');
  });

  it('returns null when no diagram found', () => {
    expect(extractPlantUmlFromResponse('no diagram here')).toBeNull();
  });
});
