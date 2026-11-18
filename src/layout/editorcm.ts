// CodeMirror 6 for the Code editor window. Only codeeditor.ts imports this,
// and only through a dynamic import() the first time a file is opened, so
// CodeMirror stays out of the main bundle (it becomes its own chunk).
//
// One EditorState per open file: switching tabs swaps the state into the one
// EditorView, so each file keeps its cursor, selection, undo history and
// scroll position. Documents are known by the numeric id codeeditor.ts gives.

import { basicSetup, EditorView } from 'codemirror';
import { indentWithTab } from '@codemirror/commands';
import { cpp } from '@codemirror/lang-cpp';
import { json } from '@codemirror/lang-json';
import { python } from '@codemirror/lang-python';
import { HighlightStyle, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { Annotation, EditorState, StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, keymap } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import { resolveJump } from './editorjump';
import type { EditorLanguage } from './editorlang';
import { minimalChange } from './editorsync';

/** What codeeditor.ts uses of the editor. */
export interface CodeSurface {
  has(id: number): boolean;
  /**
   * Start a document (its own state); nothing is shown yet. A read-only one
   * cannot be typed into but its text can still be selected and copied.
   */
  open(id: number, text: string, language: EditorLanguage, readOnly?: boolean): void;
  /** Show a document; its cursor, history and scroll position come back. */
  show(id: number): void;
  /** Current text of a document. */
  text(id: number): string;
  /**
   * Replace the text with one from outside (the project changed). Only the
   * changed part is edited, so the cursor stays; this is not reported as a
   * user edit.
   */
  replace(id: number, text: string): void;
  /** Forget a document. */
  drop(id: number): void;
  focus(): void;
  /**
   * Move the cursor of a shown document to a 1-based line and column (clamped),
   * scroll it into view and flash the line briefly (CSS class cm-flash-line).
   * Does nothing unless the document is the one in front.
   */
  reveal(id: number, line: number, column?: number): void;
  /** Look at the size again (the window was shown or resized). */
  measure(): void;
}

/** Marks changes made from outside; they are not reported as edits. */
const fromOutside = Annotation.define<boolean>();

/** How long a revealed line flashes (matches the animation in codeeditor.css). */
const FLASH_MS = 1500;
const flashOn = StateEffect.define<number>();
const flashOff = StateEffect.define<null>();
const flashLine = Decoration.line({ class: 'cm-flash-line' });

/** The line that flashes now (document offset of its start), as a line decoration. */
const flashField = StateField.define({
  create: () => Decoration.none,
  update(value, tr) {
    let next = value.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(flashOff)) next = Decoration.none;
      else if (e.is(flashOn)) next = Decoration.set([flashLine.range(e.value)]);
    }
    return next;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// Colours of the app (see dock.css, serialconsole.css, fileexplorer.css).
const COLOR = {
  bg: '#18191c',
  gutter: '#1e1f22',
  panel: '#25272c',
  raised: '#2b2e34',
  border: '#3a3d44',
  text: '#d8dbe0',
  muted: '#7d828c',
  dim: '#9aa0aa',
  accent: '#4ea1ff',
  selection: '#26466b',
  error: '#e5534b',
};

const theme = EditorView.theme(
  {
    '&': { height: '100%', backgroundColor: COLOR.bg, color: COLOR.text, fontSize: '12.5px' },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': { fontFamily: 'ui-monospace, Consolas, monospace', lineHeight: '1.45', overflow: 'auto' },
    '.cm-content': { caretColor: COLOR.accent, padding: '4px 0' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: COLOR.accent },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, & .cm-content ::selection': {
      backgroundColor: COLOR.selection,
    },
    '.cm-selectionBackground': { backgroundColor: COLOR.raised },
    '.cm-activeLine': { backgroundColor: 'rgba(255, 255, 255, 0.04)' },
    '.cm-gutters': { backgroundColor: COLOR.gutter, color: COLOR.muted, border: 'none', borderRight: `1px solid ${COLOR.border}` },
    '.cm-activeLineGutter': { backgroundColor: COLOR.raised, color: COLOR.text },
    '.cm-foldPlaceholder': { backgroundColor: COLOR.raised, border: `1px solid ${COLOR.border}`, color: COLOR.dim },
    '&.cm-focused .cm-matchingBracket': { backgroundColor: 'rgba(78, 161, 255, 0.22)', outline: `1px solid ${COLOR.accent}` },
    '&.cm-focused .cm-nonmatchingBracket': { backgroundColor: 'rgba(229, 83, 75, 0.25)' },
    '.cm-selectionMatch': { backgroundColor: 'rgba(78, 161, 255, 0.18)' },
    '.cm-searchMatch': { backgroundColor: 'rgba(230, 179, 106, 0.25)', outline: '1px solid rgba(230, 179, 106, 0.5)' },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'rgba(78, 161, 255, 0.35)' },
    '.cm-panels': { backgroundColor: COLOR.panel, color: COLOR.text, fontFamily: 'system-ui, sans-serif' },
    '.cm-panels.cm-panels-top': { borderBottom: `1px solid ${COLOR.border}` },
    '.cm-panels.cm-panels-bottom': { borderTop: `1px solid ${COLOR.border}` },
    '.cm-panel.cm-search': { padding: '5px 28px 5px 8px', fontSize: '12px' },
    '.cm-panel.cm-search input, .cm-panel.cm-search button': { font: 'inherit', fontSize: '12px' },
    '.cm-panel.cm-search input.cm-textfield': {
      padding: '2px 4px', border: `1px solid ${COLOR.border}`, borderRadius: '4px', backgroundColor: COLOR.gutter, color: COLOR.text,
    },
    '.cm-panel.cm-search input.cm-textfield:focus': { borderColor: COLOR.accent, outline: 'none' },
    '.cm-panel.cm-search button.cm-button': {
      backgroundImage: 'none', backgroundColor: COLOR.raised, color: COLOR.text, border: `1px solid ${COLOR.border}`, borderRadius: '4px',
    },
    '.cm-panel.cm-search button.cm-button:hover': { borderColor: COLOR.accent },
    '.cm-panel.cm-search label': { color: COLOR.dim },
    '.cm-panel.cm-search [name=close]': { color: COLOR.dim },
    '.cm-tooltip': { backgroundColor: COLOR.panel, border: `1px solid ${COLOR.border}`, color: COLOR.text },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: COLOR.selection, color: '#fff' },
  },
  { dark: true },
);

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.definitionKeyword, t.moduleKeyword, t.modifier], color: '#6fb3ff' },
  { tag: [t.string, t.special(t.string), t.character], color: '#9fd18b' },
  { tag: [t.number, t.bool, t.null, t.atom], color: '#e6b36a' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: COLOR.muted, fontStyle: 'italic' },
  { tag: [t.typeName, t.className, t.namespace, t.standard(t.typeName)], color: '#7fd1c7' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: '#e6d38a' },
  { tag: [t.meta, t.processingInstruction], color: '#c792ea' },
  { tag: [t.escape, t.regexp], color: '#e6b36a' },
  { tag: [t.operator, t.punctuation, t.bracket], color: '#b4bac4' },
  { tag: t.invalid, color: COLOR.error },
]);

