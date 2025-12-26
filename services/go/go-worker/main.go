package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
)

type TaskRequest struct {
	Data string `json:"data"`
}

type TaskResponse struct {
	OriginalData  string `json:"original_data"`
	ProcessedData string `json:"processed_data"`
	WorkerID      string `json:"worker_id"`
}

func processHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req TaskRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request payload", http.StatusBadRequest)
		return
	}

	// Simulate a "parallel task" or computation
	processedData := fmt.Sprintf("Processed by Go: %s (length: %d)", req.Data, len(req.Data))

	resp := TaskResponse{
		OriginalData:  req.Data,
		ProcessedData: processedData,
		WorkerID:      "go-worker-123", // Example worker ID
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
	log.Printf("Received data: '%s', Sent processed: '%s'", req.Data, processedData)
}

func main() {
	http.HandleFunc("/process", processHandler)
	port := "8000"
	log.Printf("Go Worker listening on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}
