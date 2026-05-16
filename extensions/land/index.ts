import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { loadLandingWorkflowConfig } from "./config.ts";
import { showLandingWorkflow } from "./ui.ts";

export default function landingWorkflowExtension(pi: ExtensionAPI): void {
  pi.registerCommand("land", {
    description: "Run the configured repository land workflow",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("/land requires interactive mode", "error");
        return;
      }
      await showLandingWorkflow(ctx, loadLandingWorkflowConfig(ctx.cwd));
    },
  });
}