function languageExtension(language: EditorLanguage): Extension {
  if (language === 'cpp') return cpp();
  if (language === 'python') return python();
  if (language === 'json') return json();
  return [];
}

interface Doc {
  state: EditorState;
  /** Where the view was scrolled when the document was last in front. */
  scroll: StateEffect<unknown> | null;
}

export function createSurface(parent: HTMLElement, onEdit: (id: number) => void): CodeSurface {
  const docs = new Map<number, Doc>();
  let current: number | null = null;

  const extensions = (id: number, language: EditorLanguage, readOnly: boolean): Extension => [
    basicSetup, // line numbers, active line, bracket matching, history, search (Ctrl+F), indent on input ...
    keymap.of([indentWithTab]),
    EditorState.tabSize.of(2),
    indentUnit.of('  '),
    theme,
    flashField,
    syntaxHighlighting(highlight),
    languageExtension(language),
    EditorView.contentAttributes.of({ 'aria-label': readOnly ? 'Code viewer (read only)' : 'Code editor' }),
    // Read only: no typing (readOnly), no caret (editable false), but the text can be selected and copied.
    // The content stays focusable so keys aimed at it never reach the grid.
    readOnly
      ? [EditorState.readOnly.of(true), EditorView.editable.of(false), EditorView.contentAttributes.of({ tabindex: '0' })]
      : [],
    EditorView.updateListener.of((u) => {
      if (u.transactions.some((tr) => tr.docChanged && !tr.annotation(fromOutside))) onEdit(id);
    }),
  ];

  const view = new EditorView({ parent });
  let flashTimer = 0;

  /** Keep the state and scroll of the document in front. */
  function park(): void {
    const doc = current === null ? undefined : docs.get(current);
    if (doc) {
      doc.state = view.state;
      doc.scroll = view.scrollSnapshot();
    }
  }

  return {
    has: (id) => docs.has(id),

    open(id, text, language, readOnly = false) {
      docs.set(id, { state: EditorState.create({ doc: text, extensions: extensions(id, language, readOnly) }), scroll: null });
    },

    show(id) {
      const doc = docs.get(id);
      if (!doc || current === id) return;
      park();
      current = id;
      window.clearTimeout(flashTimer);
      view.setState(doc.state);
      view.dispatch({ effects: flashOff.of(null) }); // a flash that was cut short by switching away must not come back
      if (doc.scroll) view.dispatch({ effects: doc.scroll });
    },

    text(id) {
      const doc = docs.get(id);
      if (!doc) return '';
      return (current === id ? view.state : doc.state).doc.toString();
    },

    replace(id, text) {
      const doc = docs.get(id);
      if (!doc) return;
      const state = current === id ? view.state : doc.state;
      const change = minimalChange(state.doc.toString(), text);
      if (!change) return;
      const spec = { changes: change, annotations: fromOutside.of(true) };
      if (current === id) view.dispatch(spec);
      else doc.state = state.update(spec).state;
    },

    drop(id) {
      docs.delete(id);
      if (current === id) current = null;
    },

    reveal(id, line, column) {
      if (current !== id) return;
      const place = resolveJump(view.state.doc, { line, column });
      const from = view.state.doc.line(place.line).from;
      window.clearTimeout(flashTimer);
      view.dispatch({
        selection: { anchor: place.pos },
        effects: [EditorView.scrollIntoView(place.pos, { y: 'center' }), flashOff.of(null), flashOn.of(from)],
      });
      flashTimer = window.setTimeout(() => view.dispatch({ effects: flashOff.of(null) }), FLASH_MS);
    },

    focus: () => view.focus(),
    measure: () => view.requestMeasure(),
  };
}
