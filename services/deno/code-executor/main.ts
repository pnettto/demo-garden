import { join } from "https://deno.land/std@0.224.0/path/mod.ts";

const BWRAP_BASE = [
    "--ro-bind",
    "/usr",
    "/usr",
    "--ro-bind",
    "/bin",
    "/bin",
    "--ro-bind",
    "/lib",
    "/lib",
    "--ro-bind",
    "/v8cache",
    "/v8cache",
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--unshare-user",
    "--unshare-ipc",
    "--unshare-pid",
    "--unshare-uts",
    "--new-session",
    "--die-with-parent",
    "--dir",
    "/tmp",
    "--dir",
    "/home/deno",
    "--bind",
];

const COMMANDS: Record<string, { cmd: string; args: string[]; ext: string }> = {
    python: { cmd: "python3", args: ["-S"], ext: "py" },
    node: { cmd: "node", args: ["--max-old-space-size=64"], ext: "js" },
    deno: {
        cmd: "deno",
        args: ["run", "--allow-read", "--v8-flags=--max-old-space-size=64"],
        ext: "ts",
    },
    typescript: { cmd: "deno", args: ["run", "--allow-read"], ext: "ts" },
    bash: { cmd: "/bin/bash", args: ["--noprofile", "--norc"], ext: "sh" },
    sql: {
        cmd: "/bin/bash",
        args: ["-c", 'sqlite3 :memory: < "$1"', "bash"],
        ext: "sql",
    },
};

Deno.serve(async (req) => {
    if (req.method !== "POST") {
        return new Response("Method not allowed", { status: 405 });
    }

    const tempDir = await Deno.makeTempDir({ prefix: "run_" });

    try {
        const { lang, code } = await req.json();
        const config = COMMANDS[lang];
        if (!config) throw new Error(`Unsupported language: ${lang}`);

        const file = `main.${config.ext}`;
        await Deno.writeTextFile(join(tempDir, file), code);

        const abortController = new AbortController();
        const timeout = setTimeout(() => abortController.abort(), 2000);

        const command = new Deno.Command("bwrap", {
            cwd: tempDir,
            args: [
                ...BWRAP_BASE,
                tempDir,
                tempDir, // Bind specific tempDir
                "--chdir",
                tempDir,
                config.cmd,
                ...config.args,
                file,
            ],
            stdout: "piped",
            stderr: "piped",
            stdin: "null",
            env: {
                PATH: "/usr/local/bin:/usr/bin:/bin",
                DENO_DIR: "/v8cache",
            },
            clearEnv: true,
            signal: abortController.signal,
        });

        const { stdout, stderr } = await command.output();
        clearTimeout(timeout);

        return new Response(JSON.stringify({
            stdout: new TextDecoder().decode(stdout),
            stderr: new TextDecoder().decode(stderr).trim(),
        }));
    } catch (e) {
        return new Response(
            JSON.stringify({
                error: e instanceof Error ? e.message : String(e),
            }),
            { status: 400 },
        );
    } finally {
        await Deno.remove(tempDir, { recursive: true });
    }
});
