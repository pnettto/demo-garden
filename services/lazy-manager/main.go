package main

import (
	"context"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/http/httputil"

	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/docker/docker/api/types"
	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/filters"
	"github.com/docker/docker/client"
	"gopkg.in/yaml.v3"
)

var (
	projectName     = getEnv("PROJECT_NAME", "demos")
	demosDir        = getEnv("DEMOS_DIR", "/demos-dir")
	idleTimeout     = getDurationEnv("IDLE_TIMEOUT", 10)
	serviceActivity = make(map[string]time.Time)
	serviceLocks    = make(map[string]*sync.Mutex)
	serviceRequests = make(map[string]int)
	mu              sync.Mutex
	locksMu         sync.Mutex
	dockerClient    *client.Client
)

func getEnv(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok {
		return value
	}
	return fallback
}

func getDurationEnv(key string, fallback int) time.Duration {
	if value, ok := os.LookupEnv(key); ok {
		if v, err := strconv.Atoi(value); err == nil {
			return time.Duration(v) * time.Second
		}
	}
	return time.Duration(fallback) * time.Second
}

func getServiceLock(name string) *sync.Mutex {
	locksMu.Lock()
	defer locksMu.Unlock()
	if _, ok := serviceLocks[name]; !ok {
		serviceLocks[name] = &sync.Mutex{}
	}
	return serviceLocks[name]
}

func updateActivity(name string, delta int) {
	mu.Lock()
	defer mu.Unlock()
	serviceRequests[name] += delta
	serviceActivity[name] = time.Now()
}

func getContainer(ctx context.Context, serviceName string) (*types.Container, error) {
	f := filters.NewArgs()
	f.Add("label", fmt.Sprintf("com.docker.compose.service=%s", serviceName))
	f.Add("label", fmt.Sprintf("com.docker.compose.project=%s", projectName))

	containers, err := dockerClient.ContainerList(ctx, container.ListOptions{
		All:     true,
		Filters: f,
	})
	if err != nil {
		return nil, err
	}
	if len(containers) == 0 {
		return nil, nil
	}
	return &containers[0], nil
}

// findServiceDirectory finds the directory containing a service's docker-compose.yml
func findServiceDirectory(serviceName string) (string, error) {
	mainComposePath := filepath.Join(demosDir, "docker-compose.yml")

	// Read main compose file
	data, err := os.ReadFile(mainComposePath)
	if err != nil {
		return "", fmt.Errorf("failed to read main compose file: %w", err)
	}

	// Parse to get includes
	var mainCompose struct {
		Include []string `yaml:"include"`
	}
	if err := yaml.Unmarshal(data, &mainCompose); err != nil {
		return "", fmt.Errorf("failed to parse main compose file: %w", err)
	}

	// Search each included compose file for the service
	for _, includePath := range mainCompose.Include {
		fullPath := filepath.Join(demosDir, includePath)

		// Read included compose file
		includeData, err := os.ReadFile(fullPath)
		if err != nil {
			log.Printf("Warning: could not read %s: %v", fullPath, err)
			continue
		}

		// Parse to check if it contains the service
		var includeCompose struct {
			Services map[string]interface{} `yaml:"services"`
		}
		if err := yaml.Unmarshal(includeData, &includeCompose); err != nil {
			log.Printf("Warning: could not parse %s: %v", fullPath, err)
			continue
		}

		// Check if this compose file defines the service
		if _, exists := includeCompose.Services[serviceName]; exists {
			// Return the directory containing this compose file
			return filepath.Dir(fullPath), nil
		}
	}

	return "", fmt.Errorf("service %s not found in any included compose file", serviceName)
}

func ensureServiceRunning(ctx context.Context, serviceName string, targetPort string) error {
	c, err := getContainer(ctx, serviceName)
	if err != nil {
		return err
	}

	if c == nil || c.State != "running" {
		lock := getServiceLock(serviceName)
		lock.Lock()
		defer lock.Unlock()

		// Re-check
		c, err = getContainer(ctx, serviceName)
		if err != nil {
			return err
		}

		if c == nil || c.State != "running" {
			log.Printf("Starting service: %s", serviceName)

			// Build base command
			args := []string{"compose", "-p", projectName, "--profile", "lazy",
				"-f", filepath.Join(demosDir, "docker-compose.yml")}

			envPath, err := findServiceDirectory(serviceName)
			if err != nil {
				log.Printf("Error: %v", err)
				return err
			}
			fullEnvPath := filepath.Join(envPath, ".env")
			if _, err := os.Stat(fullEnvPath); err == nil {
				args = append(args, "--env-file", fullEnvPath)
			} else {
				log.Printf("Optional .env file not found at %s, skipping.", fullEnvPath)
			}

			args = append(args, "up", "-d", serviceName)

			cmd := exec.Command("docker", args...)
			cmd.Dir = demosDir
			cmd.Stdout = os.Stdout
			cmd.Stderr = os.Stderr
			if err := cmd.Run(); err != nil {
				return fmt.Errorf("failed to start service: %w", err)
			}

			// Wait for it to be ready
			// User requested a strict 20s timeout. If it's not ready by then, fail.
			const maxWaitSeconds = 20
			portReady := false

			for i := 0; i < maxWaitSeconds; i++ {
				c, err = getContainer(ctx, serviceName)
				if err == nil && c != nil && c.State == "running" {
					// Container is running, check if port is open
					if isPortOpen(fmt.Sprintf("%s:%s", serviceName, targetPort), 1*time.Second) {
						portReady = true
						break
					}
				}
				time.Sleep(1 * time.Second)
			}

			if !portReady {
				return fmt.Errorf("service %s failed to become ready within %ds", serviceName, maxWaitSeconds)
			}
			return nil
		}
	}
	return nil
}

