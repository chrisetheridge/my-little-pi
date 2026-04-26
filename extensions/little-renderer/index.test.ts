import { afterEach, describe, expect, it, vi } from "vitest";

type Handler = (event: any, ctx?: any) => void | Promise<void>;

interface LoadedExtension {
	tools: Map<string, any>;
	handlers: Map<string, Handler>;
}

const originalEnv = { ...process.env };

afterEach(() => {
	vi.restoreAllMocks();
	vi.resetModules();
	for (const key of Object.keys(process.env)) {
		delete process.env[key];
	}
	Object.assign(process.env, originalEnv);
});

async function loadExtension(): Promise<LoadedExtension> {
	const tools = new Map<string, any>();
	const handlers = new Map<string, Handler>();

	const pi = {
		on: vi.fn((event: string, handler: Handler) => {
			handlers.set(event, handler);
		}),
		registerTool: vi.fn((tool: any) => {
			tools.set(tool.name, tool);
		}),
	};

	const { default: littleRendererExtension } = await import("./index.ts");
	littleRendererExtension(pi as never);

	return { tools, handlers };
}

describe("little-renderer extension", () => {
	it("registers compact renderers for the built-in file and shell tools", async () => {
		const { tools } = await loadExtension();

		expect([...tools.keys()].sort()).toEqual(["bash", "edit", "find", "grep", "ls", "read", "write"]);
		expect(tools.get("read")?.renderCall).toEqual(expect.any(Function));
		expect(tools.get("read")?.renderResult).toEqual(expect.any(Function));
	});

	it("prefixes thinking blocks and strips the prefix when loading context", async () => {
		const { handlers } = await loadExtension();
		const update = handlers.get("message_update");
		const context = handlers.get("context");
		const message = {
			message: {
				role: "assistant",
				content: [{ type: "thinking", thinking: "The user wants a summary." }],
			},
		};

		await update?.(message, {});
		expect(message.message.content[0].thinking).toBe("Thinking: The user wants a summary.");

		const loaded = {
			messages: [
				{
					role: "assistant",
					content: [{ type: "thinking", thinking: "Thinking: The user wants a summary." }],
				},
			],
		};

		await context?.(loaded, {});
		expect(loaded.messages[0].content[0].thinking).toBe("The user wants a summary.");
	});

	it("renders read calls with the compact spinner header", async () => {
		const { tools } = await loadExtension();
		const readTool = tools.get("read");
		const theme = {
			fg: (_role: string, text: string) => text,
			bold: (text: string) => text,
		};
		const ctx = {
			cwd: "/Users/me/project",
			state: {},
			invalidate: vi.fn(),
			executionStarted: false,
			isPartial: false,
			isError: false,
		};

		const rendered = readTool.renderCall({ path: "/Users/me/project/README.md" }, theme, ctx);
		expect(rendered.render(80).join("\n")).toContain("Read README.md");
		expect(rendered.render(80).join("\n")).toContain("●");
	});
});
