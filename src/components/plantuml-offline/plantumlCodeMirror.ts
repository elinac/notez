import { LanguageSupport, StreamLanguage } from '@codemirror/language';

type PlantUmlState = {
  inBlockComment: boolean;
};

const DIRECTIVE = /^@(start|end)[\w-]*/;
const PREPROCESSOR = /^![\w-]+/;
const ARROW =
  /^(<-?->?>|<--?>|<\.{2}>?|\.{2}>?|--?>|->>?|o->|->o|\\\|>|\/\/|<<|--|\.\.>|->)/;
const QUOTED_STRING = /^"([^"\\]|\\.)*"/;
const STEREOTYPE = /^<<[^>]+>>/;
const KEYWORD =
  /^(participant|actor|package|class|interface|enum|abstract|node|folder|database|cloud|component|rectangle|artifact|frame|storage|collections|queue|stack|note|alt|else|opt|loop|group|par|and|break|ref|title|legend|skinparam|activate|deactivate|autonumber|destroy|create|hide|show|as|of|over|left|right|center|top|bottom|using)\b/i;

const plantumlLanguage = StreamLanguage.define<PlantUmlState>({
  name: 'plantuml',
  startState: () => ({ inBlockComment: false }),
  copyState: (s) => ({ ...s }),
  languageData: {
    commentTokens: { line: "'" },
  },
  token(stream, state) {
    if (stream.eatSpace()) return null;

    if (!state.inBlockComment && stream.match(/^'/)) {
      stream.skipToEnd();
      return 'comment';
    }

    if (stream.match(/^\/'/)) {
      state.inBlockComment = true;
      return 'comment';
    }

    if (state.inBlockComment) {
      if (stream.match(/^'\//)) {
        state.inBlockComment = false;
        return 'comment';
      }
      stream.skipToEnd();
      return 'comment';
    }

    if (stream.match(DIRECTIVE)) return 'meta';
    if (stream.match(PREPROCESSOR)) return 'meta';
    if (stream.match(ARROW)) return 'operator';
    if (stream.match(QUOTED_STRING)) return 'string';
    if (stream.match(STEREOTYPE)) return 'typeName';
    if (stream.match(/^[{}[\]();]/)) return 'bracket';

    if (stream.match(/^end\s+note\b/i)) return 'keyword';
    if (stream.match(/^end\s+(legend|title|header|footer|box|fork|split|group)\b/i)) {
      return 'keyword';
    }

    if (stream.match(KEYWORD)) return 'keyword';

    if (stream.match(/^[A-Za-z_][\w.-]*/)) {
      const word = stream.current();
      if (/^\d/.test(word)) return 'number';
      return 'variableName';
    }

    if (stream.match(/^[0-9]+/)) return 'number';
    if (stream.match(/^:/)) return 'operator';

    stream.next();
    return null;
  },
});

/** CodeMirror syntax highlighting for ```plantuml fenced blocks in edit mode. */
export function plantumlLanguageSupport(): LanguageSupport {
  return new LanguageSupport(plantumlLanguage);
}
