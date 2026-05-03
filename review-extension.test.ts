import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
	vi.restoreAllMocks();
	vi.resetModules();
});

function makePi() {
	const commands = new Map<string, any>();
	const pi = {
		registerCommand: vi.fn((name: string, options: any) => {
			commands.set(name, options);
		}),
	};
	return { pi, commands };
}

describe("review extension", () => {
	it("registers the review command", async () => {
		const { pi, commands } = makePi();
		const { default: reviewExtension } = await import("./extensions/review/index.ts");

		reviewExtension(pi as never);

		expect(commands.has("review")).toBe(true);
		expect(commands.get("review")?.description).toContain("code review");
	});
});
