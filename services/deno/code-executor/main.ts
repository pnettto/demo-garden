import { join } from "https://deno.land/std@0.224.0/path/mod.ts";

// Base configuration for bubblewrap (bwrap) sandbox
// Mounts system directories as read-only and isolates processes, users, and networks
const BWRAP_BASE = [
    "--ro-bind",
    "/usr",
    "/usr", // Read-only access to system binaries/libraries
    "--ro-bind",
    "/bin",
    "/bin",
    "--ro-bind",
    "/lib",
    "/lib",
    "--ro-bind",
    "/v8cache",
    "/v8cache", // Shared cache for Deno performance
    "--proc",
    "/proc", // Virtual filesystem for process info
    "--dev",
    "/dev", // Necessary device nodes
    "--unshare-user", // Create new user namespace (isolates root)
    "--unshare-ipc", // Isolate Inter-Process Communication
    "--unshare-pid", // Isolate Process IDs (cannot see other system procs)
    "--unshare-uts", // Isolate hostname/domain name
    "--new-session", // Prevent terminal escape sequences
    "--die-with-parent", // Kill sandbox if the Deno process exits
    "--dir",
    "/tmp", // Create an empty, isolated /tmp
    "--dir",
    "/home/deno", // Create an empty home directory
    "--bind", // Placeholder for the writable working directory
];

// Support languages and their commands
const COMMANDS: Record<string, { cmd: string; args: string[]; ext: string }> = {
    python: { cmd: "python3", args: ["-S"], ext: "py" }, // -S ignores site-packages for speed/security
    node: { cmd: "node", args: ["--max-old-space-size=64"], ext: "js" }, // Memory limit 64MB
    deno: {
        cmd: "deno",
        args: ["run", "--allow-read", "--v8-flags=--max-old-space-size=64"],
        ext: "ts",
    },
    typescript: { cmd: "deno", args: ["run", "--allow-read"], ext: "ts" },
    bash: { cmd: "/bin/bash", args: ["--noprofile", "--norc"], ext: "sh" },
    sql: {
        cmd: "/bin/bash",
        args: ["-c", 'sqlite3 :memory: < "$1"', "bash"], // Run SQLite in-memory
        ext: "sql",
    },
};

// Start a Deno HTTP server to handle execution requests
Deno.serve(async (req) => {
    // Only allow POST requests for code submission
    if (req.method !== "POST") {
        return new Response("Method not allowed", { status: 405 });
    }

    // Create a temporary directory on the host to store the code file
    const tempDir = await Deno.makeTempDir({ prefix: "run_" });

    try {
        const { lang, code } = await req.json();
        const config = COMMANDS[lang];
        if (!config) throw new Error(`Unsupported language: ${lang}`);

        // Write the provided code to a physical file in the temp directory
        const file = `main.${config.ext}`;
        await Deno.writeTextFile(join(tempDir, file), code);

        // Set a 5-second timeout to prevent infinite loops or long-running scripts
        const abortController = new AbortController();
        const timeout = setTimeout(() => abortController.abort(), 5000);

        // Execute the code using bubblewrap
        const command = new Deno.Command("bwrap", {
            cwd: tempDir,
            args: [
                ...BWRAP_BASE,
                tempDir,
                tempDir, // Bind the host tempDir to the same path inside sandbox
                "--chdir",
                tempDir, // Start execution inside the temp directory
                config.cmd,
                ...config.args,
                file,
            ],
            stdout: "piped",
            stderr: "piped",
            stdin: "null", // Disable input for security
            env: {
                PATH: "/usr/local/bin:/usr/bin:/bin",
                DENO_DIR: "/v8cache",
            },
            clearEnv: true, // Wipe host environment variables
            signal: abortController.signal,
        });

        // Capture output and clear the timeout timer
        const { stdout, stderr } = await command.output();
        clearTimeout(timeout);

        // Return the captured logs to the client
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
        // Delete temporary directory
        await Deno.remove(tempDir, { recursive: true });
    }
});
