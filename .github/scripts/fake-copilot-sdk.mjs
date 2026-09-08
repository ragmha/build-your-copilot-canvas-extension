const canvases = new WeakSet();
let registration;

export class CanvasError extends Error {
    constructor(code, message) {
        super(message);
        this.name = "CanvasError";
        this.code = code;
    }
}

export function createCanvas(options) {
    canvases.add(options);
    return options;
}

export async function joinSession(config) {
    if (
        !Array.isArray(config?.canvases) ||
        config.canvases.some((canvas) => !canvases.has(canvas))
    ) {
        throw new Error(
            "joinSession canvases must be created with createCanvas.",
        );
    }
    registration = config;
    return {
        async log() {},
    };
}

export function inspectRegistration() {
    return registration;
}
