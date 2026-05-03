import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function reviewExtension(pi: ExtensionAPI): void {
	pi.registerCommand("review", {
		description: "Start a structured code review flow",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("/review requires interactive mode", "error");
				return;
			}
			if (!ctx.model) {
				ctx.ui.notify("Select a model before running /review.", "error");
				return;
			}
			ctx.ui.notify("Review extension loaded. Target selection is implemented in the next task.", "info");
		},
	});
}
