import { Extension } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import type { BlockKind } from "@promptfarm/editor-core";
import {
  BLOCK_KINDS,
  BLOCK_LABELS,
  BLOCK_DESCRIPTIONS,
} from "@promptfarm/editor-core";

export const SlashCommands = Extension.create({
  name: "slashCommands",

  addOptions() {
    return {
      suggestion: {
        char: "/",
        allowSpaces: false,

        items: ({ query }: { query: string }): BlockKind[] => {
          const q = query.toLowerCase();
          if (!q) return [...BLOCK_KINDS];
          return BLOCK_KINDS.filter(
            (k) =>
              BLOCK_LABELS[k].toLowerCase().includes(q) ||
              BLOCK_DESCRIPTIONS[k].toLowerCase().includes(q),
          );
        },

        command: ({
          editor,
          range,
          props,
        }: {
          editor: any;
          range: any;
          props: BlockKind;
        }) => {
          // Delete the /query text, then update block kind
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .command(({ tr }: any) => {
              const { $from } = tr.selection;
              const pos = $from.before($from.depth);
              const node = tr.doc.nodeAt(pos);
              if (node?.type.name === "promptBlock") {
                tr.setNodeMarkup(pos, undefined, {
                  ...node.attrs,
                  kind: props,
                });
              }
              return true;
            })
            .run();
        },

        // render() is overridden by PromptEditor component
        render: () => ({
          onStart() {},
          onUpdate() {},
          onKeyDown() {
            return false;
          },
          onExit() {},
        }),
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ];
  },
});
