import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Loader } from "@mariozechner/pi-tui";

const SPINNER_CHARS = ["·", "✢", "✳", "✶", "✻", "✽"];
const SPINNER_FRAMES = [...SPINNER_CHARS, ...[...SPINNER_CHARS].reverse()];
const LOADER_INTERVAL_MS = 250;
const LOADER_PATCH_FLAG = Symbol.for("little-spinner:loader-patched");

function patchLoader(): void {
	const proto = Loader.prototype as any;
	if (proto[LOADER_PATCH_FLAG]) return;

	proto.updateDisplay = function patchedUpdateDisplay() {
		const frame = SPINNER_FRAMES[this.currentFrame % SPINNER_FRAMES.length];
		const message =
			typeof this.message === "string" && /\x1b\[[0-9;]*m/.test(this.message)
				? this.message
				: this.messageColorFn(this.message);
		const nextText = `${this.spinnerColorFn(frame)} ${message}`;
		if (this.text === nextText) return;
		this.setText(nextText);
		if (this.ui) {
			this.ui.requestRender();
		}
	};

	proto.start = function patchedStart() {
		this.stop();
		this.updateDisplay();
		const scheduleNext = () => {
			this.intervalId = setTimeout(() => {
				this.currentFrame = (this.currentFrame + 1) % SPINNER_FRAMES.length;
				this.updateDisplay();
				scheduleNext();
			}, LOADER_INTERVAL_MS);
		};
		scheduleNext();
	};

	proto[LOADER_PATCH_FLAG] = true;
}

export default function littleSpinnerExtension(_pi: ExtensionAPI): void {
	patchLoader();
}
