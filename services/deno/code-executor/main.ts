const COMMANDS: Record<string, string[]> = {
    python: ["python3", "-c"],
    node: ["node", "--input-type=module", "-e"],
    javascript: ["node", "-e"],
    deno: ["deno", "eval"],
    typescript: ["deno", "eval", "--ext=ts"],
    bash: ["/bin/sh", "-c"],
    sql: ["sqlite3", ":memory:"],
};

Deno.serve(async (req) => {
    if (req.method !== "POST") {
        return new Response("Method not allowed", { status: 405 });
    }

    try {
        const { lang, code } = await req.json();
        const config = COMMANDS[lang];
        if (!config) return new Response("Unsupported lang", { status: 400 });

        const abortController = new AbortController();
        const timeout = setTimeout(() => abortController.abort(), 5000);

        const proc = new Deno.Command(config[0], {
            args: [...config.slice(1), code],
            stdout: "piped",
            stderr: "piped",
            signal: abortController.signal,
        });

        const { stdout, stderr } = await proc.output();
        clearTimeout(timeout);

        return new Response(
            JSON.stringify({
                stdout: new TextDecoder().decode(stdout),
                stderr: new TextDecoder().decode(stderr).trim(),
            }),
            { headers: { "Content-Type": "application/json" } },
        );
    } catch (e) {
        const msg = e instanceof DOMException && e.name === "AbortError"
            ? "Execution timed out"
            : e.message;
        return new Response(JSON.stringify({ error: msg }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
});
