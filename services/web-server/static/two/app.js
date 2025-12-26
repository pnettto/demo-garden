document.addEventListener("DOMContentLoaded", () => {
    const refreshBtn = document.getElementById("refresh-btn");
    const dataContainer = document.getElementById("data-container");
    const loader = document.getElementById("loader");
    const errorMsg = document.getElementById("error-message");

    const fields = {
        source: document.getElementById("source"),
        dbItem: document.getElementById("db-item"),
        originalValue: document.getElementById("original-value"),
        goProcessed: document.getElementById("go-processed"),
        workerId: document.getElementById("worker-id"),
    };

    async function fetchData() {
        // Reset state
        errorMsg.classList.add("hidden");
        dataContainer.classList.add("hidden");
        loader.classList.remove("hidden");

        try {
            // Using absolute path because we'll proxy it via Nginx
            const response = await fetch("/process-data");

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();

            // Map data to fields
            fields.source.textContent = data.source || "--";
            fields.dbItem.textContent =
                `${data.db_item_name} (ID: ${data.db_item_id})`;
            fields.originalValue.textContent = data.original_value || "--";
            fields.goProcessed.textContent = data.go_processed_data || "--";
            fields.workerId.textContent = data.go_worker_id || "--";

            dataContainer.classList.remove("hidden");
        } catch (error) {
            console.error("Fetch error:", error);
            errorMsg.classList.remove("hidden");
        } finally {
            loader.classList.add("hidden");
        }
    }

    refreshBtn.addEventListener("click", fetchData);

    // Initial fetch
    fetchData();
});
