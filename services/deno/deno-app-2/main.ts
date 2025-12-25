Deno.serve({ port: 8000 }, async (req) => {
    const url = new URL(req.url);
    console.log(`Incoming request: ${url.pathname}`);

    // Simple API endpoint
    if (url.pathname === "/api/info") {
        console.log("Serving API info");
        return new Response(
            JSON.stringify({
                message: "Hello from Deno!",
                timestamp: new Date().toISOString(),
                version: Deno.version.deno,
            }),
            {
                headers: { "content-type": "application/json" },
            },
        );
    }

    // Serve static UI
    try {
        const filePath = url.pathname === "/"
            ? "./public/index.html"
            : `./public${url.pathname}`;
        console.log(`Serving file: ${filePath}`);
        const content = await Deno.readFile(filePath);

        let contentType = "text/html";
        if (filePath.endsWith(".js")) contentType = "text/javascript";
        if (filePath.endsWith(".css")) contentType = "text/css";

        return new Response(content, {
            headers: { "content-type": contentType },
        });
    } catch (e) {
        console.error(`Error serving path ${url.pathname}:`, e);
        return new Response("Not Found", { status: 404 });
    }
});