func isPortOpen(addr string, timeout time.Duration) bool {
	conn, err := net.DialTimeout("tcp", addr, timeout)
	if err != nil {
		return false
	}
	conn.Close()
	return true
}

func proxyHandler(w http.ResponseWriter, r *http.Request) {
	targetService := r.Header.Get("x-target-service")
	targetPort := r.Header.Get("x-target-port")

	if targetService == "" || targetPort == "" {
		http.Error(w, "Missing X-Target-Service or X-Target-Port headers", http.StatusBadRequest)
		return
	}

	updateActivity(targetService, 1)
	defer updateActivity(targetService, -1)

	ctx := r.Context()
	if err := ensureServiceRunning(ctx, targetService, targetPort); err != nil {
		log.Printf("Error ensuring service %s is running: %v", targetService, err)
		http.Error(w, fmt.Sprintf("Proxy error: %v", err), http.StatusBadGateway)
		return
	}

	targetURL, _ := url.Parse(fmt.Sprintf("http://%s:%s", targetService, targetPort))
    proxy := httputil.NewSingleHostReverseProxy(targetURL)

	originalDirector := proxy.Director

	proxy.Director = func(req *http.Request) {
		originalDirector(req)
		req.Header.Del("x-target-service")
		req.Header.Del("x-target-port")
		
		// Ensure WebSocket headers are passed to the backend
		if strings.ToLower(req.Header.Get("Connection")) == "upgrade" && 
		strings.ToLower(req.Header.Get("Upgrade")) == "websocket" {
			req.Header.Set("Connection", "Upgrade")
			req.Header.Set("Upgrade", "websocket")
		}
	}

	proxy.ModifyResponse = func(resp *http.Response) error {
		// If it's a WebSocket upgrade, do NOT strip headers
		if resp.StatusCode == http.StatusSwitchingProtocols {
			return nil
		}

		// Existing deletions for standard HTTP
		resp.Header.Del("Keep-Alive")
		resp.Header.Del("Proxy-Authenticate")
		resp.Header.Del("Proxy-Authorization")
		resp.Header.Del("TE")
		resp.Header.Del("Trailers")
		resp.Header.Del("Transfer-Encoding")
		return nil
	}

    proxy.ServeHTTP(w, r)
}

func monitorServices() {
	for {
		time.Sleep(5 * time.Second)
		now := time.Now()
		ctx := context.Background()

		// Discover
		containers, err := dockerClient.ContainerList(ctx, container.ListOptions{})
		if err == nil {
			mu.Lock()
			for _, c := range containers {
				serviceName := c.Labels["com.docker.compose.service"]

				// Check for the garbage_collect label and ensure primary serviceName is valid
				if _, ok := c.Labels["remove_after_use"]; ok && serviceName != "" {
					if _, ok := serviceActivity[serviceName]; !ok {
						log.Printf("Found service to take down: %s, starting timer", serviceName)
						serviceActivity[serviceName] = now
					}
				}
			}
			mu.Unlock()
		}

		mu.Lock()
		for name, lastActive := range serviceActivity {
			if serviceRequests[name] > 0 {
				continue
			}

			if now.Sub(lastActive) > idleTimeout {
				c, err := getContainer(ctx, name)
				if err == nil && c != nil && c.State == "running" {
					log.Printf("Idle timeout reached for %s. Stopping and checking dependencies...", name)

					// 1. Stop the parent container
					timeout := 10
					dockerClient.ContainerStop(ctx, c.ID, container.StopOptions{Timeout: &timeout})

					// 2. Identify and stop dependencies from labels
					if dependsOn, ok := c.Labels["com.docker.compose.depends_on"]; ok && dependsOn != "" {
						for _, entry := range strings.Split(dependsOn, ",") {
							depName := strings.Split(entry, ":")[0]
							depContainer, err := getContainer(ctx, depName)

							if err == nil && depContainer != nil && depContainer.State == "running" {
								// Check for the prevention label
								if _, prevent := depContainer.Labels["never_remove"]; prevent {
									log.Printf("Skipping stop for dependency %s (protected by label)", depName)
									continue
								}

								log.Printf("Stopping dependency %s for parent %s", depName, name)
								dockerClient.ContainerStop(ctx, depContainer.ID, container.StopOptions{Timeout: &timeout})
							}
						}
					}
				}
				delete(serviceActivity, name)
			}
		}
		mu.Unlock()
	}
}

func main() {
	var err error
	dockerClient, err = client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		log.Fatalf("Failed to create docker client: %v", err)
	}

	go monitorServices()

	http.HandleFunc("/", proxyHandler)
	log.Println("Go Lazy Manager starting on :8001")
	log.Fatal(http.ListenAndServe(":8001", nil))
}
