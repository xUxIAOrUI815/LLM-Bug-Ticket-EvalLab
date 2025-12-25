    export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
    }

    export class HttpError extends Error {
    public readonly status: number;

    constructor(status: number, message?: string) {
        super(message ?? `HTTP ${status}`);
        this.status = status;
        this.name = "HttpError";
    }
    }

    export async function fakeRequest(opts: { ms: number; status: number }): Promise<{ status: number }> {
    await sleep(opts.ms);
    if (opts.status >= 400) {
        throw new HttpError(opts.status);
    }
    return { status: opts.status };
    }

    // WARNING: keep work bounded to avoid freezing the browser completely.
    export function burnCpu(iterations: number): number {
    let x = 0;
    for (let i = 0; i < iterations; i++) {
        x += Math.sqrt((i % 1000) + 1);
    }
    return x;
    }
