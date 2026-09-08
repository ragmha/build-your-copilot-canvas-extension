const fakeSdkUrl = new URL("./fake-copilot-sdk.mjs", import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
    if (specifier === "@github/copilot-sdk/extension") {
        return {
            url: fakeSdkUrl,
            shortCircuit: true,
        };
    }
    return nextResolve(specifier, context);
}
