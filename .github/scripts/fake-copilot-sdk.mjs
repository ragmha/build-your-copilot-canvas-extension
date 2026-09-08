export class CanvasError extends Error {
    constructor(code, message) {
        super(message);
        this.name = "CanvasError";
        this.code = code;
    }
}

export function createCanvas(options) {
    return options;
}

export async function joinSession(config) {
    globalThis.__copilotExerciseSession = config;
    return {
        async log() {},
    };
}
