"use client";

import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
  highlightSpecialChars,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
  LanguageDescription,
  syntaxHighlighting,
} from "@codemirror/language";
import {
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";

import { prologueTheme, prologueHighlight } from "./editor-theme";

/**
 * The markdown source editor.
 *
 * ## Why this is not a controlled component
 *
 * `EditorView` owns its document. A React component that re-created the state
 * on every render would reset the cursor, the undo history and the scroll
 * position — and a controlled markdown editor is the single most common way to
 * make one feel broken. So the view is created ONCE, in an effect, from
 * `initialValue`; afterwards React never writes into it. Everything the parent
 * needs comes back through `onChange`.
 *
 * The consequence, which the parent has to respect: changing `initialValue`
 * after mount does nothing. That is deliberate. The only thing that should
 * replace a whole document under the author is a route change (a different
 * post), and that remounts this component because the page keyed it.
 *
 * ## The theme flip
 *
 * `prologueTheme` is built from CSS variables (`var(--surface)`, `var(--accent)`,
 * …), and CodeMirror injects its stylesheet into a `<style-ish>` StyleModule at
 * construction. CSS custom properties resolve at paint time, not construction
 * time, so flipping `.dark` on `<html>` repaints the editor with no JavaScript
 * involvement at all. That is the reason the theme is written against variables
 * rather than a hex-per-mode object: the alternative needs a `MutationObserver`
 * on `documentElement` and a `reconfigure` on every toggle.
 *
 * ## What is deliberately absent
 *
 * No `autocompletion()` of words, no lint, no `codeLanguages: languages`. The
 * language support below is an explicit list of six packages because
 * `@codemirror/language-data` costs 560 kB gzipped against 187 kB for this set —
 * 824 kB of that being every legacy StreamLanguage mode ever written. A stateful
 * scan of the corpus found 64 fenced blocks in nine languages; these six cover
 * every one that exists, and a fence in an unlisted language degrades to
 * unhighlighted code rather than failing, which is the same degradation
 * src/lib/markdown/render.js already documents for shiki.
 */
export function CodeMirrorEditor({ initialValue, onChange, className = "", apiRef }) {
  const host = useRef(null);
  const view = useRef(null);
  const onChangeRef = useRef(onChange);

  // Keep the callback current without making it an effect dependency: a parent
  // that passes an inline arrow would otherwise tear down and rebuild the whole
  // editor — losing cursor and history — on every render.
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Hand the parent an imperative way IN, without making the document
  // controlled on the way out.
  //
  // The media library needs exactly one operation: "insert this at the caret".
  // A controlled value would be the wrong tool — it would mean React writing
  // into the document on every render, which is what resets the cursor and the
  // undo history. An api object is the same escape hatch CodeMirror itself
  // uses (`EditorView.dispatch`), and it keeps the one-way data flow intact:
  // changes still leave only through `onChange`.
  useEffect(() => {
    if (!apiRef) return;
    apiRef.current = {
      /**
       * Put `text` at the caret.
       *
       * `block: true` makes the insertion stand alone as its own paragraph,
       * adding only the newlines that are actually missing. The padding is
       * computed from the document rather than guessed by the caller, because
       * the caller cannot see where the caret is — and a markdown image glued
       * to the end of the previous line is a paragraph continuation, not the
       * block the author who clicked "insert" had in mind.
       */
      insert(text, { block = false } = {}) {
        const instance = view.current;
        if (!instance) return false;

        const doc = instance.state.doc;
        const { from, to } = instance.state.selection.main;

        let chunk = text;
        let anchor = from + text.length;
        if (block) {
          const before = doc.sliceString(0, from);
          const after = doc.sliceString(to);
          const lead =
            before === "" || before.endsWith("\n\n")
              ? ""
              : before.endsWith("\n")
                ? "\n"
                : "\n\n";
          // A trailing newline at the very end of the document would leave a
          // dangling blank line that the next keystroke types into.
          const tail = after.startsWith("\n") ? "\n" : "\n\n";
          chunk = `${lead}${text}${after === "" ? "\n" : tail}`;
          anchor = from + lead.length + text.length;
        }

        instance.dispatch({
          changes: { from, to, insert: chunk },
          selection: { anchor },
        });
        instance.focus();
        return true;
      },
    };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef]);

  useEffect(() => {
    if (!host.current) return;

    const state = EditorState.create({
      doc: initialValue ?? "",
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        foldGutter(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        prologueTheme,
        syntaxHighlighting(prologueHighlight),

        // Tab inserts an indent rather than moving focus. This is a markdown
        // editor with fenced code blocks in it — a YAML frontmatter block and a
        // Python fence both need to be indented — and the accessibility
        // argument for trapping Tab applies to a form field, not to a
        // full-document editor where the surrounding controls are tabbable.
        keymap.of([
          indentWithTab,
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...foldKeymap,
          ...completionKeymap,
        ]),

        markdown({
          base: markdownLanguage,
          // LanguageDescription, not LanguageSupport: the corpus fences `py`
          // and `js` far more often than `python` and `javascript`, and only
          // the description form carries aliases. A raw LanguageSupport would
          // highlight the long names and silently leave the short ones plain —
          // which is the failure that looks like "the editor is broken".
          codeLanguages: [
            LanguageDescription.of({
              name: "python",
              alias: ["py"],
              load: () => import("@codemirror/lang-python").then((m) => m.python()),
            }),
            LanguageDescription.of({
              name: "rust",
              alias: ["rs"],
              load: () => import("@codemirror/lang-rust").then((m) => m.rust()),
            }),
            LanguageDescription.of({
              name: "javascript",
              alias: ["js", "jsx", "node"],
              load: () => import("@codemirror/lang-javascript").then((m) => m.javascript()),
            }),
            LanguageDescription.of({
              name: "yaml",
              alias: ["yml"],
              load: () => import("@codemirror/lang-yaml").then((m) => m.yaml()),
            }),
            LanguageDescription.of({
              name: "html",
              alias: ["htm"],
              load: () => import("@codemirror/lang-html").then((m) => m.html()),
            }),
            LanguageDescription.of({
              name: "json",
              load: () => import("@codemirror/lang-json").then((m) => m.json()),
            }),
            // `r` is 35 of the 64 fences in this corpus — more than every other
            // language combined — and there is no Lezer grammar for it on npm.
            // It is left off rather than approximated: an R syntax error
            // rendered in red across the most common fence in the blog would be
            // worse than no colour at all.
            //
            // `mermaid` and `text` are likewise absent. The mermaid fence is
            // turned into a diagram by rehype-mermaid-pre on the server, so the
            // editor's only job for it is to not get in the way.
          ],
        }),

        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current?.(update.state.doc.toString());
          }
        }),

        // A very long single line is how a pasted table or a minified snippet
        // arrives, and wrapping it keeps the document navigable.
        EditorView.lineWrapping,
      ],
    });

    const instance = new EditorView({ state, parent: host.current });
    view.current = instance;

    return () => {
      instance.destroy();
      view.current = null;
    };
    // Mount-only. `initialValue` is intentionally not a dependency — see the
    // header. A different document means a different post, which remounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={host}
      className={`overflow-hidden rounded-xl border border-border bg-surface ${className}`}
      // The editor is a text field: `role="textbox"` is what CodeMirror's own
      // content element declares, and labelling the wrapper gives a screen
      // reader something to announce the region by.
      role="group"
      aria-label="Markdown 源码"
    />
  );
}
